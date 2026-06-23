# Prompt 13: Agent Schema + Registry

## Goal

Define the agent system — a Zod-validated schema for an `Agent` (name, model, tools, prompt path, temperature, topP, steps, permission, color, hidden) plus an `AgentService` class that registers 10 built-in agents (`build`, `plan`, `explore`, `scout`, `summarize`, `title`, `debug`, `ask`, `generate`, `orchestrator`), supports custom registration from `.kilo/agents/*.md`, and exposes selectors (`get`, `list`, `forTask`). This is the foundation the agent loop (prompt 15) builds on. Mirrors Kilo Code's `packages/opencode/src/agent/agent.ts` and `kilocode/agent/index.ts`.

## Context (from prompts 01-12)

- Monorepo + provider + BYOK + all 14 tools (read, write, edit, glob, grep, bash, todowrite, question, plan_enter, plan_write, plan_exit, apply_patch, recall, lsp, websearch) all work (prompts 01-12).
- The provider layer (prompt 04) accepts a `ModelRef` (`{ providerID, modelID }`) — the agent schema reuses this.
- The permission system (prompt 03) defines `AgentPermissionSchema` (`edit`, `bash`, `webfetch` as `ask | allow | deny`). The agent registry extends this with per-tool permissions.
- Discovery service (prompt 03) already scans `.kilo/agents/*.md` — this prompt reuses it to register custom agents.

References:
- `../../02-competitive-research.md` §4 — Kilo Code's 8 built-in agents
- `../../03-system-architecture.md` §5 — multi-agent architecture
- `../../07-ai-skill-definition.md` §3 — agent skill format (custom agents)
- Real Kilo source:
  - `kilocode-clone/packages/opencode/src/agent/agent.ts` — the canonical Agent.Info schema
  - `kilocode-clone/packages/opencode/src/kilocode/agent/index.ts` — Kilo's agent registry + permission logic

## Task

### Step 1: Agent Zod schema

`packages/runtime/src/agent/schema.ts`:

```ts
import { z } from "zod"

/**
 * The canonical agent schema — every agent in the system (built-in and
 * user-defined) conforms to this.
 *
 * Mirrors Kilo Code's `agent/agent.ts` `Info` type, simplified for Zod.
 */
export const PermissionEnum = z.enum(["ask", "allow", "deny"])
export type Permission = z.infer<typeof PermissionEnum>

/**
 * Per-tool permissions. Kilo Code uses a generic ruleset ("*" → "allow"
 * with overrides per-tool); we expose the common subset structurally.
 */
export const AgentPermissionsSchema = z.object({
  edit: PermissionEnum.default("allow"),
  bash: PermissionEnum.default("ask"),
  webfetch: PermissionEnum.default("allow"),
  websearch: PermissionEnum.default("ask"),
  read: PermissionEnum.default("allow"),
  glob: PermissionEnum.default("allow"),
  grep: PermissionEnum.default("allow"),
  // Catch-all for tools not listed above.
  "*": PermissionEnum.default("allow"),
}).strict()

/**
 * Model reference — reuses the { providerID, modelID } shape from prompt 04.
 */
export const ModelRefSchema = z.object({
  providerID: z.string(),
  modelID: z.string(),
})

/**
 * Agent tools — a record from tool id → enabled. Missing tools default to
 * `true` (per the registry's `enabled()` method).
 *
 *   tools: { bash: false, edit: true, ... }
 */
export const AgentToolsSchema = z.record(z.string(), z.boolean()).default({})

export const AgentModeSchema = z.enum(["primary", "subagent", "all"])
export type AgentMode = z.infer<typeof AgentModeSchema>

/**
 * The AgentInfo schema — what the registry stores + returns.
 *
 * Top-level fields:
 *   name           — stable identifier ("build", "plan", "explore", ...)
 *   description    — one-line summary used in /agents listings
 *   mode           — "primary" = user-selectable; "subagent" = spawnable only;
 *                    "all" = both
 *   hidden         — true → not shown in /agents (e.g. compaction, debug)
 *   native         — true → built-in (read-only); false → user-defined
 *   model          — optional override of kilo.json's `model`
 *   smallModel     — for cheap tasks like title generation
 *   prompt         — path to system prompt .txt, OR inline content
 *   tools          — per-tool enable/disable overrides
 *   temperature    — 0..2 (LLM sampling)
 *   topP           — 0..1 (nucleus sampling)
 *   steps          — max tool-call iterations per turn (default 50)
 *   permission     — per-tool permission overrides
 *   color          — hex color for UI badges (e.g. "#FF6B6B")
 *   options        — extra provider-specific options (e.g. { reasoning_effort: "high" })
 */
export const AgentInfoSchema = z.object({
  name: z.string().min(1).regex(/^[a-z][a-z0-9_-]*$/, "lowercase alphanumeric + dashes only"),
  description: z.string().min(1).max(500),
  mode: AgentModeSchema.default("primary"),
  hidden: z.boolean().optional().default(false),
  native: z.boolean().optional().default(true),
  model: ModelRefSchema.optional(),
  smallModel: ModelRefSchema.optional(),
  prompt: z.string().min(1).optional(),
  tools: AgentToolsSchema,
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
  steps: z.number().int().positive().max(1000).optional().default(50),
  permission: AgentPermissionsSchema.partial().optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  options: z.record(z.string(), z.unknown()).optional().default({}),
}).strict()

export type AgentInfo = z.infer<typeof AgentInfoSchema>

/**
 * Validate raw agent data (e.g. from .md frontmatter or JSON) and return
 * a clean AgentInfo. Throws ZodError on invalid input.
 */
export function parseAgent(data: unknown): AgentInfo {
  return AgentInfoSchema.parse(data)
}
```

