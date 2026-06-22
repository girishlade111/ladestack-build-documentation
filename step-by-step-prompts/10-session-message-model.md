# Prompt 10: Session + Message Model

## Goal

Build the SessionService that owns the conversation lifecycle: load session from DB, append messages, query history, compact (auto-summarize when context grows), and replay from any message.

## Context (from prompts 01-09)

- All foundation, agents, tools built.
- Messages table exists in Supabase schema (prompt 04).
- The session/message schemas are referenced by the API routes (prompt 03) and will be used by the agent loop (prompt 11).

Reference: `../system-design.md` §2.5 (messages schema), `../agent-loop.md` §7 (compaction), §8 (SSE protocol).

## Task

### Step 1: Define session types

`packages/runtime/src/sessions/types.ts`:

```ts
import { z } from "zod"

export const SessionStatusSchema = z.enum(["active", "archived"])

export const MessageRoleSchema = z.enum(["user", "assistant", "tool", "system"])

export const ToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  input: z.unknown()
})

export const MessageSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  role: MessageRoleSchema,
  agent: z.string().optional(),
  content: z.string(),
  toolCalls: z.array(ToolCallSchema).optional(),
  toolCallId: z.string().optional(),
  model: z.string().optional(),
  tokensIn: z.number().optional(),
  tokensOut: z.number().optional(),
  costCents: z.number().optional(),
  parentMessageId: z.string().optional(),
  createdAt: z.date()
})

export type Message = z.infer<typeof MessageSchema>
export type ToolCall = z.infer<typeof ToolCallSchema>

export interface Session {
  id: string
  projectId: string
  title: string | null
  status: z.infer<typeof SessionStatusSchema>
  agent: string
  totalTokensIn: number
  totalTokensOut: number
  totalCostCents: number
  createdAt: Date
  updatedAt: Date
}
```

### Step 2: Build the session service

`packages/runtime/src/sessions/service.ts`:

```ts
import { z } from "zod"
import { randomUUID } from "crypto"
import { supabaseAdmin } from "../db/client.js"
import { log } from "../lib/logger.js"
import type { Message, Session } from "./types.js"
import { MessageSchema } from "./types.js"

const MAX_HISTORY_MESSAGES = 50
const MAX_CONTEXT_TOKENS = 160_000    // 80% of 200k Anthropic limit

export async function createSession(projectId: string, opts?: { title?: string; agent?: string }): Promise<Session> {
  const id = randomUUID()
  const { data, error } = await supabaseAdmin
    .from("sessions")
    .insert({
      id,
      project_id: projectId,
      title: opts?.title ?? null,
      status: "active",
      agent: opts?.agent ?? "build"
    })
    .select()
    .single()

  if (error) throw error
  return mapSession(data)
}

export async function getSession(id: string): Promise<Session | undefined> {
  const { data, error } = await supabaseAdmin
    .from("sessions")
    .select("*")
    .eq("id", id)
    .single()

  if (error || !data) return undefined
  return mapSession(data)
}

export async function listSessions(projectId: string, limit = 50): Promise<Session[]> {
  const { data, error } = await supabaseAdmin
    .from("sessions")
    .select("*")
    .eq("project_id", projectId)
    .order("updated_at", { ascending: false })
    .limit(limit)

  if (error) throw error
  return data.map(mapSession)
}

export async function updateSession(id: string, updates: Partial<Session>): Promise<void> {
  const dbUpdates: any = {}
  if (updates.title !== undefined) dbUpdates.title = updates.title
  if (updates.status !== undefined) dbUpdates.status = updates.status
  if (updates.totalTokensIn !== undefined) dbUpdates.total_tokens_in = updates.totalTokensIn
  if (updates.totalTokensOut !== undefined) dbUpdates.total_tokens_out = updates.totalTokensOut
  if (updates.totalCostCents !== undefined) dbUpdates.total_cost_cents = updates.totalCostCents
  if (updates.agent !== undefined) dbUpdates.agent = updates.agent
  dbUpdates.updated_at = new Date().toISOString()

  const { error } = await supabaseAdmin.from("sessions").update(dbUpdates).eq("id", id)
  if (error) throw error
}

export async function appendMessage(message: Omit<Message, "id" | "createdAt">): Promise<Message> {
  const id = randomUUID()
  const { data, error } = await supabaseAdmin
    .from("messages")
    .insert({
      id,
      session_id: message.sessionId,
      role: message.role,
      agent: message.agent,
      content: message.content,
      tool_calls: message.toolCalls,
      tool_call_id: message.toolCallId,
      model: message.model,
      tokens_in: message.tokensIn,
      tokens_out: message.tokensOut,
      cost_cents: message.costCents,
      parent_message_id: message.parentMessageId
    })
    .select()
    .single()

  if (error) throw error

  // Update session totals
  if (message.tokensIn || message.tokensOut || message.costCents) {
    const session = await getSession(message.sessionId)
    if (session) {
      await updateSession(message.sessionId, {
        totalTokensIn: session.totalTokensIn + (message.tokensIn ?? 0),
        totalTokensOut: session.totalTokensOut + (message.tokensOut ?? 0),
        totalCostCents: session.totalCostCents + (message.costCents ?? 0)
      })
    }
  }

  return mapMessage(data)
}

export async function getMessages(sessionId: string, opts?: { limit?: number; before?: Date }): Promise<Message[]> {
  let query = supabaseAdmin
    .from("messages")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true })

  if (opts?.limit) query = query.limit(opts.limit)
  if (opts?.before) query = query.lt("created_at", opts.before.toISOString())

  const { data, error } = await query
  if (error) throw error
  return data.map(mapMessage)
}

export async function getRecentMessages(sessionId: string, limit = MAX_HISTORY_MESSAGES): Promise<Message[]> {
  // Get the last N messages, ordered chronologically
  const { data, error } = await supabaseAdmin
    .from("messages")
    .select("*")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error) throw error
  return data.reverse().map(mapMessage)
}

export async function deleteSession(id: string): Promise<void> {
  await supabaseAdmin.from("sessions").delete().eq("id", id)
}

function mapSession(row: any): Session {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    status: row.status,
    agent: row.agent,
    totalTokensIn: row.total_tokens_in ?? 0,
    totalTokensOut: row.total_tokens_out ?? 0,
    totalCostCents: row.total_cost_cents ?? 0,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  }
}

function mapMessage(row: any): Message {
  return MessageSchema.parse({
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    agent: row.agent,
    content: row.content,
    toolCalls: row.tool_calls,
    toolCallId: row.tool_call_id,
    model: row.model,
    tokensIn: row.tokens_in,
    tokensOut: row.tokens_out,
    costCents: row.cost_cents,
    parentMessageId: row.parent_message_id,
    createdAt: new Date(row.created_at)
  })
}
```

