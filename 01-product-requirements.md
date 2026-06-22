# PRD: LadeStack Build — AI Website Builder

**Status:** Draft v1 (2026-06-22)
**Author:** Girish Lade (LadeStack)
**Related docs:** research.md, system-design.md, tool-calling.md, agent-loop.md, design.md, skill.md, prompt.md, README.md

---

## 1. Vision

**LadeStack Build** is an open-core, AI-powered website and web-app builder. It generates, edits, and deploys production-grade Next.js + Tailwind + shadcn/ui applications from natural language, with a transparent multi-agent loop that the user can see, pause, and steer in real time.

We do not try to out-feature Lovable or Bolt. We win on three axes that neither can match:

1. **Open-source core.** The agent runtime ships under MIT. Anyone can self-host.
2. **Bring-your-own model key.** Plug in OpenRouter / Anthropic / OpenAI / Gemini directly. Pay the model provider. We charge only for orchestration.
3. **Git worktree isolation per session.** Run N parallel AI sessions on the same project without conflicts. Diff between sessions. Branch per session. Real developer muscle memory applied to AI building.

---

## 2. Personas

### P1 — Indie hacker / solo founder ("Vibe coder")

- Builds side projects and SaaS prototypes in evenings/weekends
- Uses Cursor, Claude Code, v0, Lovable, Bolt interchangeably
- Cares about: speed from idea to deployed URL, cost ($25/mo is real money), ability to ship then own the code
- Will NOT pay $25/mo if the free tier blocks what they need
- Wants: free tier that lets them ship 1-2 real projects/mo

### P2 — Professional front-end / full-stack dev

- Has a day job, building tools or product on the side
- Knows React/Next, prefers code over no-code
- Will use the agent for boilerplate, but wants to drop into the code editor and own the rest
- Wants: real Monaco editor with file tree, monorepo-grade multi-file changes, plan-mode-first UX

### P3 — Designer who codes

- Figma-fluent, light React/CSS
- Wants to ship landing pages and portfolio sites fast
- Cares about: visual fidelity, design system import (Shadcn, MUI, Chakra)
- Wants: Figma import, live preview, one-click deploy

### P4 — Agency / small team (v1.5+)

- 3-10 people delivering client websites
- Needs multi-user, central billing, white-label (defer to v2)

---

## 3. MVP (v1) — Ship in 8 weeks

### 3.1 MVP scope (must-have, ship-blocking)

#### Core surface
- **Single chat input** with natural-language prompt
- **Plan / Build mode toggle** (default to Plan for any request > 1 sentence)
- **Live preview pane** (iframe pointing at Vite dev server, HMR over WebSocket)
- **Monaco code editor** with file tree (read + edit)
- **Project dashboard** — list, create, delete, rename projects
- **GitHub sync** — push to a GitHub repo on user demand (one-click)

#### AI agent
- **Multi-agent loop** with at least these agents:
  - `build` — primary code-writing agent
  - `plan` — read-only planning agent (default for non-trivial)
  - `explore` — read-only file search subagent
  - `scout` — lightweight exploration
  - `orchestrator` — wave-based parallel subagent dispatch
- **Tool registry** with at minimum:
  - `read`, `write`, `edit`, `glob`, `grep`, `bash`
  - `plan-enter`, `plan-exit`
  - `todowrite`, `question`
- **Provider support:** Anthropic (Claude Sonnet + Haiku), OpenAI (GPT-4o, GPT-4o-mini), Google Gemini (2.5 Pro/Flash)
- **BYO model key** — user enters API key in settings, encrypted at rest
- **Token usage display** in chat (per-message + total)

#### Project lifecycle
- **Create project** from chat prompt
- **Edit project** by sending follow-up messages
- **Iterate** — chat remembers full project context (with compaction)
- **Versioning** — every AI message creates a git commit (auto)
- **Session replay** — can scroll back through chat and code state

#### Deployment (basic)
- **Vercel deploy** integration (one-click, OAuth-based)
- **Preview URL** per project (assigned subdomain: `<hash>.ladestack.app`)
- **Custom domain** (defer to v1.5)

#### Auth & accounts
- **Email + password** with verification
- **OAuth** — Google + GitHub
- **Personal projects** (single-user, single-workspace)
- **2FA** for paid tiers (defer to v1.5)

### 3.2 Out-of-scope for MVP (explicit non-goals)

- ❌ Mobile app
- ❌ Desktop app
- ❌ Voice input
- ❌ Telegram / ChatGPT integrations
- ❌ 50+ third-party integrations (Stripe, Algolia, etc.) — defer to v2
- ❌ Custom Supabase provisioning per project — start with hosted Postgres
- ❌ Enterprise SSO / SOC 2
- ❌ Teams / workspaces (single-user only in v1)
- ❌ White-label / agency mode
- ❌ Bolt-style design system import (Figma, Material, etc.)
- ❌ WebContainers (in-browser Node) — out of scope; use remote sandbox

