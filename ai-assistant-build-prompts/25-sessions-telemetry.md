# Prompt 25: Sessions, Telemetry, and Final Integration

## Goal

Wire everything together: persist every session as append-only JSONL on disk (with replay, resume, and time-travel), implement context compaction when messages overflow, expose a full set of slash commands (`/help`, `/compact`, `/mode`, `/agent`, `/model`, `/mcp`, `/lsp`, `/skills`, `/agents`, `/reload`, `/exit`), add opt-in PostHog-compatible telemetry, and run the final end-to-end smoke test that ships **v0.1.0** — with README, CHANGELOG, and a git tag.

## Context (from prompts 01-24)

- Monorepo bootstrapped, CLI + HTTP server working
- Providers, BYOK, tools, agents, subagents, orchestrator all in place
- Skills discovery + 4 skill bundles installed
- MCP client (stdio/SSE/HTTP + OAuth) wired into agent loop
- LSP client providing diagnostics, hover, completion to agents

Reference docs:
- `../../02-competitive-research.md` §13 (session persistence + replay)
- `../../03-system-architecture.md` §8 (compaction strategy)
- `../../kilocode-prd-2026-06-22/research.md` §14 (sessions + telemetry)
- `../../ai-builder-prd-2026-06-22/kilocode-clone/packages/opencode/src/session/session.ts` — real Kilo session storage (sqlite-backed, ~3000 lines)
- `../../ai-builder-prd-2026-06-22/kilocode-clone/packages/opencode/src/session/compaction.ts` — compaction flow (749 lines)
- `../../ai-builder-prd-2026-06-22/kilocode-clone/packages/opencode/src/session/prompt.ts` — slash command parser
- `../../ai-builder-prd-2026-06-22/kilocode-clone/packages/opencode/src/session/storage.ts` — disk layout

## Task

### Step 1: Session directory layout

Each session lives at `~/.kilocode/sessions/<session-id>/`:

```
~/.kilocode/sessions/<session-id>/
├── session.json          # metadata (id, createdAt, cwd, agent, model)
├── messages.jsonl        # append-only log of messages + tool calls
├── plan.md               # current plan (markdown, regenerated)
├── todos.json            # current todo state
├── compaction.jsonl      # log of compaction events
└── summary.md            # summary for context-compacted sessions
```

`packages/runtime/src/sessions/paths.ts`:

```ts
import { homedir } from "os"
import { join } from "path"

export const SESSIONS_ROOT = join(homedir(), ".kilocode", "sessions")

export function sessionDir(sessionId: string): string {
  return join(SESSIONS_ROOT, sessionId)
}

export function sessionMetadataPath(sessionId: string): string {
  return join(sessionDir(sessionId), "session.json")
}

export function messagesPath(sessionId: string): string {
  return join(sessionDir(sessionId), "messages.jsonl")
}

export function planPath(sessionId: string): string {
  return join(sessionDir(sessionId), "plan.md")
}

export function todosPath(sessionId: string): string {
  return join(sessionDir(sessionId), "todos.json")
}

export function compactionPath(sessionId: string): string {
  return join(sessionDir(sessionId), "compaction.jsonl")
}

export function summaryPath(sessionId: string): string {
  return join(sessionDir(sessionId), "summary.md")
}
```

### Step 2: Append-only message log

`packages/runtime/src/sessions/log.ts`:

```ts
import { appendFile, readFile, mkdir, writeFile, rename } from "fs/promises"
import { existsSync } from "fs"
import { dirname } from "path"
import { z } from "zod"
import {
  messagesPath, compactionPath, planPath, todosPath,
  sessionMetadataPath, summaryPath, sessionDir
} from "./paths.js"

export const MessageRoleSchema = z.enum(["user", "assistant", "system", "tool"])
export type MessageRole = z.infer<typeof MessageRoleSchema>

export const ToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  arguments: z.record(z.string(), z.unknown())
}).strict()
export type ToolCall = z.infer<typeof ToolCallSchema>

export const ToolResultSchema = z.object({
  toolCallId: z.string(),
  name: z.string(),
  result: z.unknown(),
  isError: z.boolean().optional()
}).strict()
export type ToolResult = z.infer<typeof ToolResultSchema>

export const MessageSchema = z.object({
  id: z.string(),
  role: MessageRoleSchema,
  content: z.string(),
  toolCalls: z.array(ToolCallSchema).optional(),
  toolResults: z.array(ToolResultSchema).optional(),
  agent: z.string().optional(),
  model: z.string().optional(),
  ts: z.number().int()
}).strict()
export type Message = z.infer<typeof MessageSchema>

export const SessionMetadataSchema = z.object({
  id: z.string(),
  cwd: z.string(),
  agent: z.string(),
  model: z.string(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  parentId: z.string().optional(),
  title: z.string().optional(),
  compacted: z.boolean().default(false),
  messageCount: z.number().int().default(0)
}).strict()
export type SessionMetadata = z.infer<typeof SessionMetadataSchema>

export class SessionLog {
  constructor(public readonly id: string, public metadata: SessionMetadata) {}

  static async loadOrCreate(id: string, meta: Omit<SessionMetadata, "id" | "createdAt" | "updatedAt" | "messageCount">): Promise<SessionLog> {
    const dir = sessionDir(id)
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true })
      const fullMeta: SessionMetadata = {
        ...meta,
        id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messageCount: 0
      }
      await atomicWriteJson(sessionMetadataPath(id), fullMeta)
      return new SessionLog(id, fullMeta)
    }
    const raw = await readFile(sessionMetadataPath(id), "utf-8")
    const existing = SessionMetadataSchema.parse(JSON.parse(raw))
    return new SessionLog(id, existing)
  }

  async append(msg: Message): Promise<void> {
    await appendFile(messagesPath(this.id), JSON.stringify(msg) + "\n", "utf-8")
    this.metadata.messageCount++
    this.metadata.updatedAt = Date.now()
    await atomicWriteJson(sessionMetadataPath(this.id), this.metadata)
  }

  async readAll(): Promise<Message[]> {
    const p = messagesPath(this.id)
    if (!existsSync(p)) return []
    const raw = await readFile(p, "utf-8")
    const out: Message[] = []
    for (const line of raw.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        out.push(MessageSchema.parse(JSON.parse(trimmed)))
      } catch (err) {
        console.error(`[sessions] skipping malformed line:`, err)
      }
    }
    return out
  }

  async writePlan(markdown: string): Promise<void> {
    await atomicWrite(planPath(this.id), markdown)
  }

  async writeTodos(todos: Array<{ content: string; status: "pending" | "in_progress" | "completed"; priority: "high" | "medium" | "low" }>): Promise<void> {
    await atomicWriteJson(todosPath(this.id), todos)
  }

  async appendCompaction(event: { at: number; beforeCount: number; afterCount: number; summaryTokens: number }): Promise<void> {
    await appendFile(compactionPath(this.id), JSON.stringify(event) + "\n", "utf-8")
  }

  async writeSummary(summary: string): Promise<void> {
    await atomicWrite(summaryPath(this.id), summary)
    this.metadata.compacted = true
    await atomicWriteJson(sessionMetadataPath(this.id), this.metadata)
  }
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmp, content, "utf-8")
  await rename(tmp, path)
}

async function atomicWriteJson(path: string, data: unknown): Promise<void> {
  await atomicWrite(path, JSON.stringify(data, null, 2))
}
```

