# Prompt 04: Supabase Schema + Auth

## Goal

Wire up Supabase Postgres + Auth to the API: create the database schema (see `../system-design.md` §2.5), implement real auth flows (signup, login, JWT), and make the project routes actually persist data.

## Context (from prompts 01-03)

- Monorepo bootstrapped (prompt 01)
- Next.js app shell (prompt 02)
- Hono API gateway with stub auth (prompt 03)

You need:
- A Supabase project (create one at https://supabase.com — free tier is fine)
- The project URL + service key (Settings → API)

Database schema reference: `../system-design.md` §2.5 (full SQL DDL).

## Task

### Step 1: Add Supabase clients to the API

```bash
cd packages/api
pnpm add @supabase/supabase-js
pnpm add -D supabase  # CLI for migrations
```

### Step 2: Create `packages/api/src/db/client.ts`

```ts
import { createClient } from "@supabase/supabase-js"
import { env } from "../env.js"

export const supabaseAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
})
```

### Step 3: Create the migration file

`packages/api/db/migrations/001_initial_schema.sql`:

```sql
-- See ../system-design.md §2.5 for full DDL. Copy that content here.

-- Users (extends Supabase auth.users)
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  password_hash text,
  github_id text unique,
  google_id text unique,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- BYO API keys (encrypted)
create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  provider text not null check (provider in ('anthropic', 'openai', 'google', 'openrouter')),
  encrypted_key text not null,
  key_hint text not null,
  created_at timestamptz default now(),
  unique (user_id, provider)
);

-- Subscriptions
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) unique on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text,
  plan text not null default 'free' check (plan in ('free', 'pro', 'teams')),
  status text not null default 'active',
  current_period_end timestamptz,
  created_at timestamptz default now()
);

-- Projects
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  name text not null,
  description text,
  visibility text not null default 'private' check (visibility in ('private', 'public')),
  github_repo text,
  preview_subdomain text unique,
  vercel_deployment_id text,
  deploy_status text default 'none',
  default_model text default 'anthropic/claude-sonnet-4-20250514',
  default_mode text default 'plan' check (default_mode in ('plan', 'build')),
  default_agent text default 'build',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_active_at timestamptz default now()
);
create index projects_user_id_idx on public.projects(user_id);
create index projects_updated_at_idx on public.projects(updated_at desc);

-- Sessions
create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  title text,
  status text default 'active' check (status in ('active', 'archived')),
  total_tokens_in int default 0,
  total_tokens_out int default 0,
  total_cost_cents int default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index sessions_project_id_idx on public.sessions(project_id, updated_at desc);

-- Messages
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.sessions(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'tool', 'system')),
  agent text default 'build',
  content text not null,
  tool_calls jsonb,
  tool_call_id text,
  model text,
  tokens_in int,
  tokens_out int,
  cost_cents int,
  parent_message_id uuid references public.messages(id),
  created_at timestamptz default now()
);
create index messages_session_id_idx on public.messages(session_id, created_at);

-- File snapshots
create table public.file_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete cascade,
  path text not null,
  content text not null,
  commit_sha text not null,
  message_id uuid references public.messages(id),
  created_at timestamptz default now()
);
create index file_snapshots_project_path_idx on file_snapshots(project_id, path, created_at desc);

-- Usage events
create table public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id),
  project_id uuid references public.projects(id),
  session_id uuid references public.sessions(id),
  event_type text not null,
  agent text,
  model text,
  tokens_in int default 0,
  tokens_out int default 0,
  cost_cents int default 0,
  created_at timestamptz default now(),
  date date default current_date
);
create index usage_events_user_date_idx on usage_events(user_id, date desc);

-- RLS policies (Row-Level Security)
alter table public.users enable row level security;
alter table public.projects enable row level security;
alter table public.sessions enable row level security;
alter table public.messages enable row level security;
alter table public.file_snapshots enable row level security;
alter table public.usage_events enable row level security;

create policy "Users can read own row" on public.users
  for select using (auth.uid() = id);

create policy "Users can manage own projects" on public.projects
  for all using (auth.uid() = user_id);

create policy "Users can manage own sessions" on public.sessions
  for all using (
    project_id in (select id from public.projects where user_id = auth.uid())
  );

create policy "Users can manage own messages" on public.messages
  for all using (
    session_id in (
      select s.id from public.sessions s
      join public.projects p on s.project_id = p.id
      where p.user_id = auth.uid()
    )
  );

create policy "Users can manage own file_snapshots" on public.file_snapshots
  for all using (
    project_id in (select id from public.projects where user_id = auth.uid())
  );

create policy "Users can read own usage" on public.usage_events
  for select using (auth.uid() = user_id);
```

### Step 4: Run migrations

Option A: via Supabase SQL editor (paste + run)
Option B: via CLI

```bash
cd packages/api
pnpm dlx supabase db push  # if you set up supabase CLI
```

For MVP, Option A is simpler. Just paste the SQL in the Supabase dashboard SQL editor and run.

### Step 5: Update auth middleware to issue JWTs

`packages/api/src/middleware/auth.ts` (rewrite):

```ts
import { createMiddleware } from "hono/factory"
import { sign, verify } from "hono/jwt"
import { env } from "../env.js"

export type AuthContext = { userId: string; email: string }

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
  } catch {
    return c.json({ error: "invalid_token" }, 401)
  }
})

export async function issueJwt(payload: { sub: string; email: string }): Promise<string> {
  return await sign({ ...payload, exp: Math.floor(Date.now() / 1000) + 60 * 15 }, env.JWT_SECRET)  // 15 min
}
```

### Step 6: Create auth routes

`packages/api/src/routes/auth.ts`:

```ts
import { Hono } from "hono"
import { z } from "zod"
import { zValidator } from "@hono/zod-validator"
import { createClient } from "@supabase/supabase-js"
import { env } from "../env.js"
import { issueJwt } from "../middleware/auth.js"
import { badRequest, unauthorized } from "../middleware/error.js"

const supabasePublic = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
})

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(100)
})

const loginSchema = signupSchema

export const authRoutes = new Hono()
  .post("/signup", zValidator("json", signupSchema), async (c) => {
    const { email, password } = c.req.valid("json")
    const { data, error } = await supabasePublic.auth.signUp({ email, password })
    if (error) throw badRequest(error.message)
    if (!data.user) throw badRequest("signup_failed")
    // Mirror user into public.users
    await fetch(`${env.SUPABASE_URL}/rest/v1/users`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify({ id: data.user.id, email })
    })
    const token = await issueJwt({ sub: data.user.id, email })
    return c.json({ token, user: { id: data.user.id, email } })
  })
  .post("/login", zValidator("json", loginSchema), async (c) => {
    const { email, password } = c.req.valid("json")
    const { data, error } = await supabasePublic.auth.signInWithPassword({ email, password })
    if (error) throw unauthorized(error.message)
    if (!data.user) throw unauthorized("login_failed")
    const token = await issueJwt({ sub: data.user.id, email: data.user.email! })
    return c.json({ token, user: { id: data.user.id, email: data.user.email } })
  })
```

### Step 7: Wire auth routes into the app

Update `packages/api/src/index.ts`:

```ts
import { authRoutes } from "./routes/auth.js"
// ... existing imports
const app = new Hono()
  .use("*", errorMiddleware)
  .use("*", corsMiddleware)
  .route("/", healthRoutes)
  .route("/api/auth", authRoutes)        // <-- new
  .route("/api/projects", projectRoutes)
  .route("/api/sessions", sessionRoutes)
```

### Step 8: Make projects routes use the DB

Rewrite `packages/api/src/routes/projects.ts`:

```ts
import { Hono } from "hono"
import { z } from "zod"
import { zValidator } from "@hono/zod-validator"
import { authMiddleware, type AuthContext } from "../middleware/auth.js"
import { supabaseAdmin } from "../db/client.js"
import { notFound } from "../middleware/error.js"

const createProjectSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional()
})

export const projectRoutes = new Hono<{ Variables: { auth: AuthContext } }>()
  .use("*", authMiddleware)
  .get("/", async (c) => {
    const { userId } = c.get("auth")
    const { data, error } = await supabaseAdmin
      .from("projects")
      .select("id, name, description, visibility, default_model, default_mode, updated_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
    if (error) throw error
    return c.json({ projects: data })
  })
  .post("/", zValidator("json", createProjectSchema), async (c) => {
    const { userId } = c.get("auth")
    const body = c.req.valid("json")
    const preview_subdomain = `p-${Math.random().toString(36).slice(2, 10)}`
    const { data, error } = await supabaseAdmin
      .from("projects")
      .insert({ user_id: userId, ...body, preview_subdomain })
      .select()
      .single()
    if (error) throw error
    return c.json(data, 201)
  })
  .get("/:id", async (c) => {
    const { userId } = c.get("auth")
    const id = c.req.param("id")
    const { data, error } = await supabaseAdmin
      .from("projects")
      .select("*")
      .eq("id", id)
      .eq("user_id", userId)
      .single()
    if (error || !data) throw notFound("project_not_found")
    return c.json(data)
  })
  .delete("/:id", async (c) => {
    const { userId } = c.get("auth")
    const id = c.req.param("id")
    const { error } = await supabaseAdmin
      .from("projects")
      .delete()
      .eq("id", id)
      .eq("user_id", userId)
    if (error) throw error
    return c.json({ deleted: id })
  })
```

### Step 9: Update .env with real Supabase credentials

Edit `packages/api/.env`:

```
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_ANON_KEY=eyJ...your-anon-key
SUPABASE_SERVICE_KEY=eyJ...your-service-role-key
```

Get these from Supabase dashboard: Settings → API.

### Step 10: Verify

```bash
pnpm --filter @ladestack/api dev &
sleep 3

# Signup
curl -X POST http://localhost:3001/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'
# expected: {"token":"...","user":{...}}

# Login (use the token from signup)
TOKEN="..."  # paste from above

# Create project
curl -X POST http://localhost:3001/api/projects \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"My first project"}'
# expected: {"id":"...","name":"My first project",...}

# List projects
curl http://localhost:3001/api/projects \
  -H "Authorization: Bearer $TOKEN"
# expected: {"projects":[{...}]}

kill %1
```

### Step 11: Update Next.js to call the API

Update `apps/web/src/lib/api.ts`:

```ts
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers
    }
  })
  if (!res.ok) throw new Error((await res.json()).error || "api_error")
  return res.json()
}
```

Add to `apps/web/.env.local`:
```
NEXT_PUBLIC_API_URL=http://localhost:3001
```

Create `apps/web/src/app/login/page.tsx`:

```tsx
"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { api } from "@/lib/api"

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const { token } = await api<{ token: string }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password })
      })
      localStorage.setItem("token", token)
      router.push("/dashboard")
    } catch (err) {
      setError(err instanceof Error ? err.message : "login_failed")
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas">
      <form onSubmit={handleSubmit} className="w-96 space-y-4 rounded-lg border border-border-subtle bg-surface p-8">
        <h1 className="text-2xl font-bold text-text-primary">Sign in</h1>
        <input
          type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="Email" required
          className="w-full rounded border border-border-subtle bg-elevated px-3 py-2 text-text-primary"
        />
        <input
          type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          placeholder="Password" required
          className="w-full rounded border border-border-subtle bg-elevated px-3 py-2 text-text-primary"
        />
        {error && <p className="text-sm text-accent-red">{error}</p>}
        <button type="submit" disabled={loading}
          className="w-full rounded bg-gold py-2 font-semibold text-canvas disabled:opacity-50">
          {loading ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </main>
  )
}
```

Create `apps/web/src/app/signup/page.tsx` (mirror of login but POSTs to `/api/auth/signup`).

Create `apps/web/src/app/dashboard/page.tsx`:

```tsx
"use client"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { api } from "@/lib/api"

type Project = { id: string; name: string; description: string | null; updated_at: string }

export default function DashboardPage() {
  const router = useRouter()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem("token")
    if (!token) { router.push("/login"); return }
    api<{ projects: Project[] }>("/api/projects")
      .then((data) => setProjects(data.projects))
      .catch(() => router.push("/login"))
      .finally(() => setLoading(false))
  }, [router])

  if (loading) return <main className="p-8 text-text-secondary">Loading...</main>

  return (
    <main className="min-h-screen bg-canvas p-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex items-center justify-between">
          <h1 className="text-3xl font-bold text-text-primary">Your projects</h1>
          <Link href="/dashboard/new" className="rounded bg-gold px-4 py-2 font-semibold text-canvas">
            New project
          </Link>
        </div>
        {projects.length === 0 ? (
          <p className="text-text-secondary">No projects yet. Create your first one.</p>
        ) : (
          <div className="grid gap-4">
            {projects.map((p) => (
              <Link key={p.id} href={`/c/${p.id}`}
                className="rounded-lg border border-border-subtle bg-surface p-4 hover:border-border-strong">
                <h3 className="font-semibold text-text-primary">{p.name}</h3>
                {p.description && <p className="text-sm text-text-secondary">{p.description}</p>}
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
```

### Step 12: Commit

```bash
git add -A
git commit -m "feat(auth): Supabase schema + auth flows + project CRUD (prompt 04)"
```

## Files created/modified

```
packages/api/
├── .env (updated)
├── package.json (added supabase)
├── db/migrations/001_initial_schema.sql
├── src/
│   ├── db/client.ts (new)
│   ├── middleware/auth.ts (rewrite)
│   ├── routes/auth.ts (new)
│   ├── routes/projects.ts (rewrite)
│   └── index.ts (wire auth routes)
└── src/routes/auth.test.ts (basic test)

apps/web/
├── .env.local (new)
├── src/lib/api.ts (new)
└── src/app/
    ├── login/page.tsx (new)
    ├── signup/page.tsx (new)
    └── dashboard/page.tsx (new)
```

## Acceptance criteria

- [ ] `POST /api/auth/signup` creates a user and returns a JWT
- [ ] `POST /api/auth/login` returns a JWT for existing user
- [ ] `POST /api/projects` with Bearer token creates a project row in DB
- [ ] `GET /api/projects` with Bearer token returns user's projects
- [ ] `GET /api/projects` without token returns 401
- [ ] `/login` page works end-to-end (signup → login → dashboard)
- [ ] `/dashboard` lists the user's projects
- [ ] All 10 tables exist in Supabase with RLS enabled

## Verification

```bash
# Test API
pnpm --filter @ladestack/api dev &
sleep 3
curl -X POST http://localhost:3001/api/auth/signup -H "Content-Type: application/json" \
  -d '{"email":"verify@example.com","password":"verify123"}'
# expect: 200 with token
kill %1

# Test UI
pnpm --filter @ladestack/web dev &
sleep 5
# visit http://localhost:3000/signup, create account, should redirect to /dashboard
kill %1
```

## Notes

- **Service role key is sensitive.** Never expose it to the client. Only the API uses it.
- **RLS is critical.** Even if your API has a bug, RLS prevents data leakage between users.
- **JWT secret must be 32+ chars.** Generate with `openssl rand -hex 32` for production.
- **Token storage in localStorage is OK for MVP** but consider httpOnly cookies for production (XSS-safer).
- **Email verification is on by default in Supabase.** Disable it in Supabase dashboard for development, or handle the verification email flow.
- **Don't add password reset, email change, etc. yet.** Defer to v1.5.
- **The `users` mirror table is intentional** — Supabase auth.users lives in a separate schema; we mirror what we need.
