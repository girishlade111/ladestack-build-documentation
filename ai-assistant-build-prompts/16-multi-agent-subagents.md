# Prompt 16: Multi-Agent Subagents

## Goal

Implement the `task` tool — the mechanism that lets one agent delegate work to a specialized subagent. The subagent runs in its own session, inherits the parent's `cwd` and (optionally) a filtered tool set, streams events back to the parent so the user sees nested execution, and can recursively spawn its own subagents up to depth 3. Covers the four subagent types `explore`, `scout`, `summarize`, `title` plus reuse of `build`/`plan` for nested delegation.

## Context (from prompts 01-15)

- Agent loop works: `runSession(opts)` streams events, persists messages, enforces permissions and step limits (prompt 15)
- 11 agents registered with full prompts (prompts 13-14)
- Tool registry exposes `defineTool` pattern (prompt 06) and `toolRegistry.toAiSdkTool(name, { preExecute, postExecute })`
- 14 tools available, including `bash` and `edit` (prompts 07-12)
- Subagents currently have a stub `task` tool (prompt 15 step 8) — this prompt fills it in

Reference:
- `../../02-competitive-research.md` §6.3 — Kilo Code's subagent architecture
- `../../08-system-prompts.md` — `explore.txt`, `scout.txt`, `summarize.txt`, `title.txt` (full text)
- Real Kilo source: `kilocode-clone/packages/opencode/src/tool/task.ts`
- Real Kilo source: `kilocode-clone/packages/opencode/src/session/subagent.ts`

## Task

### Step 1: Subagent type definitions

`packages/runtime/src/subagent/types.ts`:

```ts
import { z } from "zod"

/** The four purpose-built subagent types. Primary agents can also be invoked. */
export const SubagentTypeSchema = z.enum([
  "explore",      // file search, returns text summary
  "scout",        // broad reconnaissance, returns structured findings
  "summarize",    // compression
  "title",        // 3-7 word title (uses small model)
  "build",        // code-writing (for delegation)
  "plan",         // planning (for delegation)
])
export type SubagentType = z.infer<typeof SubagentTypeSchema>

/** Metadata about how a subagent was spawned. */
export const SubagentInfoSchema = z.object({
  id: z.string(),                       // unique sub-session id
  type: SubagentTypeSchema,
  parentId: z.string(),                 // parent session id
  depth: z.number().int().min(0).max(3),
  spawnedAt: z.number(),                // epoch ms
  prompt: z.string(),
  cwd: z.string(),
})
export type SubagentInfo = z.infer<typeof SubagentInfoSchema>

/** Per-type configuration: tool filter, step cap, model override. */
export interface SubagentProfile {
  /** Tools the subagent CAN use. Absent = all tools. */
  toolFilter?: string[]
  /** Tools the subagent MUST NOT use (overrides toolFilter). */
  toolDenyList?: string[]
  /** Max steps per sub-session. Defaults to 25. */
  maxSteps: number
  /** Force a specific model (overrides agent's default). */
  modelOverride?: string
  /** Whether the subagent can spawn its own subagents. */
  canSpawnSubagents: boolean
  /** Suggested temperature override. */
  temperature?: number
  /** Per-call timeout (ms). 0 = no timeout. */
  timeoutMs: number
}

export const SUBAGENT_PROFILES: Record<SubagentType, SubagentProfile> = {
  explore: {
    toolFilter: ["read", "glob", "grep"],
    toolDenyList: ["write", "edit", "apply_patch", "bash"],
    maxSteps: 15,
    canSpawnSubagents: false,
    timeoutMs: 60_000,
  },
  scout: {
    toolFilter: ["glob", "grep", "read"],
    toolDenyList: ["write", "edit", "apply_patch", "bash"],
    maxSteps: 15,
    canSpawnSubagents: false,
    timeoutMs: 60_000,
  },
  summarize: {
    toolFilter: [],
    toolDenyList: ["write", "edit", "apply_patch", "bash", "glob", "grep", "read"],
    maxSteps: 3,
    canSpawnSubagents: false,
    temperature: 0.2,
    timeoutMs: 30_000,
  },
  title: {
    toolFilter: [],
    toolDenyList: ["write", "edit", "apply_patch", "bash", "glob", "grep", "read"],
    maxSteps: 1,
    canSpawnSubagents: false,
    temperature: 0.3,
    timeoutMs: 15_000,
  },
  build: {
    // No filter — inherit parent's full tool set
    maxSteps: 30,
    canSpawnSubagents: true,
    timeoutMs: 180_000,
  },
  plan: {
    toolFilter: ["read", "glob", "grep", "plan_write", "plan_exit", "todowrite", "question"],
    toolDenyList: ["write", "edit", "apply_patch", "bash"],
    maxSteps: 20,
    canSpawnSubagents: true,
    timeoutMs: 120_000,
  },
}
```

