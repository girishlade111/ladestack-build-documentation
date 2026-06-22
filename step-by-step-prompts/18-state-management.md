# Prompt 18: State Management (Zustand)

## Goal

Replace the ad-hoc state in `IDEPage` with proper Zustand stores for sessions, projects, UI state, and skills. This sets the foundation for prompts 19+ (file tree, Monaco, preview).

## Context (from prompts 01-17)

- State is scattered across components (mode, agent in IDEPage; messages in ChatPanel).
- Need centralized state for the upcoming file tree + preview surfaces.

Reference: `../system-design.md` §2.1 (Zustand stores).

## Task

### Step 1: Install Zustand (already done in prompt 15)

```bash
cd apps/web
# Already installed: pnpm add zustand
```

### Step 2: Create the session store

`apps/web/src/stores/session.ts`:

```ts
import { create } from "zustand"
import type { ChatMessage } from "@/components/chat/Message"

interface SessionState {
  sessionId: string | null
  title: string | null
  agent: "build" | "plan" | "ask"
  mode: "build" | "plan"
  model: string
  streaming: boolean
  messages: ChatMessage[]
  currentRunId: string | null

  setSession: (session: { id: string; title: string | null; agent: string }) => void
  setMode: (mode: "build" | "plan") => void
  setAgent: (agent: "build" | "plan" | "ask") => void
  setModel: (model: string) => void
  setStreaming: (streaming: boolean) => void
  setMessages: (messages: ChatMessage[]) => void
  appendMessage: (message: ChatMessage) => void
  updateMessage: (id: string, update: Partial<ChatMessage>) => void
  reset: () => void
}

export const useSessionStore = create<SessionState>((set) => ({
  sessionId: null,
  title: null,
  agent: "build",
  mode: "plan",
  model: "anthropic/claude-sonnet-4-20250514",
  streaming: false,
  messages: [],
  currentRunId: null,

  setSession: (session) => set({
    sessionId: session.id,
    title: session.title,
    agent: session.agent as any
  }),
  setMode: (mode) => set({ mode }),
  setAgent: (agent) => set({ agent }),
  setModel: (model) => set({ model }),
  setStreaming: (streaming) => set({ streaming }),
  setMessages: (messages) => set({ messages }),
  appendMessage: (message) => set((s) => ({ messages: [...s.messages, message] })),
  updateMessage: (id, update) => set((s) => ({
    messages: s.messages.map((m) => m.id === id ? { ...m, ...update } : m)
  })),
  reset: () => set({
    sessionId: null, title: null, messages: [], streaming: false, currentRunId: null
  })
}))
```

### Step 3: Create the project store

`apps/web/src/stores/project.ts`:

```ts
import { create } from "zustand"

interface FileNode {
  path: string
  content?: string
  dirty?: boolean
}

interface ProjectState {
  projectId: string | null
  files: FileNode[]
  openTabs: string[]
  activeTab: string | null
  gitStatus: { branch: string; ahead: number; behind: number; dirty: boolean }

  setProject: (projectId: string) => void
  setFiles: (files: FileNode[]) => void
  updateFile: (path: string, content: string) => void
  setOpenTabs: (tabs: string[]) => void
  addTab: (path: string) => void
  closeTab: (path: string) => void
  setActiveTab: (path: string | null) => void
  setGitStatus: (status: ProjectState["gitStatus"]) => void
  reset: () => void
}

export const useProjectStore = create<ProjectState>((set) => ({
  projectId: null,
  files: [],
  openTabs: [],
  activeTab: null,
  gitStatus: { branch: "main", ahead: 0, behind: 0, dirty: false },

  setProject: (projectId) => set({ projectId }),
  setFiles: (files) => set({ files }),
  updateFile: (path, content) => set((s) => ({
    files: s.files.map((f) => f.path === path ? { ...f, content, dirty: true } : f)
  })),
  setOpenTabs: (tabs) => set({ openTabs: tabs }),
  addTab: (path) => set((s) => ({
    openTabs: s.openTabs.includes(path) ? s.openTabs : [...s.openTabs, path],
    activeTab: path
  })),
  closeTab: (path) => set((s) => {
    const newTabs = s.openTabs.filter((t) => t !== path)
    return {
      openTabs: newTabs,
      activeTab: s.activeTab === path ? (newTabs[newTabs.length - 1] ?? null) : s.activeTab
    }
  }),
  setActiveTab: (activeTab) => set({ activeTab }),
  setGitStatus: (gitStatus) => set({ gitStatus }),
  reset: () => set({ projectId: null, files: [], openTabs: [], activeTab: null })
}))
```

### Step 4: Create the UI store

`apps/web/src/stores/ui.ts`:

