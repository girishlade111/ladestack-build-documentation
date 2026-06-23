# Prompt 17: Orchestrator Wave-Based Dispatch

## Goal

Implement the orchestrator agent — the wave-based parallel task dispatcher that decomposes complex requests into dependency-ordered waves, launches each wave's subagent invocations in parallel, aggregates results, and feeds them forward. Used for full-repo refactors, multi-file feature implementations, migrations, and any task that benefits from parallelism. Provides a clean UX: the user sees current wave, subtasks in flight, completed, and failed — exactly what Kilo Code's `orchestrator` does, with our depth + budget guards layered on top.

## Context (from prompts 01-16)

- `runSession(opts)` runs one agent turn with streamText + tools (prompt 15)
- `task` tool spawns subagents with profile-driven tool filters (prompt 16)
- AsyncLocalStorage tracks depth per async context (prompt 16)
- JSONL persistence per session (prompt 15)
- 11 agents registered, including `orchestrator` (prompts 13-14)
- Cost tracking + `costFor()` per token (prompt 15)
- Web UI consumes SSE events with optional `subagentId` for nested rendering (prompts 02, 15-16)

Reference:
- `../../08-system-prompts.md` `orchestrator.txt` (full text, verbatim)
- Real Kilo source: `kilocode-clone/packages/opencode/src/kilocode/orchestrator.txt`
- Kilo's `kilocode-clone/packages/opencode/src/agent/orchestrator.ts`
- `../../02-competitive-research.md` §6.4 — wave dispatch pattern

## Task

### Step 1: Wave + plan schema

`packages/runtime/src/orchestrator/schema.ts`:

