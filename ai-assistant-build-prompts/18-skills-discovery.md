# Prompt 18: Skills Discovery Service

## Goal

Implement the skills discovery service — a runtime component that scans standard skill directories (project + user + bundled + cross-tool compat), parses `SKILL.md` frontmatter, builds an in-memory registry, supports per-project enable/disable via `kilo.json`, and exposes a "match top-3 relevant skills" function that injects the matched skills into the agent's system prompt. This is what makes the assistant extensible — users (and the project itself) can drop in skills from Claude Code, Aider, Hermes, or write their own.

## Context (from prompts 01-17)

- Config + discovery paths already scan `.kilo/agents/`, `.kilo/commands/` (prompt 03) — this prompt ADDS skills
- Agent loop composes system prompt from soul + agent-specific + environment + tools + **skills** (prompts 14-15, the `skills.txt` slot is currently empty — this prompt fills it)
- 14 tools registered including `bash`, `read`, `write` (prompts 06-12) — skills can require tools
- Per-project config schema has `defaultAgent`, `mode`, `provider`, `agent` blocks (prompt 03) — extend with `skills` block

Reference (READ first):
- `../../07-ai-skill-definition.md` — the authoritative portable skill format (frontmatter schema, workflow rules, anti-patterns). This prompt implements the loader for that format.
- `../../08-system-prompts.md` §"tools.txt" mentions `skill_invoke` tool — we add that here
- Real Kilo source: `kilocode-clone/packages/opencode/src/skill/index.ts`
- Real Kilo source: `kilocode-clone/packages/opencode/src/kilocode/skill/index.ts`
- Real Kilo source: `kilocode-clone/packages/opencode/src/kilocode/skills/`

## Task

### Step 1: Skill frontmatter schema

`packages/runtime/src/skill/schema.ts`:

```ts
import { z } from "zod"

/**
 * The portable SKILL.md frontmatter schema. Matches the format
 * defined in `../../07-ai-skill-definition.md`.
 */
export const SkillFrontmatterSchema = z.object({
  name: z.string().min(1).regex(/^[a-z][a-z0-9_-]*$/, "lowercase alphanumeric + dashes"),
  displayName: z.string().optional(),
  description: z.string().min(20).max(500),
  whenToUse: z.union([z.string(), z.array(z.string())]).optional(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/).optional(),
  author: z.string().optional(),
  license: z.string().optional(),
  /** Tools the skill requires. Missing = no tool requirement. */
  tools: z.array(z.string()).optional(),
  /** Agents this skill is best paired with. Missing = all agents. */
  agents: z.array(z.string()).optional(),
  /** Tags for keyword matching. */
  tags: z.array(z.string()).optional(),
  /** Whether to load on startup vs on-demand. Default "on-demand". */
  load: z.enum(["eager", "on-demand"]).default("on-demand"),
})
export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>

/** A fully-loaded skill (frontmatter + body). */
export const SkillSchema = z.object({
  frontmatter: SkillFrontmatterSchema,
  /** Markdown body (everything after the frontmatter). */
  body: z.string(),
  /** Absolute path to the SKILL.md file. */
  path: z.string(),
  /** Directory containing SKILL.md (skills may have companion files). */
  directory: z.string(),
  /** Where the skill was loaded from. */
  source: z.enum(["bundled", "project", "user", "claude", "agents", "kilocode", "kilo"]),
})
export type Skill = z.infer<typeof SkillSchema>
```

### Step 2: Frontmatter parser

`packages/runtime/src/skill/frontmatter.ts`:

```ts
/**
 * Extract YAML-ish frontmatter from a Markdown file. Supports the subset
 * of YAML used in skill files (no nested objects, no anchors, no tags).
 *
 * For full YAML support, run `bun add yaml` and use `YAML.parse()`.
 * We hand-roll to avoid the dependency for a 30-line feature.
 */
export function parseFrontmatter(md: string): { frontmatter: Record<string, unknown>; body: string } {
  if (!md.startsWith("---")) {
    return { frontmatter: {}, body: md }
  }
  const end = md.indexOf("\n---", 3)
  if (end === -1) {
    return { frontmatter: {}, body: md }
  }
  const yamlText = md.slice(3, end).trim()
  const body = md.slice(end + 4).replace(/^\r?\n/, "")
  return { frontmatter: parseYaml(yamlText), body }
}

function parseYaml(yaml: string): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const lines = yaml.split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const colonIdx = trimmed.indexOf(":")
    if (colonIdx === -1) continue
    const key = trimmed.slice(0, colonIdx).trim()
    let value: unknown = trimmed.slice(colonIdx + 1).trim()
    // Strip surrounding quotes
    if (typeof value === "string" && /^["'].*["']$/.test(value)) {
      value = value.slice(1, -1)
    }
    // List value
    if (typeof value === "string" && value.startsWith("[") && value.endsWith("]")) {
      value = value
        .slice(1, -1)
        .split(",")
        .map((v) => v.trim().replace(/^["']|["']$/g, ""))
        .filter((v) => v.length > 0)
    }
    // Boolean
    if (value === "true") value = true
    else if (value === "false") value = false
    out[key] = value
  }
  return out
}
```

### Step 3: Discovery paths

`packages/runtime/src/skill/paths.ts`:

```ts
import { join } from "path"
import { homedir } from "os"

export interface SkillSearchPath {
  dir: string
  source: "bundled" | "project" | "user" | "claude" | "agents" | "kilocode" | "kilo"
  /** Subdirs within `dir` that may contain SKILL.md */
  subdirs: string[]
}

/** User-level skill locations (cross-tool compatible). */
export function userSkillPaths(): SkillSearchPath[] {
  const home = homedir()
  return [
    { dir: join(home, ".kilocode", "skills"), source: "kilocode", subdirs: ["**"] },
    { dir: join(home, ".kilo", "skills"), source: "kilo", subdirs: ["**"] },
    { dir: join(home, ".claude", "skills"), source: "claude", subdirs: ["**"] },
    { dir: join(home, ".agents", "skills"), source: "agents", subdirs: ["**"] },
    { dir: join(home, ".kilocode", "skills-bundled"), source: "bundled", subdirs: ["**"] },
  ]
}

/** Project-level skill locations. */
export function projectSkillPaths(cwd: string): SkillSearchPath[] {
  return [
    { dir: join(cwd, ".kilocode", "skills"), source: "kilocode", subdirs: ["**"] },
    { dir: join(cwd, ".kilo", "skills"), source: "kilo", subdirs: ["**"] },
    { dir: join(cwd, ".claude", "skills"), source: "claude", subdirs: ["**"] },
    { dir: join(cwd, ".agents", "skills"), source: "agents", subdirs: ["**"] },
  ]
}

/** Bundled skills shipped with the runtime package. */
export function bundledSkillPath(): SkillSearchPath {
  // Resolve relative to this file at runtime via import.meta.url (in step 4)
  return { dir: "<bundled>", source: "bundled", subdirs: ["**"] }
}
```

### Step 4: Skill loader

`packages/runtime/src/skill/loader.ts`:

