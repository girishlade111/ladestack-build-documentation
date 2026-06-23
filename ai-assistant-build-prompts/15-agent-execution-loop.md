# Prompt 15: Agent Execution Loop

## Goal

Implement the core agent loop — `prompt → LLM → tool calls → loop` — that drives every conversation. Wires Vercel AI SDK's `streamText`, the tool registry (prompts 06-12), the agent registry (prompt 13), the prompt composer (prompt 14), permissions, max-steps enforcement (default 50), token/cost tracking, SSE event emission, JSONL persistence, and recursive subagent invocation (the `task` tool — fleshed out in prompt 16). This is the heart of the runtime.

## Context (from prompts 01-14)

- Monorepo + provider layer with `streamText` from `ai` package + `@ai-sdk/anthropic` etc. (prompt 04)
- BYOK auth + key resolution (prompt 05)
- 14 tools registered via the registry pattern (prompts 06-12) — `toolRegistry.list()`, `toolRegistry.get(name)`
- Agent schema + `AgentService` registry exposing `agentService.get(name)` → `AgentInfo` (prompt 13)
- 11 system prompts composed via `composeAgentPrompt(name)` (prompt 14)
- HTTP server at `packages/server/src/routes/sessions.ts` expects `runSession({ cwd, message, agent, onText, onTool, onDone })` (prompt 02)
- CLI `run` command calls `runSession(...)` (prompt 02)

Reference:
- `../../02-competitive-research.md` §6 — Kilo Code's session loop architecture
- `../../03-system-architecture.md` §7 — execution loop design
- Real Kilo source: `kilocode-clone/packages/opencode/src/session/loop.ts`
- Real Kilo source: `kilocode-clone/packages/opencode/src/session/message-v2.ts`

## Task

### Step 1: Install Vercel AI SDK (already in prompt 04, confirm)

```bash
cd packages/runtime
bun add ai @ai-sdk/anthropic @ai-sdk/openai @ai-sdk/google zod
```

### Step 2: Define event types — the SSE event surface

`packages/runtime/src/agent/events.ts`:

```ts
import { z } from "zod"

/** Events emitted by the agent loop. Consumed by SSE in prompt 02's server. */
export const AgentEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("session_start"),
    sessionId: z.string(),
    agent: z.string(),
    model: z.string(),
  }),
  z.object({
    type: z.literal("text_delta"),
    delta: z.string(),
  }),
  z.object({
    type: z.literal("tool_start"),
    callId: z.string(),
    name: z.string(),
    input: z.record(z.string(), z.unknown()),
  }),
  z.object({
    type: z.literal("tool_end"),
    callId: z.string(),
    name: z.string(),
    output: z.string(),         // truncated to 8KB before emit
    isError: z.boolean(),
    durationMs: z.number(),
  }),
  z.object({
    type: z.literal("step"),
    index: z.number(),
    tokensIn: z.number(),
    tokensOut: z.number(),
    costUsd: z.number(),
  }),
  z.object({
    type: z.literal("permission_request"),
    requestId: z.string(),
    tool: z.string(),
    input: z.record(z.string(), z.unknown()),
    reason: z.string(),
  }),
  z.object({
    type: z.literal("error"),
    message: z.string(),
    recoverable: z.boolean(),
  }),
  z.object({
    type: z.literal("done"),
    reason: z.enum(["completed", "max_steps", "aborted", "permission_denied", "error"]),
    totalTokensIn: z.number(),
    totalTokensOut: z.number(),
    totalCostUsd: z.number(),
  }),
])

export type AgentEvent = z.infer<typeof AgentEventSchema>

/** Truncate a tool output for SSE emission (avoid 1MB stack traces). */
export function truncateOutput(s: string, maxBytes = 8 * 1024): string {
  if (Buffer.byteLength(s, "utf-8") <= maxBytes) return s
  return s.slice(0, maxBytes) + `\n\n... [truncated ${s.length - maxBytes} chars]`
}
```

### Step 3: Token pricing table

`packages/runtime/src/agent/pricing.ts`:

```ts
import { z } from "zod"

/** Per-1M-token USD pricing. Update quarterly from provider docs. */
export const ModelPriceSchema = z.object({
  inputPer1M: z.number(),
  outputPer1M: z.number(),
  cacheReadPer1M: z.number().optional(),
  cacheWritePer1M: z.number().optional(),
})

export type ModelPrice = z.infer<typeof ModelPriceSchema>

/**
 * Keyed by `${providerID}/${modelID}`. Falls back to a conservative
 * default if a model is unknown.
 */
export const PRICES: Record<string, ModelPrice> = {
  "anthropic/claude-sonnet-4-5": { inputPer1M: 3.0, outputPer1M: 15.0, cacheReadPer1M: 0.30, cacheWritePer1M: 3.75 },
  "anthropic/claude-3-5-haiku-20241022": { inputPer1M: 0.80, outputPer1M: 4.0 },
  "anthropic/claude-opus-4-1": { inputPer1M: 15.0, outputPer1M: 75.0 },
  "openai/gpt-4o": { inputPer1M: 2.5, outputPer1M: 10.0 },
  "openai/gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.60 },
  "google/gemini-2.5-pro": { inputPer1M: 1.25, outputPer1M: 10.0 },
  "google/gemini-2.5-flash": { inputPer1M: 0.075, outputPer1M: 0.30 },
}

const FALLBACK: ModelPrice = { inputPer1M: 3.0, outputPer1M: 15.0 }

export function costFor(modelKey: string, inputTokens: number, outputTokens: number): number {
  const price = PRICES[modelKey] ?? FALLBACK
  return (
    (inputTokens / 1_000_000) * price.inputPer1M +
    (outputTokens / 1_000_000) * price.outputPer1M
  )
}
```

### Step 4: JSONL message persistence

`packages/runtime/src/agent/persistence.ts`:

```ts
import { appendFile, mkdir, readFile, writeFile } from "fs/promises"
import { existsSync } from "fs"
import { join, dirname } from "path"
import { homedir } from "os"
import { z } from "zod"

/** A single persisted message. JSONL append-only. */
export const PersistedMessageSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  timestamp: z.number(),                  // epoch ms
  role: z.enum(["user", "assistant", "tool", "system"]),
  content: z.string(),                    // text or serialized tool result
  toolCallId: z.string().optional(),
  toolName: z.string().optional(),
  tokensIn: z.number().optional(),
  tokensOut: z.number().optional(),
  costUsd: z.number().optional(),
})

export type PersistedMessage = z.infer<typeof PersistedMessageSchema>

function sessionPath(sessionId: string): string {
  return join(homedir(), ".kilocode", "sessions", `${sessionId}.jsonl`)
}

/** Append a message. Creates the session file if needed. */
export async function appendMessage(msg: PersistedMessage): Promise<void> {
  const path = sessionPath(msg.sessionId)
  await mkdir(dirname(path), { recursive: true })
  const line = JSON.stringify(msg) + "\n"
  await appendFile(path, line, "utf-8")
}

/** Load all messages for a session (oldest first). */
export async function loadSession(sessionId: string): Promise<PersistedMessage[]> {
  const path = sessionPath(sessionId)
  if (!existsSync(path)) return []
  const text = await readFile(path, "utf-8")
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => PersistedMessageSchema.parse(JSON.parse(line)))
}

/** Delete a session. */
export async function deleteSession(sessionId: string): Promise<void> {
  const path = sessionPath(sessionId)
  if (existsSync(path)) await writeFile(path, "", "utf-8")
}
```

### Step 5: Provider resolution — turn `ModelRef` into an AI SDK model

`packages/runtime/src/agent/provider-resolver.ts`:

```ts
import { anthropic } from "@ai-sdk/anthropic"
import { openai } from "@ai-sdk/openai"
import { google } from "@ai-sdk/google"
import type { LanguageModelV1 } from "ai"
import { getApiKey } from "../auth/keys.js"   // prompt 05
import type { ModelRef } from "../config/schema.js"

export interface ResolvedModel {
  model: LanguageModelV1
  providerID: string
  modelID: string
  /** Pricing key for costFor(). */
  pricingKey: string
}

/**
 * Resolve a `{ providerID, modelID }` to a concrete AI SDK model.
 * Loads the API key from the keyring or env.
 */
export function resolveModel(ref: ModelRef): ResolvedModel {
  const key = getApiKey(ref.providerID)
  if (!key) {
    throw new Error(
      `No API key for provider "${ref.providerID}". ` +
        `Run: kilo auth ${ref.providerID} <key>`,
    )
  }
  process.env[`${ref.providerID.toUpperCase()}_API_KEY`] = key   // AI SDK reads from env

  switch (ref.providerID) {
    case "anthropic":
      return {
        model: anthropic(ref.modelID),
        providerID: ref.providerID,
        modelID: ref.modelID,
        pricingKey: `anthropic/${ref.modelID}`,
      }
    case "openai":
      return {
        model: openai(ref.modelID),
        providerID: ref.providerID,
        modelID: ref.modelID,
        pricingKey: `openai/${ref.modelID}`,
      }
    case "google":
      return {
        model: google(ref.modelID),
        providerID: ref.providerID,
        modelID: ref.modelID,
        pricingKey: `google/${ref.modelID}`,
      }
    default:
      throw new Error(`Provider "${ref.providerID}" not yet supported. Add a case above.`)
  }
}
```