### Step 2: Depth tracking — the recursion guard

`packages/runtime/src/subagent/depth.ts`:

```ts
import { AsyncLocalStorage } from "async_hooks"

/** Tracks the current subagent depth per async context. */
export interface DepthContext {
  depth: number
  parentId?: string
  rootId: string
}

export const depthStorage = new AsyncLocalStorage<DepthContext>()

export const MAX_DEPTH = 3

export function currentDepth(): number {
  return depthStorage.getStore()?.depth ?? 0
}

/** Returns true if a new subagent can be spawned at the current depth. */
export function canSpawn(): boolean {
  return currentDepth() < MAX_DEPTH
}

/** Run a function with an incremented depth context. */
export async function withDepth<T>(
  ctx: DepthContext,
  fn: () => Promise<T>,
): Promise<T> {
  return depthStorage.run(ctx, fn)
}
```

### Step 3: The `task` tool — full implementation

`packages/runtime/src/subagent/task.ts`:

```ts
import { z } from "zod"
import { defineTool } from "../tool/define.js"   // prompt 06
import { runSession } from "../agent/loop.js"    // prompt 15
import { agentService } from "../agent/registry.js" // prompt 13
import { resolveModel } from "../agent/provider-resolver.js"
import {
  SubagentTypeSchema,
  SUBAGENT_PROFILES,
  type SubagentType,
  type SubagentInfo,
} from "./types.js"
import { currentDepth, canSpawn, withDepth, MAX_DEPTH } from "./depth.js"

const TaskInputSchema = z.object({
  agent: SubagentTypeSchema.describe("Subagent type to invoke"),
  prompt: z.string().min(1).max(50_000).describe("Task description for the subagent"),
  cwd: z.string().optional().describe("Override cwd; defaults to parent's cwd"),
  model: z.string().optional().describe("Override model (e.g. 'anthropic/claude-3-5-haiku-20241022')"),
  context: z.string().optional().describe("Optional context to prepend to the subagent's prompt"),
  maxWaitMs: z.number().int().positive().optional().describe("Override default timeout"),
})

export interface TaskResult {
  subagentId: string
  type: SubagentType
  depth: number
  output: string
  steps: number
  tokensIn: number
  tokensOut: number
  costUsd: number
  reason: string
}

export const taskTool = defineTool({
  name: "task",
  description: `Spawn a subagent to handle a subtask in parallel or in isolation.

Available subagent types:
- explore: read-only file search, returns text summary (best for "find X")
- scout: read-only reconnaissance, returns structured findings (best for "survey area Y")
- summarize: compress a long document into 20% length
- title: generate a 3-7 word session title (uses cheap model)
- build: nested code-writing (for delegation chains)
- plan: nested planning (for delegation chains)

The subagent runs in its own context with a filtered tool set and cannot
modify your files unless you explicitly chose 'build'. Subagents can spawn
their own subagents up to depth ${MAX_DEPTH}.

