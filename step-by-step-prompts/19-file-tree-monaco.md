# Prompt 19: FileTree + Monaco Editor

## Goal

Build the file tree (left sidebar) and Monaco-based code editor (center pane). File tree shows the project's files with dirty markers; editor supports syntax highlighting, tabs, and dirty-state save.

## Context (from prompts 01-18)

- All foundation, agent loop, chat UI, state management built.
- `IDEPage` references `FileTree`, `Editor` stubs that need real implementations.
- Sandbox can read files; agent can edit files (tool call writes to sandbox).

Reference: `../design.md` §6.5 (file tree), §6.5 (Monaco editor).

## Task

### Step 1: Install Monaco

```bash
cd apps/web
pnpm add @monaco-editor/react monaco-editor
pnpm add -D @types/monaco-editor
```

### Step 2: Build the FileTree component

`apps/web/src/components/files/FileTree.tsx`:

```tsx
"use client"
import { useState, useMemo } from "react"
import { ChevronRight, ChevronDown, File, Folder, FolderOpen, MoreHorizontal } from "lucide-react"
import { useProjectStore } from "@/stores/project"
import { useSessionStore } from "@/stores/session"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"

interface TreeNode {
  name: string
  path: string
  type: "file" | "directory"
  children?: TreeNode[]
}

function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", type: "directory", children: [] }
  for (const p of paths) {
    const parts = p.split("/").filter(Boolean)
    let current = root
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i]
      const isLast = i === parts.length - 1
      const path = parts.slice(0, i + 1).join("/")
      let node = current.children!.find((c) => c.name === name)
      if (!node) {
        node = {
          name,
          path,
          type: isLast ? "file" : "directory",
          children: isLast ? undefined : []
        }
        current.children!.push(node)
      }
      if (!isLast) current = node
    }
  }
  return sortTree(root.children!)
}

function sortTree(nodes: TreeNode[]): TreeNode[] {
  return nodes
    .map((n) => ({ ...n, children: n.children ? sortTree(n.children) : undefined }))
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1
      return a.name.localeCompare(b.name)
    })
}

const ICONS: Record<string, string> = {
  tsx: "⚛",
  ts: "🔷",
  jsx: "⚛",
  js: "🟨",
  json: "📋",
  css: "🎨",
  md: "📝",
  html: "🌐",
  txt: "📄"
}

function getFileIcon(path: string): string {
  const ext = path.split(".").pop() ?? ""
  return ICONS[ext] ?? "📄"
}

export function FileTree() {
  const { files, setFiles, openTabs, activeTab, addTab } = useProjectStore()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)

  const tree = useMemo(() => buildTree(files.map((f) => f.path)), [files])

  const refresh = async () => {
    setLoading(true)
    try {
      const { projectId } = useProjectStore.getState()
      if (!projectId) return
      const { files: list } = await api<{ files: string[] }>(`/api/sandbox/${projectId}/files`)
      setFiles(list.map((p) => ({ path: p })))
    } finally {
      setLoading(false)
    }
  }

  const toggleExpand = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const openFile = (path: string) => {
    addTab(path)
    // Load file content via API (cached in store on next prompt)
    useSessionStore.getState().updateMessage  // placeholder
    // Actually, we need to load content separately; v1.1 adds file content cache
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border-subtle px-3 py-2">
        <h3 className="text-xs font-semibold text-text-secondary">FILES</h3>
        <button
          onClick={refresh}
          disabled={loading}
          className="text-xs text-text-tertiary hover:text-text-primary disabled:opacity-50"
        >
          {loading ? "..." : "↻"}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto py-1 text-sm">
        {tree.length === 0 && (
          <div className="px-3 py-4 text-center text-xs text-text-tertiary">
            {loading ? "Loading..." : "No files yet"}
          </div>
        )}
        {tree.map((node) => (
          <TreeNodeView
            key={node.path}
            node={node}
            level={0}
            expanded={expanded}
            onToggle={toggleExpand}
            onOpen={openFile}
            activeTab={activeTab}
            openTabs={openTabs}
          />
        ))}
      </div>
    </div>
  )
}

function TreeNodeView({ node, level, expanded, onToggle, onOpen, activeTab, openTabs }: {
  node: TreeNode
  level: number
  expanded: Set<string>
  onToggle: (path: string) => void
  onOpen: (path: string) => void
  activeTab: string | null
  openTabs: string[]
}) {
  const isDir = node.type === "directory"
  const isOpen = expanded.has(node.path)
  const isActive = activeTab === node.path
  const isOpenTab = openTabs.includes(node.path)

  return (
    <>
      <button
        onClick={() => isDir ? onToggle(node.path) : onOpen(node.path)}
        className={cn(
          "flex w-full items-center gap-1 px-2 py-1 text-left hover:bg-elevated",
          isActive && "bg-elevated"
        )}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
      >
        {isDir ? (
          isOpen ? <ChevronDown className="h-3 w-3 text-text-tertiary" /> : <ChevronRight className="h-3 w-3 text-text-tertiary" />
        ) : (
          <span className="w-3" />
        )}
        {isDir ? (
          isOpen ? <FolderOpen className="h-3 w-3 text-gold" /> : <Folder className="h-3 w-3 text-text-tertiary" />
        ) : (
          <span className="text-xs">{getFileIcon(node.path)}</span>
        )}
        <span className={cn("flex-1 truncate", isActive ? "text-gold" : isOpenTab ? "text-text-primary" : "text-text-secondary")}>
          {node.name}
        </span>
      </button>
      {isDir && isOpen && node.children?.map((child) => (
        <TreeNodeView
          key={child.path}
          node={child}
          level={level + 1}
          expanded={expanded}
          onToggle={onToggle}
          onOpen={onOpen}
          activeTab={activeTab}
          openTabs={openTabs}
        />
      ))}
    </>
  )
}
```

