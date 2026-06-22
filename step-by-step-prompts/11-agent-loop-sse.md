# Prompt 11: Agent Loop + SSE Streaming

## Goal

Build the core agent loop that:
1. Receives a user message
2. Composes the system prompt
3. Streams LLM response
4. Executes tool calls in a loop
5. Streams everything back to the client via SSE
6. Persists messages and tracks usage

This is the heart of the system.

## Context (from prompts 01-10)

- All foundation, agents, tools, sessions built.
- API session route has a stub `POST /:id/messages` that needs the real implementation.

Reference: `../agent-loop.md` §2 (canonical loop), §8 (SSE protocol), §9 (error handling).

## Task

### Step 1: Implement the loop

`packages/runtime/src/loop/run.ts`:

```ts
import type { Message, Session } from "../sessions/types.js"
import { appendMessage, maybeCompact } from "../sessions/service.js"
import { trackUsage } from "../sessions/usage.js"
import { composeSystemPrompt } from "../agents/compose.js"
import { require as requireAgent } from "../agents/registry.js"
import { getProvider } from "../providers/registry.js"
import { resolveApiKey } from "../providers/keys.js"
import { listToolsForAgent, getTool } from "../tools/registry.js"
import { markFileRead } from "../tools/write.js"
import { log } from "../lib/logger.js"
import { randomUUID } from "crypto"
import type { ChatMessage, CompletionChunk, ToolDefinition } from "../providers/types.js"

export interface LoopInput {
  sessionId: string
  userId: string
  projectId: string
  userMessage: string
  agentName?: string              // if not specified, auto-select or use session default
  modelOverride?: { providerID: string; modelID: string }
  signal?: AbortSignal
}

export interface LoopEvent {
  type:
    | "text_delta"
    | "tool_start"
    | "tool_end"
    | "tool_error"
    | "usage"
    | "message_start"
    | "message_end"
    | "error"
    | "done"
    | "session_compacted"
  data: any
}

export async function* runLoop(input: LoopInput): AsyncGenerator<LoopEvent> {
  const session = await getSessionWithProject(input.sessionId)
  if (!session) {
    yield { type: "error", data: { code: "session_not_found" } }
    return
  }

  const agent = requireAgent(input.agentName ?? session.agent)

  // 1. Persist user message
  const userMsg = await appendMessage({
    sessionId: input.sessionId,
    role: "user",
    content: input.userMessage,
    agent: agent.name
  })

  // 2. Load history
  const history = await getRecentMessagesWithLimit(input.sessionId, 30)

  // 3. Maybe compact
  const compactResult = await maybeCompact(input.sessionId, input.userId)
  if (compactResult.compacted) {
    yield { type: "session_compacted", data: { summaryMessageId: compactResult.summaryMessageId } }
  }

  // 4. Run loop (max N steps)
  const maxSteps = (await import("../agents/registry.js")).require(agent.name).steps ?? 25
  let step = 0
  let currentMessages: ChatMessage[] = historyToChatMessages(history)

  while (step < maxSteps) {
    step++
    if (input.signal?.aborted) {
      yield { type: "error", data: { code: "aborted" } }
      return
    }

    // 5. Compose prompt
    const built = await composeSystemPrompt({
      agent,
      userId: input.userId,
      projectId: input.projectId,
      sessionId: input.sessionId,
      env: getDefaultEnv(input.projectId),
      skills: []  // TODO: load from skills registry
    })

    // 6. Call LLM
    const apiKey = await resolveApiKey(input.userId, agent.model?.providerID ?? "anthropic")
    const provider = getProvider(agent.model?.providerID ?? "anthropic")
    const model = input.modelOverride ?? agent.model ?? { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" }

    const messageId = randomUUID()
    yield { type: "message_start", data: { id: messageId, agent: agent.name } }

    let accumulatedText = ""
    let toolCalls: any[] = []
    let usage = { tokensIn: 0, tokensOut: 0, costCents: 0 }
    let error: { code: string; message: string } | null = null

    try {
      const stream = provider.complete({
        model,
        messages: currentMessages,
        system: built.system,
        tools: built.tools,
        temperature: built.temperature,
        maxTokens: built.maxTokens,
        stream: true,
        signal: input.signal
      }, apiKey)

      for await (const chunk of stream) {
        if (chunk.type === "text") {
          accumulatedText += chunk.text
          yield { type: "text_delta", data: { text: chunk.text } }
        } else if (chunk.type === "tool_call") {
          toolCalls.push(chunk.toolCall)
          yield { type: "tool_start", data: { id: chunk.toolCall.id, name: chunk.toolCall.name, input: chunk.toolCall.input } }
        } else if (chunk.type === "usage") {
          usage = { tokensIn: chunk.tokensIn, tokensOut: chunk.tokensOut, costCents: chunk.costCents }
          yield { type: "usage", data: usage }
        } else if (chunk.type === "error") {
          error = chunk.error
          yield { type: "error", data: chunk.error }
        }
      }
    } catch (err: any) {
      error = { code: "llm_error", message: err.message }
      yield { type: "error", data: error }
    }

    // 7. Persist assistant message
    const assistantMsg = await appendMessage({
      sessionId: input.sessionId,
      role: "assistant",
      content: accumulatedText,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      agent: agent.name,
      model: `${model.providerID}/${model.modelID}`,
      tokensIn: usage.tokensIn,
      tokensOut: usage.tokensOut,
      costCents: usage.costCents
    })

    yield { type: "message_end", data: { id: assistantMsg.id, usage } }

    // 8. Track usage
    await trackUsage({
      userId: input.userId,
      projectId: input.projectId,
      sessionId: input.sessionId,
      eventType: "message",
      agent: agent.name,
      model: `${model.providerID}/${model.modelID}`,
      tokensIn: usage.tokensIn,
      tokensOut: usage.tokensOut,
      costCents: usage.costCents
    })

    if (error) {
      yield { type: "done", data: { stopReason: "error" } }
      return
    }

    // 9. Execute tool calls
    if (toolCalls.length === 0) {
      yield { type: "done", data: { stopReason: "end_turn" } }
      return
    }

    for (const call of toolCalls) {
      if (input.signal?.aborted) {
        yield { type: "error", data: { code: "aborted" } }
        return
      }

      const tool = getTool(call.name)
      if (!tool) {
        const errMsg = `tool not found: ${call.name}`
        yield { type: "tool_error", data: { id: call.id, name: call.name, error: errMsg } }
        await appendMessage({
          sessionId: input.sessionId,
          role: "tool",
          toolCallId: call.id,
          content: `Error: ${errMsg}`,
          agent: agent.name
        })
        continue
      }

      try {
        const input2 = tool.inputSchema.parse(call.input)
        const result = await tool.execute(input2, {
          userId: input.userId,
          projectId: input.projectId,
          sessionId: input.sessionId,
          abortSignal: input.signal ?? new AbortController().signal
        })
        const output = tool.outputSchema.parse(result)

        yield { type: "tool_end", data: { id: call.id, name: call.name, output } }

        await appendMessage({
          sessionId: input.sessionId,
          role: "tool",
          toolCallId: call.id,
          content: JSON.stringify(output),
          agent: agent.name
        })

        // Track read files so write/edit can verify
        if (call.name === "read") markFileRead(input.sessionId, call.input.path)
      } catch (err: any) {
        const errMsg = err.message ?? "tool execution failed"
        yield { type: "tool_error", data: { id: call.id, name: call.name, error: errMsg } }
        await appendMessage({
          sessionId: input.sessionId,
          role: "tool",
          toolCallId: call.id,
          content: `Error: ${errMsg}`,
          agent: agent.name
        })
      }
    }

    // 10. Reload history and loop
    const newHistory = await getRecentMessagesWithLimit(input.sessionId, 30)
    currentMessages = historyToChatMessages(newHistory)
  }

  yield { type: "done", data: { stopReason: "max_steps", steps: step } }
}

// Helpers
async function getSessionWithProject(id: string): Promise<Session | undefined> {
  const { getSession } = await import("../sessions/service.js")
  return await getSession(id)
}

async function getRecentMessagesWithLimit(sessionId: string, limit: number): Promise<Message[]> {
  const { getRecentMessages } = await import("../sessions/service.js")
  return await getRecentMessages(sessionId, limit)
}

function historyToChatMessages(history: Message[]): ChatMessage[] {
  return history
    .filter((m) => m.role !== "system")  // skip system messages (summaries)
    .map((m): ChatMessage => {
      if (m.role === "user") return { role: "user", content: m.content }
      if (m.role === "assistant") {
        return {
          role: "assistant",
          content: m.content,
          tool_calls: m.toolCalls
        }
      }
      if (m.role === "tool") return { role: "tool", tool_call_id: m.toolCallId!, content: m.content }
      return { role: "user", content: m.content }
    })
}

function getDefaultEnv(projectId: string) {
  return {
    platform: process.platform,
    nodeVersion: process.version,
    today: new Date().toDateString(),
    projectName: projectId,  // TODO: lookup
    projectType: "Next.js",
    workingDirectory: "/workspace",
    defaultMode: "plan" as const,
    defaultModel: { providerID: "anthropic" as const, modelID: "claude-sonnet-4-20250514" }
  }
}
```