Returns the subagent's final message as a string.`,
  input: TaskInputSchema,
  output: z.object({
    subagentId: z.string(),
    type: SubagentTypeSchema,
    depth: z.number(),
    output: z.string(),
    steps: z.number(),
    tokensIn: z.number(),
    tokensOut: z.number(),
    costUsd: z.number(),
    reason: z.string(),
  }),
  async execute(input, ctx): Promise<TaskResult> {
    // 1. Depth guard
    if (!canSpawn()) {
      throw new Error(
        `Maximum subagent depth (${MAX_DEPTH}) reached. ` +
          `Refactor your task to need fewer nested delegations.`,
      )
    }

    const parentCtx = ctx.subagentContext
    const parentDepth = currentDepth()
    const newDepth = parentDepth + 1
    const subagentId = crypto.randomUUID()
    const cwd = input.cwd ?? ctx.cwd

    // 2. Look up the subagent's profile
    const profile = SUBAGENT_PROFILES[input.agent]
    const agent = await agentService.get(input.agent)
    if (!agent) throw new Error(`Unknown subagent type: ${input.agent}`)

    // 3. Build the effective agent config (with tool filter applied)
    const effectiveAgent = applyProfile(agent, profile, input.agent)

    // 4. Register the modified agent temporarily (don't pollute the registry)
    const originalAgent = agent
    agentService.override(effectiveAgent.name, effectiveAgent)

    // 5. Construct the full prompt with optional context
    const fullPrompt = input.context
      ? `${input.context}\n\n---\n\n${input.prompt}`
      : input.prompt

    // 6. Parent event bridge — bubble subagent progress up
    const parentOnEvent = ctx.parentOnEvent
    const onEvent = parentOnEvent
      ? (e: import("../agent/events.js").AgentEvent) => {
          // Tag events with subagentId for UI tree display
          parentOnEvent({ ...e, subagentId } as any)
        }
      : undefined

    // 7. Spawn the subagent session
    const subagentInfo: SubagentInfo = {
      id: subagentId,
      type: input.agent,
      parentId: parentCtx?.rootId ?? "root",
      depth: newDepth,
      spawnedAt: Date.now(),
      prompt: fullPrompt,
      cwd,
    }

    const timeoutMs = input.maxWaitMs ?? profile.timeoutMs
    const abortController = new AbortController()
    const timer = timeoutMs > 0 ? setTimeout(() => abortController.abort(), timeoutMs) : null

    try {
      const result = await withDepth(
        {
          depth: newDepth,
          parentId: parentCtx?.rootId,
          rootId: parentCtx?.rootId ?? subagentId,
        },
        () =>
          runSession({
            cwd,
            sessionId: subagentId,
            message: fullPrompt,
            agent: input.agent,
            model: input.model ?? profile.modelOverride,
            maxSteps: profile.maxSteps,
            abortSignal: abortController.signal,
            onEvent,
          }),
      )

      // 8. Build the return value
      const output = result.reason === "aborted"
        ? `[subagent ${input.agent} aborted after timeout]`
        : (await extractFinalMessage(subagentId)) ?? "(no output)"

      return {
        subagentId,
        type: input.agent,
        depth: newDepth,
        output,
        steps: result.steps,
        tokensIn: result.totalTokensIn,
        tokensOut: result.totalTokensOut,
        costUsd: result.totalCostUsd,
        reason: result.reason,
      }
    } finally {
      if (timer) clearTimeout(timer)
      // Restore the original agent definition
      agentService.override(originalAgent.name, originalAgent)
    }
  },
})

/** Apply tool filter / deny list to an agent's tool list. */
function applyProfile(
  agent: import("../agent/schema.js").AgentInfo,
  profile: import("./types.js").SubagentProfile,
  _type: SubagentType,
): import("../agent/schema.js").AgentInfo {
  const baseTools: Record<string, boolean> = { ...(agent.tools ?? {}) }
  if (profile.toolFilter && profile.toolFilter.length > 0) {
    // Disable everything not in the filter
    for (const [name, enabled] of Object.entries(baseTools)) {
      if (!profile.toolFilter.includes(name)) baseTools[name] = enabled ? false : false
    }
    // Enable everything in the filter
    for (const name of profile.toolFilter) {
      baseTools[name] = baseTools[name] ?? true
    }
  }
  if (profile.toolDenyList) {
    for (const name of profile.toolDenyList) {
      baseTools[name] = false
    }
  }
  return {
    ...agent,
    tools: baseTools,
    temperature: profile.temperature ?? agent.temperature,
  }
}

