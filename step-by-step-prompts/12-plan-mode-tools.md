# Prompt 12: Plan Mode Tools

## Goal

Add plan mode: 3 new tools (`plan_enter`, `plan_write`, `plan_exit`) + the plan agent runtime support that lets the user toggle between Build and Plan modes.

## Context (from prompts 01-11)

- Agent loop, tool registry all built.
- Plan mode UI toggle is referenced in `../design.md` §6.3 but not yet implemented.

Reference: `../agent-loop.md` §5 (plan mode flow), `../tool-calling.md` §2.4.

## Task

### Step 1: Create the plan tools

`packages/runtime/src/tools/plan.ts`:

```ts
import { z } from "zod"
import { Tool, ToolError } from "./types.js"
import { supabaseAdmin } from "../db/client.js"
import { join } from "path"

// Track which sessions are in plan mode
const planSessions = new Set<string>()

export function isInPlanMode(sessionId: string): boolean {
  return planSessions.has(sessionId)
}

export function enterPlanMode(sessionId: string): void {
  planSessions.add(sessionId)
}

export function exitPlanMode(sessionId: string): void {
  planSessions.delete(sessionId)
}

// === plan_enter tool ===
const EnterInput = z.object({
  reason: z.string().max(200).optional()
})

const EnterOutput = z.object({
  mode: z.literal("plan"),
  availableTools: z.array(z.string())
})

export const planEnterTool: Tool<z.infer<typeof EnterInput>, z.infer<typeof EnterOutput>> = {
  name: "plan_enter",
  description: `Switches the agent into Plan mode.

In Plan mode:
- You CAN use read, glob, grep (read-only)
- You CAN use plan_write and plan_exit
- You CANNOT use write, edit, bash (locked — any attempt fails)
- You SHOULD write a structured plan to .ladestack/plan.md
- When done, call plan_exit

Call this when:
- The user's request is complex and would benefit from planning
- You want to research and design before making changes
- The task involves multiple files or architectural decisions

Do NOT call for simple, single-file changes.
`.trim(),
  inputSchema: EnterInput,
  outputSchema: EnterOutput,

  async execute(input, ctx) {
    enterPlanMode(ctx.sessionId)
    return {
      mode: "plan",
      availableTools: ["read", "glob", "grep", "plan_write", "plan_exit", "todowrite", "question"]
    }
  }
}

// === plan_write tool ===
const WriteInput = z.object({
  content: z.string().min(1).max(50_000)
})

const WriteOutput = z.object({
  path: z.string(),
  bytes: z.number()
})

export const planWriteTool: Tool<z.infer<typeof WriteInput>, z.infer<typeof WriteOutput>> = {
  name: "plan_write",
  description: `Writes a structured plan to .ladestack/plan.md. The plan is shown to the user for review before implementation begins.

Format:
# Plan: <short title>

## Goal
<one-sentence summary>

## Approach
<2-3 sentences>

## Files to create
- <path> — <purpose>

## Files to modify
- <path> — <what changes>

## Dependencies
- <package>@<version> — <purpose>

## Assumptions
- <assumption>

## Open questions (if any)
- <question>

After writing, call plan_exit with a 1-2 sentence summary.
`.trim(),
  inputSchema: WriteInput,
  outputSchema: WriteOutput,

  async execute(input, ctx) {
    if (!isInPlanMode(ctx.sessionId)) {
      throw new ToolError("must call plan_enter first", "NOT_IN_PLAN_MODE")
    }

    const { sandboxOps } = await import("../sandbox/operations.js")
    const planPath = ".ladestack/plan.md"
    await sandboxOps.write(ctx.projectId, [{ path: planPath, content: input.content }])

    // Also persist as a system message so the chat shows the plan
    await supabaseAdmin.from("messages").insert({
      session_id: ctx.sessionId,
      role: "system",
      content: `Plan written to ${planPath}:\n\n${input.content}`,
      agent: "plan"
    })

    return { path: planPath, bytes: Buffer.byteLength(input.content, "utf-8") }
  }
}

// === plan_exit tool ===
const ExitInput = z.object({
  summary: z.string().min(1).max(500)
})

const ExitOutput = z.object({
  mode: z.enum(["build", "ended"]),
  planPath: z.string()
})

export const planExitTool: Tool<z.infer<typeof ExitInput>, z.infer<typeof ExitOutput>> = {
  name: "plan_exit",
  description: `Ends Plan mode and hands control back to the user for review.

