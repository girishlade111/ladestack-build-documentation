# Prompt 10: Meta Tools (todowrite, question)

## Goal

Implement the two meta-tools — `todowrite` (structured progress tracking the agent calls to mark sub-tasks done) and `question` (one-shot clarification prompt with up to 4 multiple-choice options). Both are **agent-to-user** communication tools — they don't touch files or run code. Both write through `ctx.metadata()` so the UI (CLI / web / VS Code) renders them appropriately: `todowrite` shows a live checklist; `question` shows a prompt that blocks the agent until the user answers.

## Context (from prompts 01-09)

- Monorepo + provider + BYOK + tool registry + filesystem + search + bash all work (prompts 01-09).
- `ToolContext.ask()` already exists (prompt 06); `question` will reuse the same machinery.
- `todowrite` writes to session-scoped storage; prompt 15 wires this into the JSONL session format. For now, in-memory persistence in `packages/runtime/src/state/todos.ts` is fine.
- Permission gating: `todowrite` and `question` are typically `"allow"` (don't bother the user) — but respect the agent's `permission` config (prompt 13).

References:
- `../../02-competitive-research.md` §3 — Kilo's todowrite + question tool descriptions
- Real Kilo source:
  - `kilocode-clone/packages/opencode/src/tool/todo.ts` + `todowrite.txt`
  - `kilocode-clone/packages/opencode/src/tool/question.ts` + `question.txt`
  - `kilocode-clone/packages/opencode/src/session/todo.ts` — the session-level Todo service

## Task

### Step 1: In-memory todo storage (session-scoped)

`packages/runtime/src/state/todos.ts`:

```ts
import type { Todo } from "./todo-types.js"

/**
 * Process-local store for todos, keyed by sessionID.
 *
 * In v1 this is a Map. Prompt 25 swaps the backing store for the JSONL
 * session log so todos survive across CLI restarts. For now, process-local
 * is fine — the CLI and the web UI each have their own process.
 */
class TodoStore {
  private bySession = new Map<string, Todo[]>()

  get(sessionID: string): Todo[] {
    return this.bySession.get(sessionID) ?? []
  }

  set(sessionID: string, todos: Todo[]): void {
    this.bySession.set(sessionID, todos)
  }

  append(sessionID: string, todo: Todo): void {
    const list = this.get(sessionID)
    list.push(todo)
    this.bySession.set(sessionID, list)
  }

  clear(sessionID: string): void {
    this.bySession.delete(sessionID)
  }
}

export const todoStore = new TodoStore()
```

`packages/runtime/src/state/todo-types.ts`:

```ts
import { z } from "zod"

/**
 * The canonical todo item shape — used by todowrite's parameter schema,
 * the TodoStore, and the web UI's checklist component.
 *
 * Status values match Anthropic's Claude Code convention (which Kilo Code
 * also adopted). Priority is a soft hint — the UI sorts but the model
 * chooses.
 */
export const TodoStatusSchema = z.enum(["pending", "in_progress", "completed", "cancelled"])
export const TodoPrioritySchema = z.enum(["high", "medium", "low"])

export const TodoSchema = z.object({
  content: z.string().min(1).max(500),
  status: TodoStatusSchema,
  priority: TodoPrioritySchema,
})

export type Todo = z.infer<typeof TodoSchema>
```

### Step 2: todowrite tool

`packages/runtime/src/tools/todowrite.ts`:

```ts
import { z } from "zod"
import type { ToolExport } from "./tool.js"
import { todoStore } from "../state/todos.js"
import { TodoSchema } from "../state/todo-types.js"

const MAX_TODOS = 50

/**
 * todowrite — replace the entire todo list for this session.
 *
 * The model is expected to call this tool:
 *   1. Once at the start of a multi-step task (with the planned steps as pending)
 *   2. Each time it finishes a step (marking it completed, picking the next as in_progress)
 *
 * The web UI renders the list as a live checklist; the CLI prints a delta.
 *
 * Empty `todos` array clears the list (rarely useful, but allowed).
 */
export const todowriteTool: ToolExport = {
  id: "todowrite",
  description: "Track multi-step tasks with a structured checklist",
  parameters: z.object({
    todos: z.array(TodoSchema).max(MAX_TODOS)
      .describe("The full todo list. Replaces any prior list. Must include every step the agent is working on."),
  }),
  execute: async (args, ctx) => {
    // Validate: at most one item can be in_progress at a time.
    const inProgress = args.todos.filter((t) => t.status === "in_progress")
    if (inProgress.length > 1) {
      throw new Error(
        `todowrite validation: at most one todo may be 'in_progress', got ${inProgress.length}: ` +
        inProgress.map((t) => `"${t.content}"`).join(", ")
      )
    }

    // Validate: items must be unique (case-insensitive trimmed match).
    const seen = new Set<string>()
    for (const t of args.todos) {
      const key = t.content.trim().toLowerCase()
      if (seen.has(key)) {
        throw new Error(`todowrite validation: duplicate todo content: "${t.content}"`)
      }
      seen.add(key)
    }

    // Permission gate: ask unless already allowed.
    await ctx.ask({
      permission: "todowrite",
      patterns: ["*"],
      metadata: { count: args.todos.length },
    })

    // Persist (in-memory for v1, JSONL in prompt 25).
    const before = todoStore.get(ctx.sessionID)
    todoStore.set(ctx.sessionID, args.todos)

    // Compute deltas for the metadata (UI shows "X completed, Y in progress").
    const completed = args.todos.filter((t) => t.status === "completed").length
    const pending = args.todos.filter((t) => t.status === "pending").length
    const inProg = args.todos.filter((t) => t.status === "in_progress").length
    const cancelled = args.todos.filter((t) => t.status === "cancelled").length

    return {
      title: `${args.todos.length} todos (${completed} done, ${inProg} active, ${pending} pending)`,
      output: formatTodos(args.todos),
      metadata: {
        todos: args.todos,
        view: {
          before,
          after: args.todos,
          diff: computeDiff(before, args.todos),
          counts: { completed, pending, in_progress: inProg, cancelled },
        },
      },
    }
  },
}

function formatTodos(todos: Todo[]): string {
  const lines: string[] = []
  for (const t of todos) {
    const icon =
      t.status === "completed" ? "✓" :
      t.status === "in_progress" ? "▶" :
      t.status === "cancelled" ? "✗" : "○"
    const prio = t.priority === "high" ? " [HIGH]" : t.priority === "low" ? " [low]" : ""
    lines.push(`  ${icon} ${t.content}${prio}`)
  }
  return lines.join("\n")
}

function computeDiff(before: Todo[], after: Todo[]): Array<{ status: string; content: string }> {
  // Build a quick lookup. Return one entry per change since "before".
  const beforeMap = new Map(before.map((t) => [t.content, t]))
  const changes: Array<{ status: string; content: string }> = []
  for (const t of after) {
    const prev = beforeMap.get(t.content)
    if (!prev || prev.status !== t.status) {
      changes.push({ status: t.status, content: t.content })
    }
  }
  return changes
}

import type { Todo } from "../state/todo-types.js"
```

### Step 3: todowrite description (LLM-facing)

`packages/runtime/src/tools/todowrite.txt`:

```
Use this tool to create and maintain a structured task list for the current coding session. It tracks progress, organizes multi-step work, and surfaces status to the user in real time.

## When to use this tool

Use proactively when:
- The task requires 3+ distinct steps (not just 3 tool calls for one conceptual step)
- The work is non-trivial and benefits from upfront planning
- The user provides multiple tasks (numbered or comma-separated) or explicitly asks for a todo list
- New instructions arrive mid-task — capture them as todos before continuing
- You start a task — mark it `in_progress` (only one at a time) before working
- You finish a task — mark it `completed` and add any follow-ups discovered during the work

## When NOT to use

Skip when:
- The work is a single, straightforward task (or fewer than 3 trivial steps)
- The request is purely informational or conversational
- Tracking adds no organizational value (e.g. "what's the syntax for `await`?")

## Item shape

Each todo is `{ content: string, status: "pending"|"in_progress"|"completed"|"cancelled", priority: "high"|"medium"|"low" }`.

## States

- `pending` — not started
- `in_progress` — actively working (exactly ONE at a time)
- `completed` — finished successfully
- `cancelled` — no longer needed

## Rules

- Update status in real time; don't batch completions
- Mark `completed` only AFTER the required work is actually done, including any verification. Never based on intent.
- Keep exactly one `in_progress` while work remains
- If blocked or partial, keep it `in_progress` and add a follow-up todo describing the blocker
- Preserve user-provided commands verbatim (flags, args, order)
- Items should be specific and actionable; break large work into smaller steps
- Always replace the FULL list on every call (don't append-only)

## Examples

Use it:
- "Add a dark mode toggle and run the tests" → multi-step feature + explicit verification
- "Rename `getCwd` → `getCurrentWorkingDirectory` across the repo" → grep reveals 15 occurrences in 8 files
- "Implement registration, catalog, cart, checkout" → multiple complex features

Skip it:
- "How do I print Hello World in Python?" → informational
- "Add a comment to `calculateTotal`" → single edit
- "Run npm install and tell me what happened" → one command

When in doubt, use it.
```

### Step 4: question storage (for in-flight questions)

`packages/runtime/src/state/questions.ts`:

```ts
/**
 * Tracks in-flight `question` tool calls — pending user prompts the UI
 * must surface. The web UI subscribes to this; the CLI polls it.
 *
 * v1: in-memory Map. Prompt 25 replaces with JSONL-backed.
 */
type PendingQuestion = {
  id: string
  sessionID: string
  toolCallID?: string
  questions: Array<{
    question: string
    header: string          // short label, <=30 chars (UI badge)
    options: Array<{ label: string; description?: string; preview?: string }>
    multi_select?: boolean  // default false
  }>
  createdAt: number
  resolve: (answers: Record<string, string | string[]>) => void
  reject: (err: Error) => void
}

class QuestionStore {
  private pending = new Map<string, PendingQuestion>()

  add(q: PendingQuestion): void { this.pending.set(q.id, q) }

  resolve(id: string, answers: Record<string, string | string[]>): boolean {
    const q = this.pending.get(id)
    if (!q) return false
    q.resolve(answers)
    this.pending.delete(id)
    return true
  }

  reject(id: string, err: Error): boolean {
    const q = this.pending.get(id)
    if (!q) return false
    q.reject(err)
    this.pending.delete(id)
    return true
  }

  get(id: string): PendingQuestion | undefined { return this.pending.get(id) }

  list(sessionID?: string): PendingQuestion[] {
    const all = [...this.pending.values()]
    return sessionID ? all.filter((q) => q.sessionID === sessionID) : all
  }
}

export const questionStore = new QuestionStore()
```

### Step 5: question tool

`packages/runtime/src/tools/question.ts`:

```ts
import { z } from "zod"
import type { ToolExport } from "./tool.js"
import { questionStore } from "../state/questions.js"

const MAX_QUESTIONS = 4
const MAX_OPTIONS_PER_QUESTION = 4
const MAX_HEADER_LENGTH = 30

const QuestionOptionSchema = z.object({
  label: z.string().min(1).max(80),
  description: z.string().max(200).optional(),
  preview: z.string().max(2000).optional(),
})

const QuestionSchema = z.object({
  question: z.string().min(1).describe("The complete question to ask the user"),
  header: z.string().max(MAX_HEADER_LENGTH)
    .describe("Very short label shown as a chip/tag (max 30 chars)"),
  options: z.array(QuestionOptionSchema).min(2).max(MAX_OPTIONS_PER_QUESTION)
    .describe("2-4 options; first option is the recommended one"),
  multi_select: z.boolean().optional()
    .describe("Whether the user can pick multiple options (default false)"),
})

/**
 * question — present a one-shot multiple-choice prompt to the user.
 *
 * The agent uses this when it needs clarification before continuing. The
 * tool blocks until the user picks an option (or hits "Other" to type a
 * custom answer). Up to 4 questions per call; up to 4 options per question.
 *
 * Returns the chosen option labels (strings). If `multi_select` was set,
 * returns an array of labels.
 */
export const questionTool: ToolExport = {
  id: "question",
  description: "Ask the user a multiple-choice question and wait for an answer",
  parameters: z.object({
    questions: z.array(QuestionSchema).min(1).max(MAX_QUESTIONS)
      .describe("1-4 questions to ask. Each has 2-4 options."),
  }),
  execute: async (args, ctx) => {
    // Validate headers.
    for (const q of args.questions) {
      if (q.header.length === 0) {
        throw new Error(`question validation: every question needs a header (max ${MAX_HEADER_LENGTH} chars)`)
      }
    }

    // Permission gate (unless `question` is `allow` for this agent).
    await ctx.ask({
      permission: "question",
      patterns: args.questions.map((q) => q.question.slice(0, 80)),
      metadata: { count: args.questions.length },
    })

    // Build the pending question record.
    const id = crypto.randomUUID()
    const toolCallID = (ctx as any).callID

    // Surface via metadata so the UI can render immediately.
    await ctx.metadata({
      title: `Asked ${args.questions.length} question${args.questions.length > 1 ? "s" : ""}`,
      metadata: {
        question: {
          id,
          questions: args.questions,
          status: "pending",
        },
      },
    })

    // Block until user responds (or timeout — 5 min default).
    const answers = await waitForAnswer(id, args, ctx)

    // Format the response for the LLM.
    const formatted = args.questions
      .map((q, i) => {
        const ans = answers[q.question]
        const label = Array.isArray(ans) ? ans.join(", ") : (ans ?? "Unanswered")
        return `"${q.question}"="${label}"`
      })
      .join(", ")

    return {
      title: `Asked ${args.questions.length} question${args.questions.length > 1 ? "s" : ""}`,
      output: `User has answered your questions: ${formatted}. You can now continue with the user's answers in mind.`,
      metadata: { answers, questionID: id },
    }
  },
}

