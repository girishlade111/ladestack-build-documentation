// Provider Module
export type {
  LLMProvider,
  LLMConfig,
  Message,
  ToolCall,
  ToolResult,
  StreamEvent,
  TokenUsage,
  CompletionResult,
  ProviderHandler,
} from "./provider/types.js";
export { LLMConfigSchema } from "./provider/types.js";

export { anthropicCompletion, ANTHROPIC_MODELS } from "./provider/anthropic.js";
export { openaiCompletion, OPENAI_MODELS } from "./provider/openai.js";
export { googleCompletion, GOOGLE_MODELS } from "./provider/google.js";
export { providerRegistry, ProviderRegistry, type ProviderInfo } from "./provider/registry.js";

// Tool Module
export type {
  ToolDefinition,
  ToolConfig,
} from "./tool/types.js";
export { DefaultToolConfig } from "./tool/types.js";
export { toolRegistry, ToolRegistry } from "./tool/registry.js";
export { registerAllTools } from "./tool/tools/index.js";
export { readTool } from "./tool/tools/read.js";
export { writeTool } from "./tool/tools/write.js";
export { editTool } from "./tool/tools/edit.js";
export { globTool } from "./tool/tools/glob.js";
export { grepTool } from "./tool/tools/grep.js";
export { bashTool } from "./tool/tools/bash.js";
export { webSearchTool } from "./tool/tools/web-search.js";
export { webFetchTool } from "./tool/tools/web-fetch.js";
export { planTool } from "./tool/tools/plan.js";
export { askTool } from "./tool/tools/ask.js";
export { applyPatchTool } from "./tool/tools/apply-patch.js";

// Agent Module
export type { AgentDefinition, AgentManifest } from "./agent/types.js";
export { AgentDefinitionSchema, AgentManifestSchema } from "./agent/types.js";
export { agentRegistry, AgentRegistry } from "./agent/registry.js";
export { registerBuiltinAgents } from "./agent/agents.js";
export {
  orchestratorAgent,
  builderAgent,
  plannerAgent,
  explorerAgent,
  debuggerAgent,
  reviewerAgent,
  architectAgent,
  terminalAgent,
  researcherAgent,
  askerAgent,
  BUILTIN_AGENTS,
} from "./agent/agents.js";

// Orchestrator Module
export { AgentOrchestrator, createOrchestrator } from "./orchestrator/index.js";
export type { OrchestratorConfig, OrchestratorState } from "./orchestrator/index.js";
export { SYSTEM_PROMPTS, getSystemPrompt } from "./orchestrator/prompts.js";

// Stream Module
export { createSSEEncoder, createSSEDecoder } from "./stream/types.js";

// Skill Module
export type { SkillDefinition, BundleDefinition } from "./skill/types.js";
export { SkillDefinitionSchema, BundleDefinitionSchema } from "./skill/types.js";
export { skillRegistry, SkillRegistry } from "./skill/registry.js";

// Encryption Module
export { EncryptionService, encryptionService } from "./encryption/index.js";

// MCP Module
export type { MCPConfig, MCPTool, MCPConnection, MCPCallResult, MCPTransport } from "./mcp/types.js";
export { MCPConfigSchema } from "./mcp/types.js";
export { MCPClient, createMCPClient } from "./mcp/client.js";