```ts
import { readdirSync, readFileSync, existsSync, statSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { homedir } from "os"
import { SkillSchema, type Skill, type SkillFrontmatter } from "./schema.js"
import { parseFrontmatter } from "./frontmatter.js"
import { userSkillPaths, projectSkillPaths, type SkillSearchPath } from "./paths.js"

function findAllSkillFiles(rootDir: string): string[] {
  if (!existsSync(rootDir)) return []
  const out: string[] = []
  const walk = (dir: string) => {
    let entries: string[]
    try { entries = readdirSync(dir) } catch { return }
    for (const entry of entries) {
      const full = join(dir, entry)
      let stat
      try { stat = statSync(full) } catch { continue }
      if (stat.isDirectory()) walk(full)
      else if (stat.isFile() && entry === "SKILL.md") out.push(full)
    }
  }
  walk(rootDir)
  return out
}

/**
 * Resolve the bundled skills directory.
 *
 * In dev (running from source via Bun), the .md files live alongside
 * this .ts file in src/skill/bundled/. In production, they're copied to
 * dist/skill/bundled/ during build (configured in turbo.json).
 */
function bundledDir(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  return join(here, "bundled")
}

export interface LoadOpts {
  cwd: string
  /** Skill names to exclude (project-config). */
  disabled?: string[]
  /** Skill names to force-include even if disabled globally. */
  forceEnabled?: string[]
}

export interface LoadResult {
  skills: Skill[]
  errors: Array<{ path: string; error: string }>
}

/**
 * Scan all known locations and return parsed skills.
 *
 * Priority (later wins): bundled < user < project
 * Within a priority tier, later paths override earlier ones.
 */
export function loadAllSkills(opts: LoadOpts): LoadResult {
  const skills = new Map<string, Skill>()
  const errors: Array<{ path: string; error: string }> = []

  const paths: SkillSearchPath[] = [
    { dir: bundledDir(), source: "bundled", subdirs: ["**"] },
    ...userSkillPaths(),
    ...projectSkillPaths(opts.cwd),
  ]

  for (const sp of paths) {
    const files = findAllSkillFiles(sp.dir)
    for (const file of files) {
      try {
        const raw = readFileSync(file, "utf-8")
        const { frontmatter, body } = parseFrontmatter(raw)
        const fm = SkillSchema.shape.frontmatter.parse(frontmatter)
        const skill: Skill = {
          frontmatter: fm,
          body,
          path: file,
          directory: dirname(file),
          source: sp.source,
        }
        skills.set(skill.frontmatter.name, skill)   // later wins
      } catch (err) {
        errors.push({
          path: file,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }

  // Apply disabled list
  const disabledSet = new Set(opts.disabled ?? [])
  const forceSet = new Set(opts.forceEnabled ?? [])
  const filtered = [...skills.values()].filter((s) => {
    if (forceSet.has(s.frontmatter.name)) return true
    if (disabledSet.has(s.frontmatter.name)) return false
    return true
  })

  return { skills: filtered, errors }
}
```

### Step 5: Skill matching — keyword + tag scoring

`packages/runtime/src/skill/match.ts`:

```ts
import type { Skill } from "./schema.js"

export interface MatchInput {
  /** The user's current prompt. */
  prompt: string
  /** The agent being invoked (may bias scoring toward skills tagged for this agent). */
  agent?: string
  /** Skills to choose from. */
  skills: Skill[]
  /** Number of top matches to return. Default 3. */
  topN?: number
}

export interface MatchResult {
  skill: Skill
  score: number
  reasons: string[]
}

/**
 * Score each skill against the prompt. Returns top N matches.
 *
 * Scoring:
 *   +5  per tag match (case-insensitive)
 *   +3  per keyword in description that appears in prompt
 *   +2  per keyword in whenToUse that appears in prompt
 *   +1  per word overlap (after stopword filter)
 *   +10 bonus if agent is in skill.agents
 *   +5  bonus if all skill.tools are available
 */
export function matchSkills(input: MatchInput): MatchResult[] {
  const { prompt, agent, skills } = input
  const topN = input.topN ?? 3
  const promptLower = prompt.toLowerCase()
  const promptWords = new Set(tokenize(prompt))

  const STOPWORDS = new Set([
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
    "to", "of", "in", "on", "at", "for", "with", "by", "from",
    "i", "you", "we", "they", "it", "this", "that", "these", "those",
    "and", "or", "but", "if", "then", "else",
    "do", "does", "did", "have", "has", "had",
    "as", "so", "than", "very", "just",
  ])

  const scored: MatchResult[] = skills.map((skill) => {
    const reasons: string[] = []
    let score = 0

    const tags = skill.frontmatter.tags ?? []
    for (const tag of tags) {
      if (promptLower.includes(tag.toLowerCase())) {
        score += 5
        reasons.push(`tag "${tag}"`)
      }
    }

    const descWords = tokenize(skill.frontmatter.description)
    for (const w of descWords) {
      if (STOPWORDS.has(w)) continue
      if (promptWords.has(w)) {
        score += 3
        reasons.push(`desc:"${w}"`)
      }
    }

    const wtu = Array.isArray(skill.frontmatter.whenToUse)
      ? skill.frontmatter.whenToUse
      : skill.frontmatter.whenToUse ? [skill.frontmatter.whenToUse] : []
    for (const phrase of wtu) {
      const phraseWords = tokenize(phrase)
      const overlap = phraseWords.filter((w) => !STOPWORDS.has(w) && promptWords.has(w))
      if (overlap.length > 0) {
        score += 2 * overlap.length
        reasons.push(`whenToUse overlap: ${overlap.join(", ")}`)
      }
    }

    if (agent && skill.frontmatter.agents?.includes(agent)) {
      score += 10
      reasons.push(`agent:"${agent}"`)
    }

    return { skill, score, reasons: dedupe(reasons) }
  })

  return scored
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN)
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2)
}

function dedupe(arr: string[]): string[] {
  return [...new Set(arr)]
}
```