```ts
import { create } from "zustand"

interface UIState {
  layout: { sidebar: number; center: number; preview: number }  // percentages
  rightPane: "preview" | "terminal" | "logs"
  theme: "dark" | "light"
  modals: {
    settings: boolean
    skills: boolean
    agents: boolean
    help: boolean
  }
  breakpoints: { mobile: boolean; tablet: boolean; desktop: boolean }

  setLayout: (layout: Partial<UIState["layout"]>) => void
  setRightPane: (pane: UIState["rightPane"]) => void
  setTheme: (theme: "dark" | "light") => void
  openModal: (name: keyof UIState["modals"]) => void
  closeModal: (name: keyof UIState["modals"]) => void
  setBreakpoint: (bp: Partial<UIState["breakpoints"]>) => void
}

const DEFAULT_LAYOUT = { sidebar: 15, center: 55, preview: 30 }

export const useUIStore = create<UIState>((set) => ({
  layout: DEFAULT_LAYOUT,
  rightPane: "preview",
  theme: "dark",
  modals: { settings: false, skills: false, agents: false, help: false },
  breakpoints: { mobile: false, tablet: false, desktop: true },

  setLayout: (partial) => set((s) => ({ layout: { ...s.layout, ...partial } })),
  setRightPane: (rightPane) => set({ rightPane }),
  setTheme: (theme) => set({ theme }),
  openModal: (name) => set((s) => ({ modals: { ...s.modals, [name]: true } })),
  closeModal: (name) => set((s) => ({ modals: { ...s.modals, [name]: false } })),
  setBreakpoint: (bp) => set((s) => ({ breakpoints: { ...s.breakpoints, ...bp } }))
}))

export { DEFAULT_LAYOUT }
```

### Step 5: Create the skills store

`apps/web/src/stores/skills.ts`:

```ts
import { create } from "zustand"

interface Skill {
  name: string
  description: string
  source: "bundled" | "user" | "project"
  enabled: boolean
}

interface SkillsState {
  available: Skill[]
  loading: boolean
  setAvailable: (skills: Skill[]) => void
  toggleSkill: (name: string) => void
  setLoading: (loading: boolean) => void
}

export const useSkillsStore = create<SkillsState>((set) => ({
  available: [],
  loading: false,
  setAvailable: (available) => set({ available }),
  toggleSkill: (name) => set((s) => ({
    available: s.available.map((sk) => sk.name === name ? { ...sk, enabled: !sk.enabled } : sk)
  })),
  setLoading: (loading) => set({ loading })
}))
```

### Step 6: Refactor IDE page to use stores

`apps/web/src/app/c/[projectId]/page.tsx`:

```tsx
"use client"
import { useEffect, useRef } from "react"
import { useParams } from "next/navigation"
import { ChatPanel } from "@/components/chat/ChatPanel"
import { FileTree } from "@/components/files/FileTree"  // prompt 19
import { Editor } from "@/components/editor/Editor"    // prompt 19
import { PreviewPane } from "@/components/preview/PreviewPane"  // prompt 20
import { TopBar } from "@/components/layout/TopBar"
import { api } from "@/lib/api"
import { useSessionStore } from "@/stores/session"
import { useProjectStore } from "@/stores/project"
import { useUIStore } from "@/stores/ui"

export default function IDEPage() {
  const params = useParams<{ projectId: string }>()
  const { sessionId, messages, mode, agent, model, streaming, setSession, setMessages, setMode } = useSessionStore()
  const { projectId, files, openTabs, activeTab, setProject, setFiles, addTab } = useProjectStore()
  const { layout } = useUIStore()
  const initRef = useRef(false)

  useEffect(() => {
    if (initRef.current) return
    initRef.current = true

    const init = async () => {
      try {
        setProject(params.projectId)

        // Create session
        const session = await api<{ id: string; title: string | null; agent: string }>(`/api/sessions`, {
          method: "POST",
          body: JSON.stringify({ projectId: params.projectId, title: "New chat" })
        })
        setSession(session)

        // Load messages
        const { messages: msgs } = await api<{ messages: any[] }>(`/api/sessions/${session.id}/messages`)
        setMessages(msgs)

        // Load file tree (via sandbox)
        const { files: fileList } = await api<{ files: string[] }>(`/api/sandbox/${params.projectId}/files`)
        setFiles(fileList.map((p) => ({ path: p })))
      } catch (err) {
        console.error("init failed", err)
      }
    }
    init()
  }, [params.projectId])

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div style={{ width: `${layout.sidebar}%` }} className="border-r border-border-subtle bg-surface overflow-y-auto">
          <FileTree />
        </div>

        {/* Center: tabs + editor */}
        <div style={{ width: `${layout.center}%` }} className="flex flex-col">
          <div className="flex border-b border-border-subtle">
            {openTabs.map((tab) => (
              <button
                key={tab}
                onClick={() => useProjectStore.getState().setActiveTab(tab)}
                className={`px-3 py-2 text-sm ${activeTab === tab ? "bg-elevated text-text-primary" : "text-text-secondary"}`}
              >
                {tab}
              </button>
            ))}
          </div>
          <div className="flex-1">
            <Editor />
          </div>
        </div>

        {/* Right: preview */}
        <div style={{ width: `${layout.preview}%` }} className="border-l border-border-subtle bg-surface">
          <PreviewPane />
        </div>
      </div>

      {/* Bottom: chat */}
      <div className="border-t border-border-subtle" style={{ height: "300px" }}>
        <ChatPanel
          sessionId={sessionId!}
          initialMessages={messages}
          mode={mode}
          agent={agent}
          onModeChange={(m) => { setMode(m); api(`/api/sessions/${sessionId}/${m}`, { method: "POST" }) }}
        />
      </div>
    </div>
  )
}
```