Call this ONCE after plan_write is complete.

The user will:
- Approve → implementation begins
- Edit → you may be re-engaged to revise
- Reject → end session
`.trim(),
  inputSchema: ExitInput,
  outputSchema: ExitOutput,

  async execute(input, ctx) {
    if (!isInPlanMode(ctx.sessionId)) {
      throw new ToolError("not in plan mode", "NOT_IN_PLAN_MODE")
    }
    exitPlanMode(ctx.sessionId)

    await supabaseAdmin.from("messages").insert({
      session_id: ctx.sessionId,
      role: "system",
      content: `Plan ready for review: ${input.summary}`,
      agent: "plan"
    })

    return { mode: "build", planPath: ".ladestack/plan.md" }
  }
}
```

### Step 2: Update tools registry

`packages/runtime/src/tools/registry.ts` — add to the register calls:

```ts
import { planEnterTool, planWriteTool, planExitTool, isInPlanMode } from "./plan.js"

// ...existing imports...

register(planEnterTool)
register(planWriteTool)
register(planExitTool)

export { isInPlanMode }

// Update listToolsForAgent to enforce plan-mode restrictions
export function listToolsForAgent(agentName: string): Tool[] {
  const sessionId = getCurrentSessionId()  // set by runLoop
  const restricted = ["plan", "ask", "explore", "scout"]
  let tools = listTools()

  if (restricted.includes(agentName)) {
    tools = tools.filter((t) => !["write", "edit", "bash"].includes(t.name))
  }
  if (agentName === "summarize" || agentName === "title") {
    tools = []
  }

  // Plan mode further restricts
  if (sessionId && isInPlanMode(sessionId)) {
    tools = tools.filter((t) =>
      ["read", "glob", "grep", "plan_write", "plan_exit", "todowrite", "question"].includes(t.name)
    )
  }

  return tools
}

// Helper for runLoop
let currentSessionId: string | undefined
export function setCurrentSessionId(id: string | undefined) {
  currentSessionId = id
}
function getCurrentSessionId(): string | undefined {
  return currentSessionId
}
```

### Step 3: Update agent loop to set session context

`packages/runtime/src/loop/run.ts` — add at the start of `runLoop`:

```ts
import { setCurrentSessionId } from "../tools/registry.js"

// At the start of runLoop:
setCurrentSessionId(input.sessionId)

// At the end (in finally or just before return):
setCurrentSessionId(undefined)
```

### Step 4: Wire plan mode toggle into API

Update `packages/api/src/routes/sessions.ts`:

```ts
.post("/:id/plan", async (c) => {
  const sessionId = c.req.param("id")
  // Default mode for new messages
  const session = await sessions.getSession(sessionId)
  if (!session) return c.json({ error: "session_not_found" }, 404)
  await sessions.updateSession(sessionId, { agent: "plan" })
  return c.json({ mode: "plan" })
})

.post("/:id/build", async (c) => {
  const sessionId = c.req.param("id")
  await sessions.updateSession(sessionId, { agent: "build" })
  return c.json({ mode: "build" })
})
```

### Step 5: Update runtime index

```ts
// Add to packages/runtime/src/index.ts
export { planEnterTool, planWriteTool, planExitTool, isInPlanMode, enterPlanMode, exitPlanMode } from "./tools/plan.js"
export { setCurrentSessionId } from "./tools/registry.js"
```

### Step 6: Update Plan agent in registry

`packages/runtime/src/agents/builtin.ts` — ensure plan agent's `tools` field is restrictive:

```ts
{
  name: "plan",
  displayName: "Plan",
  description: "Read-only planning agent. Use for non-trivial changes to produce a written plan before any code edits.",
  mode: "primary",
  promptPath: "plan.txt",
  tools: { write: false, edit: false, bash: false },
  color: "#7C5DDB"
}
```

(Already set in prompt 08 — verify.)

### Step 7: Tests

`packages/runtime/src/tools/plan.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { planEnterTool, planWriteTool, planExitTool, isInPlanMode, exitPlanMode } from "./plan.js"
import { ToolError } from "./types.js"

const FAKE_CTX = {
  userId: "u",
  projectId: "p",
  sessionId: "test-session-" + Date.now(),
  abortSignal: new AbortController().signal
}

describe("plan mode tools", () => {
  it("plan_enter switches to plan mode", async () => {
    const result = await planEnterTool.execute({}, FAKE_CTX)
    expect(result.mode).toBe("plan")
    expect(result.availableTools).toContain("plan_write")
    expect(result.availableTools).not.toContain("write")
    exitPlanMode(FAKE_CTX.sessionId)
  })

  it("plan_write requires plan mode", async () => {
    await expect(
      planWriteTool.execute({ content: "# Test" }, FAKE_CTX)
    ).rejects.toThrow(ToolError)
  })

  it("full plan flow works", async () => {
    await planEnterTool.execute({}, FAKE_CTX)
    expect(isInPlanMode(FAKE_CTX.sessionId)).toBe(true)
    const writeResult = await planWriteTool.execute({ content: "# Plan\nTest" }, FAKE_CTX)
    expect(writeResult.path).toBe(".ladestack/plan.md")
    const exitResult = await planExitTool.execute({ summary: "Test plan ready" }, FAKE_CTX)
    expect(exitResult.mode).toBe("build")
    expect(isInPlanMode(FAKE_CTX.sessionId)).toBe(false)
  })
})
```

### Step 8: Commit

```bash
git add -A
git commit -m "feat(runtime): plan mode with enter/write/exit tools (prompt 12)"
```

## Files created/modified

```
packages/runtime/src/tools/
├── plan.ts (new)
├── plan.test.ts (new)
└── registry.ts (update: register plan tools, plan-mode tool filtering)

packages/runtime/src/agents/builtin.ts (verify plan agent restrictions)
packages/runtime/src/loop/run.ts (setCurrentSessionId)
packages/runtime/src/index.ts (export plan tools)
packages/api/src/routes/sessions.ts (POST /:id/plan, POST /:id/build)
```

## Acceptance criteria

- [ ] `plan_enter` switches session to plan mode
- [ ] `plan_write` requires plan mode (throws if not)
- [ ] `plan_write` persists plan as system message
- [ ] `plan_write` writes file to `.ladestack/plan.md` in sandbox
- [ ] `plan_exit` ends plan mode and persists summary
- [ ] `listToolsForAgent` filters out write/edit/bash in plan mode
- [ ] `POST /:id/plan` switches session agent to plan
- [ ] `POST /:id/build` switches session agent to build

## Verification

```bash
pnpm --filter @ladestack/runtime test -- plan
# expect: 3 tests pass
```

## Notes

- **Plan mode is in-memory state.** Restarting the runtime loses plan-mode state. v1.1 persists to DB.
- **`.ladestack/plan.md` is in the sandbox.** If sandbox is destroyed, plan is lost. The system message in chat is the durable record.
- **Tool filtering at runtime is defense-in-depth.** Even if the LLM tries to call `write` in plan mode, the runtime refuses (since `write` is filtered out of the tool list sent to the LLM, this shouldn't happen, but the enforcement layer is there).
- **Plan agent's `tools: { write: false, edit: false, bash: false }`** in builtin.ts is redundant with the runtime check but provides defense-in-depth.
- **The plan UI is built in prompt 17** (ChatInput with mode toggle).
- **`isInPlanMode` is exported** because the runtime loop needs to query it. Keep the API stable.
- **Plan content can be 50k chars.** That's enough for very detailed plans; if you need more, bump the limit.
