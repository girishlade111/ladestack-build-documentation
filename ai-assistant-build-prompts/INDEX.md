# Step-by-Step Prompts — Kilo Code-style AI Assistant

This folder contains **25 sequential prompts** for building an **open-source AI coding assistant** that replicates Kilo Code's architecture and capabilities. Each prompt is focused on one feature and copy-paste ready into Cursor/Claude Code.

**Parent docs (in `ladestack-build-documentation/`) you should skim first:**
- `00-README.md` — project overview
- `02-competitive-research.md` — Kilo Code deep dive + skill inventories
- `03-system-architecture.md` — architecture reference
- `07-ai-skill-definition.md` — portable skill format

---

## How to use these prompts

1. Read `02-competitive-research.md` first to understand Kilo Code's architecture (we're cloning it).
2. Read `07-ai-skill-definition.md` for the skill format.
3. Open prompts in order (`01-` through `25-`).
4. For each prompt: open a fresh chat in your AI tool, paste the whole prompt, wait for completion, verify acceptance criteria, commit.
5. **Do NOT combine prompts.** Each is sized to fit in one AI context window.

---

## The 25 prompts

### Phase 1: Foundation (1-5) — Core runtime

| # | Title | Goal | Est. time |
|---|---|---|---|
| [01](./01-monorepo-bootstrap.md) | Monorepo bootstrap | Bun + TS + Effect framework workspace | 1-2 hr |
| [02](./02-cli-and-http-server.md) | CLI + HTTP server | `kilo` CLI binary + `kilo serve` HTTP/SSE | 2-3 hr |
| [03](./03-config-and-discovery.md) | Config + discovery paths | kilo.json + .kilo/.claude/.agents paths | 2 hr |
| [04](./04-provider-abstraction.md) | Multi-provider abstraction | 500+ models via Vercel AI SDK | 3-4 hr |
| [05](./05-byok-encryption.md) | BYO API key + encryption | AES-256-GCM + per-user key resolution | 2 hr |

### Phase 2: Tool system (6-12) — Agent tools

| # | Title | Goal | Est. time |
|---|---|---|---|
| [06](./06-tool-registry-pattern.md) | Tool registry pattern | `.ts` + `.txt` pair convention | 2 hr |
| [07](./07-filesystem-tools.md) | Filesystem tools | read, write, edit with read-before-write | 3-4 hr |
| [08](./08-search-tools.md) | Search tools | glob, grep with ripgrep | 2 hr |
| [09](./09-bash-tool.md) | Bash tool | shell exec with safety deny-list | 2 hr |
| [10](./10-meta-tools.md) | Meta tools | todowrite, question | 1-2 hr |
| [11](./11-plan-mode-tools.md) | Plan mode tools | plan_enter, plan_write, plan_exit | 2 hr |
| [12](./12-specialty-tools.md) | Specialty tools | apply_patch, recall, lsp, websearch | 3 hr |

### Phase 3: Agent system (13-17) — Multi-agent

| # | Title | Goal | Est. time |
|---|---|---|---|
| [13](./13-agent-schema-registry.md) | Agent schema + registry | Effect Schema, built-in agents | 2-3 hr |
| [14](./14-agent-system-prompts.md) | Agent system prompts | soul.txt + 10 agent .txt files | 1-2 hr |
| [15](./15-agent-execution-loop.md) | Agent execution loop | Core loop: prompt → LLM → tools → loop | 4-5 hr |
| [16](./16-multi-agent-subagents.md) | Subagents | explore, scout, summarize, title | 2-3 hr |
| [17](./17-orchestrator-wave-dispatch.md) | Orchestrator | Wave-based parallel subagent dispatch | 3 hr |

### Phase 4: Skills (18-22) — From internet