/** Pull the final assistant message from the persisted JSONL. */
async function extractFinalMessage(sessionId: string): Promise<string | undefined> {
  const { loadSession } = await import("../agent/persistence.js")
  const msgs = await loadSession(sessionId)
  const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant")
  return lastAssistant?.content
}
```

### Step 4: Update `defineTool` to support parent context

The `defineTool` helper from prompt 06 needs to pass parent context through. Add a `ctx` extension:

`packages/runtime/src/tool/define.ts` (extend the existing file):

```ts
export interface ToolContext {
  cwd: string
  sessionId: string
  parentOnEvent?: (e: any) => void
  subagentContext?: { depth: number; parentId?: string; rootId: string }
  /** User's permission response for pending "ask" requests. */
  permissionResponse?: "allow" | "deny"
}
```

Update the `execute` signature in `defineTool` to accept this `ToolContext`:

```ts
execute: (input: TInput, ctx: ToolContext) => Promise<TOutput>
```

The loop (prompt 15) constructs `ctx` from the session state and passes it to every tool invocation via `toolRegistry.toAiSdkTool(name, { ctx })`.

### Step 5: Update `toolRegistry.toAiSdkTool` to inject context

In `packages/runtime/src/tool/registry.ts` (prompt 06), modify the adapter so every tool's `execute` receives `ctx`:

```ts
import { tool, type Tool } from "ai"
import { z } from "zod"

export function toAiSdkTool(
  name: string,
  hooks: {
    preExecute?: (input: unknown, ctx: ToolContext) => Promise<void>
    postExecute?: (output: unknown, durationMs: number, ctx: ToolContext) => Promise<void>
    ctx: ToolContext
  },
) {
  const def = REGISTRY.get(name)
  if (!def) throw new Error(`Unknown tool: ${name}`)

  return tool({
    description: def.description,
    inputSchema: def.input,
    execute: async (input: unknown) => {
      const start = Date.now()
      await hooks.preExecute?.(input, hooks.ctx)
      try {
        const out = await def.execute(input, hooks.ctx)
        await hooks.postExecute?.(out, Date.now() - start, hooks.ctx)
        return out
      } catch (err) {
        await hooks.postExecute?.(`Error: ${err instanceof Error ? err.message : String(err)}`, Date.now() - start, hooks.ctx)
        throw err
      }
    },
  })
}
```

### Step 6: Update the loop to pass subagent context

In `packages/runtime/src/agent/loop.ts` (prompt 15), inside the `bindToolsForAgent` function:

```ts
const toolCtx: ToolContext = {
  cwd: opts.cwd,
  sessionId,
  parentOnEvent: opts.onEvent,
  subagentContext: depthStorage.getStore(),
}

// ... when registering each tool ...
tools[name] = toolRegistry.toAiSdkTool(name, {
  ctx: toolCtx,
  preExecute: async (input, ctx) => { /* ... existing permission check ... */ },
  postExecute: async (output, durationMs, ctx) => { /* ... existing emit ... */ },
})
```

### Step 7: Register the `task` tool

In `packages/runtime/src/tool/registry.ts` (prompt 06's central list):

```ts
import { taskTool } from "../subagent/task.js"