### Step 2: Implement the abort controller service

`packages/runtime/src/loop/abort.ts`:

```ts
const controllers = new Map<string, AbortController>()

export function createAbort(sessionId: string): AbortController {
  const existing = controllers.get(sessionId)
  if (existing) existing.abort()  // abort any in-flight
  const controller = new AbortController()
  controllers.set(sessionId, controller)
  return controller
}

export function getAbort(sessionId: string): AbortController | undefined {
  return controllers.get(sessionId)
}

export function clearAbort(sessionId: string): void {
  controllers.delete(sessionId)
}
```

### Step 3: Update API session route (real implementation)

`packages/api/src/routes/sessions.ts`:

```ts
import { Hono } from "hono"
import { z } from "zod"
import { streamSSE } from "hono/streaming"
import { authMiddleware, type AuthContext } from "../middleware/auth.js"
import { sessions, runLoop, createAbort, getAbort } from "@ladestack/runtime"

const sendMessageSchema = z.object({
  message: z.string().min(1).max(8000),
  agent: z.string().optional(),
  model: z.object({
    providerID: z.enum(["anthropic", "openai", "google"]),
    modelID: z.string()
  }).optional()
})

export const sessionRoutes = new Hono<{ Variables: { auth: AuthContext } }>()
  .use("*", authMiddleware)

  .get("/by-project/:projectId", async (c) => {
    const projectId = c.req.param("projectId")
    const list = await sessions.listSessions(projectId)
    return c.json({ sessions: list })
  })

  .post("/", zValidator("json", z.object({
    projectId: z.string(),
    title: z.string().optional()
  })), async (c) => {
    const body = c.req.valid("json")
    const session = await sessions.createSession(body.projectId, { title: body.title })
    return c.json(session, 201)
  })

  .get("/:id", async (c) => {
    const session = await sessions.getSession(c.req.param("id"))
    if (!session) return c.json({ error: "not_found" }, 404)
    return c.json(session)
  })

  .get("/:id/messages", async (c) => {
    const messages = await sessions.getRecentMessages(c.req.param("id"), 50)
    return c.json({ messages })
  })

  .post("/:id/messages", zValidator("json", sendMessageSchema), async (c) => {
    const sessionId = c.req.param("id")
    const body = c.req.valid("json")
    const { auth } = c.var
    const session = await sessions.getSession(sessionId)
    if (!session) return c.json({ error: "session_not_found" }, 404)

    return streamSSE(c, async (stream) => {
      const abort = createAbort(sessionId)
      try {
        for await (const event of runLoop({
          sessionId,
          userId: auth.userId,
          projectId: session.projectId,
          userMessage: body.message,
          agentName: body.agent,
          modelOverride: body.model,
          signal: abort.signal
        })) {
          await stream.writeSSE({
            event: event.type,
            data: JSON.stringify(event.data)
          })
        }
      } catch (err: any) {
        await stream.writeSSE({
          event: "error",
          data: JSON.stringify({ message: err.message })
        })
      } finally {
        clearAbort(sessionId)
      }
    })
  })

  .post("/:id/cancel", async (c) => {
    const controller = getAbort(c.req.param("id"))
    if (controller) controller.abort()
    return c.json({ cancelled: true })
  })

  .delete("/:id", async (c) => {
    await sessions.deleteSession(c.req.param("id"))
    return c.json({ deleted: c.req.param("id") })
  })
```