| # | Title | Goal | Est. time |
|---|---|---|---|
| [18](./18-skills-discovery.md) | Skills discovery service | SKILL.md scanner (`.kilo/`, `.claude/`, `.agents/`, bundled) | 2 hr |
| [19](./19-skill-bundle-programming.md) | **Programming skills bundle** | TypeScript/Python/Rust/Go/Java + web stacks | 3 hr |
| [20](./20-skill-bundle-devops.md) | **DevOps skills bundle** | K8s, Terraform, Docker, AWS, CI/CD, monitoring | 3 hr |
| [21](./21-skill-bundle-coder-productivity.md) | **Coder productivity bundle** | testing, review, debugging, refactoring, docs | 2-3 hr |
| [22](./22-skill-bundles-additional.md) | Additional bundles | AI/ML, security, performance, accessibility | 2-3 hr |

### Phase 5: Integrations (23-25)

| # | Title | Goal | Est. time |
|---|---|---|---|
| [23](./23-mcp-client.md) | MCP client | stdio + SSE + HTTP transports, OAuth | 3 hr |
| [24](./24-lsp-integration.md) | LSP integration | TypeScript/Python diagnostics | 2 hr |
| [25](./25-sessions-telemetry.md) | Sessions + telemetry | JSONL persistence + compaction + PostHog | 3 hr |

**Total estimated time: 55-75 hours of focused AI-assisted work.**

---

## Dependency graph

```
01 (monorepo)
   │
   └──┬── 02 (CLI + HTTP server)
      │
      ├── 03 (config)
      │
      ├── 04 (providers) ── 05 (BYOK)
      │
      └── 06 (tool registry)
             │
             ├── 07 (fs tools) ── 08 (search) ── 09 (bash) ── 10 (meta)
             │                                                      │
             └── 11 (plan mode) ── 12 (specialty) ──────────────────┤
                                                                    │
                                       13 (agent schema) ───────────┤
                                          │                         │
                                          └── 14 (system prompts) ───┤
                                                                    │
                                       15 (loop) ───────────────────┤
                                          │                         │
                                          ├── 16 (subagents)         │
                                          │                         │
                                          └── 17 (orchestrator) ────┤
                                                                    │
                                       18 (skills discovery) ──────┤
                                          │                         │
                                          ├── 19 (programming)      │
                                          ├── 20 (devops)           │
                                          ├── 21 (coder)            │
                                          └── 22 (additional)        │
                                                                    │
                                       23 (MCP) ── 24 (LSP) ── 25 (sessions/telemetry)
```

---

## Skills inventory (the "from internet" part)

Prompts 19-22 ship with skills surveyed from these public registries (see `02-competitive-research.md` for full data):

| Source | Skill count | Type | Where used |
|---|---|---|---|
| **Anthropic Official** (`anthropics/skills`) | 17 | All categories | Prompt 22 (AI/ML, design) |
| **wshobson/agents** (`github.com/wshobson/agents`) | 156 | Programming + DevOps | Prompts 19, 20, 21 |
| **antigravity-awesome-skills** (`sickn33/antigravity-awesome-skills`) | 560 (filtered) | All categories | Prompts 19-22 |
| **apify/agent-skills** (`github.com/apify/agent-skills`) | 5 | Scraping/automation | Prompt 22 |
| **apify/awesome-skills** | 11 | Use-case specific | Prompt 22 |
| **langgenius/dify/.agents/skills** | 6 | Component-specific | Prompt 19 |
| **subsy/ralph-tui/skills** | 4 | TUI/CLI patterns | Prompt 21 |

The skills are integrated as `SKILL.md` files in your `bundled/skills/` directory. The runtime discovers them at startup.

---

## Bundled skill categories (what each prompt ships)

### Prompt 19 — Programming skills bundle
- **Languages**: typescript-pro, python-pro, rust-engineer, go-concurrency-patterns, java-architect, kotlin-specialist, swift-expert, csharp-developer, cpp-pro
- **Web frontend**: react-expert, nextjs-app-router-patterns, vue-expert, sveltekit, astro, tailwind-design-system, shadcn-ui
- **Web backend**: nodejs-backend-patterns, python-fastapi, go-grpc, graphql-architect, hono
- **Database**: postgres-best-practices, postgres-pro, drizzle-orm-expert, sql-optimization-patterns