REGISTRY.set("task", taskTool)
```

### Step 8: UI event tagging — events bubble up with subagentId

Update the event type union (from prompt 15) to include `subagentId`:

`packages/runtime/src/agent/events.ts` — extend each event:

```ts
export const AgentEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("session_start"),
    sessionId: z.string(),
    agent: z.string(),
    model: z.string(),
    subagentId: z.string().optional(),   // NEW: present if this is a sub-session
  }),
  z.object({
    type: z.literal("text_delta"),
    delta: z.string(),
    subagentId: z.string().optional(),
  }),
  // ... same for tool_start, tool_end, step ...
])
```

### Step 9: Web UI rendering of the subagent tree

Update `packages/server/src/routes/sessions.ts` to forward subagent-tagged events verbatim — the SSE channel already carries them. The web UI (in `packages/server/public/`, separate concern) groups events by `subagentId` into a nested tree.

For a CLI smoke test, the `kilo run` command (prompt 02) just prints events as they arrive; the subagent text shows indented beneath the parent.

### Step 10: Unit tests

`packages/runtime/src/subagent/task.test.ts`:

```ts
import { test, expect, describe } from "bun:test"
import { SUBAGENT_PROFILES, SubagentTypeSchema } from "./types.js"
import { depthStorage, withDepth, currentDepth, canSpawn, MAX_DEPTH } from "./depth.js"

describe("subagent profiles", () => {
  test("explore is read-only", () => {
    const p = SUBAGENT_PROFILES.explore
    expect(p.toolDenyList).toContain("write")
    expect(p.toolDenyList).toContain("edit")
    expect(p.toolDenyList).toContain("bash")
    expect(p.toolFilter).toContain("read")
  })

  test("title has tight step cap and uses cheap model", () => {
    expect(SUBAGENT_PROFILES.title.maxSteps).toBe(1)
  })

  test("summarize has no tools at all", () => {
    expect(SUBAGENT_PROFILES.summarize.toolFilter).toEqual([])
  })

  test("build and plan can spawn subagents", () => {
    expect(SUBAGENT_PROFILES.build.canSpawnSubagents).toBe(true)
    expect(SUBAGENT_PROFILES.plan.canSpawnSubagents).toBe(true)
    expect(SUBAGENT_PROFILES.explore.canSpawnSubagents).toBe(false)
  })
})

describe("subagent type schema", () => {
  test("accepts all 6 types", () => {
    for (const t of ["explore", "scout", "summarize", "title", "build", "plan"]) {
      expect(() => SubagentTypeSchema.parse(t)).not.toThrow()
    }
  })

  test("rejects unknown type", () => {
    expect(() => SubagentTypeSchema.parse("magic")).toThrow()
  })
})

describe("depth tracking", () => {
  test("starts at 0 outside any context", () => {
    expect(currentDepth()).toBe(0)
    expect(canSpawn()).toBe(true)
  })

  test("increments inside withDepth", async () => {
    expect(currentDepth()).toBe(0)
    await withDepth({ depth: 1, rootId: "x" }, async () => {
      expect(currentDepth()).toBe(1)
      expect(canSpawn()).toBe(true)
      await withDepth({ depth: 2, rootId: "x" }, async () => {
        expect(currentDepth()).toBe(2)
        expect(canSpawn()).toBe(true)
        await withDepth({ depth: 3, rootId: "x" }, async () => {
          expect(currentDepth()).toBe(3)
          expect(canSpawn()).toBe(false)  // at MAX_DEPTH
        })
      })
    })
    expect(currentDepth()).toBe(0)
  })

  test("MAX_DEPTH is 3", () => {
    expect(MAX_DEPTH).toBe(3)
  })
})
```

### Step 11: Integration test (requires API key)

`packages/runtime/src/subagent/task.integration.test.ts`:

```ts
import { test, expect } from "bun:test"
import { runSession } from "../agent/loop.js"
import { agentService } from "../agent/registry.js"

