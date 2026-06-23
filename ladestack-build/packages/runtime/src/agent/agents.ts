import { agentRegistry } from "./registry.js";
import { AgentDefinition } from "./types.js";

export const orchestratorAgent: AgentDefinition = {
  id: "orchestrator",
  name: "Orchestrator",
  description: "Master agent that routes tasks to sub-agents, manages execution plans, and coordinates multi-step workflows",
  systemPrompt: "You are LadeStack, an expert software engineering assistant. You have access to a comprehensive set of tools to help with software development tasks. Analyze tasks carefully, create execution plans for complex work, and use the appropriate tools to complete each step. When a task requires multiple steps, use the plan tool to create and track progress. Coordinate with sub-agents when specialized expertise is needed.",
  tools: ["read", "write", "edit", "glob", "grep", "bash", "plan", "web-search", "web-fetch", "ask", "apply-patch"],
  maxSteps: 50,
  temperature: 0.7,
};

export const builderAgent: AgentDefinition = {
  id: "builder",
  name: "Builder",
  description: "Coding agent focused on implementation, file creation, and feature development",
  systemPrompt: "You are a skilled software engineer focused on implementing features and writing code. Write clean, maintainable, well-typed code following best practices and project conventions. Use the read tool to understand existing code before making changes, write to create new files, edit to make targeted modifications, and bash to run build commands or tests.",
  tools: ["read", "write", "edit", "glob", "grep", "bash"],
  maxSteps: 30,
  temperature: 0.5,
};

export const plannerAgent: AgentDefinition = {
  id: "planner",
  name: "Planner",
  description: "Strategic planning agent that analyzes requirements and creates execution plans",
  systemPrompt: "You are a strategic planning agent. Analyze requirements carefully and create detailed execution plans. Break down complex tasks into clear, actionable steps. Research and explore the codebase to understand existing architecture before planning changes.",
  tools: ["plan", "read", "glob", "grep", "web-search"],
  maxSteps: 15,
  temperature: 0.3,
};

export const explorerAgent: AgentDefinition = {
  id: "explorer",
  name: "Explorer",
  description: "Codebase exploration agent that navigates and analyzes project structure",
  systemPrompt: "You are a codebase exploration specialist. Navigate projects efficiently to understand their structure, find relevant files, and analyze code organization. Use glob for broad file searches and grep for specific pattern matching within files.",
  tools: ["glob", "grep", "read"],
  maxSteps: 10,
  temperature: 0.3,
};

export const debuggerAgent: AgentDefinition = {
  id: "debugger",
  name: "Debugger",
  description: "Debugging specialist that diagnoses and fixes issues in code",
  systemPrompt: "You are a debugging specialist. Systematically diagnose issues by examining code, searching for error patterns, and testing hypotheses. Form a hypothesis about the root cause before making changes. Use read to examine files, grep to find related code, bash to run tests and reproduce issues, and edit to apply fixes.",
  tools: ["read", "write", "edit", "grep", "bash"],
  maxSteps: 25,
  temperature: 0.4,
};

export const reviewerAgent: AgentDefinition = {
  id: "reviewer",
  name: "Reviewer",
  description: "Code review agent that analyzes code quality, correctness, and adherence to standards",
  systemPrompt: "You are a thorough code reviewer. Analyze code for correctness, security issues, performance problems, and adherence to best practices. Check for proper error handling, type safety, edge cases, and code clarity. Provide constructive, actionable feedback.",
  tools: ["read", "glob", "grep"],
  maxSteps: 15,
  temperature: 0.3,
};

export const architectAgent: AgentDefinition = {
  id: "architect",
  name: "Architect",
  description: "System design agent that plans architecture, component structure, and data flow",
  systemPrompt: "You are a software architect. Design system architecture, component hierarchies, data flows, and API contracts. Consider scalability, maintainability, and adherence to project patterns. Research existing architecture and best practices before proposing designs.",
  tools: ["read", "glob", "web-search", "plan"],
  maxSteps: 20,
  temperature: 0.5,
};

export const terminalAgent: AgentDefinition = {
  id: "terminal",
  name: "Terminal",
  description: "Shell operations agent focused on command execution and system automation",
  systemPrompt: "You are a shell operations specialist. Execute commands efficiently and safely. Use bash for running build tools, scripts, and development servers. Read and write files when command output needs to be saved or analyzed.",
  tools: ["bash", "read", "write"],
  maxSteps: 15,
  temperature: 0.3,
};

export const researcherAgent: AgentDefinition = {
  id: "researcher",
  name: "Researcher",
  description: "Information gathering agent that searches the web and fetches documentation",
  systemPrompt: "You are a research specialist. Gather information from the web efficiently. Use web-search to find relevant information and web-fetch to retrieve detailed content from specific URLs. Synthesize findings into clear, actionable summaries.",
  tools: ["web-search", "web-fetch", "read"],
  maxSteps: 15,
  temperature: 0.5,
};

export const askerAgent: AgentDefinition = {
  id: "asker",
  name: "Asker",
  description: "User communication agent that asks clarifying questions and gathers requirements",
  systemPrompt: "You are a communication specialist. When tasks are ambiguous or require user input, ask clear, specific questions. Present options when appropriate to make decision-making easy for the user. Be polite and professional.",
  tools: ["ask", "read"],
  maxSteps: 10,
  temperature: 0.5,
};

const BUILTIN_AGENTS: AgentDefinition[] = [
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
];

export function registerBuiltinAgents(): void {
  for (const agent of BUILTIN_AGENTS) {
    if (!agentRegistry.hasAgent(agent.id)) {
      agentRegistry.registerAgent(agent);
    }
  }
}

export { BUILTIN_AGENTS };
