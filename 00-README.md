# LadeStack Build

> AI-powered website builder. Open-core. Bring-your-own-model. Built for serious builders, not no-code tourists.

**Status:** Pre-development (PRD stage)
**Owner:** Girish Lade — LadeStack
**Created:** 2026-06-22

---

## What this is

LadeStack Build is a web application that generates, edits, and deploys **Next.js + Tailwind + shadcn/ui** applications from natural language. Users describe what they want; the AI builds it; the user sees a live preview side-by-side with the chat; the user can edit any file directly. Production-grade code, real ownership.

**Differentiators** (vs Lovable, Bolt):

1. **Open-core** — the agent runtime is MIT-licensed. Self-host it.
2. **Bring-your-own-model** — plug in Anthropic / OpenAI / Google API keys. Pay the model provider directly. We charge only for orchestration.
3. **Plan-mode-first** — every non-trivial request gets a written plan before any code is edited.
4. **Multi-agent loop** — borrowed from Kilo Code's architecture: plan, build, explore, scout, summarize, title agents.

---

## Quick links

- **[PRD.md](./PRD.md)** — Product Requirements Document (vision, scope, MVP, roadmap)
- **[research.md](./research.md)** — Deep research on Lovable, Bolt, Kilo Code
- **[system-design.md](./system-design.md)** — Architecture, infra, data flow
- **[tool-calling.md](./tool-calling.md)** — Tool registry, schemas, dispatch
- **[agent-loop.md](./agent-loop.md)** — AI loop, prompts, state mgmt
- **[design.md](./design.md)** — UI/UX system, components, layout
- **[skill.md](./skill.md)** — AI skill definition (for portable agent use)
- **[prompt.md](./prompt.md)** — Production system prompts

---

## How to read this repo (start here)

| If you are... | Read first |
|---|---|
| Product / business stakeholder | PRD.md → research.md |
| Engineer joining the project | system-design.md → agent-loop.md → tool-calling.md |
| Designer | design.md → PRD.md (FR sections) |
| AI agent / prompt engineer | skill.md → prompt.md → agent-loop.md |
| Just curious | PRD.md §1 + §3 (vision + MVP) |

---

## Architecture at a glance

```
Browser (Next.js 14)
   ├─ Chat panel + Monaco editor + Preview iframe
   │
   ▼ HTTPS + SSE
API Gateway (Hono on Node)
   │
   ├── Postgres (Supabase) — users, projects, sessions, messages, files
   ├── Agent Runtime (Node + Effect) — multi-agent loop
   ├── Sandbox Pool (Daytona) — one container per project
   └── Provider Layer (Anthropic / OpenAI / Google)
```

**Tech stack:**

| Layer | Choice |
|---|---|
| Web | Next.js 14, TypeScript, Tailwind, shadcn/ui, Zustand |
| API | Hono on Node 20 |
| Runtime | Node 20 + Effect (service composition) |
| Database | Supabase Postgres |
| Sandbox | Daytona (per-project containers) |
| Deploy | Vercel |
| Auth | Supabase Auth + custom JWT |
| Billing | Stripe |
| LLM | Anthropic (primary), OpenAI, Google Gemini |

---

## MVP scope (8 weeks)

**In scope:**
- Chat with Plan / Build mode toggle
- Multi-agent loop (build, plan, explore, scout, summarize, title)
- Tool registry (read, write, edit, glob, grep, bash, todowrite, question)
- Live preview (Vite dev server in sandbox, HMR via WebSocket)
- Monaco code editor with file tree
- GitHub sync
- Vercel deploy (one-click)
- BYO model key (Anthropic, OpenAI, Google)
- Email + Google + GitHub auth
- Token usage display
- Free + Pro tiers ($25/mo)

**Out of scope for v1:**
- Mobile app, desktop app
- Voice input
- 50+ integrations
- Custom Supabase provisioning per project
- Enterprise SSO / SOC 2
- Teams / workspaces
- Self-hostable single-VM deploy
- Figma import
- WebContainers (in-browser Node)

See PRD.md §3 for full scope.

---

## Development roadmap

