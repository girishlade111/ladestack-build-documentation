import type { LLMConfig, LLMProvider } from "@ladestack/runtime";

export interface BridgeStreamEvent {
  type:
    | "message_start"
    | "text_delta"
    | "tool_call_start"
    | "tool_call_delta"
    | "tool_call_end"
    | "message_complete"
    | "error";
  data: Record<string, unknown>;
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

      send({
        type: "message_start",
        data: { agentId: agentId ?? "default", timestamp: Date.now() },
      });

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

          for await (const event of orchestrator.execute(
            messages.map((m) => ({
              role: m.role as "user" | "assistant" | "system",
              content: m.content,
            })),
            agentId
          )) {
            if (event.type === "text_delta") {
              fullContent += event.text;
              send({
                type: "text_delta",
                data: { delta: event.text, agentId: agentId ?? "default" },
              });
            } else if (event.type === "tool_call_start") {
              send({
                type: "tool_call_start",
                data: {
                  toolName: event.name,
                  input: event.arguments,
                  toolCallId: event.id,
                },
              });
            } else if (event.type === "tool_call_delta") {
              send({
                type: "tool_call_delta",
                data: { delta: event.delta, toolCallId: event.id },
              });
            } else if (event.type === "tool_call_end") {
              send({
                type: "tool_call_end",
                data: {
                  toolName: event.name,
                  output: event.result,
                  toolCallId: event.id,
                },
              });
            } else if (event.type === "message_complete") {
              send({
                type: "message_complete",
                data: {
                  content: event.message.content,
                  agentId: agentId ?? "default",
                  timestamp: Date.now(),
                },
              });
            } else if (event.type === "error") {
              send({
                type: "error",
                data: { error: event.error },
              });
            }
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          try {
            const errorEvent: BridgeStreamEvent = {
              type: "error",
              data: { error: message },
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorEvent)}\n\n`));
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
