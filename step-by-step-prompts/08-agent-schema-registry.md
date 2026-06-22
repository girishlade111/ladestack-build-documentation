# Prompt 08: Agent Schema + Registry

## Goal

Build the agent registry: Zod-validated schema, default agents registered (build, plan, explore, scout, generate, summarize, title), and a lookup API for the runtime to use.

## Context (from prompts 01-07)

- Monorepo, Next.js, Hono, Supabase, Daytona, provider layer, prompt composer all built.
- Agent types exist in `packages/runtime/src/agents/types.ts` (from prompt 07).

Reference: `../agent-loop.md` §1 (agent registry), `../system-design.md` §2.3 (agent service).

## Task

### Step 1: Add Zod dependency (already there, just verify)

```bash
cd packages/runtime
pnpm list zod   # should be installed
```

If not:
```bash
pnpm add zod
```

### Step 2: Define the Zod schema

`packages/runtime/src/agents/schema.ts`:

```ts
import { z } from "zod"
import { ProviderIDSchema, ModelIDSchema } from "../providers/types.js"

export const AgentModeSchema = z.enum(["primary", "subagent", "all"])

export const AgentInfoSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]*$/, "kebab-case identifier"),
  displayName: z.string().min(1),
  description: z.string().min(1),
  mode: AgentModeSchema,
  hidden: z.boolean().optional().default(false),
  promptPath: z.string().optional(),       // relative to prompts/
  tools: z.record(z.string(), z.boolean()).optional(),
  model: z.object({
    providerID: ProviderIDSchema,
    modelID: ModelIDSchema
  }).optional(),
  temperature: z.number().min(0).max(2).optional(),
  steps: z.number().int().positive().optional().default(25),
  color: z.string().regex(/^#[0-9a-f]{6}$/i).optional()
})

export type AgentInfoParsed = z.infer<typeof AgentInfoSchema>
```

### Step 3: Define the built-in agents

`packages/runtime/src/agents/builtin.ts`:

```ts
import type { AgentInfo } from "./types.js"

export const BUILTIN_AGENTS: AgentInfo[] = [
  // Primary agents
  {
    name: "build",
    displayName: "Build",
    description: "Default code-writing agent. Use for most coding tasks: build features, fix bugs, refactor, write tests.",
    mode: "primary",
    promptPath: "build.txt",
    color: "#D4A574"
  },
  {
    name: "plan",
    displayName: "Plan",
    description: "Read-only planning agent. Use for non-trivial changes to produce a written plan before any code edits.",
    mode: "primary",
    promptPath: "plan.txt",
    tools: { write: false, edit: false, bash: false },
    color: "#7C5DDB"
  },
  {
    name: "ask",
    displayName: "Ask",
    description: "Q&A agent. Use for read-only questions about the codebase that don't require any edits.",
    mode: "primary",
    promptPath: "ask.txt",
    tools: { write: false, edit: false, bash: false },
    color: "#A0A8C0"
  },

  // Subagents (spawned by primary agents)
  {
    name: "explore",
    displayName: "Explore",
    description: "Thorough file search agent. Use to find references, understand patterns, locate files. Read-only.",
    mode: "subagent",
    promptPath: "explore.txt",
    tools: { write: false, edit: false, bash: false },
    color: "#4A90E2"
  },
  {
    name: "scout",
    displayName: "Scout",
    description: "Lightweight codebase orientation. Quick overview without deep reads. Read-only.",
    mode: "subagent",
    promptPath: "scout.txt",
    tools: { read: false, write: false, edit: false, bash: false },
    color: "#4A90E2"
  },
  {
    name: "summarize",
    displayName: "Summarize",
    description: "Compress old conversation messages into a summary. Used during automatic compaction.",
    mode: "subagent",
    promptPath: "summarize.txt",
    tools: {},
    color: "#A0A8C0"
  },
  {
    name: "title",
    displayName: "Title",
    description: "Auto-generate a short title for a session from the first message. Used at session start.",
    mode: "subagent",
    promptPath: "title.txt",
    tools: {},
    color: "#A0A8C0"
  },
  {
    name: "generate",
    displayName: "Generate",
    description: "Meta-agent. Generates new agent definitions from natural language descriptions.",
    mode: "primary",
    promptPath: "generate.txt",
    color: "#E6BC8A"
  }
]
```