### Step 3: Session manager (create, list, resume, replay)

`packages/runtime/src/sessions/manager.ts`:

```ts
import { readdir, stat, rm } from "fs/promises"
import { existsSync } from "fs"
import { join } from "path"
import { SESSIONS_ROOT, sessionDir } from "./paths.js"
import { SessionLog, type SessionMetadata, type Message, MessageSchema } from "./log.js"

export class SessionManager {
  /** Create a new session in cwd with given agent/model */
  async create(opts: { cwd: string; agent: string; model: string; parentId?: string }): Promise<SessionLog> {
    const id = crypto.randomUUID()
    const title = await generateTitle(opts.cwd, opts.agent, opts.model)
    return await SessionLog.loadOrCreate(id, {
      cwd: opts.cwd,
      agent: opts.agent,
      model: opts.model,
      parentId: opts.parentId,
      title
    })
  }

  async resume(id: string): Promise<SessionLog> {
    const dir = sessionDir(id)
    if (!existsSync(dir)) throw new Error(`session ${id} not found`)
    return await SessionLog.loadOrCreate(id, {} as any)
  }

  /** List recent sessions, newest first */
  async list(limit = 50): Promise<SessionMetadata[]> {
    if (!existsSync(SESSIONS_ROOT)) return []
    const entries = await readdir(SESSIONS_ROOT)
    const out: SessionMetadata[] = []
    for (const entry of entries) {
      const dir = join(SESSIONS_ROOT, entry)
      const s = await stat(dir)
      if (!s.isDirectory()) continue
      const metaPath = join(dir, "session.json")
      if (!existsSync(metaPath)) continue
      try {
        const raw = await Bun.file(metaPath).text()
        out.push(JSON.parse(raw))
      } catch {
        /* skip malformed */
      }
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit)
  }

  async delete(id: string): Promise<void> {
    await rm(sessionDir(id), { recursive: true, force: true })
  }

  /**
   * Replay a session's messages against a new agent/model.
   * Returns a NEW session containing the same user prompts (so the agent re-answers).
   */
  async replay(id: string, newOpts: { agent?: string; model?: string }): Promise<SessionLog> {
    const source = await this.resume(id)
    const messages = await source.readAll()
    const userMessages = messages.filter((m) => m.role === "user")

    const newSession = await this.create({
      cwd: source.metadata.cwd,
      agent: newOpts.agent ?? source.metadata.agent,
      model: newOpts.model ?? source.metadata.model,
      parentId: id
    })

    // Replay user messages; each one will trigger a fresh agent turn
    for (const userMsg of userMessages) {
      await newSession.append(userMsg)
    }

    return newSession
  }
}

async function generateTitle(cwd: string, agent: string, model: string): Promise<string> {
  // In production, call the small model to generate a title.
  // For now, use a heuristic based on cwd basename.
  const parts = cwd.split("/").filter(Boolean)
  const last = parts[parts.length - 1] ?? "session"
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ")
  return `${last} (${stamp})`
}
```

### Step 4: Context compaction

When messages exceed a threshold, summarize older messages with a small model and replace them with a summary block. The recent N turns (default 2) are preserved verbatim.

`packages/runtime/src/sessions/compaction.ts`:

```ts
import { SessionLog } from "./log.js"
import { resolveConfig } from "../config/loader.js"
import { getProvider } from "../provider/registry.js"
import { Token } from "../util/token.js"

export interface CompactionOptions {
  /** Trigger when estimated tokens exceed this */
  triggerTokens?: number
  /** Always keep at least N most recent turns verbatim */
  keepRecentTurns?: number
  /** Small model to use for summarization (cheaper) */
  smallModel?: string
}

const DEFAULT_OPTIONS: Required<CompactionOptions> = {
  triggerTokens: 100_000,
  keepRecentTurns: 2,
  smallModel: "anthropic/claude-3-5-haiku-20241022"
}

const SUMMARY_PROMPT = `You are summarizing a coding agent's session so far.

<template>
### Goal
- [single-sentence task summary]

### Constraints & Preferences
- [user constraints, preferences, specs, or "(none)"]

### Progress
#### Done
- [completed work or "(none)"]

#### In Progress
- [current work or "(none)"]

#### Blocked
- [blockers or "(none)"]

### Key Decisions
- [decision and why, or "(none)"]

### Next Steps
- [ordered next actions or "(none)"]

### Critical Context
- [important technical facts, errors, open questions, or "(none)"]

### Relevant Files
- [file or directory path: why it matters, or "(none)"]
</template>

Rules:
- Keep every section, even when empty.
- Use terse bullets, not prose paragraphs.
- Preserve exact file paths, commands, error strings, and identifiers when known.
- Do not mention the summary process or that context was compacted.

