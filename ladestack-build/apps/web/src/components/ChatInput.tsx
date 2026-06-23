"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import { Send, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { useStore } from "@/lib/store"
import { sendChatMessage, createSSEConnection } from "@/lib/api"
import type { Message } from "@/lib/types"

export function ChatInput() {
  const [input, setInput] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const {
    isStreaming,
    setIsStreaming,
    addMessage,
    updateMessage,
    setPreviewUrl,
    provider,
    model,
    apiKey,
    activeAgent,
  } = useStore()

  const autoResize = useCallback(() => {
    const el = textareaRef.current
    if (el) {
      el.style.height = "auto"
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`
    }
  }, [])

  useEffect(() => {
    autoResize()
  }, [input, autoResize])

  const handleSend = async () => {
    const trimmed = input.trim()
    if (!trimmed || isStreaming) return

    setInput("")

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
      timestamp: Date.now(),
      status: "complete",
      agentId: activeAgent ?? undefined,
    }
    addMessage(userMessage)

    const assistantMessageId = crypto.randomUUID()
    const assistantMessage: Message = {
      id: assistantMessageId,
      role: "assistant",
      content: "",
      timestamp: Date.now(),
      status: "streaming",
      agentId: activeAgent ?? undefined,
    }
    addMessage(assistantMessage)
    setIsStreaming(true)

    try {
      const res = await sendChatMessage({
        messages: [
          ...useStore.getState().messages
            .filter((m) => m.id !== assistantMessageId && m.status === "complete")
            .map((m) => ({ role: m.role, content: m.content })),
        ],
        agentId: activeAgent ?? undefined,
        provider,
        model,
        apiKey,
      })

      if (!res.ok) {
        const err = await res.json()
        updateMessage(assistantMessageId, {
          content: `Error: ${err.error || "Request failed"}`,
          status: "error",
        })
        setIsStreaming(false)
        return
      }

      let fullContent = ""

      createSSEConnection(res, {
        onChunk: (text) => {
          fullContent += text
          updateMessage(assistantMessageId, { content: fullContent })
        },
        onPreview: (url) => {
          setPreviewUrl(url)
        },
        onToolCall: (data) => {
          const tc = (data as { id?: string; name?: string; args?: Record<string, unknown> })
          updateMessage(assistantMessageId, {
            toolCalls: [
              {
                id: tc.id || crypto.randomUUID(),
                name: tc.name || "unknown",
                args: tc.args || {},
                status: "running",
              },
            ],
          })
        },
        onToolResult: (data) => {
          const dr = data as { name?: string; result?: unknown; duration?: number }
          updateMessage(assistantMessageId, {
            toolCalls: useStore
              .getState()
              .messages.find((m) => m.id === assistantMessageId)
              ?.toolCalls?.map((tc) =>
                tc.name === dr.name
                  ? { ...tc, result: dr.result, status: "success" as const, duration: dr.duration }
                  : tc
              ),
          })
        },
        onDone: () => {
          updateMessage(assistantMessageId, {
            content: fullContent,
            status: "complete",
          })
          setIsStreaming(false)
        },
        onError: (err) => {
          updateMessage(assistantMessageId, {
            content: fullContent || `Error: ${err.message}`,
            status: "error",
          })
          setIsStreaming(false)
        },
      })
    } catch (err) {
      updateMessage(assistantMessageId, {
        content: `Error: ${err instanceof Error ? err.message : "Request failed"}`,
        status: "error",
      })
      setIsStreaming(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="border-t border-border/50 bg-surface px-4 py-3">
      <div className="flex items-end gap-2">
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message... (Enter to send, Shift+Enter for newline)"
            rows={1}
            className="w-full resize-none rounded-lg border border-border/50 bg-surface-light px-3 py-2.5 pr-12 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary scrollbar-thin"
            disabled={isStreaming}
          />

          <div className="absolute bottom-1.5 right-1.5 flex items-center gap-1">
            {provider && (
              <span className="text-[10px] text-muted-foreground bg-surface px-1.5 py-0.5 rounded">
                {provider}/{model}
              </span>
            )}
          </div>
        </div>

        <button
          onClick={handleSend}
          disabled={!input.trim() || isStreaming}
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-colors",
            input.trim() && !isStreaming
              ? "bg-brand-gold text-brand-navy hover:bg-brand-gold-light"
              : "bg-surface-light text-muted-foreground cursor-not-allowed"
          )}
        >
          {isStreaming ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </button>
      </div>
    </div>
  )
}
