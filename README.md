# LadeStack Build

> **Open-core, AI-powered website builder.** Generate, edit, and deploy production-grade Next.js + Tailwind + shadcn/ui applications from natural language. Plan-mode-first, multi-agent architecture, bring-your-own-model.

**Status:** Pre-development (Documentation complete, code pending)  
**Owner:** Girish Lade — LadeStack  
**Created:** 2026-06-22  
**License:** MIT (planned open-core)

---

## Overview

LadeStack Build is a web application that generates, edits, and deploys **Next.js + Tailwind + shadcn/ui** applications from natural language. Users describe what they want; the AI builds it; the user sees a live preview side-by-side with the chat; the user can edit any file directly.

### Differentiators

| Feature | LadeStack Build | Lovable / Bolt |
|---|---|---|
| **Open-core** | MIT-licensed agent runtime. Self-host it. | Proprietary |
| **Bring-your-own-model** | Plug in Anthropic / OpenAI / Google keys. Pay providers directly. | Locked to platform |
| **Plan-mode-first** | Every non-trivial request gets a written plan before code is edited. | Optional |
| **Multi-agent loop** | Plan, build, explore, scout, summarize agents. | Partial |

---

## Repository Contents

### Core Documentation

| File | Description |
|---|---|
| [`01-product-requirements.md`](./01-product-requirements.md) | Full PRD — vision, personas, MVP scope, roadmap, success metrics, risks |
| [`02-competitive-research.md`](./02-competitive-research.md) | Deep competitive analysis of Lovable, Bolt, Kilo Code |
| [`03-system-architecture.md`](./03-system-architecture.md) | System architecture, infrastructure, data flow |
| [`04-tool-calling-specification.md`](./04-tool-calling-specification.md) | Tool registry, schemas, dispatch |
| [`05-agent-execution-loop.md`](./05-agent-execution-loop.md) | AI loop, prompts, state management |
| [`06-ui-design-system.md`](./06-ui-design-system.md) | UI/UX system, components, layout |
| [`07-ai-skill-definition.md`](./07-ai-skill-definition.md) | Portable AI skill format for agent use |
| [`08-system-prompts.md`](./08-system-prompts.md) | Production system prompts |

### Build Prompt Suites

Two parallel sets of step-by-step AI build prompts — copy-paste ready for Cursor / Claude Code / Windsurf.

#### [`ai-assistant-build-prompts/`](./ai-assistant-build-prompts/) — 25 prompts

Builds a **Kilo Code-style AI coding assistant** (the agent runtime itself):

| Phase | Prompts | Scope |
|---|---|---|
| 1: Foundation | 01-05 | Monorepo, CLI, config, provider abstraction, encryption |
| 2: Tools | 06-12 | Tool registry, filesystem, search, bash, meta, plan, specialty |
| 3: Agents | 13-18 | Schema registry, system prompts, execution loop, subagents, orchestrator, skills |
| 4: Integration | 19-22 | Skill bundles (programming, devops, coder productivity, additional) |
| 5: Ship | 23-25 | MCP client, LSP integration, telemetry |

#### [`step-by-step-prompts/`](./step-by-step-prompts/) — 25 prompts

Builds the **LadeStack Build product itself** (the web application):

| Phase | Prompts | Scope |
|---|---|---|
| 1: Bootstrap | 01-04 | Monorepo, Next.js shell, Hono API, Supabase schema |
| 2: Agent Core | 05-09 | Sandbox, provider abstraction, prompts, schema registry, tools |
| 3: Execution | 10-14 | Sessions, agent loop, plan mode, subagents, system prompts |
| 4: UI | 15-18 | Chat panel, tool cards, input, state management |
| 5: Editor & Preview | 19-20 | File tree + Monaco, preview iframe |
| 6: Ship | 21-25 | GitHub sync, Vercel deploy, BYO keys, billing, launch |

---

## Architecture at a Glance

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

### Tech Stack

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

## MVP Scope (8 weeks)

### In Scope
- Chat with Plan / Build mode toggle
- Multi-agent loop (build, plan, explore, scout, summarize, title)
- Tool registry (read, write, edit, glob, grep, bash, todowrite, question)
- Live preview (Vite dev server in sandbox, HMR via WebSocket)
- Monaco code editor with file tree
- GitHub sync | Vercel deploy (one-click)
- BYO model key (Anthropic, OpenAI, Google)
- Email + Google + GitHub auth
- Token usage display | Free + Pro tiers ($25/mo)

### Out of Scope for v1
Mobile app, desktop app, voice input, Figma import, multi-tenant teams, WebContainers, enterprise SSO, self-hosted Docker Compose

---

## How to Read This Repo

| You are... | Start with |
|---|---|
| Product / business stakeholder | [`01-product-requirements.md`](./01-product-requirements.md) → [`02-competitive-research.md`](./02-competitive-research.md) |
| Engineer joining the project | [`03-system-architecture.md`](./03-system-architecture.md) → [`05-agent-execution-loop.md`](./05-agent-execution-loop.md) → [`04-tool-calling-specification.md`](./04-tool-calling-specification.md) |
| Designer | [`06-ui-design-system.md`](./06-ui-design-system.md) → PRD design sections |
| AI agent / prompt engineer | [`07-ai-skill-definition.md`](./07-ai-skill-definition.md) → [`08-system-prompts.md`](./08-system-prompts.md) → [`05-agent-execution-loop.md`](./05-agent-execution-loop.md) |
| Builder (using AI prompts) | [`step-by-step-prompts/INDEX.md`](./step-by-step-prompts/INDEX.md) or [`ai-assistant-build-prompts/INDEX.md`](./ai-assistant-build-prompts/INDEX.md) |
| Just curious | PRD §1 + §3 (vision + MVP) |

---

## Development Roadmap

| Phase | Scope | Target |
|---|---|---|
| **v1 (MVP)** | Chat + agent + preview + deploy + GitHub + BYO key | Wk 8 |
| **v1.1** | Custom domain, 2FA, Stripe, better diffs | +2 wk |
| **v1.5** | Teams, central billing, template gallery | +4 wk |
| **v2** | Multi-agent orchestrator, git worktree per session, Figma import | +3 mo |
| **v3** | Enterprise SSO, SOC 2, self-host Docker Compose, plugin SDK | +6 mo |

---

## Pricing

| Tier | Price | Includes |
|---|---|---|
| **Free** | $0 | 5 builds/day, BYO model key only, public projects, ladestack.app subdomain |
| **Pro** | $25/mo | Unlimited builds, private projects, custom domain, BYO + optional managed credits |
| **Teams** (v1.5) | $30/user/mo | Centralized billing, team workspace |

---

## Contributing

Once the codebase is live:
- Issues: use GitHub issue templates
- PRs: conventional commits (`feat(scope):`, `fix(scope):`)
- Changesets: required for user-facing changes (`bunx changeset add`)

---

## License

- **Source code (planned):** MIT (open-core)
- **Documentation:** CC-BY-SA 4.0
- **Trademark:** "LadeStack" and "LadeStack Build" are trademarks of Girish Lade

---

## Status

This is the **PRD and planning stage**. No application code has been written yet. The repository contains comprehensive documentation and two parallel sets of AI build prompts ready for execution.

**Next steps:**
1. Lock PRD with user feedback
2. Begin executing prompts from `step-by-step-prompts/` (Phase 1: Bootstrap)
3. Build runtime core + web shell (Wk 1-4)
4. Build preview sandbox + Monaco editor (Wk 5-6)
5. Beta with 20 power users (Wk 7)
6. Public launch (Wk 8)