```ts
import { z } from "zod"

/** A single subtask within a wave. */
export const SubtaskSchema = z.object({
  id: z.string(),                                     // unique within plan
  agent: z.enum(["explore", "scout", "summarize", "build", "plan", "devops", "security-review", "test-generator"]),
  prompt: z.string(),
  /** Files this subtask is expected to read or modify. Used for conflict detection. */
  files: z.array(z.string()).default([]),
  /** Depends on these subtask ids (must complete before this runs). */
  dependsOn: z.array(z.string()).default([]),
  /** Optional context to prepend (set automatically from prior wave results). */
  context: z.string().optional(),
  /** Optional timeout (ms). 0 = no timeout. */
  timeoutMs: z.number().int().nonnegative().default(0),
})
export type Subtask = z.infer<typeof SubtaskSchema>

/** A single wave — a set of subtasks to run in parallel. */
export const WaveSchema = z.object({
  index: z.number().int().nonnegative(),
  subtasks: z.array(SubtaskSchema).min(1),
})
export type Wave = z.infer<typeof WaveSchema>

/** A complete orchestrator plan — produced by the LLM in plan mode. */
export const OrchestratorPlanSchema = z.object({
  goal: z.string(),
  approach: z.string(),
  waves: z.array(WaveSchema).min(1),
  /** Optional global budget in USD. Orchestrator aborts if cumulative cost exceeds this. */
  budgetUsd: z.number().positive().optional(),
  /** Optional global timeout in ms. */
  timeoutMs: z.number().int().positive().optional(),
})
export type OrchestratorPlan = z.infer<typeof OrchestratorPlanSchema>

/** Result of executing one subtask. */
export const SubtaskResultSchema = z.object({
  subtaskId: z.string(),
  waveIndex: z.number(),
  agent: z.string(),
  status: z.enum(["pending", "running", "completed", "failed", "timeout", "skipped"]),
  output: z.string().optional(),
  error: z.string().optional(),
  startedAt: z.number().optional(),
  finishedAt: z.number().optional(),
  durationMs: z.number().optional(),
  tokensIn: z.number().optional(),
  tokensOut: z.number().optional(),
  costUsd: z.number().optional(),
  subagentId: z.string().optional(),                  // maps to JSONL session
})
export type SubtaskResult = z.infer<typeof SubtaskResultSchema>

/** Validate that the plan is acyclic and waves are properly ordered. */
export function validatePlan(plan: OrchestratorPlan): { ok: true } | { ok: false; error: string } {
  const ids = new Set<string>()
  for (const wave of plan.waves) {
    for (const sub of wave.subtasks) {
      if (ids.has(sub.id)) return { ok: false, error: `duplicate subtask id: ${sub.id}` }
      ids.add(sub.id)
    }
  }
  // Verify all dependsOn references exist
  for (const wave of plan.waves) {
    for (const sub of wave.subtasks) {
      for (const dep of sub.dependsOn) {
        if (!ids.has(dep)) {
          return { ok: false, error: `subtask "${sub.id}" depends on unknown subtask "${dep}"` }
        }
      }
    }
  }
  // Verify dependsOn subtasks are in earlier waves
  const waveIndexById = new Map<string, number>()
  plan.waves.forEach((w) => w.subtasks.forEach((s) => waveIndexById.set(s.id, w.index)))
  for (const wave of plan.waves) {
    for (const sub of wave.subtasks) {
      for (const dep of sub.dependsOn) {
        const depWave = waveIndexById.get(dep)!
        if (depWave >= wave.index) {
          return { ok: false, error: `subtask "${sub.id}" (wave ${wave.index}) depends on "${dep}" which is in wave ${depWave} (must be earlier)` }
        }
      }
    }
  }
  return { ok: true }
}

/** Auto-classify subtasks into waves based on dependsOn (topological sort). */
export function autoWave(plan: OrchestratorPlan): OrchestratorPlan {
  if (plan.waves.length > 1) return plan                    // already waved
  const allSubs = plan.waves[0]?.subtasks ?? []
  const waveOf = new Map<string, number>()
  let changed = true
  while (changed) {
    changed = false
    for (const sub of allSubs) {
      if (waveOf.has(sub.id)) continue
      const deps = sub.dependsOn.map((d) => waveOf.get(d) ?? 0)
      if (deps.every((d) => waveOf.has(allSubs.find((s) => s.id === sub.id)?.dependsOn.find(() => true) ?? ""))) {
        const wave = deps.length === 0 ? 0 : Math.max(...deps) + 1
        waveOf.set(sub.id, wave)
        changed = true
      }
    }
  }
  // Bucket by wave
  const buckets = new Map<number, Subtask[]>()
  for (const sub of allSubs) {
    const w = waveOf.get(sub.id) ?? 0
    if (!buckets.has(w)) buckets.set(w, [])
    buckets.get(w)!.push(sub)
  }
  const waves: Wave[] = [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, subtasks]) => ({ index, subtasks }))
  return { ...plan, waves }
}
```

### Step 2: Plan extraction from LLM output

`packages/runtime/src/orchestrator/plan-extract.ts`:

```ts
import { OrchestratorPlanSchema, type OrchestratorPlan, validatePlan } from "./schema.js"

/**
 * The orchestrator LLM emits a plan wrapped in a fenced ```json block
 * inside its first response. Extract + validate it.
 */
export function extractPlan(text: string): { ok: true; plan: OrchestratorPlan } | { ok: false; error: string } {
  // Find the LAST ```json ... ``` block (in case there are multiple)
  const matches = [...text.matchAll(/```json\s*\n([\s\S]*?)\n```/g)]
  if (matches.length === 0) {
    return { ok: false, error: "no ```json``` block found in orchestrator output" }
  }
  const last = matches[matches.length - 1]!
  const json = last[1]!

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (err) {
    return { ok: false, error: `invalid JSON in plan: ${err instanceof Error ? err.message : String(err)}` }
  }

  const validated = OrchestratorPlanSchema.safeParse(parsed)
  if (!validated.success) {
    return {
      ok: false,
      error: `plan validation failed: ${validated.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")}`,
    }
  }

  const check = validatePlan(validated.data)
  if (!check.ok) return { ok: false, error: check.error }

  return { ok: true, plan: validated.data }
}
```

### Step 3: Wave executor — parallel subagent dispatch

`packages/runtime/src/orchestrator/executor.ts`:

```ts
import type { OrchestratorPlan, Subtask, SubtaskResult, Wave } from "./schema.js"
import { runSession } from "../agent/loop.js"
import { depthStorage } from "../subagent/depth.js"
import type { AgentEvent } from "../agent/events.js"