### Prompt 20 — DevOps skills bundle
- **Containers/K8s**: kubernetes-deployment, helm-chart-scaffolding, docker-security-hardening, k8s-manifest-generator
- **IaC**: terraform-infrastructure, terraform-engineer, pulumi patterns
- **Cloud**: aws-skills, cloudflare-workers-expert, gcp, azure
- **CI/CD**: github-actions-advanced, gitlab-ci-patterns, deployment-pipeline-design
- **Monitoring**: sre-engineer, monitoring-expert, prometheus-configuration, grafana-dashboards
- **Incident**: on-call-handoff-patterns, incident-runbook-templates, postmortem-writing

### Prompt 21 — Coder productivity skills bundle
- **Testing**: tdd, test-fixing, e2e-testing, playwright-expert, webapp-testing
- **Review**: code-review-excellence, requesting-code-review, simplify-code, refactor-helper
- **Debugging**: debugger, systematic-debugging, diagnosing-bugs, phase-gated-debugging
- **Performance**: pagespeed-enhancer, performance-optimizer, complexity-cuts
- **Docs**: doc-coauthoring, readme, api-documentation, tutorial-engineer, internal-comms
- **Git**: git-pr-review, changelog-automation, advanced-workflows

### Prompt 22 — Additional bundles
- **AI/ML**: prompt-engineer, rag-architect, llm-ops, embedding-strategies, vector-search, llm-evaluation
- **Security**: security-reviewer, owasp-top-10, pci-compliance, gdpr-data-handling, secret-scanner
- **Accessibility**: accessibility-compliance, wcag-audit-patterns
- **Frontend design**: frontend-design (Anthropic), canvas-design, brand-guidelines

---

## Architecture reminders (what you're building)

This assistant replicates Kilo Code's architecture (`02-competitive-research.md` §3):

```
┌──────────────────────────────────────────────────┐
│ Clients: CLI / TUI / Web / VS Code / JetBrains    │
└─────────────────┬────────────────────────────────┘
                  │ HTTP + SSE (kilo serve)
┌─────────────────▼────────────────────────────────┐
│ Agent Runtime (packages/opencode/)               │
│   ├── AgentService — registry, schema            │
│   ├── ToolService — registry (.ts+.txt pairs)     │
│   ├── SessionService — JSONL persistence          │
│   ├── ProviderService — multi-LLM adapter         │
│   ├── McpService — MCP client                     │
│   ├── LspService — LSP client                     │
│   └── PlanService — plan mode lifecycle           │
│                                                   │
│  Skills: bundled/ + .kilo/ + .claude/ + .agents/   │
│  Tools: read, write, edit, glob, grep, bash,      │
│         plan_*, todowrite, question, apply_patch,  │
│         recall, lsp, websearch                    │
└──────────────────────────────────────────────────┘
```

---

## What this assistant DELIBERATELY doesn't include

- ❌ Cloud-hosted control plane (Kilo is local-first; we follow the same philosophy)
- ❌ User accounts / multi-tenancy (local CLI user only; web auth is optional add-on)
- ❌ Paid LLM proxy / credit system (BYOK only; users pay providers directly)
- ❌ Mobile app / desktop GUI
- ❌ Plugin marketplace (curated bundles only; v2 can add community registry)

These are out of MVP scope. Add later if there's demand.

---

## Verification checkpoint

After prompt 25, you should have:

- [ ] Working `kilo` CLI with `kilo run`, `kilo serve` commands
- [ ] HTTP API at `localhost:3000/api/sessions/...`
- [ ] 8+ agents registered (build, plan, explore, scout, summarize, title, debug, ask, generate, orchestrator)
- [ ] 11+ tools working (read, write, edit, glob, grep, bash, plan_*, todowrite, question, apply_patch)
- [ ] 60+ bundled skills discoverable
- [ ] Plan mode functional (enter → write plan → exit → user review)
- [ ] Multi-agent loop with tool execution
- [ ] Subagent spawning via `task` tool
- [ ] MCP integration (optional)
- [ ] Session persistence + compaction
- [ ] Telemetry (PostHog)

Run `kilo run "echo hello"` to verify end-to-end.

---

**Ready?** Start with [01-monorepo-bootstrap.md](./01-monorepo-bootstrap.md).