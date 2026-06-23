import { execSync } from "node:child_process";
import { loadPrompt } from "./loader.js";

export interface EnvironmentContext {
  cwd: string;
  shell: string;
  gitStatus: string;
  platform?: string;
  runtime?: string;
  date?: string;
  projectName?: string;
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
    tools?: string[];
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

  if (options?.tools && options.tools.length > 0) {
    parts.push(renderToolList(options.tools));
  }

  return parts.join("\n\n---\n\n");
}

export function renderEnvironment(ctx: EnvironmentContext): string {
  const template = loadPrompt("environment");
  const date = ctx.date ?? new Date().toISOString().split("T")[0];
  const platform = ctx.platform ?? (process.platform === "win32" ? "win32" : process.platform);
  const runtime = ctx.runtime ?? `Node.js ${process.version}`;
  const projectName = ctx.projectName ?? "LadeStack Build";

  return template
    .replace("{{platform}}", platform)
    .replace("{{runtime}}", runtime)
    .replace("{{date}}", date)
    .replace("{{projectName}}", projectName)
    .replace("{{cwd}}", ctx.cwd)
    .replace("{{shell}}", ctx.shell)
    .replace("{{gitStatus}}", ctx.gitStatus);
}

function renderToolList(tools: string[]): string {
  const template = loadPrompt("tools");
  const toolList = tools
    .map((t) => `- \`${t}\``)
    .join("\n");
  return template.replace("{{toolList}}", toolList);
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
    shell: process.platform === "win32" ? "powershell" : "bash",
    gitStatus,
    platform: process.platform,
    runtime: `Node.js ${process.version}`,
    date: new Date().toISOString().split("T")[0],
    projectName: "LadeStack Build",
  };
}
