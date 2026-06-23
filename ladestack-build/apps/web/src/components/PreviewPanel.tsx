"use client"

import { useState } from "react"
import { RefreshCw, ExternalLink, Monitor } from "lucide-react"

export function PreviewPanel() {
  const [url] = useState("about:blank")
  const [key, setKey] = useState(0)

  const handleRefresh = () => {
    setKey((k) => k + 1)
  }

  return (
    <div className="flex flex-col h-full bg-surface">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/50 bg-surface-light">
        <Monitor className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Preview</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={handleRefresh}
            className="p-1 rounded hover:bg-surface-lighter text-muted-foreground hover:text-foreground transition-colors"
            title="Refresh preview"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {url !== "about:blank" && (
        <div className="flex items-center gap-1.5 px-3 py-1 border-b border-border/30 bg-surface">
          <span className="text-[10px] text-muted-foreground truncate flex-1">
            {url}
          </span>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      )}

      <div className="flex-1 bg-white">
        <iframe
          key={key}
          src={url}
          className="w-full h-full border-0"
          sandbox="allow-scripts allow-same-origin"
          title="Preview"
        />
      </div>
    </div>
  )
}
