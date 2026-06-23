# Prompt 11: Plan Mode Tools (plan_enter, plan_write, plan_exit)

## Goal

Implement Kilo Code's **plan mode** lifecycle as three tools — `plan_enter` (switch to the read-only `plan` agent, freeze file edits), `plan_write` (update the plan markdown with Goal / Approach / Files / Tests / Risks sections), `plan_exit` (signal the plan is ready; hand off to the `build` agent for implementation). Plans persist to `~/.kilocode/plans/<sessionID>.md` and to the session JSONL (prompt 25 wires the JSONL side). The plan is rendered in the web UI as a side panel that the user reviews before approving.

## Context (from prompts 01-10)

- Monorepo + provider + tool registry + filesystem + bash + todowrite + question all work (prompts 01-10).
- The `plan` and `build` agents don't exist yet — those come in prompt 13 (agent schema + registry). For now, the plan tools write to `~/.kilocode/plans/` and the registry has placeholder agent names.
- `ctx.ask()` exists (prompt 06). The plan tools use it for two distinct gates:
  1. `plan_enter` → "Do you want to switch to plan mode?" (one-shot user prompt)
  2. `plan_exit` → "Approve this plan and start building?" (one-shot user prompt)
- Permission gating: `plan_enter` and `plan_exit` are typically `"ask"` — they're state-changing transitions the user should approve. `plan_write` is typically `"allow"` — it's just writing a markdown file in a known location.

References:
- `../../02-competitive-research.md` §3 + §6 — Kilo Code's plan mode UX
- `../../03-system-architecture.md` §7 — plan mode state machine
- Real Kilo source:
  - `kilocode-clone/packages/opencode/src/tool/plan.ts` (re-exports from kilocode/tool/plan.ts)
  - `kilocode-clone/packages/opencode/src/kilocode/tool/plan.ts` — the actual plan_exit
  - `kilocode-clone/packages/opencode/src/kilocode/plan-file.ts` — PlanFile.resolve / display
  - `kilocode-clone/packages/opencode/src/kilocode/agent/index.ts` — `planGuard`, `planEditGuard`

## Task

### Step 1: Plan file storage

`packages/runtime/src/state/plan-file.ts`:

```ts
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from "fs"
import { join, dirname, basename } from "path"
import { homedir } from "os"

/**
 * Resolve the absolute path where a plan file should be stored.
 *
 * Precedence (first wins):
 *   1. `instance.directory + "/.kilo/plans/<title>.md"` (project-local)
 *   2. `instance.directory + "/plans/<title>.md"`
 *   3. `instance.directory + "/.plans/<title>.md"`
 *   4. `~/.kilocode/plans/<sessionID>.md` (global, default)
 *
 * The sessionID-based filename ensures uniqueness across sessions in the
 * same directory.
 */
export function resolvePlanPath(opts: {
  sessionID: string
  instanceDir: string
  customPath?: string
}): string {
  if (opts.customPath) {
    // Custom path supplied by the agent — only allowed inside the worktree.
    const abs = opts.customPath.startsWith("/")
      ? opts.customPath
      : join(opts.instanceDir, opts.customPath)
    return abs
  }

  const sessionShort = opts.sessionID.slice(0, 8)
  const candidates = [
    join(opts.instanceDir, ".kilo", "plans", `${sessionShort}.md`),
    join(opts.instanceDir, "plans", `${sessionShort}.md`),
    join(opts.instanceDir, ".plans", `${sessionShort}.md`),
    join(homedir(), ".kilocode", "plans", `${opts.sessionID}.md`),
  ]
  // Return the first candidate path (writeable). Don't check existence —
  // we always WRITE, not READ.
  return candidates[0]!
}

export function writePlan(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, "utf-8")
}

export function readPlan(path: string): string {
  if (!existsSync(path)) return ""
  return readFileSync(path, "utf-8")
}

export function planExists(path: string): boolean {
  return existsSync(path) && statSync(path).isFile()
}

export function planDisplayPath(path: string): string {
  return path.replace(homedir(), "~")
}
```

