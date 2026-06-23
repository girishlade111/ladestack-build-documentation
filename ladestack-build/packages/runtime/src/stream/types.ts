import { TokenUsage, Message } from "../provider/types.js";
import { ToolCall, ToolResult } from "../tool/types.js";

export type StreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_call_start"; id: string; name: string; arguments: string }
  | { type: "tool_call_delta"; id: string; delta: string }
  | { type: "tool_call_end"; id: string; name: string; arguments: string; result?: ToolResult }
  | { type: "message_start"; message: Message }
  | { type: "message_complete"; message: Message; usage: TokenUsage }
  | { type: "error"; error: string; code?: string }
  | { type: "usage"; usage: TokenUsage }
  | { type: "agent_switch"; from: string; to: string; reason: string }
  | { type: "step_start"; step: number; maxSteps: number; agentId: string }
  | { type: "step_complete"; step: number; agentId: string; toolCalls: number }
  | { type: "tool_execution_start"; toolCall: ToolCall }
  | { type: "tool_execution_complete"; toolResult: ToolResult };

export function createSSEEncoder(): {
  encode: (event: StreamEvent) => string;
  encodeBatch: (events: StreamEvent[]) => string;
} {
  function encode(event: StreamEvent): string {
    const data = JSON.stringify(event);
    return `event: ${event.type}\ndata: ${data}\n\n`;
  }

  function encodeBatch(events: StreamEvent[]): string {
    return events.map(encode).join("");
  }

  return { encode, encodeBatch };
}

export function createSSEDecoder(): {
  decode: (raw: string) => StreamEvent[];
  decodeLine: (line: string) => StreamEvent | null;
} {
  function decode(raw: string): StreamEvent[] {
    const events: StreamEvent[] = [];
    const lines = raw.split("\n");
    let currentData = "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        currentData = line.slice(6);
      } else if (line === "" && currentData) {
        try {
          const parsed = JSON.parse(currentData) as StreamEvent;
          events.push(parsed);
        } catch {
          events.push({ type: "error", error: `Failed to parse SSE data: ${currentData}` });
        }
        currentData = "";
      }
    }

    if (currentData) {
      try {
        const parsed = JSON.parse(currentData) as StreamEvent;
        events.push(parsed);
      } catch {
        events.push({ type: "error", error: `Failed to parse SSE data: ${currentData}` });
      }
    }

    return events;
  }

  function decodeLine(line: string): StreamEvent | null {
    if (line.startsWith("data: ")) {
      const data = line.slice(6);
      try {
        return JSON.parse(data) as StreamEvent;
      } catch {
        return { type: "error", error: `Failed to parse SSE data: ${data}` };
      }
    }
    return null;
  }

  return { decode, decodeLine };
}
