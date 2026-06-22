# Prompt 15: ChatPanel + Message Components

## Goal

Build the chat panel UI: streaming messages, role-based styling (user/assistant/tool/system), tool call rendering, plan-mode review UI.

## Context (from prompts 01-14)

- Backend fully wired (agent loop, SSE, all agents + tools).
- Frontend has placeholder IDE page (`/c/[projectId]/page.tsx`).
- Need to consume the SSE stream from prompt 11's API.

Reference: `../design.md` §6.1, §6.2 (chat message bubble, tool call card), `../agent-loop.md` §8 (SSE events).

## Task

### Step 1: Install SSE parser

```bash
cd apps/web
pnpm add eventsource-parser
pnpm add -D @types/eventsource-parser
pnpm add zustand  # for state management in prompt 18
pnpm add react-markdown remark-gfm  # for markdown rendering
pnpm add date-fns  # for relative timestamps
```

### Step 2: Build the SSE client hook

`apps/web/src/lib/useChatStream.ts`:

```ts
"use client"
import { useCallback, useRef, useState } from "react"

export interface StreamEvent {
  type: string
  data: any
}

export function useChatStream() {
  const [events, setEvents] = useState<StreamEvent[]>([])
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const start = useCallback(async (sessionId: string, body: { message: string; agent?: string; model?: any }) => {
    setStreaming(true)
    setError(null)
    setEvents([])
    abortRef.current = new AbortController()

    const token = localStorage.getItem("token")
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(body),
      signal: abortRef.current.signal
    })

    if (!res.ok || !res.body) {
      const errText = await res.text()
      setError(errText)
      setStreaming(false)
      return
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""

        let currentEvent = ""
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim()
          } else if (line.startsWith("data: ")) {
            const data = line.slice(6)
            try {
              const parsed = JSON.parse(data)
              setEvents((prev) => [...prev, { type: currentEvent, data: parsed }])
            } catch {}
            currentEvent = ""
          }
        }
      }
    } catch (err: any) {
      if (err.name !== "AbortError") setError(err.message)
    } finally {
      setStreaming(false)
    }
  }, [])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    setStreaming(false)
  }, [])

  return { events, streaming, error, start, cancel }
}
```

### Step 3: Build the Message component

`apps/web/src/components/chat/Message.tsx`:

```tsx
"use client"
import { cn } from "@/lib/utils"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

export interface ChatMessage {
  id: string
  role: "user" | "assistant" | "tool" | "system"
  agent?: string
  content: string
  toolCalls?: Array<{ id: string; name: string; input: any; output?: any; error?: string }>
  model?: string
  tokensIn?: number
  tokensOut?: number
  costCents?: number
  createdAt: Date
}

const AGENT_COLORS: Record<string, string> = {
  build: "border-l-gold",
  plan: "border-l-accent-purple",
  ask: "border-l-text-secondary",
  explore: "border-l-accent-blue",
  scout: "border-l-accent-blue",
  devops: "border-l-accent-blue",
  "security-review": "border-l-accent-red",
  summarize: "border-l-text-secondary"
}

export function Message({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end mb-4">
        <div className="max-w-2xl rounded-lg bg-elevated px-4 py-3">
          <p className="whitespace-pre-wrap text-text-primary">{message.content}</p>
        </div>
      </div>
    )
  }

  if (message.role === "system") {
    return (
      <div className="flex justify-center mb-4">
        <div className="max-w-2xl text-center text-sm text-text-tertiary">
          {message.content}
        </div>
      </div>
    )
  }

  // assistant or tool
  const borderColor = message.agent ? AGENT_COLORS[message.agent] ?? "border-l-border-subtle" : "border-l-border-subtle"
  return (
    <div className={cn("border-l-2 pl-4 mb-4", borderColor)}>
      {message.agent && (
        <div className="mb-1 text-xs text-text-tertiary">
          {message.agent}
          {message.model && <span className="ml-2 opacity-60">{message.model}</span>}
        </div>
      )}
      {message.content && (
        <div className="prose prose-invert max-w-none text-text-primary">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
        </div>
      )}
      {message.toolCalls?.map((call) => (
        <ToolCallInline key={call.id} call={call} />
      ))}
      {(message.tokensIn || message.tokensOut) && (
        <div className="mt-2 text-xs text-text-tertiary">
          {message.tokensIn}↑ {message.tokensOut}↓ · ${(message.costCents ?? 0) / 100}
        </div>
      )}
    </div>
  )
}

function ToolCallInline({ call }: { call: ChatMessage["toolCalls"]![number] }) {
  const [expanded, setExpanded] = useState(false)
  const statusColor = call.error ? "border-l-accent-red" : "border-l-accent-green"

  return (
    <div className={cn("mt-2 rounded border-l-2 bg-surface", statusColor)}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-3 py-2 text-left"
      >
        <span className="text-sm">
          <span className="text-text-tertiary">{call.error ? "✗" : "✓"}</span>{" "}
          <span className="text-text-primary font-mono">{call.name}</span>
        </span>
        <span className="text-xs text-text-tertiary">{expanded ? "▾" : "▸"}</span>
      </button>
      {expanded && (
        <div className="border-t border-border-subtle px-3 py-2 text-xs">
          {call.input && (
            <details open>
              <summary className="cursor-pointer text-text-secondary">Input</summary>
              <pre className="mt-1 overflow-x-auto rounded bg-canvas p-2 font-mono text-text-primary">
                {JSON.stringify(call.input, null, 2)}
              </pre>
            </details>
          )}
          {call.output && (
            <details>
              <summary className="cursor-pointer text-text-secondary">Output</summary>
              <pre className="mt-1 overflow-x-auto rounded bg-canvas p-2 font-mono text-text-primary">
                {JSON.stringify(call.output, null, 2)}
              </pre>
            </details>
          )}
          {call.error && (
            <div className="mt-1 text-accent-red">{call.error}</div>
          )}
        </div>
      )}
    </div>
  )
}
```