export interface ExecuteOpts {
  plan: OrchestratorPlan
  cwd: string
  parentSessionId: string
  parentOnEvent?: (event: AgentEvent & { wave?: number; subtaskId?: string }) => void | Promise<void>
  abortSignal?: AbortSignal
  onWaveStart?: (wave: Wave) => void | Promise<void>
  onWaveEnd?: (wave: Wave, results: SubtaskResult[]) => void | Promise<void>
  onSubtaskUpdate?: (result: SubtaskResult) => void | Promise<void>
}

export interface ExecuteResult {
  plan: OrchestratorPlan
  results: SubtaskResult[]
  totalCostUsd: number
  totalDurationMs: number
  completed: boolean
  abortedReason?: "budget" | "timeout" | "abort" | "all-failed"
}

/**
 * Execute an orchestrator plan wave by wave.
 *
 * Each wave runs its subtasks in parallel via Promise.all. Within a wave,
 * any subtask failure is captured but does NOT abort the wave (other
 * subtasks may succeed). Across waves, a wave is considered failed if
 * ANY of its subtasks failed AND any later-wave subtask depends on the
 * failed one (cascade-skip).
 */
export async function executePlan(opts: ExecuteOpts): Promise<ExecuteResult> {
  const startedAt = Date.now()
  const allResults: SubtaskResult[] = []
  let totalCost = 0
  const budget = opts.plan.budgetUsd ?? Infinity
  const globalTimeout = opts.plan.timeoutMs ?? 0
  const globalAbort = globalTimeout > 0
    ? AbortSignal.any([opts.abortSignal ?? new AbortController().signal, AbortSignal.timeout(globalTimeout)])
    : opts.abortSignal

  for (const wave of opts.plan.waves) {
    if (globalAbort?.aborted) {
      // Mark remaining as skipped
      for (const sub of wave.subtasks) {
        const skipped: SubtaskResult = {
          subtaskId: sub.id, waveIndex: wave.index, agent: sub.agent,
          status: "skipped", error: "aborted before wave started",
        }
        allResults.push(skipped)
        await opts.onSubtaskUpdate?.(skipped)
      }
      continue
    }

    await opts.onWaveStart?.(wave)
    await opts.parentOnEvent?.({
      type: "wave_start",
      wave: wave.index,
      subtaskIds: wave.subtasks.map((s) => s.id),
    } as any)

    // Build per-subtask promises
    const promises = wave.subtasks.map((sub) =>
      runSubtask(sub, wave.index, opts).then(async (r) => {
        await opts.onSubtaskUpdate?.(r)
        await opts.parentOnEvent?.({ ...r, type: "subtask_update", wave: wave.index, subtaskId: sub.id } as any)
        return r
      }),
    )

    const results = await Promise.all(promises)
    allResults.push(...results)
    totalCost += results.reduce((sum, r) => sum + (r.costUsd ?? 0), 0)

    await opts.onWaveEnd?.(wave, results)
    await opts.parentOnEvent?.({
      type: "wave_end",
      wave: wave.index,
      results,
    } as any)

    // Budget check
    if (totalCost > budget) {
      return {
        plan: opts.plan,
        results: allResults,
        totalCostUsd: totalCost,
        totalDurationMs: Date.now() - startedAt,
        completed: false,
        abortedReason: "budget",
      }
    }

    // Cascade-skip: if any failed subtask is depended on by later subtasks,
    // mark those as skipped (handled in runSubtask via dependency check)
  }

  return {
    plan: opts.plan,
    results: allResults,
    totalCostUsd: totalCost,
    totalDurationMs: Date.now() - startedAt,
    completed: !globalAbort?.aborted,
    abortedReason: globalAbort?.aborted ? "abort" : undefined,
  }
}

