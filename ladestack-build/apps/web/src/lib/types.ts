export type MessageRole = "user" | "assistant" | "system"

export type MessageStatus = "streaming" | "complete" | "error"

export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
  result?: unknown
  status: "pending" | "running" | "success" | "error"
  duration?: number
  agentId?: string
}

export interface Message {
  id: string
  role: MessageRole
  content: string
  toolCalls?: ToolCall[]
  agentId?: string
  timestamp: number
  status: MessageStatus
}

export interface FileNode {
  id: string
  name: string
  path: string
  type: "file" | "directory"
  children?: FileNode[]
  content?: string
  language?: string
}

export interface Project {
  id: string
  name: string
  description?: string
  path: string
  createdAt: string
  updatedAt: string
}

export interface Agent {
  id: string
  name: string
  description: string
  icon?: string
  provider: Provider
  model: string
  systemPrompt?: string
}

export type Provider = "openai" | "anthropic" | "google" | "openrouter" | "custom"

export interface Settings {
  provider: Provider
  model: string
  apiKey: string
  temperature?: number
  maxTokens?: number
}

export interface ChatRequest {
  messages: Pick<Message, "role" | "content">[]
  agentId?: string
  provider: Provider
  model: string
  apiKey: string
}

export interface SSEEvent {
  type: "chunk" | "done" | "error" | "tool-call" | "tool-result"
  data: string
}
