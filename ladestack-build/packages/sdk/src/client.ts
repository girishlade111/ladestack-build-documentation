import { createSSEConnection } from "./sse"
import type {
  Message,
  Project,
  Session,
  SkillDefinition,
  ChatConfig,
  CreateProjectRequest,
  UpdateProjectRequest,
  ListProjectsParams,
  ClientOptions,
} from "./types"

export class LadeStackClient {
  public baseUrl: string
  public sessionId?: string
  private headers: Record<string, string>

  constructor(baseUrl: string, options?: ClientOptions) {
    this.baseUrl = baseUrl.replace(/\/+$/, "")
    this.headers = {
      "Content-Type": "application/json",
    }
    if (options?.apiKey) {
      this.headers["Authorization"] = `Bearer ${options.apiKey}`
    }
    this.sessionId = options?.sessionId
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}/api${path}`
    const response = await fetch(url, {
      method,
      headers: this.headers,
      body: body ? JSON.stringify(body) : undefined,
    })

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "")
      throw new Error(`API error ${response.status}: ${errorBody || response.statusText}`)
    }

    if (response.status === 204) return undefined as T
    return response.json()
  }

  sendMessage(
    messages: Message[],
    config?: ChatConfig
  ): {
    controller: AbortController
    onEvent: (cb: (event: { type: string; data: unknown }) => void) => void
    onError: (cb: (err: Error) => void) => void
    onComplete: (cb: () => void) => void
  } {
    const url = `${this.baseUrl}/api/chat/stream`
    const body = { messages, sessionId: this.sessionId, config }

    let eventCb: ((event: { type: string; data: unknown }) => void) | undefined
    let errorCb: ((err: Error) => void) | undefined
    let completeCb: (() => void) | undefined

    const controller = createSSEConnection(url, body, {
      onEvent: (e) => eventCb?.(e),
      onError: (e) => errorCb?.(e),
      onComplete: () => completeCb?.(),
    })

    return {
      controller,
      onEvent: (cb) => { eventCb = cb },
      onError: (cb) => { errorCb = cb },
      onComplete: (cb) => { completeCb = cb },
    }
  }

  createProject(data: CreateProjectRequest): Promise<Project> {
    return this.request<Project>("POST", "/projects", data)
  }

  listProjects(params?: ListProjectsParams): Promise<Project[]> {
    const searchParams = new URLSearchParams()
    if (params?.search) searchParams.set("search", params.search)
    if (params?.page) searchParams.set("page", String(params.page))
    if (params?.limit) searchParams.set("limit", String(params.limit))
    const qs = searchParams.toString()
    return this.request<Project[]>("GET", `/projects${qs ? `?${qs}` : ""}`)
  }

  getProject(id: string): Promise<Project> {
    return this.request<Project>("GET", `/projects/${encodeURIComponent(id)}`)
  }

  updateProject(id: string, data: UpdateProjectRequest): Promise<Project> {
    return this.request<Project>("PATCH", `/projects/${encodeURIComponent(id)}`, data)
  }

  deleteProject(id: string): Promise<void> {
    return this.request<void>("DELETE", `/projects/${encodeURIComponent(id)}`)
  }

  async createSession(): Promise<string> {
    const result = await this.request<{ id: string }>("POST", "/sessions")
    this.sessionId = result.id
    return result.id
  }

  getSession(id: string): Promise<Session> {
    return this.request<Session>("GET", `/sessions/${encodeURIComponent(id)}`)
  }

  listSkills(): Promise<SkillDefinition[]> {
    return this.request<SkillDefinition[]>("GET", "/skills")
  }

  installSkill(url: string): Promise<SkillDefinition> {
    return this.request<SkillDefinition>("POST", "/skills/install", { url })
  }
}