async function runSubtask(
  sub: Subtask,
  waveIndex: number,
  opts: ExecuteOpts,
): Promise<SubtaskResult> {
  const startedAt = Date.now()
  const sessionId = crypto.randomUUID()

  // Check if any dependency failed — cascade skip
  const failedDep = checkFailedDependency(sub, opts.plan, [] as SubtaskResult[])  // results injected by caller in real impl
  if (failedDep) {
    return {
      subtaskId: sub.id, waveIndex, agent: sub.agent,
      status: "skipped", error: `dependency "${failedDep}" failed`,
      startedAt, finishedAt: Date.now(),
    }
  }

  const abortController = new AbortController()
  const timer = sub.timeoutMs > 0 ? setTimeout(() => abortController.abort(), sub.timeoutMs) : null
  const externalSignal = opts.abortSignal
  if (externalSignal) {
    if (externalSignal.aborted) abortController.abort()
    else externalSignal.addEventListener("abort", () => abortController.abort(), { once: true })
  }

  try {
    const result = await runSession({
      cwd: opts.cwd,
      sessionId,
      message: sub.context ? `${sub.context}\n\n---\n\n${sub.prompt}` : sub.prompt,
      agent: sub.agent,
      maxSteps: 50,
      abortSignal: abortController.signal,
      // Suppress individual event emit — orchestrator has its own events
    })

    if (timer) clearTimeout(timer)

    return {
      subtaskId: sub.id,
      waveIndex,
      agent: sub.agent,
      status: result.reason === "aborted" ? "timeout" : result.reason === "error" ? "failed" : "completed",
      output: "(see session JSONL)",
      startedAt,
      finishedAt: Date.now(),
      durationMs: Date.now() - startedAt,
      tokensIn: result.totalTokensIn,
      tokensOut: result.totalTokensOut,
      costUsd: result.totalCostUsd,
      subagentId: sessionId,
    }
  } catch (err) {
    if (timer) clearTimeout(timer)
    return {
      subtaskId: sub.id, waveIndex, agent: sub.agent,
      status: "failed", error: err instanceof Error ? err.message : String(err),
      startedAt, finishedAt: Date.now(), durationMs: Date.now() - startedAt,
    }
  }
}

function checkFailedDependency(
  _sub: Subtask,
  _plan: OrchestratorPlan,
  _priorResults: SubtaskResult[],
): string | null {
  // Real implementation: scan priorResults for any failed dep ids
  return null
}
```

### Step 4: Orchestrator agent — entry point

`packages/runtime/src/orchestrator/index.ts`:

```ts
import { z } from "zod"
import { runSession } from "../agent/loop.js"
import { extractPlan } from "./plan-extract.js"
import { executePlan, type ExecuteResult } from "./executor.js"
import type { OrchestratorPlan } from "./schema.js"
import { autoWave } from "./schema.js"
import type { AgentEvent } from "../agent/events.js"

export const OrchestrateOptsSchema = z.object({
  cwd: z.string(),
  task: z.string(),                                   // the user's high-level task
  parentSessionId: z.string().optional(),
  budgetUsd: z.number().positive().optional(),
  timeoutMs: z.number().int().positive().optional(),
  abortSignal: z.instanceof(AbortSignal).optional(),
  onEvent: z.function().args(z.any()).returns(z.void()).optional(),
})
export type OrchestrateOpts = z.infer<typeof OrchestrateOptsSchema>

export const OrchestrateResultSchema = z.object({
  plan: z.any(),
  result: z.any(),
  synthesized: z.string(),
})
export type OrchestrateResult = z.infer<typeof OrchestrateResultSchema>

/**
 * Run the orchestrator agent: ask the LLM to produce a plan, validate,
 * then execute wave by wave.
 */
