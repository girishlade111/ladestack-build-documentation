# Prompt 03: Config + Discovery Paths

## Goal

Implement Kilo Code's `kilo.json` config + the discovery system for `.kilo/`, `.claude/`, `.agents/` directories (commands, agents, skills). This is what makes the assistant cross-tool-compatible.

## Context (from prompts 01-02)

- Monorepo bootstrapped
- CLI + HTTP server stubs work
- Runtime has placeholder exports

Reference: `../../02-competitive-research.md` §5 (Kilo's skill discovery paths) and the actual Kilo `kilo-config.md` reference.

## Task

### Step 1: Install Zod for config validation

```bash
cd packages/runtime && bun add zod
```

### Step 2: Define config schema

`packages/runtime/src/config/schema.ts`:

```ts
import { z } from "zod"

export const ModelRefSchema = z.object({
  providerID: z.enum(["anthropic", "openai", "google", "openrouter", "groq", "mistral", "xai", "deepseek", "bedrock"]),
  modelID: z.string()
})

export const ProviderConfigSchema = z.object({
  apiKey: z.string().optional(),           // BYO key (overrides env)
  baseURL: z.string().url().optional(),
  options: z.record(z.string(), z.unknown()).optional()
})

export const AgentPermissionSchema = z.object({
  edit: z.enum(["ask", "allow", "deny"]).default("allow"),
  bash: z.enum(["ask", "allow", "deny"]).default("ask"),
  webfetch: z.enum(["ask", "allow", "deny"]).default("allow")
}).strict()

export const AgentConfigSchema = z.object({
  model: ModelRefSchema.optional(),
  prompt: z.string().optional(),             // path or inline content
  tools: z.record(z.string(), z.boolean()).optional(),
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
  steps: z.number().int().positive().optional().default(50),
  permission: AgentPermissionSchema.optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional()
}).strict()

export const KiloConfigSchema = z.object({
  $schema: z.string().url().optional(),
  model: ModelRefSchema.optional(),
  smallModel: ModelRefSchema.optional(),     // for cheap tasks like title
  defaultAgent: z.string().default("build"),
  mode: z.enum(["build", "plan"]).default("plan"),
  provider: z.record(z.string(), ProviderConfigSchema).optional(),
  agent: z.record(z.string(), AgentConfigSchema).optional(),
  mcp: z.record(z.string(), z.object({
    type: z.enum(["stdio", "sse", "http"]),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    url: z.string().url().optional(),
    env: z.record(z.string(), z.string()).optional(),
    enabled: z.boolean().default(true)
  }).strict()).optional(),
  share: z.enum(["local", "team", "public"]).default("local"),
  autoshare: z.boolean().default(false),
  theme: z.string().default("system"),
  experimental: z.object({
    hook: z.record(z.string(), z.array(z.object({
      command: z.array(z.string()),
      environment: z.record(z.string(), z.string()).optional()
    }))).optional()
}).strict()

export type KiloConfig = z.infer<typeof KiloConfigSchema>
```

### Step 3: Implement config loader

`packages/runtime/src/config/loader.ts`:

```ts
import { existsSync, readFileSync } from "fs"
import { resolve, join, dirname } from "path"
import { parse as parseJsonc, parseTree, Node } from "jsonc-parser"
import { KiloConfigSchema, type KiloConfig } from "./schema.js"
import { findUp } from "./find-up.js"

const CONFIG_FILENAMES = ["kilo.jsonc", "kilo.json"]

export async function resolveConfig(cwd: string): Promise<KiloConfig> {
  // 1. Find the closest config file (walking up from cwd)
  const configPath = await findConfigFile(cwd)
  if (!configPath) return KiloConfigSchema.parse({})

  // 2. Read and parse (JSONC — supports comments)
  const raw = readFileSync(configPath, "utf-8")
  const parsed = parseJsonc(raw, undefined, { allowTrailingComma: true, disallowComments: false })

  // 3. Validate with Zod
  const result = KiloConfigSchema.safeParse(parsed)
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n")
    throw new Error(`Invalid ${configPath}:\n${issues}`)
  }

  // 4. Apply defaults from env (BYOK fallback)
  const cfg = applyEnvDefaults(result.data)
  return cfg
}

async function findConfigFile(start: string): Promise<string | undefined> {
  let dir = start
  while (true) {
    for (const name of CONFIG_FILENAMES) {
      const path = join(dir, name)
      if (existsSync(path)) return path
    }
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

function applyEnvDefaults(cfg: KiloConfig): KiloConfig {
  const merged = { ...cfg }
  if (!merged.provider) merged.provider = {}

  // ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY → provider defaults
  if (process.env.ANTHROPIC_API_KEY && !merged.provider.anthropic?.apiKey) {
    merged.provider.anthropic = { ...merged.provider.anthropic, apiKey: process.env.ANTHROPIC_API_KEY }
  }
  if (process.env.OPENAI_API_KEY && !merged.provider.openai?.apiKey) {
    merged.provider.openai = { ...merged.provider.openai, apiKey: process.env.OPENAI_API_KEY }
  }
  if (process.env.GOOGLE_API_KEY && !merged.provider.google?.apiKey) {
    merged.provider.google = { ...merged.provider.google, apiKey: process.env.GOOGLE_API_KEY }
  }
  return merged
}
```

### Step 4: Implement findUp utility

`packages/runtime/src/config/find-up.ts`:

```ts
import { existsSync, statSync } from "fs"
import { dirname, join } from "path"
import { homedir } from "os"

export async function findUp(name: string, start: string): Promise<string | undefined> {
  let dir = start
  while (true) {
    const candidate = join(dir, name)
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

export function homeConfigPath(name: string): string {
  return join(homedir(), ".kilocode", name)
}
```

Install jsonc-parser:
```bash
cd packages/runtime && bun add jsonc-parser
```

### Step 5: Implement discovery service

`packages/runtime/src/discovery/index.ts`:

```ts
import { existsSync, readdirSync, statSync, readFileSync } from "fs"
import { join, resolve, isAbsolute } from "path"
import { homedir } from "os"

const PROJECT_DIRS = [".kilo", ".kilocode", ".opencode"]
const USER_DIRS = [
  join(homedir(), ".kilocode"),
  join(homedir(), ".kilo"),
  join(homedir(), ".opencode")
]
const COMPAT_DIRS = [".claude", ".agents"]

export type DiscoveryResult = {
  agents: DiscoveryEntry[]
  commands: DiscoveryEntry[]
  skills: DiscoveryEntry[]
  modes: DiscoveryEntry[]
}

export type DiscoveryEntry = {
  name: string
  path: string
  scope: "user" | "project"
  content: string
}

export async function discoverAll(cwd: string): Promise<DiscoveryResult> {
  return {
    agents: await discover(cwd, ["agent", "agents"], "agents", isAgentFile),
    commands: await discover(cwd, ["command", "commands"], "commands", isCommandFile),
    skills: await discover(cwd, ["skill", "skills"], "skills", isSkillFile),
    modes: await discover(cwd, ["mode", "modes"], "modes", isModeFile)
  }
}

async function discover(
  cwd: string,
  subdirs: string[],
  pattern: "agents" | "commands" | "skills" | "modes",
  isValid: (filename: string) => boolean
): Promise<DiscoveryEntry[]> {
  const entries: DiscoveryEntry[] = []
  const seen = new Set<string>()

  // User-level first (lowest priority)
  for (const userDir of [...USER_DIRS, ...COMPAT_DIRS.flatMap((c) => [`${homedir()}/${c}`])]) {
    for (const sub of subdirs) {
      const dir = join(userDir, sub)
      if (!existsSync(dir)) continue
      await scanDir(dir, "user", entries, seen, isValid, pattern)
    }
  }

  // Project-level (highest priority — overrides user)
  for (const projectDir of [...PROJECT_DIRS, ...COMPAT_DIRS]) {
    const dir = resolve(cwd, projectDir, subdirs[0])
    if (!existsSync(dir)) continue
    await scanDir(dir, "project", entries, seen, isValid, pattern)
  }

  return entries
}

async function scanDir(
  dir: string,
  scope: "user" | "project",
  entries: DiscoveryEntry[],
  seen: Set<string>,
  isValid: (filename: string) => boolean,
  pattern: string
) {
  // Scan for *.md files (most use markdown)
  const walk = (path: string) => {
    if (!existsSync(path)) return
    const stat = statSync(path)
    if (stat.isFile() && path.endsWith(".md") && isValid(path)) {
      const name = basename(path, ".md")
      if (seen.has(`${scope}:${name}`)) return
      seen.add(`${scope}:${name}`)
      entries.push({ name, path, scope, content: readFileSync(path, "utf-8") })
    } else if (stat.isDirectory()) {
      for (const child of readdirSync(path)) walk(join(path, child))
    }
  }
  walk(dir)
}

function basename(path: string, ext: string): string {
  const base = path.split("/").pop() ?? path
  return base.endsWith(ext) ? base.slice(0, -ext.length) : base
}

function isAgentFile(p: string) { return p.endsWith("AGENT.md") || p.includes("/agents/") }
function isCommandFile(p: string) { return p.includes("/command/") }
function isSkillFile(p: string) { return p.includes("/skill/") && p.endsWith("/SKILL.md") }
function isModeFile(p: string) { return p.includes("/mode/") }
```

### Step 6: Wire into runtime index

`packages/runtime/src/index.ts`:

```ts
export * from "./config/schema.js"
export * from "./config/loader.js"
export * from "./discovery/index.js"
export * as config from "./config/loader.js"
```

### Step 7: Update CLI to use config

`packages/cli/src/commands/run.ts`:

```ts
import { resolveConfig, discoverAll } from "@kilocode/runtime"

export async function runCommand(opts: any) {
  const cfg = await resolveConfig(process.cwd())
  const discoveries = await discoverAll(process.cwd())

  console.error(`[kilo] config: ${JSON.stringify(cfg)}`)
  console.error(`[kilo] discovered: ${discoveries.agents.length} agents, ${discoveries.commands.length} commands, ${discoveries.skills.length} skills`)

  // Real runSession in prompt 15
  const { runSession } = await import("@kilocode/runtime/agent")
  await runSession({ cwd: process.cwd(), config: cfg, ...opts, onText: (t: string) => process.stdout.write(t) })
}
```

### Step 8: Create a sample kilo.json for testing

`./kilo.json` (in your test project):

```jsonc
{
  "$schema": "https://kilocode.dev/config.json",
  "model": {
    "providerID": "anthropic",
    "modelID": "claude-sonnet-4-5"
  },
  "smallModel": {
    "providerID": "anthropic",
    "modelID": "claude-3-5-haiku-20241022"
  },
  "defaultAgent": "build",
  "mode": "plan",
  "provider": {
    // API keys also read from env: ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY
  },
  "agent": {
    "build": {
      "prompt": "{file:./prompts/build.txt}",
      "tools": { "bash": true, "edit": true },
      "permission": { "bash": "ask", "edit": "allow" }
    }
  },
  "mcp": {
    "filesystem": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
    }
  }
}
```

### Step 9: Create sample commands / agents / skills

`./.kilo/commands/review.md`:
```markdown
---
description: Review changed files for issues
agent: code-reviewer
---
Review the git diff in the current working directory. Focus on bugs, security, and style.
```

`./.kilo/agents/security-reviewer.md`:
```markdown
---
description: Security-focused code reviewer
mode: primary
tools: { write: false, edit: false, bash: false }
---
You are a security engineer. Review code for OWASP Top 10 issues.
```

### Step 10: Commit

```bash
git add -A
git commit -m "feat(config,discovery): kilo.json + .kilo/.claude/.agents discovery (prompt 03)"
```

## Files created

```
packages/runtime/src/
├── config/
│   ├── schema.ts
│   ├── loader.ts
│   └── find-up.ts
└── discovery/
    └── index.ts

# Test fixtures (in your test project):
./kilo.json
./.kilo/commands/review.md
./.kilo/agents/security-reviewer.md
```

## Acceptance criteria

- [ ] `resolveConfig(cwd)` returns merged config from kilo.json + env vars
- [ ] Config with comments (JSONC) parses correctly
- [ ] Invalid config throws with helpful error
- [ ] `discoverAll(cwd)` returns agents, commands, skills, modes from all known paths
- [ ] Project-level entries override user-level entries with same name
- [ ] Missing kilo.json returns valid empty config (with defaults)
- [ ] `.claude/skills/` and `.agents/skills/` paths are scanned
- [ ] `findUp` correctly walks up the directory tree

## Verification

```bash
cd test-project  # has kilo.json + .kilo/ dirs
bun run kilo auth test
# Should print "config:" + "discovered:" lines
```

Or in code:
```ts
import { resolveConfig, discoverAll } from "@kilocode/runtime"

const cfg = await resolveConfig("/path/to/project")
console.log(cfg.model, cfg.mode)

const disc = await discoverAll("/path/to/project")
console.log(disc.agents.map((a) => a.name))   // ['security-reviewer', 'build', ...]
console.log(disc.skills.map((s) => s.name))
```

## Notes

- **JSONC support** (with comments) is critical — users add explanatory comments to their config.
- **Env var fallback** for API keys means users don't need to put secrets in kilo.json.
- **Discovery walks project → user** in priority order. Project overrides user.
- **`.claude/` and `.agents/` compatibility** means users can reuse skills from Claude Code or other tools — huge win.
- **Subdirectory naming** accepts both `agent/` and `agents/` (singular + plural) for compat.
- **`find-up`** is hand-rolled (don't add a dep for this 20-liner).
- **`parseTree` from jsonc-parser** preserves comments for IDE support but `parse` is enough for runtime.
- **Config precedence** (later wins): remote well-known → global `~/.config/kilo/kilo.json` → env `KILO_CONFIG_CONTENT` → project `kilo.json` → `.kilo/kilo.json` → managed. v1.1 wires all of these.
- **`mode: "plan"` default** matches Kilo's default behavior — encourages thoughtful first turn.