Conversation to summarize:
`

export class CompactionService {
  constructor(private opts: CompactionOptions = {}) {}

  /** Should we compact this session? */
  shouldCompact(log: SessionLog, messageCount: number): boolean {
    const tokens = messageCount * 500 // rough estimate
    return tokens > (this.opts.triggerTokens ?? DEFAULT_OPTIONS.triggerTokens)
  }

  async compact(log: SessionLog): Promise<{ before: number; after: number; summaryTokens: number }> {
    const messages = await log.readAll()
    const before = messages.length
    if (before === 0) return { before: 0, after: 0, summaryTokens: 0 }

    // Keep recent N turns verbatim, summarize the rest
    const keepTurns = this.opts.keepRecentTurns ?? DEFAULT_OPTIONS.keepRecentTurns
    const userMsgIndexes: number[] = []
    for (let i = 0; i < messages.length; i++) {
      if (messages[i]!.role === "user") userMsgIndexes.push(i)
    }

    if (userMsgIndexes.length <= keepTurns) {
      return { before, after: before, summaryTokens: 0 } // not enough to compact
    }

    const splitIndex = userMsgIndexes[userMsgIndexes.length - keepTurns - 1]!
    const toSummarize = messages.slice(0, splitIndex)
    const toKeep = messages.slice(splitIndex)

    // Generate summary using small model
    const cfg = await resolveConfig(process.cwd())
    const provider = getProvider(cfg)
    const summaryText = await this.summarize(provider, toSummarize, this.opts.smallModel ?? cfg.smallModel?.modelID ?? DEFAULT_OPTIONS.smallModel)

    // Write summary file
    const summaryMsg = `# Session Summary\n\nGenerated at: ${new Date().toISOString()}\nOriginal messages: ${before}\nCompacted messages: ${toSummarize.length}\n\n${summaryText}`
    await log.writeSummary(summaryMsg)

    // Rewrite messages.jsonl: summary as first "system" message, then kept messages
    const summaryAsMessage = {
      id: crypto.randomUUID(),
      role: "system" as const,
      content: `[CONVERSATION SUMMARY]\n${summaryText}`,
      ts: Date.now()
    }
    const newContent = [JSON.stringify(summaryAsMessage), ...toKeep.map((m) => JSON.stringify(m))].join("\n") + "\n"
    const { writeFile } = await import("fs/promises")
    const { messagesPath } = await import("./paths.js")
    await writeFile(messagesPath(log.id), newContent, "utf-8")

    const summaryTokens = Token.estimate(summaryText)

    log.metadata.compacted = true
    log.metadata.messageCount = 1 + toKeep.length
    log.metadata.updatedAt = Date.now()

    await log.appendCompaction({
      at: Date.now(),
      beforeCount: before,
      afterCount: log.metadata.messageCount,
      summaryTokens
    })

    return { before, after: log.metadata.messageCount, summaryTokens }
  }

  private async summarize(provider: any, messages: Array<{ role: string; content: string }>, modelId: string): Promise<string> {
    const transcript = messages.map((m) => `[${m.role}] ${m.content}`).join("\n\n")
    const result = await provider.chat({
      model: modelId,
      messages: [
        { role: "system", content: SUMMARY_PROMPT },
        { role: "user", content: transcript }
      ],
      maxTokens: 2000,
      temperature: 0
    })
    return result.content
  }
}
```

### Step 5: Slash command parser

`packages/runtime/src/sessions/commands.ts`:

```ts
import { z } from "zod"

export const SlashCommandSchema = z.discriminatedUnion("name", [
  z.object({ name: z.literal("help") }),
  z.object({ name: z.literal("clear") }),
  z.object({ name: z.literal("compact") }),
  z.object({ name: z.literal("mode"), mode: z.enum(["plan", "build"]) }),
  z.object({ name: z.literal("agent"), agent: z.string() }),
  z.object({ name: z.literal("model"), model: z.string() }),
  z.object({ name: z.literal("mcp") }),
  z.object({ name: z.literal("lsp") }),
  z.object({ name: z.literal("skills") }),
  z.object({ name: z.literal("agents") }),
  z.object({ name: z.literal("reload") }),
  z.object({ name: z.literal("exit") }),
  z.object({ name: z.literal("sessions") }),
  z.object({ name: z.literal("resume"), sessionId: z.string() }),
  z.object({ name: z.literal("replay"), sessionId: z.string().optional() }),
  z.object({ name: z.literal("telemetry"), enabled: z.boolean() })
])
export type SlashCommand = z.infer<typeof SlashCommandSchema>

export function parseSlashCommand(input: string): SlashCommand | null {
  if (!input.startsWith("/")) return null
  const trimmed = input.slice(1).trim()
  const parts = trimmed.split(/\s+/)
  const cmd = parts[0]
  const rest = parts.slice(1)

  switch (cmd) {
    case "help":
      return { name: "help" }
    case "clear":
      return { name: "clear" }
    case "compact":
      return { name: "compact" }
    case "mode":
      if (rest[0] !== "plan" && rest[0] !== "build") return null
      return { name: "mode", mode: rest[0] }
    case "agent":
      if (!rest[0]) return null
      return { name: "agent", agent: rest[0] }
    case "model":
      if (!rest[0]) return null
      return { name: "model", model: rest[0] }
    case "mcp":
      return { name: "mcp" }
    case "lsp":
      return { name: "lsp" }
    case "skills":
      return { name: "skills" }
    case "agents":
      return { name: "agents" }
    case "reload":
      return { name: "reload" }
    case "exit":
      return { name: "exit" }
    case "sessions":
      return { name: "sessions" }
    case "resume":
      if (!rest[0]) return null
      return { name: "resume", sessionId: rest[0] }
    case "replay":
      return { name: "replay", sessionId: rest[0] }
    case "telemetry":
      return { name: "telemetry", enabled: rest[0] !== "off" }
    default:
      return null
  }
}

export function listSlashCommands(): Array<{ name: string; description: string; usage: string }> {
  return [
    { name: "help", description: "Show this help message", usage: "/help" },
    { name: "clear", description: "Clear the current screen", usage: "/clear" },
    { name: "compact", description: "Compact the conversation context", usage: "/compact" },
    { name: "mode", description: "Switch between plan and build mode", usage: "/mode plan|build" },
    { name: "agent", description: "Switch to a different agent", usage: "/agent <name>" },
    { name: "model", description: "Switch to a different model", usage: "/model <provider/model>" },
    { name: "mcp", description: "List MCP servers and their status", usage: "/mcp" },
    { name: "lsp", description: "Show available LSP servers", usage: "/lsp" },
    { name: "skills", description: "List available skills", usage: "/skills" },
    { name: "agents", description: "List available agents", usage: "/agents" },
    { name: "reload", description: "Reload config + skills + agents", usage: "/reload" },
    { name: "sessions", description: "List recent sessions", usage: "/sessions" },
    { name: "resume", description: "Resume an existing session", usage: "/resume <session-id>" },
    { name: "replay", description: "Replay a session against a different agent/model", usage: "/replay <session-id>" },
    { name: "telemetry", description: "Enable or disable telemetry", usage: "/telemetry on|off" },
    { name: "exit", description: "Exit the session", usage: "/exit" }
  ]
}

