"use client"

import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels"
import { FileExplorer } from "@/components/FileExplorer"
import { ChatPanel } from "@/components/ChatPanel"
import { EditorPanel } from "@/components/EditorPanel"
import { PreviewPanel } from "@/components/PreviewPanel"
import { SettingsTrigger } from "@/components/SettingsDialog"

function ResizeHandle() {
  return (
    <PanelResizeHandle className="w-[3px] bg-border/30 hover:bg-brand-gold/50 transition-colors cursor-col-resize data-[resize-handle-active]:bg-brand-gold" />
  )
}

function HorizontalResizeHandle() {
  return (
    <PanelResizeHandle className="h-[3px] bg-border/30 hover:bg-brand-gold/50 transition-colors cursor-row-resize data-[resize-handle-active]:bg-brand-gold" />
  )
}

interface WorkspaceShellProps {
  projectId?: string
}

import { useEffect } from "react"
import { useStore } from "@/lib/store"

export function WorkspaceShell({ projectId }: WorkspaceShellProps) {
  const setCurrentProjectId = useStore((s) => s.setCurrentProjectId)
  const mode = useStore((s) => s.mode)
  const setMode = useStore((s) => s.setMode)

  useEffect(() => {
    setCurrentProjectId(projectId ?? null)
  }, [projectId, setCurrentProjectId])

  return (
    <div className="h-screen w-screen flex flex-col bg-background text-foreground overflow-hidden">
      <header className="flex items-center gap-3 px-4 py-2 border-b border-border/50 bg-surface shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center h-6 w-6 rounded bg-brand-gold text-brand-navy text-[10px] font-bold">
            LS
          </div>
          <span className="text-sm font-semibold text-foreground">
            LadeStack Build
          </span>
        </div>

        <div className="flex items-center gap-0.5">
          {(["chat", "plan", "build"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors capitalize ${
                mode === m
                  ? "bg-brand-gold text-brand-navy"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {m === "chat" ? "Chat" : m === "plan" ? "Plan" : "Build"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 ml-2">
          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-surface-light text-[10px] text-muted-foreground">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-400" />
            Connected
          </div>
          <SettingsTrigger />
        </div>
      </header>

      <PanelGroup direction="horizontal" className="flex-1">
        <Panel defaultSize={20} minSize={12} maxSize={35}>
          <FileExplorer projectId={projectId} />
        </Panel>

        <ResizeHandle />

        <Panel defaultSize={55} minSize={30}>
          <PanelGroup direction="vertical">
            <Panel defaultSize={60} minSize={20}>
              <ChatPanel />
            </Panel>

            <HorizontalResizeHandle />

            <Panel defaultSize={40} minSize={15}>
              <EditorPanel />
            </Panel>
          </PanelGroup>
        </Panel>

        <ResizeHandle />

        <Panel defaultSize={25} minSize={15} maxSize={45}>
          <PreviewPanel />
        </Panel>
      </PanelGroup>
    </div>
  )
}