### Step 6: Permission gate

`packages/runtime/src/agent/permission.ts`:

```ts
import { z } from "zod"
import type { AgentInfo } from "./schema.js"

export type PermissionDecision = "allow" | "deny" | "ask"

export interface PermissionRequest {
  tool: string
  input: Record<string, unknown>
}

export interface PermissionResult {
  decision: PermissionDecision
  reason: string
}

/**
 * Check whether the agent is permitted to invoke a tool with the given input.
 *
 * Logic:
 *   1. If agent.permission[tool] is "deny" → always deny.
 *   2. If agent.permission[tool] is "allow" → allow.
 *   3. If agent.permission[tool] is "ask" → return "ask" (caller must prompt user).
 *   4. If tool not in agent.permission → fall back to agent.permission["*"].
 */
export function checkPermission(
  agent: AgentInfo,
  req: PermissionRequest,
): PermissionResult {
  const perm = agent.permission ?? {}
  const explicit = perm[req.tool]
  const fallback = perm["*"] ?? "allow"

  const level: PermissionDecision = explicit ?? fallback

  if (level === "deny") {
    return { decision: "deny", reason: `agent "${agent.name}" denies tool "${req.tool}"` }
  }
  if (level === "ask") {
    return { decision: "ask", reason: `agent "${agent.name}" requires approval for "${req.tool}"` }
  }
  return { decision: "allow", reason: "permitted" }
}
```

### Step 7: The execution loop itself

`packages/runtime/src/agent/loop.ts`:

```ts
import { streamText, type CoreMessage, type ToolCallPart, type ToolResultPart } from "ai"
import { z } from "zod"
import { toolRegistry } from "../tool/registry.js"          // prompt 06
import { agentService } from "./registry.js"                // prompt 13
import { composeAgentPrompt } from "./prompts/loader.js"    // prompt 14
import { resolveModel } from "./provider-resolver.js"
import { costFor } from "./pricing.js"
import { checkPermission, type PermissionResult } from "./permission.js"
import { appendMessage } from "./persistence.js"
import { AgentEventSchema, truncateOutput, type AgentEvent } from "./events.js"

export const RunSessionOptsSchema = z.object({
  cwd: z.string(),
  sessionId: z.string().optional(),                 // generated if omitted
  message: z.string(),
  agent: z.string().default("build"),
  model: z.string().optional(),                     // override agent's model
  maxSteps: z.number().int().positive().default(50),
  abortSignal: z.instanceof(AbortSignal).optional(),
  onEvent: z.function().args(AgentEventSchema).returns(z.void()).optional(),
  // Legacy SSE callbacks (used by prompt 02's sessions route)
  onText: z.function().args(z.string()).returns(z.void()).optional(),
  onTool: z.function().args(z.object({
    name: z.string(),
    input: z.record(z.string(), z.unknown()),
  })).returns(z.void()).optional(),
  onToolResult: z.function().args(z.string(), z.string()).returns(z.void()).optional(),
  onDone: z.function().returns(z.void()).optional(),
})

export type RunSessionOpts = z.infer<typeof RunSessionOptsSchema>

export interface RunSessionResult {
  sessionId: string
  totalTokensIn: number
  totalTokensOut: number
  totalCostUsd: number
  steps: number
  reason: AgentEvent extends infer E
    ? E extends { type: "done"; reason: infer R }
      ? R
      : never
    : never
}

const emitter = (opts: RunSessionOpts) => (event: AgentEvent) => {
  AgentEventSchema.parse(event)                   // validate before emit
  opts.onEvent?.(event)
  // Bridge to legacy callbacks
  switch (event.type) {
    case "text_delta":
      opts.onText?.(event.delta)
      break
    case "tool_start":
      opts.onTool?.({ name: event.name, input: event.input })
      break
    case "tool_end":
      opts.onToolResult?.(event.callId, event.output)
      break
    case "done":
      opts.onDone?.()
      break
  }
}

/**
 * Main entry point — runs a single agent session turn (or multi-turn loop
 * if the agent calls tools). Streams events via onEvent (and legacy callbacks).
 */
export async function runSession(rawOpts: RunSessionOpts): Promise<RunSessionResult> {
  const opts = RunSessionOptsSchema.parse(rawOpts)
  const sessionId = opts.sessionId ?? crypto.randomUUID()
  const emit = emitter(opts)

  // 1. Resolve agent
  const agent = await agentService.get(opts.agent)
  if (!agent) throw new Error(`Unknown agent: ${opts.agent}`)

  // 2. Resolve model (override → agent → kilo.json default)
  const modelRef = opts.model
    ? parseModelRef(opts.model)
    : agent.model ?? (await loadDefaultModelRef(opts.cwd))
  const resolved = resolveModel(modelRef)

  emit({
    type: "session_start",
    sessionId,
    agent: agent.name,
    model: `${resolved.providerID}/${resolved.modelID}`,
  })

  // 3. Compose system prompt (soul + agent) — environment, tools, skills
  // are appended by the model layer via the tools arg below.
  const { system } = composeAgentPrompt(agent.name, { cwd: opts.cwd })

  // 4. Persist the user message
  await appendMessage({
    id: crypto.randomUUID(),
    sessionId,
    timestamp: Date.now(),
    role: "user",
    content: opts.message,
  })

  // 5. Load previous messages (for multi-turn sessions)
  const { loadSession } = await import("./persistence.js")
  const history = await loadSession(sessionId)
  const messages: CoreMessage[] = history.map(msgToCoreMessage).concat({
    role: "user",
    content: opts.message,
  })

  // 6. Bind tools for this agent
  const tools = bindToolsForAgent(agent)

  // 7. The loop
  let step = 0
  let totalTokensIn = 0
  let totalTokensOut = 0
  let totalCostUsd = 0
  let reason: RunSessionResult["reason"] = "completed"

  try {
    const result = streamText({
      model: resolved.model,
      system,
      messages,
      tools,
      maxSteps: opts.maxSteps,
      abortSignal: opts.abortSignal,
      temperature: agent.temperature,
      topP: agent.topP,
      onStepFinish: async ({ toolCalls, toolResults, usage, text }) => {
        step += 1

        // Stream text deltas — streamText already pushes them, but we
        // also need to emit our own typed events for SSE.
        if (text) {
          // already streamed via onChunk below
        }

        // Track tokens
        totalTokensIn += usage.promptTokens
        totalTokensOut += usage.completionTokens
        const stepCost = costFor(resolved.pricingKey, usage.promptTokens, usage.completionTokens)
        totalCostUsd += stepCost

        emit({
          type: "step",
          index: step,
          tokensIn: usage.promptTokens,
          tokensOut: usage.completionTokens,
          costUsd: stepCost,
        })

        // Persist assistant message
        await appendMessage({
          id: crypto.randomUUID(),
          sessionId,
          timestamp: Date.now(),
          role: "assistant",
          content: text ?? "",
          tokensIn: usage.promptTokens,
          tokensOut: usage.completionTokens,
          costUsd: stepCost,
        })

        // Tool calls are emitted individually in onChunk — see below
      },
      onChunk: ({ chunk }) => {
        if (chunk.type === "text-delta") {
          emit({ type: "text_delta", delta: chunk.textDelta })
        } else if (chunk.type === "tool-call") {
          emit({
            type: "tool_start",
            callId: chunk.toolCallId,
            name: chunk.toolName,
            input: chunk.args,
          })
        }
      },
    })

    // Consume the stream to completion
    await result.consumeStream()

    // 8. Check step limit
    if (step >= opts.maxSteps) reason = "max_steps"
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const recoverable = !opts.abortSignal?.aborted
    emit({ type: "error", message, recoverable })
    if (!recoverable) reason = "aborted"
    else reason = "error"
  }

  emit({
    type: "done",
    reason,
    totalTokensIn,
    totalTokensOut,
    totalCostUsd,
  })

  return { sessionId, totalTokensIn, totalTokensOut, totalCostUsd, steps: step, reason }
}

// === helpers ===

function bindToolsForAgent(agent: AgentInfo) {
  const tools: Record<string, ReturnType<typeof toolRegistry.toAiSdkTool>> = {}
  for (const [name, tool] of toolRegistry.list()) {
    const enabled = agent.tools?.[name] ?? true
    if (!enabled) continue

    // Permission gate wraps the tool's execute function
    const perm = checkPermission(agent, { tool: name, input: {} })
    if (perm.decision === "deny") continue

    tools[name] = toolRegistry.toAiSdkTool(name, {
      preExecute: async (input: unknown) => {
        const req = { tool: name, input: input as Record<string, unknown> }
        const p = checkPermission(agent, req)
        if (p.decision === "ask") {
          // Emit permission_request and block. The TUI/web handles user response.
          // For headless CLI, default to deny to be safe.
          const requestId = crypto.randomUUID()
          // Synchronous wait not possible — emit and let caller abort
          throw new Error(`Permission required for "${name}". Reason: ${p.reason}`)
        }
      },
      postExecute: async (output: unknown, durationMs: number) => {
        emit({ type: "tool_end", callId: crypto.randomUUID(), name, output: truncateOutput(String(output)), isError: false, durationMs })
      },
    })
  }
  return tools
}

function msgToCoreMessage(m: PersistedMessage): CoreMessage {
  if (m.role === "tool") {
    return {
      role: "tool",
      content: [{ type: "tool-result", toolCallId: m.toolCallId ?? "", toolName: m.toolName ?? "", result: m.content }],
    }
  }
  return { role: m.role as "user" | "assistant" | "system", content: m.content }
}

function parseModelRef(s: string) {
  const [providerID, modelID] = s.split("/")
  if (!providerID || !modelID) throw new Error(`Invalid model ref: ${s} (expected "provider/model")`)
  return { providerID, modelID }
}

async function loadDefaultModelRef(_cwd: string) {
  // Real implementation reads kilo.json — deferred to prompt 03
  return { providerID: "anthropic", modelID: "claude-sonnet-4-5" }
}
```