### Step 7: Build the TopBar stub

`apps/web/src/components/layout/TopBar.tsx`:

```tsx
"use client"
import { Rocket, Github, CreditCard, Settings, ChevronDown } from "lucide-react"
import { useSessionStore } from "@/stores/session"
import { useProjectStore } from "@/stores/project"
import { useUIStore } from "@/stores/ui"

export function TopBar() {
  const { sessionId, title } = useSessionStore()
  const { projectId, gitStatus } = useProjectStore()
  const { openModal } = useUIStore()

  return (
    <div className="flex h-12 items-center justify-between border-b border-border-subtle bg-surface px-4">
      <div className="flex items-center gap-3">
        <span className="font-mono text-sm text-gold">LadeStack Build</span>
        <span className="text-text-tertiary">/</span>
        <span className="text-sm text-text-primary">{projectId?.slice(0, 8)}</span>
        <span className="text-xs text-text-tertiary">
          ⎇ {gitStatus.branch} {gitStatus.dirty && "•"}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => openModal("settings")}
          className="rounded p-1.5 text-text-tertiary hover:bg-elevated hover:text-text-primary"
        >
          <Settings className="h-4 w-4" />
        </button>
        <button className="rounded p-1.5 text-text-tertiary hover:bg-elevated hover:text-text-primary">
          <Github className="h-4 w-4" />
        </button>
        <button className="rounded p-1.5 text-text-tertiary hover:bg-elevated hover:text-text-primary">
          <CreditCard className="h-4 w-4" />
        </button>
        <button className="flex items-center gap-1 rounded bg-gold px-3 py-1 text-sm text-canvas hover:bg-gold-hi">
          <Rocket className="h-3 w-3" />
          Deploy
        </button>
        <div className="h-8 w-8 rounded-full bg-elevated" />
      </div>
    </div>
  )
}
```

### Step 8: Commit

```bash
git add -A
git commit -m "feat(web): Zustand stores for session, project, UI, skills (prompt 18)"
```

## Files created

```
apps/web/src/stores/
├── session.ts
├── project.ts
├── ui.ts
└── skills.ts

apps/web/src/components/layout/
└── TopBar.tsx

apps/web/src/app/c/[projectId]/page.tsx (rewrite with stores)
```

## Acceptance criteria

- [ ] Session state (mode, agent, model, messages) is in `useSessionStore`
- [ ] Project state (files, tabs, git) is in `useProjectStore`
- [ ] UI state (layout, modals, theme) is in `useUIStore`
- [ ] Skills state is in `useSkillsStore`
- [ ] IDE page reads from stores, not local state
- [ ] TopBar shows project + branch + actions
- [ ] Stores are typed correctly
- [ ] Zustand devtools work (optional)

## Verification

```bash
pnpm --filter @ladestack/web typecheck
pnpm --filter @ladestack/web dev &
# Visual: TopBar + 3-pane layout (sidebar, editor, preview) — but components are stubs until prompts 19-20
kill %1
```

## Notes

- **Zustand stores are global singletons.** Components subscribe to slices via selectors to avoid re-renders.
- **`useUIStore.DEFAULT_LAYOUT`** is exported so other components can reset to default.
- **Stores are not persisted yet.** v1.1 adds `zustand/middleware/persist` for UI preferences.
- **`useSessionStore.setSession` casts `agent` to any** because the API returns it as `string` but the store expects a narrower type. Fix in v1.1 by tightening the API response.
- **TopBar uses lucide-react** for icons. Already installed in prompt 02.
- **`addTab` opens a new tab** but doesn't load the file content. Prompt 19 (FileTree) triggers addTab when user clicks a file.
- **`FileTree`, `Editor`, `PreviewPane` are referenced but not implemented yet.** They're stubs that prompt 19-20 will fill in. For now, they can render "Coming soon" placeholders.
- **Chat is at the bottom (300px height).** v1.1 makes this resizable.
