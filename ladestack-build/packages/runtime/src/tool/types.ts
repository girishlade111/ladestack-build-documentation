import { z } from "zod";

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: z.ZodObject<z.ZodRawShape>;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
  requiresApproval?: boolean;
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

export interface ToolConfig {
  timeout: number;
  maxRetries: number;
}

export const DefaultToolConfig: ToolConfig = {
  timeout: 30000,
  maxRetries: 3,
};
