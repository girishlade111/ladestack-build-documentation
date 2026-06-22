# Prompt 09: Tool Registry + Base Tools

## Goal

Build the tool registry with 8 base tools (read, write, edit, glob, grep, bash, todowrite, question). Each tool follows the Kilo Code `.ts` + `.txt` pair pattern. Tools are Zod-validated and enforce sandbox isolation.

## Context (from prompts 01-08)

- All foundation built. Agent registry done.
- The composer references `listAvailableTools()` from `packages/runtime/src/tools/registry.ts` (stub from prompt 07).

Reference: `../tool-calling.md` (full tool catalog with schemas), `../agent-loop.md` §4 (tool dispatch).

## Task

### Step 1: Create the tools directory

```bash
mkdir -p packages/runtime/src/tools
```

### Step 2: Define the tool interface

`packages/runtime/src/tools/types.ts`:

```ts
import { z } from "zod"

export interface ToolContext {
  userId: string
  projectId: string
  sessionId: string
  abortSignal: AbortSignal
}

export interface Tool<I = unknown, O = unknown> {
  name: string
  description: string
  inputSchema: z.ZodType<I>
  outputSchema: z.ZodType<O>
  restrictedTo?: string[]            // if set, only these agents can use it
  execute(input: I, ctx: ToolContext): Promise<O>
}

export class ToolError extends Error {
  constructor(message: string, public code: string) {
    super(message)
  }
}
```

### Step 3: Implement `read` tool

`packages/runtime/src/tools/read.ts`:

```ts
import { z } from "zod"
import { join } from "path"
import { Tool, ToolContext, ToolError } from "./types.js"
import { sandboxOps } from "../sandbox/operations.js"

const InputSchema = z.object({
  path: z.string().min(1).max(500),
  offset: z.number().int().positive().optional().default(1),
  limit: z.number().int().positive().max(1000).optional().default(500)
})

const OutputSchema = z.object({
  content: z.string(),
  totalLines: z.number(),
  truncated: z.boolean()
})

export const readTool: Tool<z.infer<typeof InputSchema>, z.infer<typeof OutputSchema>> = {
  name: "read",
  description: `Reads a file from the project workspace. Returns the file contents with line numbers (format: "1: content\\n2: content\\n...").

Usage:
- Use this BEFORE editing an existing file to get the latest content.
- Use offset and limit for large files.
- If you don't know the exact path, use glob first.

Returns: { content: string, totalLines: number, truncated: boolean }
`.trim(),
  inputSchema: InputSchema,
  outputSchema: OutputSchema,

  async execute(input, ctx) {
    if (input.path.startsWith("/") || input.path.includes("..")) {
      throw new ToolError("path must be relative and within workspace", "PATH_FORBIDDEN")
    }
    const content = await sandboxOps.read(ctx.projectId, input.path)
    const allLines = content.split("\n")
    const totalLines = allLines.length
    const lines = allLines.slice(input.offset - 1, input.offset - 1 + input.limit)
    const truncated = totalLines > lines.length + (input.offset - 1)
    const numbered = lines.map((line, i) => `${input.offset + i}: ${line}`).join("\n")
    return { content: numbered, totalLines, truncated }
  }
}
```

### Step 4: Implement `write` tool

`packages/runtime/src/tools/write.ts`:

```ts
import { z } from "zod"
import { Tool, ToolError } from "./types.js"
import { sandboxOps } from "../sandbox/operations.js"

const InputSchema = z.object({
  path: z.string().min(1).max(500),
  content: z.string().max(500_000)
})

const OutputSchema = z.object({
  bytes: z.number(),
  created: z.boolean()
})

// Track which files have been read in this session (for read-before-write enforcement)
const readFilesThisSession = new Map<string, Set<string>>()

export function markFileRead(sessionId: string, path: string) {
  if (!readFilesThisSession.has(sessionId)) readFilesThisSession.set(sessionId, new Set())
  readFilesThisSession.get(sessionId)!.add(path)
}

export const writeTool: Tool<z.infer<typeof InputSchema>, z.infer<typeof OutputSchema>> = {
  name: "write",
  description: `Writes a file to the project workspace. Overwrites if file exists.

