# Prompt 02: CLI Entry Point + HTTP Server

## Goal

Build the `kilo` CLI binary with subcommands (`run`, `serve`, `auth`, `version`) AND a Hono-based HTTP server with SSE endpoint for sessions — mirroring Kilo Code's `packages/opencode/src/cli/` and `packages/opencode/src/server/`.

## Context (from prompt 01)

- Monorepo bootstrapped with Bun + TS + Effect
- 4 stub packages: `@kilocode/cli`, `@kilocode/server`, `@kilocode/runtime`, `@kilocode/sdk`
- No source code yet

Reference: `../../02-competitive-research.md` §3 (Kilo Code's `kilo` binary + `kilo serve` architecture).

## Task

### Step 1: CLI structure

`packages/cli/src/index.ts`:

```ts
#!/usr/bin/env bun
import { Command } from "commander"
import pkg from "../package.json" with { type: "json" }

const program = new Command()
  .name("kilo")
  .description("Open-source AI coding agent")
  .version(pkg.version)

program
  .command("run")
  .description("Run a single prompt in the current directory")
  .argument("[prompt...]", "Prompt to send (omit for interactive)")
  .option("-m, --model <model>", "Model ID", "anthropic/claude-sonnet-4-5")
  .option("-a, --agent <agent>", "Agent name", "build")
  .option("--plan", "Use plan mode (read-only first, then build)")
  .option("--no-commit", "Skip auto-commit of changes")
  .action(async (promptParts: string[], opts) => {
    const prompt = promptParts.join(" ").trim()
    const { runCommand } = await import("./commands/run.js")
    await runCommand({ prompt, ...opts })
  })

program
  .command("serve")
  .description("Start HTTP server for remote clients (web UI, VS Code)")
  .option("-p, --port <port>", "Port to listen on", "3000")
  .option("--host <host>", "Host to bind", "127.0.0.1")
  .action(async (opts) => {
    const { serveCommand } = await import("./commands/serve.js")
    await serveCommand(opts)
  })

program
  .command("auth")
  .description("Manage BYO API keys")
  .argument("<provider>", "Provider (anthropic|openai|google)")
  .argument("[key]", "API key (omit to read from stdin or remove)")
  .action(async (provider, key) => {
    const { authCommand } = await import("./commands/auth.js")
    await authCommand({ provider, key })
  })

program
  .command("version")
  .description("Show version")
  .action(() => {
    console.log(`kilo v${pkg.version}`)
  })

program.parseAsync(process.argv).catch((err) => {
  console.error(err)
  process.exit(1)
})
```

Install commander:
```bash
cd packages/cli && bun add commander
```

### Step 2: `run` command — entry for one-shot prompts

`packages/cli/src/commands/run.ts`:

```ts
import { resolveConfig } from "@kilocode/runtime/config"
import { runSession } from "@kilocode/runtime/agent"

export async function runCommand(opts: {
  prompt: string
  model: string
  agent: string
  plan?: boolean
  commit?: boolean
}) {
  const cfg = await resolveConfig(process.cwd())
  const session = await runSession({
    cwd: process.cwd(),
    config: cfg,
    message: opts.prompt,
    agent: opts.agent,
    model: opts.model,
    planMode: opts.plan ?? cfg.mode === "plan",
    onText: (text) => process.stdout.write(text),
    onTool: (call) => console.error(`[${call.name}] ${JSON.stringify(call.input)}`),
    onDone: () => process.exit(0)
  })
}
```

### Step 3: `serve` command — start HTTP server

`packages/cli/src/commands/serve.ts`:

```ts
import { startServer } from "@kilocode/server"

export async function serveCommand(opts: { port: string; host: string }) {
  await startServer({
    port: parseInt(opts.port, 10),
    host: opts.host
  })
  console.log(`kilo serve listening on http://${opts.host}:${opts.port}`)
}
```

### Step 4: `auth` command — manage BYO keys

`packages/cli/src/commands/auth.ts`:

```ts
import { setKey, clearKey, listKeys } from "@kilocode/runtime/auth"
import { createInterface } from "readline"