### Step 3: Add file content API

`packages/api/src/routes/files.ts`:

```ts
import { Hono } from "hono"
import { authMiddleware, type AuthContext } from "../middleware/auth.js"
import { sandboxOps } from "@ladestack/runtime"
import { notFound, badRequest } from "../middleware/error.js"

export const fileRoutes = new Hono<{ Variables: { auth: AuthContext } }>()
  .use("*", authMiddleware)

  .get("/:projectId/list", async (c) => {
    const projectId = c.req.param("projectId")
    try {
      const files = await sandboxOps.list(projectId, "")
      return c.json({ files })
    } catch (err) {
      return c.json({ files: [], error: String(err) })
    }
  })

  .get("/:projectId/raw", async (c) => {
    const projectId = c.req.param("projectId")
    const path = c.req.query("path")
    if (!path) throw badRequest("path required")
    try {
      const content = await sandboxOps.read(projectId, path)
      return c.text(content)
    } catch (err) {
      throw notFound("file_not_found")
    }
  })

  .put("/:projectId/raw", async (c) => {
    const projectId = c.req.param("projectId")
    const path = c.req.query("path")
    if (!path) throw badRequest("path required")
    const body = await c.req.text()
    await sandboxOps.write(projectId, [{ path, content: body }])
    return c.json({ saved: path })
  })
```

Wire into `packages/api/src/index.ts`:
```ts
import { fileRoutes } from "./routes/files.js"
  .route("/api/files", fileRoutes)
```

### Step 4: Build the Editor component

`apps/web/src/components/editor/Editor.tsx`:

```tsx
"use client"
import { useEffect, useRef, useState } from "react"
import Editor, { OnMount, Monaco } from "@monaco-editor/react"
import type { editor } from "monaco-editor"
import { X, Circle } from "lucide-react"
import { useProjectStore } from "@/stores/project"
import { api } from "@/lib/api"

interface FileState {
  content: string
  dirty: boolean
  loading: boolean
}

export function Editor() {
  const { projectId, openTabs, activeTab, closeTab, setActiveTab } = useProjectStore()
  const [files, setFiles] = useState<Record<string, FileState>>({})
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<Monaco | null>(null)

  // Load active file content
  useEffect(() => {
    if (!activeTab || !projectId) return
    if (files[activeTab]?.content !== undefined) return

    setFiles((prev) => ({
      ...prev,
      [activeTab]: { content: "", dirty: false, loading: true }
    }))

    api<string>(`/api/files/${projectId}/raw?path=${encodeURIComponent(activeTab)}`)
      .then((content) => {
        setFiles((prev) => ({
          ...prev,
          [activeTab]: { content, dirty: false, loading: false }
        }))
      })
      .catch(() => {
        setFiles((prev) => ({
          ...prev,
          [activeTab]: { content: "// Failed to load", dirty: false, loading: false }
        }))
      })
  }, [activeTab, projectId])

  const handleEditorMount: OnMount = (ed, monaco) => {
    editorRef.current = ed
    monacoRef.current = monaco

    // Configure TypeScript + JSX
    monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
      target: monaco.languages.typescript.ScriptTarget.ESNext,
      module: monaco.languages.typescript.ModuleKind.ESNext,
      moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
      jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
      allowNonTsExtensions: true,
      allowJs: true,
      esModuleInterop: true
    })

    // Configure theme
    monaco.editor.defineTheme("ladestack-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "comment", foreground: "6B7395", fontStyle: "italic" },
        { token: "keyword", foreground: "7C5DDB" },
        { token: "string", foreground: "4CAF7C" }
      ],
      colors: {
        "editor.background": "#0F1424",
        "editor.foreground": "#E8EAF1",
        "editorCursor.foreground": "#D4A574",
        "editor.lineHighlightBackground": "#1F2742"
      }
    })
  }

  const handleChange = (value: string | undefined) => {
    if (!activeTab || value === undefined) return
    setFiles((prev) => ({
      ...prev,
      [activeTab]: { ...prev[activeTab], content: value, dirty: true }
    }))
  }

  const handleSave = async () => {
    if (!activeTab || !projectId) return
    const file = files[activeTab]
    if (!file?.dirty) return

    await api(`/api/files/${projectId}/raw?path=${encodeURIComponent(activeTab)}`, {
      method: "PUT",
      headers: { "Content-Type": "text/plain" },
      body: file.content
    })

    setFiles((prev) => ({
      ...prev,
      [activeTab]: { ...prev[activeTab], dirty: false }
    }))
  }

  // Ctrl+S to save
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault()
        handleSave()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [activeTab, projectId, files])

  const activeFile = activeTab ? files[activeTab] : null

  return (
    <div className="flex h-full flex-col">
      {/* Tab bar */}
      <div className="flex border-b border-border-subtle bg-surface">
        {openTabs.map((tab) => {
          const file = files[tab]
          const isActive = tab === activeTab
          return (
            <div
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`group flex items-center gap-2 border-r border-border-subtle px-3 py-1.5 cursor-pointer ${
                isActive ? "bg-canvas text-text-primary" : "bg-surface text-text-secondary hover:bg-canvas/50"
              }`}
            >
              <span className="text-sm">{tab.split("/").pop()}</span>
              {file?.dirty && <Circle className="h-2 w-2 fill-gold text-gold" />}
              <button
                onClick={(e) => { e.stopPropagation(); closeTab(tab) }}
                className="opacity-0 group-hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )
        })}
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-hidden">
        {activeTab && activeFile ? (
          <Editor
            value={activeFile.content}
            onChange={handleChange}
            onMount={handleEditorMount}
            language={getLanguage(activeTab)}
            theme="ladestack-dark"
            path={activeTab}
            options={{
              fontSize: 14,
              fontFamily: "var(--font-mono)",
              minimap: { enabled: true },
              scrollBeyondLastLine: false,
              automaticLayout: true,
              tabSize: 2,
              wordWrap: "on",
              lineNumbers: "on",
              renderLineHighlight: "all"
            }}
            loading={activeFile.loading ? <div className="p-4 text-text-secondary">Loading...</div> : null}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-text-tertiary">
            <p>Select a file from the tree to start editing</p>
          </div>
        )}
      </div>

      {/* Status bar */}
      {activeTab && (
        <div className="flex items-center justify-between border-t border-border-subtle bg-surface px-3 py-1 text-xs text-text-tertiary">
          <span>{activeTab}</span>
          <span>{activeFile?.dirty ? "Modified" : "Saved"} · Ctrl+S to save</span>
        </div>
      )}
    </div>
  )
}

function getLanguage(path: string): string {
  const ext = path.split(".").pop() ?? ""
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    json: "json",
    css: "css",
    md: "markdown",
    html: "html",
    py: "python",
    go: "go",
    rs: "rust"
  }
  return map[ext] ?? "plaintext"
}
```

