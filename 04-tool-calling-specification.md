# Tool Calling: LadeStack Build

**Status:** Draft v1 (2026-06-22)
**Related:** PRD.md, system-design.md, agent-loop.md, design.md

---

## 1. Tool registry philosophy

Every tool the agent can call follows the **Kilo Code pattern**:

- A `.ts` file with **TypeScript implementation** (Zod-validated input schema, Effect service)
- A `.txt` file with the **system-prompt description** that gets injected into the LLM context

This separation means the LLM sees only the description; the implementation is hot-swappable, testable, and version-controlled independently.

```ts
// example shape
export const MyTool = {
  // What the LLM sees
  description: "Does X with Y. Use when Z.",
  
  // What the LLM must send
  input: z.object({ ... }),
  
  // What we execute
  execute: (input, ctx) => Effect.gen(function* () {
    // ...
    return { output: "...", sandboxUpdated: true }
  }),
}
```

---

## 2. Tool catalog (MVP)

### 2.1 File tools

#### `read`

**Description:**
```
Reads a file from the project workspace. Returns the file contents with
line numbers (format: "1: content"). For large files, specify offset
and limit to read a portion.

Usage:
- Use this BEFORE edit to ensure you have the latest content.
- If you don't know the exact path, use glob first to find it.
- For binary files (images, fonts), use a different tool (not yet impl).
```

**Input schema:**
```ts
{
  path: string                // absolute path within /workspace
  offset?: number             // 1-indexed line; default 1
  limit?: number              // max lines to return; default 500
}
```

**Output:**
```ts
{
  content: string             // "1: line one\n2: line two\n..."
  totalLines: number
  truncated: boolean
}
```

---

#### `write`

**Description:**
```
Writes a file to the project workspace. Overwrites if file exists.
If file exists, you MUST use read first or this tool will fail.

Usage:
- For NEW files: no read needed.
- For EXISTING files: always read first, then write the complete new content.
- Use this to create new files (components, routes, config) and to overwrite
  small files entirely.
- For surgical changes, prefer edit.
- NEVER proactively create README or docs files unless asked.
```

**Input schema:**
```ts
{
  path: string                // absolute path within /workspace
  content: string             // full new file content
}
```

**Output:**
```ts
{
  bytes: number
  created: boolean            // true if new file, false if overwrite
}
```

---

#### `edit`

**Description:**
```
Performs an exact-string replacement in a file. Use this for surgical
changes — preserve formatting, indentation, comments.

Usage:
- You MUST read the file first in this conversation.
- oldString must match exactly (including whitespace, indentation).
- The edit FAILS if oldString is not found (with error message).
- The edit FAILS if oldString matches multiple locations.
- Use replace_all for renaming across the file.
- Tip: include 3-5 lines of surrounding context in oldString to ensure uniqueness.
```

**Input schema:**
```ts
{
  path: string
  oldString: string
  newString: string
  replaceAll?: boolean        // default false
}
```

**Output:**
```ts
{
  replacements: number        // count of replacements made
}
```

---

### 2.2 Search tools

#### `glob`

**Description:**
```
Finds files by glob pattern. Use this to discover file paths before reading.

Examples:
- "**/*.tsx"           - all TypeScript React files
- "src/components/*"   - all files in components/
- "**/package.json"    - all package.json files

Returns absolute paths, sorted by modification time (newest first).
```

**Input schema:**
```ts
{
  pattern: string             // glob pattern
  cwd?: string                // default: /workspace
  limit?: number              // default 100
}
```

**Output:**
```ts
{
  paths: string[]
  total: number
}

---

#### `grep`

**Description:**
```
Searches file contents with regex. Returns matching lines with file:line:content format.

Use for:
- Finding references to a function/component
- Locating specific text patterns (imports, error messages)
- Counting occurrences (with count=true)