export function renderHelp(): string {
  const cmds = listSlashCommands()
  const maxName = Math.max(...cmds.map((c) => c.name.length))
  return [
    "Available slash commands:",
    "",
    ...cmds.map((c) => `  /${c.name.padEnd(maxName + 2)} ${c.description}\n    ${c.usage}`)
  ].join("\n")
}
```

### Step 6: Telemetry service (opt-in, PostHog-compatible)

`packages/runtime/src/telemetry/index.ts`:

```ts
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs"
import { join } from "path"
import { homedir } from "os"

const TELEMETRY_FILE = join(homedir(), ".kilocode", "telemetry.json")
const POSTHOG_ENDPOINT = "https://us.i.posthog.com/capture/" // overridable via env

export type TelemetryEvent =
  | { event: "session_start"; properties: { agent: string; model: string; cwd: string } }
  | { event: "message_sent"; properties: { sessionId: string; role: string; tokens?: number } }
  | { event: "tool_call"; properties: { sessionId: string; tool: string; durationMs: number; success: boolean } }
  | { event: "agent_spawn"; properties: { sessionId: string; agent: string; durationMs: number } }
  | { event: "session_end"; properties: { sessionId: string; durationMs: number; messageCount: number; totalTokens: number; totalCost: number } }
  | { event: "error"; properties: { sessionId?: string; message: string; stack?: string } }

export interface TelemetryConfig {
  enabled: boolean
  /** PostHog project API key (or self-hosted equivalent) */
  apiKey?: string
  /** Override the default endpoint for self-hosted PostHog */
  endpoint?: string
  /** Distinct ID for the current user (UUID generated on first run) */
  distinctId: string
}

export class TelemetryService {
  private config: TelemetryConfig
  private queue: Array<TelemetryEvent & { timestamp: string }> = []
  private flushing = false

  constructor(config?: Partial<TelemetryConfig>) {
    this.config = this.loadConfig(config)
  }

  private loadConfig(overrides?: Partial<TelemetryConfig>): TelemetryConfig {
    // Default: disabled, opt-in
    let stored: Partial<TelemetryConfig> = {}
    if (existsSync(TELEMETRY_FILE)) {
      try { stored = JSON.parse(readFileSync(TELEMETRY_FILE, "utf-8")) } catch { /* */ }
    } else {
      mkdirSync(join(homedir(), ".kilocode"), { recursive: true })
    }
    return {
      enabled: false,
      distinctId: stored.distinctId ?? crypto.randomUUID(),
      ...stored,
      ...overrides
    }
  }

  get enabled(): boolean { return this.config.enabled && !!this.config.apiKey }
  get distinctId(): string { return this.config.distinctId }

  setEnabled(enabled: boolean, apiKey?: string): void {
    this.config.enabled = enabled
    if (apiKey) this.config.apiKey = apiKey
    this.save()
  }

  private save(): void {
    writeFileSync(TELEMETRY_FILE, JSON.stringify(this.config, null, 2), { mode: 0o600 })
  }

  track(event: TelemetryEvent): void {
    if (!this.enabled) return
    this.queue.push({ ...event, timestamp: new Date().toISOString() })
    // Fire and forget — don't block the main loop
    queueMicrotask(() => this.flush())
  }

  /** Flush queued events to PostHog. Safe to call multiple times. */
  async flush(): Promise<void> {
    if (this.flushing || this.queue.length === 0 || !this.enabled) return
    this.flushing = true
    const batch = this.queue.splice(0, this.queue.length)

    try {
      const endpoint = this.config.endpoint ?? POSTHOG_ENDPOINT
      await Promise.allSettled(batch.map((evt) =>
        fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: this.config.apiKey,
            event: evt.event,
            distinct_id: this.config.distinctId,
            timestamp: evt.timestamp,
            properties: evt.properties
          })
        }).catch((err) => {
          // Silently drop; never let telemetry break the user
          console.error(`[telemetry] failed to send ${evt.event}:`, err)
        })
      ))
    } finally {
      this.flushing = false
    }
  }
}
```

### Step 7: Wire sessions, compaction, commands, telemetry into the agent loop

Update `packages/runtime/src/agent/loop.ts`:

```ts
import { SessionManager } from "../sessions/manager.js"
import { CompactionService } from "../sessions/compaction.js"
import { parseSlashCommand, renderHelp } from "../sessions/commands.js"
import { TelemetryService } from "../telemetry/index.js"

