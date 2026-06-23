"use client"

import { useState } from "react"
import { User, Bot, Copy, Check, Loader2 } from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { cn } from "@/lib/utils"
import { ToolCallCard } from "@/components/ToolCallCard"
import type { Message } from "@/lib/types"

interface MessageBubbleProps {
  message: Message
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const [copied, setCopied] = useState(false)
  const isUser = message.role === "user"
  const isStreaming = message.status === "streaming"

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div
      className={cn(
        "flex gap-3 px-4 py-3 group",
        isUser ? "flex-row-reverse" : "flex-row"
      )}
    >
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
          isUser ? "bg-brand-gold/20" : "bg-primary/20"
        )}
      >
        {isUser ? (
          <User className="h-4 w-4 text-brand-gold" />
        ) : (
          <Bot className="h-4 w-4 text-primary" />
        )}
      </div>

      <div className={cn("flex flex-col gap-1 max-w-[80%]", isUser && "items-end")}>
        <div
          className={cn(
            "rounded-lg px-4 py-2.5 text-sm leading-relaxed",
            isUser
              ? "bg-brand-gold/10 text-foreground border border-brand-gold/20"
              : "bg-surface-light border border-border/50"
          )}
        >
          {isStreaming && !message.content ? (
            <div className="flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              <span className="text-muted-foreground text-xs">Thinking...</span>
            </div>
          ) : (
            <div className="prose prose-invert prose-sm max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {message.content || (isStreaming ? "..." : "")}
              </ReactMarkdown>
            </div>
          )}

          {isStreaming && message.content && (
            <span className="inline-block w-2 h-4 bg-primary ml-0.5 animate-cursor-blink" />
          )}
        </div>

        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="w-full max-w-md">
            {message.toolCalls.map((tc) => (
              <ToolCallCard key={tc.id} toolCall={tc} />
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 px-1">
          <span className="text-[10px] text-muted-foreground">
            {new Date(message.timestamp).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>

          {!isUser && message.content && (
            <button
              onClick={handleCopy}
              className="opacity-0 group-hover:opacity-100 transition-opacity"
            >
              {copied ? (
                <Check className="h-3 w-3 text-green-400" />
              ) : (
                <Copy className="h-3 w-3 text-muted-foreground hover:text-foreground" />
              )}
            </button>
          )}

          {message.status === "error" && (
            <span className="text-[10px] text-red-400">Error</span>
          )}
        </div>
      </div>
    </div>
  )
}
