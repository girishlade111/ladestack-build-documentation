# Prompt 03: Hono API Gateway

## Goal

Create the `@ladestack/api` package — a Hono-based API server that the Next.js app will call for auth, projects, sessions, and SSE streaming.

## Context (from prompts 01-02)

- Monorepo is bootstrapped (prompt 01)
- Next.js app shell exists at `apps/web` (prompt 02)
- Stubs exist at `packages/runtime`, `packages/sdk`, `packages/ui`

The architecture reference: `../system-design.md` §2.2 (Hono API gateway responsibilities).

## Task

### Step 1: Create the API package

```bash
cd packages
mkdir api
```

Replace `packages/api/package.json`:

```json
{
  "name": "@ladestack/api",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src/",
    "clean": "rm -rf dist .turbo"
  },
  "dependencies": {
    "hono": "^4.0.0",
    "@hono/node-server": "^1.0.0",
    "@hono/zod-validator": "^0.2.0",
    "zod": "^3.22.0",
    "eventsource-parser": "^1.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "tsx": "^4.7.0",
    "typescript": "^5.4.0"
  }
}
```

### Step 2: Create `packages/api/tsconfig.json`

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

### Step 3: Create `packages/api/src/env.ts` (typed environment)

```ts
import { z } from "zod"

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string(),
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string(),
  SUPABASE_SERVICE_KEY: z.string(),
  ENCRYPTION_KEY: z.string().length(64),  // 32 bytes hex
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GOOGLE_API_KEY: z.string().optional(),
  JWT_SECRET: z.string().min(32),
  CORS_ORIGINS: z.string().default("http://localhost:3000")
})

export const env = envSchema.parse(process.env)
export type Env = z.infer<typeof envSchema>
```

### Step 4: Create `packages/api/src/middleware/cors.ts`

```ts
import { cors } from "hono/cors"
import { env } from "../env.js"

export const corsMiddleware = cors({
  origin: env.CORS_ORIGINS.split(","),
  credentials: true,
  allowHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
})
```

### Step 5: Create `packages/api/src/middleware/auth.ts` (stub for prompt 04)

```ts
import { createMiddleware } from "hono/factory"
import { verify } from "hono/jwt"
import { env } from "../env.js"
import type { Context } from "hono"

export type AuthContext = {
  userId: string
  email: string
}

export const authMiddleware = createMiddleware<{
  Variables: { auth: AuthContext }
}>(async (c, next) => {
  const authHeader = c.req.header("Authorization")
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "missing_token" }, 401)
  }

  const token = authHeader.slice(7)
  try {
    const payload = await verify(token, env.JWT_SECRET)
    c.set("auth", { userId: payload.sub as string, email: payload.email as string })
    await next()
  } catch (err) {
    return c.json({ error: "invalid_token" }, 401)
  }
})
```

### Step 6: Create `packages/api/src/middleware/error.ts`

```ts
import { createMiddleware } from "hono/factory"

export const errorMiddleware = createMiddleware(async (c, next) => {
  try {
    await next()
  } catch (err) {
    console.error("[api error]", err)
    const status = err instanceof HttpError ? err.status : 500
    const message = err instanceof Error ? err.message : "internal_error"
    return c.json({ error: message }, status as any)
  }
})

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export const badRequest = (msg: string) => new HttpError(400, msg)
export const unauthorized = (msg = "unauthorized") => new HttpError(401, msg)
export const notFound = (msg = "not_found") => new HttpError(404, msg)
```

### Step 7: Create `packages/api/src/routes/health.ts`

```ts
import { Hono } from "hono"

export const healthRoutes = new Hono()
  .get("/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }))
  .get("/health/ready", async (c) => {
    // TODO: ping database, check LLM provider connectivity
    return c.json({ status: "ready" })
  })
```

### Step 8: Create `packages/api/src/routes/projects.ts` (stub)

```ts
import { Hono } from "hono"
import { z } from "zod"
import { zValidator } from "@hono/zod-validator"
import { authMiddleware, type AuthContext } from "../middleware/auth.js"

const createProjectSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional()
})

export const projectRoutes = new Hono<{ Variables: { auth: AuthContext } }>()
  .use("*", authMiddleware)
  .get("/", async (c) => {
    const { userId } = c.get("auth")
    // TODO: query DB (prompt 04)
    return c.json({ projects: [] })
  })
  .post("/", zValidator("json", createProjectSchema), async (c) => {
    const { userId } = c.get("auth")
    const body = c.req.valid("json")
    // TODO: insert DB (prompt 04)
    return c.json({ id: "stub-id", ...body }, 201)
  })
  .get("/:id", async (c) => {
    const id = c.req.param("id")
    return c.json({ id, name: "stub" })
  })
  .delete("/:id", async (c) => {
    return c.json({ deleted: c.req.param("id") })
  })
```

### Step 9: Create `packages/api/src/routes/sessions.ts` (stub with SSE plumbing)

