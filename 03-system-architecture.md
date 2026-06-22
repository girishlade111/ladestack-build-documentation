# System Design: LadeStack Build

**Status:** Draft v1 (2026-06-22)
**Related:** PRD.md, tool-calling.md, agent-loop.md, design.md

---

## 1. High-level architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                              Browser (client)                             │
│                                                                            │
│   ┌─────────────────────────────────────────────────────────────────┐    │
│   │ Next.js 14 App Router (chat.ladestack.in / build.ladestack.in)│    │
│   │                                                                   │    │
│   │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │    │
│   │  │ Chat panel   │  │ Monaco editor│  │ Preview iframe        │   │    │
│   │  │ (SSE stream) │  │ + file tree  │  │ <iframe src=...>      │   │    │
│   │  │              │  │              │  │   (Vite dev server)   │   │    │
│   │  └──────────────┘  └──────────────┘  └──────────────────────┘   │    │
│   │                                                                   │    │
│   │  Zustand stores: sessionStore, projectStore, uiStore             │    │
│   └─────────────────────────────────────────────────────────────────┘    │
│                                                                            │
└─────────────────────────┬──────────────────────────────────────────────────┘
                          │
                          │ HTTPS + SSE (Server-Sent Events)
                          │
┌─────────────────────────▼──────────────────────────────────────────────────┐
│                     API Gateway (Node.js + Hono)                           │
│                                                                            │
│   /api/auth/*            → session mgmt, OAuth, BYO key encryption         │
│   /api/projects/*        → CRUD projects                                   │
│   /api/sessions/:id/*    → SSE stream for chat                            │
│   /api/preview/:id/*     → proxy + websocket for live preview             │
│   /api/deploy/*          → Vercel deploy trigger                          │
│   /api/github/*          → GitHub OAuth + push                            │
│                                                                            │
└──────┬──────────────────────┬─────────────────────┬───────────────────────┘
       │                      │                     │
       │                      │                     │
┌──────▼──────┐    ┌──────────▼────────┐   ┌───────▼────────┐
│   Postgres  │    │  Agent Runtime    │   │   Sandbox Pool │
│   (Supabase)│    │  (Node.js + Eff.) │   │   (Docker)     │
│             │    │                   │   │                │
│ users       │◄───┤  Loop:            │   │ ┌────────────┐ │
│ projects    │    │   1. Receive msg  │   │ │ Sandbox #1 │ │
│ sessions    │    │   2. Build prompt │   │ │  Vite dev  │ │
│ messages    │    │   3. Call LLM     │──►│ │  :5173     │ │
│ files       │    │   4. Parse tool   │   │ └────────────┘ │
│ deploys     │    │   5. Execute tool │   │ ┌────────────┐ │
│ usage       │    │   6. Append msg   │   │ │ Sandbox #2 │ │
│             │    │   7. Loop until   │   │ │  Vite dev  │ │
│             │    │      no tool or   │   │ │  :5174     │ │
│             │    │      max_steps    │   │ └────────────┘ │
│             │    │                   │   │     ...        │
└─────────────┘    └────────┬──────────┘   └───────┬────────┘
                            │                      │
                            │ HTTPS                │ wss://
                            ▼                      ▼
                   ┌────────────────┐      ┌─────────────────┐
                   │  LLM Providers │      │   Browser       │
                   │                │      │   <iframe>      │
                   │  Anthropic     │      │   src=proxy/    │
                   │  OpenAI        │      │   sandbox/:id/  │
                   │  Google Gemini │      │                 │
                   │  (BYO key)     │      │                 │
                   └────────────────┘      └─────────────────┘
```

---

## 2. Component responsibilities

### 2.1 Web client (Next.js 14)

**Stack:**
- Next.js 14 App Router
- TypeScript strict
- Tailwind CSS + shadcn/ui
- Zustand for client state
- React Query (TanStack Query) for server state
- Monaco editor (`@monaco-editor/react`)
- Framer Motion for chat transitions
- SSE via `eventsource-parser` for streaming

**Routes:**
- `/` — landing + sign-up CTA
- `/login`, `/signup`, `/verify`
- `/dashboard` — project list
- `/build/[projectId]` — main IDE (chat + editor + preview)
- `/build/[projectId]/settings` — API keys, model preference
- `/billing` — Stripe
- `/admin` — internal (defer v1.5)

**State (Zustand stores):**
```ts
sessionStore {
  projectId: string
  messages: Message[]          // ordered, with tool calls
  streaming: boolean
  currentAgent: string         // 'build' | 'plan' | 'explore' | ...
  mode: 'build' | 'plan'
  pendingToolCalls: ToolCall[]
}

projectStore {
  files: FileNode[]            // file tree
  openTabs: string[]
  activeTab: string | null
  gitStatus: 'clean' | 'modified' | 'uncommitted'
  previewUrl: string
  deployStatus: 'none' | 'building' | 'live' | 'failed'
}

uiStore {
  layout: { chat: number; editor: number; preview: number }  // % widths
  breakpoints: { mobile: boolean; tablet: boolean; desktop: boolean }
  theme: 'dark' | 'light'
  modals: { settings: boolean; billing: boolean; help: boolean }
}
```

### 2.2 API gateway (Node.js + Hono)

**Why Hono:** tiny (12 KB), runs on Node/Bun/Deno/Workers, ultra-fast routing, first-class TypeScript.

**Middleware:**
- CORS
- Rate limiting (per-user, per-IP)
- Auth (JWT verification, BYO key decryption)
- Request logging
- Error normalization

**SSE endpoint** (`/api/sessions/:id/messages`):
- Streams model output (text deltas + tool call events)
- Heartbeat every 15s
- Auto-reconnect support (client uses `Last-Event-ID`)

### 2.3 Agent runtime (Node.js + Effect)

**Direct port of Kilo Code's `packages/opencode/src/agent/`** — we copy the patterns, not the literal code (since Kilo is fork-of-fork and over-engineered for our needs initially).

**Key services:**
- `AgentService` — registry of agents (build, plan, explore, scout, orchestrator)
- `ToolService` — registry of tools (read, write, edit, glob, grep, bash, plan-enter, plan-exit, todowrite, question)
- `SessionService` — message history + compaction
- `ProviderService` — multi-LLM routing (Anthropic, OpenAI, Gemini)
- `SandboxService` — sandbox lifecycle (start, exec, snapshot, destroy)

**Why Effect:** structured concurrency + service composition. Our runtime is small enough (10-15 services) that Effect's overhead pays for itself.

**Loop:**
```ts
async function runTurn(session: Session, message: Message): Promise<Session> {
  let current = session
  for (let step = 0; step < MAX_STEPS; step++) {
    // 1. Build prompt: system + history + tools + current message
    const prompt = await buildPrompt(current)
    
    // 2. Call LLM
    const response = await provider.complete(prompt, { stream: true })
    
    // 3. Stream response back to client (SSE)
    await streamToClient(response)
    
    // 4. Append assistant message
    current = current.append(response.message)
    
    // 5. If response contains tool calls, execute them
    if (response.toolCalls.length === 0) break
    for (const call of response.toolCalls) {
      const result = await tool.execute(call, current)
      current = current.append(result.message)
      await streamToolResult(call.id, result)
    }
  }
  return current
}
```

### 2.4 Sandbox pool (Docker + Daytona SDK)

**Provider:** Daytona (preferred) or E2B. Both ship production sandbox primitives.

**Per-sandbox lifecycle:**
1. User creates project → API gateway requests sandbox from pool
2. Pool provisions: lightweight Linux container with Node 20, Vite, project template
3. Sandbox has mounted volume: `/workspace/` (the project files)
4. Vite dev server starts on port 5173
5. WebSocket from sandbox → preview proxy → browser iframe
6. When user idle 5 min → sandbox suspended (RAM freed, disk preserved)
7. When user returns → sandbox resumed in < 2s

**Why Daytona over E2B:** Daytona is cheaper for sustained workloads, better snapshot/restore, simpler GitHub integration.

**Sandbox isolation:**
- Network: outbound allowed (LLM API, npm registry); inbound restricted to proxy
- Resource limits: 512 MB RAM, 1 CPU, 5 GB disk per sandbox
- Cleanup: destroyed after 7 days idle; user can extend

### 2.5 Storage (Postgres on Supabase)

**Schema:**

```sql
-- Users
create table users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  password_hash text,             -- null if OAuth-only
  github_id text unique,
  google_id text unique,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- BYO API keys (encrypted at rest)
create table api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  provider text not null,        -- 'anthropic' | 'openai' | 'google'
  encrypted_key text not null,    -- AES-256-GCM
  key_hint text not null,         -- last 4 chars, for UI
  created_at timestamptz default now()
);

-- Subscription
create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) unique,
  stripe_customer_id text,
  stripe_subscription_id text,
  plan text not null default 'free',  -- 'free' | 'pro' | 'teams'
  status text not null default 'active',
  current_period_end timestamptz,
  created_at timestamptz default now()
);

-- Projects
create table projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  name text not null,
  description text,
  visibility text not null default 'private',  -- 'private' | 'public'
  github_repo text,                             -- 'user/repo' once synced
  preview_subdomain text unique,                -- 'abc123' for abc123.ladestack.app
  vercel_deployment_id text,
  deploy_status text default 'none',
  default_model text default 'anthropic/claude-sonnet-4',
  default_mode text default 'plan',             -- 'plan' | 'build'
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_active_at timestamptz default now()
);
create index projects_user_id_idx on projects(user_id);
create index projects_updated_at_idx on projects(updated_at desc);

-- Sessions (a session = one chat thread within a project)
create table sessions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  title text,                                   -- auto-generated by title agent
  status text default 'active',                 -- 'active' | 'archived'
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Messages
create table messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references sessions(id) on delete cascade,
  role text not null,                           -- 'user' | 'assistant' | 'tool' | 'system'
  content text not null,                        -- text content (markdown)
  tool_calls jsonb,                             -- [{ id, name, input }] if role=assistant
  tool_call_id text,                            -- if role=tool
  model text,                                   -- 'anthropic/claude-sonnet-4'
  tokens_in int,
  tokens_out int,
  cost_cents int,
  agent text default 'build',                   -- which agent generated this
  created_at timestamptz default now()
);
create index messages_session_id_idx on messages(session_id, created_at);

-- Files (snapshots, used for diffs + version control view)
create table file_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  path text not null,
  content text not null,
  commit_sha text not null,                     -- internal sha, not github
  message_id uuid references messages(id),      -- which message produced this
  created_at timestamptz default now()
);
create index file_snapshots_project_path_idx on file_snapshots(project_id, path, created_at desc);

-- Usage tracking (for billing + analytics)
create table usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  project_id uuid references projects(id),
  event_type text not null,                     -- 'build' | 'deploy' | 'git_push'
  tokens_in int default 0,
  tokens_out int default 0,
  cost_cents int default 0,
  created_at timestamptz default now(),
  date date default current_date
);
create index usage_events_user_date_idx on usage_events(user_id, date desc);

-- Deploys
create table deploys (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  vercel_deployment_id text,
  status text not null,                         -- 'building' | 'ready' | 'error'
  url text,
  log text,
  created_at timestamptz default now()
);
```

**Backup:** Supabase automatic daily snapshots + manual export nightly to DigitalOcean Spaces.

### 2.6 LLM provider layer

**Abstraction:**
```ts
interface Provider {
  id: string                              // 'anthropic', 'openai', 'google'
  complete(req: CompletionRequest): AsyncIterable<CompletionChunk>
  embed(input: string): Promise<number[]>  // for future semantic search
  listModels(): Model[]
}

interface CompletionRequest {
  model: string                           // 'claude-sonnet-4-20250514'
  messages: Message[]
  tools: ToolDefinition[]
  system?: string
  temperature?: number
  maxTokens?: number
  stream: true
  abortSignal: AbortSignal
}

interface CompletionChunk {
  type: 'text' | 'tool_call' | 'usage' | 'error' | 'done'
  text?: string
  toolCall?: { id: string; name: string; input: unknown }
  usage?: { tokensIn: number; tokensOut: number; costCents: number }
  error?: { code: string; message: string }
}
```

**Implementations:**
- `AnthropicProvider` — wraps `@anthropic-ai/sdk`, supports tool use + prompt caching
- `OpenAIProvider` — wraps `openai`, supports function calling
- `GoogleProvider` — wraps `@google/generative-ai`, supports function calling

**BYO key flow:**
1. User enters API key in settings
2. Client sends to `/api/settings/api-keys` over HTTPS
3. Server encrypts with AES-256-GCM (key from env `ENCRYPTION_KEY`)
4. Stores in `api_keys.encrypted_key` + hint
5. On provider call: decrypt, pass to provider SDK, never log

**Provider routing:**
- User's `default_model` preference
- Manual override per message (advanced UI)
- Fallback: if BYO key fails 3x → suggest managed credits (paid users only)

---

## 3. Data flow (canonical user action)

**Scenario:** User types "Build me a SaaS landing page" in a new project.

```
[Browser]  User types message + clicks Send
   │
   ▼ POST /api/projects/{id}/messages
[Gateway]  Auth check, rate limit, fetch session + project
   │
   ▼ resolve provider + BYO key
[Runtime]  Build prompt:
   │        - system prompt (agent personality + tools spec)
   │        - session history (last N messages, compacted if long)
   │        - file snapshot (current project state)
   │        - user message
   │        - tool definitions (read, write, edit, glob, ...)
   │
   ▼ stream completion
[Provider] Anthropic Claude Sonnet 4
   │        - streams text + tool calls
   │
   ▼ chunks to SSE
[Gateway]  SSE: text → browser chat
   │        SSE: tool_call → execute tool
   │
   ▼ tool execution
[Sandbox]  e.g. write(src/app/page.tsx, content)
   │        - write file in sandbox /workspace
   │        - Vite HMR detects change → push to iframe
   │
   ▼ continue loop
[Runtime]  Append tool result to history
   │        Loop until no tool calls or MAX_STEPS (default 25)
   │
   ▼ finalize
[Runtime]  Append final assistant message
   │        Create file_snapshot per edited file
   │        Auto-commit (internal git)
   │        Update usage_events
   │
   ▼ SSE done
[Browser]  Render final assistant message
            Show diffs (which files changed)
            Show updated preview
```

**Latency budget (typical):**
- API auth + DB read: 50 ms
- Prompt build (with file context): 200 ms
- LLM TTFB: 800 ms
- LLM streaming 4k tokens: 8 s
- Tool execution per file: 100 ms
- Vite HMR refresh: 200 ms
- **Total perceived time to first preview update:** ~2 s after message send

---

## 4. Authentication

**Methods:**
- Email + password (bcrypt, 12 rounds)
- Email verification (magic link)
- OAuth: Google, GitHub

**Sessions:** JWT (15 min access) + refresh token (30 days, httpOnly cookie, rotating)

**BYO key encryption:**
```
ENCRYPTION_KEY = 256-bit env var
encrypted = AES-256-GCM(plaintext, IV = random 12 bytes)
stored = base64(IV || ciphertext || authTag)
```

**Per-user isolation:** every API query is scoped by `user_id` from JWT. No row-level leakage.

---

## 5. Sandbox preview pipeline

**Architecture:**
```
Browser iframe
   │
   │ HTTPS (with auth token)
   ▼
Preview proxy (in API gateway)
   │
   │ WebSocket (HMR)
   ▼
Sandbox (per project)
   │
   ├─ Vite dev server (port 5173)
   ├─ tsc --watch (port 6006)        # for type errors
   ├─ esbuild (port 6007)            # for build errors
   │
   └─ Project /workspace
```

**Error surfacing:**
- Vite client errors → SSE to browser → preview console panel
- TS errors → message in chat ("⚠️ Type error in src/foo.ts: 23")
- Build errors → blocking message, agent self-corrects

**Preview proxy auth:** short-lived signed token (5 min TTL) per iframe load.

---

## 6. Deployment (Vercel)

**Flow:**
1. User clicks "Deploy"
2. Server-side: build the project (in sandbox)
3. `vercel deploy` via Vercel REST API with project ID + build output
4. Vercel returns deployment URL
5. Store in `deploys` table, update `projects.vercel_deployment_id`
6. Display in UI

**OAuth:** user connects Vercel once, we store refresh token encrypted.

**Custom domain:** defer to v1.5 (Vercel API supports it, just need UI + DNS verification flow).

---

## 7. GitHub sync

**OAuth scope:** `repo` (read + write to user's repos)

**Push flow:**
1. User clicks "Push to GitHub"
2. If repo doesn't exist: create via `POST /user/repos`
3. Commit current state: `POST /repos/{owner}/{repo}/git/commits`
4. Push: `POST /repos/{owner}/{repo}/git/refs`
5. Webhook: GitHub → our `/api/github/webhook` for `push` events
6. On webhook: pull latest, update local snapshot

**Auto-push:** if enabled in settings, every internal commit also pushes (batched, max 1 push/min).

---

## 8. Scaling considerations (post-MVP)

| Concern | MVP approach | v2 approach |
|---|---|---|
| Concurrent users per API gateway | Single 4-CPU box, 50 users | Horizontal scale behind LB |
| Sandbox density | 1 sandbox per project, suspend idle | Shared base image, copy-on-write |
| DB connections | Supabase pooler (PgBouncer) | Same |
| LLM rate limits | Per-user soft limit + retry | Token bucket + queue |
| File storage | Postgres `file_snapshots` (text) | S3-compatible for blobs |
| Build artifacts | Ephemeral in sandbox | Cache in DigitalOcean Spaces |
| Real-time scale | SSE per connection (10K connections per node) | Same; cluster by user hash |

---

## 9. Tech stack summary

| Layer | Choice | Why |
|---|---|---|
| **Web** | Next.js 14 + TS + Tailwind + shadcn/ui | Industry standard, Lovable/Bolt use same |
| **API** | Hono on Node 20 | Tiny, fast, TS-native |
| **Agent runtime** | Node 20 + Effect | Borrow Kilo's pattern; structured concurrency |
| **Database** | Supabase Postgres + pgvector (future) | Already in LadeStack stack; auth + storage |
| **Sandbox** | Daytona | Cheapest sustained sandbox; snapshot/restore |
| **Deploy** | Vercel | Best Next.js DX |
| **Auth** | Supabase Auth + custom JWT | Already familiar |
| **Billing** | Stripe | Global, India-friendly via Razorpay add-on |
| **Object storage** | DigitalOcean Spaces via rclone | Already in LadeStack stack |
| **LLM** | Anthropic (primary) + OpenAI + Gemini | Best models per task |
| **Monitoring** | PostHog + OpenTelemetry | Match Kilo's pattern; cheap |
| **Hosting** | DigitalOcean Droplet (code-server, Docker) | Solo founder infra |

---

## 10. Failure modes & mitigations

| Failure | Detection | Mitigation |
|---|---|---|
| LLM API down | Provider returns 5xx | Retry 3x with backoff; fallback to alternate provider; surface "AI temporarily unavailable" in UI |
| Sandbox crashes | Health check from gateway | Auto-restart; if 3x, recreate sandbox from snapshot |
| User exceeds rate | 429 from provider | Queue message; show "you're sending fast" toast |
| Build fails repeatedly | Same error 3x in 5 messages | Pause agent; ask user for guidance via `question` tool |
| Token cost spike | usage_events aggregated per session | Hard cap per session (configurable; default $2) |
| GitHub API rate limit | 403 from GitHub | Queue pushes; show "syncing" badge |
| Vercel deploy fails | Vercel webhook status=error | Show error in UI; preserve last working deploy |
| DB connection pool exhausted | Supabase returns 53300 | Connection retry; backoff; alert |
| Sandbox escape attempt | Unusual syscall / outbound | Network policy denies; sandbox destroyed; user flagged |

---

## 11. Open questions (call out for user)

1. **Daytona vs E2B vs self-hosted K8s** — Daytona is fastest path; defer self-host to v3.
2. **Anthropic as primary provider** — Claude Sonnet 4 is best for code; confirm OK to default.
3. **Effect framework** — adds learning curve; consider plain TS for v1, refactor to Effect later if needed.
4. **Postgres file storage** — fine for code; revisit if we add image upload.
5. **Vercel dependency** — accept the platform risk for MVP.

---

**End of system-design.md** — next: tool-calling.md