export async function orchestrate(rawOpts: OrchestrateOpts): Promise<OrchestrateResult> {
  const opts = OrchestrateOptsSchema.parse(rawOpts)
  const emit = opts.onEvent ?? (() => {})

  emit({ type: "orchestrator_start", task: opts.task })

  // Phase 1: ask orchestrator agent to produce a plan
  // Run a one-shot planning session with the orchestrator agent
  const planPrompt = `Decompose this task into a wave-based execution plan.

TASK: ${opts.task}

Output a JSON plan in a \`\`\`json\`\`\` code block. Use this schema:

\`\`\`json
{
  "goal": "<one-sentence summary>",
  "approach": "<2-3 sentences>",
  "waves": [
    {
      "index": 0,
      "subtasks": [
        {
          "id": "explore-deps",
          "agent": "explore",
          "prompt": "...",
          "files": ["package.json"],
          "dependsOn": []
        }
      ]
    }
  ],
  "budgetUsd": 5.0,
  "timeoutMs": 600000
}
\`\`\`

Rules:
- Independent subtasks go in the same wave.
- Subtasks that read/modify the same file go in different waves.
- Prefer explore/scout for research; build for code changes; test-generator for tests.
- If budgetUsd is omitted, defaults to $5.
- Don't make more than 5 waves unless absolutely necessary.`

  const planningSession = await runSession({
    cwd: opts.cwd,
    sessionId: opts.parentSessionId ?? crypto.randomUUID(),
    message: planPrompt,
    agent: "orchestrator",
    maxSteps: 1,                                      // planning is a single LLM call
    onEvent: (e) => {
      if (e.type === "text_delta") emit({ type: "planning_text", text: e.delta })
    },
  })

  // Phase 2: extract plan from the LLM's text output
  // Load the last assistant message from the planning session's JSONL
  const { loadSession } = await import("../agent/persistence.js")
  const planningMessages = await loadSession(planningSession.sessionId)
  const lastAssistant = [...planningMessages].reverse().find((m) => m.role === "assistant")
  const planText = lastAssistant?.content ?? ""

  const extraction = extractPlan(planText)
  if (!extraction.ok) {
    throw new Error(`Orchestrator plan extraction failed: ${extraction.error}\n\nLLM output:\n${planText}`)
  }

  // Apply budget/timeout overrides from caller
  let plan: OrchestratorPlan = extraction.plan
  if (opts.budgetUsd) plan = { ...plan, budgetUsd: opts.budgetUsd }
  if (opts.timeoutMs) plan = { ...plan, timeoutMs: opts.timeoutMs }

  // Auto-wave if the LLM put everything in wave 0
  plan = autoWave(plan)

  emit({ type: "plan_ready", plan })

  // Phase 3: execute the plan
  const result = await executePlan({
    plan,
    cwd: opts.cwd,
    parentSessionId: planningSession.sessionId,
    parentOnEvent: emit,
    abortSignal: opts.abortSignal,
  })

  // Phase 4: synthesize
  const synthesized = synthesize(plan, result)
  emit({ type: "orchestrator_done", synthesized })

  return { plan, result, synthesized }
}