For large codebases, prefer narrow patterns. Avoid regex with unbounded .*
```

**Input schema:**
```ts
{
  pattern: string             // regex
  path?: string               // default: /workspace
  include?: string            // file glob filter, e.g. "*.tsx"
  context?: number            // lines of context; default 2
  limit?: number              // default 100
  count?: boolean             // return only counts; default false
}
```

**Output:**
```ts
{
  matches: Array<{ path: string; line: number; content: string }>
  total: number
  truncated: boolean
}
```

---

### 2.3 Shell tools

#### `bash`

**Description:**
```
Executes a shell command in the project sandbox.

Usage:
- For file system operations not covered by read/write/edit (mv, cp, mkdir, rm).
- For running package manager commands (npm install, pnpm add).
- For running the build, tests, or linter.
- For inspecting environment (node --version, ls -la).
- DO NOT use this to edit file contents — use edit/write.
- DO NOT use this for interactive commands (no TTY).
- DO NOT use this for long-running processes (no backgrounding in MVP).
- Timeout: 30 seconds (extend with timeout param for builds).
```

**Input schema:**
```ts
{
  command: string
  cwd?: string                // default: /workspace
  timeout?: number            // seconds; default 30; max 300
  env?: Record<string, string>
}
```

**Output:**
```ts
{
  stdout: string
  stderr: string
  exitCode: number
  durationMs: number
}
```

---

### 2.4 Planning tools

#### `plan_enter`

**Description:**
```
Switches the agent into Plan mode. While in Plan mode:
- You CAN use read, glob, grep (read-only)
- You CANNOT use write, edit, bash (write tools are locked)
- You SHOULD write a structured plan to a markdown file
- When done, call plan_exit to hand control back to the user

Call this when:
- The user's request is complex and would benefit from planning first.
- You want to research and design before making changes.
- The task involves multiple files or architectural decisions.

Do NOT call this for simple, one-file changes.
```

**Input schema:**
```ts
{
  reason?: string             // shown to user in UI
}
```

**Output:**
```ts
{
  mode: 'plan'
  availableTools: string[]    // ['read', 'glob', 'grep', 'plan_write', 'plan_exit']
}
```

---

#### `plan_write`

**Description:**
```
Writes a structured plan to .ladestack/plan.md. The plan is shown to the user
for review before implementation begins.

Format guidance:
- Use markdown headings
- Group changes by file
- Include rationale for non-obvious choices
- Note any open questions or assumptions

Example plan structure:
# Plan: Add user authentication

## Goal
Allow users to sign up with email + Google.

## Files to create
- src/app/login/page.tsx
- src/app/signup/page.tsx
- src/app/api/auth/[...nextauth]/route.ts

## Files to modify
- src/app/layout.tsx (add session provider)
- src/middleware.ts (protect /dashboard routes)

## Dependencies to add
- next-auth@^4
- @auth/supabase-adapter

## Open questions
- Do we want password auth, or OAuth-only?
```

**Input schema:**
```ts
{
  content: string             // markdown plan
}
```

**Output:**
```ts
{
  path: string                // ".ladestack/plan.md"
  bytes: number
}
```

---

#### `plan_exit`

**Description:**
```
Ends Plan mode and hands control back to the user for review.
Call this ONCE after plan_write is complete and the plan is ready.

The user will:
- Approve → implementation begins (agent re-enters Build mode)
- Edit → you may be re-engaged to revise
- Reject → end session
```

**Input schema:**
```ts
{
  summary: string             // 1-2 sentence summary shown to user
}
```

**Output:**
```ts
{
  mode: 'build' | 'ended'
  planPath: string
}
```

---

### 2.5 Meta tools

#### `todowrite`

**Description:**
```
Manages a todo list for multi-step tasks. Use this to break complex work
into trackable steps and show progress to the user.

When to use:
- Tasks with 3+ distinct steps
- Tasks where the user benefits from seeing progress
- Tasks where you might lose track of state