### Step 2: Built-in agents

`packages/runtime/src/agent/builtin.ts`:

```ts
import type { AgentInfo } from "./schema.js"

/**
 * The 10 built-in agents.
 *
 * Their system prompts live in `packages/runtime/src/agents/*.txt` and are
 * loaded by the registry at init time. Prompt 14 fills in the .txt files.
 */
export const BUILTIN_AGENTS: AgentInfo[] = [
  // ─────────────────────────────────────────────────────────────────
  // PRIMARY AGENTS (user-selectable via `kilo --agent <name>`)
  // ─────────────────────────────────────────────────────────────────

  {
    name: "build",
    description: "The default agent. Executes tools to build, edit, and run code.",
    mode: "primary",
    native: true,
    color: "#FF6B6B",
    tools: {},                  // all enabled by default
    permission: {
      bash: "ask",              // confirm destructive commands
      webfetch: "allow",
      websearch: "ask",
    },
    steps: 100,
    options: {},
  },

  {
    name: "plan",
    description: "Plan mode. Read-only exploration + plan drafting; no file edits.",
    mode: "primary",
    native: true,
    color: "#4ECDC4",
    tools: {
      // Plan mode disables write-class tools by default.
      write: false,
      edit: false,
      apply_patch: false,
      bash: false,
    },
    permission: {
      edit: "deny",
      bash: "deny",
      webfetch: "allow",
      websearch: "allow",
      read: "allow",
      glob: "allow",
      grep: "allow",
      plan_enter: "allow",
      plan_exit: "allow",
    },
    steps: 30,
    options: {},
  },

  // ─────────────────────────────────────────────────────────────────
  // SUBAGENTS (spawnable via the `task` tool; not user-selectable)
  // ─────────────────────────────────────────────────────────────────

  {
    name: "explore",
    description: "Fast agent specialized for exploring codebases. Read-only.",
    mode: "subagent",
    native: true,
    color: "#95E1D3",
    tools: {
      // Strip everything write-related.
      write: false,
      edit: false,
      apply_patch: false,
      bash: false,
      todowrite: false,
      question: false,
      plan_enter: false,
      plan_exit: false,
    },
    permission: {
      "*": "allow",
    },
    steps: 30,
    options: {},
  },

  {
    name: "scout",
    description: "Docs and dependency-source specialist. Reads external repos without modifying the workspace.",
    mode: "subagent",
    native: true,
    hidden: false,
    color: "#F38181",
    tools: {
      write: false,
      edit: false,
      apply_patch: false,
      bash: false,
      todowrite: false,
      question: false,
      plan_enter: false,
      plan_exit: false,
    },
    permission: {
      "*": "allow",
      webfetch: "allow",
      websearch: "allow",
      bash: "allow",          // needs git clone etc.
    },
    steps: 30,
    options: {},
  },

  {
    name: "summarize",
    description: "Condenses long conversations, diffs, or transcripts into a short summary.",
    mode: "subagent",
    native: true,
    color: "#FFA07A",
    tools: {
      // Pure read-only summarizer.
      write: false,
      edit: false,
      apply_patch: false,
      bash: false,
      webfetch: false,
      websearch: false,
      todowrite: false,
      question: false,
      plan_enter: false,
      plan_exit: false,
      recall: false,
    },
    permission: {
      "*": "deny",
      read: "allow",
      glob: "allow",
      grep: "allow",
    },
    steps: 5,
    options: {},
  },

  {
    name: "title",
    description: "Generates a short title (3-7 words) for a session. Used after the first user message.",
    mode: "subagent",
    native: true,
    hidden: true,              // internal — not in /agents
    color: "#AAAAAA",
    tools: {},                 // no tools at all
    permission: { "*": "deny" },
    steps: 1,
    options: {},
  },

  {
    name: "debug",
    description: "Specialized debugger. Investigates failing tests, stack traces, and runtime errors.",
    mode: "subagent",
    native: true,
    color: "#FF6347",
    tools: {
      write: false,
      edit: false,
      apply_patch: false,
      bash: true,              // needs to run failing tests
      todowrite: false,
      question: false,
      plan_enter: false,
      plan_exit: false,
    },
    permission: {
      "*": "allow",
      edit: "deny",
      write: "deny",
      apply_patch: "deny",
    },
    steps: 50,
    options: {},
  },

  {
    name: "ask",
    description: "Get answers and explanations without making changes to the codebase.",
    mode: "subagent",
    native: true,
    color: "#9B59B6",
    tools: {
      // Pure Q&A — read-only.
      write: false,
      edit: false,
      apply_patch: false,
      bash: false,
      todowrite: false,
      question: false,
      plan_enter: false,
      plan_exit: false,
    },
    permission: {
      "*": "deny",
      read: "allow",
      glob: "allow",
      grep: "allow",
      webfetch: "allow",
      websearch: "allow",
      recall: "allow",
    },
    steps: 20,
    options: {},
  },

  {
    name: "generate",
    description: "Generates a new agent configuration from a natural-language description. Used by /agents new.",
    mode: "subagent",
    native: true,
    hidden: true,
    color: "#DDA0DD",
    tools: {
      write: false,
      edit: false,
      apply_patch: false,
      bash: false,
      todowrite: false,
      question: false,
      plan_enter: false,
      plan_exit: false,
    },
    permission: {
      "*": "deny",
      read: "allow",
      glob: "allow",
      grep: "allow",
    },
    steps: 3,
    options: {},
  },

  {
    name: "orchestrator",
    description: "Wave-based parallel subagent dispatcher. Breaks complex tasks into waves of subagent runs.",
    mode: "subagent",
    native: true,
    color: "#FFD93D",
    tools: {
      // The orchestrator spawns subagents via `task`; it doesn't edit directly.
      write: false,
      edit: false,
      apply_patch: false,
      bash: false,
      plan_enter: false,
      plan_exit: false,
    },
    permission: {
      "*": "allow",
      edit: "deny",
      write: "deny",
      apply_patch: "deny",
      bash: "deny",
    },
    steps: 200,
    options: {},
  },
]
```

### Step 3: Agent registry

`packages/runtime/src/agent/registry.ts`:

```ts
import { readFileSync, existsSync } from "fs"
import { basename, join, resolve } from "path"
import { AgentInfoSchema, type AgentInfo } from "./schema.js"
import { BUILTIN_AGENTS } from "./builtin.js"