### Step 4: Add stub `ask.txt` and `generate.txt` prompts

`packages/runtime/src/agents/prompts/ask.txt`:
```
You are the Ask agent. You answer questions about the codebase without making any edits.
Use read, glob, and grep only. Be concise. Cite file paths and line numbers.
```

`packages/runtime/src/agents/prompts/generate.txt`:
```
You are the Generate agent — a meta-agent that creates new agent definitions from natural language.
When asked to create an agent, output a JSON object with: {identifier, whenToUse, systemPrompt}.
Identifier must be kebab-case. systemPrompt must be in second person ("You are...").
```

### Step 5: Build the registry service

`packages/runtime/src/agents/registry.ts`:

```ts
import { z } from "zod"
import { AgentInfoSchema, type AgentInfoParsed } from "./schema.js"
import { BUILTIN_AGENTS } from "./builtin.js"
import type { AgentInfo } from "./types.js"
import { log } from "../lib/logger.js"

const agents = new Map<string, AgentInfo>()

// Register built-ins on module load
for (const agent of BUILTIN_AGENTS) {
  register(agent)
}

export function register(agent: AgentInfo): void {
  const parsed = AgentInfoSchema.parse(agent)
  agents.set(parsed.name, parsed)
  log.debug({ name: parsed.name }, "agent registered")
}

export function unregister(name: string): void {
  agents.delete(name)
}

export function get(name: string): AgentInfo | undefined {
  return agents.get(name)
}

export function require(name: string): AgentInfo {
  const agent = agents.get(name)
  if (!agent) throw new Error(`agent not found: ${name}. Available: ${list().map((a) => a.name).join(", ")}`)
  return agent
}

export function list(): AgentInfo[] {
  return Array.from(agents.values())
}

export function listByMode(mode: "primary" | "subagent"): AgentInfo[] {
  return list().filter((a) => a.mode === mode || a.mode === "all")
}

export function getDefault(): AgentInfo {
  return require("build")
}

export function clearRegistry(): void {
  agents.clear()
  for (const agent of BUILTIN_AGENTS) agents.set(agent.name, agent)
}
```

### Step 6: Add auto-selection helper

`packages/runtime/src/agents/select.ts`:

```ts
import { require } from "./registry.js"
import type { AgentInfo } from "./types.js"

const KEYWORDS: Record<string, string[]> = {
  plan: ["plan", "planning", "design before"],
  ask: ["what is", "explain", "how does", "why"],
  explore: ["find all", "search for", "locate", "where is"],
  scout: ["overview", "structure", "what files"]
}

export function autoSelectAgent(userMessage: string): AgentInfo {
  const lower = userMessage.toLowerCase().trim()

  // Score each agent by keyword matches
  const scores: Record<string, number> = {}
  for (const [agentName, keywords] of Object.entries(KEYWORDS)) {
    scores[agentName] = keywords.filter((kw) => lower.includes(kw)).length
  }

  // Pick highest-scoring agent (default to build)
  let best = "build"
  let bestScore = 0
  for (const [name, score] of Object.entries(scores)) {
    if (score > bestScore) {
      best = name
      bestScore = score
    }
  }

  return require(best)
}
```

### Step 7: Update runtime index

`packages/runtime/src/index.ts`:

```ts
export * from "./sandbox/types.js"
export * as sandbox from "./sandbox/daytona.js"
export * from "./sandbox/operations.js"
export * from "./providers/types.js"
export * from "./providers/anthropic.js"
export * from "./providers/openai.js"
export * from "./providers/google.js"
export * from "./providers/registry.js"
export * from "./providers/encryption.js"
export * from "./providers/keys.js"
export * from "./agents/types.js"
export * from "./agents/schema.js"
export * from "./agents/registry.js"
export * from "./agents/builtin.js"
export * from "./agents/select.js"
export * from "./agents/loader.js"
export * from "./agents/compose.js"
export * from "./agents/caching.js"
export { log } from "./lib/logger.js"
```

### Step 8: Tests