### Step 2: Plan mode state machine

`packages/runtime/src/state/plan-mode.ts`:

```ts
/**
 * Process-local registry of active plan-mode sessions.
 *
 * Each session can be in one of three states:
 *   - "build"   — normal mode, full tool access
 *   - "plan"    — read-only mode, only `plan_write` can edit files
 *   - "exit"    — transient: plan_exit was called, awaiting user approval
 *
 * Prompt 13 wires this into the agent registry; prompt 15 (the agent loop)
 * consults `getMode()` to decide which tools to enable for the current
 * session.
 *
 * v1: in-memory Map. Prompt 25 persists to session JSONL.
 */

export type PlanMode = "build" | "plan" | "exit"

class PlanModeStore {
  private modes = new Map<string, PlanMode>()
  private plans = new Map<string, string>()   // sessionID → plan file path

  getMode(sessionID: string): PlanMode {
    return this.modes.get(sessionID) ?? "build"
  }

  setMode(sessionID: string, mode: PlanMode): void {
    this.modes.set(sessionID, mode)
  }

  getPlanPath(sessionID: string): string | undefined {
    return this.plans.get(sessionID)
  }

  setPlanPath(sessionID: string, path: string): void {
    this.plans.set(sessionID, path)
  }

  isReadOnly(sessionID: string): boolean {
    const mode = this.getMode(sessionID)
    return mode === "plan" || mode === "exit"
  }
}

export const planModeStore = new PlanModeStore()
```

### Step 3: Plan section validation

`packages/runtime/src/tools/plan/sections.ts`:

```ts
import { z } from "zod"

/**
 * The canonical plan sections — Kilo Code convention. The model fills
 * these in (with `plan_write`) to produce a reviewable plan document.
 *
 * All sections are optional; the UI flags empty sections as "not addressed".
 * The `Risks` section is highly recommended.
 */
export const PlanSectionName = z.enum([
  "Goal",
  "Approach",
  "Files",
  "Tests",
  "Risks",
])
export type PlanSectionName = z.infer<typeof PlanSectionName>

export const PlanSectionSchema = z.object({
  name: PlanSectionName,
  content: z.string().min(1).max(50_000),
})

export const SECTIONS_ORDER: PlanSectionName[] = [
  "Goal", "Approach", "Files", "Tests", "Risks",
]

export function renderPlanSections(sections: Array<{ name: PlanSectionName; content: string }>): string {
  const byName = new Map(sections.map((s) => [s.name, s.content]))
  const lines: string[] = ["# Plan", ""]
  for (const name of SECTIONS_ORDER) {
    const content = byName.get(name)
    lines.push(`## ${name}`, "")
    if (content) lines.push(content, "")
    else lines.push("_(not addressed)_", "")
  }
  return lines.join("\n")
}
```

### Step 4: plan_enter tool

`packages/runtime/src/tools/plan_enter.ts`:

```ts
import { z } from "zod"
import type { ToolExport } from "./tool.js"
import { planModeStore } from "../state/plan-mode.js"
import { resolvePlanPath } from "../state/plan-file.js"

const ENTER_OPTIONS = [
  {
    label: "Yes, switch to plan mode (Recommended)",
    description: "Read-only exploration; I'll review and approve before any edits",
  },
  {
    label: "No, proceed in build mode",
    description: "Skip planning — make changes directly",
  },
]

/**
 * plan_enter — switch from build mode to plan mode.
 *
 * In plan mode the agent can:
 *   - read files
 *   - run read-only bash commands (grep, ls, cat, test runners)
 *   - call `question` to clarify
 *   - call `plan_write` to draft the plan
 *   - call `plan_exit` when done
 *
 * It CANNOT: write/edit files, run mutating bash commands (rm, mv, git commit).
 * The agent loop (prompt 15) consults `planModeStore.isReadOnly()` and
 * filters out write-class tools.
 */
