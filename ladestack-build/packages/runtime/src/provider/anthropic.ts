import { createParser } from "eventsource-parser";
import type { EventSourceParser } from "eventsource-parser";
import { LLMConfig, Message, CompletionResult, StreamEvent, TokenUsage, ToolCall } from "./types.js";

function buildRequestBody(messages: Message[], config: LLMConfig) {
  const systemMessages = messages.filter((m) => m.role === "system");
  const nonSystemMessages = messages.filter((m) => m.role !== "system");

  const body: Record<string, unknown> = {
    model: config.model,
    max_tokens: config.maxTokens ?? 4096,
    stream: true,
    messages: nonSystemMessages.map((m) => {
      const msg: Record<string, unknown> = { role: m.role, content: m.content };
      if (m.toolCalls && m.toolCalls.length > 0) {
        msg.content = m.content || " ";
        msg.content = [
          ...(m.content ? [{ type: "text" as const, text: m.content }] : []),
          ...m.toolCalls.map((tc) => ({
            type: "tool_use" as const,
            id: tc.id,
            name: tc.name,
            input: tc.arguments,
          })),
        ];
      }
      if (m.toolResults && m.toolResults.length > 0) {
        msg.content = [
          ...(m.content ? [{ type: "text" as const, text: m.content }] : []),
          ...m.toolResults.map((tr) => ({
            type: "tool_result" as const,
            tool_use_id: tr.id,
            content: typeof tr.result === "string" ? tr.result : JSON.stringify(tr.result),
          })),
        ];
      }
      return msg;
    }),
    tools: undefined as unknown[] | undefined,
  };

  const tools = messages
    .filter((m) => m.role === "system")
    .flatMap((m) => {
      try {
        return JSON.parse(m.content);
      } catch {
        return [];
      }
    })
    .filter((t: unknown) => typeof t === "object" && t !== null && "name" in (t as Record<string, unknown>));

  const lastSystemMsg = systemMessages[systemMessages.length - 1];
  if (lastSystemMsg) {
    body.system = lastSystemMsg.content;
  }

  return body;
}

function parseContentBlock(event: Record<string, unknown>, currentToolCall: ToolCall | null): {
  toolCall: ToolCall | null;
  textDelta: string | null;
  event: StreamEvent | null;
} {
  const type = event.type as string;
  let textDelta: string | null = null;
  let streamEvent: StreamEvent | null = null;
  let toolCall = currentToolCall;

  if (type === "content_block_start") {
    const block = event.content_block as Record<string, unknown> | undefined;
    if (block?.type === "tool_use") {
      toolCall = {
        id: block.id as string,
        name: block.name as string,
        arguments: {},
      };
      streamEvent = {
        type: "tool_call_start",
        id: toolCall.id,
        name: toolCall.name,
        arguments: "",
      };
    }
  } else if (type === "content_block_delta") {
    const delta = event.delta as Record<string, unknown> | undefined;
    if (delta?.type === "text_delta") {
      textDelta = delta.text as string;
      streamEvent = { type: "text_delta", text: textDelta };
    } else if (delta?.type === "input_json_delta" && toolCall) {
      const partial = delta.partial_json as string;
      streamEvent = { type: "tool_call_delta", id: toolCall.id, delta: partial };
    }
  } else if (type === "content_block_stop" && toolCall) {
    streamEvent = { type: "tool_call_end", id: toolCall.id, name: toolCall.name, arguments: JSON.stringify(toolCall.arguments) };
  }

  return { toolCall, textDelta, event: streamEvent };
}

