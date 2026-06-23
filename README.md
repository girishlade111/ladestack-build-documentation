# LadeStack Build Documentation

This repository contains the **complete product specification and AI build prompts** for LadeStack Build — an open-core, AI-powered website builder.

> **Looking for the product overview?** See [`00-README.md`](./00-README.md)

---

## Repository Map

```
📁 root
├── 00-README.md               ← Product overview (start here)
├── 01-*.md → 08-*.md          ← Core documentation (PRD → System Prompts)
│
├── step-by-step-prompts/      ← 25 prompts to build the LadeStack Build app
│   ├── INDEX.md
│   └── 01-monorepo-bootstrap.md → 25-testing-deployment-launch.md
│
└── ai-assistant-build-prompts/ ← 25 prompts to build a Kilo Code-style AI assistant
    ├── INDEX.md
    └── 01-monorepo-bootstrap.md → 25-sessions-telemetry.md
```

---

## Build Prompt Suites

These are **copy-paste ready prompts** for AI coding tools (Cursor, Claude Code, Windsurf, etc.). Each is scoped to a single task.

### `step-by-step-prompts/` — Build LadeStack Build (the web app)

| Phase | Prompts | What you get |
|---|---|---|
| Bootstrap | 01-04 | Monorepo, Next.js, Hono API, Supabase |
| Agent Core | 05-09 | Sandbox, LLM providers, prompts, schema, tools |
| Execution | 10-14 | Sessions, agent loop, plan mode, subagents |
| UI | 15-18 | Chat, tool cards, input, state |
| Editor & Preview | 19-20 | File tree, Monaco, preview iframe |
| Ship | 21-25 | GitHub, Vercel, BYO keys, billing, launch |

### `ai-assistant-build-prompts/` — Build a Kilo Code-style AI Assistant

| Phase | Prompts | What you get |
|---|---|---|
| Foundation | 01-05 | Monorepo, CLI, config, providers, encryption |
| Tools | 06-12 | Tool registry, filesystem, search, bash, meta tools |
| Agents | 13-18 | Schemas, prompts, execution loop, subagents, orchestrator, skills |
| Integration | 19-22 | Skill bundles (programming, devops, productivity) |
| Ship | 23-25 | MCP client, LSP, telemetry |

---

## How to Use the Prompts

1. **Read the INDEX.md** in the prompt suite folder first
2. **Read the prerequisite docs** referenced in each INDEX
3. **Open prompts in order** — each builds on the previous
4. **Copy the entire prompt** into a fresh AI chat
5. **Verify acceptance criteria** and commit before moving on

---

## Core Documentation Index

| # | File | Covers |
|---|---|---|
| 01 | `01-product-requirements.md` | Vision, personas, MVP scope, roadmap, metrics, risks |
| 02 | `02-competitive-research.md` | Lovable, Bolt, Kilo Code deep dive |
| 03 | `03-system-architecture.md` | Architecture, infra, data flow |
| 04 | `04-tool-calling-specification.md` | Tool registry, schemas, dispatch |
| 05 | `05-agent-execution-loop.md` | AI loop, prompts, state management |
| 06 | `06-ui-design-system.md` | UI/UX system, components, layout |
| 07 | `07-ai-skill-definition.md` | Portable AI skill format |
| 08 | `08-system-prompts.md` | Production system prompts |

---

**Owner:** Girish Lade · **Status:** Pre-development (docs complete) · **Last updated:** 2026-06-23
