# Prompt 17: ChatInput Component

## Goal

Build the chat input with mode toggle (Plan/Build), agent selector, model picker, attachment support, send button, and cancel button.

## Context (from prompts 01-16)

- ChatPanel renders messages but uses a stub ChatInput.
- Need the actual input with all the controls.

Reference: `../design.md` §6.3 (chat input), §9 (keyboard shortcuts).

## Task

### Step 1: Build the ChatInput

`apps/web/src/components/chat/ChatInput.tsx`:

```tsx
"use client"
import { useState, useRef, useEffect, KeyboardEvent } from "react"
import { Send, Square, Paperclip, X, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

interface Props {
  onSend: (text: string) => void
  onCancel: () => void
  streaming: boolean
  mode: "build" | "plan"
  onModeChange: (mode: "build" | "plan") => void
  agent?: string
  onAgentChange?: (agent: string) => void
  model?: string
  onModelChange?: (model: string) => void
}

const MODELS = [
  { id: "anthropic/claude-sonnet-4-20250514", label: "Claude Sonnet 4", provider: "anthropic" },
  { id: "anthropic/claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku", provider: "anthropic" },
  { id: "openai/gpt-4o", label: "GPT-4o", provider: "openai" },
  { id: "openai/gpt-4o-mini", label: "GPT-4o Mini", provider: "openai" },
  { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro", provider: "google" },
  { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash", provider: "google" }
]

const PLACEHOLDERS = {
  plan: "Describe what to build or change...",
  build: "Send a follow-up message..."
}

export function ChatInput({ onSend, onCancel, streaming, mode, onModeChange, agent = "build", model, onAgentChange, onModelChange }: Props) {
  const [text, setText] = useState("")
  const [attachments, setAttachments] = useState<File[]>([])
  const [showModelPicker, setShowModelPicker] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Auto-resize textarea
  useEffect(() => {
    if (!textareaRef.current) return
    textareaRef.current.style.height = "auto"
    textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`
  }, [text])

  const handleSend = () => {
    if (!text.trim() || streaming) return
    onSend(text.trim())
    setText("")
    setAttachments([])
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    setAttachments((prev) => [...prev, ...files])
    e.target.value = ""  // reset
  }

  const removeAttachment = (i: number) => {
    setAttachments((prev) => prev.filter((_, idx) => idx !== i))
  }

  return (
    <div className="border-t border-border-subtle bg-surface px-4 py-3">
      {/* Attachments */}
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {attachments.map((file, i) => (
            <div key={i} className="flex items-center gap-1 rounded bg-elevated px-2 py-1 text-xs">
              <Paperclip className="h-3 w-3" />
              <span>{file.name}</span>
              <button onClick={() => removeAttachment(i)} className="text-text-tertiary hover:text-text-primary">
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Textarea */}
      <Textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={PLACEHOLDERS[mode]}
        disabled={streaming}
        rows={1}
        className="min-h-[40px] resize-none border-none bg-transparent text-text-primary placeholder:text-text-tertiary focus-visible:ring-0"
      />

      {/* Bottom toolbar */}
      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* Attachment button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={streaming}
                className="rounded p-1.5 text-text-tertiary hover:bg-elevated hover:text-text-primary disabled:opacity-50"
              >
                <Paperclip className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Attach screenshot or file</TooltipContent>
          </Tooltip>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            onChange={handleFileSelect}
          />

          {/* Mode toggle */}
          <div className="flex rounded border border-border-subtle bg-elevated">
            <button
              onClick={() => onModeChange("plan")}
              disabled={streaming}
              className={cn(
                "px-2 py-0.5 text-xs transition-colors",
                mode === "plan" ? "bg-accent-purple text-canvas" : "text-text-tertiary hover:text-text-primary",
                "rounded-l"
              )}
            >
              Plan
            </button>
            <button
              onClick={() => onModeChange("build")}
              disabled={streaming}
              className={cn(
                "px-2 py-0.5 text-xs transition-colors",
                mode === "build" ? "bg-gold text-canvas" : "text-text-tertiary hover:text-text-primary",
                "rounded-r"
              )}
            >
              Build
            </button>
          </div>

          {/* Agent picker */}
          {onAgentChange && (
            <select
              value={agent}
              onChange={(e) => onAgentChange(e.target.value)}
              disabled={streaming}
              className="rounded border border-border-subtle bg-elevated px-2 py-0.5 text-xs text-text-primary"
            >
              <option value="build">Build</option>
              <option value="plan">Plan</option>
              <option value="ask">Ask</option>
            </select>
          )}

          {/* Model picker */}
          {onModelChange && (
            <div className="relative">
              <button
                onClick={() => setShowModelPicker(!showModelPicker)}
                disabled={streaming}
                className="flex items-center gap-1 rounded border border-border-subtle bg-elevated px-2 py-0.5 text-xs text-text-primary"
              >
                {model ?? "claude-sonnet-4-20250514"}
                <ChevronDown className="h-3 w-3" />
              </button>
              {showModelPicker && (
                <div className="absolute bottom-full left-0 mb-1 w-64 rounded-md border border-border-subtle bg-elevated shadow-lg">
                  {MODELS.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => { onModelChange(m.id); setShowModelPicker(false) }}
                      className="block w-full px-3 py-2 text-left text-xs hover:bg-canvas"
                    >
                      <div className="text-text-primary">{m.label}</div>
                      <div className="text-text-tertiary">{m.id}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Send / Cancel */}
        <div className="flex items-center gap-2">
          {streaming ? (
            <Button
              onClick={onCancel}
              size="sm"
              variant="outline"
              className="border-accent-red text-accent-red hover:bg-accent-red/10"
            >
              <Square className="h-3 w-3" />
              Cancel
            </Button>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={handleSend}
                  size="sm"
                  disabled={!text.trim()}
                  className="bg-gold text-canvas hover:bg-gold-hi"
                >
                  <Send className="h-3 w-3" />
                  Send
                </Button>
              </TooltipTrigger>
              <TooltipContent>Send (⌘+Enter)</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  )
}
```

### Step 2: Wire mode + agent into the IDE page

Update `apps/web/src/app/c/[projectId]/page.tsx`:

```tsx
// Add mode + agent state
const [mode, setMode] = useState<"build" | "plan">("plan")
const [agent, setAgent] = useState<string>("build")

// Handler to change mode (also calls API)
const handleModeChange = async (newMode: "build" | "plan") => {
  setMode(newMode)
  if (sessionId) {
    await api(`/api/sessions/${sessionId}/${newMode}`, { method: "POST" })
  }
}

// Pass to ChatPanel
<ChatPanel
  sessionId={sessionId}
  initialMessages={messages}
  mode={mode}
  agent={agent}
  onModeChange={handleModeChange}
  // ... 
/>
```

### Step 3: Update ChatPanel to pass through agent

`apps/web/src/components/chat/ChatPanel.tsx`:

```tsx
// In ChatPanel props, add agent and onAgentChange
interface Props {
  sessionId: string
  initialMessages: ChatMessage[]
  mode: "build" | "plan"
  agent: string
  onModeChange: (mode: "build" | "plan") => void
  onAgentChange?: (agent: string) => void
}

// Pass to ChatInput
<ChatInput
  ...
  agent={agent}
  onAgentChange={onAgentChange}
/>

// Pass to useChatStream start:
const handleSend = (text: string) => {
  start(sessionId, { message: text, agent })
}
```

### Step 4: Add keyboard shortcuts

`apps/web/src/lib/useKeyboardShortcuts.ts`:

```ts
"use client"
import { useEffect } from "react"

export function useKeyboardShortcuts(handlers: Record<string, () => void>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      // ⌘+. toggles plan/build
      if (mod && e.key === "."") {
        e.preventDefault()
        handlers.toggleMode?.()
      }
      // ⌘+Enter handled by ChatInput directly
      // ⌘+K opens command palette (prompt 18+)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [handlers])
}
```

Use in IDE page:

```tsx
useKeyboardShortcuts({
  toggleMode: () => handleModeChange(mode === "plan" ? "build" : "plan")
})
```

### Step 5: Test end-to-end

```bash
pnpm --filter @ladestack/web dev &
# Visit http://localhost:3000/c/<project-id>
# Try:
# - Typing and sending
# - Toggling Plan/Build
# - Cmd+. to toggle
# - Cmd+Enter to send
# - Attaching an image
kill %1
```

### Step 6: Commit

```bash
git add -A
git commit -m "feat(web): ChatInput with mode toggle, agent picker, attachments, shortcuts (prompt 17)"
```

## Files created/modified

```
apps/web/src/components/chat/ChatInput.tsx (new)
apps/web/src/lib/useKeyboardShortcuts.ts (new)
apps/web/src/components/chat/ChatPanel.tsx (update)
apps/web/src/app/c/[projectId]/page.tsx (update)
```

## Acceptance criteria

- [ ] Textarea auto-resizes as you type
- [ ] Plan/Build mode toggle works
- [ ] Cmd+. toggles mode
- [ ] Cmd+Enter sends
- [ ] Cancel button appears during streaming
- [ ] Attachment button opens file picker
- [ ] Image attachments show as removable chips
- [ ] Agent picker shows 3 agents (Build, Plan, Ask)
- [ ] Model picker shows 6 models with provider labels
- [ ] Send button disabled when text is empty or streaming

## Verification

```bash
pnpm --filter @ladestack/web dev &
# Manual test: type, toggle, send, cancel, attach
kill %1
```

## Notes

- **Cmd+Enter for send is universal** (Slack, Discord, Linear all do this). Don't change it.
- **Cmd+. for mode toggle** is a convention from Cursor / Claude Code. Users will expect it.
- **Attachment upload is not yet wired** to send with the message. v1.1 adds S3/Supabase Storage upload + image message support.
- **Model picker is read-only** for now — clicking a model sets it for the next message. v1.1 adds persistence to session.
- **Agent picker shows only 3 agents** (Build, Plan, Ask). Subagents (explore, scout) are not user-selectable — they're spawned by the task tool.
- **The textarea auto-resize** has a max-height of 200px. After that, it scrolls internally. This prevents the input from taking over the screen.
- **Image attachments only** — accept="image/*". v1.1 adds PDF, code files.
- **Cmd+. also fires when focus is in the textarea** — tested via `useKeyboardShortcuts` which listens at window level. Make sure it doesn't conflict with native browser shortcuts (Cmd+. doesn't have a default in most browsers).