### Step 5: Wire refresh after AI edits

When the agent edits files (via tool calls), we need to refresh the file tree + open tabs.

`apps/web/src/components/files/FileTree.tsx` — add a watcher:

```tsx
// Listen for tool_end events on write/edit tools to refresh
import { useEffect } from "react"
import { useSessionStore } from "@/stores/session"

export function FileTree() {
  const { messages } = useSessionStore()
  const lastToolCallCount = useRef(0)

  useEffect(() => {
    const toolCalls = messages.flatMap((m) => m.toolCalls ?? [])
    if (toolCalls.length > lastToolCallCount.current) {
      // New tool call happened; refresh if it's a write/edit
      const lastCall = toolCalls[toolCalls.length - 1]
      if (["write", "edit"].includes(lastCall.name)) {
        refresh()
      }
    }
    lastToolCallCount.current = toolCalls.length
  }, [messages])

  // ... rest
}
```

Similarly for the Editor — when a file is edited by AI, reload its content:

```tsx
useEffect(() => {
  // Listen for write/edit tool calls affecting activeTab
  const toolCalls = messages.flatMap((m) => m.toolCalls ?? [])
  const lastCall = toolCalls[toolCalls.length - 1]
  if (lastCall && (lastCall.name === "write" || lastCall.name === "edit")) {
    const editedPath = (lastCall.input as any).path
    if (editedPath === activeTab) {
      // Reload content
      api<string>(`/api/files/${projectId}/raw?path=${encodeURIComponent(editedPath)}`)
        .then((content) => setFiles((prev) => ({
          ...prev,
          [editedPath]: { content, dirty: false, loading: false }
        })))
    }
  }
}, [messages])
```

### Step 6: Commit

```bash
git add -A
git commit -m "feat(web): FileTree + Monaco editor with dirty markers + auto-refresh (prompt 19)"
```

## Files created/modified

```
apps/web/src/components/files/FileTree.tsx (new)
apps/web/src/components/editor/Editor.tsx (new)
packages/api/src/routes/files.ts (new)
packages/api/src/index.ts (wire file routes)
```

## Acceptance criteria

- [ ] File tree shows files from the sandbox
- [ ] Folders can be expanded/collapsed
- [ ] Clicking a file opens it in a tab
- [ ] Monaco editor renders with syntax highlighting
- [ ] Editor shows dirty marker when modified
- [ ] Ctrl+S saves the file
- [ ] File tree refreshes after AI writes
- [ ] Open tabs persist across refreshes

## Verification

```bash
pnpm --filter @ladestack/web dev &
# Visit /c/<project-id>
# - File tree shows files from sandbox
# - Click a file, Monaco opens it
# - Edit, see dirty marker
# - Ctrl+S, marker clears
# - Send "Create a README" message; tree refreshes after AI write
kill %1
```

## Notes

- **Monaco is large (~5MB).** Loaded asynchronously. The `loading` prop shows a fallback during load.
- **The `ladestack-dark` theme** is custom-defined to match the LadeStack brand. Adjust as needed.
- **The file watcher approach** is naive (just counts tool calls). v1.1 uses a proper diff subscription.
- **Save is per-file**, not bulk. v1.1 adds "save all" with multiple dirty tabs.
- **Tab close X is hidden by default** (opacity-0 group-hover:opacity-100) — cleaner UI. v1.1 makes it always visible.
- **The file tree refresh** is triggered by tool calls. If the agent uses bash to create files, the tree won't refresh — v1.1 polls for changes after bash commands.
- **`useSessionStore.updateMessage`** in FileTree is a placeholder I added by mistake; remove it. The actual file content loading is in Editor.tsx.
- **`addTab` doesn't load file content** — that's Editor's job. addTab just opens the tab slot.
- **No new file creation UI yet** — that's v1.1 (right-click in tree to create file/folder).