### Step 4: Update runtime index

```ts
// Add to packages/runtime/src/index.ts
export * from "./loop/run.js"
export * from "./loop/abort.js"
```

### Step 5: Write an integration test

`packages/runtime/src/loop/run.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest"
import { runLoop } from "./run.js"
import { createSession, getMessages } from "../sessions/service.js"

const TEST_USER = "test-user-" + Date.now()
const TEST_PROJECT = "test-proj-" + Date.now()

describe("runLoop integration", () => {
  beforeAll(() => {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set")
    if (!process.env.SUPABASE_URL) throw new Error("SUPABASE_URL not set")
  })

  it("runs a simple turn end-to-end", async () => {
    const session = await createSession(TEST_PROJECT, { title: "Loop test" })

    const events: any[] = []
    for await (const event of runLoop({
      sessionId: session.id,
      userId: TEST_USER,
      projectId: TEST_PROJECT,
      userMessage: "Reply with just the word 'hello' and nothing else.",
      agentName: "build"
    })) {
      events.push(event)
    }

    // Should have at least: message_start, text_delta (or error), message_end, usage, done
    expect(events.find((e) => e.type === "message_start")).toBeDefined()
    expect(events.find((e) => e.type === "usage")).toBeDefined()
    expect(events.find((e) => e.type === "done")).toBeDefined()

    // Check messages were persisted
    const messages = await getMessages(session.id)
    expect(messages.find((m) => m.role === "user")).toBeDefined()
    expect(messages.find((m) => m.role === "assistant")).toBeDefined()
  }, { timeout: 60000 })
})
```