export const planEnterTool: ToolExport = {
  id: "plan_enter",
  description: "Switch to plan mode (read-only) for designing an approach before implementation",
  parameters: z.object({}),   // no args — one-shot transition
  execute: async (_args, ctx) => {
    // Permission gate (typically `ask` — user must approve).
    await ctx.ask({
      permission: "plan_enter",
      patterns: ["*"],
      metadata: { fromMode: planModeStore.getMode(ctx.sessionID) },
    })

    // Ask user to confirm via the question mechanism.
    const { questionStore } = await import("../state/questions.js")
    const id = crypto.randomUUID()

    await ctx.metadata({
      title: "Switching to plan mode",
      metadata: {
        planEnter: {
          id,
          fromMode: planModeStore.getMode(ctx.sessionID),
          options: ENTER_OPTIONS,
        },
      },
    })

    const answer = await new Promise<string>((resolve, reject) => {
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        resolve("No, proceed in build mode")   // default to no on timeout
      }, 5 * 60 * 1000)

      const onAbort = () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(new Error("aborted"))
      }
      if (ctx.abort) ctx.abort.addEventListener("abort", onAbort)

      questionStore.add({
        id,
        sessionID: ctx.sessionID,
        toolCallID: undefined,
        questions: [{
          question: "Switch to plan mode? You'll review the plan before any code is changed.",
          header: "Plan mode",
          options: ENTER_OPTIONS as any,
          multi_select: false,
        }],
        createdAt: Date.now(),
        resolve: (ans) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          if (ctx.abort) ctx.abort.removeEventListener("abort", onAbort)
          const choice = Object.values(ans)[0]
          resolve(typeof choice === "string" ? choice : ENTER_OPTIONS[1]!.label)
        },
        reject: (err) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          if (ctx.abort) ctx.abort.removeEventListener("abort", onAbort)
          reject(err)
        },
      })
    })

    if (!answer.startsWith("Yes")) {
      return {
        title: "Plan mode declined",
        output: "User declined plan mode. Continue in build mode.",
        metadata: { mode: planModeStore.getMode(ctx.sessionID), planEntered: false },
      }
    }

    // Switch to plan mode.
    planModeStore.setMode(ctx.sessionID, "plan")

    // Pre-allocate the plan file path.
    const instanceDir = ctx.cwd
    const planPath = resolvePlanPath({ sessionID: ctx.sessionID, instanceDir })
    planModeStore.setPlanPath(ctx.sessionID, planPath)

    return {
      title: "Switched to plan mode",
      output:
        `Plan mode enabled. You can now read files and run read-only commands to research the task.\n` +
        `Use plan_write to draft sections, then plan_exit when the plan is ready for review.\n` +
        `Plan file will be saved to: ${planPath}`,
      metadata: {
        mode: "plan",
        planEntered: true,
        planPath,
      },
    }
  },
}
```

### Step 5: plan_write tool

`packages/runtime/src/tools/plan_write.ts`:

```ts
import { z } from "zod"
import type { ToolExport } from "./tool.js"
import { planModeStore } from "../state/plan-mode.js"
import { resolvePlanPath, writePlan, readPlan } from "../state/plan-file.js"
import { renderPlanSections, PlanSectionSchema, SECTIONS_ORDER } from "./plan/sections.js"

/**
 * plan_write — replace one or more sections of the current plan.
 *
 * The agent calls this repeatedly while drafting (Goal first, then Approach,
 * then Files, etc.). Sections merge: passing only `Files` keeps the other
 * sections from the previous write.
 *
 * Calling with `{ sections: [] }` clears the plan (rare).
 *
 * If not already in plan mode, `plan_write` will implicitly enter it
 * (mirrors Kilo Code's behavior — agents can skip plan_enter and just
 * write directly, which auto-elevates).
 */