### Step 3: Build the compaction service

`packages/runtime/src/sessions/compaction.ts`:

```ts
import { generateText } from "ai"
import { getProvider } from "../providers/registry.js"
import { resolveApiKey } from "../providers/keys.js"
import { getRecentMessages, appendMessage, getSession } from "./service.js"
import type { Message } from "./types.js"
import { log } from "../lib/logger.js"

const COMPACTION_THRESHOLD = MAX_CONTEXT_TOKENS = 160_000
const KEEP_RECENT_MESSAGES = 10

export interface CompactionResult {
  compacted: boolean
  summaryMessageId?: string
  tokensBefore: number
  tokensAfter: number
}

export async function maybeCompact(sessionId: string, userId: string): Promise<CompactionResult> {
  const session = await getSession(sessionId)
  if (!session) throw new Error(`session not found: ${sessionId}`)

  const totalTokens = session.totalTokensIn + session.totalTokensOut
  if (totalTokens < COMPACTION_THRESHOLD) {
    return { compacted: false, tokensBefore: totalTokens, tokensAfter: totalTokens }
  }

  log.info({ sessionId, totalTokens }, "compacting session")

  const messages = await getRecentMessages(sessionId, 100)
  const summary = await summarizeMessages(userId, messages)

  // Insert summary as a system message
  const summaryMessage = await appendMessage({
    sessionId,
    role: "system",
    content: `[Compaction summary]\n\n${summary}`,
    agent: "summarize"
  })

  // Update session totals (zero out old messages, keep recent)
  // For MVP, just append summary; v1.1 implements true compaction (delete old messages, reset token count)

  return {
    compacted: true,
    summaryMessageId: summaryMessage.id,
    tokensBefore: totalTokens,
    tokensAfter: totalTokens - (messages.length * 500)   // rough estimate
  }
}

async function summarizeMessages(userId: string, messages: Message[]): Promise<string> {
  const prompt = `Summarize the following conversation into a concise summary that preserves:\n1. Original user intent\n2. Key decisions made\n3. Files modified\n4. Open issues\n5. Current state\n\nBe terse. Use markdown structure.\n\nConversation:\n\n${messages.map((m) => `[${m.role}${m.agent ? ` (${m.agent})` : ""}] ${m.content}`).join("\n\n")}`

  try {
    const apiKey = await resolveApiKey(userId, "anthropic")
    const provider = getProvider("anthropic")

    let summary = ""
    for await (const chunk of provider.complete({
      model: { providerID: "anthropic", modelID: "claude-3-5-haiku-20241022" },
      messages: [{ role: "user", content: prompt }],
      system: "You are a conversation summarizer. Be terse. Output structured markdown.",
      maxTokens: 2000,
      stream: true
    }, apiKey)) {
      if (chunk.type === "text") summary += chunk.text
    }
    return summary || "Failed to generate summary"
  } catch (err) {
    log.error({ err }, "summarization failed")
    return `[Summarization failed: ${err}]`
  }
}

export async function manualCompact(sessionId: string, userId: string): Promise<CompactionResult> {
  const messages = await getRecentMessages(sessionId, 100)
  const summary = await summarizeMessages(userId, messages)
  const summaryMessage = await appendMessage({
    sessionId,
    role: "system",
    content: `[Manual compaction summary]\n\n${summary}`,
    agent: "summarize"
  })
  return { compacted: true, summaryMessageId: summaryMessage.id, tokensBefore: 0, tokensAfter: 0 }
}
```

