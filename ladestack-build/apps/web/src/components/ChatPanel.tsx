"use client"

import { useEffect, useRef } from "react"
import { MessageSquare } from "lucide-react"
import { useStore } from "@/lib/store"
import { MessageBubble } from "@/components/MessageBubble"
import { ChatInput } from "@/components/ChatInput"

export function ChatPanel() {
  const messages = useStore((s) => s.messages)
  const isStreaming = useStore((s) => s.isStreaming)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  return (
    <div className="flex flex-col h-full bg-surface">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/50">
        <MessageSquare className="h-4 w-4 text-brand-gold" />
        <span className="text-sm font-semibold text-foreground">Chat</span>
        {isStreaming && (
          <span className="ml-auto text-[10px] text-brand-gold animate-pulse">
            Streaming...
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full px-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-light mb-4">
              <MessageSquare className="h-6 w-6 text-brand-gold" />
            </div>
            <h3 className="text-sm font-semibold text-foreground mb-1">
              LadeStack Build
            </h3>
            <p className="text-xs text-muted-foreground max-w-sm">
              Ask me to build, refactor, or debug your code. I can read files,
              run commands, and generate full-stack features.
            </p>
            <div className="mt-4 flex flex-wrap gap-2 justify-center">
              {[
                "Build a new React component",
                "Find and fix a bug",
                "Add authentication",
                "Optimize performance",
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  className="text-[11px] px-3 py-1.5 rounded-full border border-border/50 bg-surface-light text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="py-2">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <ChatInput />
    </div>
  )
}