export async function runAgent(opts: RunAgentOptions) {
  const cfg = await resolveConfig(opts.cwd)
  const mcpRegistry = new MCPRegistry(cfg)
  await mcpRegistry.connectAll()

  const telemetry = new TelemetryService()
  telemetry.setEnabled(cfg.telemetry?.enabled ?? false, cfg.telemetry?.apiKey)

  const sessions = new SessionManager()
  const session = opts.sessionId
    ? await sessions.resume(opts.sessionId)
    : await sessions.create({ cwd: opts.cwd, agent: opts.agent, model: opts.model })

  const sessionStart = Date.now()
  telemetry.track({
    event: "session_start",
    properties: { agent: opts.agent, model: opts.model, cwd: opts.cwd }
  })

  const compaction = new CompactionService({ triggerTokens: cfg.compaction?.triggerTokens })

  // Load existing messages if resuming
  let messages = opts.sessionId ? await session.readAll() : []

  try {
    while (true) {
      // 1. Check for user input (CLI stdin or HTTP message)
      const input = await opts.nextInput()
      if (input === null) break // session ended

      // 2. Slash command?
      const slash = parseSlashCommand(input)
      if (slash) {
        await handleSlashCommand(slash, { session, sessions, cfg, mcpRegistry, telemetry })
        continue
      }

      // 3. Compact if needed
      if (compaction.shouldCompact(session, messages.length)) {
        const result = await compaction.compact(session)
        opts.onSystemMessage?.(`compacted: ${result.before} → ${result.after} messages (${result.summaryTokens} summary tokens)`)
        messages = await session.readAll()
      }

      // 4. Append user message
      const userMsg = { id: crypto.randomUUID(), role: "user" as const, content: input, ts: Date.now() }
      await session.append(userMsg)
      messages.push(userMsg)

      // 5. Run LLM with tools
      const turnStart = Date.now()
      const result = await runTurn({ messages, tools, model: opts.model, onText: opts.onText, onTool: opts.onTool, onToolResult: opts.onToolResult })
      const turnEnd = Date.now()

      // 6. Persist assistant message + tool calls/results
      for (const msg of result.messages) {
        await session.append(msg)
        messages.push(msg)
      }

      telemetry.track({
        event: "message_sent",
        properties: { sessionId: session.id, role: "assistant", tokens: result.tokens }
      })
    }
  } finally {
    telemetry.track({
      event: "session_end",
      properties: {
        sessionId: session.id,
        durationMs: Date.now() - sessionStart,
        messageCount: messages.length,
        totalTokens: messages.reduce((sum, m) => sum + ((m as any).tokens ?? 0), 0),
        totalCost: 0 // TODO: track token cost
      }
    })
    await telemetry.flush()
    await mcpRegistry.disconnectAll()
  }
}

async function handleSlashCommand(cmd: ReturnType<typeof parseSlashCommand> & object, ctx: any): Promise<void> {
  if (!cmd) return
  switch (cmd.name) {
    case "help":
      console.log(renderHelp())
      break
    case "compact": {
      const compaction = new CompactionService()
      const result = await compaction.compact(ctx.session)
      console.log(`compacted: ${result.before} → ${result.after} messages`)
      break
    }
    case "mode":
      ctx.cfg.mode = cmd.mode
      console.log(`switched to ${cmd.mode} mode`)
      break
    case "agent":
      ctx.session.metadata.agent = cmd.agent
      console.log(`switched to agent: ${cmd.agent}`)
      break
    case "model":
      ctx.session.metadata.model = cmd.model
      console.log(`switched to model: ${cmd.model}`)
      break
    case "mcp":
      console.log(JSON.stringify(ctx.mcpRegistry.listServers(), null, 2))
      break
    case "sessions": {
      const list = await ctx.sessions.list()
      console.table(list.map((s: any) => ({
        id: s.id.slice(0, 8),
        title: s.title,
        agent: s.agent,
        model: s.model,
        messages: s.messageCount,
        updated: new Date(s.updatedAt).toLocaleString()
      })))
      break
    }
    case "telemetry":
      ctx.telemetry.setEnabled(cmd.enabled)
      console.log(`telemetry ${cmd.enabled ? "enabled" : "disabled"}`)
      break
    // ... other commands
  }
}
```

### Step 8: Add CLI subcommands for replay/resume/sessions

Add to `packages/cli/src/index.ts`:

```ts
program
  .command("sessions")
  .description("List recent sessions")
  .option("-n, --limit <n>", "Number of sessions to show", "20")
  .action(async (opts) => {
    const { sessionsCommand } = await import("./commands/sessions.js")
    await sessionsCommand({ limit: parseInt(opts.limit, 10) })
  })

program
  .command("resume")
  .description("Resume an existing session")
  .argument("<session-id>", "Session ID")
  .action(async (sessionId) => {
    const { resumeCommand } = await import("./commands/resume.js")
    await resumeCommand({ sessionId })
  })

program
  .command("replay")
  .description("Replay a session with a different agent or model")
  .argument("<session-id>", "Source session ID")
  .option("-a, --agent <agent>", "New agent")
  .option("-m, --model <model>", "New model")
  .action(async (sessionId, opts) => {
    const { replayCommand } = await import("./commands/replay.js")
    await replayCommand({ sessionId, ...opts })
  })
```

`packages/cli/src/commands/sessions.ts`:

```ts
import { SessionManager } from "@kilocode/runtime/sessions/manager"
import { homedir } from "os"
import { join } from "path"

export async function sessionsCommand(opts: { limit: number }) {
  const mgr = new SessionManager()
  const list = await mgr.list(opts.limit)
  if (list.length === 0) {
    console.log("No sessions yet. Run `kilo run \"hello\"` to create one.")
    return
  }
  console.log(`${list.length} most recent sessions (stored at ~/.kilocode/sessions/):\n`)
  for (const s of list) {
    const ago = humanizeAgo(Date.now() - s.updatedAt)
    console.log(`${s.id.slice(0, 8)}  ${ago.padEnd(12)} ${s.title ?? s.id}`)
    console.log(`           ${s.agent} / ${s.model} · ${s.messageCount} messages${s.compacted ? " · compacted" : ""}`)
  }
}

function humanizeAgo(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}
```

`packages/cli/src/commands/resume.ts`:

```ts
import { SessionManager } from "@kilocode/runtime/sessions/manager"
import { runAgent } from "@kilocode/runtime/agent/loop"

export async function resumeCommand(opts: { sessionId: string }) {
  const mgr = new SessionManager()
  const log = await mgr.resume(opts.sessionId)
  console.log(`resuming session ${opts.sessionId} (${log.metadata.title ?? "untitled"})`)
  console.log(`agent=${log.metadata.agent} model=${log.metadata.model} cwd=${log.metadata.cwd}`)
  await runAgent({
    cwd: log.metadata.cwd,
    sessionId: opts.sessionId,
    agent: log.metadata.agent,
    model: log.metadata.model,
    onText: (t) => process.stdout.write(t),
    onTool: (c) => console.error(`[${c.name}] ${JSON.stringify(c.input).slice(0, 100)}`),
    onToolResult: (id, r) => { /* */ },
    nextInput: readStdinInput
  })
}

async function* readStdinInput() {
  for await (const line of console) yield line
}
```

`packages/cli/src/commands/replay.ts`:

```ts
import { SessionManager } from "@kilocode/runtime/sessions/manager"