Usage:
- For NEW files: no read needed.
- For EXISTING files: you MUST use read first in this conversation. This tool will fail otherwise.
- Use this for new files only. For surgical edits to existing files, prefer edit.
`.trim(),
  inputSchema: InputSchema,
  outputSchema: OutputSchema,

  async execute(input, ctx) {
    if (input.path.startsWith("/") || input.path.includes("..")) {
      throw new ToolError("path must be relative and within workspace", "PATH_FORBIDDEN")
    }

    // Check if file exists; if so, require read first
    let exists = false
    try {
      await sandboxOps.read(ctx.projectId, input.path)
      exists = true
    } catch {
      exists = false
    }

    if (exists) {
      const read = readFilesThisSession.get(ctx.sessionId)
      if (!read?.has(input.path)) {
        throw new ToolError(`file exists at ${input.path}. Use read tool first to view contents.`, "READ_REQUIRED")
      }
    }

    await sandboxOps.write(ctx.projectId, [{ path: input.path, content: input.content }])
    return { bytes: Buffer.byteLength(input.content, "utf-8"), created: !exists }
  }
}
```

### Step 5: Implement `edit` tool

`packages/runtime/src/tools/edit.ts`:

```ts
import { z } from "zod"
import { Tool, ToolError } from "./types.js"
import { sandboxOps } from "../sandbox/operations.js"
import { markFileRead } from "./write.js"

const InputSchema = z.object({
  path: z.string().min(1).max(500),
  oldString: z.string().min(1).max(50_000),
  newString: z.string().max(50_000),
  replaceAll: z.boolean().optional().default(false)
})

const OutputSchema = z.object({
  replacements: z.number()
})

export const editTool: Tool<z.infer<typeof InputSchema>, z.infer<typeof OutputSchema>> = {
  name: "edit",
  description: `Performs exact-string replacement in a file. Use this for surgical changes to existing files.

Usage:
- You MUST use read tool first in this conversation for this file.
- oldString must match exactly (including whitespace, indentation).
- Include 3-5 lines of surrounding context to ensure unique match.
- If oldString is ambiguous (matches multiple places), add more context or use replaceAll.
`.trim(),
  inputSchema: InputSchema,
  outputSchema: OutputSchema,

  async execute(input, ctx) {
    if (input.path.startsWith("/") || input.path.includes("..")) {
      throw new ToolError("path must be relative and within workspace", "PATH_FORBIDDEN")
    }

    const read = (await import("./write.js")).readFilesThisSession  // HACK: use internal map
    const sessionReads = read.get(ctx.sessionId)
    if (!sessionReads?.has(input.path)) {
      throw new ToolError(`file not read in this session: ${input.path}. Use read tool first.`, "READ_REQUIRED")
    }

    const current = await sandboxOps.read(ctx.projectId, input.path)

    if (!current.includes(input.oldString)) {
      throw new ToolError(`oldString not found in ${input.path}. The file may have changed; use read to refresh.`, "OLDSTRING_NOT_FOUND")
    }

    const occurrences = current.split(input.oldString).length - 1
    if (occurrences > 1 && !input.replaceAll) {
      throw new ToolError(`oldString matches ${occurrences} places in ${input.path}. Add more context or set replaceAll=true.`, "OLDSTRING_AMBIGUOUS")
    }

    const next = input.replaceAll
      ? current.replaceAll(input.oldString, input.newString)
      : current.replace(input.oldString, input.newString)

    await sandboxOps.write(ctx.projectId, [{ path: input.path, content: next }])
    markFileRead(ctx.sessionId, input.path)
    return { replacements: input.replaceAll ? occurrences : 1 }
  }
}
```

### Step 6: Implement `glob` tool

`packages/runtime/src/tools/glob.ts`:

```ts
import { z } from "zod"
import { Tool } from "./types.js"
import { sandboxOps } from "../sandbox/operations.js"

const InputSchema = z.object({
  pattern: z.string().min(1).max(500),
  cwd: z.string().optional().default(""),
  limit: z.number().int().positive().max(1000).optional().default(100)
})

const OutputSchema = z.object({
  paths: z.array(z.string()),
  total: z.number()
})

export const globTool: Tool<z.infer<typeof InputSchema>, z.infer<typeof OutputSchema>> = {
  name: "glob",
  description: `Finds files by glob pattern. Use to discover files before reading.

Examples:
- "**/*.tsx" - all TypeScript React files
- "src/components/*" - all files in components/
- "**/package.json" - all package.json files

Returns: { paths: string[], total: number }
`.trim(),
  inputSchema: InputSchema,
  outputSchema: OutputSchema,

  async execute(input) {
    const files = await sandboxOps.list(/* projectId, */ "FIXME")  // TODO: pass projectId
    return { paths: files, total: files.length }
  }
}
```