### Step 4: Build the usage tracker

`packages/runtime/src/sessions/usage.ts`:

```ts
import { supabaseAdmin } from "../db/client.js"

export async function trackUsage(event: {
  userId: string
  projectId?: string
  sessionId?: string
  eventType: "message" | "tool_call" | "deploy"
  agent?: string
  model?: string
  tokensIn?: number
  tokensOut?: number
  costCents?: number
}): Promise<void> {
  await supabaseAdmin.from("usage_events").insert({
    user_id: event.userId,
    project_id: event.projectId,
    session_id: event.sessionId,
    event_type: event.eventType,
    agent: event.agent,
    model: event.model,
    tokens_in: event.tokensIn ?? 0,
    tokens_out: event.tokensOut ?? 0,
    cost_cents: event.costCents ?? 0
  })
}

export async function getDailyUsage(userId: string, days = 30): Promise<Array<{ date: string; tokensIn: number; tokensOut: number; costCents: number }>> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabaseAdmin
    .from("usage_events")
    .select("tokens_in, tokens_out, cost_cents, date")
    .eq("user_id", userId)
    .gte("created_at", since)

  if (error) throw error

  // Aggregate by date
  const byDate = new Map<string, { tokensIn: number; tokensOut: number; costCents: number }>()
  for (const row of data ?? []) {
    const date = row.date
    if (!byDate.has(date)) byDate.set(date, { tokensIn: 0, tokensOut: 0, costCents: 0 })
    const agg = byDate.get(date)!
    agg.tokensIn += row.tokens_in
    agg.tokensOut += row.tokens_out
    agg.costCents += row.cost_cents
  }

  return Array.from(byDate.entries())
    .map(([date, agg]) => ({ date, ...agg }))
    .sort((a, b) => a.date.localeCompare(b.date))
}
```

### Step 5: Update runtime index

```ts
// Add to packages/runtime/src/index.ts
export * from "./sessions/types.js"
export * as sessions from "./sessions/service.js"
export * from "./sessions/compaction.js"
export * from "./sessions/usage.js"
```

### Step 6: Wire into API session route (update)

`packages/api/src/routes/sessions.ts`:

```ts
import { Hono } from "hono"
import { z } from "zod"
import { streamSSE } from "hono/streaming"
import { authMiddleware, type AuthContext } from "../middleware/auth.js"
import { sessions, getRecentMessages } from "@ladestack/runtime"

export const sessionRoutes = new Hono<{ Variables: { auth: AuthContext } }>()
  .use("*", authMiddleware)

  .get("/by-project/:projectId", async (c) => {
    const projectId = c.req.param("projectId")
    const list = await sessions.listSessions(projectId)
    return c.json({ sessions: list })
  })

  .post("/", async (c) => {
    const body = await c.req.json<{ projectId: string; title?: string }>()
    const session = await sessions.createSession(body.projectId, { title: body.title })
    return c.json(session, 201)
  })

  .get("/:id", async (c) => {
    const id = c.req.param("id")
    const session = await sessions.getSession(id)
    if (!session) return c.json({ error: "not_found" }, 404)
    return c.json(session)
  })

  .get("/:id/messages", async (c) => {
    const id = c.req.param("id")
    const messages = await getRecentMessages(id, 50)
    return c.json({ messages })
  })

  .post("/:id/messages", async (c) => {
    // TODO: forward to agent loop (prompt 11)
    return streamSSE(c, async (stream) => {
      await stream.writeSSE({ event: "error", data: JSON.stringify({ error: "not_implemented" }) })
    })
  })

  .delete("/:id", async (c) => {
    await sessions.deleteSession(c.req.param("id"))
    return c.json({ deleted: c.req.param("id") })
  })
```

