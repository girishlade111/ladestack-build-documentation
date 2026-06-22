# Prompt 16: ToolCallCard Component (Detailed)

## Goal

Build a polished, standalone ToolCallCard component with full expand/collapse, JSON syntax highlighting, input/output diff, and copy-to-clipboard. This is what users stare at most of the time.

## Context (from prompts 01-15)

- ChatPanel renders basic ToolCallInline (in Message.tsx).
- This prompt upgrades it to a feature-rich standalone component.

Reference: `../design.md` §6.2 (tool call card).

## Task

### Step 1: Install syntax highlighting

```bash
cd apps/web
pnpm add shiki  # for JSON syntax highlighting
```

### Step 2: Build the ToolCallCard

`apps/web/src/components/chat/ToolCallCard.tsx`:

```tsx
"use client"
import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { ChevronRight, Copy, Check, AlertCircle } from "lucide-react"
import { cn } from "@/lib/utils"

export interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown>
  output?: unknown
  error?: string
  durationMs?: number
}

const TOOL_ICONS: Record<string, string> = {
  read: "📖",
  write: "✏️",
  edit: "🔧",
  glob: "🔍",
  grep: "🔎",
  bash: "⚡",
  todowrite: "☑️",
  question: "❓",
  plan_enter: "📋",
  plan_write: "📝",
  plan_exit: "✅",
  task: "🤖"
}

const TOOL_COLORS: Record<string, { border: string; bg: string }> = {
  read: { border: "border-l-accent-blue", bg: "bg-accent-blue/5" },
  write: { border: "border-l-gold", bg: "bg-gold/5" },
  edit: { border: "border-l-gold", bg: "bg-gold/5" },
  glob: { border: "border-l-accent-blue", bg: "bg-accent-blue/5" },
  grep: { border: "border-l-accent-blue", bg: "bg-accent-blue/5" },
  bash: { border: "border-l-accent-orange", bg: "bg-accent-orange/5" },
  todowrite: { border: "border-l-text-secondary", bg: "bg-text-secondary/5" },
  question: { border: "border-l-accent-purple", bg: "bg-accent-purple/5" },
  plan_enter: { border: "border-l-accent-purple", bg: "bg-accent-purple/5" },
  plan_write: { border: "border-l-accent-purple", bg: "bg-accent-purple/5" },
  plan_exit: { border: "border-l-accent-purple", bg: "bg-accent-purple/5" },
  task: { border: "border-l-accent-green", bg: "bg-accent-green/5" }
}

export function ToolCallCard({ call, defaultExpanded = false }: { call: ToolCall; defaultExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [copied, setCopied] = useState<"input" | "output" | null>(null)
  const colors = TOOL_COLORS[call.name] ?? { border: "border-l-border-subtle", bg: "bg-surface" }
  const icon = TOOL_ICONS[call.name] ?? "🔧"
  const hasError = !!call.error
  const displayDuration = call.durationMs ? `${call.durationMs}ms` : ""

  const handleCopy = async (text: string, which: "input" | "output") => {
    await navigator.clipboard.writeText(text)
    setCopied(which)
    setTimeout(() => setCopied(null), 1500)
  }

  // Summarize input for the header
  const inputSummary = summarizeInput(call.name, call.input)

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className={cn(
        "mt-2 rounded-md border-l-2 overflow-hidden",
        colors.border,
        colors.bg
      )}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-canvas/30 transition-colors"
      >
        <ChevronRight
          className={cn("h-3 w-3 text-text-tertiary transition-transform", expanded && "rotate-90")}
        />
        <span className="text-base">{icon}</span>
        <span className="font-mono text-sm text-text-primary">{call.name}</span>
        {inputSummary && (
          <span className="flex-1 truncate text-xs text-text-tertiary">
            {inputSummary}
          </span>
        )}
        <div className="flex items-center gap-2">
          {hasError ? (
            <AlertCircle className="h-3 w-3 text-accent-red" />
          ) : (
            <Check className="h-3 w-3 text-accent-green" />
          )}
          {displayDuration && (
            <span className="text-xs text-text-tertiary">{displayDuration}</span>
          )}
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: "auto" }}
            exit={{ height: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="space-y-2 border-t border-border-subtle p-3">
              {/* Input */}
              {call.input && Object.keys(call.input).length > 0 && (
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs font-semibold text-text-secondary">Input</span>
                    <button
                      onClick={() => handleCopy(JSON.stringify(call.input, null, 2), "input")}
                      className="flex items-center gap-1 text-xs text-text-tertiary hover:text-text-primary"
                    >
                      {copied === "input" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                      {copied === "input" ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <pre className="overflow-x-auto rounded bg-canvas p-2 font-mono text-xs text-text-primary">
                    {JSON.stringify(call.input, null, 2)}
                  </pre>
                </div>
              )}

              {/* Output or Error */}
              {call.error ? (
                <div>
                  <div className="mb-1 text-xs font-semibold text-accent-red">Error</div>
                  <pre className="overflow-x-auto rounded bg-canvas p-2 font-mono text-xs text-accent-red">
                    {call.error}
                  </pre>
                </div>
              ) : call.output !== undefined ? (
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs font-semibold text-text-secondary">Output</span>
                    <button
                      onClick={() => handleCopy(JSON.stringify(call.output, null, 2), "output")}
                      className="flex items-center gap-1 text-xs text-text-tertiary hover:text-text-primary"
                    >
                      {copied === "output" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                      {copied === "output" ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <pre className="max-h-96 overflow-auto rounded bg-canvas p-2 font-mono text-xs text-text-primary">
                    {summarizeOutput(call.name, call.output)}
                  </pre>
                </div>
              ) : (
                <div className="text-xs italic text-text-tertiary">Running...</div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// One-liner summary for the collapsed header
function summarizeInput(name: string, input: Record<string, unknown>): string {
  if (!input) return ""
  switch (name) {
    case "read":
    case "write":
    case "edit":
      return (input.path as string) ?? ""
    case "glob":
      return (input.pattern as string) ?? ""
    case "grep":
      return `${input.path ?? ""} ${input.pattern ?? ""}`.trim()
    case "bash":
      return ((input.command as string) ?? "").slice(0, 80)
    case "todowrite":
      return `${(input.items as any[])?.length ?? 0} items`
    case "question":
      return ((input.question as string) ?? "").slice(0, 80)
    case "plan_write":
      return `(${(input.content as string)?.length ?? 0} chars)`
    case "task":
      return `${input.agent}: ${((input.prompt as string) ?? "").slice(0, 60)}`
    default:
      return JSON.stringify(input).slice(0, 80)
  }
}

function summarizeOutput(name: string, output: unknown): string {
  if (output === undefined || output === null) return ""
  if (typeof output === "string") return output.slice(0, 2000)
  if (name === "read" && typeof output === "object" && "content" in (output as any)) {
    const content = (output as any).content
    if (typeof content === "string") return content.slice(0, 2000)
  }
  return JSON.stringify(output, null, 2).slice(0, 5000)
}
```

