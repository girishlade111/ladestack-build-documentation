# Prompt 13: Explore + Scout + Summarize + Title Subagents

## Goal

Wire up the 4 read-only subagents (explore, scout, summarize, title) into the loop so they can be invoked automatically when needed. Also implement the skills registry (placeholder for now; real skills come later).

## Context (from prompts 01-12)

- Agent registry has the 4 subagents registered (prompt 08).
- Tools are filtered per agent (prompt 09 + 12).
- Loop runs the agent (prompt 11).
- Subagents are not yet "invokable" from the main agent.

Reference: `../agent-loop.md` §3, `../tool-calling.md` §3.

## Task

### Step 1: Implement the subagent invocation tool

`packages/runtime/src/tools/task.ts`:

```ts
import { z } from "zod"
import { Tool, ToolError } from "./types.js"
import { runLoop } from "../loop/run.js"
import { require as requireAgent } from "../agents/registry.js"

const InputSchema = z.object({
  agent: z.enum(["explore", "scout", "summarize", "title"]),
  prompt: z.string().min(1).max(2000),
  thoroughness: z.enum(["quick", "thorough"]).optional().default("thorough")
})

const OutputSchema = z.object({
  result: z.string(),
  tokensIn: z.number(),
  tokensOut: z.number()
})

// Track the parent session for each subagent invocation
const subagentSessions = new Map<string, { parentSessionId: string; subAgent: string }>()

export const taskTool: Tool<z.infer<typeof InputSchema>, z.infer<typeof OutputSchema>> = {
  name: "task",
  description: `Spawns a subagent to perform a focused task. Use this when you need to:
- Search the codebase (explore, scout)
- Compress conversation (summarize)
- Generate a session title (title)

Subagents run in their own context and return a focused result.
`.trim(),
  inputSchema: InputSchema,
  outputSchema: OutputSchema,

  async execute(input, ctx) {
    const agent = requireAgent(input.agent)
    if (agent.mode !== "subagent") {
      throw new ToolError(`agent ${input.agent} is not a subagent`, "INVALID_AGENT")
    }

    // Create a transient session for the subagent
    const { sessions, trackUsage } = await import("../sessions/service.js")
    const subSession = await sessions.createSession(ctx.projectId, {
      title: `Subagent: ${input.agent}`,
      agent: input.agent
    })

    // Run the subagent (collect all events)
    let result = ""
    let tokensIn = 0
    let tokensOut = 0
    try {
      for await (const event of runLoop({
        sessionId: subSession.id,
        userId: ctx.userId,
        projectId: ctx.projectId,
        userMessage: input.prompt,
        agentName: input.agent,
        signal: ctx.abortSignal
      })) {
        if (event.type === "text_delta") result += event.data.text
        if (event.type === "usage") {
          tokensIn = event.data.tokensIn
          tokensOut = event.data.tokensOut
        }
      }
    } catch (err: any) {
      throw new ToolError(`subagent failed: ${err.message}`, "SUBAGENT_FAILED")
    }

    return { result, tokensIn, tokensOut }
  }
}
```

### Step 2: Register task tool

`packages/runtime/src/tools/registry.ts`:

```ts
import { taskTool } from "./task.js"

register(taskTool)
```

Update `listToolsForAgent`:

```ts
export function listToolsForAgent(agentName: string): Tool[] {
  const sessionId = getCurrentSessionId()
  let tools = listTools()

  // Subagents don't get the task tool (they don't spawn other subagents for MVP)
  if (agentName === "explore" || agentName === "scout" || agentName === "summarize" || agentName === "title") {
    tools = tools.filter((t) => t.name !== "task")
  }

  // Plan/Ask/Explore/Scout are read-only
  const restricted = ["plan", "ask", "explore", "scout"]
  if (restricted.includes(agentName)) {
    tools = tools.filter((t) => !["write", "edit", "bash"].includes(t.name))
  }

  // Summarize and title have no tools
  if (agentName === "summarize" || agentName === "title") {
    tools = []
  }

  // Plan mode further restricts
  if (sessionId && isInPlanMode(sessionId)) {
    tools = tools.filter((t) =>
      ["read", "glob", "grep", "plan_write", "plan_exit", "todowrite", "question", "task"].includes(t.name)
    )
  }

  return tools
}
```

### Step 3: Update explore/scout agent permissions

`packages/runtime/src/agents/builtin.ts`:

```ts
{
  name: "explore",
  displayName: "Explore",
  description: "Thorough file search agent. Use to find references, understand patterns, locate files. Read-only.",
  mode: "subagent",
  promptPath: "explore.txt",
  tools: { write: false, edit: false, bash: false, task: false },
  color: "#4A90E2"
},
{
  name: "scout",
  displayName: "Scout",
  description: "Lightweight codebase orientation. Quick overview without deep reads. Read-only.",
  mode: "subagent",
  promptPath: "scout.txt",
  tools: { read: false, write: false, edit: false, bash: false, task: false },
  color: "#4A90E2"
}
```

### Step 4: Implement skills registry

`packages/runtime/src/skills/registry.ts`:

```ts
import { join } from "path"
import { readFileSync, readdirSync, statSync, existsSync } from "fs"
import { log } from "../lib/logger.js"

export interface Skill {
  name: string
  description: string
  content: string
  location: string
  source: "bundled" | "user" | "project"
}

// In MVP, we ship 2 bundled skills. v1.1 adds more.
const BUNDLED_SKILLS_DIR = join(process.cwd(), "skills")
const PROJECT_SKILLS_DIRS = [
  ".ladestack/skills",
  ".claude/skills",
  ".agents/skills"
]
const USER_SKILLS_DIRS = [
  join(process.env.HOME || "~", ".ladestack/skills"),
  join(process.env.HOME || "~", ".claude/skills"),
  join(process.env.HOME || "~", ".agents/skills")
]

export function discoverSkills(): Skill[] {
  const skills: Skill[] = []

  // Bundled (highest priority — first to register)
  if (existsSync(BUNDLED_SKILLS_DIR)) {
    skills.push(...loadSkillsFromDir(BUNDLED_SKILLS_DIR, "bundled"))
  }

  // User-level
  for (const dir of USER_SKILLS_DIRS) {
    if (existsSync(dir)) {
      skills.push(...loadSkillsFromDir(dir, "user"))
    }
  }

  // Project-level
  for (const dir of PROJECT_SKILLS_DIRS) {
    if (existsSync(dir)) {
      skills.push(...loadSkillsFromDir(dir, "project"))
    }
  }

  // Dedupe by name (later wins)
  const deduped = new Map<string, Skill>()
  for (const skill of skills) {
    deduped.set(skill.name, skill)
  }

  log.debug({ count: deduped.size }, "skills discovered")
  return Array.from(deduped.values())
}

function loadSkillsFromDir(dir: string, source: Skill["source"]): Skill[] {
  const skills: Skill[] = []
  try {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const skillPath = join(dir, entry.name, "SKILL.md")
      if (!existsSync(skillPath)) continue

      const raw = readFileSync(skillPath, "utf-8")
      const { name, description, content } = parseSkillMd(raw)
      skills.push({
        name: name ?? entry.name,
        description: description ?? "",
        content,
        location: skillPath,
        source
      })
    }
  } catch (err) {
    log.warn({ err, dir }, "failed to load skills from dir")
  }
  return skills
}

function parseSkillMd(raw: string): { name?: string; description?: string; content: string } {
  const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/)
  if (!fmMatch) return { content: raw }

  const frontmatter = fmMatch[1]
  const body = fmMatch[2]
  const name = frontmatter.match(/^name:\s*(.+)$/m)?.[1]?.trim()
  const description = frontmatter.match(/^description:\s*(.+)$/m)?.[1]?.trim()
  return { name, description, content: body }
}

export function listAvailableSkills(): Array<{ name: string; description: string }> {
  return discoverSkills().map((s) => ({ name: s.name, description: s.description }))
}

export function getSkill(name: string): Skill | undefined {
  return discoverSkills().find((s) => s.name === name)
}
```

### Step 5: Ship 2 bundled skills

Create `packages/runtime/skills/code-review/SKILL.md`:

```markdown
---
name: code-reviewer
description: Reviews code for bugs, security issues, performance problems, and style violations. Use before committing significant changes.
---

# Code Reviewer

When invoked, review the most recently changed files for:

1. **Bugs**: Logic errors, off-by-one, null/undefined handling, race conditions
2. **Security**: Injection, XSS, hardcoded secrets, missing auth checks
3. **Performance**: N+1 queries, unnecessary re-renders, missing memoization
4. **Style**: Naming conventions, code organization, TypeScript strictness
5. **Accessibility**: Missing alt text, ARIA, keyboard navigation

For each issue found:
- File:line reference
- Severity (critical/high/medium/low)
- Specific fix recommendation
```

