import { createParser } from "eventsource-parser";
import { LLMConfig, Message, CompletionResult, StreamEvent, TokenUsage, ToolCall } from "./types.js";

function buildRequestBody(messages: Message[], config: LLMConfig) {
  const body: Record<string, unknown> = {
    model: config.model,
    max_tokens: config.maxTokens ?? 4096,
    temperature: config.temperature ?? 0.7,
    top_p: config.topP ?? 1,
    stream: true,
    messages: messages.map((m) => {
      const msg: Record<string, unknown> = {
        role: m.role === "system" ? "system" : m.role === "assistant" ? "assistant" : "user",
        content: m.content || "",
      };

      if (m.toolCalls && m.toolCalls.length > 0) {
        msg.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
        }));
      }

      if (m.toolResults && m.toolResults.length > 0) {
        msg.role = "tool";
        msg.content = m.toolResults.map((tr) => ({
          tool_call_id: tr.id,
          role: "tool",
          content: typeof tr.result === "string" ? tr.result : JSON.stringify(tr.result),
        }));
        return msg;
      }

      return msg;
    }),
  };

  return body;
}

export async function openaiCompletion(
  messages: Message[],
  config: LLMConfig,
  onEvent?: (event: StreamEvent) => void
): Promise<CompletionResult> {
  const baseUrl = config.baseUrl || "https://api.openai.com/v1";
  const url = `${baseUrl}/chat/completions`;

  const requestBody = buildRequestBody(messages, config);

  let accumulatedContent = "";
  let collectedToolCalls: ToolCall[] = [];
  let currentToolCallIndex: number | null = null;
  const pendingToolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map();
  let usage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
  }

  const parser = createParser({
    onEvent: (event) => {
      const data = event.data;
      if (data === "[DONE]") return;

      try {
        const parsed = JSON.parse(data) as Record<string, unknown>;
        const choices = parsed.choices as Array<Record<string, unknown>> | undefined;
        if (!choices || choices.length === 0) return;

        const delta = (choices[0]?.delta ?? undefined) as Record<string, unknown> | undefined;
        if (!delta) return;

        if (delta.content) {
          const text = delta.content as string;
          accumulatedContent += text;
          onEvent?.({ type: "text_delta", text });
        }

        if (delta.tool_calls) {
          const toolCalls = delta.tool_calls as Array<Record<string, unknown>>;
          for (const tc of toolCalls) {
            const index = (tc.index ?? 0) as number;

            if (!pendingToolCalls.has(index)) {
              const fn = tc.function as Record<string, unknown> | undefined;
              pendingToolCalls.set(index, {
                id: (tc.id as string) || `call_${Date.now()}_${index}`,
                name: (fn?.name as string) || "",
                arguments: "",
              });

              const entry = pendingToolCalls.get(index)!;
              onEvent?.({
                type: "tool_call_start",
                id: entry.id,
                name: entry.name,
                arguments: "",
              });
            }

            const entry = pendingToolCalls.get(index)!;
            if (tc.id) entry.id = tc.id as string;
            const fn = tc.function as Record<string, unknown> | undefined;
            if (fn?.name) entry.name = fn.name as string;
            if (fn?.arguments) {
              entry.arguments += fn.arguments as string;
              onEvent?.({ type: "tool_call_delta", id: entry.id, delta: fn.arguments as string });
            }
          }
        }

        if (parsed.usage) {
          const u = parsed.usage as Record<string, number>;
          usage = {
            promptTokens: u.prompt_tokens ?? 0,
            completionTokens: u.completion_tokens ?? 0,
            totalTokens: u.total_tokens ?? 0,
          };
          onEvent?.({ type: "usage", usage });
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

  for (const [index, pending] of pendingToolCalls) {
    try {
      const args = JSON.parse(pending.arguments) as Record<string, unknown>;
      const tc: ToolCall = { id: pending.id, name: pending.name, arguments: args };
      collectedToolCalls.push(tc);
      onEvent?.({
        type: "tool_call_end",
        id: tc.id,
        name: tc.name,
        arguments: pending.arguments,
      });
    } catch {
      const tc: ToolCall = { id: pending.id, name: pending.name, arguments: { raw: pending.arguments } };
      collectedToolCalls.push(tc);
      onEvent?.({
        type: "tool_call_end",
        id: tc.id,
        name: tc.name,
        arguments: pending.arguments,
      });
    }
  }

  const message: Message = {
    role: "assistant",
    content: accumulatedContent,
    toolCalls: collectedToolCalls.length > 0 ? collectedToolCalls : undefined,
  };

  onEvent?.({ type: "message_complete", message, usage });

  return { message, usage };
}

export const OPENAI_MODELS = [
  "gpt-4o",
  "gpt-4o-mini",
  "gpt-4-turbo",
  "gpt-4",
  "gpt-3.5-turbo",
  "o1",
  "o1-mini",
  "o3-mini",
] as const;