export async function replayCommand(opts: { sessionId: string; agent?: string; model?: string }) {
  const mgr = new SessionManager()
  const newSession = await mgr.replay(opts.sessionId, { agent: opts.agent, model: opts.model })
  console.log(`replay created new session ${newSession.id}`)
  console.log(`run: kilo resume ${newSession.id}`)
}
```

### Step 9: Add `telemetry` block to `kilo.json` schema

Update `packages/runtime/src/config/schema.ts`:

```ts
export const KiloConfigSchema = z.object({
  // ... existing fields
  telemetry: z.object({
    enabled: z.boolean().default(false),
    apiKey: z.string().optional(), // PostHog project API key
    endpoint: z.string().url().optional() // Self-hosted override
  }).strict().optional(),
  compaction: z.object({
    triggerTokens: z.number().int().positive().default(100_000),
    keepRecentTurns: z.number().int().nonnegative().default(2)
  }).strict().optional()
}).strict()
```

### Step 10: End-to-end smoke test

`packages/cli/src/__tests__/e2e.smoke.test.ts`:

```ts
import { describe, test, expect } from "bun:test"
import { spawn } from "bun"
import { join } from "path"

const CLI = join(import.meta.dir, "../index.ts")

describe("end-to-end smoke test (v0.1.0)", () => {
  test("kilo --help shows all commands", async () => {
    const proc = spawn({ cmd: ["bun", "run", CLI, "--help"], stdout: "pipe", stderr: "pipe" })
    const out = await new Response(proc.stdout).text()
    await proc.exited
    expect(out).toContain("run")
    expect(out).toContain("serve")
    expect(out).toContain("sessions")
    expect(out).toContain("resume")
    expect(out).toContain("replay")
  }, { timeout: 30_000 })

  test("kilo version prints 0.1.0", async () => {
    const proc = spawn({ cmd: ["bun", "run", CLI, "version"], stdout: "pipe" })
    const out = await new Response(proc.stdout).text()
    await proc.exited
    expect(out).toMatch(/v?0\.1\.0/)
  }, { timeout: 10_000 })

  test("kilo sessions lists sessions (empty if none)", async () => {
    const proc = spawn({ cmd: ["bun", "run", CLI, "sessions", "-n", "5"], stdout: "pipe", stderr: "pipe" })
    const out = await new Response(proc.stdout).text()
    await proc.exited
    expect(out).toMatch(/session|No sessions/)
  }, { timeout: 10_000 })
})
```

### Step 11: Final README.md

`README.md`:

````markdown
# LadeStack Kilo Assistant

> Open-source AI coding agent — Kilo Code clone + 12 specialized DevOps agents + 8 curated skill bundles.

LadeStack Kilo Assistant is an AI coding assistant that runs in your terminal or as a server. It supports 500+ LLM models via Vercel AI SDK (Claude, GPT-4, Gemini, Llama, Mistral, and more), uses your own API keys (BYOK), and ships with **12 built-in agents** + **8 skill bundles** covering programming, DevOps, code review, testing, AI/ML, security, performance, and accessibility.

## Quickstart

```bash
# Install Bun (if you don't have it)
curl -fsSL https://bun.sh/install | bash

# Clone and install
git clone https://github.com/your-org/ladestack-kilo.git
cd ladestack-kilo
bun install

# Set your API key
bun run kilo auth anthropic sk-ant-...

# Run a one-shot task
bun run kilo run "explain what this file does: src/index.ts"

# Start the interactive server (for web UI / IDE plugins)
bun run kilo serve

# Or interactive REPL
bun run kilo
```

## Commands

| Command | Description |
|---|---|
| `kilo run "..."` | Run a single prompt in the current directory |
| `kilo serve` | Start HTTP server with SSE for web/IDE clients |
| `kilo auth <provider> <key>` | Set/clear BYOK API keys |
| `kilo sessions` | List recent sessions |
| `kilo resume <id>` | Resume an existing session |
| `kilo replay <id>` | Replay a session against a different agent/model |
| `kilo mcp [name]` | List/inspect MCP servers |
| `kilo lsp [file]` | Show LSP diagnostics or list servers |
| `kilo version` | Show version |

## Slash commands (interactive mode)

| Command | Description |
|---|---|
| `/help` | Show all slash commands |
| `/mode plan\|build` | Switch between plan (read-only) and build (with edits) modes |
| `/agent <name>` | Switch to a different agent |
| `/model <provider/model>` | Switch to a different model |
| `/compact` | Compact the conversation context |
| `/mcp` | List MCP servers and their status |
| `/lsp` | List available LSP servers |
| `/skills` | List available skills |
| `/agents` | List available agents |
| `/sessions` | List recent sessions |
| `/resume <id>` | Resume a different session |
| `/reload` | Reload config + skills + agents |
| `/telemetry on\|off` | Toggle telemetry |

## Configuration

Drop a `kilo.json` (or `kilo.jsonc`) in your project root:

```jsonc
{
  "$schema": "https://ladestack.dev/config.schema.json",
  "model": { "providerID": "anthropic", "modelID": "claude-sonnet-4-5" },
  "smallModel": { "providerID": "anthropic", "modelID": "claude-3-5-haiku-20241022" },
  "defaultAgent": "build",
  "mode": "plan",
  "provider": {
    "anthropic": { "apiKey": "sk-ant-..." },
    "openai": { "apiKey": "sk-..." }
  },
  "mcp": {
    "filesystem": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
    },
    "github": {
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp/",
      "headers": { "Authorization": "Bearer ghp_..." }
    }
  },
  "telemetry": { "enabled": false }
}
```

See `docs/configuration.md` for the full schema.

## Architecture

- **4 packages**: `cli` (binary), `server` (HTTP+SSE), `runtime` (agent core), `sdk` (client)
- **12 built-in agents**: build, plan, explore, code-reviewer, security-reviewer, scout, summarize, title, k8s-ops, terraform-ops, ci-cd-ops, monitoring-ops
- **8 skill bundles**: programming, devops, coder-productivity, ai-ml, security, performance, accessibility, git-workflows
- **MCP**: full client with stdio + SSE + streamable-HTTP + OAuth 2.1
- **LSP**: TypeScript, Python, Rust, Go, JSON servers with diagnostics injection
- **Sessions**: append-only JSONL persistence with replay/resume
- **Telemetry**: opt-in PostHog-compatible (off by default)

## License

MIT — see LICENSE.
````

### Step 12: CHANGELOG.md

`CHANGELOG.md`:

```markdown
# Changelog