### Step 7: Tests

`packages/runtime/src/sessions/service.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest"
import { createSession, getSession, appendMessage, getRecentMessages, updateSession } from "./service.js"

const TEST_PROJECT = "test-proj-" + Date.now()

describe("session service", () => {
  beforeAll(() => {
    if (!process.env.SUPABASE_URL) throw new Error("SUPABASE_URL not set")
  })

  it("creates, reads, updates a session", async () => {
    const created = await createSession(TEST_PROJECT, { title: "Test session" })
    expect(created.projectId).toBe(TEST_PROJECT)
    expect(created.status).toBe("active")

    const fetched = await getSession(created.id)
    expect(fetched?.id).toBe(created.id)

    await updateSession(created.id, { title: "Updated title" })
    const updated = await getSession(created.id)
    expect(updated?.title).toBe("Updated title")
  }, { timeout: 30000 })

  it("appends messages and updates totals", async () => {
    const session = await createSession(TEST_PROJECT, { title: "Msg test" })
    const msg = await appendMessage({
      sessionId: session.id,
      role: "user",
      content: "Hello",
      tokensIn: 10
    })
    expect(msg.content).toBe("Hello")

    const updated = await getSession(session.id)
    expect(updated?.totalTokensIn).toBe(10)
  }, { timeout: 30000 })
})
```

### Step 8: Commit

```bash
git add -A
git commit -m "feat(runtime): session service + compaction + usage tracking (prompt 10)"
```

## Files created/modified

```
packages/runtime/src/sessions/
├── types.ts
├── service.ts
├── service.test.ts
├── compaction.ts
└── usage.ts

packages/api/src/routes/sessions.ts (rewrite)
```

## Acceptance criteria

- [ ] Sessions can be created, read, updated, deleted
- [ ] Messages can be appended with metadata
- [ ] Session totals (tokens, cost) auto-update when messages appended
- [ ] Compaction triggers at 160k tokens (logs "compacting session")
- [ ] Compaction generates a summary via Claude Haiku
- [ ] Manual compaction works via API
- [ ] Usage events are persisted to `usage_events` table
- [ ] Daily usage aggregation works

## Verification

```bash
pnpm --filter @ladestack/runtime test -- sessions
# expect: 2+ tests pass

# Manual
pnpm --filter @ladestack/api dev &
TOKEN=***
PROJECT=***
curl -X POST http://localhost:3001/api/sessions \
  -H "Authorization: Bearer *** \
  -H "Content-Type: application/json" \
  -d "{\"projectId\":\"$PROJECT\",\"title\":\"Test\"}"
# expect: {"id":"...","title":"Test",...}

SESSION_ID=...  # from above
curl http://localhost:3001/api/sessions/$SESSION_ID/messages \
  -H "Authorization: Bearer *** expect: {"messages":[]}

kill %1
```

## Notes

- **Compaction is append-only for MVP.** v1.1 deletes old messages and resets token counts. For now, the summary just gets appended and the old messages stay.
- **Token counting is approximate.** We use input + output tokens as a rough proxy for total context. Real token counting requires the actual tokenizer for each model.
- **Session `agent` field** lets you switch agents mid-session. Default is `build`.
- **`parentMessageId`** is for future branching (replay from a specific point). Not used in MVP.
- **Manual compaction** is exposed via API but no UI yet. v1.1 adds a "compact now" button.
- **Daily usage aggregation** runs on-demand for now. v1.1 caches in Redis.
- **The compaction threshold (160k tokens) is hardcoded.** v1.1 makes it configurable per project.
- **No streaming for compaction yet** — it returns the summary all at once. That's fine because it's a background operation.
- **The `trackUsage` function** is called by the agent loop in prompt 11. It's defined here for clarity.