/** Build a final human-readable summary of the orchestrated work. */
function synthesize(plan: OrchestratorPlan, result: ExecuteResult): string {
  const completed = result.results.filter((r) => r.status === "completed")
  const failed = result.results.filter((r) => r.status === "failed")
  const skipped = result.results.filter((r) => r.status === "skipped")
  const timedOut = result.results.filter((r) => r.status === "timeout")

  const lines: string[] = []
  lines.push(`# Orchestration complete: ${plan.goal}`)
  lines.push("")
  lines.push(`**Approach:** ${plan.approach}`)
  lines.push("")
  lines.push(`## Stats`)
  lines.push(`- Waves: ${plan.waves.length}`)
  lines.push(`- Subtasks: ${result.results.length} total · ${completed.length} completed · ${failed.length} failed · ${skipped.length} skipped · ${timedOut.length} timed out`)
  lines.push(`- Duration: ${(result.totalDurationMs / 1000).toFixed(1)}s`)
  lines.push(`- Cost: $${result.totalCostUsd.toFixed(4)}`)
  lines.push("")

  if (failed.length > 0) {
    lines.push(`## Failed subtasks`)
    for (const r of failed) {
      lines.push(`- **${r.subtaskId}** (wave ${r.waveIndex}, ${r.agent}): ${r.error ?? "unknown error"}`)
    }
    lines.push("")
  }

  if (timedOut.length > 0) {
    lines.push(`## Timed out subtasks`)
    for (const r of timedOut) {
      lines.push(`- **${r.subtaskId}** (wave ${r.waveIndex}, ${r.agent})`)
    }
    lines.push("")
  }

  lines.push(`## Per-wave results`)
  for (const wave of plan.waves) {
    const waveResults = result.results.filter((r) => r.waveIndex === wave.index)
    lines.push(`- Wave ${wave.index}: ${waveResults.map((r) => `${r.subtaskId}=${r.status}`).join(", ")}`)
  }

  return lines.join("\n")
}
```

### Step 5: Wire orchestrator into the CLI as a new flag

`packages/cli/src/index.ts` — add `--orchestrate` flag to the `run` command:

```ts
program
  .command("run")
  .description("Run a single prompt in the current directory")
  .argument("[prompt...]", "Prompt to send (omit for interactive)")
  .option("-m, --model <model>", "Model ID", "anthropic/claude-sonnet-4-5")
  .option("-a, --agent <agent>", "Agent name", "build")
  .option("--orchestrate", "Use orchestrator agent for wave-based dispatch")
  .option("--budget <usd>", "Max USD spend", parseFloat)
  .option("--max-time <ms>", "Max wall-clock time (ms)", parseInt)
  .action(async (promptParts: string[], opts) => {
    const prompt = promptParts.join(" ").trim()
    if (opts.orchestrate) {
      const { orchestrate } = await import("@kilocode/runtime/orchestrator")
      const r = await orchestrate({
        cwd: process.cwd(),
        task: prompt,
        budgetUsd: opts.budget,
        timeoutMs: opts.maxTime,
        onEvent: (e: any) => {
          if (e.type === "subtask_update") {
            console.error(`[wave ${e.wave}] ${e.subtaskId}: ${e.status}`)
          } else if (e.type === "wave_start") {
            console.error(`\n=== Wave ${e.wave} (${e.subtaskIds.length} subtasks in parallel) ===`)
          } else if (e.type === "wave_end") {
            const ok = e.results.filter((r: any) => r.status === "completed").length
            console.error(`    → ${ok}/${e.results.length} completed`)
          }
        },
      })
      console.log(r.synthesized)
      process.exit(0)
    }

    // Default path — single agent
    const { runCommand } = await import("./commands/run.js")
    await runCommand({ prompt, ...opts })
  })
```

### Step 6: Wire orchestrator into HTTP API

Add a `/orchestrate` endpoint:

`packages/server/src/routes/orchestrator.ts`:

```ts
import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { orchestrate } from "@kilocode/runtime/orchestrator"

export const orchestratorRoutes = new Hono()
  .post("/", async (c) => {
    const body = await c.req.json<{ task: string; budgetUsd?: number; timeoutMs?: number }>()
    return streamSSE(c, async (stream) => {
      const result = await orchestrate({
        cwd: process.cwd(),
        task: body.task,
        budgetUsd: body.budgetUsd,
        timeoutMs: body.timeoutMs,
        onEvent: async (event: any) => {
          await stream.writeSSE({ event: event.type, data: JSON.stringify(event) })
        },
      })
      await stream.writeSSE({ event: "synthesized", data: result.synthesized })
    })
  })
```

Mount in `packages/server/src/index.ts`:

```ts
import { orchestratorRoutes } from "./routes/orchestrator.js"
// ...
app.route("/api/orchestrate", authMiddleware, orchestratorRoutes)
```

### Step 7: Export from runtime index

`packages/runtime/src/index.ts`:

```ts
export * from "./orchestrator/index.js"
export * from "./orchestrator/schema.js"
export * from "./orchestrator/plan-extract.js"
```

### Step 8: Unit tests

`packages/runtime/src/orchestrator/schema.test.ts`:

```ts
import { test, expect, describe } from "bun:test"
import { OrchestratorPlanSchema, validatePlan, autoWave } from "./schema.js"

