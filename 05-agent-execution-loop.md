# Agent Loop: LadeStack Build

**Status:** Draft v1 (2026-06-22)
**Related:** PRD.md, system-design.md, tool-calling.md, design.md

This document defines the AI agent loop — how a user message becomes tool calls, file edits, and a working preview. Architecture is heavily borrowed from Kilo Code's `packages/opencode/src/agent/` (see research.md §4).

---

## 1. Agent registry

Following Kilo Code's schema-driven agent pattern, we ship **6 built-in agents** for MVP:

| Name | Mode | Purpose | Tools available |
|---|---|---|---|
| `build` | primary | Default code-writing agent | read, write, edit, glob, grep, bash, todowrite, question |
| `plan` | primary | Read-only planning agent | read, glob, grep, plan_write, plan_exit, todowrite, question |
| `explore` | subagent | Read-only codebase search | read, glob, grep |
| `scout` | subagent | Lightweight exploration | glob, grep (no read) |
| `summarize` | subagent | Conversation compaction | (no tools) |
| `title` | subagent | Generate session title | (no tools) |

**Agent schema (Zod):**
```ts
const AgentInfo = z.object({
  name: z.string(),
  description: z.string(),
  mode: z.enum(["primary", "subagent", "all"]),
  native: z.boolean().default(false),    // true for built-ins
  hidden: z.boolean().default(false),
  prompt: z.string(),                    // path to .txt or inline string
  tools: z.record(z.string(), z.boolean()).optional(),  // override defaults
  model: z.object({ providerID: z.string(), modelID: z.string() }).optional(),
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
  steps: z.number().int().positive().default(25),
  permission: PermissionRuleset.optional(),
  color: z.string().optional(),          // UI color for chat message
})
```

User-defined agents (in `.ladestack/agents/*.md`) follow the same schema.

---

## 2. The canonical loop

```
User sends message m
   │
   ▼
┌──────────────────────────────────────────────────────────────┐
│ 1. Resolve session                                           │
│    - Load session from DB (project_id + session_id)          │
│    - Load last N messages (default: 50, compacted if longer) │
│    - Load current file tree                                  │
└──────────────────────────────────────────────────────────────┘
   │
   ▼
┌──────────────────────────────────────────────────────────────┐
│ 2. Resolve agent                                             │
│    - Default: build                                          │
│    - If user toggled plan mode: plan                         │
│    - If orchestrator dispatched: subagent                    │
└──────────────────────────────────────────────────────────────┘
   │
   ▼
┌──────────────────────────────────────────────────────────────┐
│ 3. Build prompt                                              │
│    - System prompt (from agent .txt)                         │
│    - Environment info (OS, node ver, project name)           │
│    - Tool definitions (filtered by agent permissions)        │
│    - File tree summary (top 2 levels)                        │
│    - Recent messages (compacted if long)                     │
│    - User message (with image attachments if any)            │
└──────────────────────────────────────────────────────────────┘
   │
   ▼
┌──────────────────────────────────────────────────────────────┐
│ 4. Call LLM                                                  │
│    - Resolve provider (BYO key or managed)                   │
│    - Stream response chunks                                  │
│    - Emit SSE events to client:                              │
│      • text delta                                           │
│      • tool_use start                                       │
│      • usage update                                         │
└──────────────────────────────────────────────────────────────┘
   │
   ▼
┌──────────────────────────────────────────────────────────────┐
│ 5. Process tool calls (loop until done)                      │
│                                                              │
│    For each tool call in response:                           │
│      a. Validate input (Zod schema)                          │
│      b. If invalid: append error to history, continue        │
│      c. Execute tool (with sandbox context, abort signal)    │
│      d. Capture result                                       │
│      e. Append result message to history                     │
│      f. If sandbox mutated: wait for Vite HMR                │
│      g. Stream result to client                              │
│                                                              │
│    If any tool calls made → loop back to step 4               │
│    If no tool calls → exit loop                              │
└──────────────────────────────────────────────────────────────┘
   │
   ▼
┌──────────────────────────────────────────────────────────────┐
│ 6. Finalize                                                  │
│    - Append final assistant message to DB                    │
│    - Create file snapshots for changed files                 │
│    - Update usage_events                                     │
│    - If plan_exit: trigger user-review UI                    │
│    - Stream SSE 'done' to client                             │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. System prompt composition

System prompt = base + agent-specific + env + project context.

```
┌─────────────────────────────────────────────────────────────────┐
│ BASE (ladestack/soul.txt)                                       │
│   - Direct, technical, anti-sycophancy                         │
│   - "STRICTLY FORBIDDEN from starting with 'Great', 'Sure'"     │
│   - "Iterate methodically; break complex tasks into steps"      │
└─────────────────────────────────────────────────────────────────┘
                              +