**NOTE**: There's a bug above — `sandboxOps.list` needs `projectId`. Let me fix the API in prompt 05's `daytona.ts` to also accept `projectId`. For now, assume the API is `listFiles(projectId, subdir)`.

Actually, the signature in prompt 05 is:
```ts
export async function listFiles(projectId: string, subdir = ""): Promise<string[]>
```

So `globTool.execute` should be:
```ts
async execute(input, ctx) {
  const files = await sandboxOps.list(ctx.projectId, input.cwd)
  return { paths: files, total: files.length }
}
```

### Step 7: Implement `grep` tool (placeholder — use ripgrep in sandbox)

`packages/runtime/src/tools/grep.ts`:

```ts
import { z } from "zod"
import { Tool } from "./types.js"
import { sandboxOps } from "../sandbox/operations.js"

const InputSchema = z.object({
  pattern: z.string().min(1).max(500),
  path: z.string().optional().default(""),
  include: z.string().optional(),
  context: z.number().int().min(0).max(20).optional().default(2),
  limit: z.number().int().positive().max(1000).optional().default(100)
})

const OutputSchema = z.object({
  matches: z.array(z.object({ path: z.string(), line: z.number(), content: z.string() })),
  total: z.number(),
  truncated: z.boolean()
})

export const grepTool: Tool<z.infer<typeof InputSchema>, z.infer<typeof OutputSchema>> = {
  name: "grep",
  description: `Searches file contents with regex. Returns matching lines with file:line:content format.

Use for: finding references, locating specific patterns, counting occurrences.
For large codebases, use narrow patterns.
`.trim(),
  inputSchema: InputSchema,
  outputSchema: OutputSchema,

  async execute(input, ctx) {
    // Use ripgrep in sandbox
    const cmd = `rg --line-number --no-heading --max-count ${input.limit} ${input.context ? `-C ${input.context}` : ""} ${input.include ? `-g "${input.include}"` : ""} '${input.pattern.replace(/'/g, "'\\''")}' ${input.path}`
    const result = await sandboxOps.exec(ctx.projectId, cmd)
    if (result.exitCode !== 0 && result.stdout === "") {
      return { matches: [], total: 0, truncated: false }
    }
    const lines = result.stdout.split("\n").filter(Boolean)
    const matches = lines.map((line) => {
      const match = line.match(/^([^:]+):(\d+):(.*)$/)
      if (!match) return null
      return { path: match[1], line: parseInt(match[2], 10), content: match[3] }
    }).filter(Boolean) as Array<{ path: string; line: number; content: string }>
    return { matches, total: matches.length, truncated: matches.length >= input.limit }
  }
}
```

### Step 8: Implement `bash` tool (with safety restrictions)

`packages/runtime/src/tools/bash.ts`:

```ts
import { z } from "zod"
import { Tool, ToolError } from "./types.js"
import { sandboxOps } from "../sandbox/operations.js"

const InputSchema = z.object({
  command: z.string().min(1).max(5000),
  cwd: z.string().optional(),
  timeout: z.number().int().positive().max(300).optional().default(30),
  env: z.record(z.string(), z.string()).optional()
})

const OutputSchema = z.object({
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number(),
  durationMs: z.number()
})

const DANGEROUS_PATTERNS = [
  /rm\s+-rf\s+\/(?!\w)/,           // rm -rf / (but not /workspace)
  /curl.*\|\s*bash/,                // curl | bash
  /\|\s*sh\s*$/,                    // | sh
  />\s*\/etc\//,                     // writes to /etc
  /git\s+push\s+--force/,            // force push (without --force-with-lease)
  /git\s+reset\s+--hard/,            // hard reset
  /sudo/,                            // privilege escalation
  /chmod\s+777/,                     // world-writable
  /mkfs/,                            // filesystem format
  /dd\s+if=/                         // disk operations
]