/**
 * The AgentService — singleton registry of all agents in the system.
 *
 * Built-in agents are registered at construction. Custom agents (from
 * `.kilo/agents/*.md` with YAML frontmatter) are loaded by `loadFromDisk()`.
 *
 * Selectors:
 *   get(name)         → AgentInfo (throws if not found)
 *   list(opts?)       → AgentInfo[] (filter by mode, hidden, native)
 *   register(custom)  → add a user-defined agent (override built-in)
 *   forTask(taskType) → AgentInfo (selector based on task)
 */
export class AgentService {
  private agents = new Map<string, AgentInfo>()
  private promptDir: string

  constructor(opts: { promptDir?: string } = {}) {
    this.promptDir = opts.promptDir ?? ""
    for (const agent of BUILTIN_AGENTS) {
      this.agents.set(agent.name, { ...agent, native: true })
    }
  }

  /** Get an agent by name. Throws if not found. */
  get(name: string): AgentInfo {
    const agent = this.agents.get(name)
    if (!agent) {
      throw new Error(
        `Unknown agent: "${name}". Available: ${this.list({ hidden: true }).map((a) => a.name).join(", ")}`,
      )
    }
    return agent
  }

  /** Look up an agent, or return undefined if not found. */
  tryGet(name: string): AgentInfo | undefined {
    return this.agents.get(name)
  }

