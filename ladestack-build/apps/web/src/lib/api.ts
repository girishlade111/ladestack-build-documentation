import type { Project, ChatRequest, FileNode } from "./types"
import { createParser } from "eventsource-parser"

const API_BASE = "http://localhost:3001/api"

export async function fetchProjects(): Promise<Project[]> {
  const res = await fetch(`${API_BASE}/projects`)
  if (!res.ok) throw new Error("Failed to fetch projects")
  const data = await res.json()
  return Array.isArray(data) ? data : data.items ?? []
}

export async function createProject(
  data: Partial<Project>
): Promise<Project> {
  const res = await fetch(`${API_BASE}/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error("Failed to create project")
  return res.json()
}

export async function updateProject(
  id: string,
  data: Partial<Project>
): Promise<Project> {
  const res = await fetch(`${API_BASE}/projects/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error("Failed to update project")
  return res.json()
}

export async function deleteProject(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/projects/${id}`, {
    method: "DELETE",
  })
  if (!res.ok) throw new Error("Failed to delete project")
}

export async function fetchFileTree(projectId: string): Promise<FileNode[]> {
  const res = await fetch(`${API_BASE}/files/${projectId}`)
  if (!res.ok) throw new Error("Failed to fetch file tree")
  const data = await res.json()
  return data.items ?? []
}

export async function readFile(projectId: string, filePath: string): Promise<{ content: string; language: string }> {
  const res = await fetch(`${API_BASE}/files/${projectId}/content?path=${encodeURIComponent(filePath)}`)
  if (!res.ok) throw new Error("Failed to read file")
  return res.json()
}

export async function sendChatMessage(request: ChatRequest): Promise<Response> {
  return fetch(`${API_BASE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  })
}

export function createSSEConnection(
  response: Response,
  callbacks: {
    onChunk: (text: string) => void
    onToolCall?: (data: unknown) => void
    onToolResult?: (data: unknown) => void
    onPreview?: (url: string) => void
    onDone: () => void
    onError: (error: Error) => void
  }
): () => void {
  const bodyReader = response.body?.getReader()
  if (!bodyReader) {
    callbacks.onError(new Error("No response body"))
    return () => {}
  }
  const reader: ReadableStreamDefaultReader<Uint8Array> = bodyReader

  const decoder = new TextDecoder()
  let cancelled = false

  const parser = createParser({
    onEvent(event) {
      try {
        const data = JSON.parse(event.data)
        switch (data.type) {
          case "chunk":
            callbacks.onChunk(data.content ?? "")
            break
          case "tool-call":
            callbacks.onToolCall?.(data)
            break
          case "tool-result":
            callbacks.onToolResult?.(data)
            break
          case "preview":
            callbacks.onPreview?.(data.url ?? "")
            break
          case "done":
            callbacks.onDone()
            break
          case "error":
            callbacks.onError(new Error(data.message ?? "Stream error"))
            break
        }
      } catch {
        callbacks.onChunk(event.data)
      }
    }
  })

  async function read() {
    try {
      while (!cancelled) {
        const { done, value } = await reader.read()
        if (done) break
        parser.feed(decoder.decode(value, { stream: true }))
      }
    } catch (err) {
      if (!cancelled) {
        callbacks.onError(
          err instanceof Error ? err : new Error("Stream read failed")
        )
      }
    }
  }

  read()

  return () => {
    cancelled = true
    reader.cancel()
  }
}
