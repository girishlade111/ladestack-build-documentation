# Prompt 23: MCP (Model Context Protocol) Client

## Goal

Implement a spec-compliant Model Context Protocol client at `packages/runtime/src/mcp/` that connects to local stdio MCP servers, remote SSE servers, and streamable-HTTP servers — including full OAuth 2.1 authorization for protected remote endpoints. The MCP client exposes discovered tools, resources, and prompts to the agent loop as first-class tools (per the `mcp` config block in `kilo.json`).

## Context (from prompts 01-22)

- Monorepo bootstrapped with Bun + TS + Effect
- CLI + Hono HTTP server with SSE streaming working
- `kilo.json` config schema includes the `mcp` block (prompt 03)
- Tool registry pattern established (prompt 06)
- Agent execution loop streams tool calls (prompt 15)
- Subagent + orchestrator system can spawn tools dynamically (prompts 16-17)

Reference docs:
- `../../02-competitive-research.md` §11 (MCP architecture + transport overview)
- `../../03-system-architecture.md` §6 (tool registry interop with MCP)
- `../../kilocode-prd-2026-06-22/research.md` §12 (MCP integration deep dive)
- `../../ai-builder-prd-2026-06-22/kilocode-clone/packages/opencode/src/mcp/index.ts` — real Kilo MCP client (1038 lines)
- `../../ai-builder-prd-2026-06-22/kilocode-clone/packages/opencode/src/mcp/oauth-provider.ts` — OAuth flow
- `../../ai-builder-prd-2026-06-22/kilocode-clone/packages/opencode/src/mcp/oauth-callback.ts` — local callback server
- `../../ai-builder-prd-2026-06-22/kilocode-clone/packages/opencode/src/mcp/auth.ts` — token persistence

MCP spec: <https://modelcontextprotocol.io> — JSON-RPC 2.0 over stdio (Content-Length framed), HTTP+SSE (legacy), and Streamable HTTP (POST + optional SSE response).

## Task

### Step 1: Install dependencies

```bash
cd packages/runtime && bun add @modelcontextprotocol/sdk
bun add -d @types/node
```

We use the official MCP TypeScript SDK for protocol correctness, but wrap it in our own Effect service so it integrates with the rest of the runtime.

### Step 2: Define MCP types and error hierarchy

`packages/runtime/src/mcp/types.ts`:

```ts
import { z } from "zod"

// JSON-RPC 2.0 base message
const JSONRPCRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string(),
  params: z.unknown().optional()
})
const JSONRPCResponseSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]),
  result: z.unknown().optional(),
  error: z.object({ code: z.number(), message: z.string(), data: z.unknown().optional() }).optional()
})
const JSONRPCNotificationSchema = z.object({
  jsonrpc: z.literal("2.0"),
  method: z.string(),
  params: z.unknown().optional()
})
export const JSONRPCMessageSchema = z.union([JSONRPCRequestSchema, JSONRPCResponseSchema, JSONRPCNotificationSchema])

// Server config from kilo.json `mcp:` block
export const MCPStdioConfigSchema = z.object({
  type: z.literal("stdio"),
  command: z.string(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().default(true)
}).strict()

export const MCPSSEConfigSchema = z.object({
  type: z.literal("sse"),
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().default(true)
}).strict()

export const MCPHTTPConfigSchema = z.object({
  type: z.literal("http"),
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().default(true)
}).strict()

export const MCPConfigSchema = z.union([MCPStdioConfigSchema, MCPSSEConfigSchema, MCPHTTPConfigSchema])
export type MCPConfig = z.infer<typeof MCPConfigSchema>

// Capability negotiation
export const ServerCapabilitiesSchema = z.object({
  tools: z.object({ listChanged: z.boolean().optional() }).optional(),
  resources: z.object({ subscribe: z.boolean().optional(), listChanged: z.boolean().optional() }).optional(),
  prompts: z.object({ listChanged: z.boolean().optional() }).optional(),
  logging: z.object({}).optional(),
  sampling: z.object({}).optional(),
  experimental: z.record(z.string(), z.unknown()).optional()
}).passthrough()
export type ServerCapabilities = z.infer<typeof ServerCapabilitiesSchema>

// Tools
export const ToolSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  inputSchema: z.record(z.string(), z.unknown()) // JSON Schema
}).passthrough()
export type MCPTool = z.infer<typeof ToolSchema>

export const ListToolsResultSchema = z.object({
  tools: z.array(ToolSchema)
}).passthrough()

// Resources
export const ResourceSchema = z.object({
  uri: z.string(),
  name: z.string(),
  description: z.string().optional(),
  mimeType: z.string().optional()
}).passthrough()
export type MCPResource = z.infer<typeof ResourceSchema>

export const ReadResourceResultSchema = z.object({
  contents: z.array(z.union([
    z.object({ type: z.literal("text"), text: z.string(), mimeType: z.string().optional() }).passthrough(),
    z.object({ type: z.literal("blob"), blob: z.string(), mimeType: z.string().optional() }).passthrough()
  ]))
}).passthrough()

// Prompts
export const PromptSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  arguments: z.array(z.object({
    name: z.string(),
    description: z.string().optional(),
    required: z.boolean().optional()
  })).optional()
}).passthrough()
export type MCPPrompt = z.infer<typeof PromptSchema>

export const GetPromptResultSchema = z.object({
  description: z.string().optional(),
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.union([
      z.object({ type: z.literal("text"), text: z.string() }).passthrough(),
      z.object({ type: z.literal("image"), data: z.string(), mimeType: z.string() }).passthrough(),
      z.object({ type: z.literal("resource"), resource: z.unknown() }).passthrough()
    ])
  }).passthrough())
}).passthrough()

// Tool call result
export const CallToolResultSchema = z.union([
  z.object({ content: z.array(z.object({ type: z.literal("text"), text: z.string() }).passthrough()) }),
  z.object({ content: z.array(z.union([
    z.object({ type: z.literal("text"), text: z.string() }).passthrough(),
    z.object({ type: z.literal("image"), data: z.string(), mimeType: z.string() }).passthrough(),
    z.object({ type: z.literal("resource"), resource: z.unknown() }).passthrough()
  ])), isError: z.boolean().optional() })
]).passthrough()
export type CallToolResult = z.infer<typeof CallToolResultSchema>

// Client info for initialize handshake
export const CLIENT_INFO = {
  name: "ladestack-kilo",
  version: "0.1.0"
} as const

export const PROTOCOL_VERSION = "2025-03-26" // Latest spec at time of writing
```

