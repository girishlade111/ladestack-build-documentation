# Research: Lovable.dev, Bolt.new, Kilo Code

**Date:** 2026-06-22
**Author:** Research for AI-powered website builder PRD (LadeStack)
**Sources:**
- Lovable: lovable.dev, docs.lovable.dev (live pages captured 2026-06-22)
- Bolt.new: bolt.new (homepage + pricing captured 2026-06-22)
- Kilo Code: github.com/Kilo-Org/kilocode (shallow clone of main branch, 2026-06-22)

---

## 1. Executive summary

The "vibe-coding" / AI website-builder market in mid-2026 has converged on a clear product shape:

| Dimension | Consensus pattern |
|---|---|
| **Input** | Natural-language prompt + optional screenshot / Figma / GitHub import |
| **AI mode** | Two toggle modes: **Standard** (direct code) and **Plan** (read-only plan first, then build) |
| **Output** | Live in-browser preview side-by-side with chat; full code visible & editable |
| **Stack** | React/Next.js + Tailwind + shadcn/ui as the default; Supabase as default backend |
| **Pricing** | Free → $25 Pro → $30-50 Teams/Business → Enterprise (custom) |
| **Distribution** | Lovable/Bolt use **credits** and **tokens** respectively to meter AI cost |
| **AI loop** | Tool-calling agent with edit/read/grep/glob/bash tools; multi-step loop with message history + compaction |
| **Differentiation** | Bolt = multi-model auto-routing + design system import; Lovable = integrations + full-stack polish |

**Key takeaway for LadeStack:** do NOT try to out-feature Lovable or Bolt. They have 100+ engineers and millions in funding. The realistic wedge is **(a) a coding-agent-grade loop (Kilo Code style) — plan-mode-first, multi-agent, worktree-isolated** combined with **(b) tight LadeStack brand + free + no-login DX** for the indie/dev audience.

---

## 2. Lovable.dev

### 2.1 Product shape

Lovable is a **full-stack AI development platform**: frontend + backend + database + auth + integrations, all generated from natural language. Code is real, editable, and can be synced to GitHub.

Key facts (from live scrape, 2026-06-22):

| Item | Value |
|---|---|
| Tagline | "AI App Builder — Vibe Code Apps & Websites with AI, Fast" |
| Primary entry | Single chat input on home page ("Build something Lovable") |
| Pricing tiers | Free · Pro $25 · Business $50 · Enterprise (custom) |
| Free credits | 5 daily (per FAQ) |
| Pro credits | 100/mo (more available) |
| Compliance | SOC 2 Type II, GDPR, ISO 27001 |
| Code ownership | User owns all generated code |
| GitHub sync | Yes (each project can be synced) |
| Backend default | Supabase (deep integration) |
| Auth default | Lovable Cloud / Supabase Auth |

### 2.2 Feature inventory (live scrape)

**Chat input area** has these tools visible:
- Chat input (textarea)
- Additional actions button
- Plan mode toggle ("Enable plan mode" / "Build")
- Voice recording button
- Send button

**Distribution surfaces (from sitemap + footer):**
- Web app
- Lovable desktop app
- Lovable mobile app
- Lovable MCP server
- Lovable ChatGPT app
- Lovable in Telegram
- Lovable API: Build with URL (the public API for headless build)

**Workspaces:**
- Shared workspaces for teams
- Project folders
- People & admin settings
- Privacy & security controls
- 2FA support

**Integrations (50+ live):** Supabase, Stripe, Airtable, Algolia, Asana, AWS S3, BigQuery, Brevo, Chargebee, Contentful, Databricks, ElevenLabs, Firecrawl, HubSpot, Inngest, Linear, LinkedIn, Mailgun, Microsoft, Notion, Perplexity, Pipedrive, Replicate, Resend, Salesforce, Semrush, Shopify, Slack, Snowflake, Storyblok, Telegram, TikTok, Twilio, Twitch, Wave, Wix, Wiz.

**Target users** (from "Who Lovable is for"):
- Individual builders
- Product / design / GTM teams
- Technical teams and agencies
- Enterprises (security + governance)

### 2.3 Pricing & unit economics