/**
 * Resolves when the user picks options (via questionStore.resolve()) or
 * after a 5-minute timeout (returns "Other" for unanswered).
 */
function waitForAnswer(
  id: string,
  args: { questions: Array<{ question: string; multi_select?: boolean }> },
  ctx: { abort: AbortSignal },
): Promise<Record<string, string | string[]>> {
  return new Promise((resolve, reject) => {
    let settled = false
    const onAbort = () => {
      if (settled) return
      settled = true
      questionStore.reject(id, new Error("aborted"))
      reject(new Error("aborted"))
    }
    if (ctx.abort) ctx.abort.addEventListener("abort", onAbort)

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      if (ctx.abort) ctx.abort.removeEventListener("abort", onAbort)
      // Timeout → return empty answers so the agent can proceed.
      resolve({})
    }, 5 * 60 * 1000)

    questionStore.add({
      id,
      sessionID: (ctx as any).sessionID,
      toolCallID: undefined,
      questions: args.questions as any,
      createdAt: Date.now(),
      resolve: (answers) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (ctx.abort) ctx.abort.removeEventListener("abort", onAbort)
        resolve(answers)
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
}
```

### Step 6: question description (LLM-facing)

`packages/runtime/src/tools/question.txt`:

```
Use this tool when you need to ask the user questions during execution. This allows you to:
1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices as you work
4. Offer choices to the user about what direction to take

## Usage notes

- You can ask 1-4 questions in a single call.
- Each question has 2-4 `options` — the user picks one (or several if `multi_select: true`).
- When `multi_select` is not set (default), the user can only pick one option per question.
- A "Type your own answer" option is added automatically; do NOT include "Other" or catch-all options.
- The first option should be the recommended one; prefix its label with "(Recommended)" if you want to mark it explicitly.
- `header` is a short label (max 30 chars) shown as a chip in the UI.
- `description` (optional) provides additional context for each option (max 200 chars).
- `preview` (optional) shows a code block / snippet when the user hovers an option.
- Answers are returned as the chosen label strings. The user can dismiss the prompt, in which case answers are empty.
- Don't ask questions when you can make a reasonable assumption — ask only when the answer materially changes the implementation.
```

### Step 7: Sample test fixtures

`packages/runtime/src/tools/__fixtures__/todowrite-sample.json`:

```json
[
  { "content": "Read the existing user schema in src/db/users.ts", "status": "in_progress", "priority": "high" },
  { "content": "Add a migration for the new column", "status": "pending", "priority": "high" },
  { "content": "Update the User model", "status": "pending", "priority": "medium" },
  { "content": "Write tests for the new column", "status": "pending", "priority": "medium" },
  { "content": "Run the test suite", "status": "pending", "priority": "high" }
]
```

### Step 8: Update runtime barrel

`packages/runtime/src/index.ts` — add:

```ts
export * as state from "./state/index.js"
```

`packages/runtime/src/state/index.ts`:

```ts
export { todoStore } from "./todos.js"
export { questionStore } from "./questions.js"
export { TodoSchema, TodoStatusSchema, TodoPrioritySchema } from "./todo-types.js"
export type { Todo } from "./todo-types.js"
```

### Step 9: Commit

```bash
git add -A
git commit -m "feat(tools): meta tools — todowrite + question (prompt 10)"
```

## Files created

```
packages/runtime/src/
├── state/
│   ├── index.ts            # barrel
│   ├── todo-types.ts       # Todo Zod schema + types
│   ├── todos.ts            # TodoStore (in-memory, JSONL in prompt 25)
│   └── questions.ts        # QuestionStore (pending prompts)
└── tools/
    ├── todowrite.ts        # todowrite tool
    ├── todowrite.txt       # LLM-facing description
    ├── question.ts         # question tool
    └── question.txt        # LLM-facing description
```

Plus 1 line added to `packages/runtime/src/index.ts`.

## Acceptance criteria

- [ ] `bun run typecheck` passes
- [ ] `createBuiltinRegistry()` includes `todowrite` and `question` alongside bash
- [ ] `reg.execute("todowrite", { todos: [...] }, ctx)` returns a `title` + `output` + `metadata.todos`
- [ ] `todoStore.get(sessionID)` returns the todos set via the tool
- [ ] `todowrite` with 2+ items in `in_progress` status throws a validation error
- [ ] `todowrite` with duplicate content (case-insensitive) throws a validation error
- [ ] `todowrite` with > 50 items throws (Zod max)
- [ ] `todowrite` permission gate calls `ctx.ask({ permission: "todowrite", ... })`
- [ ] `todowrite` returns `metadata.view.counts` with `{ completed, pending, in_progress, cancelled }`
- [ ] `todowrite` returns `metadata.view.diff` listing status changes since the previous list
- [ ] `reg.execute("question", { questions: [{ question, header, options: [...] }] }, ctx)` blocks until user answers
- [ ] Calling `questionStore.resolve(id, { "What?": "Option A" })` unblocks the tool
- [ ] Tool returns `metadata.answers` and `output` formatted as `"question"="answer"` pairs
- [ ] Question with 0 or 1 options throws (Zod requires 2-4)
- [ ] Question with 5+ options throws (Zod max 4)
- [ ] Question header > 30 chars throws
- [ ] Question > 4 questions throws (Zod max)
- [ ] `ctx.abort` abort rejects the pending question
- [ ] 5-minute timeout returns empty answers (test with `setTimeout` mock or shorter timeout)

## Verification

```bash
cd kilocode-assistant
bun install
bun run typecheck

cd /path/to/kilocode-assistant
bun --eval '
import { createBuiltinRegistry } from "@kilocode/runtime/tools"
import { todoStore, questionStore } from "@kilocode/runtime/state"

const reg = await createBuiltinRegistry()
console.log("tools:", reg.ids())

const ctx = {
  sessionID: "test", messageID: "m1",
  cwd: "/tmp", abort: new AbortController().signal,
  ask: async () => { console.log("[ask]"); },
  metadata: async () => { console.log("[metadata]"); },
}

// Test 1: todowrite initial list
const t1 = await reg.execute("todowrite", {
  todos: [
    { content: "First step", status: "in_progress", priority: "high" },
    { content: "Second step", status: "pending", priority: "medium" },
  ],
}, ctx)
console.log("--- todowrite initial ---")
console.log("title:", t1.title)
console.log("output:", t1.output)
console.log("counts:", JSON.stringify(t1.metadata.view.counts))

// Test 2: todowrite mark first done, second in progress
const t2 = await reg.execute("todowrite", {
  todos: [
    { content: "First step", status: "completed", priority: "high" },
    { content: "Second step", status: "in_progress", priority: "medium" },
    { content: "Third step", status: "pending", priority: "low" },
  ],
}, ctx)
console.log("--- todowrite update ---")
console.log("diff:", JSON.stringify(t2.metadata.view.diff))

// Test 3: validation — multiple in_progress
try {
  await reg.execute("todowrite", {
    todos: [
      { content: "A", status: "in_progress", priority: "high" },
      { content: "B", status: "in_progress", priority: "high" },
    ],
  }, ctx)
  console.log("--- multi-in-progress: NO ERROR (BUG) ---")
} catch (e) {
  console.log("--- multi-in-progress: rejected ✓ ---")
  console.log("msg:", e.message.slice(0, 80))
}

// Test 4: validation — duplicates
try {
  await reg.execute("todowrite", {
    todos: [
      { content: "Same", status: "pending", priority: "high" },
      { content: "same", status: "pending", priority: "high" },
    ],
  }, ctx)
  console.log("--- duplicates: NO ERROR (BUG) ---")
} catch (e) {
  console.log("--- duplicates: rejected ✓ ---")
  console.log("msg:", e.message.slice(0, 80))
}

// Test 5: store is populated
const stored = todoStore.get("test")
console.log("--- todoStore ---")
console.log("stored:", stored.length, "items")

// Test 6: question — happy path (resolve from outside)
console.log("--- question happy path ---")
const qPromise = reg.execute("question", {
  questions: [{
    question: "Which database should we use?",
    header: "Database",
    options: [
      { label: "PostgreSQL (Recommended)", description: "Best for relational data" },
      { label: "SQLite", description: "Simple, file-based" },
      { label: "MongoDB", description: "Document store" },
    ],
    multi_select: false,
  }],
}, ctx)

// Simulate the UI resolving the question after 100ms.
setTimeout(() => {
  const pending = questionStore.list("test")
  console.log("pending questions:", pending.length)
  if (pending[0]) {
    questionStore.resolve(pending[0].id, { "Which database should we use?": "PostgreSQL (Recommended)" })
  }
}, 100)

const qResult = await qPromise
console.log("answer:", qResult.metadata.answers)
console.log("output:", qResult.output)

// Test 7: question — invalid options count
try {
  await reg.execute("question", {
    questions: [{
      question: "Pick one", header: "Pick",
      options: [{ label: "Only one" }],   // needs >= 2
    }],
  }, ctx)
  console.log("--- 1 option: NO ERROR (BUG) ---")
} catch (e) {
  console.log("--- 1 option: rejected ✓ ---")
}

// Test 8: question — header too long
try {
  await reg.execute("question", {
    questions: [{
      question: "Q", header: "x".repeat(50),  // max 30
      options: [{ label: "A" }, { label: "B" }],
    }],
  }, ctx)
  console.log("--- long header: NO ERROR (BUG) ---")
} catch (e) {
  console.log("--- long header: rejected ✓ ---")
}
'

# Cleanup: nothing to do, all in-memory.
```

Expected output sections:
1. `tools: [bash, ..., question, todowrite, ...]`
2. `--- todowrite initial ---` with title `2 todos (0 done, 1 active, 1 pending)`
3. `--- todowrite update ---` with `diff: [{"status":"completed","content":"First step"}, ...]`
4. `--- multi-in-progress: rejected ✓ ---`
5. `--- duplicates: rejected ✓ ---`
6. `--- todoStore ---` with `stored: 3 items`
7. `--- question happy path ---` with the answer + formatted output
8. `--- 1 option: rejected ✓ ---`
9. `--- long header: rejected ✓ ---`

## Notes

- **Why replace the full list instead of patching?** LLMs are bad at delta operations. Replacing is simpler for the model and the UI — it just re-renders the full checklist.
- **Why enforce "exactly one in_progress"?** Forces the agent to be deliberate about what it's working on. Mirrors Anthropic's Claude Code convention and Kilo's behavior.
- **Why cap at 50 todos?** The web UI's checklist becomes unwieldy past 50 items. If the model needs more, it should batch / chunk the work.
- **Why in-memory for v1?** Prompt 25 (sessions + JSONL) gives us persistence. Until then, todos live only as long as the CLI/web process does — fine for the loop iteration of prompts 14-17.
- **Question timeout of 5 minutes.** Long enough for the user to think; short enough that an abandoned prompt doesn't hang the agent forever. The web UI shows a countdown.
- **Abort handling.** If the user hits Cancel during a `question`, the agent receives `{ answers: {} }` and must decide whether to proceed or re-ask. The `tool` aborts cleanly without leaving a pending entry.
- **Why "Other" auto-added?** Web UI convention (matches TUI / Linear / GitHub issues UX). The model shouldn't include its own "Other" option — that would be a duplicate.
- **Multi-question calls.** Asking 2-4 related questions in one prompt is faster than 4 separate calls (one round-trip instead of 4).
- **Why not ask the agent's own config?** `ctx.ask()` already knows the agent's permission. If the agent has `question: "deny"`, the tool is invisible to the model entirely. If `question: "ask"`, the user is prompted. If `"allow"`, the question just... appears? — same flow actually. The "ask" gate is what surfaces the prompt.
- **What's `ctx.metadata()`?** A second call for emitting observability data (separate from the final `ToolResult`). `todowrite` doesn't need it (the result already has the list); `question` uses it to push the pending record to the UI *before* waiting, so the user sees the prompt arrive.
- **Pre-pending questions, not pushing them.** Kilo's behavior: when the model calls `question`, the UI immediately renders the prompt. The blocking happens server-side. The HTTP/SSE transport (prompt 02) relays the prompt to the browser; the browser resolves it; the resolve() unblocks the tool.
- **Header length of 30.** Matches the Anthropic / Claude Code cap. UI badges look terrible past 30 chars.
- **Custom-answer fallback.** If the user types a custom answer, the tool still returns it as a string. The model doesn't get a separate signal — it just sees the text.
- **Future: per-question validation.** If the model sets `multi_select: true`, the answer is an array. v1 doesn't enforce this in the schema (returns whatever the UI sends); v2 can add discriminated unions.
- **Question permissions vs ask.** `ctx.ask({ permission: "question" })` is the permission gate. It checks the agent config; if `"deny"`, the agent can never call `question`. If `"ask"`, the user is prompted to allow/deny. If `"allow"`, no prompt. The actual question UI is separate (always shown once the tool is called).
- **No batching with `todowrite`.** The model shouldn't call `todowrite` 5 times in 5 messages — it should batch. But the registry doesn't enforce this; it's a behavior expectation baked into the `.txt` description.