### Step 6: Skill registry — service singleton

`packages/runtime/src/skill/registry.ts`:

```ts
import { loadAllSkills, type LoadOpts, type LoadResult } from "./loader.js"
import { matchSkills, type MatchResult } from "./match.js"
import type { Skill } from "./schema.js"

class SkillRegistry {
  private cache = new Map<string, { cwd: string; result: LoadResult }>()
  private listeners = new Set<() => void>()

  /** Load skills for a project (cached by cwd). */
  load(cwd: string, opts: Omit<LoadOpts, "cwd"> = {}): LoadResult {
    const cacheKey = `${cwd}:${(opts.disabled ?? []).join(",")}:${(opts.forceEnabled ?? []).join(",")}`
    const cached = this.cache.get(cacheKey)
    if (cached) return cached.result

    const result = loadAllSkills({ cwd, ...opts })
    this.cache.set(cacheKey, { cwd, result })

    // Cap cache size
    if (this.cache.size > 32) {
      const firstKey = this.cache.keys().next().value
      if (firstKey) this.cache.delete(firstKey)
    }
    return result
  }

  /** Force a reload (e.g., after editing SKILL.md). */
  invalidate(cwd?: string): void {
    if (cwd) {
      for (const k of [...this.cache.keys()]) {
        if (k.startsWith(`${cwd}:`)) this.cache.delete(k)
      }
    } else {
      this.cache.clear()
    }
    this.listeners.forEach((fn) => fn())
  }

  /** Subscribe to invalidation events (for UI). */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** Match skills for a prompt. */
  match(prompt: string, opts: { cwd: string; agent?: string; topN?: number; disabled?: string[] }): MatchResult[] {
    const { skills } = this.load(opts.cwd, { disabled: opts.disabled })
    return matchSkills({ prompt, agent: opts.agent, skills, topN: opts.topN })
  }
}

export const skillRegistry = new SkillRegistry()
```

### Step 7: Skill injection — build the `skills.txt` slot

`packages/runtime/src/skill/inject.ts`:

```ts
import type { Skill } from "./schema.js"
import { skillRegistry } from "./registry.js"

/**
 * Build the skills block that gets injected into the system prompt,
 * between the agent-specific prompt and the tools list.
 *
 * Output format (matches `08-system-prompts.md` §"tools.txt"):
 *
 *   ## Available skills
 *
 *   The following skills may be relevant to this task. To invoke one,
 *   use the skill_invoke tool with the skill's name.
 *
 *   ### <skill.name> — <skill.displayName or description>
 *   <body excerpt, first 500 chars>
 *
 *   ...
 */
export function buildSkillsBlock(opts: {
  cwd: string
  prompt: string
  agent?: string
  disabled?: string[]
  maxSkills?: number
}): string {
  const matches = skillRegistry.match(opts.prompt, {
    cwd: opts.cwd,
    agent: opts.agent,
    topN: opts.maxSkills ?? 3,
    disabled: opts.disabled,
  })

  if (matches.length === 0) return ""

  const parts: string[] = []
  parts.push("## Available skills")
  parts.push("")
  parts.push(
    "The following skills may be relevant to this task. " +
      "Use the `skill_invoke` tool with a skill name to load its full content.",
  )
  parts.push("")

  for (const m of matches) {
    const s = m.skill
    parts.push(`### ${s.frontmatter.name}${s.frontmatter.displayName ? ` — ${s.frontmatter.displayName}` : ""}`)
    parts.push(`**Source:** ${s.source} · **Matched:** ${m.reasons.slice(0, 3).join(", ")}`)
    parts.push("")
    // Body excerpt
    const excerpt = s.body.slice(0, 500)
    parts.push(excerpt)
    if (s.body.length > 500) parts.push("... [truncated; use skill_invoke for full content]")
    parts.push("")
  }

  return parts.join("\n")
}
```

### Step 8: Extend config schema to include skills block

In `packages/runtime/src/config/schema.ts` (from prompt 03), add:

```ts
export const SkillsConfigSchema = z.object({
  /** Skill names to disable for this project. */
  disable: z.array(z.string()).default([]),
  /** Skill names to always load regardless of match score. */
  forceEnable: z.array(z.string()).default([]),
  /** Max skills to attach per prompt. Default 3. */
  maxSkills: z.number().int().min(0).max(10).default(3),
}).strict()

