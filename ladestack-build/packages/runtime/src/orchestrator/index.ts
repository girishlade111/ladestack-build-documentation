import { LLMConfig, Message, TokenUsage, ToolCall, ToolResult, ProviderHandler } from "../provider/types.js";
import type { StreamEvent } from "../stream/types.js";
import { providerRegistry, ProviderRegistry } from "../provider/registry.js";
import { toolRegistry, ToolRegistry } from "../tool/registry.js";
import { ToolDefinition, ToolConfig } from "../tool/types.js";
import { agentRegistry, AgentRegistry } from "../agent/registry.js";
import { AgentDefinition } from "../agent/types.js";
import { registerBuiltinAgents } from "../agent/agents.js";
import { registerAllTools } from "../tool/tools/index.js";
import { getSystemPrompt } from "./prompts.js";

export interface OrchestratorConfig {
  providerConfig: LLMConfig;
  maxSteps?: number;
  defaultAgentId?: string;
  toolConfig?: Partial<ToolConfig>;
  providers?: ProviderRegistry;
  tools?: ToolRegistry;
  agents?: AgentRegistry;
}

export interface OrchestratorState {
  currentAgentId: string;
  step: number;
  totalSteps: number;
  messages: Message[];
  plan: string | null;
  usage: TokenUsage;
  startTime: number;
}

export class AgentOrchestrator {
  private providerConfig: LLMConfig;
  private maxSteps: number;
  private defaultAgentId: string;
  private toolConfig: Partial<ToolConfig>;
  private providers: ProviderRegistry;
  private tools: ToolRegistry;
  private agents: AgentRegistry;

  constructor(config: OrchestratorConfig) {
    this.providerConfig = config.providerConfig;
    this.maxSteps = config.maxSteps ?? 25;
    this.defaultAgentId = config.defaultAgentId ?? "orchestrator";
    this.toolConfig = config.toolConfig ?? {};
    this.providers = config.providers ?? providerRegistry;
    this.tools = config.tools ?? toolRegistry;
    this.agents = config.agents ?? agentRegistry;

    registerBuiltinAgents();
  }

  private async* executeStep(
    messages: Message[],
    agent: AgentDefinition,
    onEvent?: (event: StreamEvent) => void
  ): AsyncGenerator<StreamEvent> {
    const agentTools = this.getAgentTools(agent);
    const systemPrompt = agent.systemPrompt || getSystemPrompt(agent.id);

    const systemMessage: Message = {
      role: "system",
      content: systemPrompt,
    };

    if (agentTools.length > 0) {
      const toolsJson = JSON.stringify(
        agentTools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters,
        }))
      );
      systemMessage.content += `\n\nAvailable tools:\n${toolsJson}`;
    }

    const fullMessages = [systemMessage, ...messages];

    const result = await this.providers.executeCompletion(
      this.providerConfig.provider,
      fullMessages,
      this.providerConfig,
      onEvent
    );

    yield {
      type: "message_complete",
      message: result.message,
      usage: result.usage,
    };

    if (result.message.toolCalls && result.message.toolCalls.length > 0) {
      yield {
        type: "step_complete",
        step: 0,
        agentId: agent.id,
        toolCalls: result.message.toolCalls.length,
      };

      const toolResults: ToolResult[] = [];

      for (const tc of result.message.toolCalls) {
        yield { type: "tool_execution_start", toolCall: tc };

        const toolResult = await this.tools.executeTool(tc.name, tc.arguments, this.toolConfig);
        toolResults.push(toolResult);

        yield { type: "tool_execution_complete", toolResult };
      }

      const toolResultMessage: Message = {
        role: "user",
        content: "",
        toolResults,
      };

      const nextMessages = [...messages, result.message, toolResultMessage];

      yield* this.executeStep(nextMessages, agent, onEvent);
    }
  }

  async* execute(
    messages: Message[],
    agentId?: string,
    onEvent?: (event: StreamEvent) => void
  ): AsyncGenerator<StreamEvent> {
    const startTime = Date.now();
    const agent = this.agents.getAgent(agentId ?? this.defaultAgentId);
    if (!agent) {
      yield { type: "error", error: `Unknown agent: ${agentId ?? this.defaultAgentId}` };
      return;
    }

    const usage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    for (let step = 0; step < this.maxSteps; step++) {
      yield { type: "step_start", step, maxSteps: this.maxSteps, agentId: agent.id };

      try {
        let stepsYielded = false;
        for await (const event of this.executeStep(messages, agent, onEvent)) {
          yield event;
          stepsYielded = true;

          if (event.type === "message_complete") {
            usage.promptTokens += event.usage.promptTokens;
            usage.completionTokens += event.usage.completionTokens;
            usage.totalTokens += event.usage.totalTokens;

            if (!event.message.toolCalls || event.message.toolCalls.length === 0) {
              yield { type: "usage", usage };
              const totalTime = Date.now() - startTime;
              return;
            }

            messages.push(event.message);
          }
        }

        if (!stepsYielded) break;
      } catch (error) {
        yield {
          type: "error",
          error: `Step ${step} failed: ${(error as Error).message}`,
        };
        break;
      }
    }

    yield { type: "usage", usage };
  }

  private getAgentTools(agent: AgentDefinition): ToolDefinition[] {
    return agent.tools
      .map((name) => this.tools.getTool(name))
      .filter((t): t is ToolDefinition => t !== undefined);
  }

  switchAgent(newAgentId: string, messages: Message[], reason?: string): { agent: AgentDefinition | undefined; messages: Message[] } {
    const agent = this.agents.getAgent(newAgentId);
    if (!agent) {
      return { agent: undefined, messages };
    }

    const switchMessage: Message = {
      role: "system",
      content: `[Agent switched from ${this.defaultAgentId} to ${newAgentId}${reason ? `: ${reason}` : ""}]`,
    };

    return {
      agent,
      messages: [...messages, switchMessage],
    };
  }

  getProviderConfig(): LLMConfig {
    return { ...this.providerConfig };
  }

  updateProviderConfig(config: Partial<LLMConfig>): void {
    this.providerConfig = { ...this.providerConfig, ...config };
  }
}

export function createOrchestrator(config: OrchestratorConfig): AgentOrchestrator {
  registerAllTools(toolRegistry);
  registerBuiltinAgents();
  return new AgentOrchestrator(config);
}