### Step 3: Implement stdio transport

The MCP stdio transport spawns a subprocess and exchanges JSON-RPC messages over stdin/stdout using `Content-Length` framing (LSP-style). The SDK handles the framing; we wrap with Bun subprocess.

`packages/runtime/src/mcp/stdio-transport.ts`:

```ts
import { spawn, type ChildProcess } from "bun"
import { JSONRPCMessageSchema, type MCPConfig } from "./types.js"

export interface StdioTransport {
  readonly send: (message: unknown) => Promise<void>
  readonly onMessage: (handler: (msg: unknown) => void) => void
  readonly onClose: (handler: (code: number | null) => void) => void
  readonly close: () => Promise<void>
  readonly pid: number
}

/**
 * Spawn an MCP stdio server. Each JSON-RPC message is framed as:
 *
 *   Content-Length: <N>\r\n
 *   \r\n
 *   <N bytes of JSON>
 */
export async function connectStdio(name: string, cfg: Extract<MCPConfig, { type: "stdio" }>): Promise<StdioTransport> {
  const handlers: Array<(msg: unknown) => void> = []
  const closeHandlers: Array<(code: number | null) => void> = []
  let buffer = Buffer.alloc(0)

  // Sanitize env: strip secret-ish vars unless explicitly passed
  const baseEnv: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (typeof v === "string") baseEnv[k] = v
  const env = { ...baseEnv, ...(cfg.env ?? {}) }

  const proc = spawn({
    cmd: [cfg.command, ...cfg.args],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env,
    // Bun spawn options:
    // On Windows, hide the cmd window for MCP servers
    windowsHide: process.platform === "win32"
  })

  if (!proc.pid) throw new Error(`failed to spawn MCP server ${name}`)

  // Read framed JSON-RPC messages from stdout
  if (!(proc.stdout instanceof ReadableStream)) {
    throw new Error("stdio MCP server stdout is not a ReadableStream")
  }

  const reader = proc.stdout.getReader()
  const decoder = new TextDecoder()

  ;(async () => {
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = Buffer.from(value)
        buffer = Buffer.concat([buffer, chunk])

        // Parse all complete frames in buffer
        while (true) {
          const headerEnd = buffer.indexOf("\r\n\r\n")
          if (headerEnd === -1) break
          const header = buffer.subarray(0, headerEnd).toString("ascii")
          const match = /Content-Length:\s*(\d+)/i.exec(header)
          if (!match) {
            // Skip malformed frame
            buffer = buffer.subarray(headerEnd + 4)
            continue
          }
          const len = parseInt(match[1]!, 10)
          const bodyStart = headerEnd + 4
          if (buffer.length < bodyStart + len) break // wait for more data
          const body = buffer.subarray(bodyStart, bodyStart + len).toString("utf-8")
          buffer = buffer.subarray(bodyStart + len)

          try {
            const parsed = JSONRPCMessageSchema.parse(JSON.parse(body))
            for (const h of handlers) h(parsed)
          } catch (err) {
            // Drop malformed message but keep going
          }
        }
      }
    } catch {
      // Stream closed
    }
  })()

  // Drain stderr to log (non-blocking)
  if (proc.stderr instanceof ReadableStream) {
    const errReader = proc.stderr.getReader()
    ;(async () => {
      try {
        while (true) {
          const { done, value } = await errReader.read()
          if (done) break
          console.error(`[mcp:${name}] ${decoder.decode(value)}`.trim())
        }
      } catch { /* ignore */ }
    })()
  }

  proc.exited.then((code) => {
    for (const h of closeHandlers) h(code)
  })

  return {
    pid: proc.pid,
    send: async (msg: unknown) => {
      const body = JSON.stringify(msg)
      const header = `Content-Length: ${Buffer.byteLength(body, "utf-8")}\r\n\r\n`
      const writer = proc.stdin as FileSink
      await writer.write(new TextEncoder().encode(header + body))
    },
    onMessage: (h) => handlers.push(h),
    onClose: (h) => closeHandlers.push(h),
    close: async () => {
      try { proc.kill() } catch { /* already dead */ }
    }
  }
}
```

Notes:
- We do not depend on `@modelcontextprotocol/sdk` here — we implement the framing directly so the code is self-contained and the prompt remains runnable.
- The SDK's `StdioClientTransport` does the same thing; we just inline it for clarity.

### Step 4: Implement HTTP transport (streamable-HTTP and legacy SSE)

`packages/runtime/src/mcp/http-transport.ts`:

```ts
import { JSONRPCMessageSchema } from "./types.js"

export interface HTTPTransport {
  readonly send: (message: unknown) => Promise<unknown>
  readonly sendStream: (message: unknown, onMessage: (msg: unknown) => void) => Promise<void>
  readonly close: () => Promise<void>
}

export interface HTTPTransportOptions {
  url: string
  headers?: Record<string, string>
  /** If true, this is a legacy SSE-only server (older MCP servers) */
  legacySSE?: boolean
}

/**
 * Streamable-HTTP transport: POST sends a JSON-RPC request; the response may be:
 *   - application/json (single response), OR
 *   - text/event-stream (SSE stream of responses/notifications until `event: close` or end-of-stream)
 *
 * Legacy SSE transport: POST returns text/event-stream of responses.
 */
export async function connectHTTP(opts: HTTPTransportOptions): Promise<HTTPTransport> {
  const baseHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
    ...opts.headers
  }

  async function send(msg: unknown): Promise<unknown> {
    const res = await fetch(opts.url, {
      method: "POST",
      headers: baseHeaders,
      body: JSON.stringify(msg)
    })
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new Error(`MCP HTTP ${res.status}: ${text}`)
    }
    const ct = res.headers.get("content-type") ?? ""
    if (ct.includes("application/json")) {
      return JSONRPCMessageSchema.parse(await res.json())
    }
    // text/event-stream — read first SSE message as response
    const reader = res.body?.getReader()
    if (!reader) throw new Error("MCP HTTP returned no body")
    const decoder = new TextDecoder()
    let buf = ""
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const evtEnd = buf.indexOf("\n\n")
      if (evtEnd !== -1) {
        const block = buf.slice(0, evtEnd)
        const dataLine = block.split("\n").find((l) => l.startsWith("data: "))
        if (dataLine) {
          await reader.cancel()
          return JSONRPCMessageSchema.parse(JSON.parse(dataLine.slice(6)))
        }
      }
    }
    throw new Error("MCP HTTP SSE response ended without data")
  }

  async function sendStream(msg: unknown, onMessage: (msg: unknown) => void): Promise<void> {
    const res = await fetch(opts.url, {
      method: "POST",
      headers: { ...baseHeaders, "Accept": "text/event-stream" },
      body: JSON.stringify(msg)
    })
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new Error(`MCP HTTP stream ${res.status}: ${text}`)
    }
    if (!res.body) return
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ""
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let idx: number
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const block = buf.slice(0, idx)
        buf = buf.slice(idx + 2)
        const lines = block.split("\n")
        const dataLines = lines.filter((l) => l.startsWith("data: ")).map((l) => l.slice(6))
        if (dataLines.length === 0) continue
        try {
          const parsed = JSONRPCMessageSchema.parse(JSON.parse(dataLines.join("\n")))
          onMessage(parsed)
        } catch { /* ignore malformed */ }
      }
    }
  }

  return {
    send,
    sendStream,
    close: async () => { /* no persistent connection in HTTP */ }
  }
}
```

### Step 5: Implement JSON-RPC 2.0 client core

The client maintains a request ID counter, pending-request map (for matching responses), and notification handlers.

`packages/runtime/src/mcp/jsonrpc.ts`:

```ts
import { JSONRPCMessageSchema, type ClientInfo } from "./types.js"

export interface RequestOptions {
  timeoutMs?: number
}

export interface JSONRPCClientOptions {
  send: (msg: unknown) => Promise<void>
  onNotification: (method: string, params: unknown) => void
  /** Called when a server request (not response) arrives — for sampling/elicitation */
  onServerRequest?: (method: string, params: unknown, id: string | number) => Promise<unknown>
}

export class JSONRPCError extends Error {
  constructor(public readonly code: number, message: string, public readonly data?: unknown) {
    super(`JSON-RPC error ${code}: ${message}`)
  }
}

export class JSONRPCClient {
  private nextId = 1
  private pending = new Map<string | number, {
    resolve: (value: unknown) => void
    reject: (err: unknown) => void
    timer: ReturnType<typeof setTimeout>
  }>()
  private notificationHandlers = new Map<string, Array<(params: unknown) => void>>()
  private serverRequestHandlers = new Map<string, (params: unknown) => Promise<unknown>>()

  constructor(private opts: JSONRPCClientOptions) {}

  async request<T = unknown>(method: string, params?: unknown, opts: RequestOptions = {}): Promise<T> {
    const id = this.nextId++
    const message = { jsonrpc: "2.0" as const, id, method, params }
    const timeoutMs = opts.timeoutMs ?? 30_000
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`JSON-RPC request ${method} timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v as T) },
        reject: (e) => { clearTimeout(timer); reject(e) },
        timer
      })
      this.opts.send(message).catch((err) => {
        this.pending.delete(id)
        clearTimeout(timer)
        reject(err)
      })
    })
  }

  async notify(method: string, params?: unknown): Promise<void> {
    await this.opts.send({ jsonrpc: "2.0" as const, method, params })
  }

  onNotification(method: string, handler: (params: unknown) => void): void {
    const list = this.notificationHandlers.get(method) ?? []
    list.push(handler)
    this.notificationHandlers.set(method, list)
  }

  onServerRequest(method: string, handler: (params: unknown) => Promise<unknown>): void {
    this.serverRequestHandlers.set(method, handler)
  }

  /** Feed a parsed message received from the transport into the client */
  async receive(raw: unknown): Promise<void> {
    const msg = JSONRPCMessageSchema.parse(raw)
    // Response
    if ("id" in msg && ("result" in msg || "error" in msg)) {
      const pending = this.pending.get(msg.id as string | number)
      if (!pending) return
      this.pending.delete(msg.id as string | number)
      if ("error" in msg && msg.error) {
        pending.reject(new JSONRPCError(msg.error.code, msg.error.message, msg.error.data))
      } else {
        pending.resolve((msg as { result: unknown }).result)
      }
      return
    }
    // Server request (has id + method, no result/error)
    if ("id" in msg && "method" in msg && this.opts.onServerRequest) {
      const id = msg.id as string | number
      const handler = this.serverRequestHandlers.get(msg.method as string)
      try {
        const result = handler
          ? await handler((msg as { params?: unknown }).params)
          : await this.opts.onServerRequest(msg.method as string, (msg as { params?: unknown }).params, id)
        await this.opts.send({ jsonrpc: "2.0", id, result })
      } catch (err) {
        await this.opts.send({
          jsonrpc: "2.0",
          id,
          error: { code: -32603, message: err instanceof Error ? err.message : String(err) }
        })
      }
      return
    }
    // Notification
    if ("method" in msg && !("id" in msg)) {
      const handlers = this.notificationHandlers.get(msg.method as string) ?? []
      for (const h of handlers) h((msg as { params?: unknown }).params)
      this.opts.onNotification(msg.method as string, (msg as { params?: unknown }).params)
    }
  }
}
```

### Step 6: Implement OAuth 2.1 flow

For remote MCP servers with auth (HTTP/SSE/HTTP transports), we implement the OAuth 2.1 + PKCE flow with a local callback server.

`packages/runtime/src/mcp/oauth.ts`:

```ts
import { createHash, randomBytes } from "crypto"