┌─────────────────────────────────────────────────────────────────┐
│ AGENT-SPECIFIC (e.g. build.txt, plan.txt, explore.txt)          │
│   - Role definition                                            │
│   - Tool usage guidance                                        │
│   - Output format expectations                                 │
└─────────────────────────────────────────────────────────────────┘
                              +
┌─────────────────────────────────────────────────────────────────┐
│ ENVIRONMENT                                                     │
│   - Platform: linux x64                                        │
│   - Node: 20.11.0                                              │
│   - Today's date: 2026-06-22                                   │
│   - Project: my-portfolio (Next.js 14 + Tailwind + shadcn)      │
│   - Default mode: plan                                         │
└─────────────────────────────────────────────────────────────────┘
                              +
┌─────────────────────────────────────────────────────────────────┐
│ TOOL DESCRIPTIONS (filtered by agent)                           │
│   - read: ...                                                  │
│   - write: ...                                                 │
│   - edit: ...                                                  │
│   - (only tools the agent can use)                             │
└─────────────────────────────────────────────────────────────────┘
                              +
┌─────────────────────────────────────────────────────────────────┐
│ FILE TREE SUMMARY (top 2 levels, abbreviated)                   │
│   - package.json                                               │
│   - next.config.js                                             │
│   - tsconfig.json                                              │
│   - src/                                                       │
│       - app/                                                  │
│       - components/                                           │
│       - lib/                                                  │
│   - public/                                                    │
│   - .ladestack/                                                │
│       - plan.md (if exists)                                    │
└─────────────────────────────────────────────────────────────────┘
```

**Estimated token cost:** ~6k tokens for system + env + tools; remaining budget for messages + file context.

---

## 4. Prompt caching

**Anthropic prompt caching** is a major cost optimization. Strategy:

- Mark the **system prompt + env + tool descriptions** as cacheable (these rarely change)
- Mark the **file tree summary** as cacheable per-project
- Do NOT cache messages (they change every turn)

**Expected savings:**
- Without cache: every message pays full system prompt cost
- With cache: each subsequent message pays ~10% of system prompt cost (cache read)
- For a 6k-token system prompt at $3/M input tokens:
  - First message: $0.018
  - Subsequent messages: $0.0018 each
  - 10-turn session: ~$0.036 vs $0.18 — 5x savings

---

## 5. Plan mode flow (the killer UX)

**Why plan-mode-first:** the most common failure mode for AI builders is the model jumping straight to editing files before fully understanding the request. Plan mode forces a brief up-front design step, dramatically reducing wasted edits.

### 5.1 User flow

```
1. User types: "Add user authentication with email and Google"
2. Default mode is Plan
3. Agent (plan) reads current project state
4. Agent writes a plan to .ladestack/plan.md
5. Agent calls plan_exit with summary
6. UI shows:
   ┌────────────────────────────────────────────┐
   │ 📋 Plan ready for review                   │
   ├────────────────────────────────────────────┤
   │ Summary: Add NextAuth with Supabase        │
   │         adapter; email + Google providers; │
   │         protect /dashboard routes          │
   │                                              │
   │ Files to create: 3                          │
   │ Files to modify: 2                          │
   │ Dependencies: 2                             │
   │                                              │
   │ [Edit Plan] [Approve & Build] [Reject]      │
   └────────────────────────────────────────────┘