```ts
import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { authMiddleware, type AuthContext } from "../middleware/auth.js"

export const sessionRoutes = new Hono<{ Variables: { auth: AuthContext } }>()
  .use("*", authMiddleware)
  .get("/:id/messages", async (c) => {
    return streamSSE(c, async (stream) => {
      // TODO: load message history from DB (prompt 10)
      await stream.writeSSE({
        event: "message_history",
        data: JSON.stringify({ messages: [] })
      })
    })
  })
  .post("/:id/messages", async (c) => {
    // TODO: forward to runtime (prompt 11)
    return streamSSE(c, async (stream) => {
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({ error: "not_implemented" })
      })
    })
  })
```

### Step 10: Create `packages/api/src/index.ts`

```ts
import { Hono } from "hono"
import { env } from "./env.js"
import { corsMiddleware } from "./middleware/cors.js"
import { errorMiddleware } from "./middleware/error.js"
import { healthRoutes } from "./routes/health.js"
import { projectRoutes } from "./routes/projects.js"
import { sessionRoutes } from "./routes/sessions.js"

const app = new Hono()
  .use("*", errorMiddleware)
  .use("*", corsMiddleware)
  .route("/", healthRoutes)
  .route("/api/projects", projectRoutes)
  .route("/api/sessions", sessionRoutes)

app.notFound((c) => c.json({ error: "not_found" }, 404))

const port = env.PORT
console.log(`[api] starting on port ${port}`)

export default {
  port,
  fetch: app.fetch
}
```

### Step 11: Create `.env` in the API package

```bash
cd packages/api
cp .env.example .env  # we'll create .env.example next
```

`packages/api/.env.example`:
```
NODE_ENV=development
PORT=3001
DATABASE_URL=postgresql://stub
SUPABASE_URL=http://localhost:54321
SUPABASE_ANON_KEY=stub
SUPABASE_SERVICE_KEY=stub
ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000
JWT_SECRET=replace-me-with-32-byte-random-secret-string
CORS_ORIGINS=http://localhost:3000
```

`packages/api/.env` (gitignored):
```
NODE_ENV=development
PORT=3001
DATABASE_URL=postgresql://stub
SUPABASE_URL=http://localhost:54321
SUPABASE_ANON_KEY=stub
SUPABASE_SERVICE_KEY=stub
ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
JWT_SECRET=dev-only-jwt-secret-replace-in-prod-32-chars
CORS_ORIGINS=http://localhost:3000
```

### Step 12: Add `dotenv` for env loading

```bash
cd packages/api
pnpm add dotenv
```

Update `packages/api/src/index.ts` first line:

```ts
import "dotenv/config"
// ... rest of imports
```

### Step 13: Add a turbo dev dependency

Add `packages/api` to root `turbo.json` `dev` task — already handled since `turbo run dev` runs all packages.

### Step 14: Add api to workspace

Already handled by `pnpm-workspace.yaml`'s `packages/*` pattern.

### Step 15: Verify

```bash
cd ladestack-build
pnpm install
pnpm --filter @ladestack/api dev
# in another terminal:
curl http://localhost:3001/health
# expected: {"status":"ok","timestamp":"..."}
```

### Step 16: Add a basic test

`packages/api/src/routes/health.test.ts`:
```ts
import { describe, it, expect } from "vitest"
import { app } from "./index.js"

describe("health", () => {
  it("returns ok", async () => {
    const res = await app.request("/health")
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe("ok")
  })
})
```

Install vitest:
```bash
cd packages/api
pnpm add -D vitest
```

Add to `package.json` scripts:
```json
"test": "vitest run"
```

### Step 17: Commit

```bash
git add -A
git commit -m "feat(api): Hono API gateway with auth middleware + SSE plumbing (prompt 03)"
```

## Files created

```
packages/api/
├── .env
├── .env.example
├── package.json
├── tsconfig.json
└── src/
    ├── env.ts
    ├── index.ts
    ├── middleware/
    │   ├── auth.ts
    │   ├── cors.ts
    │   └── error.ts
    └── routes/
        ├── health.ts
        ├── health.test.ts
        ├── projects.ts
        └── sessions.ts
```

## Acceptance criteria

- [ ] `pnpm --filter @ladestack/api dev` starts on port 3001
- [ ] `GET /health` returns `{"status":"ok"}`
- [ ] `GET /api/projects` returns 401 without auth header
- [ ] `POST /api/projects` validates request body (Zod)
- [ ] `pnpm test` passes
- [ ] `pnpm typecheck` passes
- [ ] All env vars are typed (no `process.env.X` raw usage)

## Verification

```bash
cd ladestack-build
pnpm install
pnpm --filter @ladestack/api test
pnpm --filter @ladestack/api dev &
sleep 3
curl -s http://localhost:3001/health
curl -s -w "%{http_code}" http://localhost:3001/api/projects
kill %1
```

Health: 200 with JSON. Projects without auth: 401.

## Notes

- **Auth middleware is a stub** — it verifies JWT signature but doesn't actually fetch the user. Prompt 04 wires this to Supabase.
- **Projects and sessions routes are stubs** — they return placeholder data. Prompts 04, 10, 11 fill them in.
- **Don't use `process.env` directly** — always go through `env.ts`. This catches typos at startup.
- **SSE is built into Hono** via `streamSSE`. Use it for all streaming endpoints.
- **`.env` is gitignored** — only `.env.example` is committed. Generate a real `JWT_SECRET` with `openssl rand -hex 32` for prod.
- **Error middleware catches all thrown errors** but not async errors inside route handlers. Wrap async handlers if needed.