When NOT to use:
- Single-step changes
- Pure Q&A
```

**Input schema:**
```ts
{
  items: Array<{
    id: string                // stable across updates
    status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
    content: string           // brief description
  }>
}
```

**Output:**
```ts
{
  accepted: boolean
}
```

---

#### `question`

**Description:**
```
Asks the user a clarifying question. Use this ONLY when you genuinely cannot
proceed without an answer. Prefer making reasonable assumptions and noting
them in the plan or response.

Do NOT use this for:
- Questions you can answer by reading the codebase
- Minor preference choices (just pick a sensible default)
- Rhetorical questions

DO use this for:
- Ambiguous core requirements
- Destructive actions (deleting files, major rewrites)
- Choices that significantly affect the architecture
```

**Input schema:**
```ts
{
  question: string
  options?: Array<{           // 2-4 multiple choice options
    label: string
    description?: string
  }>
  multiSelect?: boolean       // allow multiple options; default false
}
```

**Output:**
```ts
{
  answer: string              // user's selection or free text
  cancelled: boolean          // true if user dismissed
}
```

---

## 3. Tool dispatch (LLM-side contract)

All tool calls use the OpenAI / Anthropic tool-use format:

```json
{
  "type": "tool_use",
  "id": "toolu_01abc",
  "name": "write",
  "input": {
    "path": "/workspace/src/app/page.tsx",
    "content": "export default function Page() { return <div>Hi</div> }"
  }
}
```

**Provider differences:**

| Provider | Tool schema format | Notes |
|---|---|---|
| Anthropic | `tools: [{name, description, input_schema}]` | Strict JSON schema |
| OpenAI | `tools: [{type: "function", function: {name, description, parameters}}]` | Loose schema (extra fields ignored) |
| Google | `tools: [{function_declarations: [{name, description, parameters}]}]` | Schema-first; weaker enforcement |

**Adapter layer normalizes these** — agent code only sees our internal format.

---

## 4. Tool execution flow

```
┌─────────────────────────────────────────────────────────────┐
│ Loop (in agent runtime)                                     │
│                                                              │
│  1. LLM returns: { stop_reason: 'tool_use', tool_calls }    │
│  2. For each tool_call:                                     │
│       a. Validate input against tool's Zod schema           │
│       b. If invalid: return error message to LLM            │
│       c. If valid: invoke tool.execute(input, ctx)          │
│       d. Capture result                                     │
│       e. Append as tool message to history                  │
│       f. Stream to client via SSE                           │
│  3. If sandbox mutated (write/edit/bash):                   │
│       - Wait for Vite HMR (or trigger manually)             │
│       - Check for TS errors                                 │
│       - If errors: append as system note to history         │
│  4. Loop back to step 1 with updated history                │
│  5. Exit when:                                              │
│       - LLM returns stop_reason != 'tool_use'               │
│       - Max steps reached (default 25)                      │
│       - User cancels (abort signal)                         │
│       - Repeated error 3x                                  │
└─────────────────────────────────────────────────────────────┘
```

---

## 5. Tool permissions

Per-project (user-tunable) and per-agent (system-enforced):

| Tool | build agent | plan agent | explore agent |
|---|---|---|---|
| read | ✅ | ✅ | ✅ |
| write | ✅ | ❌ | ❌ |
| edit | ✅ | ❌ | ❌ |
| glob | ✅ | ✅ | ✅ |
| grep | ✅ | ✅ | ✅ |
| bash | ✅ | ❌ | ❌ (read-only commands only) |
| plan_enter | ✅ | n/a | ❌ |
| plan_write | ❌ | ✅ | ❌ |
| plan_exit | ❌ | ✅ | ❌ |
| todowrite | ✅ | ✅ | ❌ |
| question | ✅ | ✅ | ✅ |

**User override:** project settings has a "tool permissions" panel where advanced users can disable tools globally (e.g., "agent cannot use bash").

---

## 6. Tool output streaming

Each tool call streams back to the client as it executes:

```json
// Initial
{ "type": "tool_start", "id": "toolu_01", "name": "write", "input": {...} }