### Step 6: Manual test via API

```bash
pnpm --filter @ladestack/api dev &
TOKEN=***
SESSION=***

# Start a turn and stream SSE
curl -N -X POST http://localhost:3001/api/sessions/$SESSION/messages \
  -H "Authorization: Bearer *** \
  -H "Content-Type: application/json" \
  -d '{"message":"Reply with just the word hello","agent":"build"}'
# expect: SSE stream with events:
# event: message_start
# event: text_delta
# data: {"text":"hello"}
# event: usage
# data: {"tokensIn":...}
# event: message_end
# event: done

kill %1
```

### Step 7: Commit

```bash
git add -A
git commit -m "feat(runtime): agent loop with SSE streaming + tool execution (prompt 11)"
```

## Files created/modified

```
packages/runtime/src/loop/
├── run.ts
├── run.test.ts
└── abort.ts

packages/api/src/routes/sessions.ts (real implementation)
```

## Acceptance criteria

- [ ] `runLoop` streams events as the agent works
- [ ] User messages are persisted before the loop starts
- [ ] Assistant messages are persisted after each LLM response
- [ ] Tool calls are executed and results persisted
- [ ] SSE endpoint streams all events to the client
- [ ] Abort works (POST /:id/cancel stops the loop)
- [ ] Usage events are tracked
- [ ] Compaction triggers when context > 160k tokens
- [ ] Errors don't crash the loop (graceful error events)

## Verification

```bash
pnpm --filter @ladestack/runtime test -- runLoop
# expect: integration test passes (requires ANTHROPIC_API_KEY)
```

Manual end-to-end:
```bash
# 1. Signup, create project, create session
# 2. Send message, verify SSE stream
# 3. Check DB: messages should be persisted
# 4. Send another message, verify context loads previous
```

## Notes

- **The loop is the most critical code in the system.** Test it thoroughly.
- **`historyToChatMessages` filters out system messages.** Summaries should use a different mechanism (v1.1).
- **Abort signal is shared per session** — sending a new message aborts the previous turn.
- **Error handling is best-effort** — a tool that throws doesn't crash the loop; the error is fed back to the LLM as a tool message.
- **The loop loads history BEFORE the user message** — so the user message is already persisted. This means the LLM sees its own previous turns.
- **Max steps (25) is per turn.** A single user message can trigger up to 25 LLM calls + tool executions. This is a hard cap to prevent runaway loops.
- **Compaction only triggers on the first step.** v1.1 triggers it between steps too.
- **Streaming chunks are NOT persisted incrementally** — only the final message is persisted. This is fine because we have the final text. v1.1 can add incremental persistence for crash recovery.
- **The agent registry requires exact match** — typos in `agentName` will throw. The API catches this and returns 400.
- **Tool input validation failures** are caught and fed back as tool errors. The LLM can retry.
- **Session `parentMessageId` is unused for now.** v1.1 adds fork support.
- **The cancel endpoint** is exposed but not wired into the UI. Prompt 15+ adds the cancel button.