7. User clicks "Approve & Build"
8. System switches active agent from 'plan' to 'build'
9. New (invisible) user message: "Plan approved. Execute it."
10. Build agent picks up, follows plan exactly
```

### 5.2 Plan agent has LIMITED tools

| Tool | Available in plan mode? |
|---|---|
| read | ✅ |
| glob | ✅ |
| grep | ✅ |
| plan_write | ✅ |
| plan_exit | ✅ |
| todowrite | ✅ |
| question | ✅ |
| write / edit / bash | ❌ (locked) |

The runtime enforces this — the plan agent cannot accidentally modify code.

### 5.3 When plan mode is skipped

- Single-sentence prompt: "fix typo in header" → auto-build mode (no plan)
- User explicitly toggles to Build mode
- User says "just do it" or "no plan"

**Auto-detection heuristic:**
- Prompt length > 200 chars → suggest plan
- Prompt mentions multiple files / components → suggest plan
- Prompt is single-sentence imperative → skip plan

User can override in project settings ("always plan" vs "plan for non-trivial" vs "never plan").

---

## 6. Multi-agent orchestration (deferred to v2)

Kilo Code's `orchestrator` agent dispatches subagents in waves. We skip this for MVP but the design accommodates it.

### Wave-based execution (v2 sketch)

```
1. User: "Build me a SaaS landing page"
2. Plan agent writes plan:
   - Wave 1 (independent): setup layout, copy
   - Wave 2 (depends on 1): add features section, add testimonials
   - Wave 3 (depends on 2): add pricing, add CTA
3. User approves
4. Orchestrator spawns:
   - Wave 1: [agent:layout, agent:copy] in parallel
   - Wait
   - Wave 2: [agent:features, agent:testimonials] in parallel
   - Wait
   - Wave 3: [agent:pricing, agent:cta] in parallel
   - Wait
5. Final integration agent reconciles any conflicts
```

**For v1:** we ship only `build` + `plan` + `explore`. `explore` is available for the build agent to invoke if needed (e.g., "before adding a new component, search for similar existing ones").

---

## 7. Compaction (context window management)

Long sessions eventually exceed the model's context window. We need **automatic compaction**.

### Strategy

When message history + file context > 80% of model limit:

1. Run `summarize` agent over the oldest messages
2. Replace oldest messages with a single summary message
3. Keep recent messages verbatim (last 10 turns)
4. Always keep the file tree summary fresh

**What gets preserved:**
- User intent (first message of session)
- Project state at compaction point
- Recent tool results (last 5)
- Key decisions (explicitly flagged by user)

**What gets dropped:**
- Intermediate thinking text
- Failed tool calls (with summary of why)
- Long error messages

### Manual override

User can click "Summarize now" button to trigger compaction manually.

---

## 8. Streaming protocol (SSE)

Server → Client events:

```
event: message_start
data: { "id": "msg_abc", "role": "assistant", "agent": "build" }

event: content_delta
data: { "delta": "I'll start by" }

event: content_delta
data: { "delta": " exploring the current" }

event: tool_start
data: { "id": "toolu_01", "name": "read", "input": {"path":"package.json"} }

event: tool_end
data: { "id": "toolu_01", "result": {"content":"...", "totalLines":42} }

event: tool_start
data: { "id": "toolu_02", "name": "write", "input": {"path":"src/app/page.tsx","content":"..."} }

event: tool_end
data: { "id": "toolu_02", "result": {"bytes":1234, "created":false} }

event: usage
data: { "tokensIn": 12453, "tokensOut": 832, "costCents": 4 }

event: message_end
data: { "id": "msg_abc", "stop_reason": "end_turn" }