export const planWriteTool: ToolExport = {
  id: "plan_write",
  description: "Write or update sections of the current plan document",
  parameters: z.object({
    sections: z.array(PlanSectionSchema).max(SECTIONS_ORDER.length)
      .describe("Sections to write/replace. Pass 1+ sections."),
  }),
  execute: async (args, ctx) => {
    // Auto-enter plan mode if we're in build mode.
    if (planModeStore.getMode(ctx.sessionID) === "build") {
      planModeStore.setMode(ctx.sessionID, "plan")
    }

    // Resolve the plan path (allocate on first write).
    let planPath = planModeStore.getPlanPath(ctx.sessionID)
    if (!planPath) {
      planPath = resolvePlanPath({ sessionID: ctx.sessionID, instanceDir: ctx.cwd })
      planModeStore.setPlanPath(ctx.sessionID, planPath)
    }

    // Merge with existing sections.
    const existing = parseExistingPlan(readPlan(planPath))
    const byName = new Map(existing.map((s) => [s.name, s.content]))
    for (const s of args.sections) byName.set(s.name, s.content)
    const merged = SECTIONS_ORDER
      .map((name) => ({ name, content: byName.get(name) ?? "" }))
      .filter((s) => s.content)

    // Permission gate (typically `allow` for plan_write — file is in a
    // known plan location).
    await ctx.ask({
      permission: "edit",
      patterns: [planPath],
      metadata: { sections: args.sections.map((s) => s.name) },
    })

    const rendered = renderPlanSections(merged)
    writePlan(planPath, rendered)

    return {
      title: `Plan updated (${args.sections.length} section${args.sections.length > 1 ? "s" : ""})`,
      output: rendered,
      metadata: {
        planPath,
        sections: merged,
        updatedSections: args.sections.map((s) => s.name),
      },
    }
  },
}

function parseExistingPlan(raw: string): Array<{ name: any; content: string }> {
  if (!raw) return []
  const out: Array<{ name: any; content: string }> = []
  const blocks = raw.split(/^## /m).slice(1)   // drop the "# Plan" header
  for (const block of blocks) {
    const nl = block.indexOf("\n")
    if (nl === -1) continue
    const name = block.slice(0, nl).trim()
    const content = block.slice(nl + 1).trim()
    out.push({ name, content })
  }
  return out
}
```

### Step 6: plan_exit tool

`packages/runtime/src/tools/plan_exit.ts`:

```ts
import { z } from "zod"
import type { ToolExport } from "./tool.js"
import { planModeStore } from "../state/plan-mode.js"
import { resolvePlanPath, readPlan, planDisplayPath } from "../state/plan-file.js"
import { questionStore } from "../state/questions.js"

const EXIT_OPTIONS = [
  {
    label: "Approve & start building (Recommended)",
    description: "Switch to build mode and implement the plan",
  },
  {
    label: "Refine the plan",
    description: "Stay in plan mode — let me revise",
  },
  {
    label: "Discard plan",
    description: "Abandon this plan; go back to build mode without changes",
  },
]

/**
 * plan_exit — finalize the plan and request user approval.
 *
 * The plan file is read back and shown in full to the user (via the web
 * UI). The user picks Approve / Refine / Discard.
 *
 * On Approve: mode switches back to `build`, the plan is marked as the
 * session's reference, and the next agent turn runs the `build` agent.
 * On Refine: stay in plan mode (agent re-drafts).
 * On Discard: back to build mode, plan deleted.
 */
export const planExitTool: ToolExport = {
  id: "plan_exit",
  description: "Finalize the plan and request user approval to start implementation",
  parameters: z.object({
    path: z.string().optional()
      .describe("Optional workspace-local path to a custom plan file. Pass if you saved the plan somewhere other than the default location."),
  }),
  execute: async (args, ctx) => {
    // Read the plan back to display it.
    const storedPath = planModeStore.getPlanPath(ctx.sessionID)
    const planPath = args.path
      ? resolvePlanPath({ sessionID: ctx.sessionID, instanceDir: ctx.cwd, customPath: args.path })
      : storedPath

    if (!planPath) {
      throw new Error("plan_exit: no plan file found. Use plan_write to draft the plan first.")
    }

    const planContent = readPlan(planPath)
    if (!planContent) {
      throw new Error(`plan_exit: plan file is empty: ${planPath}`)
    }

    // Permission gate.
    await ctx.ask({
      permission: "plan_exit",
      patterns: ["*"],
      metadata: { planPath, planBytes: planContent.length },
    })

    // Ask the user via the question mechanism.
    const id = crypto.randomUUID()
    await ctx.metadata({
      title: "Planning complete",
      metadata: {
        planExit: {
          id,
          planPath: planDisplayPath(planPath),
          planContent,
          options: EXIT_OPTIONS,
        },
      },
    })

    const answer = await new Promise<string>((resolve, reject) => {
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        resolve(EXIT_OPTIONS[0]!.label)   // default: approve on timeout
      }, 10 * 60 * 1000)

      const onAbort = () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(new Error("aborted"))
      }
      if (ctx.abort) ctx.abort.addEventListener("abort", onAbort)

      questionStore.add({
        id,
        sessionID: ctx.sessionID,
        toolCallID: undefined,
        questions: [{
          question: `Plan is ready at ${planDisplayPath(planPath)}. Approve and start building?`,
          header: "Approve plan",
          options: EXIT_OPTIONS as any,
          multi_select: false,
        }],
        createdAt: Date.now(),
        resolve: (ans) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          if (ctx.abort) ctx.abort.removeEventListener("abort", onAbort)
          const choice = Object.values(ans)[0]
          resolve(typeof choice === "string" ? choice : EXIT_OPTIONS[0]!.label)
        },
        reject: (err) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          if (ctx.abort) ctx.abort.removeEventListener("abort", onAbort)
          reject(err)
        },
      })
    })

    if (answer.startsWith("Approve")) {
      planModeStore.setMode(ctx.sessionID, "build")
      return {
        title: "Plan approved — building",
        output: `Plan approved. Plan file: ${planDisplayPath(planPath)}\n\n${planContent}`,
        metadata: { mode: "build", planPath, planContent, planApproved: true },
      }
    }

    if (answer.startsWith("Refine")) {
      planModeStore.setMode(ctx.sessionID, "plan")
      return {
        title: "Refining plan",
        output: "User asked to refine the plan. Continue in plan mode.",
        metadata: { mode: "plan", planPath, planApproved: false, planRefined: true },
      }
    }

    // Discard.
    planModeStore.setMode(ctx.sessionID, "build")
    return {
      title: "Plan discarded",
      output: "User discarded the plan. Continuing in build mode.",
      metadata: { mode: "build", planPath, planApproved: false, planDiscarded: true },
    }
  },
}
```

### Step 7: Three tool description files

`packages/runtime/src/tools/plan_enter.txt`:

```
Use this tool to suggest switching to plan agent when the user's request would benefit from planning before implementation.