  /**
   * List agents.
   *
   * Options:
   *   hidden:  include hidden agents (default false)
   *   mode:    filter by mode ("primary" | "subagent" | "all")
   *   native:  filter by native (true = built-in only, false = user-defined only)
   */
  list(opts: { hidden?: boolean; mode?: "primary" | "subagent" | "all"; native?: boolean } = {}): AgentInfo[] {
    const { hidden = false, mode, native } = opts
    let result = [...this.agents.values()]
    if (!hidden) result = result.filter((a) => !a.hidden)
    if (mode) result = result.filter((a) => a.mode === mode || a.mode === "all")
    if (native !== undefined) result = result.filter((a) => (a.native ?? true) === native)
    return result.sort((a, b) => a.name.localeCompare(b.name))
  }

  /**
   * Register a custom agent. If a built-in has the same name, the custom
   * one wins (override). The agent is validated against the schema first.
   */
  register(agent: AgentInfo): void {
    const parsed = AgentInfoSchema.parse(agent)
    const isOverride = this.agents.has(parsed.name)
    if (isOverride && this.agents.get(parsed.name)!.native) {
      // Allow override — set native=false to mark as user-customized.
      this.agents.set(parsed.name, { ...parsed, native: false })
    } else {
      this.agents.set(parsed.name, parsed)
    }
  }

  /**
   * Selector: pick the best agent for a given task type.
   *
   *   forTask("codebase-exploration") → "explore"
   *   forTask("summarization")       → "summarize"
   *   forTask("title-generation")    → "title"
   *   forTask("default")             → "build"
   */
  forTask(taskType: string): AgentInfo {
    const map: Record<string, string> = {
      exploration: "explore",
      "codebase-exploration": "explore",
      research: "scout",
      "external-research": "scout",
      summarization: "summarize",
      "title-generation": "title",
      debug: "debug",
      debugging: "debug",
      question: "ask",
      qa: "ask",
      generation: "generate",
      "agent-generation": "generate",
      orchestration: "orchestrator",
      default: "build",
      build: "build",
    }
    const name = map[taskType] ?? "build"
    return this.get(name)
  }

  /**
   * Load custom agents from `.kilo/agents/*.md` files. Each file has YAML
   * frontmatter with the agent config + markdown body as the prompt.
   *
   * Format:
   *   ---
   *   name: my-agent
   *   description: Does X
   *   mode: primary
   *   tools: { bash: false }
   *   ---
   *   You are an agent that...
   */
  async loadFromDisk(dirs: string[]): Promise<{ loaded: number; errors: Array<{ file: string; error: string }> }> {
    let loaded = 0
    const errors: Array<{ file: string; error: string }> = []

    for (const dir of dirs) {
      if (!existsSync(dir)) continue
      const { readdirSync, statSync } = await import("fs")
      const entries = readdirSync(dir)
      for (const entry of entries) {
        if (!entry.endsWith(".md")) continue
        const path = join(dir, entry)
        const stat = statSync(path)
        if (!stat.isFile()) continue

        try {
          const raw = readFileSync(path, "utf-8")
          const parsed = parseAgentFile(raw, path)
          this.register(parsed)
          loaded++
        } catch (err) {
          errors.push({ file: path, error: err instanceof Error ? err.message : String(err) })
        }
      }
    }

    return { loaded, errors }
  }

  /**
   * Resolve which tools are enabled for an agent. Returns a Set of tool ids.
   * (Used by prompt 15 to filter the tool registry before each turn.)
   */
  resolveEnabledTools(agentName: string, allToolIds: string[]): Set<string> {
    const agent = this.get(agentName)
    const enabled = new Set<string>()
    for (const id of allToolIds) {
      const override = (agent.tools ?? {})[id]
      enabled.add(override === undefined ? true : override)
    }
    return enabled
  }