Create `packages/runtime/skills/test-generator/SKILL.md`:

```markdown
---
name: test-generator
description: Generates comprehensive tests for new code. Use when adding new functions, components, or API endpoints.
---

# Test Generator

When invoked, generate tests for the recently changed code:

1. Read the changed files thoroughly
2. Identify the testing framework (Jest, Vitest, pytest, etc.)
3. Check existing tests for conventions
4. Write tests covering:
   - Happy path (basic correctness)
   - Edge cases (empty input, null, boundary values)
   - Error paths (network failure, invalid input, permission denied)
5. Run the tests to verify they pass
```

### Step 6: Update runtime index

```ts
// Add to packages/runtime/src/index.ts
export { taskTool } from "./tools/task.js"
export * as skills from "./skills/registry.js"
```

### Step 7: Pass skills to compose

`packages/runtime/src/agents/compose.ts` — update the composeSystemPrompt call site in the loop:

Already passes `skills: []` — update to load:

```ts
import { discoverSkills } from "../skills/registry.js"

// In composeSystemPrompt signature, accept skills list
const skillsList = discoverSkills()
const built = await composeSystemPrompt({
  agent,
  // ...
  skills: skillsList.map((s) => ({ name: s.name, description: s.description }))
})
```

### Step 8: Tests

`packages/runtime/src/skills/registry.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { listAvailableSkills, discoverSkills } from "./registry.js"

describe("skills registry", () => {
  it("discovers bundled skills", () => {
    const skills = discoverSkills()
    const names = skills.map((s) => s.name)
    expect(names).toContain("code-reviewer")
    expect(names).toContain("test-generator")
  })

  it("returns name + description for LLM", () => {
    const available = listAvailableSkills()
    expect(available.length).toBeGreaterThan(0)
    for (const s of available) {
      expect(s.name).toBeTruthy()
      expect(s.description).toBeTruthy()
    }
  })
})
```

`packages/runtime/src/tools/task.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { taskTool } from "./task.js"

describe("task tool", () => {
  it("rejects non-subagent names", async () => {
    await expect(
      taskTool.execute({ agent: "build", prompt: "test" }, {
        userId: "u", projectId: "p", sessionId: "s", abortSignal: new AbortController().signal
      })
    ).rejects.toThrow(/not a subagent/)
  })
})
```

### Step 9: Commit

```bash
git add -A
git commit -m "feat(runtime): task tool for subagents + skills registry (prompt 13)"
```

## Files created/modified

```
packages/runtime/src/tools/
├── task.ts (new)
├── task.test.ts (new)
└── registry.ts (update: register task, update listToolsForAgent)

packages/runtime/src/agents/builtin.ts (explore/scout task: false)
packages/runtime/src/skills/
├── registry.ts (new)
└── registry.test.ts (new)

packages/runtime/skills/
├── code-review/SKILL.md (new)
└── test-generator/SKILL.md (new)

packages/runtime/src/index.ts (export new)
```

## Acceptance criteria

- [ ] `task` tool is registered and works for subagents
- [ ] `task` tool rejects non-subagent agent names
- [ ] 2 bundled skills (code-reviewer, test-generator) are discovered
- [ ] Skills list is passed to composeSystemPrompt
- [ ] Subagents don't get the task tool
- [ ] Explore/scout have correct restrictions

## Verification

```bash
pnpm --filter @ladestack/runtime test -- skills task
# expect: 3 tests pass
```

## Notes

- **Subagent sessions are separate sessions in DB.** This is intentional — they have their own message history for audit/debug.
- **Subagent invocation is synchronous** — the parent waits for the subagent to finish. v2 supports async (background) subagents.
- **Skills discovery paths are Kilo-compatible:** `~/.ladestack/skills`, `.ladestack/skills`, `.claude/skills`, `.agents/skills`. This means users can reuse skills from Claude Code or other tools.
- **Bundled skills ship with the runtime.** v1.1 adds a marketplace.
- **Skills list is sent to the LLM as text in the system prompt.** The LLM doesn't have a `skill_invoke` tool — it just sees the skills and uses them as guidance. v2 can add explicit invocation.
- **The `task` tool description is intentionally brief.** Subagents are an advanced feature; the LLM will figure it out.
- **`summarize` and `title` are auto-invoked** by the runtime (prompt 10 + 11). The agent loop calls them programmatically, not via the `task` tool.
- **Per-project skills** are loaded from the sandbox filesystem. v1.1 moves this to DB-backed for easier editing.
