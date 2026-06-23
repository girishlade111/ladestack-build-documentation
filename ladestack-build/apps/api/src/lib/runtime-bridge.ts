import type { LLMConfig, LLMProvider } from "@ladestack/runtime";

export interface BridgeStreamEvent {
  type: "chunk" | "tool-call" | "tool-result" | "preview" | "done" | "error";
  [key: string]: unknown;
}

export interface AgentRunnerConfig {
  apiKey?: string;
  provider?: LLMProvider;
  model?: string;
  maxSteps?: number;
  agentId?: string;
}

export async function executeWithStreaming(
  messages: { role: string; content: string }[],
  config: AgentRunnerConfig
): Promise<ReadableStream<Uint8Array>> {
  const { apiKey, provider, model, maxSteps, agentId } = config;

  let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;

  return new ReadableStream({
    start(controller) {
      streamController = controller;
      const encoder = new TextEncoder();

      const send = (event: BridgeStreamEvent) => {
        try {
          const line = `data: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(encoder.encode(line));
        } catch {
          // stream closed
        }
      };

      const run = async () => {
        try {
          const { AgentOrchestrator } = await import("@ladestack/runtime");

          const llmConfig: LLMConfig = {
            provider: provider ?? "anthropic",
            model: model ?? "claude-sonnet-4-20250514",
            apiKey: apiKey ?? "",
          };

          const orchestrator = new AgentOrchestrator({
            providerConfig: llmConfig,
            maxSteps: maxSteps ?? 20,
            defaultAgentId: agentId ?? "orchestrator",
          });

          let fullContent = "";

          function detectPreviewUrls(text: string) {
            const urlRegex = /(https?:\/\/[^\s"'<>\]\)]+)/g;
            const matches = text.match(urlRegex);
            if (matches) {
              for (const url of matches) {
                if (
                  url.includes("localhost") ||
                  url.includes("127.0.0.1") ||
                  url.includes("0.0.0.0")
                ) {
                  send({ type: "preview", url });
                }
              }
            }
          }

          for await (const event of orchestrator.execute(
            messages.map((m) => ({
              role: m.role as "user" | "assistant" | "system",
              content: m.content,
            })),
            agentId
          )) {
            if (event.type === "text_delta") {
              fullContent += event.text;
              send({ type: "chunk", content: event.text });
            } else if (event.type === "tool_call_start") {
              send({
                type: "tool-call",
                id: event.id,
                name: event.name,
                args: event.arguments,
              });
            } else if (event.type === "tool_call_end") {
              send({
                type: "tool-result",
                id: event.id,
                name: event.name,
                result: event.result,
                duration: event.result?.duration,
              });
              if (typeof event.result?.result === "string") {
                detectPreviewUrls(event.result.result);
              }
            } else if (event.type === "message_complete") {
              detectPreviewUrls(event.message.content);
            } else if (event.type === "error") {
              send({ type: "error", message: event.error });
            }
          }

          send({ type: "done" });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "error", message })}\n\n`));
          } catch {
            // stream closed
          }
        } finally {
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      };

      run();
    },
    cancel() {
      if (streamController) {
        try {
          streamController.close();
        } catch {
          // already closed
        }
      }
    },
  });
}