  /**
   * Resolve the permission for a (agent, tool) pair.
   *
   * Precedence (later wins):
   *   1. agent.permission["*"]     (catch-all)
   *   2. agent.permission[toolId]   (per-tool override)
   */
  resolvePermission(agentName: string, toolId: string): "ask" | "allow" | "deny" {
    const agent = this.get(agentName)
    const perms = (agent.permission ?? {}) as Record<string, "ask" | "allow" | "deny">
    const specific = perms[toolId]
    if (specific) return specific
    const wildcard = perms["*"]
    return wildcard ?? "allow"
  }
}

/**
 * Parse a `.kilo/agents/*.md` file into an AgentInfo.
 *
 * Format:
 *   ---
 *   name: my-agent
 *   description: Does X
 *   mode: primary
 *   tools: { bash: false }
 *   ---
 *   You are an agent that...
 *
 * The body (after the closing `---`) becomes the agent's system prompt.
 */
export function parseAgentFile(raw: string, filePath: string): AgentInfo {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw)
  if (!match) {
    throw new Error(`agent file missing YAML frontmatter: ${filePath}`)
  }

  // Tiny YAML parser — handles the subset we need (key: value, key: { ... }).
  const frontmatterRaw = match[1]!
  const body = match[2]!.trim()
  const frontmatter = parseSimpleYaml(frontmatterRaw)

  const agent = AgentInfoSchema.parse({
    ...frontmatter,
    name: frontmatter.name ?? basename(filePath, ".md"),
    description: frontmatter.description ?? "(no description)",
    prompt: body,
  })

  if (!agent.prompt || agent.prompt.length < 10) {
    throw new Error(`agent file has empty or trivial prompt body: ${filePath}`)
  }

  return agent
}

/**
 * Minimal YAML parser for agent frontmatter. Supports:
 *   key: value
 *   key: "quoted value"
 *   key: { nested: value }
 *   key: [a, b, c]
 *
 * NOT a general YAML parser. Sufficient for the agent frontmatter subset.
 */
export function parseSimpleYaml(text: string): Record<string, any> {
  const out: Record<string, any> = {}
  const lines = text.split("\n")
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    const m = /^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)$/.exec(line)
    if (!m) { i++; continue }
    const key = m[1]!
    let value: any = m[2]!.trim()
    i++

    // Multi-line cases.
    if (value === "{" || value === "[") {
      // Bracketed block — collect until balanced.
      let depth = 0
      let block = value
      while (i < lines.length) {
        const next = lines[i]!
        block += "\n" + next
        for (const ch of next) {
          if (ch === "{" || ch === "[") depth++
          if (ch === "}" || ch === "]") depth--
        }
        if (depth === 0) { i++; break }
        i++
      }
      try { value = JSON.parse(block) } catch { value = block }
    } else if (value.startsWith('"') && !value.endsWith('"')) {
      // Quoted multi-line.
      const parts = [value]
      while (i < lines.length && !lines[i]!.endsWith('"')) {
        parts.push(lines[i]!)
        i++
      }
      if (i < lines.length) { parts.push(lines[i]!); i++ }
      value = parts.join("\n").slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"')
    } else {
      // Scalar — strip surrounding quotes if present.
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      // Booleans.
      if (value === "true") value = true
      else if (value === "false") value = false
      else if (/^-?\d+(\.\d+)?$/.test(value)) value = parseFloat(value)
    }
    out[key] = value
  }
  return out
}
```

### Step 4: Service singleton + initialization

`packages/runtime/src/agent/service.ts`:

```ts
import { AgentService } from "./registry.js"
import { homedir } from "os"
import { join } from "path"

let _service: AgentService | null = null

/**
 * Get the singleton AgentService, creating it on first call.
 *
 * Pass `customAgentDirs` to extend the discovery path (e.g. for tests).
 */
export function getAgentService(opts: { customAgentDirs?: string[]; promptDir?: string } = {}): AgentService {
  if (_service) return _service

  const svc = new AgentService({ promptDir: opts.promptDir })
  _service = svc
  return svc
}

/** Reset the singleton (for tests). */
export function resetAgentService(): void {
  _service = null
}

/** Default agent discovery paths. */
export function defaultAgentDirs(cwd: string): string[] {
  return [
    join(cwd, ".kilo", "agents"),
    join(cwd, ".kilocode", "agents"),
    join(cwd, ".opencode", "agents"),
    join(homedir(), ".kilocode", "agents"),
    join(homedir(), ".kilo", "agents"),
  ]
}
```

### Step 5: Sample custom agent file (test fixture)

`packages/runtime/src/agent/__fixtures__/agents/code-reviewer.md`:

```markdown
---
name: code-reviewer
description: Reviews a code diff for bugs, security, and style issues.
mode: primary
color: "#E67E22"
tools:
  write: false
  edit: false
  apply_patch: false
  bash: false
  todowrite: false
  question: false
  plan_enter: false
  plan_exit: false
