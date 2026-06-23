"use client"

import { useState } from "react"
import { ChevronDown, ChevronRight, Clock, Loader2, CheckCircle, XCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import type { ToolCall } from "@/lib/types"

interface ToolCallCardProps {
  toolCall: ToolCall
}

const statusConfig = {
  pending: { icon: Clock, color: "text-muted-foreground" },
  running: { icon: Loader2, color: "text-brand-gold animate-spin" },
  success: { icon: CheckCircle, color: "text-green-400" },
  error: { icon: XCircle, color: "text-red-400" },
}

export function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false)
  const StatusIcon = statusConfig[toolCall.status].icon

  return (
    <Card
      className={cn(
        "my-2 border border-border/50 cursor-pointer select-none",
        toolCall.status === "error" && "border-red-500/30"
      )}
      onClick={() => setExpanded(!expanded)}
    >
      <CardContent className="p-3">
        <div className="flex items-center gap-2">
          <StatusIcon className={cn("h-4 w-4 shrink-0", statusConfig[toolCall.status].color)} />
          <Badge variant="gold" className="text-[10px] px-1.5 py-0">
            {toolCall.name}
          </Badge>
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 ml-auto text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 ml-auto text-muted-foreground shrink-0" />
          )}
          {toolCall.duration !== undefined && (
            <span className="text-[10px] text-muted-foreground ml-2 shrink-0">
              <Clock className="h-3 w-3 inline mr-0.5" />
              {toolCall.duration}ms
            </span>
          )}
        </div>

        {expanded && (
          <div className="mt-3 space-y-2 text-xs font-mono">
            <div>
              <span className="text-muted-foreground text-[10px] font-sans uppercase tracking-wider">
                Arguments
              </span>
              <pre className="mt-1 p-2 rounded bg-surface-light overflow-x-auto max-h-48 scrollbar-thin">
                {JSON.stringify(toolCall.args, null, 2)}
              </pre>
            </div>
            {toolCall.result !== undefined && (
              <div>
                <span className="text-muted-foreground text-[10px] font-sans uppercase tracking-wider">
                  Result
                </span>
                <pre className="mt-1 p-2 rounded bg-surface-light overflow-x-auto max-h-48 scrollbar-thin">
                  {typeof toolCall.result === "string"
                    ? toolCall.result
                    : JSON.stringify(toolCall.result, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