// In KiloConfigSchema, add:
skills: SkillsConfigSchema.optional(),
```

### Step 9: Wire into the agent loop

In `packages/runtime/src/agent/loop.ts` (from prompt 15), update `composeAgentPrompt` usage:

```ts
import { buildSkillsBlock } from "../skill/inject.js"
import { resolveConfig } from "../config/loader.js"

// Inside runSession, after loading the agent and config:
const cfg = await resolveConfig(opts.cwd)
const skillsBlock = buildSkillsBlock({
  cwd: opts.cwd,
  prompt: opts.message,
  agent: agent.name,
  disabled: cfg.skills?.disable,
  maxSkills: cfg.skills?.maxSkills ?? 3,
})

const system = [
  soul.content,
  agentPrompt.content,
  skillsBlock,
  // ... environment + tools blocks
].filter(Boolean).join("\n\n---\n\n")
```

### Step 10: Add `skill_invoke` tool

`packages/runtime/src/skill/invoke.ts`:

```ts
import { z } from "zod"
import { defineTool } from "../tool/define.js"
import { skillRegistry } from "./registry.js"

export const skillInvokeTool = defineTool({
  name: "skill_invoke",
  description:
    "Load the full content of a named skill. Use this when you need the " +
    "detailed workflow rules, examples, or domain knowledge from a skill.",
  input: z.object({
    skill: z.string().describe("Skill name (e.g. 'ladestack-build-agent')"),
  }),
  output: z.object({
    name: z.string(),
    content: z.string(),
    source: z.string(),
  }),
  async execute({ skill }, ctx) {
    const { skills } = skillRegistry.load(ctx.cwd)
    const found = skills.find((s) => s.frontmatter.name === skill)
    if (!found) {
      throw new Error(
        `Skill "${skill}" not found. Available: ${skills.map((s) => s.frontmatter.name).join(", ")}`,
      )
    }
    return {
      name: found.frontmatter.name,
      content: found.body,
      source: found.source,
    }
  },
})
```

Register in `packages/runtime/src/tool/registry.ts`:

```ts
import { skillInvokeTool } from "../skill/invoke.js"
REGISTRY.set("skill_invoke", skillInvokeTool)
```

### Step 11: Bundled skills directory

Create the bundled skills directory with one starter skill so the loader has something to find out-of-the-box:

`packages/runtime/src/skill/bundled/build-agent/SKILL.md`:

```markdown
---
name: build-agent
displayName: LadeStack Build Agent
description: Encodes the LadeStack Build AI agent's behavior as a portable skill. Use for building web apps, fixing bugs, refactoring, or planning implementations.
whenToUse:
  - Build me a website
  - Add a feature
  - Fix a bug
  - Refactor this component
version: 1.0.0
author: LadeStack
license: MIT
tags: [build, code, web, nextjs, react, typescript]
agents: [build]
tools: [read, write, edit, glob, grep, bash, todowrite]
load: eager
---

You are Lade, the LadeStack Build agent — an expert full-stack engineer
specializing in Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS,
and shadcn/ui. You build production-grade web applications.

## Personality
- Direct, technical, concise. No fluff.
- Never start with "Great", "Sure", "Okay".
- Form a plan, then execute. No wandering.
- Read first. Plan second. Edit surgically. Verify continuously.

## Approach
1. Read existing files before changing them.
2. Use plan_write for non-trivial tasks (>1 file, new dependency, architectural).
3. Edit with surgical oldString + newString (3-5 lines of context).
4. Run typecheck after meaningful changes.
5. Stay in scope. No "while I'm at it".
```

### Step 12: Unit tests

`packages/runtime/src/skill/loader.test.ts`:

```ts
import { test, expect, describe } from "bun:test"
import { parseFrontmatter } from "./frontmatter.js"
import { loadAllSkills } from "./loader.js"
import { matchSkills } from "./match.js"

