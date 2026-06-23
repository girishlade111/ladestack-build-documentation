import { z } from "zod";

export type LLMProvider = "anthropic" | "openai" | "google" | "groq" | "mistral" | "custom";

export interface LLMConfig {
  provider: LLMProvider;
  model: string;
  apiKey: string;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  id: string;
  name: string;
  result: unknown;
  duration: number;
  error?: string;
}

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}

export type StreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_call_start"; id: string; name: string; arguments: string }
  | { type: "tool_call_delta"; id: string; delta: string }
  | { type: "tool_call_end"; id: string; name: string; arguments: string }
  | { type: "message_start"; message: Message }
  | { type: "message_complete"; message: Message; usage: TokenUsage }
  | { type: "error"; error: string; code?: string }
  | { type: "usage"; usage: TokenUsage };

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface CompletionResult {
  message: Message;
  usage: TokenUsage;
}

export interface ProviderHandler {
  complete(messages: Message[], config: LLMConfig, onEvent?: (event: StreamEvent) => void): Promise<CompletionResult>;
}

export const LLMConfigSchema = z.object({
  provider: z.enum(["anthropic", "openai", "google", "groq", "mistral", "custom"]),
  model: z.string(),
  apiKey: z.string(),
  baseUrl: z.string().optional(),
  maxTokens: z.number().int().positive().optional().default(4096),
  temperature: z.number().min(0).max(2).optional().default(0.7),
  topP: z.number().min(0).max(1).optional().default(1),
});
