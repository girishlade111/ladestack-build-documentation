import { z } from "zod";

export type MCPTransport = "stdio" | "sse";

export interface MCPConfig {
  serverCommand: string;
  serverArgs?: string[];
  env?: Record<string, string>;
  transport?: MCPTransport;
  sseUrl?: string;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface MCPConnection {
  config: MCPConfig;
  tools: MCPTool[];
  connected: boolean;
  connectedAt?: number;
}

export interface MCPCallResult {
  success: boolean;
  result: unknown;
  error?: string;
  duration: number;
}

export const MCPConfigSchema = z.object({
  serverCommand: z.string().min(1),
  serverArgs: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  transport: z.enum(["stdio", "sse"]).optional().default("stdio"),
  sseUrl: z.string().url().optional(),
});