export async function authCommand(opts: { provider: string; key?: string }) {
  if (!["anthropic", "openai", "google"].includes(opts.provider)) {
    console.error(`unknown provider: ${opts.provider}`)
    process.exit(1)
  }
  if (opts.key === undefined) {
    // Read from stdin if no arg
    const rl = createInterface({ input: process.stdin })
    const lines: string[] = []
    for await (const line of rl) lines.push(line)
    opts.key = lines.join("").trim()
  }
  if (opts.key === "") {
    await clearKey(opts.provider as "anthropic" | "openai" | "google")
    console.log(`cleared ${opts.provider} key`)
  } else {
    await setKey(opts.provider as "anthropic" | "openai" | "google", opts.key)
    console.log(`saved ${opts.provider} key (last 4: ...${opts.key.slice(-4)})`)
  }
}
```

### Step 5: HTTP server with SSE

Install Hono:
```bash
cd packages/server && bun add hono @hono/node-server
```

`packages/server/src/index.ts`:

```ts
import { Hono } from "hono"
import { serve } from "@hono/node-server"
import { streamSSE } from "hono/streaming"
import { authMiddleware } from "./middleware/auth.js"
import { sessionRoutes } from "./routes/sessions.js"
import { healthRoutes } from "./routes/health.js"

export async function startServer(opts: { port: number; host: string }) {
  const app = new Hono()
    .use("*", async (c, next) => {
      // CORS for web clients
      c.header("Access-Control-Allow-Origin", "*")
      c.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
      c.header("Access-Control-Allow-Headers", "Content-Type, Authorization")
      if (c.req.method === "OPTIONS") return c.text("", 204)
      return next()
    })
    .route("/health", healthRoutes)
    .route("/api/sessions", authMiddleware, sessionRoutes)

  return serve({ fetch: app.fetch, port: opts.port, hostname: opts.host })
}
```

### Step 6: Health route

`packages/server/src/routes/health.ts`:

```ts
import { Hono } from "hono"

export const healthRoutes = new Hono()
  .get("/", (c) => c.json({ status: "ok", version: "0.0.0", uptime: process.uptime() }))
```

### Step 7: Auth middleware (token-based for local CLI)

`packages/server/src/middleware/auth.ts`:

```ts
import { createMiddleware } from "hono/factory"
import { readFileSync, existsSync } from "fs"
import { join } from "path"
import { homedir } from "os"

const TOKEN_PATH = join(homedir(), ".kilocode", "server-token")

function getToken(): string {
  if (existsSync(TOKEN_PATH)) return readFileSync(TOKEN_PATH, "utf-8").trim()
  // Generate new token on first start
  const token = crypto.randomUUID()
  require("fs").mkdirSync(join(homedir(), ".kilocode"), { recursive: true })
  require("fs").writeFileSync(TOKEN_PATH, token)
  return token
}

export const authMiddleware = createMiddleware(async (c, next) => {
  const token = c.req.header("Authorization")?.replace("Bearer ", "")
  const expected = getToken()
  if (token !== expected) {
    return c.json({ error: "unauthorized" }, 401)
  }
  return next()
})
```

### Step 8: Sessions route (stub for now, full impl in prompt 15+)

`packages/server/src/routes/sessions.ts`:

```ts
import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { runSession } from "@kilocode/runtime/agent"

export const sessionRoutes = new Hono()
  .get("/", async (c) => {
    return c.json({ sessions: [] })  // list — wired in prompt 25
  })
  .post("/", async (c) => {
    const body = await c.req.json<{ cwd: string; message: string }>()
    const sessionId = crypto.randomUUID()
    return c.json({ id: sessionId, cwd: body.cwd }, 201)
  })
  .post("/:id/messages", async (c) => {
    const sessionId = c.req.param("id")
    const body = await c.req.json<{ message: string; agent?: string; model?: string }>()

    return streamSSE(c, async (stream) => {
      await runSession({
        cwd: process.cwd(),
        sessionId,
        message: body.message,
        agent: body.agent ?? "build",
        model: body.model,
        onText: async (text) => stream.writeSSE({ event: "text_delta", data: text }),
        onTool: async (call) => stream.writeSSE({ event: "tool_start", data: call }),
        onToolResult: async (id, result) => stream.writeSSE({ event: "tool_end", data: { id, result } }),
        onDone: async () => stream.writeSSE({ event: "done", data: { ok: true } })
      })
    })
  })
  .delete("/:id", async (c) => c.json({ deleted: c.req.param("id") }))