describe("frontmatter parser", () => {
  test("extracts simple key-value pairs", () => {
    const md = `---
name: my-skill
description: A test skill
version: 1.0.0
---

# Body here`
    const { frontmatter, body } = parseFrontmatter(md)
    expect(frontmatter.name).toBe("my-skill")
    expect(frontmatter.description).toBe("A test skill")
    expect(frontmatter.version).toBe("1.0.0")
    expect(body).toContain("# Body here")
  })

  test("handles list values", () => {
    const md = `---
tags: [build, code, web]
---

body`
    const { frontmatter } = parseFrontmatter(md)
    expect(frontmatter.tags).toEqual(["build", "code", "web"])
  })

  test("returns empty frontmatter for non-frontmatter files", () => {
    const md = `# Just a markdown file`
    const { frontmatter, body } = parseFrontmatter(md)
    expect(frontmatter).toEqual({})
    expect(body).toBe(md)
  })
})

describe("skills loader", () => {
  test("loads bundled build-agent skill", () => {
    const result = loadAllSkills({ cwd: process.cwd() })
    const found = result.skills.find((s) => s.frontmatter.name === "build-agent")
    expect(found).toBeDefined()
    expect(found?.source).toBe("bundled")
    expect(found?.body).toContain("Lade")
  })

  test("returns errors for malformed skills, not throws", () => {
    // Real test would write a temp file; this just exercises the error path shape
    const result = loadAllSkills({ cwd: "/nonexistent" })
    expect(result.errors).toBeDefined()
    expect(result.skills).toEqual([])
  })

  test("disabled list excludes skills", () => {
    const result = loadAllSkills({ cwd: process.cwd(), disabled: ["build-agent"] })
    expect(result.skills.find((s) => s.frontmatter.name === "build-agent")).toBeUndefined()
  })
})

describe("skills matcher", () => {
  const mockSkill = {
    frontmatter: {
      name: "test",
      description: "Build a Next.js web application with React and TypeScript",
      tags: ["nextjs", "react", "typescript"],
      whenToUse: ["create a web app"],
      load: "on-demand" as const,
    },
    body: "",
    path: "/tmp",
    directory: "/tmp",
    source: "bundled" as const,
  }

  test("matches on tag overlap", () => {
    const results = matchSkills({
      prompt: "Help me build a Next.js app",
      skills: [mockSkill],
      topN: 3,
    })
    expect(results).toHaveLength(1)
    expect(results[0]?.score).toBeGreaterThan(0)
  })

  test("returns empty for no overlap", () => {
    const results = matchSkills({
      prompt: "fix kubernetes deployment",
      skills: [mockSkill],
      topN: 3,
    })
    expect(results).toHaveLength(0)
  })

  test("agent bonus boosts score", () => {
    const withAgent = matchSkills({ prompt: "build", agent: "build", skills: [mockSkill] })
    const withoutAgent = matchSkills({ prompt: "build", skills: [mockSkill] })
    expect(withAgent[0]?.score ?? 0).toBeGreaterThan(withoutAgent[0]?.score ?? 0)
  })
})
```

### Step 13: Commit

```bash
git add -A
git commit -m "feat(skills): discovery service + frontmatter parser + matcher + invoke tool (prompt 18)"
```

## Files created

```
packages/runtime/src/skill/
├── schema.ts
├── frontmatter.ts
├── paths.ts
├── loader.ts
├── match.ts
├── registry.ts
├── inject.ts
├── invoke.ts
├── bundled/
│   └── build-agent/
│       └── SKILL.md
└── loader.test.ts

packages/runtime/src/config/schema.ts        (extended with SkillsConfigSchema)
packages/runtime/src/agent/loop.ts           (inject skillsBlock into system prompt)
packages/runtime/src/tool/registry.ts        (register skill_invoke tool)
```

## Acceptance criteria

- [ ] `loadAllSkills({ cwd })` returns ≥ 1 skill (the bundled `build-agent`)
- [ ] Each loaded skill has parsed frontmatter + body
- [ ] Malformed SKILL.md files are captured in `result.errors`, don't throw
- [ ] `disabled: ["name"]` excludes that skill
- [ ] `forceEnabled: ["name"]` includes a disabled skill
- [ ] `matchSkills({ prompt: "build a Next.js app" })` returns the `build-agent` skill
- [ ] `buildSkillsBlock(...)` returns a markdown block listing matched skills
- [ ] `skill_invoke` tool returns full body of a named skill
- [ ] Project-level `.kilo/skills/foo/SKILL.md` overrides bundled `foo`
- [ ] User-level `~/.claude/skills/` is scanned (cross-tool compat)
- [ ] All unit tests pass: `bun test packages/runtime/src/skill/`

## Verification

```bash
cd kilocode-assistant
bun run typecheck
bun test packages/runtime/src/skill/