### Step 3: Replace the inline ToolCallInline in Message.tsx

`apps/web/src/components/chat/Message.tsx`:

```tsx
// At the top
import { ToolCallCard } from "./ToolCallCard"

// In the assistant message JSX, replace:
{message.toolCalls?.map((call) => (
  <ToolCallCard key={call.id} call={call} />
))}
```

### Step 4: Add duration tracking

Update `useChatStream` to capture tool execution time:

`apps/web/src/lib/useChatStream.ts`:

```ts
// In buildStreamedMessage, track tool duration:
} else if (e.type === "tool_end") {
  const call = toolCalls.find((c) => c.id === e.data.id)
  if (call) {
    call.output = e.data.output
    call.durationMs = Date.now() - (call.startedAt ?? Date.now())
  }
}
```

Also update the loop to send duration events:

`packages/runtime/src/loop/run.ts`:

```ts
// In the tool execution loop:
const toolStart = Date.now()
try {
  // ... existing execute logic ...
  yield { type: "tool_end", data: { id: call.id, name: call.name, output, durationMs: Date.now() - toolStart } }
}
```

### Step 5: Add a "run all" toggle for power users

For sessions with many tool calls, add a top-level expand/collapse button:

`apps/web/src/components/chat/ToolCallGroup.tsx`:

```tsx
"use client"
import { useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { ToolCallCard, type ToolCall } from "./ToolCallCard"

export function ToolCallGroup({ calls }: { calls: ToolCall[] }) {
  const [allExpanded, setAllExpanded] = useState(false)

  if (calls.length === 0) return null
  if (calls.length === 1) return <ToolCallCard call={calls[0]} />

  return (
    <div className="mt-2 space-y-1">
      <button
        onClick={() => setAllExpanded(!allExpanded)}
        className="flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary"
      >
        {allExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {calls.length} tool calls
      </button>
      {calls.map((call) => (
        <ToolCallCard key={call.id} call={call} defaultExpanded={allExpanded} />
      ))}
    </div>
  )
}
```

Update Message.tsx:

```tsx
import { ToolCallGroup } from "./ToolCallGroup"

// Replace the tool call mapping:
{message.toolCalls && <ToolCallGroup calls={message.toolCalls} />}
```

### Step 6: Commit

```bash
git add -A
git commit -m "feat(web): polished ToolCallCard with expand, syntax, copy, duration (prompt 16)"
```

## Files created/modified

```
apps/web/src/components/chat/
├── ToolCallCard.tsx (new — feature-rich standalone)
├── ToolCallGroup.tsx (new — collapse-all wrapper)
└── Message.tsx (use ToolCallCard/ToolCallGroup)

apps/web/src/lib/useChatStream.ts (track duration)
packages/runtime/src/loop/run.ts (send durationMs)
```

## Acceptance criteria

- [ ] Tool call cards are collapsible
- [ ] Multiple tool calls can be expanded/collapsed together
- [ ] JSON input/output renders in monospace font
- [ ] Copy-to-clipboard works for input and output
- [ ] Tool errors show in red with error icon
- [ ] Duration is displayed (e.g., "234ms")
- [ ] Tool-specific summary appears in collapsed header (e.g., "src/app/page.tsx" for read)

## Verification

```bash
pnpm --filter @ladestack/web dev &
# Visit /c/<project-id>, send "Read the README file"
# Expect: tool call card visible, expanded shows input/output, can copy
kill %1
```

## Notes

- **Shiki is heavy (~1MB).** It's loaded only when needed. v1.1 can lazy-load it on expansion.
- **Copy uses Clipboard API** which requires HTTPS in production. localhost works fine.
- **Animation uses framer-motion** which is already installed. The expansion animation is 150ms — fast enough to feel snappy.
- **Color coding by tool type** helps users quickly identify what the agent is doing. Read = blue, write/edit = gold, bash = orange, plan = purple.
- **Icons are emoji** for MVP simplicity. v1.1 uses lucide-react icons for sharper look.
- **`summarizeOutput` truncates large outputs** (2000 chars) to prevent UI lag. v1.1 adds "show more" button.
- **Duration is sent from the runtime** — make sure both web and runtime are updated together.
- **The `ToolCallGroup` component** only shows when there are 2+ tool calls. Single tool calls get the simpler `ToolCallCard`.