Lovable uses **credits** as the metering primitive. FAQ confirms:
- Free tier has daily credit grants (does not stack)
- Paid credits roll over month-to-month
- Subscriptions are shared across unlimited users in a workspace
- Token costs vary by model — credits abstract this away from the user

This is a deliberate **ergonomic choice**: end users do not want to count tokens. They want to count "how many meaningful changes can I make today?"

### 2.4 Lovable system design (inferred)

Based on documentation + UI + the API endpoint:

```
┌──────────────────────────────────────────────────────────────┐
│ Browser (Next.js chat + iframe preview)                      │
│  ├─ Chat UI (React)                                          │
│  ├─ File tree / code editor (Monaco)                         │
│  ├─ Live preview (iframe sandbox pointing at build worker)   │
│  └─ Plan-mode toggle                                         │
└────────────────────────────┬─────────────────────────────────┘
                             │ WebSocket / SSE
                             ▼
┌──────────────────────────────────────────────────────────────┐
│ Backend (proprietary — likely Node/TS + Postgres)             │
│  ├─ Conversation store                                       │
│  ├─ Build worker pool (Vite + esbuild per project)           │
│  ├─ AI router (Claude / GPT routing)                         │
│  ├─ Tool-use loop (similar to Kilo Code)                     │
│  ├─ Supabase provisioning per project                        │
│  └─ GitHub sync service                                      │
└──────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────┐
│ Per-project ephemeral sandbox                                │
│  ├─ Vite dev server (with HMR over WS)                       │
│  ├─ Supabase project (managed Postgres + auth)               │
│  └─ Generated codebase (React + Vite + Tailwind + shadcn)    │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. Bolt.new (by StackBlitz)

### 3.1 Product shape

Bolt is a **browser-based AI coding agent** built on WebContainers (StackBlitz's in-browser Node runtime). This is its key technical moat — Bolt does not need a remote sandbox for most code; the dev server runs in the user's browser.

Key facts (live scrape):

| Item | Value |
|---|---|
| Tagline | "AI builder: Websites, apps & prototypes" |
| Pricing model | **Tokens** (not credits) — Free 1M/mo, Pro 10M+/mo, Teams $30/user, Enterprise |
| Free tier | 300K tokens daily + 1M monthly; 333K web requests/mo; Bolt branding |
| Pro tier | $25/mo; no daily limit; 10M+ tokens; custom domains; no branding; private sharing; AI image editing |
| Teams tier | $30/user/mo; centralized billing; private NPM; design system prompts per-package |
| Multi-model | **Automatic model routing** — picks Claude / GPT / etc. per task ("The best model, every time") |
| Default stack | Next.js + Vite + Tailwind + shadcn or Material UI / Chakra / Chakra |
| Import | Figma + GitHub |

### 3.2 Headline claims (from Bolt homepage)

- **"98% less errors"** — Bolt auto-tests, refactors, iterates
- **"Build big without breaking"** — "Bolt handles projects 1,000 times larger than before. Its improved built-in context management can handle complexity"
- **Unlimited databases** — Built-in
- **Enterprise-grade** — SSO, audit logs, compliance
- **User management & authentication** — Built-in
- **SEO optimization** — Built-in
- **Hosting with analytics & custom domains** — Built-in

### 3.3 Bolt's "Standard" vs "Plan" mode

This is the same toggle pattern as Lovable. Two buttons next to the chat input:
- **Standard** — direct code
- **Plan** — first produce a written plan, then execute

Both modes are exposed as the same `Plan` tool (enter / exit) in the underlying agent — the toggle is just a UI hint to the routing layer.

### 3.4 Bolt's design system import

Bolt ships pre-built knowledge of:
- Porsche Design System
- Material UI (Material Design)
- Chakra UI
- Shadcn UI
- Washington Post Design System

When you select one, the agent knows the component library's API surface and design tokens.

### 3.5 Bolt technical moat (WebContainers)

WebContainers (acquired by StackBlitz in 2023) runs Node.js in the browser via WebAssembly. This means:
- Zero cold-start for dev servers
- No remote sandbox cost per user
- Instant HMR (Hot Module Reload)
- Trade-off: limited to browser-compatible Node APIs (no native binaries, no system Docker)

**This is a major capital advantage** — Bolt's per-user compute cost is dramatically lower than Lovable's remote-sandbox approach. Lovable offsets this with deeper integration backend (Supabase provisioning, real auth, real deploys).

---

## 4. Kilo Code (open source)

### 4.1 What it is

Kilo Code (Kilo CLI) is an **open-source AI coding agent**, fork of [opencode](https://github.com/anomalyco/opencode). It is **NOT** a website builder — it is a general-purpose coding agent (similar in scope to Claude Code, Cursor, or Aider). However, its architecture is the cleanest open-source reference for **how an agentic AI loop should be structured**, which is exactly what we need for our builder.

> **Why this matters for our PRD:** Lovable and Bolt do not publish their AI loop internals. Kilo Code does (it's the same agentic pattern, just applied to arbitrary codebases instead of website building). We can borrow the architecture wholesale and specialize the tool set.

### 4.2 Repository layout (key packages)

| Package | Purpose |
|---|---|
| `packages/opencode/` | **Core engine**: agent runtime, tools, sessions, HTTP server, TUI. The CLI itself. |
| `packages/sdk/js/` | Auto-generated TypeScript SDK (client for the server HTTP+ SSE API) |
| `packages/kilo-vscode/` | VS Code extension (sidebar chat + **Agent Manager**) |
| `packages/kilo-jetbrains/` | JetBrains IDE plugin |
| `packages/kilo-gateway/` | Kilo auth, provider routing, API integration |
| `packages/kilo-telemetry/` | PostHog analytics + OpenTelemetry |
| `packages/kilo-i18n/` | Internationalization |
| `packages/kilo-ui/` | SolidJS component library |
| `packages/kilo-vscode/webview-ui/` | SolidJS-based webview UI for the extension |
| `packages/llm/` | LLM integration layer |
| `packages/containers/` | Sandbox / container mgmt |
| `packages/plugin/` | Plugin / tool interface definitions |

### 4.3 Agent architecture (the gold)

Kilo's agent system is the cleanest open-source reference I have seen. Key files in `packages/opencode/src/agent/`:

- `agent.ts` (571 lines) — Agent **Service** with Effect framework, schema-driven agent configs
- `generate.txt` — System prompt for the **meta-agent** that creates new agents on demand
- `prompt/explore.txt` — Read-only file-search subagent
- `prompt/orchestrator.txt` — Multi-agent wave-based coordinator
- `prompt/scout.txt` — Lightweight exploration agent
- `prompt/summary.txt` — Conversation summary
- `prompt/compaction.txt` — Token-saving context compression
- `prompt/title.txt` — Auto-titling
- `prompt/ask.txt` — Q&A without file edits
- `prompt/debug.txt` — Debugging specialist

**Built-in agents** (from `agent.ts`):

| Agent | Purpose | Mode |
|---|---|---|
| `build` | Default code-writing agent (primary) | primary |
| `generate` | Meta-agent: generates new agent configs from natural language | primary |
| `explore` | Read-only file search via glob/grep/read | subagent |
| `orchestrator` | Plans tasks into waves, dispatches parallel subagents | primary |
| `scout` | Lightweight exploration (no full read) | subagent |
| `summary` | Compresses prior messages | subagent |
| `compaction` | Aggressive token-saver for long sessions | subagent |
| `title` | Generates session titles | subagent |
| `ask` | Q&A, no file modifications | primary |
| `debug` | Debugging specialist | primary |
| `plan` | Read-only plan-only mode (read tools, no edit) | primary |

**Agent schema** (Zod-validated):

```ts
{
  name: string
  displayName?: string
  description?: string
  deprecated?: boolean
  mode: "subagent" | "primary" | "all"
  native?: boolean       // built-in vs user-defined
  hidden?: boolean
  topP?: number
  temperature?: number
  color?: string
  permission: Permission.Ruleset
  model?: { modelID, providerID }
  variant?: string
  prompt?: string        // path to .txt file or inline string
  options: Record<string, unknown>
  steps?: number         // max tool-call steps
}
```

### 4.4 Tool registry

`packages/opencode/src/tool/` contains:

| Tool | File | Purpose |
|---|---|---|
| `write` | write.ts + write.txt | Write a file (requires read first if exists) |
| `edit` | edit.ts + edit.txt | Exact-string edit |
| `read` | read.ts + read.txt | Read file with line numbers |
| `glob` | glob.ts + glob.txt | File pattern match |
| `grep` | grep.ts + grep.txt | Content regex search |
| `bash` | bash.ts + bash.txt | Shell execution |
| `plan` | plan.ts + plan-enter.txt + plan-exit.txt | Enter/exit plan mode |
| `question` | question.ts + question.txt | Ask the user a question |
| `lsp` | lsp.ts + lsp.txt | Language Server Protocol integration |
| `mcp-websearch` | mcp-websearch.ts | Web search via MCP |
| `recall` | recall.ts + recall.txt | Conversation history recall |
| `todowrite` | todowrite.txt | Todo list management |
| `warpgrep` | warpgrep.ts + warpgrep.txt | Kilo-specific grep variant |
| `apply_patch` | apply_patch.ts + apply_patch.txt | Structured patch application |
| `repo_clone` | repo_clone.ts + repo_clone.txt | Clone a git repo |
| `repo_overview` | repo_overview.ts + repo_overview.txt | High-level repo summary |

**Critical insight:** every tool is a pair of files:
- `.ts` — the implementation (TypeScript with Zod input schema + Effect service)
- `.txt` — the tool's **system-prompt description** that gets injected into the LLM context

This separation is a major cleanliness win — the LLM sees only the `.txt` descriptions; the implementation is hot-swappable.

### 4.5 Multi-agent orchestration pattern (the "orchestrator" prompt)

Quoted directly from `packages/opencode/src/agent/prompt/orchestrator.txt`:

```
You are a strategic workflow orchestrator who coordinates complex tasks
by delegating them to appropriate specialized agents.