```

### Step 6: Stub runtime imports

`packages/runtime/src/index.ts` (placeholder so CLI compiles):

```ts
// Real implementation in prompts 13-17
export async function runSession(_opts: any): Promise<any> {
  console.error("[runtime] not yet implemented — see prompt 15")
  process.exit(1)
}
```

`packages/runtime/src/config.ts`:

```ts
export async function resolveConfig(_cwd: string): Promise<any> {
  return { mode: "build" }
}
```

`packages/runtime/src/auth.ts`:

```ts
// Real impl in prompt 05
export async function setKey(_p: string, _k: string) {}
export async function clearKey(_p: string) {}
```

### Step 7: Wire workspace dependencies

In `packages/cli/package.json`:
```json
{
  "dependencies": {
    "@kilocode/runtime": "workspace:*",
    "@kilocode/server": "workspace:*",
    "commander": "^12.0.0"
  }
}
```

In `packages/server/package.json`:
```json
{
  "dependencies": {
    "@kilocode/runtime": "workspace:*",
    "hono": "^4.0.0",
    "@hono/node-server": "^1.0.0"
  }
}
```

In `packages/runtime/package.json`:
```json
{
  "dependencies": {
    "effect": "^3.10.0",
    "ai": "^3.0.0",
    "@ai-sdk/anthropic": "^0.0.50",
    "@ai-sdk/openai": "^0.0.50",
    "@ai-sdk/google": "^0.0.50",
    "zod": "^3.22.0"
  }
}
```

### Step 8: Wire path resolution in `tsconfig.base.json`

```json
{
  "compilerOptions": {
    "paths": {
      "@kilocode/cli": ["./packages/cli/src/index.ts"],
      "@kilocode/server": ["./packages/server/src/index.ts"],
      "@kilocode/runtime/*": ["./packages/runtime/src/*"],
      "@kilocode/sdk/*": ["./packages/sdk/src/*"]
    }
  }
}
```

### Step 9: Add a `bin` field to CLI

In `packages/cli/package.json`:
```json
{
  "bin": { "kilo": "./src/index.ts" }
}
```

Add scripts to root `package.json`:
```json
{
  "scripts": {
    "kilo": "bun run packages/cli/src/index.ts"
  }
}
```

### Step 10: Commit

```bash
git add -A
git commit -m "feat(cli,server): kilo CLI + HTTP/SSE server (prompt 02)"
```

## Files created

```
packages/cli/src/
├── index.ts
└── commands/
    ├── run.ts
    ├── serve.ts
    └── auth.ts

packages/server/src/
├── index.ts
├── middleware/auth.ts
└── routes/
    ├── health.ts
    └── sessions.ts

packages/runtime/src/
├── index.ts
├── config.ts
└── auth.ts
```

## Acceptance criteria

- [ ] `bun run kilo --help` shows command list
- [ ] `bun run kilo version` shows version
- [ ] `bun run kilo serve` starts HTTP server on port 3000
- [ ] `curl localhost:3000/health` returns 200
- [ ] `bun run kilo auth anthropic sk-test-...` saves key
- [ ] `POST /api/sessions` returns a session ID
- [ ] `POST /api/sessions/:id/messages` (without token) returns 401
- [ ] `POST /api/sessions/:id/messages` (with token) streams SSE events

## Verification

```bash
cd kilocode-assistant
bun install
bun run kilo --help
bun run kilo serve &
sleep 2
curl http://localhost:3000/health
TOKEN=$(cat ~/.kilocode/server-token)
curl -X POST http://localhost:3000/api/sessions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"cwd":"/tmp","message":"test"}'
kill %1
```

## Notes

- **Token auth** is a one-time generated UUID stored at `~/.kilocode/server-token`. Sufficient for local-first; OAuth is v2.
- **`runSession` is stubbed.** Prompts 13-17 implement it. For now it just exits with an error.
- **SSE events use Hono's `streamSSE`** — standard format, easy for web clients to consume.
- **Path mappings in tsconfig** let you import across packages without building first (Bun resolves at runtime).
- **`--no-commit`** option reserved for v1.1 — auto-commit after AI edits.
- **`bun run kilo`** from anywhere in the repo runs the CLI via Bun's workspace resolution.
- **`streamSSE` requires Honoclient compatible with streaming** — web EventSource, fetch+SSE-parser, etc.
- **The CLI uses dynamic imports** for commands to keep startup fast.