### 3.3 Pricing for MVP

| Tier | Price | Includes |
|---|---|---|
| **Free** | $0 | 5 builds/day, BYO model key, public projects only, ladestack.app subdomain |
| **Pro** | $25/mo OR $20/mo annual | Unlimited builds, private projects, custom domain, BYO model key + fallback to our managed credits |
| **Teams** (v1.5) | $30/user/mo | Centralized billing, team workspace, shared projects |

**Rationale:** Match Lovable/Bolt price points. BYO model key is the differentiator — power users avoid the markup.

---

## 4. Roadmap (post-MVP)

### v1.1 (2 weeks after MVP)
- Custom domain support
- 2FA
- Stripe integration (one of the "table-stakes" integrations)
- File upload (images, fonts) via UI
- Better diff viewer (split-pane)

### v1.5 (1 month after MVP)
- Teams / workspaces
- Centralized billing
- Private NPM registry support (for enterprise-ish customers)
- Public template gallery
- Better error reporting and crash recovery

### v2 (Q3 2026)
- **Multi-agent visible to user** — user sees orchestrator dispatching subagents in real time (the Bolt-style "98% fewer errors" claim, made visible)
- **Git worktree per session** — N parallel sessions, diff/merge UI between them
- **Figma import** (parse Figma JSON, generate matching components)
- **Design system knowledge packs** (Shadcn, MUI, Chakra)

### v2.5
- Voice input
- Mobile preview (responsive testing in-IDE)
- A/B test built into the deploy flow

### v3 (Q4 2026+)
- Enterprise SSO (SAML, OIDC)
- SOC 2 Type II
- Self-hosted single-VM Docker Compose
- Plugin SDK (third-party tools and integrations)
- Marketplace for community-built agents

---

## 5. Success metrics (90-day post-launch)

### North-star
- **Weekly active builders** (projects with at least 1 AI message in 7 days)

### Supporting
| Metric | Target (day 90) |
|---|---|
| Sign-ups | 2,000 |
| WAU (weekly active) | 400 |
| Projects created | 1,500 |
| Projects deployed to Vercel | 300 |
| Pro conversion | 5% (= 100 paying) |
| MRR | $2,500 |
| GitHub stars (open-source core) | 800 |
| Avg session length | 18 min |
| Plan-mode usage rate | 60%+ of non-trivial requests |

### Quality bar
| Metric | Target |
|---|---|
| Avg time from prompt to first preview render | < 30s |
| Build success rate (no compile errors) | > 85% |
| User-reported "good first response" | > 70% |
| Crash-free session rate | > 99% |

---

## 6. Functional requirements (MVP)

### 6.1 Chat interface

- **FR-1.1** — User can type a natural-language prompt (max 8000 chars)
- **FR-1.2** — User can attach one or more images (screenshot-to-code)
- **FR-1.3** — User can toggle Plan / Build mode
- **FR-1.4** — User can send message and see streamed response (SSE)
- **FR-1.5** — User can cancel in-flight request
- **FR-1.6** — User can see token usage per message
- **FR-1.7** — User can rewind to any prior message (compaction replay)

### 6.2 Preview pane

- **FR-2.1** — Live preview is always visible (resizable split)
- **FR-2.2** — Preview supports desktop / tablet / mobile breakpoints
- **FR-2.3** — Preview console errors are surfaced in a side panel
- **FR-2.4** — Preview can be opened in a new tab (clean URL)
- **FR-2.5** — Preview auto-refreshes on code changes (HMR via Vite)

### 6.3 Code editor

- **FR-3.1** — Monaco editor with syntax highlighting (TS, TSX, CSS, JSON, MD)
- **FR-3.2** — File tree on left, tabbed editor in middle
- **FR-3.3** — User can edit any file; saves auto-commit
- **FR-3.4** — User can search across files (grep-style)
- **FR-3.5** — Inline diff viewer when AI edits a file (highlighted in green/red)

### 6.4 Agent loop

- **FR-4.1** — System prompt is editable in project settings (advanced users)
- **FR-4.2** — User can pin specific tools as enabled/disabled
- **FR-4.3** — User can see tool calls as they happen (collapsible cards)
- **FR-4.4** — User can approve / reject each tool call (toggle in settings)
- **FR-4.5** — Plan mode produces a written plan before any code edits
- **FR-4.6** — Multi-step requests show progress (e.g., "Building header... done", "Building hero... in progress")

### 6.5 Project management

- **FR-5.1** — User sees a dashboard of their projects
- **FR-5.2** — Each project has: name, description, last modified, deploy URL, GitHub link
- **FR-5.3** — User can rename, delete, duplicate projects
- **FR-5.4** — User can fork any public project (when templates ship in v1.5)
- **FR-5.5** — Search across projects by name