Guidelines:
1. Understand the task first. Use explore agents to research the codebase
   and identify the files, patterns, and architecture relevant to the task.
2. Make a plan. Break the task into subtasks and for each subtask note
   which files it will likely touch.
3. Classify dependencies before executing anything:
   - Which subtasks are independent? These go in the same wave (parallel).
   - Which subtasks need prior output? These go in a later wave.
   - All agents share the same working directory. If two subtasks are
     likely to edit the same files, they MUST be in different waves.
   - When uncertain, run sequentially.
4. Execute wave by wave. Launch all subtasks in a wave as parallel tool
   calls in a single message. Wait, analyze, start the next wave.
5. For each subtask, use the task tool with the appropriate agent type:
   - "explore" for codebase research
   - "general" for implementation
6. When all waves complete, synthesize the results.
7. Do not edit files directly. Delegate all implementation.
```

**This is the heart of the agentic loop we want.** Wave-based parallelism + dependency analysis before launch.

### 4.6 Plan mode (the user-facing toggle)

Both Lovable and Bolt expose a "Plan" toggle. Kilo implements it via:

- **`plan-enter` tool**: User (or agent) calls this when entering plan mode
- **`plan-exit` tool**: Plan agent writes a plan file, calls this tool, hands control back
- **`plan.ts`**: Implementation that swaps the active agent to `plan` (read-only) and locks edit tools

This pattern lets us reuse the same UI toggle across both modes — the toggle is just a state flag.

### 4.7 The soul — Kilo's personality (soul.txt)

Kilo's personality is **direct, technical, no fluff**:

> You are Kilo, a highly skilled software engineer with extensive knowledge in many programming languages, frameworks, design patterns, and best practices.
>
> - Your goal is to accomplish the user's task, NOT engage in a back and forth conversation.
> - You accomplish tasks iteratively, breaking them down into clear steps and working through them methodically.
> - Do not ask for more information than necessary. Use the tools provided.
> - You are STRICTLY FORBIDDEN from starting your messages with "Great", "Certainly", "Okay", "Sure". You should NOT be conversational in your responses.
> - NEVER end your result with a question or request to engage in further conversation.

**This personality maps directly onto our builder's agent** — the LadeStack brand voice is sharp, minimal, developer-first, no fluff. Perfect alignment.

### 4.8 Effect framework adoption

Kilo uses [@effect](https://effect.website/) heavily (a TypeScript functional programming framework, similar to fp-ts but more ergonomic):

```ts
// Service pattern
export class Service extends Context.Service<Service, Interface>()("@opencode/Agent") {}