### Step 4: Build the ChatPanel

`apps/web/src/components/chat/ChatPanel.tsx`:

```tsx
"use client"
import { useEffect, useRef } from "react"
import { Message, type ChatMessage } from "./Message"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ChatInput } from "./ChatInput"
import { useChatStream } from "@/lib/useChatStream"

interface Props {
  sessionId: string
  initialMessages: ChatMessage[]
  mode: "build" | "plan"
  agent: string
  onModeChange: (mode: "build" | "plan") => void
}

export function ChatPanel({ sessionId, initialMessages, mode, agent, onModeChange }: Props) {
  const { events, streaming, error, start, cancel } = useChatStream()
  const bottomRef = useRef<HTMLDivElement>(null)

  // Build the messages list: persisted + streamed
  const streamedMessage = buildStreamedMessage(events)
  const messages: ChatMessage[] = [...initialMessages, ...(streamedMessage ? [streamedMessage] : [])]

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages.length, events.length])

  const handleSend = (text: string) => {
    start(sessionId, { message: text, agent: agent !== "build" ? agent : undefined })
  }

  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="flex-1 px-6 py-4">
        {messages.map((m) => <Message key={m.id} message={m} />)}
        {streaming && events.length === 0 && (
          <div className="flex items-center gap-2 text-text-tertiary">
            <span className="h-2 w-2 animate-pulse rounded-full bg-gold" />
            <span>Thinking...</span>
          </div>
        )}
        {error && (
          <div className="rounded border border-accent-red bg-surface px-4 py-3 text-accent-red">
            {error}
          </div>
        )}
        <div ref={bottomRef} />
      </ScrollArea>
      <ChatInput
        onSend={handleSend}
        onCancel={cancel}
        streaming={streaming}
        mode={mode}
        onModeChange={onModeChange}
      />
    </div>
  )
}

// Convert raw SSE events into a single streaming message
function buildStreamedMessage(events: any[]): ChatMessage | null {
  if (events.length === 0) return null

  let id = ""
  let agent = ""
  let text = ""
  const toolCalls: any[] = []
  let model = ""
  let tokensIn = 0
  let tokensOut = 0
  let costCents = 0

  for (const e of events) {
    if (e.type === "message_start") {
      id = e.data.id
      agent = e.data.agent
    } else if (e.type === "text_delta") {
      text += e.data.text
    } else if (e.type === "tool_start") {
      toolCalls.push({ id: e.data.id, name: e.data.name, input: e.data.input, output: undefined })
    } else if (e.type === "tool_end") {
      const call = toolCalls.find((c) => c.id === e.data.id)
      if (call) call.output = e.data.output
    } else if (e.type === "tool_error") {
      const call = toolCalls.find((c) => c.id === e.data.id)
      if (call) call.error = e.data.error
    } else if (e.type === "usage") {
      tokensIn = e.data.tokensIn
      tokensOut = e.data.tokensOut
      costCents = e.data.costCents
    } else if (e.type === "model") {
      model = e.data.model
    }
  }

  if (!id && !text && toolCalls.length === 0) return null

  return {
    id: id || `streaming-${Date.now()}`,
    role: "assistant",
    agent,
    content: text,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    model,
    tokensIn,
    tokensOut,
    costCents,
    createdAt: new Date()
  }
}
```

