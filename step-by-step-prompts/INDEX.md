# Step-by-Step Prompts — LadeStack Build

This folder contains **25 sequential prompts** for building the **LadeStack Build** MVP using AI coding assistants (Cursor, Claude Code, Windsurf, etc.).

The prompts are designed to be **copy-pasted one at a time** into your AI tool. Each prompt is focused on a single, well-scoped task. Do NOT combine prompts — the AI loses focus when given too much context at once.

---

## How to use these prompts

1. **Read the full PRD package first** (in parent folder):
   - `../PRD.md` — vision, scope, MVP
   - `../system-design.md` — architecture
   - `../tool-calling.md` — tool specs
   - `../agent-loop.md` — AI loop
   - `../design.md` — UI/UX
   - `../prompt.md` — system prompts (reference, not for the AI to write)

2. **Open these prompts in order** (`01-` through `25-`).

3. **For each prompt:**
   - Open your AI tool (Cursor / Claude Code)
   - Copy the ENTIRE prompt content
   - Paste into a fresh chat (don't continue from a long conversation)
   - Wait for completion
   - Verify the acceptance criteria
   - Commit your changes (git)
   - Move to the next prompt

4. **If the AI gets confused mid-prompt:** stop, revert to last good commit, retry. Don't try to "fix forward" — that compounds errors.

5. **If the AI produces something close but not right:** give it specific corrective feedback in a follow-up message in the SAME chat. Don't start a new chat for tweaks.

---

## The 25 prompts

### Phase 1: Project Bootstrap (1-4)

| # | Title | Goal | Est. time |
|---|---|---|---|
| [01](./01-monorepo-bootstrap.md) | Initialize monorepo | Set up pnpm + turbo workspace, git, base config | 1-2 hr |
| [02](./02-nextjs-app-shell.md) | Next.js 14 app shell | Brand tokens, layout, sign-in stubs | 2-3 hr |
| [03](./03-hono-api-gateway.md) | Hono API gateway | API server skeleton, auth middleware, error handling | 2-3 hr |
| [04](./04-supabase-schema-auth.md) | Supabase schema + auth | DB migrations, auth flows, JWT session | 3-4 hr |

### Phase 2: Sandbox + Provider Layer (5-7)

| # | Title | Goal | Est. time |
|---|---|---|---|
| [05](./05-daytona-sandbox-integration.md) | Daytona sandbox integration | Per-project sandboxes, Vite dev server, HMR | 4-6 hr |
| [06](./06-llm-provider-abstraction.md) | LLM provider abstraction | Anthropic + OpenAI + Google, BYO key, model catalog | 3-4 hr |
| [07](./07-prompt-composition.md) | Prompt composition engine | soul + agent + env + tools prompt builder | 2-3 hr |

### Phase 3: Agent Runtime Core (8-11)

| # | Title | Goal | Est. time |
|---|---|---|---|
| [08](./08-agent-schema-registry.md) | Agent schema + registry | Zod schema, AgentService, default agents | 2-3 hr |
| [09](./09-tool-registry-base-tools.md) | Tool registry + base tools | read/write/edit/glob/grep/bash/todowrite/question | 4-5 hr |
| [10](./10-session-message-model.md) | Session + message model | SessionService, message persistence, compaction | 3-4 hr |
| [11](./11-agent-loop-sse.md) | Agent loop + SSE streaming | Core loop, streaming protocol, error handling | 4-5 hr |

### Phase 4: Plan Mode + Multi-Agent (12-14)

| # | Title | Goal | Est. time |
|---|---|---|---|
| [12](./12-plan-mode-tools.md) | Plan mode (enter/write/exit tools) | PlanService, plan agent, UI toggle | 2-3 hr |
| [13](./13-explore-scout-subagents.md) | Explore + scout + summarize + title | Read-only subagents | 2-3 hr |
| [14](./14-agent-system-prompts.md) | Write all system prompts (.txt) | Copy from ../prompt.md, place in packages/runtime/src/agents/prompts/ | 1 hr |

### Phase 5: Chat UI (15-18)

| # | Title | Goal | Est. time |
|---|---|---|---|
| [15](./15-chat-panel-component.md) | ChatPanel + Message components | Streaming messages, role variants | 3-4 hr |
| [16](./16-tool-call-card-component.md) | ToolCallCard component | Collapsible input/output, color-coded | 2 hr |
| [17](./17-chat-input-component.md) | ChatInput component | Mode toggle, attachments, model picker | 2-3 hr |
| [18](./18-state-management.md) | Zustand state stores | sessionStore, projectStore, uiStore | 1-2 hr |

### Phase 6: File Tree + Editor + Preview (19-20)

| # | Title | Goal | Est. time |
|---|---|---|---|
| [19](./19-file-tree-monaco.md) | FileTree + Monaco editor | Tree, tabs, diff view, dirty markers | 3-4 hr |
| [20](./20-preview-iframe-sandbox-proxy.md) | Preview iframe + sandbox proxy | Iframe + WS for HMR + console panel | 3-4 hr |

### Phase 7: Integrations (21-24)

| # | Title | Goal | Est. time |
|---|---|---|---|
| [21](./21-github-oauth-sync.md) | GitHub OAuth + push | Connect, push to repo, webhook | 3-4 hr |
| [22](./22-vercel-deploy.md) | Vercel OAuth + deploy | Connect, deploy, status tracking | 2-3 hr |
| [23](./23-byo-api-key-management.md) | BYO API key management | Settings UI, AES-256-GCM encryption | 2-3 hr |
| [24](./24-usage-tracking-billing.md) | Usage tracking + Stripe billing | Usage events, free/Pro gates, Stripe checkout | 3-4 hr |

### Phase 8: Polish + Launch (25)

| # | Title | Goal | Est. time |
|---|---|---|---|
| [25](./25-testing-deployment-launch.md) | Testing + production deploy + launch | E2E tests, deploy, blog post | 4-6 hr |

**Total estimated time: 60-90 hours of focused AI-assisted work** (matches PRD's 8-week MVP estimate, allowing for debugging and iteration).

---

## Dependency graph

```
01 (monorepo)
   ↓
   ├── 02 (Next.js shell) ──────────────────────┐
   │                                            │
   └── 03 (Hono API) ─── 04 (Supabase) ───┐    │
                                          │    │
                                          ↓    ↓
                              ┌──── 05 (Daytona) ────┐
                              │                       │
                              └──── 06 (Providers) ───┤
                                                      │
                                              07 (Prompt composition)
                                                      ↓
                                          ┌─── 08 (Agent schema) ───┐
                                          │                         │
                                          └─── 09 (Tools) ─────┐   │
                                                              │   │
                                          ┌─── 10 (Sessions) ───┤   │
                                          │                     │   │
                                          └─── 11 (Loop+SSE) ───┤   │
                                                                ↓   ↓
                                                       12 (Plan mode) │
                                                                ↓    │
                                                       13 (Subagents) │
                                                                ↓    │
                                                       14 (Prompts) ──┘
                                                                ↓
                              ┌─── 15 (ChatPanel) ──────────────┐
                              ├─── 16 (ToolCallCard) ───────────┤
                              ├─── 17 (ChatInput) ──────────────┤
                              └─── 18 (State) ──────────────────┤
                                                                ↓
                              ┌─── 19 (FileTree+Monaco) ────────┤
                              └─── 20 (Preview iframe) ─────────┤
                                                                ↓
                              ┌─── 21 (GitHub) ─────────────────┤
                              ├─── 22 (Vercel) ─────────────────┤
                              ├─── 23 (BYO keys) ───────────────┤
                              └─── 24 (Billing) ────────────────┤
                                                                ↓
                                                       25 (Launch)
```

---

## Parallelization opportunities

Some prompts can be done in parallel if you have multiple AI sessions:

- After prompt 11: prompts 12, 13, 14 can run in parallel (different agents)
- After prompt 14: prompts 15-18 can run in parallel (different UI components)
- After prompt 18: prompts 19-20 can run in parallel (different surfaces)
- After prompt 20: prompts 21-24 can run in parallel (different integrations)

**Recommendation for solo founder:** do them sequentially. Parallel sessions often produce inconsistent code that needs reconciliation.

---

## Tips for using these prompts

### With Cursor

- Open each prompt as a new Composer (Cmd+I) window
- Use "Agent" mode (not "Chat" or "Edit")
- Attach relevant files for context (don't rely on auto-detection)
- Use `@Codebase` for cross-file references

### With Claude Code

- Use `claude --continue` to keep context across prompts
- Or start fresh with `claude` for each prompt
- Use `/clear` between unrelated prompts
- Read files with `cat` or your editor first if needed

### With Windsurf

- Cascade mode for multi-file changes
- Use `@` references liberally

### General

- **One prompt at a time.** Don't batch.
- **Verify acceptance criteria.** Don't move on if the AI claims "done" but tests fail.
- **Commit between prompts.** `git add . && git commit -m "prompt N: <title>"`
- **If stuck:** read the prompt's "Notes" section. It usually has the answer.
- **AI gives bad output:** try the prompt in a fresh chat. Sometimes model state gets weird.

---

## What these prompts DELIBERATELY don't include

- ❌ Mobile app (defer to v1.5)
- ❌ Desktop app
- ❌ Voice input
- ❌ 50+ integrations (Stripe, Algolia, etc.) — Stripe integration only
- ❌ WebContainers (we use Daytona instead)
- ❌ Self-hosted Docker (defer to v3)
- ❌ VS Code extension (out of scope)
- ❌ Multi-agent orchestrator (defer to v2)
- ❌ Real-time collaboration (defer to v2)

These are noted in the PRD as v1.5+ features.

---

## When something doesn't work

If the AI produces broken code or fails acceptance criteria:

1. Read the error message carefully
2. Check the prompt's "Notes" section for known pitfalls
3. Try regenerating with a fresh chat
4. If persistent: the prompt may have a bug — let me know and I'll fix it
5. As a last resort: write the code yourself (you know this stack)

---

**Ready?** Start with [01-monorepo-bootstrap.md](./01-monorepo-bootstrap.md).