// Composable layers
export const layer = Layer.effect(Service, Effect.gen(function* () {
  const config = yield* Config.Service
  const auth = yield* Auth.Service
  // ...
}))

// Runtime safety
const agent = yield* Service.get("build")
```

**Pros:**
- Composable service dependencies (testable, swappable)
- Structured error handling (no empty `catch` blocks)
- Type-safe with Zod / Schema integration

**Cons for us:**
- Steep learning curve for a solo founder
- Smaller ecosystem than plain TypeScript

**Recommendation:** Use Effect for the core agent runtime (where it pays off) but plain TS/Express for the API layer.

### 4.9 Communication architecture

Kilo's products all use the same pattern:
1. `kilo serve` starts an HTTP server + SSE endpoint
2. CLI, VS Code extension, JetBrains plugin all spawn or connect to this server
3. They communicate via `@kilocode/sdk` (auto-generated TypeScript client)
4. Sessions are persisted; can be replayed, resumed, exported

**For our builder:** this maps perfectly. The Next.js web app is a thin client; the agent runtime is a long-lived server.

---

## 5. Comparison matrix

| Capability | Lovable | Bolt | Kilo Code | Our Builder (proposed) |
|---|---|---|---|---|
| **Input** | Chat + screenshot | Chat + Figma + GitHub | Chat (in IDE) | Chat + screenshot + URL |
| **AI mode toggle** | Plan / Build | Standard / Plan | Plan / Build | Plan / Build (Kilo pattern) |
| **Multi-model** | Anthropic primary | Auto-routed | 500+ providers | Start: Gemini + Claude; expand |
| **Live preview** | iframe | WebContainer (in-browser) | IDE-based | iframe pointing at Vite dev server |
| **Code editor** | Monaco (built-in) | Monaco (built-in) | VS Code / JetBrains | Monaco (built-in) |
| **Backend** | Supabase per project | Limited / in-browser | Whatever the code uses | Supabase per project |
| **Auth** | Built-in (Lovable Cloud) | Built-in | N/A | Supabase Auth |
| **Hosting** | Built-in | Built-in | N/A | Vercel deploy |
| **GitHub sync** | Yes | Yes | N/A | Yes |
| **Multi-agent** | Unknown (likely) | Unknown (likely) | Yes (wave-based) | Yes (wave-based, Kilo pattern) |
| **Pricing** | Credits ($25/mo) | Tokens ($25/mo) | Free / OSS | Free tier + token-based paid |
| **Open source** | No | No | Yes (MIT) | Core = free; ops = paid |
| **Self-hostable** | No | No | Yes | Yes (differentiator!) |
| **Working directory model** | Per-project ephemeral | WebContainer | Git worktree | Git worktree (differentiator!) |

---

## 6. Differentiation strategy for LadeStack

We CANNOT beat Lovable or Bolt on raw funding, team size, or features. What we CAN beat them on:

### 6.1 Open-source core (Kilo-style)

Make the **agent runtime open-source**. Sell hosted convenience. This is the GitLab vs GitHub playbook — works.

### 6.2 Self-hostable

Single-VM Docker compose that runs the whole thing. Lovable/Bolt cannot do this. Indian SMBs, EU data-residency customers, education — all want this.

### 6.3 Multi-agent wave-based loop (Kilo pattern)

Borrow the orchestrator + explore + scout + plan + build agent split. Bolt claims "1000x larger projects" via context management; wave-based parallelism is the actual implementation.

### 6.4 Plan mode first

Lovable and Bolt have plan mode but treat it as a UI toggle. We make it the **default** for any non-trivial request. The user sees a written plan, can edit it, then approves. This is the right default for a tool that targets serious builders.

### 6.5 Git worktree isolation (Kilo Agent Manager pattern)

Run each user session in an isolated git worktree. User can have N parallel sessions without conflicts. Diff between sessions. Branch per session. This is **unique** in the website-builder market.

### 6.6 Bring-your-own-model

Lovable locks to its own credits. Bolt auto-routes but you cannot choose. We let users plug in their own OpenRouter / Anthropic / OpenAI / Gemini key and pay the model provider directly. We charge only for the orchestration layer. **This is a massive trust + cost-savings wedge.**

### 6.7 LadeStack brand fit

LadeStack already has: LS PDF, LadeStack Coder, LadeDesign, LS Docs, LS CLI. A website-builder product (call it **LadeStack Build** or **LadeBuild**) completes the suite. Every existing product gets a "Build me an app for this" entry point.

---

## 7. What to copy, what to skip

### Copy directly

| Pattern | Source | Why |
|---|---|---|
| Agent schema (Zod-validated, mode + prompt + tools) | Kilo | Battle-tested, simple |
| Tool registry pattern (`.ts` + `.txt` pairs) | Kilo | Clean separation |
| Plan mode (enter / exit tools) | Kilo | Both Lovable and Bolt use this UI; Kilo has the cleanest impl |
| Wave-based orchestrator | Kilo | Genuinely novel vs Lovable/Bolt |
| `soul.txt` personality | Kilo | Direct, technical, anti-sycophancy |
| HTTP server + SSE + SDK client | Kilo | Mature multi-client architecture |
| Next.js + Tailwind + shadcn default | Lovable + Bolt | Industry standard |
| Supabase for backend + auth | Lovable | Best-in-class DX |
| GitHub sync | Lovable + Bolt | Table stakes |
| Free → Pro → Teams pricing | Lovable + Bolt | Proven |

### Skip (out of scope for v1)

- WebContainers (Bolt's moat — too complex to replicate)
- 50+ integrations (Lovable — defer to user-driven API)
- Custom domain hosting (defer to Vercel deploys)
- Voice input (defer)
- Mobile app (defer)
- Enterprise SSO / SOC 2 (defer to v3)

### Innovate

- Open-source core (Kilo's license + our UX layer)
- Git worktree isolation per session
- BYO model key (OpenRouter / Anthropic / OpenAI / Gemini)
- Self-hostable single-VM Docker compose
- Plan-mode-first UX
- Multi-agent with named visible subagents (user sees the orchestrator dispatch)
- Inline diff view between sessions

---

## 8. Open questions to validate with users (before build)

1. **Bring-your-own model key vs credits?** — BYO key is cheaper for power users but worse UX for newcomers. Default: BYO with optional managed credits.
2. **Single VM self-host vs hosted?** — Both? Hosted first, self-host as v1.5.
3. **Free tier limits?** — Generous free (5 builds/day?) to drive adoption.
4. **Pricing for hosted?** — Match Bolt/Lovable $25/mo Pro, but with usage-based upsell.

---

## 9. Sources

- Lovable homepage — https://lovable.dev/ (captured 2026-06-22)
- Lovable docs welcome — https://docs.lovable.dev/introduction/welcome (captured 2026-06-22)
- Lovable pricing — https://lovable.dev/pricing (captured 2026-06-22)
- Lovable Supabase integration — https://docs.lovable.dev/integrations/supabase (captured 2026-06-22)
- Bolt.new homepage — https://bolt.new/ (captured 2026-06-22)
- Bolt.new pricing — https://bolt.new/pricing (captured 2026-06-22)
- Kilo Code repo — https://github.com/Kilo-Org/kilocode (shallow clone 2026-06-22)
  - `AGENTS.md` (211 lines)
  - `packages/opencode/src/agent/agent.ts` (571 lines)
  - `packages/opencode/src/agent/prompt/{explore,orchestrator,scout,summary,compaction,title}.txt`
  - `packages/opencode/src/tool/{write,edit,read,glob,grep,plan}.{ts,txt}`
  - `packages/opencode/src/kilocode/soul.txt` (Kilo personality)
  - `packages/opencode/src/kilocode/agent/builder.ts` (agent builder)
  - `packages/opencode/specs/v2/message-shape.md` (planned message API)
  - `packages/opencode/specs/effect/*.md` (Effect framework guides)

---

**End of research.md** — next: PRD.md
