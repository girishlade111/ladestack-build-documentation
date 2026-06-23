import { LLMConfig, Message, CompletionResult, StreamEvent, TokenUsage, ToolCall } from "./types.js";

function buildContents(messages: Message[]): Record<string, unknown>[] {
  const contents: Record<string, unknown>[] = [];

  for (const msg of messages) {
    if (msg.role === "system") continue;

    const parts: Record<string, unknown>[] = [];

    if (msg.content) {
      parts.push({ text: msg.content });
    }

    if (msg.toolResults && msg.toolResults.length > 0) {
      for (const tr of msg.toolResults) {
        parts.push({
          functionResponse: {
            name: tr.name,
            response: {
              name: tr.name,
              content: typeof tr.result === "string" ? tr.result : JSON.stringify(tr.result),
            },
          },
        });
      }
    }

    if (msg.toolCalls && msg.toolCalls.length > 0) {
      for (const tc of msg.toolCalls) {
        parts.push({
          functionCall: {
            name: tc.name,
            args: tc.arguments,
          },
        });
      }
    }

    contents.push({
      role: msg.role === "assistant" ? "model" : "user",
      parts,
    });
  }

  return contents;
}

export async function googleCompletion(
  messages: Message[],
  config: LLMConfig,
  onEvent?: (event: StreamEvent) => void
): Promise<CompletionResult> {
  const model = config.model.startsWith("models/") ? config.model : `models/${config.model}`;
  const baseUrl = config.baseUrl || "https://generativelanguage.googleapis.com";
  const url = `${baseUrl}/v1beta/${model}:streamGenerateContent?alt=sse&key=${config.apiKey}`;

  const systemInstruction = messages.find((m) => m.role === "system");
  const contents = buildContents(messages);

  const requestBody: Record<string, unknown> = {
    contents,
    generationConfig: {
      maxOutputTokens: config.maxTokens ?? 4096,
      temperature: config.temperature ?? 0.7,
      topP: config.topP ?? 1,
    },
  };

  if (systemInstruction) {
    requestBody.systemInstruction = {
      parts: [{ text: systemInstruction.content }],
    };
  }

  let accumulatedContent = "";
  let collectedToolCalls: ToolCall[] = [];
  let usage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Google API error ${response.status}: ${errorText}`);
  }

  if (!response.body) throw new Error("Response body is null");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;

        const data = trimmed.slice(6);
        if (data === "[DONE]") continue;

        try {
          const parsed = JSON.parse(data) as Record<string, unknown>;
          const candidates = parsed.candidates as Array<Record<string, unknown>> | undefined;
          if (!candidates || candidates.length === 0) continue;

          const content = (candidates[0]?.content ?? undefined) as Record<string, unknown> | undefined;
          if (!content) continue;

          const parts = content.parts as Array<Record<string, unknown>> | undefined;
          if (!parts) continue;

          for (const part of parts) {
            if (part.text) {
              const text = part.text as string;
              accumulatedContent += text;
              onEvent?.({ type: "text_delta", text });
            }

            if (part.functionCall) {
              const fc = part.functionCall as Record<string, unknown>;
              const tc: ToolCall = {
                id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                name: fc.name as string,
                arguments: (fc.args as Record<string, unknown>) ?? {},
              };
              collectedToolCalls.push(tc);
              onEvent?.({
                type: "tool_call_start",
                id: tc.id,
                name: tc.name,
                arguments: JSON.stringify(tc.arguments),
              });
              onEvent?.({
                type: "tool_call_end",
                id: tc.id,
                name: tc.name,
                arguments: JSON.stringify(tc.arguments),
              });
            }
          }

          if (parsed.usageMetadata) {
            const u = parsed.usageMetadata as Record<string, number>;
            usage = {
              promptTokens: u.promptTokenCount ?? 0,
              completionTokens: u.candidatesTokenCount ?? 0,
              totalTokens: u.totalTokenCount ?? 0,
            };
            onEvent?.({ type: "usage", usage });
          }
        } catch (e) {
          onEvent?.({ type: "error", error: `Parse error: ${(e as Error).message}` });
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  const message: Message = {
    role: "assistant",
    content: accumulatedContent,
    toolCalls: collectedToolCalls.length > 0 ? collectedToolCalls : undefined,
  };

  onEvent?.({ type: "message_complete", message, usage });

  return { message, usage };
}

export const GOOGLE_MODELS = [
  "gemini-2.5-pro-exp-03-25",
  "gemini-2.5-flash-preview-04-17",
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-1.5-pro",
  "gemini-1.5-flash",
  "gemini-1.5-flash-8b",
] as const;