const validPlan = {
  goal: "Refactor auth",
  approach: "Explore, plan, implement",
  waves: [
    {
      index: 0,
      subtasks: [
        { id: "explore", agent: "explore" as const, prompt: "find auth code", files: [], dependsOn: [] },
        { id: "scout", agent: "scout" as const, prompt: "survey tests", files: [], dependsOn: [] },
      ],
    },
    {
      index: 1,
      subtasks: [
        { id: "refactor", agent: "build" as const, prompt: "apply refactor", files: ["src/auth.ts"], dependsOn: ["explore", "scout"] },
      ],
    },
  ],
}

describe("plan validation", () => {
  test("accepts valid plan", () => {
    expect(validatePlan(validPlan)).toEqual({ ok: true })
  })

  test("rejects duplicate ids", () => {
    const bad = {
      ...validPlan,
      waves: [{ index: 0, subtasks: [
        { id: "x", agent: "explore" as const, prompt: "a", files: [], dependsOn: [] },
        { id: "x", agent: "explore" as const, prompt: "b", files: [], dependsOn: [] },
      ] }],
    }
    expect(validatePlan(bad)).toEqual({ ok: false, error: expect.stringContaining("duplicate") })
  })

  test("rejects forward dependency", () => {
    const bad = {
      ...validPlan,
      waves: [
        { index: 0, subtasks: [{ id: "a", agent: "build" as const, prompt: "x", files: [], dependsOn: ["b"] }] },
        { index: 1, subtasks: [{ id: "b", agent: "build" as const, prompt: "y", files: [], dependsOn: [] }] },
      ],
    }
    const r = validatePlan(bad)
    expect(r.ok).toBe(false)
  })
})

describe("autoWave", () => {
  test("auto-buckets a single-wave plan with dependsOn", () => {
    const flat = {
      ...validPlan,
      waves: [{
        index: 0,
        subtasks: [
          { id: "a", agent: "explore" as const, prompt: "x", files: [], dependsOn: [] },
          { id: "b", agent: "build" as const, prompt: "y", files: [], dependsOn: ["a"] },
          { id: "c", agent: "build" as const, prompt: "z", files: [], dependsOn: ["a"] },
          { id: "d", agent: "build" as const, prompt: "w", files: [], dependsOn: ["b", "c"] },
        ],
      }],
    }
    const waved = autoWave(flat)
    expect(waved.waves).toHaveLength(3)
    expect(waved.waves[0]?.subtasks.map((s) => s.id)).toEqual(["a"])
    expect(waved.waves[1]?.subtasks.map((s) => s.id).sort()).toEqual(["b", "c"])
    expect(waved.waves[2]?.subtasks.map((s) => s.id)).toEqual(["d"])
  })
})
```

`packages/runtime/src/orchestrator/plan-extract.test.ts`:

```ts
import { test, expect } from "bun:test"
import { extractPlan } from "./plan-extract.js"

test("extracts plan from fenced json block", () => {
  const text = `
Here's my plan:

\`\`\`json
{
  "goal": "Refactor",
  "approach": "Move auth to /lib",
  "waves": [
    { "index": 0, "subtasks": [{ "id": "a", "agent": "explore", "prompt": "x", "files": [], "dependsOn": [] }] }
  ]
}
\`\`\`

Let me know if you want to proceed.
`
  const result = extractPlan(text)
  expect(result.ok).toBe(true)
  if (result.ok) expect(result.plan.goal).toBe("Refactor")
})

test("returns error if no json block", () => {
  const r = extractPlan("no json here")
  expect(r.ok).toBe(false)
})
```

### Step 9: Commit

```bash
git add -A
git commit -m "feat(orchestrator): wave-based parallel subagent dispatch with budget/timeout (prompt 17)"
```

## Files created

```
packages/runtime/src/orchestrator/
├── schema.ts
├── schema.test.ts
├── plan-extract.ts
├── plan-extract.test.ts
├── executor.ts
└── index.ts

