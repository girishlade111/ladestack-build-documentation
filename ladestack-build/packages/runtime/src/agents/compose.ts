import { execSync } from "node:child_process";
import { loadPrompt } from "./loader.js";

export interface EnvironmentContext {
  cwd: string;
  platform?: string;
  runtime?: string;
  date?: string;
  projectName?: string;
  projectType?: string;
  sandbox?: string;
  network?: string;
  defaultMode?: string;
  modelId?: string;
  sessionId?: string;
}

const AGENT_PROMPT_MAP: Record<string, string> = {
  builder: "build",
  planner: "plan",
  explorer: "explore",
  researcher: "scout",
  summarizer: "summarize",
  title: "title",
};

function getAgentPromptFile(agentId: string): string {
  return AGENT_PROMPT_MAP[agentId] ?? agentId;
}

export function composeSystemPrompt(
  agentId: string,
  options?: {
    environment?: EnvironmentContext;
  }
): string {
  const parts: string[] = [];

  parts.push(loadPrompt("soul"));

  const agentFile = getAgentPromptFile(agentId);
  try {
    const agentPrompt = loadPrompt(agentFile);
    parts.push(agentPrompt);
  } catch {
    // no agent-specific prompt found, skip
  }

  if (options?.environment) {
    parts.push(renderEnvironment(options.environment));
  }

  parts.push(loadPrompt("tools"));

  return parts.join("\n\n---\n\n");
}

export function renderEnvironment(ctx: EnvironmentContext): string {
  const template = loadPrompt("environment");
  const date = ctx.date ?? new Date().toISOString().split("T")[0];
  const platform = ctx.platform ?? `${process.platform} ${process.arch}`;
  const runtime = ctx.runtime ?? `Node.js ${process.version}`;
  const projectName = ctx.projectName ?? "LadeStack Build";
  const projectType = ctx.projectType ?? "Next.js 14 (App Router) + TypeScript + Tailwind + shadcn/ui";
  const sandbox = ctx.sandbox ?? "ephemeral Linux container (1 CPU, 512MB RAM, 5GB disk)";
  const network = ctx.network ?? "outbound allowed (npm registry, LLM APIs, GitHub API)";

  return template
    .replace("{{platform}}", platform)
    .replace("{{runtime}}", runtime)
    .replace("{{date}}", date)
    .replace("{{projectName}}", projectName)
    .replace("{{projectType}}", projectType)
    .replace("{{cwd}}", ctx.cwd)
    .replace("{{sandbox}}", sandbox)
    .replace("{{network}}", network)
    .replace("{{defaultMode}}", ctx.defaultMode ?? "build")
    .replace("{{modelId}}", ctx.modelId ?? "claude-sonnet-4-20250514")
    .replace("{{sessionId}}", ctx.sessionId ?? "unknown");
}

export function captureEnvironment(): EnvironmentContext {
  let gitStatus = "unknown";
  try {
    gitStatus = execSync("git status --short 2>/dev/null || echo clean", {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
    if (!gitStatus) gitStatus = "clean";
  } catch {
    gitStatus = "clean";
  }

  return {
    cwd: process.cwd(),
    platform: `${process.platform} ${process.arch}`,
    runtime: `Node.js ${process.version}`,
    date: new Date().toISOString().split("T")[0],
    projectName: "LadeStack Build",
    projectType: "Next.js 14 (App Router) + TypeScript + Tailwind + shadcn/ui",
    sandbox: "ephemeral Linux container (1 CPU, 512MB RAM, 5GB disk)",
    network: "outbound allowed (npm registry, LLM APIs, GitHub API)",
    defaultMode: "build",
    modelId: "claude-sonnet-4-20250514",
    sessionId: "unknown",
  };
}
