"use client"

import { useState, useEffect } from "react"
import { File, Folder, FolderOpen, ChevronRight, ChevronDown, RefreshCw } from "lucide-react"
import { cn } from "@/lib/utils"
import { useStore } from "@/lib/store"
import { fetchFileTree, readFile } from "@/lib/api"
import type { FileNode } from "@/lib/types"

interface TreeNodeProps {
  node: FileNode
  depth: number
}

function TreeNode({ node, depth }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(depth < 1)
  const { activeFile, setActiveFile, setEditorCode, setActiveAgent, currentProjectId } = useStore()
  const isDirectory = node.type === "directory"
  const isActive = activeFile === node.path

  const handleClick = async () => {
    if (isDirectory) {
      setExpanded(!expanded)
    } else {
      setActiveFile(node.path)
      setActiveAgent(null)
      if (currentProjectId) {
        try {
          const { content } = await readFile(currentProjectId, node.path)
          setEditorCode(content)
        } catch {
          setEditorCode(node.content ?? "// Error reading file")
        }
      } else {
        setEditorCode(node.content ?? "")
      }
    }
  }

  return (
    <div>
      <button
        onClick={handleClick}
        className={cn(
          "flex w-full items-center gap-1.5 px-2 py-1 text-sm rounded-sm transition-colors",
          "hover:bg-surface-light text-muted-foreground hover:text-foreground",
          isActive && "bg-surface-light text-foreground border-l-2 border-brand-gold"
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {isDirectory ? (
          expanded ? (
            <FolderOpen className="h-4 w-4 shrink-0 text-brand-gold" />
          ) : (
            <Folder className="h-4 w-4 shrink-0 text-brand-gold/70" />
          )
        ) : (
          <File className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}

        {isDirectory && (
          <span className="text-muted-foreground shrink-0">
            {expanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </span>
        )}

        <span className="truncate text-xs">{node.name}</span>
      </button>

      {isDirectory && expanded && node.children && (
        <div>
          {node.children.map((child) => (
            <TreeNode key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

const defaultFileTree: FileNode[] = [
  {
    id: "root",
    name: "ladestack-project",
    path: "/",
    type: "directory",
    children: [
      {
        id: "src",
        name: "src",
        path: "/src",
        type: "directory",
        children: [
          {
            id: "app",
            name: "app",
            path: "/src/app",
            type: "directory",
            children: [
              {
                id: "layout",
                name: "layout.tsx",
                path: "/src/app/layout.tsx",
                type: "file",
                content: "export default function RootLayout({ children }) {\n  return (\n    <html>\n      <body>{children}</body>\n    </html>\n  )\n}",
                language: "typescript",
              },
              {
                id: "page",
                name: "page.tsx",
                path: "/src/app/page.tsx",
                type: "file",
                content: "export default function Home() {\n  return <div>Hello World</div>\n}",
                language: "typescript",
              },
            ],
          },
          {
            id: "components",
            name: "components",
            path: "/src/components",
            type: "directory",
            children: [],
          },
          {
            id: "lib",
            name: "lib",
            path: "/src/lib",
            type: "directory",
            children: [
              {
                id: "store",
                name: "store.ts",
                path: "/src/lib/store.ts",
                type: "file",
                content: "// zustand store",
                language: "typescript",
              },
              {
                id: "types",
                name: "types.ts",
                path: "/src/lib/types.ts",
                type: "file",
                content: "// type definitions",
                language: "typescript",
              },
            ],
          },
        ],
      },
      {
        id: "package.json",
        name: "package.json",
        path: "/package.json",
        type: "file",
        content: '{\n  "name": "ladestack-project"\n}',
        language: "json",
      },
      {
        id: "tsconfig.json",
        name: "tsconfig.json",
        path: "/tsconfig.json",
        type: "file",
        content: '{\n  "compilerOptions": {}\n}',
        language: "json",
      },
    ],
  },
]

interface FileExplorerProps {
  projectId?: string
}

export function FileExplorer({ projectId }: FileExplorerProps) {
  const { projects, fileTree, setFileTree } = useStore()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const tree = fileTree.length > 0 ? fileTree : defaultFileTree
  const pid = projectId || projects[0]?.id

  useEffect(() => {
    if (!pid) return
    setLoading(true)
    setError(null)
    fetchFileTree(pid)
      .then(setFileTree)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [pid])

  const handleRefresh = () => {
    if (!pid) return
    setLoading(true)
    fetchFileTree(pid)
      .then(setFileTree)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }

  return (
    <div className="flex flex-col h-full bg-surface">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border/50">
        <Folder className="h-4 w-4 text-brand-gold" />
        <span className="text-xs font-semibold text-foreground">Explorer</span>
        <button
          onClick={handleRefresh}
          disabled={loading}
          className="ml-auto p-1 rounded hover:bg-surface-lighter text-muted-foreground hover:text-foreground transition-colors"
          title="Refresh"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin py-1">
        {error && (
          <div className="px-3 py-2 text-[11px] text-red-400">{error}</div>
        )}
        {tree.map((node) => (
          <TreeNode key={node.id} node={node} depth={0} />
        ))}
      </div>
    </div>
  )
}