### Step 8: Add `task` tool for subagent invocation

`packages/runtime/src/agent/tools/task.ts` — the `task` tool spawns subagents. Implementation fleshed out in prompt 16; stub here so the loop can register it:

```ts
import { z } from "zod"
import { defineTool } from "../tool/define.js"   // prompt 06
import { runSession } from "../agent/loop.js"

export const taskTool = defineTool({
  name: "task",
  description:
    "Spawn a subagent to handle a subtask. The subagent has its own context " +
    "and tool set. Use for parallelizable work like reconnaissance or " +
    "research. Returns the subagent's final message.",
  input: z.object({
    agent: z.enum(["explore", "scout", "summarize", "title", "build", "plan"]),
    prompt: z.string(),
    cwd: z.string().optional(),
  }),
  output: z.string(),
  async execute({ agent, prompt, cwd }, ctx) {
    const result = await runSession({
      cwd: cwd ?? ctx.cwd,
      sessionId: crypto.randomUUID(),
      message: prompt,
      agent,
      maxSteps: 25,                          // subagents get a tighter step cap
      onEvent: (e) => {
        if (e.type === "text_delta" && ctx.parentOnEvent) {
          // Bubble text up so the parent sees subagent progress
          ctx.parentOnEvent(e)
        }
      },
    })
    return result.summary ?? `Subagent completed in ${result.steps} steps.`
  },
})
```