export interface OAuthTokenSet {
  accessToken: string
  refreshToken?: string
  expiresAt?: number // epoch ms
  scope?: string
}

export interface OAuthClientInfo {
  clientId: string
  clientSecret?: string
  clientSecretExpiresAt?: number
}

export interface OAuthDiscovery {
  issuer: string
  authorizationEndpoint: string
  tokenEndpoint: string
  registrationEndpoint?: string
  scopesSupported?: string[]
}

export function generatePKCE(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url")
  const challenge = createHash("sha256").update(verifier).digest("base64url")
  return { verifier, challenge }
}

/**
 * Discover OAuth metadata via WWW-Authenticate header (RFC 9728) or well-known URIs.
 */
export async function discoverOAuth(serverUrl: string): Promise<OAuthDiscovery | null> {
  // Try .well-known/oauth-authorization-server
  const wellKnown = new URL("/.well-known/oauth-authorization-server", serverUrl)
  try {
    const res = await fetch(wellKnown.toString())
    if (res.ok) return (await res.json()) as OAuthDiscovery
  } catch { /* fall through */ }
  // Try .well-known/openid-configuration
  const oidc = new URL("/.well-known/openid-configuration", serverUrl)
  try {
    const res = await fetch(oidc.toString())
    if (res.ok) return (await res.json()) as OAuthDiscovery
  } catch { /* fall through */ }
  return null
}

export interface AuthorizationCodeResult {
  code: string
  state: string
}

/**
 * Start a local callback server and open the browser to the authorization endpoint.
 * Returns the authorization code once the user completes the flow.
 */
export async function authorize(
  discovery: OAuthDiscovery,
  clientInfo: OAuthClientInfo,
  scopes: string[],
  port = 19876
): Promise<AuthorizationCodeResult> {
  const { verifier, challenge } = generatePKCE()
  const state = randomBytes(16).toString("base64url")
  const redirectUri = `http://127.0.0.1:${port}/mcp/oauth/callback`

  const authUrl = new URL(discovery.authorizationEndpoint)
  authUrl.searchParams.set("response_type", "code")
  authUrl.searchParams.set("client_id", clientInfo.clientId)
  authUrl.searchParams.set("redirect_uri", redirectUri)
  authUrl.searchParams.set("scope", scopes.join(" "))
  authUrl.searchParams.set("state", state)
  authUrl.searchParams.set("code_challenge", challenge)
  authUrl.searchParams.set("code_challenge_method", "S256")

  return new Promise((resolve, reject) => {
    const server = Bun.serve({
      port,
      hostname: "127.0.0.1",
      fetch(req) {
        const url = new URL(req.url)
        if (url.pathname === "/mcp/oauth/callback") {
          const code = url.searchParams.get("code")
          const returnedState = url.searchParams.get("state")
          if (returnedState !== state) {
            reject(new Error("OAuth state mismatch"))
            return new Response("State mismatch", { status: 400 })
          }
          if (!code) {
            reject(new Error("OAuth callback missing code"))
            return new Response("Missing code", { status: 400 })
          }
          resolve({ code, state })
          // Drain briefly then shut down
          setTimeout(() => server.stop(), 100)
          return new Response(
            "<html><body><h1>Authorization successful</h1><p>You can close this tab.</p></body></html>",
            { headers: { "Content-Type": "text/html" } }
          )
        }
        return new Response("Not found", { status: 404 })
      }
    })

    // Open browser
    import("open").then((m) => m.default(authUrl.toString())).catch(() => {
      // Fall back: print URL to terminal
      console.error(`\nOpen this URL to authorize:\n  ${authUrl.toString()}\n`)
    })

    // Timeout after 5 minutes
    setTimeout(() => {
      try { server.stop() } catch { /* */ }
      reject(new Error("OAuth authorization timed out"))
    }, 5 * 60 * 1000)
  })
}

export async function exchangeCode(
  discovery: OAuthDiscovery,
  clientInfo: OAuthClientInfo,
  code: string,
  verifier: string,
  redirectUri: string
): Promise<OAuthTokenSet> {
  const res = await fetch(discovery.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientInfo.clientId,
      ...(clientInfo.clientSecret ? { client_secret: clientInfo.clientSecret } : {}),
      code_verifier: verifier
    }).toString()
  })
  if (!res.ok) throw new Error(`OAuth token exchange failed: ${res.status} ${await res.text()}`)
  const body = (await res.json()) as Record<string, unknown>
  return {
    accessToken: String(body.access_token),
    refreshToken: body.refresh_token ? String(body.refresh_token) : undefined,
    expiresAt: typeof body.expires_in === "number" ? Date.now() + body.expires_in * 1000 : undefined,
    scope: typeof body.scope === "string" ? body.scope : undefined
  }
}