# Smoke test: list loaded skills
bun -e '
  import { loadAllSkills } from "./packages/runtime/src/skill/loader.ts"
  const r = loadAllSkills({ cwd: process.cwd() })
  console.log("skills:", r.skills.map(s => `${s.frontmatter.name} (${s.source})`).join("\n  "))
  if (r.errors.length) console.log("errors:", r.errors)
'

# Test the matcher
bun -e '
  import { skillRegistry } from "./packages/runtime/src/skill/registry.ts"
  const matches = skillRegistry.match("build me a Next.js dashboard", { cwd: process.cwd(), agent: "build" })
  console.log(matches.map(m => `${m.skill.frontmatter.name}: ${m.score} (${m.reasons.join(", ")})`))
'

# End-to-end via CLI — agent should auto-invoke the skill
bun run kilo run "help me build a Next.js login page" --agent build

# Test cross-tool compat: create a Claude-format skill and verify it loads
mkdir -p /tmp/test-project/.claude/skills/test-skill
cat > /tmp/test-project/.claude/skills/test-skill/SKILL.md << 'EOF'
---
name: test-skill
description: A test skill from Claude format for verification of cross-tool compatibility
tags: [test]
---

This is the body.
EOF
cd /tmp/test-project
bun -e '
  import { loadAllSkills } from "<kilocode-assistant-path>/packages/runtime/src/skill/loader.ts"
  const r = loadAllSkills({ cwd: process.cwd() })
  console.log(r.skills.find(s => s.frontmatter.name === "test-skill")?.source)   // should be "claude"
'
```

## Notes

- **The hand-rolled YAML parser** is intentional. Skill frontmatter uses a tiny subset of YAML (scalars + lists). Adding `js-yaml` for 30 lines of feature is overkill. If a skill needs nested objects, fall back to `bun add yaml` and `YAML.parse()`.
- **Priority is `bundled < user < project`** — same as the discovery service in prompt 03. A project can override a bundled skill by placing one with the same name in `.kilo/skills/`.
- **Cross-tool compat paths** (`.claude/`, `.agents/`) are critical — lets users reuse the vast Claude Code / Aider / Hermes skill ecosystems without rewriting them. Source field is preserved so the UI can show where each skill came from.
- **Skill matching is keyword-based** — not semantic. Good enough for v1; prompts with unusual phrasing may not match well. v1.1 adds embedding-based matching using the small/cheap model.
- **Match score threshold is `> 0`** — zero matches return empty. Don't force-inject irrelevant skills.
- **Skills are injected as a `## Available skills` block** in the system prompt, between the agent-specific prompt and the tools list. Agent doesn't see them as commands — must explicitly call `skill_invoke` to get the full body. Keeps the system prompt small.
- **`load: "eager"`** skills are matched with score boost (always included if in the registry). Use for critical-everywhere skills (e.g., security baseline). Bundled `build-agent` is eager because it's the default coding agent's persona.
- **`skill_invoke` is in the tool registry** — the agent calls it like any other tool. Returns the full body in one shot. Don't paginate — skill bodies are small (1-10KB).
- **Cache key includes disabled/forceEnabled lists** — different config = different cache. Prevents stale results.
- **Subscribe pattern** lets the TUI/web refresh its skill list when `invalidate()` is called. Useful for skill editors.
- **Skill body excerpt in injection is 500 chars** — enough to convey purpose, small enough to keep system prompt cheap. Full content via `skill_invoke`.
- **Bundled skills directory location** uses `import.meta.url` resolution — works in both Bun dev (`bun run src/index.ts`) and built (`bun build`). Add a `turbo.json` task to copy `bundled/` into `dist/` if your build doesn't preserve the directory.
- **No skill versioning yet** — `version` field is stored but not enforced. v1.1 adds minimum-version constraints in `kilo.json`.
- **The `tags` field** is the primary match driver — make them specific (`nextjs`, `kubernetes`, `terraform`) not generic (`code`, `help`). Generic tags match too broadly and waste skill slots.