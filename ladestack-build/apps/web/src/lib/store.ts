import { create } from "zustand"
import type { Message, FileNode, Project, Provider } from "./types"

interface AppState {
  messages: Message[]
  addMessage: (message: Message) => void
  updateMessage: (id: string, updates: Partial<Message>) => void
  clearMessages: () => void

  activeAgent: string | null
  setActiveAgent: (agentId: string | null) => void

  editorCode: string
  setEditorCode: (code: string) => void

  activeFile: string | null
  setActiveFile: (file: string | null) => void

  fileTree: FileNode[]
  setFileTree: (tree: FileNode[]) => void

  isStreaming: boolean
  setIsStreaming: (streaming: boolean) => void

  projects: Project[]
  setProjects: (projects: Project[]) => void
  addProject: (project: Project) => void
  removeProject: (id: string) => void

  previewUrl: string
  setPreviewUrl: (url: string) => void

  provider: Provider
  setProvider: (provider: Provider) => void

  model: string
  setModel: (model: string) => void

  apiKey: string
  setApiKey: (key: string) => void

  currentProjectId: string | null
  setCurrentProjectId: (id: string | null) => void
}

export const useStore = create<AppState>((set) => ({
  messages: [],
  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),
  updateMessage: (id, updates) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === id ? { ...m, ...updates } : m
      ),
    })),
  clearMessages: () => set({ messages: [] }),

  activeAgent: null,
  setActiveAgent: (agentId) => set({ activeAgent: agentId }),

  editorCode: "",
  setEditorCode: (code) => set({ editorCode: code }),

  activeFile: null,
  setActiveFile: (file) => set({ activeFile: file }),

  fileTree: [],
  setFileTree: (tree) => set({ fileTree: tree }),

  isStreaming: false,
  setIsStreaming: (streaming) => set({ isStreaming: streaming }),

  projects: [],
  setProjects: (projects) => set({ projects }),
  addProject: (project) =>
    set((state) => ({ projects: [...state.projects, project] })),
  removeProject: (id) =>
    set((state) => ({
      projects: state.projects.filter((p) => p.id !== id),
    })),

  previewUrl: "about:blank",
  setPreviewUrl: (url) => set({ previewUrl: url }),

  provider: "openai",
  setProvider: (provider) => set({ provider }),

  model: "gpt-4o",
  setModel: (model) => set({ model }),

  apiKey: "",
  setApiKey: (key) => set({ apiKey: key }),

  currentProjectId: null,
  setCurrentProjectId: (id) => set({ currentProjectId: id }),
}))