temperature: 0.3
steps: 20
permission:
  "*": "deny"
  read: "allow"
  glob: "allow"
  grep: "allow"
---

You are a meticulous code reviewer. When given a diff or file path:

1. Read the file(s) carefully using the `read` tool.
2. Look for:
   - **Bugs** — null/undefined handling, off-by-one errors, race conditions
   - **Security** — OWASP Top 10 (injection, XSS, SSRF, auth bypass)
   - **Style** — naming, formatting, comment clarity
   - **Performance** — O(n²) loops, N+1 queries, blocking calls in hot paths
3. Report findings in a numbered list with file:line references.
4. Suggest specific fixes (with code snippets).
5. If the diff is large, focus on the most-changed files first.

Be terse. Cite line numbers. Don't repeat the diff back to the user.
```

### Step 6: Update runtime barrel

`packages/runtime/src/index.ts` — add:

```ts
export * as agent from "./agent/index.js"
```

`packages/runtime/src/agent/index.ts`:

```ts
export { AgentInfoSchema, AgentPermissionsSchema, ModelRefSchema, AgentToolsSchema, AgentModeSchema, parseAgent, PermissionEnum } from "./schema.js"
export type { AgentInfo, AgentMode, Permission } from "./schema.js"
export { AgentService, parseAgentFile, parseSimpleYaml } from "./registry.js"
export { BUILTIN_AGENTS } from "./builtin.js"
export { getAgentService, resetAgentService, defaultAgentDirs } from "./service.js"
```

### Step 7: Commit

```bash
git add -A
git commit -m "feat(agent): agent schema + registry + 10 built-in agents (prompt 13)"
```

## Files created

```
packages/runtime/src/agent/
├── index.ts                  # barrel
├── schema.ts                 # Zod schema + types
├── builtin.ts                # 10 built-in agent definitions
├── registry.ts               # AgentService class + custom-agent loader
├── service.ts                # singleton + default paths
└── __fixtures__/
    └── agents/
        └── code-reviewer.md  # sample custom agent
```

Plus 1 line added to `packages/runtime/src/index.ts`.

## Acceptance criteria

- [ ] `bun run typecheck` passes
- [ ] `getAgentService().list()` returns 10 agents (the built-ins)
- [ ] `getAgentService().get("build")` returns the build agent
- [ ] `getAgentService().get("nonexistent")` throws with a clear error listing available agents
- [ ] `getAgentService().list({ hidden: true })` includes the `title` and `generate` agents
- [ ] `getAgentService().list({ hidden: false })` excludes `title` and `generate`
- [ ] `getAgentService().list({ mode: "primary" })` returns `build`, `plan`
- [ ] `getAgentService().list({ mode: "subagent" })` returns the other 8
- [ ] `getAgentService().list({ native: true })` returns all 10 built-ins
- [ ] `getAgentService().list({ native: false })` returns empty (no custom agents loaded)
- [ ] `getAgentService().register(custom)` adds a new agent
- [ ] Registering an agent with the same name as a built-in marks it `native: false` (override)
- [ ] `getAgentService().forTask("exploration")` returns the `explore` agent
- [ ] `getAgentService().forTask("default")` returns `build`
- [ ] `getAgentService().forTask("unknown-task")` returns `build` (fallback)
- [ ] `getAgentService().resolvePermission("build", "bash")` returns `"ask"`
- [ ] `getAgentService().resolvePermission("plan", "edit")` returns `"deny"`
- [ ] `getAgentService().resolvePermission("plan", "read")` returns `"allow"` (from `*`)
- [ ] `getAgentService().resolveEnabledTools("plan", ["read", "write", "edit"])` excludes `write` and `edit`
- [ ] `getAgentService().resolveEnabledTools("title", ["read", "write"])` excludes both (title has no tools)
- [ ] `parseAgentFile` on the code-reviewer.md fixture produces an AgentInfo with `name: "code-reviewer"`, `mode: "primary"`, `temperature: 0.3`
- [ ] `parseAgentFile` on a file without frontmatter throws
- [ ] `parseAgentFile` on a file with empty body throws
- [ ] `parseAgent({ name: "Bad Name With Spaces", ... })` throws (regex validation)
- [ ] `parseAgent({ name: "ok", description: "x", temperature: 5 })` throws (max 2)
- [ ] `parseAgent({ name: "ok", description: "x", steps: -1 })` throws (positive only)
- [ ] `loadFromDisk` on a directory with 2 .md agent files returns `{ loaded: 2, errors: [] }`
- [ ] `loadFromDisk` on a missing directory returns `{ loaded: 0, errors: [] }` (no throw)
- [ ] `loadFromDisk` on a file with invalid YAML surfaces the error in `errors[]`

## Verification

```bash
cd kilocode-assistant
bun install
bun run typecheck

