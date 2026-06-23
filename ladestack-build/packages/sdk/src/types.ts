// --- Messages ---
export interface Message {
  id: string
  role: "user" | "assistant" | "system"
  content: string
  timestamp: number
  toolCalls?: ToolCall[]
  toolResults?: ToolResult[]
}

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface ToolResult {
  toolCallId: string
  output: unknown
  isError?: boolean
}

// --- Projects ---
export interface Project {
  id: string
  name: string
  description: string
  files?: ProjectFile[]
  createdAt: string
  updatedAt: string
}

export interface ProjectFile {
  path: string
  content: string
  language?: string
}

// --- Sessions ---
export interface Session {
  id: string
  messages: Message[]
  context: Record<string, unknown>
  createdAt: string
}

// --- Stream ---
export interface StreamEvent {
  type: "text" | "tool_call" | "tool_result" | "error" | "done"
  data: unknown
}

// --- Providers & Models ---
export type Provider = "anthropic" | "openai" | "google" | "custom"

export interface Model {
  id: string
  provider: Provider
  name: string
  maxTokens: number
}

// --- Skills & Agents ---
export interface SkillDefinition {
  id: string
  name: string
  description: string
  version: string
  url?: string
}

export interface AgentDefinition {
  id: string
  name: string
  description: string
  systemPrompt: string
  skills: SkillDefinition[]
  model: Model
}

// --- Client Config ---
export interface ChatConfig {
  stream?: boolean
  temperature?: number
  maxTokens?: number
  model?: string
}

// --- API Request/Response ---
export interface SendMessageRequest {
  messages: Message[]
  config?: ChatConfig
}

export interface CreateProjectRequest {
  name: string
  description: string
  files?: ProjectFile[]
}

export interface UpdateProjectRequest {
  name?: string
  description?: string
  files?: ProjectFile[]
}

export interface ListProjectsParams {
  search?: string
  page?: number
  limit?: number
}

export interface ClientOptions {
  apiKey?: string
  sessionId?: string
}