If they explicitly mention wanting to create a plan ALWAYS call this tool first.

This tool will ask the user if they want to switch to plan agent.

Call this tool when:
- The user's request is complex and would benefit from planning first
- You want to research and design before making changes
- The task involves multiple files or significant architectural decisions

Do NOT call this tool:
- For simple, straightforward tasks
- When the user explicitly wants immediate implementation

When you call this tool, the user will be prompted to approve the switch. On approval, you enter read-only mode: you can read files, run read-only commands (grep, ls, cat, test runners), and call `question` for clarification, but you cannot edit files or run mutating commands. Use `plan_write` to draft the plan, then `plan_exit` to finalize.
```

`packages/runtime/src/tools/plan_write.txt`:

```
Use this tool to draft or update sections of the current plan document while in plan mode.

## Sections

The plan document has 5 canonical sections, in this order:
1. **Goal** — what the user wants to achieve (1-3 sentences)
2. **Approach** — the high-level strategy (bullet points or short prose)
3. **Files** — list of files that will be created or modified, with one-line descriptions
4. **Tests** — how the change will be verified (test names, manual steps)
5. **Risks** — what could go wrong; mitigations

## Usage

- Pass an array of `{ name, content }` to update one or more sections
- Pass sections in any order — they merge into the existing plan
- The full plan is re-rendered on every call (it's a deterministic view of all sections)
- Sections you don't pass are preserved
- Calling with an empty array clears the plan

## When to write

- Once you understand the Goal (write it first)
- After research / exploration (update Approach + Files)
- After identifying test approach (write Tests)
- Before calling plan_exit (Risks is the last thing to write)

Plan mode is automatically entered on first plan_write call (you don't need to call plan_enter first).
```

`packages/runtime/src/tools/plan_exit.txt`:

```
Signal that planning is complete and the plan is ready for implementation.

Call this tool once you have finalized the plan file and are confident it is ready. This ends your planning turn and hands control back to the user. If you saved the plan to a custom workspace-local path, pass that path in the `path` argument.

Call this tool:
- After you have written a complete plan to the plan file
- After you have clarified any questions with the user
- When you are confident the plan is ready for implementation

Do NOT call this tool:
- Before you have created or finalized the plan
- If you still have unanswered questions about the implementation
- If the user has indicated they want to continue planning

When you call this tool, the user is shown the full plan and asked to approve. On approval, the session switches to build mode and the implementing agent takes over.
```

### Step 8: Wire into runtime barrel

`packages/runtime/src/state/index.ts` — add:

```ts
export { planModeStore, type PlanMode } from "./plan-mode.js"
export { resolvePlanPath, writePlan, readPlan, planExists, planDisplayPath } from "./plan-file.js"
```

### Step 9: Commit

```bash
git add -A
git commit -m "feat(tools): plan mode — plan_enter, plan_write, plan_exit (prompt 11)"
```

## Files created

```
packages/runtime/src/
├── state/
│   ├── plan-mode.ts        # in-memory mode registry (build | plan | exit)
│   └── plan-file.ts        # plan file path resolution + read/write
└── tools/
    ├── plan/
    │   └── sections.ts     # Zod schemas + renderPlanSections
    ├── plan_enter.ts       # switch to plan mode (with confirmation)
    ├── plan_enter.txt
    ├── plan_write.ts       # draft/update plan sections
    ├── plan_write.txt
    ├── plan_exit.ts        # finalize plan + approval gate
    └── plan_exit.txt
```

Plus 1 line added to `packages/runtime/src/state/index.ts`.

## Acceptance criteria

- [ ] `bun run typecheck` passes
- [ ] `createBuiltinRegistry()` includes `plan_enter`, `plan_write`, `plan_exit`
- [ ] `reg.execute("plan_enter", {}, ctx)` switches the mode and returns `metadata.planEntered: true`
- [ ] `planModeStore.getMode(sessionID)` returns `"plan"` after a successful `plan_enter`
- [ ] `planModeStore.isReadOnly(sessionID)` returns `true` after `plan_enter`
- [ ] If user declines `plan_enter`, `planModeStore.getMode()` stays `"build"` (no change)
- [ ] `reg.execute("plan_write", { sections: [{ name: "Goal", content: "..." }] }, ctx)` writes to the plan file
- [ ] After `plan_write` with Goal section, `readPlan(planPath)` contains the Goal content
- [ ] After `plan_write` with Files section, then `plan_write` with Tests section, both sections persist (merge behavior)
- [ ] `plan_write` auto-enters plan mode if called from build mode
- [ ] `reg.execute("plan_exit", {}, ctx)` reads back the plan and prompts for approval
- [ ] If user approves, `planModeStore.getMode()` returns `"build"` (back to normal)
- [ ] If user chooses Refine, mode stays `"plan"`
- [ ] `plan_exit` without a prior `plan_write` throws a clear error
- [ ] `resolvePlanPath({ sessionID, instanceDir: "/tmp/proj" })` returns `/tmp/proj/.kilo/plans/<8hex>.md`
- [ ] Plan file's parent directory is created on write (no ENOENT errors)
- [ ] `renderPlanSections` produces a markdown document with all 5 sections in order
- [ ] All three tools' `ctx.metadata()` calls fire before blocking on user input
- [ ] 5-minute timeout on `plan_enter` defaults to "No" (stay in build)
- [ ] 10-minute timeout on `plan_exit` defaults to "Approve" (move forward)
- [ ] Permission gates fire for all three tools (via `ctx.ask`)

## Verification

```bash
cd kilocode-assistant
bun install
bun run typecheck

mkdir -p /tmp/kilo-plan-test && cd /tmp/kilo-plan-test

cd /path/to/kilocode-assistant
bun --eval '
import { createBuiltinRegistry } from "@kilocode/runtime/tools"
import { planModeStore } from "@kilocode/runtime/state"
import { questionStore } from "@kilocode/runtime/state"
import { readPlan } from "@kilocode/runtime/state"
import { renderPlanSections } from "@kilocode/runtime/tools/plan/sections"

const reg = await createBuiltinRegistry()
console.log("tools:", reg.ids().filter(t => t.startsWith("plan")))

const ctx = {
  sessionID: crypto.randomUUID(),
  messageID: "m1",
  cwd: "/tmp/kilo-plan-test",
  abort: new AbortController().signal,
  ask: async () => { console.log("[ask]"); },
  metadata: async () => { console.log("[metadata]"); },
}

// Test 1: plan_enter (simulate user clicking "Yes")
console.log("--- plan_enter (yes) ---")
const ePromise = reg.execute("plan_enter", {}, ctx)
setTimeout(() => {
  const q = questionStore.list()[0]
  if (q) questionStore.resolve(q.id, { "Switch to plan mode?": "Yes, switch to plan mode (Recommended)" })
}, 50)
const e1 = await ePromise
console.log("title:", e1.title)
console.log("entered:", e1.metadata.planEntered)
console.log("planPath:", e1.metadata.planPath)
console.log("mode now:", planModeStore.getMode(ctx.sessionID))
console.log("isReadOnly:", planModeStore.isReadOnly(ctx.sessionID))

// Test 2: plan_write Goal
const w1 = await reg.execute("plan_write", {
  sections: [{ name: "Goal", content: "Add user authentication via OAuth 2.0." }],
}, ctx)
console.log("--- plan_write Goal ---")
console.log("title:", w1.title)
console.log("file exists:", !!readPlan(w1.metadata.planPath))

// Test 3: plan_write Approach + Files (merges with Goal)
await reg.execute("plan_write", {
  sections: [
    { name: "Approach", content: "- Use passport.js\n- Store sessions in Postgres\n- CSRF tokens" },
    { name: "Files", content: "- src/auth/oauth.ts (new)\n- src/middleware/session.ts (new)" },
  ],
}, ctx)
const full = readPlan(w1.metadata.planPath)
console.log("--- merged plan ---")
console.log(full.slice(0, 400))

// Test 4: plan_write auto-enters mode (reset)
planModeStore.setMode(ctx.sessionID, "build")
await reg.execute("plan_write", {
  sections: [{ name: "Goal", content: "X" }],
}, ctx)
console.log("--- auto-enter ---")
console.log("mode after write:", planModeStore.getMode(ctx.sessionID))

// Test 5: plan_exit (simulate user clicking "Approve")
console.log("--- plan_exit (approve) ---")
const xPromise = reg.execute("plan_exit", {}, ctx)
setTimeout(() => {
  const q = questionStore.list()[0]
  if (q) questionStore.resolve(q.id, { "Plan is ready": "Approve & start building (Recommended)" })
}, 50)
const x1 = await xPromise
console.log("approved:", x1.metadata.planApproved)
console.log("mode now:", planModeStore.getMode(ctx.sessionID))
console.log("output starts:", x1.output.slice(0, 100))

// Test 6: plan_exit without prior plan_write
planModeStore.setMode(ctx.sessionID, "plan")
planModeStore.setPlanPath(ctx.sessionID, "/nonexistent/path/plan.md")
try {
  await reg.execute("plan_exit", {}, { ...ctx, sessionID: "fresh-" + Date.now() })
  console.log("--- empty plan: NO ERROR (BUG) ---")
} catch (e) {
  console.log("--- empty plan: rejected ✓ ---")
  console.log("msg:", e.message.slice(0, 60))
}

// Test 7: section rendering
const rendered = renderPlanSections([
  { name: "Goal", content: "Do X" },
  { name: "Approach", content: "Use Y" },
  { name: "Risks", content: "Z" },
])
console.log("--- rendered plan ---")
console.log(rendered)
'

rm -rf /tmp/kilo-plan-test
```

Expected output: 7 sections print, mode transitions match, plan file persists, merge behavior correct, validation errors trigger.

## Notes

- **Why three tools, not one?** Each tool has a distinct lifecycle position and distinct permission. `plan_enter` is a one-shot transition (the user decides once). `plan_write` is repeatable (the agent iterates). `plan_exit` is another one-shot (the user approves once). Combining them would force the agent to pass a "what phase am I in?" arg — error-prone.
- **Auto-enter on `plan_write`.** Kilo Code's behavior: if the agent skips `plan_enter` and calls `plan_write` directly, we auto-elevate. This matches the "obvious intent" principle — the agent clearly wants to plan.
- **Why permission-gate `plan_enter` AND `plan_exit` with `ctx.ask()` AND a separate `question` prompt?** Two layers: `ctx.ask({ permission: "plan_enter" })` checks the agent's permission config (e.g. headless mode might `"deny"` plan mode entirely); the `question` step is the in-flight UI prompt (always shown if reached). Different concerns.
- **Default on timeout.** `plan_enter` defaults to "No" (safer — don't switch without confirmation). `plan_exit` defaults to "Approve" (more useful — don't strand the user in plan mode if they walked away).
- **Plan file path resolution.** Mirrors Kilo Code's `kilocode/plan-file.ts` — project-local first (`.kilo/plans/`), global fallback (`~/.kilocode/plans/`). The session-short prefix (8 hex) prevents filename collisions across concurrent sessions.
- **Markdown rendering is deterministic.** Every `plan_write` produces the same file contents for the same sections (no timestamps, no random IDs). This means the diff between two writes is purely the section changes — useful for review UIs.
- **Read-only enforcement is in the agent loop, not the tools.** The bash tool can still execute `rm -rf /` — but the loop refuses to call it (because `planModeStore.isReadOnly()` is true and the bash allowlist excludes mutating commands). This prompt doesn't implement the loop filter — that's prompt 15.
- **Plan persistence to JSONL comes in prompt 25.** For now, plans live in `~/.kilocode/plans/<sessionID>.md`. The web UI reads them on demand.
- **Why not store the plan in the session messages?** Plans can be 10s of KB — bloating every message. Keeping them in a separate file means the session log stays compact and the plan file is readable on its own.
- **"Refine" vs "Reject" choice.** Kilo gives the user three options: approve / refine / discard. Approve moves forward; refine keeps planning; discard aborts. Three is the minimum for a meaningful UX (two would conflate refine+discard).
- **The `path` parameter on `plan_exit`.** Allows the agent to write the plan to a different location (e.g. inside a docs folder) and still exit cleanly. Kilo Code supports this for org-mode workflows where plans are checked in.
- **Permission: `"ask"` for `plan_enter`/`plan_exit`, `"allow"` for `plan_write`.** This is the Kilo default. It's set up in prompt 13's agent registry. v2 lets users override per-agent.
- **Section ordering is fixed.** Goal → Approach → Files → Tests → Risks. The UI renders them in this order even if the agent writes them out of order. Helps reviewers scan.
- **Empty plan rejection.** `plan_exit` requires non-empty content — empty plans are a bug (the agent forgot to write). Throw a clear error so the LLM retries `plan_write`.
- **Future: streaming plan updates.** The web UI could show the plan being typed in real-time as the agent writes each section. v1 just re-renders on every `plan_write` call.
- **Multi-agent handoff.** When the user approves, the next agent turn runs the `build` agent with the plan as part of the system prompt. Prompt 17 (orchestrator) wires this handoff.
- **No "skip plan mode" prompt.** If `kilo.json` has `mode: "build"`, the loop doesn't prompt — it just runs the build agent directly. The `plan_enter` tool is only called if the model decides planning is needed.
- **Plan files in `.gitignore` by default.** Users typically don't want plans tracked. Add to `.kilo/plans/` and `.plans/` to a project-local `.gitignore` is a recommendation in the docs but not enforced.
