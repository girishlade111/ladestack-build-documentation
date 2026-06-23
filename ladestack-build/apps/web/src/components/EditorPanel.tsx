"use client"

import { useMemo } from "react"
import dynamic from "next/dynamic"
import { File } from "lucide-react"
import { useStore } from "@/lib/store"

const MonacoEditor = dynamic(
  () => import("@monaco-editor/react").then((mod) => mod.default),
  { ssr: false, loading: () => <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Loading editor...</div> }
)

function detectLanguage(filename: string | null): string {
  if (!filename) return "plaintext"
  const ext = filename.split(".").pop()?.toLowerCase() ?? ""
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    json: "json",
    md: "markdown",
    css: "css",
    scss: "scss",
    html: "html",
    py: "python",
    rs: "rust",
    go: "go",
    rb: "ruby",
    php: "php",
    yml: "yaml",
    yaml: "yaml",
    toml: "toml",
    xml: "xml",
    sql: "sql",
    sh: "shell",
    bash: "shell",
    graphql: "graphql",
    svg: "xml",
  }
  return map[ext] || "plaintext"
}

export function EditorPanel() {
  const { editorCode, setEditorCode, activeFile } = useStore()

  const language = useMemo(() => detectLanguage(activeFile), [activeFile])

  return (
    <div className="flex flex-col h-full bg-surface">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/50 bg-surface-light">
        <File className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">
          {activeFile ?? "No file open"}
        </span>
        {language !== "plaintext" && (
          <span className="ml-auto text-[10px] uppercase text-muted-foreground bg-surface px-1.5 py-0.5 rounded">
            {language}
          </span>
        )}
      </div>

      <div className="flex-1">
        {activeFile ? (
          <MonacoEditor
            value={editorCode}
            onChange={(val) => setEditorCode(val ?? "")}
            language={language}
            theme="vs-dark"
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              lineNumbers: "on",
              scrollBeyondLastLine: false,
              wordWrap: "on",
              padding: { top: 12 },
              readOnly: false,
              renderLineHighlight: "none",
              cursorBlinking: "smooth",
              smoothScrolling: true,
              fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace",
              bracketPairColorization: { enabled: true },
              automaticLayout: true,
            }}
            loading={
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                Loading editor...
              </div>
            }
          />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            Select a file from the explorer to view its contents
          </div>
        )}
      </div>
    </div>
  )
}