event: done
data: { "sessionId": "...", "totalTokens": 13285, "duration": 8421 }
```

**Client reconnect:** if SSE connection drops, client sends `Last-Event-ID` header; server resumes from last event.

---

## 9. Error handling in the loop

| Error | Behavior |
|---|---|
| LLM API 5xx | Retry 3x with exponential backoff; if all fail, surface "AI unavailable" to user |
| LLM API 429 | Backoff 30s, queue message; UI shows "queued" |
| Tool input validation fail | Append error to history; LLM self-corrects next turn |
| Tool execution error (transient) | Retry once; if fail again, append error; LLM adapts |
| Tool execution error (permanent, e.g., permission) | Append error; suggest alternative |
| Sandbox crash | Restart sandbox; resume from last successful state |
| Repeated same error 3x | Pause loop; show "stuck" UI; offer user intervention via `question` |
| User cancels (abort) | Stop loop; partial response kept; user can resume |
| Step limit hit (25) | Stop loop; show "long task — would you like me to continue?" |
| Token cost cap hit | Stop loop; show "session cap reached" |

---

## 10. State machine (high level)

```
session: idle
   │ user sends message
   ▼
session: thinking
   │ LLM response starts
   ▼
session: streaming
   │ streaming chunks
   │ tool calls
   │ tool execution
   │ (loop)
   ▼
session: idle (if no more tool calls)
session: plan_review (if plan_exit called)
session: error (if unrecoverable)
session: cancelled (if user aborts)
```

UI reflects state via:
- Status badge: "Thinking..." / "Building..." / "Reviewing plan..."
- Disable send button while non-idle
- Show cancel button while non-idle

---

## 11. Configuration knobs

Per-project settings (advanced):

| Setting | Default | Effect |
|---|---|---|
| Default mode | `plan` | First message in new session uses this mode |
| Default model | `anthropic/claude-sonnet-4` | Used unless overridden per-message |
| Max steps per turn | 25 | Loop guard |
| Max tokens per session | 200000 | Cost guard |
| Auto-compact at | 80% of model limit | Triggers compaction |
| Tool permissions | (all enabled) | Per-tool enable/disable |
| System prompt | (default) | Override with custom prompt file |
| Allow bash | true | Master switch for bash tool |

Per-user settings:
- Default model
- BYO API keys
- Theme (dark/light)
- Plan-mode preference (always / non-trivial / never)

---

## 12. Testing the loop

**Unit tests:** each tool, each agent's prompt, each provider adapter.

**Integration tests:** spin up a real sandbox + run an agent loop against a fixture project.

**E2E tests:** Playwright on the web app — sign up → create project → send message → verify preview updates.

**Regression tests:** golden transcripts from real sessions (anonymized). Run weekly against new model versions.

**Eval suite:**
- "Build a portfolio site" → does the agent produce a working site?
- "Add login to existing app" → does it use NextAuth correctly?
- "Fix the bug in this component" → does it edit the right file?
- "Explain what this code does" → does plan mode produce a useful plan?

Target: > 85% pass rate on eval suite before shipping each release.

---

## 13. Observability

**Per-turn log:**
```json
{
  "sessionId": "...",
  "turn": 7,
  "agent": "build",
  "model": "anthropic/claude-sonnet-4-20250514",
  "steps": 4,
  "toolsUsed": ["read", "write", "bash", "bash"],
  "tokensIn": 12500,
  "tokensOut": 850,
  "costCents": 4,
  "durationMs": 12400,
  "filesModified": ["src/app/page.tsx", "src/lib/utils.ts"],
  "errors": []
}
```

**Aggregated metrics (PostHog):**
- p50 / p95 turn latency
- p50 / p95 token cost per turn
- Tool success rate by tool
- Step count distribution
- Plan-mode usage rate
- Error frequency by error type

**Alerts:**
- Error rate > 5% over 10 min → Slack
- Cost spike: single session > $2 → log + notify
- Latency p95 > 30s → Slack

---

**End of agent-loop.md** — next: design.md
