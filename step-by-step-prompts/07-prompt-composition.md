# Prompt 07: Prompt Composition Engine

## Goal

Build the prompt composition engine that assembles the final system prompt for the LLM from soul + agent-specific + environment + tools + skills components. This is what makes the AI behave consistently.

## Context (from prompts 01-06)

- Monorepo, Next.js, Hono, Supabase, Daytona, provider layer all built.
- System prompts exist in `../prompt.md` (reference, not source of truth yet — we'll write them in prompt 14).

Reference: `../agent-loop.md` §3 (prompt composition), `../design.md` §6 (Anthropic prompt caching).

## Task

### Step 1: Create the prompts directory

```bash
mkdir -p packages/runtime/src/agents/prompts
```

### Step 2: Define prompt section types

`packages/runtime/src/agents/types.ts`:

```ts
import { z } from "zod"
import type { ModelRef, ToolDefinition } from "../providers/types.js"

export interface AgentInfo {
  name: string                       // kebab-case: "build", "plan"
  displayName: string                // "Build", "Plan"
  description: string                 // for UI + auto-selection
  mode: "primary" | "subagent" | "all"
  hidden?: boolean
  promptPath?: string                // path to .txt file (relative to prompts/)
  tools?: Record<string, boolean>    // override default tool permissions
  model?: ModelRef                   // default model for this agent
  temperature?: number
  steps?: number                     // max steps per turn (default 25)
  color?: string                     // UI accent
}

export interface BuiltPrompt {
  system: string
  tools: ToolDefinition[]
  maxTokens?: number
  temperature?: number
  model?: ModelRef
  cacheableSections: string[]        // for Anthropic prompt caching
}

export interface PromptContext {
  agent: AgentInfo
  userId: string
  projectId: string
  sessionId: string
  env: {
    platform: string
    nodeVersion: string
    today: string
    projectName: string
    projectType: string
    workingDirectory: string
    defaultMode: "plan" | "build"
    defaultModel: ModelRef
  }
  skills: Array<{ name: string; description: string }>
}
```

### Step 3: Create placeholder prompt files

We'll fill these with real content in prompt 14. For now, stub them:

`packages/runtime/src/agents/prompts/soul.txt`:
```
You are Lade, the LadeStack Build AI agent — a senior full-stack engineer.
You are direct, technical, and concise. No fluff, no filler.
(Full content will be added in prompt 14.)
```

`packages/runtime/src/agents/prompts/build.txt`:
```
You are the primary code-writing agent for LadeStack Build.
(Full content will be added in prompt 14.)
```

`packages/runtime/src/agents/prompts/plan.txt`:
```
You are in PLAN MODE. Read-only. Write a plan for user review.
(Full content will be added in prompt 14.)
```

`packages/runtime/src/agents/prompts/explore.txt`:
```
You are a file search specialist.
(Full content will be added in prompt 14.)
```

`packages/runtime/src/agents/prompts/scout.txt`:
```
You are a lightweight code scout.
(Full content will be added in prompt 14.)
```

`packages/runtime/src/agents/prompts/summarize.txt`:
```
You are a conversation summarizer.
(Full content will be added in prompt 14.)
```

`packages/runtime/src/agents/prompts/title.txt`:
```
You generate concise session titles.
(Full content will be added in prompt 14.)
```

### Step 4: Implement the loader

`packages/runtime/src/agents/loader.ts`:

```ts
import { readFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { log } from "../lib/logger.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROMPTS_DIR = join(__dirname, "prompts")

const cache = new Map<string, string>()

export function loadPromptFile(name: string): string {
  if (cache.has(name)) return cache.get(name)!
  try {
    const content = readFileSync(join(PROMPTS_DIR, `${name}.txt`), "utf-8")
    cache.set(name, content)
    return content
  } catch (err) {
    log.warn({ name }, "prompt file not found, using empty")
    return ""
  }
}

export function clearPromptCache(): void {
  cache.clear()
}
```

### Step 5: Implement the composer

`packages/runtime/src/agents/compose.ts`:

```ts
import { loadPromptFile } from "./loader.js"
import { listAllTools } from "../tools/registry.js"  // forward reference — implement in prompt 09
import { listAvailableSkills } from "../skills/registry.js"  // forward reference — implement in prompt 13
import type { AgentInfo, BuiltPrompt, PromptContext } from "./types.js"
import type { ToolDefinition } from "../providers/types.js"
import os from "os"

export async function composeSystemPrompt(ctx: PromptContext): Promise<BuiltPrompt> {
  const sections: Array<{ name: string; content: string; cacheable: boolean }> = []

  // 1. Soul (always cacheable — rarely changes)
  const soul = loadPromptFile("soul")
  sections.push({ name: "soul", content: soul, cacheable: true })

  // 2. Agent-specific prompt (cacheable per agent)
  if (ctx.agent.promptPath) {
    const agentPrompt = loadPromptFile(ctx.agent.promptPath.replace(/\.txt$/, ""))
    sections.push({ name: `agent:${ctx.agent.name}`, content: agentPrompt, cacheable: true })
  }

  // 3. Environment (dynamic — NOT cacheable)
  const envText = renderEnvironment(ctx.env)
  sections.push({ name: "environment", content: envText, cacheable: false })

  // 4. Skills (cacheable per project — skill list rarely changes mid-session)
  const skills = ctx.skills
  const skillsText = renderSkills(skills)
  if (skillsText) sections.push({ name: "skills", content: skillsText, cacheable: true })

  // 5. Tools (cacheable — tool list rarely changes)
  const allTools = listAvailableTools()  // forward ref
  const agentTools = filterToolsForAgent(allTools, ctx.agent)
  const toolsText = renderTools(agentTools)
  sections.push({ name: "tools", content: toolsText, cacheable: true })

  const system = sections
    .map((s) => `<section name="${s.name}">\n${s.content}\n</section>`)
    .join("\n\n")

  return {
    system,
    tools: agentTools.map(toToolDefinition),
    maxTokens: 8192,
    temperature: ctx.agent.temperature ?? 0.2,
    model: ctx.agent.model,
    cacheableSections: sections.filter((s) => s.cacheable).map((s) => s.name)
  }
}

function renderEnvironment(env: PromptContext["env"]): string {
  return `# Environment

- Platform: ${env.platform}
- Node.js: ${env.nodeVersion}
- Today's date: ${env.today}
- Project: ${env.projectName}
- Project type: ${env.projectType}
- Working directory: ${env.workingDirectory}
- Default mode: ${env.defaultMode}
- Default model: ${env.defaultModel.providerID}/${env.defaultModel.modelID}
- Active session: ${ctx.sessionId}  // forward ref
`.replace("ctx.sessionId", "this-session")
}

function renderSkills(skills: PromptContext["skills"]): string {
  if (skills.length === 0) return ""
  return `# Skills

You have access to the following skills. Invoke a skill by calling it via its name.

${skills.map((s) => `- **${s.name}** — ${s.description}`).join("\n")}
`
}

function renderTools(tools: Array<{ name: string; description: string }>): string {
  return `# Tools

You have access to the following tools. Each tool is described with its purpose and input schema.

${tools.map((t) => `## ${t.name}\n\n${t.description}`).join("\n\n")}
`
}

function filterToolsForAgent(tools: Array<{ name: string; description: string; restricted?: string[] }>, agent: AgentInfo) {
  return tools.filter((t) => {
    if (t.restricted && !t.restricted.includes(agent.name)) return false
    if (agent.tools && agent.tools[t.name] === false) return false
    return true
  })
}

function toToolDefinition(tool: { name: string; description: string; inputSchema: unknown }): ToolDefinition {
  return { name: tool.name, description: tool.description, input_schema: tool.inputSchema as any }
}

// Helper for caller to know current session ID
let currentSessionId = ""
export function setCurrentSessionId(id: string) { currentSessionId = id }
```

### Step 6: Stub the forward references

Create stub files so prompt 09 and 13 can fill them in:

`packages/runtime/src/tools/registry.ts` (stub):
```ts
import type { ToolDefinition } from "../providers/types.js"

export function listAvailableTools(): Array<{ name: string; description: string; inputSchema: unknown }> {
  return []
}
```

`packages/runtime/src/skills/registry.ts` (stub):
```ts
export function listAvailableSkills() {
  return Promise.resolve([])
}
```

### Step 7: Implement Anthropic prompt caching markers

Anthropic supports prompt caching via a `cache_control` block marker. To use this with the Vercel AI SDK (or raw SDK), we mark cacheable sections.

`packages/runtime/src/agents/caching.ts`:

```ts
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages.mjs"

export function markCacheable(system: string): Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }> {
  // Split system into sections (we use <section name="..."> delimiters)
  const sections: Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }> = []
  const re = /<section name="([^"]+)">\n([\s\S]*?)\n<\/section>/g
  let match: RegExpExecArray | null
  let lastIndex = 0

  while ((match = re.exec(system)) !== null) {
    if (match.index > lastIndex) {
      sections.push({ type: "text", text: system.slice(lastIndex, match.index) })
    }
    sections.push({
      type: "text",
      text: match[2],
      cache_control: { type: "ephemeral" }  // marks this block as cacheable
    })
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < system.length) {
    sections.push({ type: "text", text: system.slice(lastIndex) })
  }

  return sections
}
```

### Step 8: Add cacheable sections tracking to built prompt

Update `types.ts`:

```ts
export interface BuiltPrompt {
  system: string
  systemBlocks?: Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }>
  tools: ToolDefinition[]
  maxTokens?: number
  temperature?: number
  model?: ModelRef
  cacheableSections: string[]
}
```

Update `compose.ts` to populate `systemBlocks`:

```ts
import { markCacheable } from "./caching.js"

// In composeSystemPrompt:
const blocks = markCacheable(system)

return {
  system,
  systemBlocks: blocks,
  tools: agentTools.map(toToolDefinition),
  // ...
}
```

### Step 9: Test the composer

`packages/runtime/src/agents/compose.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { composeSystemPrompt } from "./compose.js"
import type { AgentInfo, PromptContext } from "./types.js"

const mockAgent: AgentInfo = {
  name: "build",
  displayName: "Build",
  description: "test",
  mode: "primary",
  promptPath: "build.txt"
}

const mockCtx: PromptContext = {
  agent: mockAgent,
  userId: "user-1",
  projectId: "proj-1",
  sessionId: "sess-1",
  env: {
    platform: "linux",
    nodeVersion: "v20.11.0",
    today: "2026-06-22",
    projectName: "test-project",
    projectType: "Next.js",
    workingDirectory: "/workspace",
    defaultMode: "plan",
    defaultModel: { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" }
  },
  skills: []
}

describe("composeSystemPrompt", () => {
  it("includes soul section", async () => {
    const result = await composeSystemPrompt(mockCtx)
    expect(result.system).toContain("<section name=\"soul\">")
    expect(result.system).toContain("<section name=\"environment\">")
  })

  it("marks cacheable sections", async () => {
    const result = await composeSystemPrompt(mockCtx)
    expect(result.cacheableSections).toContain("soul")
    expect(result.cacheableSections).toContain("tools")
    expect(result.cacheableSections).not.toContain("environment")
  })

  it("renders environment dynamically", async () => {
    const result = await composeSystemPrompt(mockCtx)
    expect(result.system).toContain("Project: test-project")
  })
})
```

### Step 10: Commit

```bash
git add -A
git commit -m "feat(runtime): prompt composition engine with Anthropic caching (prompt 07)"
```

## Files created

```
packages/runtime/src/agents/
├── types.ts
├── compose.ts
├── compose.test.ts
├── caching.ts
├── loader.ts
└── prompts/
    ├── soul.txt
    ├── build.txt
    ├── plan.txt
    ├── explore.txt
    ├── scout.txt
    ├── summarize.txt
    └── title.txt

packages/runtime/src/tools/registry.ts (stub)
packages/runtime/src/skills/registry.ts (stub)
```

## Acceptance criteria

- [ ] `pnpm --filter @ladestack/runtime test` passes (composer tests)
- [ ] `composeSystemPrompt` returns a system prompt with all 5 sections
- [ ] Cacheable sections are marked correctly (soul, agent, skills, tools — NOT environment)
- [ ] `markCacheable` produces correct Anthropic format with `cache_control` markers
- [ ] Tools and skills can be filtered per agent
- [ ] Stub tools/registry and skills/registry exist (to be filled in prompts 09 + 13)

## Verification

```bash
pnpm --filter @ladestack/runtime test -- compose
# expect: 3 tests pass
```

Manual check of output:
```bash
cd packages/runtime
node --input-type=module -e "
import { composeSystemPrompt } from './src/agents/compose.js';
const result = await composeSystemPrompt({
  agent: { name: 'build', displayName: 'Build', description: 'test', mode: 'primary', promptPath: 'build.txt' },
  userId: 'u', projectId: 'p', sessionId: 's',
  env: { platform: 'linux', nodeVersion: 'v20', today: '2026-06-22', projectName: 'demo', projectType: 'Next.js', workingDirectory: '/w', defaultMode: 'plan', defaultModel: { providerID: 'anthropic', modelID: 'claude-sonnet-4-20250514' } },
  skills: []
});
console.log(result.system);
console.log('---CACHEABLE---');
console.log(result.cacheableSections);
"
```

## Notes

- **Prompt caching saves 5-10x on input cost** for multi-turn sessions. The first turn pays full price; subsequent turns only pay for new content + cached reads (~10% of original cost).
- **Section delimiters (`<section name="...">`) are critical** — `markCacheable` uses them to split the system prompt into cacheable blocks. Don't change the format without updating the regex.
- **The forward references to `tools/registry` and `skills/registry`** are intentional stubs that get filled in prompts 09 and 13. The composer tests pass with empty lists.
- **Environment is NOT cacheable** because it contains dynamic data (date, session ID). Don't mark it.
- **Don't load prompts from disk on every call.** The loader caches in memory. For multi-process deployment (later), switch to a shared cache.
- **Prompt content is stubbed for now.** Prompt 14 fills in the real content from `../prompt.md`.
- **Max tokens is hardcoded at 8192** for now. Make this configurable per agent in v1.1.