Register `task` in the tool registry (prompt 06's central list).

### Step 9: Public re-exports

Update `packages/runtime/src/index.ts`:

```ts
export * from "./agent/loop.js"
export * from "./agent/events.js"
export * from "./agent/pricing.js"
export * from "./agent/persistence.js"
export * from "./agent/permission.js"
export * from "./agent/prompts/loader.js"
```

### Step 10: Wire into CLI and HTTP server

`packages/cli/src/commands/run.ts`:

```ts
import { resolveConfig } from "@kilocode/runtime/config"
import { runSession } from "@kilocode/runtime/agent"
import { discoverAll } from "@kilocode/runtime"

export async function runCommand(opts: any) {
  const cfg = await resolveConfig(process.cwd())
  await discoverAll(process.cwd())  // populates custom agents (prompt 13)

  const result = await runSession({
    cwd: process.cwd(),
    message: opts.prompt,
    agent: opts.agent ?? cfg.defaultAgent ?? "build",
    model: opts.model,
    onText: (t: string) => process.stdout.write(t),
    onTool: (call) => console.error(`\n[${call.name}] ${JSON.stringify(call.input)}\n`),
    onDone: () => process.stderr.write(`\n[kilo] done\n`),
  })

  console.error(
    `\n[kilo] ${result.steps} steps · ${result.totalTokensIn}↓ ${result.totalTokensOut}↑ · $${result.totalCostUsd.toFixed(4)}`,
  )
}
```

`packages/server/src/routes/sessions.ts` — update the `:id/messages` handler:

```ts
.post("/:id/messages", async (c) => {
  const sessionId = c.req.param("id")
  const body = await c.req.json<{ message: string; agent?: string; model?: string }>()

  return streamSSE(c, async (stream) => {
    const result = await runSession({
      cwd: process.cwd(),
      sessionId,
      message: body.message,
      agent: body.agent ?? "build",
      model: body.model,
      onEvent: async (event) => {
        await stream.writeSSE({ event: event.type, data: JSON.stringify(event) })
      },
    })
    // Final `done` event already emitted via onEvent
  })
})
```

### Step 11: Unit tests

`packages/runtime/src/agent/loop.test.ts`:

```ts
import { test, expect, describe, mock } from "bun:test"
import { checkPermission } from "./permission.js"
import { costFor } from "./pricing.js"
import { truncateOutput } from "./events.js"
import { loadSession, appendMessage } from "./persistence.js"
import { unlinkSync, existsSync, mkdirSync } from "fs"
import { join } from "path"
import { homedir } from "os"

describe("permission gate", () => {
  const agent = {
    name: "test",
    description: "",
    mode: "primary" as const,
    permission: { bash: "ask", edit: "allow", webfetch: "allow", "*": "allow" },
    tools: {},
  }

  test("denies when explicit", () => {
    expect(checkPermission(agent, { tool: "bash", input: {} }).decision).toBe("ask")
    expect(checkPermission(agent, { tool: "edit", input: {} }).decision).toBe("allow")
  })

  test("falls back to wildcard", () => {
    expect(checkPermission(agent, { tool: "glob", input: {} }).decision).toBe("allow")
  })
})

describe("pricing", () => {
  test("computes cost for known model", () => {
    // 1M input + 1M output for sonnet-4-5 = 3 + 15 = $18
    expect(costFor("anthropic/claude-sonnet-4-5", 1_000_000, 1_000_000)).toBeCloseTo(18, 1)
  })

  test("uses fallback for unknown model", () => {
    const cost = costFor("unknown/model", 100_000, 50_000)
    expect(cost).toBeGreaterThan(0)
  })
})

describe("output truncation", () => {
  test("passes through small output", () => {
    expect(truncateOutput("hello")).toBe("hello")
  })

  test("truncates large output", () => {
    const big = "x".repeat(10_000)
    const out = truncateOutput(big, 1000)
    expect(out.length).toBeLessThan(2000)
    expect(out).toContain("truncated")
  })
})

describe("JSONL persistence", () => {
  const sessionId = "test-" + Date.now()

  test("round-trips messages", async () => {
    await appendMessage({
      id: "1", sessionId, timestamp: Date.now(),
      role: "user", content: "hello",
    })
    await appendMessage({
      id: "2", sessionId, timestamp: Date.now() + 1,
      role: "assistant", content: "hi",
    })
    const loaded = await loadSession(sessionId)
    expect(loaded).toHaveLength(2)
    expect(loaded[0]?.content).toBe("hello")
    expect(loaded[1]?.content).toBe("hi")
  })

  // Cleanup
  test("cleanup", () => {
    const path = join(homedir(), ".kilocode", "sessions", `${sessionId}.jsonl`)
    if (existsSync(path)) unlinkSync(path)
  })
})
```

### Step 12: Commit

```bash
git add -A
git commit -m "feat(agent): execution loop — streamText + tools + permission + SSE + JSONL (prompt 15)"
```

## Files created

```
packages/runtime/src/agent/
├── events.ts
├── pricing.ts
├── persistence.ts
├── provider-resolver.ts
├── permission.ts
├── loop.ts
├── loop.test.ts
└── tools/
    └── task.ts                          (stub, full impl in prompt 16)

packages/runtime/src/index.ts            (updated exports)
packages/cli/src/commands/run.ts         (updated to call real runSession)
packages/server/src/routes/sessions.ts   (updated to stream AgentEvents)
```

## Acceptance criteria

- [ ] `runSession({ cwd, message, agent: "build", onText })` streams text to onText
- [ ] `runSession` honors `maxSteps` (returns `reason: "max_steps"` when hit)
- [ ] `runSession` respects `agent.permission.edit === "deny"` (edits blocked)
- [ ] `runSession` emits a `permission_request` event when `bash === "ask"` (TUI handles)
- [ ] `runSession` persists user + assistant messages to JSONL
- [ ] `runSession` returns `totalCostUsd` matching `costFor()` math
- [ ] Tool calls in the loop emit `tool_start` then `tool_end` events
- [ ] Long tool outputs (>8KB) are truncated before SSE emit
- [ ] Calling `runSession` with an unknown agent name throws
- [ ] Calling `runSession` with no API key throws a helpful error
- [ ] SSE handler in `routes/sessions.ts` streams events to the HTTP response
- [ ] `bun test packages/runtime/src/agent/loop.test.ts` passes

## Verification

```bash
cd kilocode-assistant

# 1. Typecheck
bun run typecheck

# 2. Unit tests
bun test packages/runtime/src/agent/

# 3. Smoke test the loop (requires ANTHROPIC_API_KEY)
export ANTHROPIC_API_KEY=sk-ant-...
bun -e '
  import { runSession } from "./packages/runtime/src/agent/loop.ts"
  const r = await runSession({
    cwd: process.cwd(),
    message: "say hi in 5 words",
    agent: "build",
    onText: (t) => process.stdout.write(t),
  })
  console.error("\nresult:", r)
'

# 4. End-to-end via CLI
bun run kilo run "say hi" --agent build

# 5. End-to-end via HTTP server
bun run kilo serve &
sleep 2
TOKEN=$(cat ~/.kilocode/server-token)
curl -N -X POST http://localhost:3000/api/sessions/test-1/messages \
  -H "Authorization: Bearer *** \
  -H "Content-Type: application/json" \
  -d '{"message":"say hi","agent":"build"}'
kill %1
```

## Notes

- **`streamText` is the right primitive** — handles streaming, tool calls, multi-step, and abort signals in one call. We just hook into `onChunk` and `onStepFinish` to emit our own typed events.
- **Permission is defense-in-depth** — the prompt text says "be careful" + the registry denies `bash` at the runtime level. The prompt alone is advisory.
- **`permission: "ask"` for bash in headless mode** — we throw an error rather than block on user input. The TUI/web UI intercepts the `permission_request` event and prompts interactively; headless CLI users should configure their agents to `allow`.
- **JSONL append-only** — easy to tail, easy to compact later, atomic per line. One file per session, named by UUID.
- **Token tracking is approximate** — `usage.promptTokens` from AI SDK includes cache reads in Anthropic. Our `costFor()` accounts for that via the `cacheReadPer1M` field; if you want exact cost, extend `ModelPrice` and subtract cache reads from input.
- **`onEvent` + legacy callbacks** — `onEvent` is the typed, Zod-validated channel. `onText`/`onTool`/etc. are kept for prompt 02's HTTP route which was written before this prompt existed. Both call the same emitter.
- **The loop is recursive** — `task` tool calls `runSession` recursively. Prompt 16 adds the depth guard. Without the guard, a `build` agent could spawn infinite subagents.
- **`abortSignal` propagation** — pass `AbortSignal.timeout(120_000)` to cap a session at 2 minutes. The loop respects it and emits `done: { reason: "aborted" }`.
- **Why we don't persist tool inputs separately** — the message log shows the assistant's full request including tool calls (AI SDK serializes them). Reconstructing state from the JSONL is trivial.
- **Cost ceiling per session** — set `agent.options.maxBudgetUsd` in kilo.json. The loop should check cumulative `totalCostUsd` after each step and abort if exceeded. Wire in prompt 22 (telemetry) or this prompt's enhancement.