import { spawn, ChildProcess } from "node:child_process";
import * as readline from "node:readline";
import { MCPConfig, MCPTool, MCPCallResult, MCPConnection } from "./types.js";

interface JSONRPCRequest {
  jsonrpc: "2.0";
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

interface JSONRPCResponse {
  jsonrpc: "2.0";
  id: string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface JSONRPCNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

type JSONRPCMessage = JSONRPCRequest | JSONRPCResponse | JSONRPCNotification;

export class MCPClient {
  private process: ChildProcess | null = null;
  private rl: readline.Interface | null = null;
  private pendingRequests = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private tools: MCPTool[] = [];
  private connected = false;
  private requestCounter = 0;

  async connect(config: MCPConfig): Promise<MCPConnection> {
    if (config.transport === "sse" || config.transport === undefined) {
      if (config.transport === "sse") {
        return this.connectSSE(config);
      }
    }

    return this.connectStdio(config);
  }

  private async connectStdio(config: MCPConfig): Promise<MCPConnection> {
    const env = { ...process.env, ...config.env } as Record<string, string>;

    this.process = spawn(config.serverCommand, config.serverArgs || [], {
      env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32",
    });

    this.rl = readline.createInterface({
      input: this.process.stdout!,
      crlfDelay: Infinity,
    });

    this.rl.on("line", (line: string) => {
      try {
        const message = JSON.parse(line.trim()) as JSONRPCMessage;
        this.handleMessage(message);
      } catch {
        // Non-JSON output, ignore
      }
    });

    this.process.stderr?.on("data", (data: Buffer) => {
      const text = data.toString().trim();
      if (text) {
        console.error(`[MCP:${config.serverCommand}] ${text}`);
      }
    });

    this.process.on("exit", (code) => {
      this.connected = false;
      for (const [, pending] of this.pendingRequests) {
        pending.reject(new Error(`MCP server exited with code ${code}`));
      }
      this.pendingRequests.clear();
    });

    this.connected = true;

    const toolsResult = await this.listTools();
    this.tools = toolsResult;

    return {
      config,
      tools: this.tools,
      connected: true,
      connectedAt: Date.now(),
    };
  }

  private async connectSSE(config: MCPConfig): Promise<MCPConnection> {
    const sseUrl = config.sseUrl || "http://localhost:3000/sse";

    const response = await fetch(sseUrl);
    if (!response.ok) {
      throw new Error(`SSE connection failed: ${response.status}`);
    }

    this.connected = true;

    if (!response.body) throw new Error("SSE response body is null");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const readLoop = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const lines = part.split("\n");
          let data = "";
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              data = line.slice(6);
            }
          }
          if (data) {
            try {
              const message = JSON.parse(data) as JSONRPCMessage;
              this.handleMessage(message);
            } catch {
              // Ignore parse errors
            }
          }
        }
      }
    };

    readLoop().catch(() => {});

    const toolsResult = await this.listTools();
    this.tools = toolsResult;

    return {
      config,
      tools: this.tools,
      connected: true,
      connectedAt: Date.now(),
    };
  }

  private handleMessage(message: JSONRPCMessage): void {
    if ("id" in message && "result" in message) {
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        pending.resolve(message.result);
        this.pendingRequests.delete(message.id);
      }
    } else if ("id" in message && "error" in message) {
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        pending.reject(new Error(message.error?.message || "MCP error"));
        this.pendingRequests.delete(message.id);
      }
    }
  }

  private async sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.connected) {
      throw new Error("MCP client is not connected");
    }

    const id = `req_${++this.requestCounter}_${Date.now()}`;
    const request: JSONRPCRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`MCP request "${method}" timed out`));
      }, 30000);

      const originalResolve = resolve;
      this.pendingRequests.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          originalResolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });

      const line = JSON.stringify(request) + "\n";
      this.process?.stdin?.write(line);
    });
  }

  async listTools(): Promise<MCPTool[]> {
    const result = await this.sendRequest("tools/list");
    const typedResult = result as { tools?: MCPTool[] } | undefined;
    this.tools = typedResult?.tools || [];
    return this.tools;
  }

  async callTool(name: string, args?: Record<string, unknown>): Promise<MCPCallResult> {
    const startTime = Date.now();

    try {
      const result = await this.sendRequest("tools/call", {
        name,
        arguments: args || {},
      });

      const typedResult = result as { content?: Array<{ type: string; text?: string }> } | undefined;
      const content = typedResult?.content;

      return {
        success: true,
        result: content || result,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        result: null,
        error: (error as Error).message,
        duration: Date.now() - startTime,
      };
    }
  }

  async getTools(): Promise<MCPTool[]> {
    if (this.tools.length === 0 && this.connected) {
      await this.listTools();
    }
    return this.tools;
  }

  disconnect(): void {
    this.connected = false;
    this.rl?.close();
    this.process?.stdin?.end();
    this.process?.kill();

    for (const [, pending] of this.pendingRequests) {
      pending.reject(new Error("MCP client disconnected"));
    }
    this.pendingRequests.clear();
    this.tools = [];
  }

  isConnected(): boolean {
    return this.connected;
  }
}

export function createMCPClient(): MCPClient {
  return new MCPClient();
}