| Phase | Scope | Target |
|---|---|---|
| **v1 (MVP)** | Chat + agent + preview + deploy + GitHub + BYO key | 8 weeks |
| v1.1 | Custom domain, 2FA, Stripe integration, better diffs | +2 weeks |
| v1.5 | Teams, central billing, template gallery | +4 weeks |
| v2 | Multi-agent orchestrator visible to user, git worktree per session, Figma import | +3 months |
| v2.5 | Voice input, mobile preview, A/B testing | +1 month |
| v3 | Enterprise SSO, SOC 2, self-hosted Docker Compose, plugin SDK | +6 months |

---

## Repository layout (planned)

```
ladestack-build/
├── apps/
│   ├── web/                  # Next.js 14 app
│   └── docs/                 # Documentation site
├── packages/
│   ├── runtime/              # Agent runtime (Effect services)
│   │   ├── src/agent/        # Agent registry + loop
│   │   ├── src/tools/        # Tool registry
│   │   ├── src/providers/    # LLM provider adapters
│   │   └── src/sandbox/      # Daytona integration
│   ├── sdk/                  # Auto-generated SDK (server API client)
│   └── ui/                   # Shared React components
├── infra/
│   ├── docker/               # Dockerfile, compose
│   └── terraform/            # IaC for self-hosted
├── prompts/
│   ├── soul.txt
│   ├── build.txt
│   ├── plan.txt
│   ├── explore.txt
│   ├── scout.txt
│   ├── summarize.txt
│   ├── title.txt
│   ├── environment.txt
│   └── tools.txt
└── docs/
    ├── PRD.md
    ├── research.md
    ├── system-design.md
    ├── tool-calling.md
    ├── agent-loop.md
    ├── design.md
    ├── skill.md
    └── prompt.md
```

---

## Key architectural inspirations

| From | What we borrowed |
|---|---|
| **Kilo Code** (`github.com/Kilo-Org/kilocode`) | Agent schema, tool registry pattern (.ts + .txt pairs), multi-agent system, plan mode (enter/exit), soul personality, wave-based orchestrator (v2) |
| **Lovable.dev** | Chat + preview side-by-side UX, Supabase default, GitHub sync, free → Pro pricing |
| **Bolt.new** | Plan/Build mode UX, multi-model routing, design system awareness, auto-test/refactor claims |

See `research.md` for detailed analysis.

---

## Pricing model

| Tier | Price | Includes |
|---|---|---|
| **Free** | $0 | 5 builds/day, BYO model key only, public projects, ladestack.app subdomain |
| **Pro** | $25/mo | Unlimited builds, private projects, custom domain, BYO + optional managed credits |
| **Teams** (v1.5) | $30/user/mo | Centralized billing, team workspace |

BYO model key is the differentiator — power users avoid the markup.

---

## Open questions (before locking v1)

1. Product name — "LadeStack Build" vs "LadeBuild" vs different?
2. $25/mo Pro — confirm OK, or test $20?
3. Free tier: BYO model key only, or include managed credits?
4. Self-host deferred to v3 — confirm?
5. Vercel as default deploy — accept platform risk?

See PRD.md §9.

---

## Contributing

Once the codebase is up:

- Issues: use the GitHub issue templates
- PRs: conventional commits (`feat(scope):`, `fix(scope):`, etc.)
- Changesets: required for user-facing changes (`bunx changeset add`)
- Style: see `AGENTS.md` once the repo is bootstrapped (borrowed from Kilo Code)

---

## License

- **Source code (planned):** MIT (open-core)
- **Documentation in this folder:** CC-BY-SA 4.0
- **Trademark:** "LadeStack" and "LadeStack Build" are trademarks of Girish Lade

---

## Status

This is the **PRD stage**. No code has been written yet. The next steps are:

1. Lock PRD with user feedback (this week)
2. Bootstrap monorepo (1 week)
3. Build runtime core + web shell (4 weeks)
4. Build preview sandbox + Monaco editor (2 weeks)
5. Beta with 20 power users (1 week)
6. Public launch (1 week)

See `research.md` and `system-design.md` for the deep dives that justify these decisions.

---

**Owner:** Girish Lade · **Last updated:** 2026-06-22 · **Status:** Draft v1