test.skipIf(!process.env.ANTHROPIC_API_KEY)(
  "explore subagent returns text",
  async () => {
    const result = await runSession({
      cwd: process.cwd(),
      message: 'Use the task tool with agent="explore" to find all files containing "TODO" in packages/runtime/src. Then report what you found.',
      agent: "build",
      maxSteps: 10,
    })
    expect(result.totalTokensIn).toBeGreaterThan(0)
    expect(result.reason).toBe("completed")
  },
  { timeout: 60_000 },
)
```

Run with `bun test --timeout 120000 packages/runtime/src/subagent/`.

### Step 12: Commit

```bash
git add -A
git commit -m "feat(subagent): task tool + 4 subagent types + depth guard (prompt 16)"
```

## Files created

```
packages/runtime/src/subagent/
├── types.ts
├── depth.ts
├── task.ts
├── task.test.ts
└── task.integration.test.ts

packages/runtime/src/tool/
├── define.ts             (extended with ToolContext)
└── registry.ts           (updated adapter to inject ctx)

packages/runtime/src/agent/
├── events.ts             (subagentId added to event union)
└── loop.ts               (passes subagent context to tools)
```

## Acceptance criteria

- [ ] `task` tool is registered and invocable from any primary agent
- [ ] Invoking `task({ agent: "explore", prompt: "find foo" })` returns a string
- [ ] `explore` subagent cannot call `write`, `edit`, or `bash` (tool filter enforced)
- [ ] `summarize` and `title` subagents have no tools (pure text)
- [ ] Depth guard: spawning a subagent at depth 3 throws `Maximum subagent depth reached`
- [ ] Subagent events are tagged with `subagentId` and bubble up to parent
- [ ] Subagent session is persisted to its own JSONL file
- [ ] `task` tool result includes `tokensIn`, `tokensOut`, `costUsd` for accounting
- [ ] `SUBAGENT_PROFILES.title.maxSteps === 1`
- [ ] `SUBAGENT_PROFILES.explore.toolDenyList` contains `bash`, `write`, `edit`
- [ ] All unit tests pass: `bun test packages/runtime/src/subagent/`

## Verification

```bash
cd kilocode-assistant
bun run typecheck
bun test packages/runtime/src/subagent/

# Integration test (requires ANTHROPIC_API_KEY)
export ANTHROPIC_API_KEY=***
bun test packages/runtime/src/subagent/task.integration.test.ts

# Smoke test from CLI
bun run kilo run 'use the task tool with agent="explore" to find files matching "*.txt" in packages/runtime/src/agent/prompts/ and tell me their names'
```

Expected: `build` agent invokes the `task` tool with `agent: "explore"`, the explore subagent runs and returns a list of paths, the build agent summarizes and responds.

## Notes

- **AsyncLocalStorage for depth** is the right primitive — it survives `await` boundaries and is per-request. Cheaper than threading context through every function signature.
- **MAX_DEPTH = 3** matches Kilo Code's limit. 4 levels of nesting is rarely useful and risks runaway token spend.
- **Subagent profiles are static** — defined in code, not config. Users can override per-project via `kilo.json`'s `subagent` block in v1.1.
- **Tool deny list overrides filter** — even if `toolFilter` includes `bash`, if `toolDenyList` contains `bash`, it's still blocked. Fail-safe: deny-by-default if both are set ambiguously.
- **Subagent events bubble up** with `subagentId` set. The parent's SSE stream includes both parent and child events; the web UI groups them by `subagentId` into a tree. The CLI prints them indented.
- **The `task` tool is the ONLY way** to spawn subagents. We don't auto-spawn on certain prompts. This keeps the agent in control of parallelism and prevents surprise cost.
- **Title subagent uses `claude-3-5-haiku`** by default via `modelOverride`. Set in the profile. Saves ~95% vs using sonnet for a 1-call task.
- **Timeout is enforced via AbortController** — the loop respects `abortSignal.aborted` and emits `done: { reason: "aborted" }`. The tool returns a clear error message.
- **`extractFinalMessage` reads the last assistant text** — this is what the parent sees. If the subagent emitted tool calls but no final text, we return `(no output)` rather than the tool noise.
- **`agentService.override`** is a temporary in-place override that gets restored in `finally`. Cleaner than cloning the registry per subagent.
- **Web UI for nested execution** is a v1.1 concern — for now, events just stream. The structure (`subagentId` tagging) is in place for the UI to consume.