All notable changes to LadeStack Kilo Assistant are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - 2026-06-22

### Added

**Core runtime**
- Bun + TypeScript + Effect monorepo with 4 packages (cli, server, runtime, sdk)
- `kilo` CLI binary with `run`, `serve`, `auth`, `sessions`, `resume`, `replay`, `mcp`, `lsp`, `version` subcommands
- Hono-based HTTP server with SSE streaming (`kilo serve`)
- `kilo.json` / `kilo.jsonc` config with Zod validation
- Discovery for `.kilo/`, `.kilocode/`, `.opencode/`, `.claude/`, `.agents/` directories
- Token-based auth middleware for the local HTTP server

**Providers & BYOK**
- Multi-provider abstraction via Vercel AI SDK (Anthropic, OpenAI, Google, OpenRouter, Groq, Mistral, xAI, DeepSeek, Bedrock — 500+ models)
- BYOK encryption with AES-256-GCM (keys stored at `~/.kilocode/keys/`)
- Env-var fallback (ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY)

**Tool system**
- Tool registry pattern with `.ts` + `.txt` pair convention
- Filesystem tools: read, write, edit (with read-before-write safety)
- Search tools: glob, grep (ripgrep-backed)
- Bash tool with deny-list safety
- Meta tools: todowrite, question
- Plan-mode tools: plan_enter, plan_write, plan_exit
- Specialty tools: apply_patch, recall, lsp_*, websearch

**Agent system**
- 12 built-in agents (build, plan, explore, code-reviewer, security-reviewer, scout, summarize, title, k8s-ops, terraform-ops, ci-cd-ops, monitoring-ops)
- Agent execution loop: prompt → LLM → tools → repeat
- Multi-agent subagents with hierarchical spawning
- Wave-based orchestrator for parallel dispatch

**Skills**
- Skills discovery service scanning `.kilo/`, `.claude/`, `.agents/`, and bundled paths
- 4 skill bundles (programming, DevOps, coder-productivity, AI/ML + security + perf + a11y + git)

**Integrations**
- **MCP client** (Model Context Protocol): stdio, SSE, and streamable-HTTP transports; full OAuth 2.1 + PKCE flow; dynamic client registration; token persistence at `~/.kilocode/mcp-auth/`
- **LSP client** (Language Server Protocol): TypeScript (`typescript-language-server`), Python (`pyright-langserver`), Rust (`rust-analyzer`), Go (`gopls`), JSON, Java; hover, completion, go-to-definition, references, symbols, code actions, format; auto-injection of compile errors back into agent context

**Sessions & telemetry**
- Append-only JSONL session persistence at `~/.kilocode/sessions/<id>/`
- `kilo sessions` / `kilo resume <id>` / `kilo replay <id>`
- Context compaction (auto + `/compact`) when tokens exceed 100K
- Slash commands: /help, /clear, /compact, /mode, /agent, /model, /mcp, /lsp, /skills, /agents, /sessions, /resume, /reload, /telemetry, /exit
- Opt-in PostHog-compatible telemetry (off by default)

### Technical
- ~12,000 lines of TypeScript across 4 packages
- All builds pass `bun run typecheck`, `bun run lint`, `bun run build`
- Unit + integration tests in `__tests__/` directories
- No external API calls during tests (mocks throughout)
```

### Step 13: Tag v0.1.0

```bash
cd kilocode-assistant

# Verify everything builds and tests pass
bun install
bun run typecheck
bun run lint
bun run build
bun test

# Stage the v0.1.0 deliverables
git add -A
git commit -m "feat: v0.1.0 release (prompts 23-25 complete)

- MCP client (stdio/SSE/HTTP + OAuth 2.1)
- LSP integration (TypeScript/Python/Rust/Go/JSON)
- Session persistence (JSONL) + replay/resume
- Context compaction + slash commands
- Opt-in telemetry (PostHog-compatible)
- Final README + CHANGELOG"

# Tag
git tag -a v0.1.0 -m "LadeStack Kilo Assistant v0.1.0

First public release. Includes 12 agents, 8 skill bundles,
MCP client, LSP client, session persistence, and compaction."

# Push
git push origin main --tags
```

### Step 14: Update INDEX.md

Append to `C:\Hermes Documents\ladestack-build-documentation\ai-assistant-build-prompts\INDEX.md`:

```markdown
## Status: v0.1.0 RELEASED 🎉

All 25 prompts are complete. The build yields a working, MIT-licensed AI coding assistant.

### Build artifacts
- `kilocode-assistant/` — Bun monorepo, ~12K lines of TS
- `packages/cli/` — `kilo` binary (8 subcommands)
- `packages/server/` — Hono HTTP+SSE server
- `packages/runtime/` — Agent core (MCP + LSP + sessions + telemetry)
- `packages/sdk/` — Auto-generated client SDK

### Verification
```bash
cd kilocode-assistant
bun install
bun run typecheck && bun run lint && bun test && bun run build
bun run kilo --help    # shows 8 subcommands
bun run kilo version   # prints v0.1.0
```
```

## Files created

```
packages/runtime/src/sessions/
├── paths.ts
├── log.ts
├── manager.ts
├── compaction.ts
└── commands.ts

packages/runtime/src/telemetry/
└── index.ts

packages/cli/src/commands/
├── sessions.ts
├── resume.ts
└── replay.ts

README.md
CHANGELOG.md
```

## Acceptance criteria

- [ ] `SessionLog.append` writes JSONL line and updates metadata atomically
- [ ] `SessionManager.create/resume/list/delete` all work
- [ ] `SessionManager.replay` creates a new session with the same user prompts
- [ ] `CompactionService.compact` reduces message count and writes `summary.md`
- [ ] Auto-compaction triggers when estimated tokens exceed 100K
- [ ] All slash commands parse correctly and execute their handler
- [ ] `/help` renders a formatted command list
- [ ] `/telemetry on|off` enables/disables telemetry and persists config
- [ ] `TelemetryService.track` sends events to PostHog when enabled
- [ ] Telemetry is OFF by default — `kilo` works without any telemetry setup
- [ ] `kilo sessions` lists recent sessions with metadata
- [ ] `kilo resume <id>` continues an existing session
- [ ] `kilo replay <id>` creates a new session from an old one's user prompts
- [ ] MCP tools are registered into the agent's tool map (from prompt 23)
- [ ] LSP diagnostics are auto-injected into context after edits (from prompt 24)
- [ ] End-to-end smoke test passes: `bun test packages/cli/src/__tests__/e2e.smoke.test.ts`
- [ ] README.md is comprehensive with quickstart + commands
- [ ] CHANGELOG.md documents v0.1.0
- [ ] `git tag v0.1.0` exists; `git log --oneline | head -1` shows the release commit

## Verification

```bash
cd kilocode-assistant