cd /path/to/kilocode-assistant
bun --eval '
import { getAgentService, resetAgentService, parseAgentFile, parseSimpleYaml, BUILTIN_AGENTS } from "@kilocode/runtime/agent"

resetAgentService()
const svc = getAgentService()

// Test 1: built-in agents
console.log("--- built-in agents ---")
const all = svc.list({ hidden: true })
console.log("count:", all.length)
console.log("names:", all.map(a => a.name).join(", "))

// Test 2: hidden filtering
console.log("--- hidden filter ---")
console.log("visible count:", svc.list().length)
console.log("includes title:", svc.list({ hidden: true }).some(a => a.name === "title"))
console.log("excludes title:", !svc.list().some(a => a.name === "title"))

// Test 3: mode filter
console.log("--- mode filter ---")
console.log("primary:", svc.list({ mode: "primary" }).map(a => a.name).join(", "))
console.log("subagent:", svc.list({ mode: "subagent" }).map(a => a.name).join(", "))

// Test 4: get unknown
try {
  svc.get("nonexistent")
  console.log("--- unknown agent: NO ERROR (BUG) ---")
} catch (e) {
  console.log("--- unknown agent: rejected ✓ ---")
  console.log("msg:", e.message.slice(0, 80))
}

// Test 5: register custom
svc.register({
  name: "my-custom",
  description: "Custom test agent",
  mode: "primary",
  tools: { bash: false },
})
console.log("--- custom registered ---")
console.log("found:", svc.tryGet("my-custom")?.name)
console.log("native:", svc.tryGet("my-custom")?.native)

// Test 6: override built-in
svc.register({
  name: "build",
  description: "Custom build",
  mode: "primary",
  tools: { todowrite: false },
})
console.log("--- override build ---")
console.log("desc:", svc.get("build").description)
console.log("native:", svc.get("build").native)

// Test 7: forTask
console.log("--- forTask ---")
console.log("exploration →", svc.forTask("exploration").name)
console.log("summarization →", svc.forTask("summarization").name)
console.log("unknown →", svc.forTask("unknown").name)

// Test 8: permissions
console.log("--- permissions ---")
console.log("build bash:", svc.resolvePermission("build", "bash"))
console.log("plan edit:", svc.resolvePermission("plan", "edit"))
console.log("plan read:", svc.resolvePermission("plan", "read"))
console.log("ask read:", svc.resolvePermission("ask", "read"))
console.log("plan bash:", svc.resolvePermission("plan", "bash"))

// Test 9: enabled tools
const enabled = svc.resolveEnabledTools("plan", ["read", "write", "edit", "bash", "glob", "grep"])
console.log("--- enabled tools for plan ---")
console.log("enabled:", [...enabled].join(", "))

// Test 10: load fixture
const result = await svc.loadFromDisk(["packages/runtime/src/agent/__fixtures__/agents"])
console.log("--- loadFromDisk ---")
console.log("loaded:", result.loaded, "errors:", result.errors.length)
console.log("registered:", svc.tryGet("code-reviewer")?.name)
console.log("temp:", svc.tryGet("code-reviewer")?.temperature)

// Test 11: schema validation
try {
  const { parseAgent } = await import("@kilocode/runtime/agent")
  parseAgent({ name: "Bad Name", description: "x" })
  console.log("--- bad name: NO ERROR (BUG) ---")
} catch (e) {
  console.log("--- bad name: rejected ✓ ---")
}

// Test 12: simple YAML
const yaml = parseSimpleYaml(`
name: test
description: A test
temperature: 0.5
tools:
  bash: false
  read: true
`)
console.log("--- YAML ---")
console.log(JSON.stringify(yaml))
'