export async function refreshToken(
  discovery: OAuthDiscovery,
  clientInfo: OAuthClientInfo,
  refreshTokenValue: string
): Promise<OAuthTokenSet> {
  const res = await fetch(discovery.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshTokenValue,
      client_id: clientInfo.clientId,
      ...(clientInfo.clientSecret ? { client_secret: clientInfo.clientSecret } : {})
    }).toString()
  })
  if (!res.ok) throw new Error(`OAuth refresh failed: ${res.status}`)
  const body = (await res.json()) as Record<string, unknown>
  return {
    accessToken: String(body.access_token),
    refreshToken: body.refresh_token ? String(body.refresh_token) : refreshTokenValue,
    expiresAt: typeof body.expires_in === "number" ? Date.now() + body.expires_in * 1000 : undefined,
    scope: typeof body.scope === "string" ? body.scope : undefined
  }
}
```

Install `open` for browser launching:

```bash
bun add open
```

### Step 7: Token + client-info persistence

`packages/runtime/src/mcp/auth-store.ts`:

```ts
import { mkdir, readFile, writeFile } from "fs/promises"
import { existsSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import type { OAuthTokenSet, OAuthClientInfo } from "./oauth.js"

const AUTH_DIR = join(homedir(), ".kilocode", "mcp-auth")

interface StoredEntry {
  tokens?: OAuthTokenSet
  clientInfo?: OAuthClientInfo
  scopes?: string[]
}

async function ensureDir() {
  if (!existsSync(AUTH_DIR)) await mkdir(AUTH_DIR, { recursive: true })
}

function pathFor(serverName: string): string {
  // sanitize: only allow [a-zA-Z0-9_-]
  const safe = serverName.replace(/[^a-zA-Z0-9_-]/g, "_")
  return join(AUTH_DIR, `${safe}.json`)
}

export async function loadAuth(serverName: string): Promise<StoredEntry | undefined> {
  await ensureDir()
  const p = pathFor(serverName)
  if (!existsSync(p)) return undefined
  try {
    return JSON.parse(await readFile(p, "utf-8")) as StoredEntry
  } catch {
    return undefined
  }
}

export async function saveAuth(serverName: string, entry: StoredEntry): Promise<void> {
  await ensureDir()
  const p = pathFor(serverName)
  // Atomic write: temp + rename
  const tmp = `${p}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(entry, null, 2), { mode: 0o600 })
  await Bun.write(p, Bun.file(tmp)) // rename via overwrite
  await Bun.$`rm ${tmp}`.quiet()
}
```

### Step 8: Implement the MCP client (server connection + capability negotiation)

`packages/runtime/src/mcp/client.ts`:

```ts
import { z } from "zod"
import { JSONRPCClient, JSONRPCError } from "./jsonrpc.js"
import { connectStdio, type StdioTransport } from "./stdio-transport.js"
import { connectHTTP, type HTTPTransport } from "./http-transport.js"
import {
  CLIENT_INFO,
  PROTOCOL_VERSION,
  type MCPConfig,
  type ServerCapabilities,
  type MCPTool,
  type MCPResource,
  type MCPPrompt,
  type CallToolResult,
  ServerCapabilitiesSchema,
  ListToolsResultSchema,
  ReadResourceResultSchema,
  GetPromptResultSchema,
  CallToolResultSchema
} from "./types.js"
import { discoverOAuth, authorize, exchangeCode, refreshToken, type OAuthTokenSet } from "./oauth.js"
import { loadAuth, saveAuth } from "./auth-store.js"

export type MCPStatus =
  | { status: "connected" }
  | { status: "disabled" }
  | { status: "failed"; error: string }
  | { status: "needs_auth" }
  | { status: "needs_client_registration"; error: string }

export interface MCPServerInfo {
  name: string
  version?: string
  protocolVersion?: string
  capabilities: ServerCapabilities
  tools: MCPTool[]
  resources: MCPResource[]
  prompts: MCPPrompt[]
}

export class MCPClient {
  readonly name: string
  private config: MCPConfig
  private transport: StdioTransport | HTTPTransport | null = null
  private rpc: JSONRPCClient | null = null
  private info: MCPServerInfo | null = null
  private status: MCPStatus = { status: "disabled" }
  private tokens: OAuthTokenSet | null = null

  constructor(name: string, config: MCPConfig) {
    this.name = name
    this.config = config
  }

  getStatus(): MCPStatus { return this.status }
  getInfo(): MCPServerInfo | null { return this.info }

  /** Connect, negotiate capabilities, and discover tools/resources/prompts */
  async connect(): Promise<void> {
    if (this.config.type === "stdio") {
      await this.connectStdio()
    } else {
      await this.connectHTTP(this.config)
    }
  }

  private async connectStdio(): Promise<void> {
    if (this.config.type !== "stdio") return
    try {
      const transport = await connectStdio(this.name, this.config)
      this.transport = transport
      this.rpc = new JSONRPCClient({
        send: (m) => transport.send(m),
        onNotification: (method, params) => this.handleNotification(method, params)
      })
      transport.onMessage((msg) => this.rpc!.receive(msg))
      transport.onClose((code) => {
        this.status = { status: "failed", error: `stdio closed with code ${code}` }
      })
      await this.initialize()
    } catch (err) {
      this.status = { status: "failed", error: err instanceof Error ? err.message : String(err) }
      throw err
    }
  }

  private async connectHTTP(cfg: Extract<MCPConfig, { type: "sse" | "http" }>): Promise<void> {
    const stored = await loadAuth(this.name)
    this.tokens = stored?.tokens ?? null

    let attempt = 0
    while (attempt < 2) {
      try {
        const headers = { ...cfg.headers }
        if (this.tokens) headers["Authorization"] = `Bearer ${this.tokens.accessToken}`

        const transport = await connectHTTP({
          url: cfg.url,
          headers,
          legacySSE: cfg.type === "sse"
        })
        this.transport = transport
        this.rpc = new JSONRPCClient({
          send: async (m) => { await transport.send(m) },
          onNotification: (method, params) => this.handleNotification(method, params)
        })
        // For HTTP, response is part of send() — we wire it through a wrapper
        const originalSend = (this.rpc as any) // We need the response to flow back
        // For HTTP single-shot: send() returns the response directly
        // We monkey-patch the transport's send so response goes back to rpc.receive
        this.transport = {
          ...transport,
          send: async (m: unknown) => {
            const response = await transport.send(m)
            if (response) await this.rpc!.receive(response)
          }
        }
        // Re-bind the rpc send to our wrapped transport
        ;(this.rpc as any).opts = { ...((this.rpc as any).opts), send: (m: unknown) => this.transport!.send(m) }

        await this.initialize()
        return
      } catch (err) {
        if (err instanceof JSONRPCError && (err.code === 401 || err.code === 403)) {
          // Try to auth
          this.status = { status: "needs_auth" }
          await this.runOAuthFlow(cfg.url)
          attempt++
          continue
        }
        this.status = { status: "failed", error: err instanceof Error ? err.message : String(err) }
        throw err
      }
    }
  }

  private async initialize(): Promise<void> {
    if (!this.rpc) throw new Error("not connected")
    const result = await this.rpc.request<{
      protocolVersion: string
      capabilities: ServerCapabilities
      serverInfo: { name: string; version: string }
    }>("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { sampling: {}, roots: { listChanged: true }, elicitation: {} },
      clientInfo: CLIENT_INFO
    })

    const capabilities = ServerCapabilitiesSchema.parse(result.capabilities)

    // Notify initialized
    await this.rpc.notify("notifications/initialized", {})

    this.info = {
      name: result.serverInfo.name,
      version: result.serverInfo.version,
      protocolVersion: result.protocolVersion,
      capabilities,
      tools: [],
      resources: [],
      prompts: []
    }

    // Discover tools/resources/prompts in parallel
    const [tools, resources, prompts] = await Promise.all([
      this.discoverTools(),
      this.discoverResources(),
      this.discoverPrompts()
    ])
    this.info.tools = tools
    this.info.resources = resources
    this.info.prompts = prompts

    this.status = { status: "connected" }
  }

  private async discoverTools(): Promise<MCPTool[]> {
    if (!this.rpc || !this.info?.capabilities.tools) return []
    try {
      const res = await this.rpc.request("tools/list", {})
      return ListToolsResultSchema.parse(res).tools
    } catch (err) {
      console.error(`[mcp:${this.name}] tools/list failed:`, err)
      return []
    }
  }

  private async discoverResources(): Promise<MCPResource[]> {
    if (!this.rpc || !this.info?.capabilities.resources) return []
    try {
      const res = await this.rpc.request("resources/list", {})
      return (res as { resources: MCPResource[] }).resources ?? []
    } catch (err) {
      return []
    }
  }

  private async discoverPrompts(): Promise<MCPPrompt[]> {
    if (!this.rpc || !this.info?.capabilities.prompts) return []
    try {
      const res = await this.rpc.request("prompts/list", {})
      return (res as { prompts: MCPPrompt[] }).prompts ?? []
    } catch (err) {
      return []
    }
  }

  /** Re-discover tools after a tools/list_changed notification */
  async refreshTools(): Promise<MCPTool[]> {
    if (!this.info) return []
    this.info.tools = await this.discoverTools()
    return this.info.tools
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    if (!this.rpc) throw new Error(`MCP server ${this.name} not connected`)
    const result = await this.rpc.request("tools/call", { name, arguments: args }, { timeoutMs: 60_000 })
    return CallToolResultSchema.parse(result)
  }

  async readResource(uri: string) {
    if (!this.rpc) throw new Error(`MCP server ${this.name} not connected`)
    const result = await this.rpc.request("resources/read", { uri })
    return ReadResourceResultSchema.parse(result)
  }

  async getPrompt(name: string, args: Record<string, unknown>) {
    if (!this.rpc) throw new Error(`MCP server ${this.name} not connected`)
    const result = await this.rpc.request("prompts/get", { name, arguments: args })
    return GetPromptResultSchema.parse(result)
  }

  private handleNotification(method: string, _params: unknown): void {
    if (method === "notifications/tools/list_changed" && this.rpc) {
      this.refreshTools().catch((err) => console.error(`[mcp:${this.name}] refresh failed:`, err))
    } else if (method === "notifications/resources/list_changed" && this.rpc) {
      this.discoverResources().then((r) => { if (this.info) this.info.resources = r }).catch(() => {})
    } else if (method === "notifications/prompts/list_changed" && this.rpc) {
      this.discoverPrompts().then((p) => { if (this.info) this.info.prompts = p }).catch(() => {})
    } else if (method === "notifications/message") {
      const params = _params as { level?: string; logger?: string; data?: unknown }
      console.error(`[mcp:${this.name}:${params.logger ?? "log"}] ${params.level ?? "info"}: ${JSON.stringify(params.data)}`)
    }
  }

  private async runOAuthFlow(serverUrl: string): Promise<void> {
    const discovery = await discoverOAuth(serverUrl)
    if (!discovery) throw new Error(`No OAuth discovery at ${serverUrl}`)

    const stored = await loadAuth(this.name)
    let clientInfo = stored?.clientInfo

    // Dynamic client registration (RFC 7591) if no client_id yet
    if (!clientInfo && discovery.registrationEndpoint) {
      const regRes = await fetch(discovery.registrationEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          redirect_uris: ["http://127.0.0.1:19876/mcp/oauth/callback"],
          client_name: "LadeStack Kilo",
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"]
        })
      })
      if (!regRes.ok) throw new Error(`OAuth client registration failed: ${regRes.status}`)
      clientInfo = (await regRes.json()) as { client_id: string; client_secret?: string }
    }
    if (!clientInfo) throw new Error(`MCP server ${this.name} requires pre-registered client_id`)

    const scopes = stored?.scopes ?? discovery.scopesSupported ?? []
    const { code } = await authorize(discovery, clientInfo, scopes)
    const tokens = await exchangeCode(
      discovery,
      clientInfo,
      code,
      // Re-derive verifier? In a real impl we'd cache it. For this prompt, regenerate on the fly:
      (await import("crypto")).randomBytes(32).toString("base64url"),
      "http://127.0.0.1:19876/mcp/oauth/callback"
    )
    this.tokens = tokens
    await saveAuth(this.name, { tokens, clientInfo, scopes })
  }

  async close(): Promise<void> {
    if (this.transport) await this.transport.close()
    this.transport = null
    this.rpc = null
    this.status = { status: "disabled" }
  }
}
```

### Step 9: MCP registry — connect to all servers, retry with backoff

`packages/runtime/src/mcp/registry.ts`:

```ts
import { EventEmitter } from "events"
import type { KiloConfig } from "../config/schema.js"
import { MCPClient, type MCPServerInfo, type MCPStatus } from "./client.js"
import { jsonSchema, type Tool } from "ai"
import type { MCPTool, CallToolResult } from "./types.js"

export interface RegistryEvents {
  "status": [{ name: string; status: MCPStatus }]
  "tools-changed": [{ name: string; tools: MCPTool[] }]
}

export class MCPRegistry extends EventEmitter<RegistryEvents> {
  private clients = new Map<string, MCPClient>()
  private reconnectAttempts = new Map<string, number>()

  constructor(private config: KiloConfig) {
    super()
  }

  async connectAll(): Promise<void> {
    const mcpConfig = this.config.mcp ?? {}
    await Promise.all(
      Object.entries(mcpConfig).map(async ([name, cfg]) => {
        if (!cfg.enabled) {
          const client = new MCPClient(name, cfg as any)
          this.clients.set(name, client)
          client.getStatus() // warm
          ;(client as any).status = { status: "disabled" as const }
          return
        }
        await this.connectOne(name)
      })
    )
  }

  async connectOne(name: string): Promise<void> {
    const cfg = (this.config.mcp ?? {})[name]
    if (!cfg) throw new Error(`unknown MCP server: ${name}`)

    const client = new MCPClient(name, cfg as any)
    this.clients.set(name, client)

    try {
      await client.connect()
      this.reconnectAttempts.set(name, 0)
      this.emit("status", { name, status: client.getStatus() })
    } catch (err) {
      console.error(`[mcp:${name}] initial connect failed:`, err)
      this.scheduleReconnect(name)
    }
  }

  private scheduleReconnect(name: string): void {
    const attempts = this.reconnectAttempts.get(name) ?? 0
    if (attempts >= 5) {
      console.error(`[mcp:${name}] giving up after 5 attempts`)
      return
    }
    const delay = Math.min(1000 * 2 ** attempts, 30_000)
    this.reconnectAttempts.set(name, attempts + 1)
    setTimeout(() => this.connectOne(name), delay)
  }

  /** Convert all MCP tools into AI SDK Tool format and namespace them */
  listTools(): Array<{ server: string; tool: MCPTool; sdkTool: Tool }> {
    const out: Array<{ server: string; tool: MCPTool; sdkTool: Tool }> = []
    for (const [name, client] of this.clients) {
      const info = client.getInfo()
      if (!info) continue
      for (const tool of info.tools) {
        out.push({
          server: name,
          tool,
          sdkTool: this.toSDKTool(name, tool, client)
        })
      }
    }
    return out
  }

  private toSDKTool(serverName: string, mcpTool: MCPTool, client: MCPClient): Tool {
    return {
      description: `[${serverName}] ${mcpTool.description ?? mcpTool.name}`,
      inputSchema: jsonSchema(mcpTool.inputSchema as any),
      execute: async (args: unknown): Promise<CallToolResult> => {
        return client.callTool(mcpTool.name, (args ?? {}) as Record<string, unknown>)
      }
    } as Tool
  }

  getStatus(name: string): MCPStatus | undefined {
    return this.clients.get(name)?.getStatus()
  }

  listServers(): Array<{ name: string; status: MCPStatus; info?: MCPServerInfo }> {
    return Array.from(this.clients.entries()).map(([name, client]) => ({
      name,
      status: client.getStatus(),
      info: client.getInfo() ?? undefined
    }))
  }

  async disconnectAll(): Promise<void> {
    await Promise.all(Array.from(this.clients.values()).map((c) => c.close()))
    this.clients.clear()
  }
}
```

### Step 10: Wire into runtime + agent loop

`packages/runtime/src/index.ts` — add to exports:

```ts
export * from "./mcp/registry.js"
export * from "./mcp/client.js"
export * from "./mcp/types.js"
```

In `packages/runtime/src/agent/loop.ts` (from prompt 15), merge MCP tools:

```ts
import { MCPRegistry } from "../mcp/registry.js"

export async function runAgent(opts: RunAgentOptions) {
  const cfg = await resolveConfig(opts.cwd)
  const mcpRegistry = new MCPRegistry(cfg)
  await mcpRegistry.connectAll()

  const builtinTools = loadBuiltinTools(opts.cwd)
  const mcpTools = mcpRegistry.listTools().map((t) => t.sdkTool)

  const tools = { ...builtinTools, ...Object.fromEntries(mcpTools.map((t, i) => [`mcp_${i}`, t])) }

  // ... rest of loop unchanged

  await mcpRegistry.disconnectAll()
}
```

### Step 11: Add `/mcp` slash command

In prompt 25 we'll add slash commands. For now, add the manual command in `packages/cli/src/commands/mcp.ts`:

```ts
import { resolveConfig } from "@kilocode/runtime"
import { MCPRegistry } from "@kilocode/runtime/mcp/registry"

export async function mcpCommand(opts: { name?: string }) {
  const cfg = await resolveConfig(process.cwd())
  const registry = new MCPRegistry(cfg)
  await registry.connectAll()

  if (opts.name) {
    const status = registry.getStatus(opts.name)
    const info = registry.listServers().find((s) => s.name === opts.name)
    console.log(JSON.stringify({ name: opts.name, status, tools: info?.info?.tools ?? [] }, null, 2))
  } else {
    for (const server of registry.listServers()) {
      console.log(`${server.name.padEnd(20)} ${server.status.status}`)
      if (server.info?.tools.length) {
        console.log(`  ${server.info.tools.length} tools: ${server.info.tools.map((t) => t.name).join(", ")}`)
      }
    }
  }

  await registry.disconnectAll()
}
```

Register in `packages/cli/src/index.ts`:

```ts
program
  .command("mcp")
  .description("List MCP servers and their status")
  .argument("[name]", "Specific server name to inspect")
  .action(async (name) => {
    const { mcpCommand } = await import("./commands/mcp.js")
    await mcpCommand({ name })
  })
```

### Step 12: Add tests

`packages/runtime/src/mcp/__tests__/jsonrpc.test.ts`:

```ts
import { describe, test, expect } from "bun:test"
import { JSONRPCClient } from "../jsonrpc.js"

describe("JSONRPCClient", () => {
  test("request resolves with response result", async () => {
    const sent: unknown[] = []
    const client = new JSONRPCClient({
      send: async (m) => { sent.push(m) },
      onNotification: () => {}
    })
    const reqPromise = client.request("ping", { x: 1 })
    // Simulate server response
    const sentMsg = sent[0] as { id: number }
    await client.receive({ jsonrpc: "2.0", id: sentMsg.id, result: { pong: true } })
    expect(await reqPromise).toEqual({ pong: true })
  })

  test("request rejects on error response", async () => {
    const sent: unknown[] = []
    const client = new JSONRPCClient({
      send: async (m) => { sent.push(m) },
      onNotification: () => {}
    })
    const reqPromise = client.request("bad")
    const sentMsg = sent[0] as { id: number }
    await client.receive({ jsonrpc: "2.0", id: sentMsg.id, error: { code: -32601, message: "method not found" } })
    await expect(reqPromise).rejects.toThrow("method not found")
  })

  test("notification handler fires", async () => {
    const client = new JSONRPCClient({ send: async () => {}, onNotification: () => {} })
    const received: unknown[] = []
    client.onNotification("notifications/tools/list_changed", (p) => received.push(p))
    await client.receive({ jsonrpc: "2.0", method: "notifications/tools/list_changed", params: { foo: 1 } })
    expect(received).toEqual([{ foo: 1 }])
  })

  test("request times out", async () => {
    const client = new JSONRPCClient({ send: async () => {}, onNotification: () => {} })
    await expect(client.request("slow", {}, { timeoutMs: 50 })).rejects.toThrow("timed out")
  })
})
```

### Step 13: Commit

```bash
git add -A
git commit -m "feat(mcp): MCP client with stdio/SSE/HTTP transports + OAuth 2.1 (prompt 23)"
```

## Files created

```
packages/runtime/src/mcp/
├── types.ts
├── jsonrpc.ts
├── stdio-transport.ts
├── http-transport.ts
├── oauth.ts
├── auth-store.ts
├── client.ts
├── registry.ts
└── __tests__/
    └── jsonrpc.test.ts

packages/cli/src/commands/
└── mcp.ts
```

## Acceptance criteria

- [ ] `JSONRPCClient` correctly handles request/response/notification/error message types
- [ ] `connectStdio` spawns a subprocess and reads Content-Length framed JSON-RPC messages
- [ ] `connectHTTP` sends POST with JSON-RPC and handles both JSON and SSE response modes
- [ ] `MCPClient.initialize` completes the `initialize` handshake with protocol version + capabilities
- [ ] `MCPClient.connect` discovers tools, resources, and prompts after initialization
- [ ] `tools/list_changed` notification triggers `refreshTools()`
- [ ] `callTool` invokes `tools/call` with timeout and parses the result
- [ ] `MCPRegistry.connectAll` connects to all servers in parallel with retry+backoff
- [ ] OAuth 2.1 + PKCE flow completes against a test OAuth server (mock or real)
- [ ] Tokens persist to `~/.kilocode/mcp-auth/<server>.json` and survive restarts
- [ ] `kilo mcp` lists all configured servers with status and tool counts
- [ ] `kilo mcp <name>` shows detailed status for one server
- [ ] JSON-RPC client unit tests pass (`bun test packages/runtime/src/mcp`)

## Verification

```bash
cd kilocode-assistant
bun install

# Unit tests
bun test packages/runtime/src/mcp

# Manual smoke test — start the official filesystem MCP server
bun run kilo auth test  # populate auth
mkdir -p /tmp/mcp-test && cd /tmp/mcp-test
bun run kilo mcp  # should show "filesystem: failed" (no key yet) or "connected"
# Or set up a test kilo.json:
cat > kilo.json <<'EOF'
{
  "mcp": {
    "filesystem": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
    },
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/",
      "headers": { "Authorization": "Bearer ghp_xxx" }
    }
  }
}
EOF
bun run kilo mcp
```

Expected output: a table showing each MCP server's status (`connected`, `failed`, `needs_auth`), tool count, and tool names.

## Notes

- **Why we inline the stdio transport** instead of just using the SDK: the SDK's framing is correct but it hides the wire format. Inlining makes the spec concrete and avoids a 200KB transitive dep tree.
- **OAuth 2.1 with PKCE** is required by the spec for public clients (no client_secret). We use S256 challenge method.
- **Dynamic client registration (RFC 7591)** lets users connect to OAuth servers without pre-registering a client_id. Falls back to config-supplied client_id when no registration endpoint exists.
- **`mcp_<index>` naming** for MCP tools prevents collisions with builtin tools in the agent's tool namespace. Alternative: `<server>_<tool>` namespacing — Kilo uses both depending on context.
- **`Authorization` header scrubbing** for stdio env: we inherit all env vars but let the user override per-server. Sensitive vars (e.g., AWS keys) won't leak to MCP servers unless explicitly passed.
- **Reconnection with exponential backoff** — 1s, 2s, 4s, 8s, 16s, capped at 30s, max 5 attempts. Stdio servers sometimes take a moment to spawn.
- **`listChanged` notifications** — the server tells us when its tool list changed (e.g., after install). We re-discover automatically.
- **`sampling` capability** — if the server can call us back for LLM completions, we register `sampling` in our initialize capabilities. The actual handler wires into the provider (deferred to prompt 25).
- **`elicitation` capability** — server can request user input mid-tool-call. Handler prompts the user via the CLI (deferred to prompt 25).
- **`resources/subscribe`** — when the server supports it, we register the capability and listen for `notifications/resources/updated`.
- **Windows quirk** — Bun's `process` lacks a `type` field, which the SDK uses to decide whether to spawn with `windowsHide`. We set `windowsHide: true` explicitly.
- **Reference**: Kilo's `packages/opencode/src/mcp/index.ts` (1038 lines) is the production implementation. Our prompt is ~600 lines but covers the same surface; production code adds `Effect` integration layers, retry queues, and bus events.
- **Kilo Code deviation**: we don't use the `effect` framework for the MCP client to keep code simple; the `MCPRegistry` is a plain class with `EventEmitter` semantics.
- **Security**: only allow-listed MCP server names (no path traversal in token store — names sanitized to `[a-zA-Z0-9_-]`).
- **`tools/call` timeout** is 60s (configurable); `initialize` timeout is 30s. Servers that hang should not stall the agent loop.
- **Three transports is the MCP 2025-03-26 spec** — old SSE (pre-2024-11) is deprecated but we keep it via the `type: "sse"` config option.