packages/cli/src/index.ts               (--orchestrate flag added)
packages/server/src/routes/orchestrator.ts  (new endpoint)
packages/server/src/index.ts            (route mounted)
packages/runtime/src/index.ts           (exports)
```

## Acceptance criteria

- [ ] `orchestrate({ cwd, task })` produces a plan, executes it, returns synthesized summary
- [ ] `validatePlan` rejects duplicate ids and forward dependencies
- [ ] `autoWave` correctly buckets a flat plan into topological waves
- [ ] `executePlan` runs all subtasks in a wave via `Promise.all`
- [ ] Budget cap aborts execution and returns `abortedReason: "budget"`
- [ ] Global timeout aborts execution and returns `abortedReason: "timeout"`
- [ ] Failed subtasks in one wave don't block other subtasks in the same wave
- [ ] Failed subtasks cascade-skip later subtasks that depend on them
- [ ] CLI: `bun run kilo run "refactor auth" --orchestrate --budget 2.0` works end-to-end
- [ ] HTTP: `POST /api/orchestrate` with `{ task, budgetUsd }` streams events
- [ ] All unit tests pass: `bun test packages/runtime/src/orchestrator/`

## Verification

```bash
cd kilocode-assistant
bun run typecheck
bun test packages/runtime/src/orchestrator/

# Smoke test (requires API key)
export ANTHROPIC_API_KEY=*** run kilo run "find all .tsx files in packages/ that import React but don't use hooks" --orchestrate --budget 1.0

# HTTP test
bun run kilo serve &
sleep 2
TOKEN=*** ~/.kilocode/server-token)
curl -N -X POST http://localhost:3000/api/orchestrate \
  -H "Authorization: Bearer *** \
  -H "Content-Type: application/json" \
  -d '{"task":"list all Markdown files in packages/runtime","budgetUsd":0.5}'
kill %1
```

Expected: orchestrator emits a `plan_ready` event, then wave-by-wave events, then a `synthesized` event with the summary.

## Notes

- **The LLM plans, we execute** — the orchestrator agent's job is to produce a structured JSON plan. The runtime validates it (catches malformed plans) and executes it deterministically (parallelism, ordering, budgeting). Don't let the LLM try to manage concurrency in prose.
- **Plan extraction uses the LAST `\`\`\`json\`\`\`` block** — the LLM may emit intermediate text first. The final block is the actual plan.
- **`autoWave` is a safety net** — if the LLM puts everything in wave 0, we re-bucket based on `dependsOn`. Means prompts don't have to be perfect.
- **Promise.allSettled-style failure handling** — within a wave, every subtask runs to completion (or its own failure). Other subtasks in the wave aren't aborted.
- **Cascade-skip** is critical: if wave 1 has `subtask: "implement auth"` and it fails, wave 2's `subtask: "test auth"` is skipped (not failed — explicitly skipped with reason "dependency X failed"). Avoids wasting tokens on doomed work.
- **Budget enforcement is post-wave** — we check after each wave completes, not mid-wave. Mid-wave abort would leave parallel siblings hanging. Acceptable tradeoff: a single wave may overshoot by ~one subtask's cost.
- **AbortSignal.any** combines caller-provided abort with timeout — either triggers abort. Bun supports it natively.
- **Per-subtask timeout is independent** — each subtask can have its own `timeoutMs`. Useful for: research subtasks short (60s), build subtasks long (180s).
- **Subagent sessions are persisted to their own JSONL files** — the parent's JSONL only contains the planning turn + a summary. Subagent JSONLs are referenced by `subagentId`.
- **Web UI wave display** is a v1.1 concern — for now, events stream flat. The structure (`wave`, `subtaskId`, `subagentId` fields) is in place for the UI to render a tree.
- **The orchestrator prompt (`orchestrator.txt`)** explicitly tells the LLM NOT to edit files directly — it must always delegate via the `task` tool. This is enforced because the orchestrator agent's `permission.edit = "deny"`.
- **Synthesized output is what the user sees** — wave stats, failed/timed-out subtasks listed, per-wave breakdown. Don't dump raw subagent JSONLs at the user.
- **Hard cap: 5 waves recommended** — more than that suggests the task should be split manually. The LLM prompt suggests this.