// Progress (for long-running tools like bash)
{ "type": "tool_progress", "id": "toolu_01", "stdout_chunk": "..." }

// Result
{ "type": "tool_end", "id": "toolu_01", "result": {...} }

// Error
{ "type": "tool_error", "id": "toolu_01", "error": "oldString not found" }
```

Client renders these as collapsible cards in the chat (green border = success, red = error).

---

## 7. Future tools (post-MVP)

#### `mcp_*` — Model Context Protocol tools

Generic loader for MCP servers. User can add MCP servers (e.g., Stripe MCP, Figma MCP) via settings. Tools appear dynamically in the registry.

#### `websearch` — Web search

For grounding on current docs. Uses Brave Search API or similar.

#### `image_generation` — Image gen

Generate images via DALL-E / SD / Flux for hero images, illustrations.

#### `deploy` — Trigger deployment

Programmatic deploy trigger (alternative to UI button).

#### `db_query` — Run SQL

For projects with a connected database (Supabase), execute read-only queries for verification.

#### `git_*` — Git operations

Read diff, create branch, merge, push. Currently we do these implicitly.

---

## 8. Tool schema validation example

```ts
import { z } from "zod"
import { Tool } from "./registry"

const EditInput = z.object({
  path: z.string().min(1).max(500),
  oldString: z.string().min(1).max(50_000),
  newString: z.string().max(50_000),
  replaceAll: z.boolean().default(false),
})

const EditOutput = z.object({
  replacements: z.number().int().nonnegative(),
})

export const editTool: Tool<typeof EditInput, typeof EditOutput> = {
  name: "edit",
  description: EDIT_DESCRIPTION,  // from edit.txt
  
  input: EditInput,
  output: EditOutput,
  
  async execute(input, ctx) {
    // Validate path is within /workspace (sandbox isolation)
    if (!input.path.startsWith(ctx.workspace)) {
      throw new ToolError("Path outside workspace", "PATH_FORBIDDEN")
    }
    
    // Read current content (defense in depth — already enforced by UI)
    const current = await ctx.sandbox.read(input.path)
    
    // Verify oldString exists (cheap pre-check)
    if (!current.includes(input.oldString)) {
      throw new ToolError(
        "oldString not found in file. Re-read the file and try again.",
        "OLDSTRING_NOT_FOUND",
      )
    }
    
    // Count matches for unique-match requirement
    const matches = current.split(input.oldString).length - 1
    if (matches > 1 && !input.replaceAll) {
      throw new ToolError(
        `Found ${matches} matches. Provide more context or use replaceAll.`,
        "OLDSTRING_AMBIGUOUS",
      )
    }
    
    // Apply edit
    const next = input.replaceAll
      ? current.replaceAll(input.oldString, input.newString)
      : current.replace(input.oldString, input.newString)
    
    await ctx.sandbox.write(input.path, next)
    
    // Trigger Vite HMR
    await ctx.sandbox.notifyChange(input.path)
    
    return { replacements: input.replaceAll ? matches : 1 }
  },
}
```

---

## 9. Sandbox isolation guarantees

Every tool that touches the filesystem enforces:

1. **Path containment:** `path.startsWith(workspace)` — no `..`, no `/etc`, no absolute paths outside workspace
2. **No symlink escape:** resolve symlinks and re-check
3. **Read-before-write:** write/edit on existing file requires prior read in this session
4. **No destructive operations without confirmation:** `rm -rf /` and similar are blocked at bash level

**Bash whitelist (MVP):** deny commands matching dangerous patterns:
- `rm -rf /`
- `curl ... | bash`
- writes outside `/workspace`
- modifies `/etc`, `/var`, `/usr`, `/root`
- network requests outside approved hosts (LLM API, npm registry, GitHub)

---

**End of tool-calling.md** — next: agent-loop.md
