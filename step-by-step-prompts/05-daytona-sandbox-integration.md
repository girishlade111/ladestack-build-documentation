# Prompt 05: Daytona Sandbox Integration

## Goal

Set up per-project sandboxed Linux containers using Daytona SDK. Each project gets a lightweight container with Node 20 + Vite, mounted at `/workspace`. The runtime will later start a Vite dev server inside the sandbox for the preview pane.

## Context (from prompts 01-04)

- Monorepo, Next.js app, Hono API, Supabase schema/auth all working.
- `packages/runtime/` exists as empty stub.

Reference: `../system-design.md` §2.4 (sandbox pool architecture), §5 (preview pipeline).

## Task

### Step 1: Convert runtime stub to a real package

Replace `packages/runtime/package.json`:

```json
{
  "name": "@ladestack/runtime",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src/",
    "test": "vitest run",
    "clean": "rm -rf dist .turbo"
  },
  "dependencies": {
    "@daytona/sdk": "^0.20.0",
    "zod": "^3.22.0",
    "pino": "^8.18.0",
    "pino-pretty": "^11.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "tsx": "^4.7.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

### Step 2: Create `packages/runtime/tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "types": ["node"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### Step 3: Create logger

`packages/runtime/src/lib/logger.ts`:

```ts
import pino from "pino"

export const log = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: process.env.NODE_ENV === "development" ? { target: "pino-pretty" } : undefined
})
```

### Step 4: Create the sandbox service

`packages/runtime/src/sandbox/types.ts`:

```ts
export type SandboxState = "creating" | "running" | "idle" | "stopped" | "destroyed"

export interface SandboxInfo {
  id: string
  projectId: string
  state: SandboxState
  workspacePath: string   // absolute path inside container
  previewUrl: string | null
  createdAt: Date
  lastActiveAt: Date
}

export interface FileChange {
  path: string
  content?: string       // for writes
  delete?: boolean       // for deletes
}
```

`packages/runtime/src/sandbox/daytona.ts`:

```ts
import { Daytona } from "@daytona/sdk"
import { log } from "../lib/logger.js"
import type { SandboxInfo, FileChange, SandboxState } from "./types.js"

const daytona = new Daytona({
  apiKey: process.env.DAYTONA_API_KEY!,
  apiUrl: process.env.DAYTONA_API_URL || "https://app.daytona.io/api"
})

const SANDBOX_IMAGE = "node:20-bookworm-slim"
const WORKSPACE = "/workspace"
const IDLE_TIMEOUT_MS = 5 * 60 * 1000   // 5 min

const sandboxes = new Map<string, SandboxInfo>()
const idleTimers = new Map<string, NodeJS.Timeout>()

export async function createSandbox(projectId: string): Promise<SandboxInfo> {
  const existing = sandboxes.get(projectId)
  if (existing && existing.state !== "destroyed") {
    log.info({ projectId, state: existing.state }, "reusing existing sandbox")
    return existing
  }

  log.info({ projectId }, "creating sandbox")
  const sandbox = await daytona.create({
    image: SANDBOX_IMAGE,
    envVars: { NODE_ENV: "development" },
    resources: { cpu: 1, memory: "512Mi", disk: "5Gi" }
  })

  // Init workspace
  await sandbox.process.executeCommand(`mkdir -p ${WORKSPACE}`)
  await sandbox.process.executeCommand(`cd ${WORKSPACE} && npm init -y`)
  await sandbox.process.executeCommand(`cd ${WORKSPACE} && npm install --save-dev vite @vitejs/plugin-react`)

  const info: SandboxInfo = {
    id: sandbox.id,
    projectId,
    state: "running",
    workspacePath: WORKSPACE,
    previewUrl: null,
    createdAt: new Date(),
    lastActiveAt: new Date()
  }
  sandboxes.set(projectId, info)
  log.info({ projectId, sandboxId: sandbox.id }, "sandbox created")
  return info
}

export async function getSandbox(projectId: string): Promise<SandboxInfo | undefined> {
  return sandboxes.get(projectId)
}

export async function destroySandbox(projectId: string): Promise<void> {
  const info = sandboxes.get(projectId)
  if (!info) return
  const timer = idleTimers.get(projectId)
  if (timer) clearTimeout(timer)
  idleTimers.delete(projectId)
  try {
    const sandbox = await daytona.get(info.id)
    await sandbox.delete()
  } catch (err) {
    log.warn({ err, projectId }, "destroy sandbox failed")
  }
  info.state = "destroyed"
  sandboxes.delete(projectId)
  log.info({ projectId }, "sandbox destroyed")
}

async function getDaytonaSandbox(id: string) {
  return await daytona.get(id)
}

export async function writeFiles(projectId: string, changes: FileChange[]): Promise<void> {
  const info = sandboxes.get(projectId)
  if (!info) throw new Error(`sandbox not found for project ${projectId}`)
  const sandbox = await getDaytonaSandbox(info.id)

  for (const change of changes) {
    if (change.delete) {
      await sandbox.fs.deleteFile(`${WORKSPACE}/${change.path}`)
    } else if (change.content !== undefined) {
      await sandbox.fs.uploadFile(`${WORKSPACE}/${change.path}`, Buffer.from(change.content, "utf-8"))
    }
  }

  bumpActivity(projectId)
  log.info({ projectId, count: changes.length }, "files written")
}

export async function readFile(projectId: string, path: string): Promise<string> {
  const info = sandboxes.get(projectId)
  if (!info) throw new Error(`sandbox not found`)
  const sandbox = await getDaytonaSandbox(info.id)
  const buffer = await sandbox.fs.downloadFile(`${WORKSPACE}/${path}`)
  return buffer.toString("utf-8")
}

export async function listFiles(projectId: string, subdir = ""): Promise<string[]> {
  const info = sandboxes.get(projectId)
  if (!info) throw new Error(`sandbox not found`)
  const sandbox = await getDaytonaSandbox(info.id)
  const result = await sandbox.fs.listFiles(`${WORKSPACE}/${subdir}`)
  bumpActivity(projectId)
  return result.map((f: any) => f.name)
}

export async function executeCommand(projectId: string, command: string, cwd?: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const info = sandboxes.get(projectId)
  if (!info) throw new Error(`sandbox not found`)
  const sandbox = await getDaytonaSandbox(info.id)
  const result = await sandbox.process.executeCommand(cwd ? `cd ${WORKSPACE}/${cwd} && ${command}` : `cd ${WORKSPACE} && ${command}`)
  bumpActivity(projectId)
  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode ?? 0 }
}

export async function startDevServer(projectId: string): Promise<string> {
  const info = sandboxes.get(projectId)
  if (!info) throw new Error(`sandbox not found`)
  const sandbox = await getDaytonaSandbox(info.id)

  // Kill any existing dev server
  try { await sandbox.process.executeCommand("pkill -f 'vite' || true") } catch {}

  // Start in background
  const handle = await sandbox.process.createProcess(`cd ${WORKSPACE} && npm run dev`)
  handle.waitForPort(5173).catch(() => {})

  // Get public preview URL
  const preview = await sandbox.getPreviewLink(5173)
  info.previewUrl = preview.url
  info.state = "running"
  log.info({ projectId, previewUrl: preview.url }, "dev server started")
  return preview.url
}

function bumpActivity(projectId: string) {
  const info = sandboxes.get(projectId)
  if (!info) return
  info.lastActiveAt = new Date()
  const existing = idleTimers.get(projectId)
  if (existing) clearTimeout(existing)
  idleTimers.set(projectId, setTimeout(() => {
    info.state = "idle"
    log.info({ projectId }, "sandbox idle (will suspend)")
    // TODO: actually suspend the sandbox (Daytona API call)
  }, IDLE_TIMEOUT_MS))
}
```

### Step 5: Create a registry helper for sandbox-aware operations

`packages/runtime/src/sandbox/operations.ts`:

```ts
import { writeFiles, readFile, listFiles, executeCommand } from "./daytona.js"

export const sandboxOps = {
  write: writeFiles,
  read: readFile,
  list: listFiles,
  exec: executeCommand
}
```

### Step 6: Export from runtime index

`packages/runtime/src/index.ts`:

```ts
export * from "./sandbox/types.js"
export * as sandbox from "./sandbox/daytona.js"
export * from "./sandbox/operations.js"
export { log } from "./lib/logger.js"
```

### Step 7: Add Daytona config to API env

Update `packages/api/.env` and `packages/api/src/env.ts`:

In `.env`:
```
DAYTONA_API_KEY=your-daytona-api-key
DAYTONA_API_URL=https://app.daytona.io/api
```

In `env.ts`, add to schema:
```ts
DAYTONA_API_KEY: z.string(),
DAYTONA_API_URL: z.string().url().optional()
```

### Step 8: Wire sandbox creation into project creation

In `packages/api/src/routes/projects.ts`, modify the POST handler:

```ts
import { sandbox } from "@ladestack/runtime"

.post("/", zValidator("json", createProjectSchema), async (c) => {
  const { userId } = c.get("auth")
  const body = c.req.valid("json")
  const preview_subdomain = `p-${Math.random().toString(36).slice(2, 10)}`

  // 1. Create DB record first
  const { data, error } = await supabaseAdmin
    .from("projects")
    .insert({ user_id: userId, ...body, preview_subdomain })
    .select()
    .single()
  if (error) throw error

  // 2. Create sandbox (fire and forget — don't block the response)
  sandbox.createSandbox(data.id).catch((err) => {
    log.error({ err, projectId: data.id }, "sandbox creation failed")
  })

  return c.json(data, 201)
})
```

### Step 9: Add sandbox API routes

`packages/api/src/routes/sandbox.ts`:

```ts
import { Hono } from "hono"
import { z } from "zod"
import { zValidator } from "@hono/zod-validator"
import { authMiddleware, type AuthContext } from "../middleware/auth.js"
import { sandbox } from "@ladestack/runtime"
import { notFound } from "../middleware/error.js"

export const sandboxRoutes = new Hono<{ Variables: { auth: AuthContext } }>()
  .use("*", authMiddleware)
  .get("/:projectId", async (c) => {
    const projectId = c.req.param("projectId")
    const info = await sandbox.getSandbox(projectId)
    if (!info) throw notFound("sandbox_not_found")
    return c.json(info)
  })
  .post("/:projectId/start", async (c) => {
    const projectId = c.req.param("projectId")
    const previewUrl = await sandbox.startDevServer(projectId)
    return c.json({ previewUrl })
  })
  .delete("/:projectId", async (c) => {
    const projectId = c.req.param("projectId")
    await sandbox.destroySandbox(projectId)
    return c.json({ destroyed: projectId })
  })
```

Wire into `packages/api/src/index.ts`:
```ts
import { sandboxRoutes } from "./routes/sandbox.js"
// ... existing
  .route("/api/sandbox", sandboxRoutes)
```

### Step 10: Write a test

`packages/runtime/src/sandbox/daytona.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { createSandbox, writeFiles, readFile, destroySandbox } from "./daytona.js"

const TEST_PROJECT = `test-${Date.now()}`

describe("daytona sandbox", () => {
  beforeAll(() => { if (!process.env.DAYTONA_API_KEY) throw new Error("DAYTONA_API_KEY not set") })

  it("creates, writes, reads, destroys", async () => {
    const info = await createSandbox(TEST_PROJECT)
    expect(info.state).toBe("running")

    await writeFiles(TEST_PROJECT, [
      { path: "hello.txt", content: "world" }
    ])
    const content = await readFile(TEST_PROJECT, "hello.txt")
    expect(content).toBe("world")

    await destroySandbox(TEST_PROJECT)
  }, { timeout: 60000 })
})
```

### Step 11: Verify

```bash
# Build all packages
pnpm turbo run build

# Run runtime tests (requires DAYTONA_API_KEY)
export DAYTONA_API_KEY=...
cd packages/runtime && pnpm test

# Manual end-to-end via API
pnpm --filter @ladestack/api dev &
sleep 3
TOKEN=***  # get from prompt 04 signup

# Create project (triggers sandbox creation)
PROJECT=$(curl -X POST http://localhost:3001/api/projects \
  -H "Authorization: Bearer *** \
  -H "Content-Type: application/json" \
  -d '{"name":"Sandbox test"}' | jq -r .id)

# Start dev server
curl -X POST http://localhost:3001/api/sandbox/$PROJECT/start \
  -H "Authorization: Bearer *** expected: {"previewUrl":"..."}

# Cleanup
curl -X DELETE http://localhost:3001/api/sandbox/$PROJECT \
  -H "Authorization: Bearer *** kill %1
```

### Step 12: Commit

```bash
git add -A
git commit -m "feat(runtime): Daytona sandbox integration with dev server lifecycle (prompt 05)"
```

## Files created/modified

```
packages/runtime/
├── package.json (rewrite)
├── tsconfig.json
└── src/
    ├── index.ts
    ├── lib/logger.ts
    └── sandbox/
        ├── types.ts
        ├── daytona.ts
        ├── operations.ts
        └── daytona.test.ts

packages/api/
├── .env (added DAYTONA_*)
├── src/env.ts (added DAYTONA_*)
├── src/routes/projects.ts (create sandbox on project create)
└── src/routes/sandbox.ts (new)
```

## Acceptance criteria

- [ ] `pnpm --filter @ladestack/runtime build` succeeds
- [ ] `pnpm --filter @ladestack/runtime test` passes (writes + reads a file)
- [ ] `POST /api/projects` triggers async sandbox creation
- [ ] `POST /api/sandbox/:projectId/start` returns a preview URL
- [ ] `GET /api/sandbox/:projectId` returns sandbox info
- [ ] `DELETE /api/sandbox/:projectId` destroys sandbox
- [ ] Idle timeout (5min) marks sandbox as idle
- [ ] `writeFiles` correctly writes multiple files atomically

## Verification

```bash
# Test the integration end-to-end
pnpm --filter @ladestack/api dev &
sleep 3
# (signup, create project, start dev server, check preview URL — see step 11)
kill %1
```

## Notes

- **Daytona API key required.** Sign up at https://www.daytona.io/ — free tier includes compute credits.
- **Sandbox creation is async** — don't block the API response. The dev server takes ~5s to be ready.
- **Vite dev server takes a few seconds** to start. Use `waitForPort` or polling, not blocking.
- **Workspace is ephemeral.** If a sandbox is destroyed, files are gone. We'll persist via `file_snapshots` table (prompt 11).
- **Network egress** is restricted in Daytona sandboxes by default. Allowlist npm registry, GitHub, LLM APIs as needed.
- **The `startDevServer` function is a stub for now** — Vite config + HMR wiring comes in prompt 20.
- **Resource limits** (1 CPU, 512MB RAM) are tight. Monitor; bump if needed.
- **Don't use Daytona workspaces with `dangerouslyDisableCgroupLimits`** — keeps sandbox from eating host resources.