### 6.6 GitHub sync

- **FR-6.1** — One-click "Connect GitHub" OAuth
- **FR-6.2** — "Push to GitHub" creates a repo and pushes
- **FR-6.3** — Auto-push on every commit (toggle)
- **FR-6.4** — User can pull from GitHub to refresh local

### 6.7 Deployment

- **FR-7.1** — One-click Vercel deploy (OAuth)
- **FR-7.2** — Auto-assigned subdomain: `<hash>.ladestack.app`
- **FR-7.3** — Deploy status visible in project header (building / live / failed)
- **FR-7.4** — Deploy logs accessible in side panel

### 6.8 Account & billing

- **FR-8.1** — Email + password signup, with email verification
- **FR-8.2** — Google + GitHub OAuth
- **FR-8.3** — Settings page: API keys (BYO), model preference, default mode
- **FR-8.4** — Billing page (Stripe) with plan upgrade/downgrade
- **FR-8.5** — Usage dashboard (tokens used, builds, deploys)

---

## 7. Non-functional requirements

| Requirement | Target |
|---|---|
| Time to first preview after signup + first prompt | < 60s |
| Cold-start Vite dev server per project | < 5s |
| Chat message streaming TTFB | < 800ms |
| Concurrent users per Node instance | 50 |
| Concurrent builds per sandbox worker | 5 |
| Database query latency (p95) | < 50ms |
| API error rate | < 0.5% |
| Uptime | 99.5% (MVP), 99.9% (v2) |
| Data backup RPO | 1h |
| Data backup RTO | 4h |
| GDPR-compliant | Yes (defer DPA to v1.5) |

---

## 8. Risks (ranked)

### R1 — Lovable or Bolt ships a better free tier (HIGH)

If they drop Pro to $15/mo or expand free tier materially, our conversion math breaks.
**Mitigation:** Lead with open-source + BYO model key. These are defensible moats that neither can match.

### R2 — AI cost spikes eat our margin (HIGH)

If a user runs a long session with Claude Sonnet on our managed credits, we eat the difference.
**Mitigation:** BYO model key is the default for paid users. We surface token cost in real-time. Managed credits are sold at a fixed markup, with hard caps.

### R3 — Solo founder bandwidth (HIGH — execution risk)

8-week MVP is ambitious for one person with a day job.
**Mitigation:** Scope ruthlessly. Ship in 10 weeks if needed. Use AI-assisted coding (LS CLI, Claude Code) aggressively. Every doc in this folder is designed to be AI-consumable.

### R4 — Live preview infrastructure cost (MEDIUM)

Each project needs a running Vite dev server. 1,500 projects = 1,500 dev servers. Cost adds up.
**Mitigation:** Spin up sandbox only on user activity; idle-suspend after 5 min. Use shared base images. Consider Warp / Daytona / E2B for sandbox primitives (defer self-host).

### R5 — Multi-agent loop is hard to get right (MEDIUM)

Wave-based orchestrator is novel; we may ship it buggy.
**Mitigation:** v1 = single primary agent + plan-mode (no orchestrator). v2 adds orchestrator. Don't promise multi-agent in MVP.

### R6 — Differentiator (BYO key + open-source) does not drive acquisition (MEDIUM)

Maybe indie devs just want the convenience of Lovable credits.
**Mitigation:** Validate in first 4 weeks of MVP launch. If conversion stalls, pivot marketing to enterprise / agency segment.

### R7 — Security: prompt injection via screenshot upload (MEDIUM)

User-uploaded screenshots could embed text that confuses the model.
**Mitigation:** Treat image attachments as data, not instructions. Sanitize all model output before executing as tool calls.

---

## 9. Out-of-band user clarifications needed

Before locking PRD v1.1, confirm:

1. **Product name** — "LadeStack Build" or "LadeBuild" or different?
2. **Pricing** — $25/mo Pro OK, or test lower?
3. **BYO model key** — Free tier only allows BYO (no managed credits) for MVP?
4. **Self-host** — Defer to v3 confirmed?
5. **Vercel as default deploy** — Acceptable dependency?

---

## 10. Acceptance criteria for v1 launch

The MVP is shippable when ALL of these are true:

- [ ] A new user can sign up with Google in < 30s
- [ ] User can type "Build me a portfolio site" and see a working preview in < 90s
- [ ] User can toggle Plan mode and see a written plan before code edits
- [ ] User can edit a file in Monaco and see it auto-commit
- [ ] User can deploy to Vercel and get a live URL in < 60s
- [ ] User can connect GitHub and push the project
- [ ] BYO model key flow works end-to-end (key encrypted at rest)
- [ ] All success metrics' targets have measurement in place
- [ ] On-call runbook for sandbox failures exists
- [ ] Open-source repo has README, CONTRIBUTING, and the agent runtime subdir

---

**End of PRD.md** — next: system-design.md