export async function anthropicCompletion(
  messages: Message[],
  config: LLMConfig,
  onEvent?: (event: StreamEvent) => void
): Promise<CompletionResult> {
  const baseUrl = config.baseUrl || "https://api.anthropic.com/v1";
  const url = `${baseUrl}/messages`;

  const lastSystemMsg = messages.filter((m) => m.role === "system").pop();
  const nonSystemMessages = messages.filter((m) => m.role !== "system");

  const requestBody: Record<string, unknown> = {
    model: config.model,
    max_tokens: config.maxTokens ?? 4096,
    stream: true,
    messages: buildApiMessages(nonSystemMessages),
  };

  if (lastSystemMsg) {
    requestBody.system = lastSystemMsg.content;
  }

  let accumulatedContent = "";
  let collectedToolCalls: ToolCall[] = [];
  let currentToolCall: ToolCall | null = null;
  let pendingToolArgs = "";
  let usage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${errorText}`);
  }

  const parser = createParser({
    onEvent: (event) => {
      const data = event.data;
      if (data === "[DONE]") return;

      try {
        const parsed = JSON.parse(data) as Record<string, unknown>;
        const eventType = parsed.type as string;

        if (eventType === "message_start") {
          const msg = parsed.message as Record<string, unknown> | undefined;
          if (msg?.usage) {
            const u = msg.usage as Record<string, number>;
            usage = {
              promptTokens: u.input_tokens ?? 0,
              completionTokens: u.output_tokens ?? 0,
              totalTokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0),
            };
          }
          return;
        }

        if (eventType === "content_block_start") {
          const block = parsed.content_block as Record<string, unknown> | undefined;
          if (block?.type === "tool_use") {
            currentToolCall = {
              id: block.id as string,
              name: block.name as string,
              arguments: {},
            };
            pendingToolArgs = "";
            onEvent?.({
              type: "tool_call_start",
              id: currentToolCall.id,
              name: currentToolCall.name,
              arguments: "",
            });
          }
          return;
        }

        if (eventType === "content_block_delta") {
          const delta = parsed.delta as Record<string, unknown> | undefined;
          if (delta?.type === "text_delta") {
            const text = delta.text as string;
            accumulatedContent += text;
            onEvent?.({ type: "text_delta", text });
          } else if (delta?.type === "input_json_delta" && currentToolCall) {
            const partial = delta.partial_json as string;
            pendingToolArgs += partial;
            onEvent?.({ type: "tool_call_delta", id: currentToolCall.id, delta: partial });
          }
          return;
        }

        if (eventType === "content_block_stop") {
          if (currentToolCall) {
            try {
              currentToolCall.arguments = JSON.parse(pendingToolArgs) as Record<string, unknown>;
            } catch {
              currentToolCall.arguments = { raw: pendingToolArgs };
            }
            collectedToolCalls.push(currentToolCall);
            onEvent?.({
              type: "tool_call_end",
              id: currentToolCall.id,
              name: currentToolCall.name,
              arguments: pendingToolArgs,
            });
            currentToolCall = null;
            pendingToolArgs = "";
          }
          return;
        }

        if (eventType === "message_delta") {
          const u = parsed.usage as Record<string, number> | undefined;
          if (u) {
            usage.completionTokens = u.output_tokens ?? usage.completionTokens;
            usage.totalTokens = usage.promptTokens + usage.completionTokens;
            onEvent?.({ type: "usage", usage });
          }
          return;
        }

        if (eventType === "message_stop") {
          const message: Message = {
            role: "assistant",
            content: accumulatedContent,
            toolCalls: collectedToolCalls.length > 0 ? collectedToolCalls : undefined,
          };
          onEvent?.({ type: "message_complete", message, usage });
          return;
        }

        if (eventType === "error") {
          const err = parsed.error as Record<string, unknown> | undefined;
          onEvent?.({ type: "error", error: (err?.message as string) ?? "Unknown error", code: err?.type as string });
        }
      } catch (e) {
        onEvent?.({ type: "error", error: `Parse error: ${(e as Error).message}` });
      }
    },
  });

  if (!response.body) throw new Error("Response body is null");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      parser.feed(chunk);
    }
  } finally {
    reader.releaseLock();
  }

  const message: Message = {
    role: "assistant",
    content: accumulatedContent,
    toolCalls: collectedToolCalls.length > 0 ? collectedToolCalls : undefined,
  };

  return { message, usage };
}

function buildApiMessages(messages: Message[]): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];

  for (const msg of messages) {
    if (msg.role === "system") continue;

    if (msg.toolResults && msg.toolResults.length > 0) {
      const content: Record<string, unknown>[] = [];
      if (msg.content) {
        content.push({ type: "text", text: msg.content });
      }
      for (const tr of msg.toolResults) {
        content.push({
          type: "tool_result",
          tool_use_id: tr.id,
          content: typeof tr.result === "string" ? tr.result : JSON.stringify(tr.result),
        });
      }
      result.push({ role: "user", content });
    } else if (msg.toolCalls && msg.toolCalls.length > 0) {
      const content: Record<string, unknown>[] = [];
      if (msg.content) {
        content.push({ type: "text", text: msg.content });
      }
      for (const tc of msg.toolCalls) {
        content.push({
          type: "tool_use",
          id: tc.id,
          name: tc.name,
          input: tc.arguments,
        });
      }
      result.push({ role: "assistant", content });
    } else {
      result.push({ role: msg.role === "assistant" ? "assistant" : "user", content: msg.content });
    }
  }

  return result;
}

export const ANTHROPIC_MODELS = [
  "claude-sonnet-4-20250514",
  "claude-sonnet-4",
  "claude-4-opus-20250514",
  "claude-4-opus",
  "claude-opus-4-20250514",
  "claude-opus-4",
  "claude-3-5-sonnet-20241022",
  "claude-3-5-sonnet-latest",
  "claude-3-5-haiku-20241022",
  "claude-3-5-haiku-latest",
  "claude-3-opus-latest",
  "claude-3-sonnet-latest",
  "claude-3-haiku-latest",
] as const;