export const bashTool: Tool<z.infer<typeof InputSchema>, z.infer<typeof OutputSchema>> = {
  name: "bash",
  description: `Executes a shell command in the project sandbox.

Usage:
- For npm/pnpm/bun, git, build, test, lint.
- For running scripts.
- DO NOT use this to edit file contents (use write/edit).
- DO NOT use for long-running processes (no backgrounding).
- Default timeout: 30 seconds. Max: 300 seconds.
- Some dangerous commands are blocked (rm -rf /, etc.).
`.trim(),
  inputSchema: InputSchema,
  outputSchema: OutputSchema,

  async execute(input, ctx) {
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(input.command)) {
        throw new ToolError(`dangerous command blocked: matches ${pattern}`, "DANGEROUS_COMMAND")
      }
    }

    const start = Date.now()
    const result = await sandboxOps.exec(
      ctx.projectId,
      input.command,
      input.cwd,
      input.timeout * 1000
    )
    return { ...result, durationMs: Date.now() - start }
  }
}
```

### Step 9: Implement `todowrite` tool

`packages/runtime/src/tools/todowrite.ts`:

```ts
import { z } from "zod"
import { Tool } from "./types.js"
import { supabaseAdmin } from "../db/client.js"

const InputSchema = z.object({
  items: z.array(z.object({
    id: z.string(),
    status: z.enum(["pending", "in_progress", "completed", "cancelled"]),
    content: z.string().min(1).max(200)
  })).min(1).max(50)
})

const OutputSchema = z.object({ accepted: z.boolean() })

export const todowriteTool: Tool<z.infer<typeof InputSchema>, z.infer<typeof OutputSchema>> = {
  name: "todowrite",
  description: `Manages a todo list for multi-step tasks. Use for tasks with 3+ distinct steps where the user benefits from seeing progress.

The todo list is persisted per session and visible in the UI.
`.trim(),
  inputSchema: InputSchema,
  outputSchema: OutputSchema,

  async execute(input, ctx) {
    await supabaseAdmin.from("messages").insert({
      session_id: ctx.sessionId,
      role: "system",
      content: JSON.stringify({ type: "todo_update", items: input.items }),
      agent: "build"
    })
    return { accepted: true }
  }
}
```

### Step 10: Implement `question` tool

`packages/runtime/src/tools/question.ts`:

```ts
import { z } from "zod"
import { Tool } from "./types.js"
import { supabaseAdmin } from "../db/client.js"

const InputSchema = z.object({
  question: z.string().min(1).max(500),
  options: z.array(z.object({
    label: z.string().min(1).max(100),
    description: z.string().max(500).optional()
  })).min(1).max(4).optional(),
  multiSelect: z.boolean().optional().default(false)
})

const OutputSchema = z.object({
  answer: z.string(),
  cancelled: z.boolean()
})

export const questionTool: Tool<z.infer<typeof InputSchema>, z.infer<typeof OutputSchema>> = {
  name: "question",
  description: `Asks the user a clarifying question. Use ONLY when you genuinely cannot proceed without an answer.

Do NOT use for:
- Questions you can answer by reading the codebase
- Minor preference choices (pick a sensible default)

DO use for:
- Ambiguous core requirements
- Destructive actions
- Choices that significantly affect architecture
`.trim(),
  inputSchema: InputSchema,
  outputSchema: OutputSchema,

  async execute(input, ctx) {
    // Pause the agent loop and wait for user response (handled by API in prompt 11)
    const { data, error } = await supabaseAdmin.from("messages").insert({
      session_id: ctx.sessionId,
      role: "system",
      content: JSON.stringify({ type: "question", ...input }),
      agent: "build"
    }).select().single()

    if (error) throw error

    // In a real implementation, this would await a user response over SSE.
    // For MVP, return a placeholder answer (the UI handles this via SSE in prompt 15).
    return { answer: "pending_user_response", cancelled: false }
  }
}
```

### Step 11: Update tools/registry.ts (real implementation)

`packages/runtime/src/tools/registry.ts`:

```ts
import type { Tool } from "./types.js"
import { readTool, markFileRead } from "./read.js"
import { writeTool } from "./write.js"
import { editTool } from "./edit.js"
import { globTool } from "./glob.js"
import { grepTool } from "./grep.js"
import { bashTool } from "./bash.js"
import { todowriteTool } from "./todowrite.js"
import { questionTool } from "./question.js"

const tools = new Map<string, Tool>()

register(readTool)
register(writeTool)
register(editTool)
register(globTool)
register(grepTool)
register(bashTool)
register(todowriteTool)
register(questionTool)

function register(tool: Tool) {
  tools.set(tool.name, tool)
}

export function getTool(name: string): Tool | undefined {
  return tools.get(name)
}

export function requireTool(name: string): Tool {
  const tool = tools.get(name)
  if (!tool) throw new Error(`tool not found: ${name}. Available: ${listTools().map((t) => t.name).join(", ")}`)
  return tool
}

export function listTools(): Tool[] {
  return Array.from(tools.values())
}

