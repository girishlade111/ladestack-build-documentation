import { z } from "zod";
import { ToolDefinition, ToolResult, ToolConfig, DefaultToolConfig } from "./types.js";

class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  registerTool(definition: ToolDefinition): void {
    if (this.tools.has(definition.name)) {
      throw new Error(`Tool "${definition.name}" is already registered`);
    }
    this.tools.set(definition.name, definition);
  }

  getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  getAllTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  removeTool(name: string): boolean {
    return this.tools.delete(name);
  }

  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  async executeTool(
    name: string,
    args: Record<string, unknown>,
    config?: Partial<ToolConfig>
  ): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        id: `error_${Date.now()}`,
        name,
        result: null,
        duration: 0,
        error: `Unknown tool: ${name}`,
      };
    }

    const mergedConfig: ToolConfig = { ...DefaultToolConfig, ...config };
    const startTime = Date.now();

    const parseResult = tool.parameters.safeParse(args);
    if (!parseResult.success) {
      return {
        id: `error_${Date.now()}`,
        name,
        result: null,
        duration: 0,
        error: `Invalid parameters for ${name}: ${parseResult.error.message}`,
      };
    }

    let lastError: Error | undefined;

    for (let attempt = 0; attempt < mergedConfig.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), mergedConfig.timeout);

        const result = await tool.execute(parseResult.data);

        clearTimeout(timeoutId);

        const duration = Date.now() - startTime;
        return {
          id: `tool_${Date.now()}_${name}`,
          name,
          result,
          duration,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < mergedConfig.maxRetries - 1) {
          await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
        }
      }
    }

    const duration = Date.now() - startTime;
    return {
      id: `error_${Date.now()}_${name}`,
      name,
      result: null,
      duration,
      error: lastError?.message ?? "Unknown error",
    };
  }

  clear(): void {
    this.tools.clear();
  }
}

export const toolRegistry = new ToolRegistry();
export { ToolRegistry };