# Cleanup: nothing to do, all in-memory.
```

Expected: 12 sections print, 10 built-in agents registered, hidden filter excludes title, mode filter splits correctly, custom agent + override work, forTask selectors resolve, permissions match schema, fixture loads.

## Notes

- **Why Zod, not Effect Schema?** We standardized on Zod throughout the project (config + tool params in prompts 03, 06, 07-12). Switching to Effect Schema just for the agent registry would force dual validation paths. Zod is sufficient for the agent config shape.
- **10 agents, not 8.** Kilo Code ships 8 primary+subagent agents. We added `debug` (specialized debugging workflow) and `orchestrator` (wave-based parallel dispatch, prompt 17). `title` and `generate` are marked `hidden: true` because they're internal.
- **`mode: "all"` is rare.** Only used by agents that work in both primary and subagent contexts. None of our 10 use it — primary agents stay primary, subagents stay subagent. Reserved for v2.
- **`prompt` is a string, not a path.** Kilo Code uses file paths to keep large prompts out of the registry code. We store inline strings here for simplicity; prompt 14 fills in the actual system prompt content via `.txt` files loaded at registry init.
- **`tools` record semantics.** Missing key = enabled (default true). Explicit `false` = disabled. Explicit `true` = enabled (no-op). This matches "deny-list" mental model — agents are permissive by default, restrictive for write-class tools.
- **Why `steps: 50` default?** Empirically enough for ~95% of single-turn tasks. Complex multi-step work uses the orchestrator (200 steps) or breaks into subagents (each with 30).
- **Permission inheritance.** `permission["*"]` is the fallback; per-tool entries override it. This matches Kilo Code's `Permission.fromConfig` behavior.
- **Custom agents override built-ins via name.** The registry doesn't prevent `register(build)` — it just sets `native: false`. v2 could add a `strict` flag.
- **YAML parser is hand-rolled, 80 lines.** Sufficient for the agent frontmatter subset. A real YAML lib (`yaml` npm package) handles edge cases (anchors, multi-doc) we don't need. v2 can swap to `js-yaml` if requirements grow.
- **Why a singleton (`getAgentService`)?** Multiple files import agents (the loop in prompt 15, the CLI in prompt 02, the orchestrator in prompt 17). A singleton ensures they all see the same registry state, including custom agents loaded after construction.
- **`hidden: true` for `title` and `generate`.** These are infrastructure agents the user never picks directly. `kilo --agent title` would be weird. The registry hides them from listings but `svc.get("title")` still works.
- **`color` is a hex string.** The UI renders agent names as colored badges. v1 hardcodes colors per agent (red for build, teal for plan, etc.). v2 could derive from name (hash → color).
- **No `model` defaults.** Each agent without an explicit `model` falls back to `kilo.json`'s `model` (the user's default). This keeps the registry size small — only override agents specify models.
- **`smallModel` is for cheap tasks.** `title` and `summarize` use it (Haiku-class). v1 doesn't wire this into the agent loop — prompt 15 will. For now, the field is just metadata.
- **Subagent tool restrictions.** Each subagent has `write: false, edit: false` because they're meant to be read-only specialists. `debug` and `orchestrator` are exceptions — they need bash to run tests / spawn subagents.
- **No agent versioning.** If the user updates a built-in's schema, the registry doesn't migrate old configs. v2 adds `version: 1` to the schema + a migration table.
- **Why `steps: 30` for subagents?** Subagents are spawned with a focused task; they shouldn't loop forever. 30 tool calls is enough for ~5-10 logical steps. The orchestrator gets 200 because it spawns many subagents.
- **Why `temperature: 0.3` for code-reviewer?** Lower temperature → more deterministic output. Code review benefits from consistency (same diff → same review). Default agents use the provider default (usually 1.0).
- **No agent inheritance.** Each agent is self-contained. v2 could add `extends: "build"` to compose. Skipped for v1 — composition complicates the schema.
- **Discovery runs after construction.** `loadFromDisk` is async and called explicitly (the CLI's `run` command does this). This lets us test built-ins without touching the filesystem.
- **`permission` schema is `.partial()`.** Agents can override any subset. Missing keys fall through to `"allow"` (per the schema's `.default()`). v2 could add `.strict()` to require explicit `"*"` catch-all.
- **Custom agent `prompt` field.** Stored as the markdown body of the .md file. The registry doesn't validate the content — prompt 14 fills in real prompts.