export function listAvailableTools(): Array<{ name: string; description: string }> {
  return listTools().map((t) => ({ name: t.name, description: t.description }))
}

export function listToolsForAgent(agentName: string): Tool[] {
  const restricted = ["plan", "ask", "explore", "scout"]
  if (restricted.includes(agentName)) {
    return listTools().filter((t) => !["write", "edit", "bash"].includes(t.name))
  }
  if (agentName === "summarize" || agentName === "title") {
    return []
  }
  return listTools()
}

export function getToolDescriptionsForLLM(): Array<{ name: string; description: string }> {
  return listAvailableTools()
}
```

### Step 12: Update runtime index

```ts
// Add to packages/runtime/src/index.ts
export * from "./tools/types.js"
export * as tools from "./tools/registry.js"
export { readTool } from "./tools/read.js"
export { writeTool } from "./tools/write.js"
export { editTool } from "./tools/edit.js"
export { globTool } from "./tools/glob.js"
export { grepTool } from "./tools/grep.js"
export { bashTool } from "./tools/bash.js"
export { todowriteTool } from "./tools/todowrite.js"
export { questionTool } from "./tools/question.js"
export { markFileRead } from "./tools/write.js"
```

### Step 13: Tests

`packages/runtime/src/tools/registry.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { listTools, listToolsForAgent, requireTool } from "./registry.js"

describe("tool registry", () => {
  it("has all 8 base tools", () => {
    const tools = listTools()
    const names = tools.map((t) => t.name).sort()
    expect(names).toEqual(["bash", "edit", "glob", "grep", "question", "read", "todowrite", "write"])
  })

  it("filters tools for plan agent (no write/edit/bash)", () => {
    const tools = listToolsForAgent("plan")
    const names = tools.map((t) => t.name)
    expect(names).not.toContain("write")
    expect(names).not.toContain("edit")
    expect(names).not.toContain("bash")
    expect(names).toContain("read")
  })

  it("filters tools for summarize agent (empty)", () => {
    expect(listToolsForAgent("summarize")).toHaveLength(0)
  })

  it("returns full toolset for build agent", () => {
    expect(listToolsForAgent("build")).toHaveLength(8)
  })

  it("throws on unknown tool", () => {
    expect(() => requireTool("nonexistent")).toThrow(/tool not found/)
  })
})
```

### Step 14: Commit

```bash
git add -A
git commit -m "feat(runtime): tool registry with 8 base tools + sandbox isolation (prompt 09)"
```

## Files created

```
packages/runtime/src/tools/
├── types.ts
├── registry.ts
├── registry.test.ts
├── read.ts
├── write.ts
├── edit.ts
├── glob.ts
├── grep.ts
├── bash.ts
├── todowrite.ts
└── question.ts
```

## Acceptance criteria

- [ ] 8 tools registered (read, write, edit, glob, grep, bash, todowrite, question)
- [ ] `write` enforces read-before-write (throws ToolError)
- [ ] `edit` enforces read-before-edit
- [ ] `edit` throws on ambiguous oldString
- [ ] `edit` throws when oldString not found
- [ ] `bash` blocks dangerous patterns (rm -rf /, force push, etc.)
- [ ] Tool list filters correctly per agent (plan can't write, etc.)
- [ ] All tool inputs validated by Zod

## Verification

```bash
pnpm --filter @ladestack/runtime test -- tools
# expect: 5 tests pass
```

## Notes

- **`markFileRead` is exported from write.ts** because the read tool needs to register file reads. The edit tool also imports it. Cross-imports within tools/ are OK.
- **Bash safety list is conservative.** Add more patterns as you discover them. v1.1 adds a configurable deny-list per workspace.
- **The `question` tool returns a placeholder answer** for now. The real pause-and-wait-for-user logic happens in the agent loop (prompt 11) via SSE.
- **`todowrite` writes a system message** — this is the simplest persistence. v1.1 can add a dedicated `todos` table.
- **`grep` uses ripgrep** which must be installed in the sandbox image (it is by default in `node:20-bookworm-slim`).
- **Tool descriptions are what the LLM sees.** Keep them clear and concise. The .txt files in Kilo Code are good references.
- **Sandbox isolation is enforced at multiple layers**: tool input validation (no `..` or `/`), bash dangerous patterns, sandbox filesystem limits (Daytona). Defense in depth.
- **The `read` tool uses line numbers** matching Kilo Code's format (`1: content`). This is important for the LLM to do accurate edits.