# Build everything
bun install
bun run typecheck && bun run lint && bun test && bun run build

# Smoke tests
bun run kilo version
# Expected: v0.1.0

bun run kilo --help
# Expected: shows run, serve, auth, sessions, resume, replay, mcp, lsp, version

bun run kilo sessions
# Expected: "No sessions yet." (or list if you've used kilo)

# Manual end-to-end (in a test project)
mkdir -p /tmp/kilo-final && cd /tmp/kilo-final
cat > kilo.json <<'EOF'
{
  "model": { "providerID": "anthropic", "modelID": "claude-sonnet-4-5" },
  "agent": { "build": { "prompt": "You are a helpful coding assistant." } }
}
EOF
export ANTHROPIC_API_KEY=sk-ant-...
bun run /path/to/kilocode-assistant/packages/cli/src/index.ts run "what is 2+2?"
# Expected: streams a response, creates session, exits

ls ~/.kilocode/sessions/
# Expected: one directory with a UUID name

bun run /path/to/kilocode-assistant/packages/cli/src/index.ts sessions
# Expected: shows the session with title, agent, model, message count

bun run /path/to/kilocode-assistant/packages/cli/src/index.ts replay <id>
# Expected: creates new session id

# Tag check
git tag -l v0.1.0
# Expected: v0.1.0

git log --oneline | head -5
# Expected: feat: v0.1.0 release (prompts 23-25 complete)
```

Expected final state:
- All 4 packages build cleanly
- 25 prompts × ~500 lines each = ~12K lines of TypeScript
- `kilo run`, `kilo serve`, `kilo auth`, `kilo sessions`, `kilo resume`, `kilo replay`, `kilo mcp`, `kilo lsp` all functional
- 12 agents, 8 skill bundles discoverable
- MCP and LSP wired into agent loop
- Sessions persist to `~/.kilocode/sessions/<id>/`
- Context compaction works
- Slash commands parse and dispatch
- Telemetry off by default, opt-in via config or `/telemetry on`

## Notes

- **JSONL append-only** — chosen for resilience and simplicity. Each line is independently valid; corruption in one line doesn't lose the rest. Compared to SQLite (Kilo's choice), JSONL is easier to debug, version-control, and replay.
- **Atomic file writes** — every metadata write is `write-temp + rename` to avoid leaving partial JSON on crash. Standard Unix pattern.
- **Compaction threshold: 100K tokens** — roughly the 128K context of Claude 3.5 Sonnet minus headroom for the response. Adjustable via `compaction.triggerTokens` in config.
- **Small model for summarization** — defaults to `claude-3-5-haiku` for cost. If unset in config, falls back to `cfg.smallModel`.
- **Replay vs resume** — replay re-executes the user prompts against a NEW agent/model (re-derives answers); resume just continues the existing conversation with full message history.
- **`/compact` returns immediately if the session is short** — we don't compact fewer than 3 user turns (would lose more than it saves).
- **Telemetry is opt-in AND requires an API key** — without both, `track()` is a no-op. The `distinctId` is generated on first run (UUID) and persisted.
- **Telemetry never blocks the main loop** — `queueMicrotask` defers sends; if PostHog is unreachable, the event is dropped silently.
- **HTTP server token** — preserved from prompt 02 (`~/.kilocode/server-token`). For v1.0 production, replace with OAuth/JWT.
- **Slash commands in interactive mode only** — for `kilo run "..."` (one-shot), slash commands are not parsed (no REPL).
- **`/reload`** re-reads `kilo.json`, re-scans `.kilo/` directories, re-creates the MCP registry. Useful when editing config mid-session.
- **`/exit`** is a hint to the loop; the CLI exits via `process.exit(0)`.
- **The 100K-token compaction threshold is per-session, not global.** If you spawn 10 subagents in parallel, each has its own session that compacts independently.
- **No real network calls during testing** — all tests use mock providers and embedded MCP servers. The e2e smoke test only verifies CLI plumbing.
- **`/telemetry on` prompts for the API key** if not set. Key is stored in `~/.kilocode/telemetry.json` with `0o600` permissions.
- **PostHog endpoint is overridable** — set `telemetry.endpoint` in config for self-hosted PostHog, Plausible, or any other endpoint that accepts the same payload format.
- **The 12 agents + 8 bundles** are defined across prompts 14 and 19-22. This prompt assumes they're already in place.
- **Reference**: Kilo Code uses SQLite for sessions (see `packages/opencode/src/session/session.sql.ts`). We chose JSONL for portability — the trade-off is slower queries on large histories (we don't query, we replay sequentially).
- **Reference**: Kilo's `packages/opencode/src/session/compaction.ts` (749 lines) implements a sophisticated token-budget-aware compaction. Our prompt's version is simpler (fixed threshold, fixed keep-recent) — adequate for v0.1.0, Kilo's version is the v1.0 target.
- **Self-hosting** — there's no SaaS component. Everything runs locally. Telemetry is the only optional outbound network call, and it's off by default.
- **Final design decisions**:
  - One binary (`kilo`) with subcommands beats separate `kilo-serve`, `kilo-run` binaries (Kilo uses one binary too).
  - JSONL over SQLite — easier to grep, diff, and replay.
  - Effect framework imported but not used in agent loop — we kept the loop straightforward with async/await. v1.0 can refactor to Effect for better cancellation/retries.
  - No daemon mode (yet) — `kilo serve` runs in foreground; use systemd/Docker for production.
  - No streaming cancel button in CLI — process kill (Ctrl-C) is the only way. Web UI gets a cancel button via SSE disconnect.

## 🎉 Project complete — v0.1.0 shipped