`packages/runtime/src/agents/registry.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest"
import { register, get, require, list, listByMode, getDefault, clearRegistry } from "./registry.js"

describe("agent registry", () => {
  beforeEach(() => clearRegistry())

  it("registers and retrieves an agent", () => {
    register({
      name: "test-agent",
      displayName: "Test",
      description: "test agent",
      mode: "primary"
    })
    expect(get("test-agent")?.displayName).toBe("Test")
  })

  it("throws on unknown agent", () => {
    expect(() => require("nonexistent")).toThrow(/agent not found/)
  })

  it("lists built-ins after init", () => {
    const agents = list()
    expect(agents.length).toBeGreaterThanOrEqual(7)
    expect(agents.find((a) => a.name === "build")).toBeDefined()
    expect(agents.find((a) => a.name === "plan")).toBeDefined()
    expect(agents.find((a) => a.name === "explore")).toBeDefined()
  })

  it("filters by mode", () => {
    const subagents = listByMode("subagent")
    expect(subagents.find((a) => a.name === "explore")).toBeDefined()
    expect(subagents.find((a) => a.name === "build")).toBeUndefined()
  })

  it("returns build as default", () => {
    expect(getDefault().name).toBe("build")
  })

  it("rejects invalid agent names", () => {
    expect(() => register({
      name: "Invalid Name!",
      displayName: "X",
      description: "x",
      mode: "primary"
    })).toThrow()
  })
})
```

`packages/runtime/src/agents/select.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { autoSelectAgent } from "./select.js"

describe("autoSelectAgent", () => {
  it("selects plan for planning requests", () => {
    expect(autoSelectAgent("Plan the implementation of OAuth").name).toBe("plan")
  })

  it("selects ask for questions", () => {
    expect(autoSelectAgent("What is the structure of src/api/?").name).toBe("ask")
  })

  it("selects explore for searches", () => {
    expect(autoSelectAgent("Find all uses of useState in this project").name).toBe("explore")
  })

  it("defaults to build for coding tasks", () => {
    expect(autoSelectAgent("Add a login page to my Next.js app").name).toBe("build")
  })
})
```

### Step 9: Commit

```bash
git add -A
git commit -m "feat(runtime): agent schema + registry with 8 built-in agents (prompt 08)"
```

## Files created

```
packages/runtime/src/agents/
├── schema.ts
├── builtin.ts
├── registry.ts
├── select.ts
├── registry.test.ts
├── select.test.ts
└── prompts/
    ├── ask.txt
    └── generate.txt
```

## Acceptance criteria

- [ ] `pnpm --filter @ladestack/runtime test` passes (registry + select tests)
- [ ] 8 built-in agents are registered on module load
- [ ] `require("nonexistent")` throws
- [ ] `autoSelectAgent` correctly routes based on keywords
- [ ] Invalid agent names are rejected by Zod
- [ ] `getDefault()` returns `build`

## Verification

```bash
pnpm --filter @ladestack/runtime test -- registry select
# expect: 6+ tests pass

# Manual check
cd packages/runtime
node --input-type=module -e "
import { list, getDefault, autoSelectAgent } from './src/agents/index.js';
console.log('Built-in agents:', list().map(a => a.name));
console.log('Default:', getDefault().name);
console.log('Auto for \"add login\":', autoSelectAgent('add login').name);
console.log('Auto for \"plan oauth\":', autoSelectAgent('plan oauth').name);
"
```

## Notes

- **Agent names are kebab-case** validated by Zod. Don't allow spaces, capitals, or special chars.
- **Built-in agents use promptPath** that points to .txt files in `prompts/`. Prompt 14 fills in real content.
- **`autoSelectAgent` is a heuristic, not authoritative.** Users can override agent selection manually via UI. This is just the default.
- **The `ask` and `generate` agents are missing prompts** — they're stubbed for now. Fill them in prompt 14.
- **`clearRegistry()` re-registers built-ins.** Useful for tests. Don't call this in production.
- **Subagents (explore, scout, summarize, title) are not directly user-selectable** — they're spawned by primary agents. The UI may show them as read-only.
- **Agent colors map to UI accents.** See `../design.md` §8.2 for the mapping.
- **Plan mode tools restrictions** (write/edit/bash = false) are declared in `builtin.ts` but ENFORCEMENT happens in the agent loop (prompt 11). The composer just filters them out of the tool list.