### Step 5: Wire into the IDE page

`apps/web/src/app/c/[projectId]/page.tsx`:

```tsx
"use client"
import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { ChatPanel } from "@/components/chat/ChatPanel"
import { api } from "@/lib/api"
import type { ChatMessage } from "@/components/chat/Message"

export default function IDEPage() {
  const params = useParams<{ projectId: string }>()
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [mode, setMode] = useState<"build" | "plan">("plan")
  const [agent, setAgent] = useState<string>("build")

  useEffect(() => {
    const init = async () => {
      // Create or fetch existing session
      const session = await api<{ id: string; agent: string }>(`/api/sessions`, {
        method: "POST",
        body: JSON.stringify({ projectId: params.projectId, title: "New chat" })
      })
      setSessionId(session.id)
      setAgent(session.agent)

      const { messages: msgs } = await api<{ messages: ChatMessage[] }>(`/api/sessions/${session.id}/messages`)
      setMessages(msgs)
    }
    init().catch(console.error)
  }, [params.projectId])

  if (!sessionId) return <div className="p-8 text-text-secondary">Loading...</div>

  return (
    <div className="flex h-full">
      <div className="flex-1">
        <ChatPanel
          sessionId={sessionId}
          initialMessages={messages}
          mode={mode}
          agent={agent}
          onModeChange={setMode}
        />
      </div>
      {/* Editor + preview go here in prompts 19-20 */}
    </div>
  )
}
```

### Step 6: Commit

```bash
git add -A
git commit -m "feat(web): ChatPanel + Message + SSE streaming UI (prompt 15)"
```

## Files created

```
apps/web/src/
├── lib/useChatStream.ts
└── components/chat/
    ├── Message.tsx
    └── ChatPanel.tsx

apps/web/src/app/c/[projectId]/page.tsx (rewrite)
```

## Acceptance criteria

- [ ] User messages appear right-aligned in elevated background
- [ ] Assistant messages appear left-aligned with agent color border
- [ ] Text streams in token-by-token
- [ ] Tool calls render as collapsible cards
- [ ] Tool errors show in red
- [ ] Plan/system messages render distinctively
- [ ] Auto-scroll to bottom as messages stream
- [ ] Cancel button stops streaming

## Verification

```bash
pnpm --filter @ladestack/web dev &
# Visit http://localhost:3000/c/<project-id>, sign in, send a message
# Expect: streaming response, tool calls visible, token count at bottom
kill %1
```

## Notes

- **Don't use react-markdown v8** — use v9 for ESM compatibility. v8 has CJS issues with Next.js 14.
- **Tailwind typography (`prose`) needs `@tailwindcss/typography`** — install if you haven't:
  ```bash
  pnpm add -D @tailwindcss/typography
  ```
  And in `tailwind.config.ts`:
  ```ts
  plugins: [require("@tailwindcss/typography")]
  ```
- **The streaming message is reconstructed in `buildStreamedMessage`** from raw SSE events. v1.1 can stream incrementally.
- **`useChatStream` uses fetch + manual SSE parsing** instead of `EventSource` because we need to POST (EventSource is GET-only).
- **Markdown rendering is enabled** for assistant messages. Code blocks, lists, etc. all work.
- **Token cost is shown as dollars (costCents / 100).** v1.1 adds proper formatting for international currencies.
- **Auto-scroll uses `behavior: smooth`** which is fine for desktop. On mobile it can be janky — use `behavior: "auto"` if needed.
- **The `agent` state** is per-session (set when session is created). User can switch via UI in prompt 17.
