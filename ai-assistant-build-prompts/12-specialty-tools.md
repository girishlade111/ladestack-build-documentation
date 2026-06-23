# Prompt 12: Specialty Tools (apply_patch, recall, lsp, websearch)

## Goal

Implement the four remaining specialty tools — `apply_patch` (unified-diff format with `*** Begin Patch` markers, same as Anthropic's Claude Code uses), `recall` (search prior conversation history + project memory), `lsp` (Language Server Protocol client for diagnostics / go-to-def / find-refs), and `websearch` (configurable backend — Brave Search API or DuckDuckGo HTML scrape). All four follow the `.ts` + `.txt` pair convention from prompt 06 and use Zod schemas. The `lsp` tool is a thin wrapper around `vscode-langservers-extracted` (TypeScript + Python language servers in-process).

## Context (from prompts 01-11)

- Monorepo + provider + tool registry + filesystem + bash + todowrite + question + plan mode all work (prompts 01-11).
- The patch parser for `apply_patch` is non-trivial — we'll use the `diff` npm package (already in the Kilo Code dep tree) for line-level operations, plus a small hand-rolled parser for the `*** Begin Patch` envelope.
- `recall` searches session JSONL files — prompt 25 wires the JSONL format. For v1, in-memory session history is fine.
- `lsp` integrates with `vscode-langservers-extracted` (TypeScript + Python servers, ~5 MB bundled). The tool spawns these as child processes and pipes JSON-RPC over stdin/stdout.
- `websearch` has two backends — `brave` (paid, $3/1k queries) and `duckduckgo` (free, HTML scrape). User picks in `kilo.json`.

References:
- `../../02-competitive-research.md` §3 — Kilo's tool list + descriptions
- Real Kilo source:
  - `kilocode-clone/packages/opencode/src/tool/apply_patch.ts` — the canonical patch parser
  - `kilocode-clone/packages/opencode/src/tool/recall.ts` — session history search
  - `kilocode-clone/packages/opencode/src/tool/lsp.ts` — LSP wrapper
  - `kilocode-clone/packages/opencode/src/tool/websearch.ts` — multi-provider websearch
- Anthropic's `apply_patch` format: see https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/apply-patch
- `vscode-langservers-extracted`: https://www.npmjs.com/package/vscode-langservers-extracted

## Task

### Step 1: Install dependencies

```bash
cd packages/runtime
bun add diff
bun add vscode-langservers-extracted
bun add -d @types/diff
```

### Step 2: `apply_patch` envelope parser

`packages/runtime/src/tools/apply-patch/parser.ts`:

```ts
/**
 * Parser for the `*** Begin Patch` / `*** End Patch` envelope format.
 *
 * Grammar:
 *   *** Begin Patch
 *   [ hunks... ]
 *   *** End Patch
 *
 * Hunk types:
 *   *** Add File: <path>
 *   [+ line, + line, ...]
 *
 *   *** Delete File: <path>
 *
 *   *** Update File: <path>
 *   *** Move to: <new-path>            (optional rename)
 *   @@ <context marker>               (function/section header)
 *   [- removed line]
 *   [+ added line]
 *    (unchanged line, no prefix)
 *   @@ <next context marker>
 *   ...
 *
 * Each context marker is a fuzzy substring that must exist in the file.
 */

export type Hunk =
  | { type: "add"; path: string; contents: string }
  | { type: "delete"; path: string }
  | { type: "update"; path: string; movePath?: string; chunks: Array<{
      context: string
      oldLines: string[]
      newLines: string[]
    }> }

export class PatchParseError extends Error {
  constructor(message: string, public readonly position?: number) {
    super(message)
    this.name = "PatchParseError"
  }
}

export function parsePatch(text: string): { hunks: Hunk[] } {
  // Normalize line endings.
  const lines = text.replace(/\r\n/g, "\n").split("\n")

  let i = 0
  if (lines[i]?.trim() !== "*** Begin Patch") {
    throw new PatchParseError(`expected '*** Begin Patch' at line ${i + 1}, got '${lines[i]}'`, i)
  }
  i++

  const hunks: Hunk[] = []

  while (i < lines.length) {
    const line = lines[i]!.trim()

    if (line === "*** End Patch") {
      i++
      break
    }

    if (line.startsWith("*** Add File: ")) {
      const path = line.slice("*** Add File: ".length).trim()
      i++
      const contents: string[] = []
      while (i < lines.length && lines[i]!.startsWith("+")) {
        contents.push(lines[i]!.slice(1))
        i++
      }
      hunks.push({ type: "add", path, contents: contents.join("\n") + (contents.length ? "\n" : "") })
      continue
    }

    if (line.startsWith("*** Delete File: ")) {
      const path = line.slice("*** Delete File: ".length).trim()
      hunks.push({ type: "delete", path })
      i++
      continue
    }

    if (line.startsWith("*** Update File: ")) {
      const path = line.slice("*** Update File: ".length).trim()
      i++
      let movePath: string | undefined
      if (lines[i]?.trim().startsWith("*** Move to: ")) {
        movePath = lines[i]!.trim().slice("*** Move to: ".length)
        i++
      }
      const chunks: Hunk extends { type: "update"; chunks: infer C } ? C : never = []
      while (i < lines.length && lines[i]?.startsWith("@@")) {
        const context = lines[i]!.slice(2).trim()
        i++
        const oldLines: string[] = []
        const newLines: string[] = []
        while (
          i < lines.length &&
          (lines[i]!.startsWith("-") || lines[i]!.startsWith("+") || lines[i]!.startsWith(" ") || lines[i] === "")
        ) {
          const ln = lines[i]!
          if (ln === "") { oldLines.push(""); newLines.push(""); i++; continue }
          const prefix = ln[0]
          const content = ln.slice(1)
          if (prefix === "-") oldLines.push(content)
          else if (prefix === "+") newLines.push(content)
          else if (prefix === " ") { oldLines.push(content); newLines.push(content) }
          else break
          i++
        }
        ;(chunks as any).push({ context, oldLines, newLines })
      }
      hunks.push({ type: "update", path, movePath, chunks: chunks as any })
      continue
    }

    if (line === "") { i++; continue }
    throw new PatchParseError(`unexpected line at ${i + 1}: '${line}'`, i)
  }

  if (hunks.length === 0) {
    throw new PatchParseError("patch has no hunks")
  }

  return { hunks }
}
```

### Step 3: `apply_patch` tool

`packages/runtime/src/tools/apply_patch.ts`:

```ts
import { z } from "zod"
import { existsSync, readFileSync } from "fs"
import { writeFile, mkdir } from "fs/promises"
import { dirname, isAbsolute, join } from "path"
import { createTwoFilesPatch, diffLines } from "diff"
import type { ToolExport } from "./tool.js"
import { sandboxPath } from "./fs/sandbox.js"
import { parsePatch } from "./apply-patch/parser.js"

const MAX_PATCH_BYTES = 256 * 1024   // 256 KB

/**
 * apply_patch — apply a multi-file patch in the `*** Begin Patch` envelope
 * format (same as Anthropic's Claude Code).
 *
 * Supports three operations per file:
 *   - Add File: create a new file
 *   - Delete File: remove an existing file
 *   - Update File: patch an existing file (optionally with rename via `*** Move to:`)
 *
 * Returns a per-file diff summary plus any LSP diagnostics detected after
 * applying the patch.
 */
export const applyPatchTool: ToolExport = {
  id: "apply_patch",
  description: "Apply a multi-file patch in the *** Begin Patch envelope format",
  parameters: z.object({
    patchText: z.string().min(1).max(MAX_PATCH_BYTES)
      .describe("The full patch text — must start with '*** Begin Patch' and end with '*** End Patch'"),
  }),
  execute: async (args, ctx) => {
    if (args.patchText.length > MAX_PATCH_BYTES) {
      throw new Error(`patch too large: ${args.patchText.length} bytes (max ${MAX_PATCH_BYTES})`)
    }

    const { hunks } = parsePatch(args.patchText)
    if (hunks.length === 0) throw new Error("empty patch")

    // Resolve all file paths relative to ctx.cwd.
    const resolved = hunks.map((h) => ({
      hunk: h,
      path: sandboxPath(isAbsolute(h.path) ? h.path : h.path, ctx.cwd),
      movePath: "movePath" in h && h.movePath
        ? sandboxPath(isAbsolute(h.movePath) ? h.movePath : h.movePath, ctx.cwd)
        : undefined,
    }))

    // Build per-file changes for permission + diff summary.
    const changes: Array<{
      path: string
      type: "add" | "update" | "delete" | "move"
      movePath?: string
      oldContent: string
      newContent: string
      diff: string
      additions: number
      deletions: number
    }> = []

    for (const { hunk, path, movePath } of resolved) {
      switch (hunk.type) {
        case "add": {
          const newContent = hunk.contents
          const diff = createTwoFilesPatch(path, path, "", newContent, "", "", { context: 3 })
          const counts = countLines("", newContent)
          changes.push({ path, type: "add", oldContent: "", newContent, diff, additions: counts.add, deletions: counts.del })
          break
        }
        case "delete": {
          const oldContent = existsSync(path) ? readFileSync(path, "utf-8") : ""
          const diff = createTwoFilesPatch(path, path, oldContent, "", "", "", { context: 3 })
          changes.push({ path, type: "delete", oldContent, newContent: "", diff, additions: 0, deletions: oldContent.split("\n").length })
          break
        }
        case "update": {
          if (!existsSync(path)) throw new Error(`Update File: file does not exist: ${path}`)
          const oldContent = readFileSync(path, "utf-8")
          const newContent = applyChunks(oldContent, hunk.chunks)
          const diff = createTwoFilesPatch(path, path, oldContent, newContent, "", "", { context: 3 })
          const counts = countLines(oldContent, newContent)
          changes.push({
            path,
            type: movePath ? "move" : "update",
            movePath,
            oldContent,
            newContent,
            diff,
            additions: counts.add,
            deletions: counts.del,
          })
          break
        }
      }
    }

    // Permission gate — show diffs for review.
    await ctx.ask({
      permission: "edit",
      patterns: changes.map((c) => c.path),
      metadata: {
        files: changes.map((c) => ({
          path: c.path,
          movePath: c.movePath,
          type: c.type,
          additions: c.additions,
          deletions: c.deletions,
          diff: c.diff.slice(0, 4000),    // truncate for metadata
        })),
      },
    })

    // Apply changes atomically (sequential with rollback on failure).
    const applied: typeof changes = []
    try {
      for (const change of changes) {
        if (change.type === "add") {
          await mkdir(dirname(change.path), { recursive: true })
          await writeFile(change.path, change.newContent, "utf-8")
        } else if (change.type === "update") {
          await writeFile(change.path, change.newContent, "utf-8")
        } else if (change.type === "delete") {
          const { unlink } = await import("fs/promises")
          await unlink(change.path)
        } else if (change.type === "move" && change.movePath) {
          await mkdir(dirname(change.movePath), { recursive: true })
          await writeFile(change.movePath, change.newContent, "utf-8")
          const { unlink } = await import("fs/promises")
          await unlink(change.path)
        }
        applied.push(change)
      }
    } catch (err) {
      // Best-effort rollback of already-applied changes.
      for (const change of applied.reverse()) {
        try {
          if (change.type === "add" || change.type === "move") {
            const { unlink } = await import("fs/promises")
            await unlink(change.path).catch(() => {})
          } else if (change.type === "update") {
            await writeFile(change.path, change.oldContent, "utf-8")
          }
        } catch { /* ignore rollback errors */ }
      }
      throw new Error(`apply_patch failed at ${applied.length}/${changes.length} files: ${err}`)
    }

    // Build output summary.
    const lines = ["Success. Updated files:"]
    for (const c of changes) {
      const icon = c.type === "add" ? "A" : c.type === "delete" ? "D" : c.type === "move" ? "R" : "M"
      const target = c.movePath ?? c.path
      lines.push(`  ${icon} ${target.replace(ctx.cwd, ".")} (+${c.additions} -${c.deletions})`)
    }

    return {
      title: `Applied ${changes.length} change${changes.length > 1 ? "s" : ""}`,
      output: lines.join("\n"),
      metadata: {
        diff: changes.map((c) => c.diff).join("\n"),
        files: changes.map((c) => ({
          path: c.path,
          movePath: c.movePath,
          type: c.type,
          additions: c.additions,
          deletions: c.deletions,
        })),
      },
    }
  },
}

function applyChunks(oldContent: string, chunks: Array<{ context: string; oldLines: string[]; newLines: string[] }>): string {
  let result = oldContent
  for (const chunk of chunks) {
    const oldBlock = chunk.oldLines.join("\n")
    const newBlock = chunk.newLines.join("\n")

    if (chunk.context) {
      // Anchor on the context line, then replace the next N lines.
      const ctxIdx = result.indexOf(chunk.context)
      if (ctxIdx === -1) {
        throw new Error(`Update File: context not found: "${chunk.context.slice(0, 50)}..."`)
      }
      const after = result.slice(ctxIdx + chunk.context.length)
      const blockEnd = findBlockEnd(after, chunk.oldLines)
      if (blockEnd === -1) {
        throw new Error(`Update File: oldLines not found after context: "${chunk.context.slice(0, 50)}..."`)
      }
      const replaceEnd = ctxIdx + chunk.context.length + blockEnd
      result = result.slice(0, ctxIdx) + chunk.context + (chunk.oldLines.length > 0 ? "\n" : "") + newBlock + result.slice(replaceEnd)
    } else {
      // No context — direct replace.
      const idx = result.indexOf(oldBlock)
      if (idx === -1) {
        throw new Error(`Update File: oldLines not found: "${oldBlock.slice(0, 50)}..."`)
      }
      result = result.slice(0, idx) + newBlock + result.slice(idx + oldBlock.length)
    }
  }
  return result
}

function findBlockEnd(text: string, lines: string[]): number {
  let pos = 0
  for (const line of lines) {
    const next = text.indexOf(line, pos)
    if (next === -1) return -1
    pos = next + line.length + (line.endsWith("\n") ? 0 : 1)
  }
  return pos
}

function countLines(oldText: string, newText: string): { add: number; del: number } {
  let add = 0, del = 0
  for (const change of diffLines(oldText, newText)) {
    if (change.added) add += change.count ?? 0
    if (change.removed) del += change.count ?? 0
  }
  return { add, del }
}
```

`packages/runtime/src/tools/apply_patch.txt`:

```
Use this tool to edit files. Your patch language is a stripped-down, file-oriented diff format designed to be easy to parse and safe to apply. The envelope is:

*** Begin Patch
[ one or more file sections ]
*** End Patch

Within that envelope, you get a sequence of file operations. You MUST include a header to specify the action you are taking. Each operation starts with one of three headers:

*** Add File: <path>      — create a new file. Every following line is a + line (the initial contents).
*** Delete File: <path>   — remove an existing file. Nothing follows.
*** Update File: <path>   — patch an existing file in place (optionally with a rename).

For Update File, you can optionally include `*** Move to: <new-path>` after the header to rename the file. Then use `@@ <context line>` markers to scope each change:

  @@ def greet():
  -print("Hi")
  +print("Hello, world!")

Rules:
- Always include the action header
- Prefix new lines with `+`, removed lines with `-`, unchanged lines with a single space
- A context line (`@@ <line>`) anchors the next change at that substring
- Each `@@` block can contain multiple `-`/`+` lines
- Empty lines in the patch body are represented as a single space prefix (` `) or as a blank line in source position
- Apply_patch is atomic: if any file fails, all applied changes are rolled back
- Paths are relative to the worktree cwd; absolute paths outside cwd are sandboxed
- Use `*** Move to:` for renames; do NOT delete + add separately
- Maximum patch size is 256 KB

Example:

*** Begin Patch
*** Add File: hello.txt
+Hello world
*** Update File: src/app.py
*** Move to: src/main.py
@@ def greet():
-print("Hi")
+print("Hello, world!")
*** Delete File: obsolete.txt
*** End Patch
```

### Step 4: `recall` tool

`packages/runtime/src/state/recall-index.ts`:

```ts
import type { SessionID } from "../types.js"

/**
 * In-memory session history index for the recall tool.
 *
 * v1: stores sessions in a Map. Prompt 25 swaps this for a SQLite FTS5
 * index over the session JSONL files.
 *
 * Each session has a title, a creation timestamp, a list of message texts,
 * and an array of file paths touched.
 */

export type RecallSession = {
  id: SessionID
  title: string
  directory: string
  createdAt: number
  updatedAt: number
  messages: Array<{ role: "user" | "assistant"; content: string; at: number }>
  filesTouched: string[]
}

class RecallIndex {
  private sessions = new Map<SessionID, RecallSession>()

  add(session: RecallSession): void { this.sessions.set(session.id, session) }

  get(id: SessionID): RecallSession | undefined { return this.sessions.get(id) }

  list(): RecallSession[] {
    return [...this.sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  search(query: string, opts: { limit?: number; excludeSession?: SessionID } = {}): RecallSession[] {
    const q = query.toLowerCase()
    const limit = opts.limit ?? 20
    const results: Array<{ session: RecallSession; score: number }> = []
    for (const session of this.sessions.values()) {
      if (session.id === opts.excludeSession) continue
      let score = 0
      if (session.title.toLowerCase().includes(q)) score += 10
      for (const msg of session.messages) {
        const text = msg.content.toLowerCase()
        const matches = text.split(q).length - 1
        score += matches
      }
      if (score > 0) results.push({ session, score })
    }
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((r) => r.session)
  }
}

export const recallIndex = new RecallIndex()
```

`packages/runtime/src/tools/recall.ts`:

```ts
import { z } from "zod"
import type { ToolExport } from "./tool.js"
import { recallIndex } from "../state/recall-index.js"

const MAX_RESULTS = 50
const MAX_TRANSCRIPT_BYTES = 64 * 1024

/**
 * recall — search prior conversation history + project memory.
 *
 * Two modes:
 *   - "search": find sessions by title or transcript content
 *   - "read":   load a session's full transcript
 *
 * Uses the recallIndex (in-memory for v1, JSONL-backed in prompt 25).
 */
export const recallTool: ToolExport = {
  id: "recall",
  description: "Search and read prior conversation history",
  parameters: z.object({
    mode: z.enum(["search", "read"]).describe("'search' to find sessions, 'read' to load a transcript"),
    query: z.string().min(1).optional()
      .describe("Required for 'search': terms to find across titles and transcripts"),
    sessionID: z.string().min(1).optional()
      .describe("Required for 'read': the session ID to load"),
    limit: z.number().int().min(1).max(MAX_RESULTS).optional()
      .describe("Maximum number of search results (default 20)"),
  }),
  execute: async (args, ctx) => {
    if (args.mode === "search") {
      if (!args.query) throw new Error("recall: 'query' is required when mode is 'search'")

      await ctx.ask({
        permission: "recall",
        patterns: ["search"],
        metadata: { mode: "search", query: args.query },
      })

      const results = recallIndex.search(args.query, {
        limit: args.limit,
        excludeSession: ctx.sessionID as any,
      })

      if (results.length === 0) {
        return {
          title: `Recall: "${args.query}" (0 results)`,
          output: `No sessions found matching "${args.query}".`,
          metadata: { results: [] },
        }
      }

      const lines = results.map((s) => {
        const matches = s.messages
          .filter((m) => m.content.toLowerCase().includes(args.query!.toLowerCase()))
          .slice(0, 2)
          .map((m) => `    ${m.role}: ${m.content.slice(0, 100).replace(/\n/g, " ")}`)
          .join("\n")
        return `**${s.title}** (id: ${s.id}, updated: ${new Date(s.updatedAt).toISOString()})\n${matches}`
      })

      return {
        title: `Recall: "${args.query}" (${results.length} results)`,
        output: lines.join("\n\n"),
        metadata: { results: results.map((s) => ({ id: s.id, title: s.title, updatedAt: s.updatedAt })) },
      }
    }

    // mode === "read"
    if (!args.sessionID) throw new Error("recall: 'sessionID' is required when mode is 'read'")

    const session = recallIndex.get(args.sessionID as any)
    if (!session) throw new Error(`recall: session not found: ${args.sessionID}`)

    await ctx.ask({
      permission: "recall",
      patterns: [session.id],
      metadata: { mode: "read", sessionID: session.id, title: session.title },
    })

    const lines: string[] = [`# ${session.title}`, `Directory: ${session.directory}`, `Created: ${new Date(session.createdAt).toISOString()}`, ""]
    for (const msg of session.messages) {
      lines.push(`## ${msg.role}`, msg.content.slice(0, MAX_TRANSCRIPT_BYTES), "")
    }

    return {
      title: `Recall: ${session.title}`,
      output: lines.join("\n"),
      metadata: { sessionID: session.id, title: session.title, messageCount: session.messages.length },
    }
  },
}
```

`packages/runtime/src/tools/recall.txt`:

```
Search and read prior conversation history in this project.

## Modes

- `search` — find sessions by title or transcript content. Returns a list of matching sessions with snippets.
- `read` — load a session's full transcript. Use the sessionID returned from a prior search.

## When to use

- "What did we decide about X last time?" → search for X
- "Show me the migration I wrote yesterday" → search, then read
- "What files did I touch in the auth refactor?" → search for the refactor

## Constraints

- Search excludes the current session (no point searching what you're in)
- Results are ranked by relevance (title match > transcript match)
- Default 20 results, max 50
- Read mode returns up to 64 KB of transcript; longer sessions are truncated
- Recall is read-only — it does not modify any state
```

### Step 5: `lsp` tool

`packages/runtime/src/tools/lsp.ts`:

```ts
import { z } from "zod"
import { spawn, type Subprocess } from "bun"
import { existsSync } from "fs"
import { dirname, isAbsolute, join } from "path"
import type { ToolExport } from "./tool.js"
import { sandboxPath } from "./fs/sandbox.js"

const LSP_SUPPORTED = new Set(["typescript", "javascript", "python", "typescriptreact", "javascriptreact"])

/**
 * lsp — Language Server Protocol client for diagnostics, go-to-definition,
 * find-references, and symbol queries.
 *
 * Uses `vscode-langservers-extracted` to spawn TS/JS (typescript-language-server)
 * and Python (pylsp) language servers as child processes. Speaks JSON-RPC
 * over stdin/stdout.
 *
 * v1 supports a subset of operations:
 *   - goToDefinition, findReferences, hover, documentSymbol, workspaceSymbol,
 *     goToImplementation
 */
export const lspTool: ToolExport = {
  id: "lsp",
  description: "Language Server Protocol operations (go-to-def, find-refs, symbols, diagnostics)",
  parameters: z.object({
    operation: z.enum([
      "goToDefinition", "findReferences", "hover",
      "documentSymbol", "workspaceSymbol", "goToImplementation",
    ]).describe("The LSP operation to perform"),
    filePath: z.string().describe("Absolute or relative path to the file"),
    line: z.number().int().min(1).describe("1-based line number"),
    character: z.number().int().min(1).describe("1-based character offset"),
    query: z.string().optional()
      .describe("Search query for workspaceSymbol (empty = all symbols)"),
  }),
  execute: async (args, ctx) => {
    const file = sandboxPath(args.filePath, ctx.cwd)
    if (!existsSync(file)) throw new Error(`lsp: file not found: ${file}`)

    // Detect language from extension.
    const ext = file.split(".").pop()?.toLowerCase()
    const language = ext === "ts" || ext === "tsx" ? "typescript"
      : ext === "js" || ext === "jsx" ? "javascript"
      : ext === "py" ? "python"
      : null

    if (!language || !LSP_SUPPORTED.has(language)) {
      throw new Error(`lsp: no language server for extension: .${ext}`)
    }

    // Permission gate.
    await ctx.ask({
      permission: "lsp",
      patterns: [file],
      metadata: { operation: args.operation, language },
    })

    // Spawn the language server.
    const { cmd, args: serverArgs } = await getServerCommand(language)
    const proc = spawn({ cmd: [cmd, ...serverArgs], stdin: "pipe", stdout: "pipe", stderr: "pipe" })

    const client = new LSPClient(proc)
    try {
      await client.initialize({
        rootUri: pathToFileUri(ctx.cwd),
        capabilities: { textDocument: { synchronization: { didOpen: true } } },
      })

      // Open the document.
      const content = await Bun.file(file).text()
      await client.didOpen(file, content, languageId(language))

      // Run the operation.
      let result: unknown = null
      switch (args.operation) {
        case "goToDefinition":
          result = await client.definition(file, args.line - 1, args.character - 1)
          break
        case "findReferences":
          result = await client.references(file, args.line - 1, args.character - 1)
          break
        case "hover":
          result = await client.hover(file, args.line - 1, args.character - 1)
          break
        case "documentSymbol":
          result = await client.documentSymbol(file)
          break
        case "workspaceSymbol":
          result = await client.workspaceSymbol(args.query ?? "")
          break
        case "goToImplementation":
          result = await client.implementation(file, args.line - 1, args.character - 1)
          break
      }

      return {
        title: `${args.operation} ${file}:${args.line}:${args.character}`,
        output: result ? JSON.stringify(result, null, 2) : "No results",
        metadata: { operation: args.operation, result, language },
      }
    } finally {
      try { proc.kill() } catch {}
    }
  },
}

function languageId(lang: string): string {
  if (lang === "typescript") return "typescript"
  if (lang === "javascript") return "javascript"
  if (lang === "python") return "python"
  return lang
}

async function getServerCommand(language: string): Promise<{ cmd: string; args: string[] }> {
  if (language === "typescript" || language === "javascript") {
    // Try the local typescript-language-server binary.
    const which = await import("./bash/shell-invocation.js")
    if (which.hasOnPath("typescript-language-server")) {
      return { cmd: "typescript-language-server", args: ["--stdio"] }
    }
    throw new Error("typescript-language-server not found. Run: npm i -g typescript-language-server typescript")
  }
  if (language === "python") {
    if ((await import("./bash/shell-invocation.js")).hasOnPath("pylsp")) {
      return { cmd: "pylsp", args: [] }
    }
    throw new Error("pylsp not found. Run: pip install python-lsp-server[all]")
  }
  throw new Error(`no language server for ${language}`)
}

function pathToFileUri(p: string): string {
  // Minimal file URI: file:///abs/path. On Windows, convert backslashes.
  const abs = p.replace(/\\/g, "/")
  return `file://${abs.startsWith("/") ? "" : "/"}${abs}`
}

/**
 * Minimal LSP client over JSON-RPC. Buffers messages framed with
 * `Content-Length: N\r\n\r\n<json>` headers.
 */
class LSPClient {
  private nextId = 1
  private buffer = ""
  private pending = new Map<number, (result: unknown) => void>()

  constructor(private proc: Subprocess) {
    const read = async () => {
      const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader()
      const dec = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        this.buffer += dec.decode(value, { stream: true })
        this.drainBuffer()
      }
    }
    read().catch(() => {})
  }

  private drainBuffer() {
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n")
      if (headerEnd === -1) return
      const header = this.buffer.slice(0, headerEnd)
      const m = /Content-Length: (\d+)/i.exec(header)
      if (!m) {
        this.buffer = this.buffer.slice(headerEnd + 4)
        continue
      }
      const len = parseInt(m[1]!, 10)
      const bodyStart = headerEnd + 4
      if (this.buffer.length < bodyStart + len) return
      const body = this.buffer.slice(bodyStart, bodyStart + len)
      this.buffer = this.buffer.slice(bodyStart + len)
      try {
        const msg = JSON.parse(body)
        if (msg.id != null && this.pending.has(msg.id)) {
          this.pending.get(msg.id)!(msg.result)
          this.pending.delete(msg.id)
        }
      } catch { /* malformed */ }
    }
  }

  private send(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++
    const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params })
    const body = `Content-Length: ${Buffer.byteLength(msg)}\r\n\r\n${msg}`
    this.proc.stdin!.write(body)
    this.proc.stdin!.flush()
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        resolve(null)
      }, 10_000)
      this.pending.set(id, (r) => { clearTimeout(timer); resolve(r) })
    })
  }

  initialize(rootUri: string, capabilities: any) {
    return this.send("initialize", { capabilities, rootUri })
  }
  didOpen(file: string, content: string, languageId: string) {
    return this.send("textDocument/didOpen", {
      textDocument: { uri: pathToFileUri(file), languageId, version: 1, text: content },
    })
  }
  definition(file: string, line: number, character: number) {
    return this.send("textDocument/definition", { textDocument: { uri: pathToFileUri(file) }, position: { line, character } })
  }
  references(file: string, line: number, character: number) {
    return this.send("textDocument/references", { textDocument: { uri: pathToFileUri(file) }, position: { line, character }, context: { includeDeclaration: true } })
  }
  hover(file: string, line: number, character: number) {
    return this.send("textDocument/hover", { textDocument: { uri: pathToFileUri(file) }, position: { line, character } })
  }
  documentSymbol(file: string) {
    return this.send("textDocument/documentSymbol", { textDocument: { uri: pathToFileUri(file) } })
  }
  workspaceSymbol(query: string) {
    return this.send("workspace/symbol", { query })
  }
  implementation(file: string, line: number, character: number) {
    return this.send("textDocument/implementation", { textDocument: { uri: pathToFileUri(file) }, position: { line, character } })
  }
}
```

`packages/runtime/src/tools/lsp.txt`:

```
Language Server Protocol operations on TypeScript, JavaScript, and Python files.

## Supported operations

- `goToDefinition` — where is the symbol at this position defined?
- `findReferences` — where is this symbol used? (includes the declaration)
- `hover` — show type info / doc comment for the symbol at this position
- `documentSymbol` — list all symbols (functions, classes, variables) in this file
- `workspaceSymbol` — search for symbols by name across the entire project
- `goToImplementation` — where is this interface implemented?

## When to use

- "What does this function return?" → hover on it
- "Where is `parseConfig` called from?" → findReferences on the declaration
- "List all classes in `src/db/`" → documentSymbol on each file (or workspaceSymbol for search)

## Requirements

- TypeScript/JavaScript: `typescript-language-server` must be installed (`npm i -g typescript-language-server typescript`)
- Python: `pylsp` must be installed (`pip install 'python-lsp-server[all]'`)
- The file must exist and be readable
- Line/character are 1-based (as shown in editors)

## Limitations

- Each `lsp` call spawns a fresh language server process (~500 ms startup). For multiple operations on the same file, batch them in parallel.
- Workspace symbols search the whole project — may be slow on large codebases (>10k files).
- The LSP client buffers responses with a 10-second timeout; operations beyond that fail silently with "No results".
```

### Step 6: `websearch` tool

`packages/runtime/src/tools/websearch.ts`:

```ts
import { z } from "zod"
import type { ToolExport } from "./tool.js"

const MAX_RESULTS = 20

type WebSearchBackend = "brave" | "duckduckgo"

type SearchResult = { title: string; url: string; snippet: string }

export const websearchTool: ToolExport = {
  id: "websearch",
  description: "Search the web for current information",
  parameters: z.object({
    query: z.string().min(1).describe("The search query"),
    numResults: z.number().int().min(1).max(MAX_RESULTS).optional()
      .describe("Number of results to return (default 8, max 20)"),
  }),
  execute: async (args, ctx) => {
    const backend = pickBackend()
    const numResults = args.numResults ?? 8

    await ctx.ask({
      permission: "websearch",
      patterns: [args.query.slice(0, 80)],
      metadata: { query: args.query, backend, numResults },
    })

    const results = backend === "brave"
      ? await searchBrave(args.query, numResults)
      : await searchDuckDuckGo(args.query, numResults)

    if (results.length === 0) {
      return {
        title: `Web search: "${args.query}" (no results)`,
        output: `No results found for "${args.query}" via ${backend}.`,
        metadata: { backend, results: [] },
      }
    }

    const lines = results.map((r, i) =>
      `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}`
    )

    return {
      title: `Web search: "${args.query}" (${results.length} results)`,
      output: lines.join("\n\n"),
      metadata: { backend, results, query: args.query },
    }
  },
}

function pickBackend(): WebSearchBackend {
  // Prefer Brave if API key is configured.
  if (process.env.BRAVE_API_KEY) return "brave"
  return "duckduckgo"
}

async function searchBrave(query: string, num: number): Promise<SearchResult[]> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${num}`
  const res = await fetch(url, {
    headers: { "X-Subscription-Token": process.env.BRAVE_API_KEY!, "Accept": "application/json" },
  })
  if (!res.ok) throw new Error(`brave search failed: ${res.status} ${res.statusText}`)
  const data = await res.json() as { web?: { results?: Array<{ title: string; url: string; description: string }> } }
  return (data.web?.results ?? []).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.description,
  }))
}

async function searchDuckDuckGo(query: string, num: number): Promise<SearchResult[]> {
  // DuckDuckGo HTML — lightweight, no API key needed. Scrape the result page.
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; kilo-assistant/1.0)" },
  })
  if (!res.ok) throw new Error(`duckduckgo search failed: ${res.status} ${res.statusText}`)
  const html = await res.text()

  // Naive HTML parser — extract result blocks.
  const results: SearchResult[] = []
  const blockRe = /<a class="result__a" href="([^"]+)"[^>]*>([^<]+)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g
  let match: RegExpExecArray | null
  while ((match = blockRe.exec(html)) && results.length < num) {
    const href = decodeURIComponent(match[1]!.replace(/&amp;/g, "&"))
    const title = match[2]!.trim()
    const snippet = match[3]!.replace(/<[^>]+>/g, "").trim()
    if (href.startsWith("http")) results.push({ title, url: href, snippet })
  }
  return results
}
```

`packages/runtime/src/tools/websearch.txt`:

```
Search the public web for current information not in your training data.

## When to use

- "What's the latest version of Bun?" → search "bun runtime latest version"
- "How do I configure X in library Y?" → search the docs
- "What's the API for OpenAI/Anthropic feature Z?" → search for current docs
- Verifying facts you're unsure about

## Backends

- **Brave Search** (preferred, paid) — requires `BRAVE_API_KEY` env var. Free tier: 1 query/sec, 2000 queries/month.
- **DuckDuckGo HTML** (fallback, free) — no API key, scrapes `html.duckduckgo.com`. Less reliable, may break if DDG changes markup.

The tool auto-picks Brave if `BRAVE_API_KEY` is set, else falls back to DuckDuckGo.

## Usage

- `query` is the search string (full natural language works)
- `numResults` defaults to 8, max 20
- Results are returned as numbered list with title, URL, and snippet
- Tool is read-only — it just returns text. The agent decides what to do with it.

## Limitations

- DuckDuckGo scraping may be blocked by CAPTCHAs (rare)
- Brave's free tier rate-limits aggressively
- Neither backend indexes paywalled content
```

### Step 7: Commit

```bash
git add -A
git commit -m "feat(tools): specialty tools — apply_patch, recall, lsp, websearch (prompt 12)"
```

## Files created

```
packages/runtime/src/
├── state/
│   └── recall-index.ts        # in-memory session history index
└── tools/
    ├── apply-patch/
    │   └── parser.ts          # *** Begin Patch envelope parser
    ├── apply_patch.ts
    ├── apply_patch.txt
    ├── recall.ts
    ├── recall.txt
    ├── lsp.ts
    ├── lsp.txt
    ├── websearch.ts
    └── websearch.txt
```

Plus 1 line added to `packages/runtime/src/state/index.ts`.

## Acceptance criteria

- [ ] `bun run typecheck` passes
- [ ] `createBuiltinRegistry()` includes `apply_patch`, `recall`, `lsp`, `websearch` (15+ tools total now)
- [ ] `apply_patch` with an Add File hunk creates the file
- [ ] `apply_patch` with a Delete File hunk removes the file
- [ ] `apply_patch` with an Update File hunk modifies the file
- [ ] `apply_patch` with `*** Move to:` renames the file (old gone, new exists)
- [ ] `apply_patch` rolls back all changes if one hunk fails
- [ ] `apply_patch` with empty patch throws "empty patch"
- [ ] `apply_patch` missing `*** Begin Patch` header throws a clear parser error
- [ ] `apply_patch` with patch > 256 KB throws "patch too large"
- [ ] `parsePatch` handles multiple hunks across multiple file types
- [ ] `recall.search("foo")` returns sessions whose title or transcript contains "foo"
- [ ] `recall.search` excludes the current session
- [ ] `recall.search("nothing-matches-this")` returns empty array
- [ ] `recall.read("nonexistent")` throws "session not found"
- [ ] `recall.read` without `query` throws "sessionID is required"
- [ ] `recall.search` without `query` throws "query is required"
- [ ] `recall` permission gate calls `ctx.ask({ permission: "recall" })`
- [ ] `lsp.goToDefinition` on a TypeScript file returns the definition location (when server available)
- [ ] `lsp` on `.txt` file throws "no language server for extension: .txt"
- [ ] `lsp` on a nonexistent file throws "file not found"
- [ ] `lsp.hover` returns type info when the server provides it
- [ ] `websearch` returns results from Brave when `BRAVE_API_KEY` is set
- [ ] `websearch` falls back to DuckDuckGo when no API key
- [ ] `websearch` returns `metadata.backend === "brave" | "duckduckgo"`
- [ ] `websearch` with `numResults > 20` throws (Zod max)
- [ ] `websearch` permission gate calls `ctx.ask({ permission: "websearch" })`

## Verification

```bash
cd kilocode-assistant
bun install
bun run typecheck

mkdir -p /tmp/kilo-spec-test/src && cd /tmp/kilo-spec-test
cat > hello.txt <<'EOF'
Hello world
EOF
cat > src/math.ts <<'EOF'
export function add(a: number, b: number): number {
  return a + b
}
export function subtract(a: number, b: number): number {
  return a - b
}
EOF
cd /path/to/kilocode-assistant

bun --eval '
import { createBuiltinRegistry } from "@kilocode/runtime/tools"
import { parsePatch } from "@kilocode/runtime/tools/apply-patch/parser"
import { recallIndex } from "@kilocode/runtime/state"

const reg = await createBuiltinRegistry()
console.log("tools:", reg.ids().filter(t => ["apply_patch", "recall", "lsp", "websearch"].includes(t)))

const ctx = {
  sessionID: "test",
  messageID: "m1",
  cwd: "/tmp/kilo-spec-test",
  abort: new AbortController().signal,
  ask: async () => { console.log("[ask]"); },
  metadata: async () => {},
}

// Test 1: parser — Add File
const p1 = parsePatch(`*** Begin Patch
*** Add File: new.txt
+brand new content
*** End Patch`)
console.log("--- parser add ---")
console.log("hunks:", p1.hunks.length, "type:", p1.hunks[0].type)

// Test 2: parser — Update + Move
const p2 = parsePatch(`*** Begin Patch
*** Update File: hello.txt
*** Move to: hello-renamed.txt
@@ Hello
-Hello world
+Hello, world!
*** End Patch`)
console.log("--- parser update + move ---")
console.log("type:", p2.hunks[0].type, "movePath:", (p2.hunks[0] as any).movePath)

// Test 3: parser — empty patch
try {
  parsePatch("*** Begin Patch\n*** End Patch")
  console.log("--- empty patch: NO ERROR (BUG) ---")
} catch (e) {
  console.log("--- empty patch: rejected ✓ ---")
}

// Test 4: parser — missing header
try {
  parsePatch("hello world")
  console.log("--- missing header: NO ERROR (BUG) ---")
} catch (e) {
  console.log("--- missing header: rejected ✓ ---")
}

// Test 5: apply_patch — happy path (Add + Update)
const ap = await reg.execute("apply_patch", {
  patchText: `*** Begin Patch
*** Add File: notes.md
+# Notes

This is a new file.
*** Update File: hello.txt
@@ Hello
-Hello world
+Hello, universe!
*** End Patch`,
}, ctx)
console.log("--- apply_patch ---")
console.log("title:", ap.title)
console.log("output:", ap.output)

// Test 6: apply_patch rolls back on failure
try {
  await reg.execute("apply_patch", {
    patchText: `*** Begin Patch
*** Update File: nonexistent.txt
@@ missing
-old
+new
*** End Patch`,
  }, ctx)
} catch (e) {
  console.log("--- apply_patch missing file: rejected ✓ ---")
  console.log("msg:", e.message.slice(0, 80))
}

// Test 7: recall — populate index
recallIndex.add({
  id: "s-old-1" as any,
  title: "Fix authentication bug",
  directory: "/tmp/kilo-spec-test",
  createdAt: Date.now() - 86400_000,
  updatedAt: Date.now() - 86400_000,
  messages: [
    { role: "user", content: "The login form is broken", at: Date.now() - 86400_000 },
    { role: "assistant", content: "I found a null pointer in src/auth/login.ts", at: Date.now() - 86399_000 },
  ],
  filesTouched: ["src/auth/login.ts"],
})
recallIndex.add({
  id: "s-recent" as any,
  title: "Add TypeScript types",
  directory: "/tmp/kilo-spec-test",
  createdAt: Date.now(),
  updatedAt: Date.now(),
  messages: [{ role: "user", content: "Add strict types", at: Date.now() }],
  filesTouched: [],
})

const r1 = await reg.execute("recall", { mode: "search", query: "authentication" }, ctx)
console.log("--- recall search ---")
console.log("title:", r1.title)
console.log("first match:", r1.metadata.results[0]?.title)

const r2 = await reg.execute("recall", { mode: "search", query: "zzz-nothing-matches" }, ctx)
console.log("--- recall no match ---")
console.log("title:", r2.title)

// Test 8: websearch (will hit DuckDuckGo, may fail in CI — wrap in try)
try {
  const w = await reg.execute("websearch", { query: "bun runtime", numResults: 3 }, ctx)
  console.log("--- websearch ---")
  console.log("backend:", w.metadata.backend)
  console.log("first result:", w.metadata.results[0]?.title?.slice(0, 60))
} catch (e) {
  console.log("--- websearch skipped (network unavailable) ---")
}
'

rm -rf /tmp/kilo-spec-test
```

Expected: parser tests pass, apply_patch writes files, recall finds the auth session, websearch returns at least one result (if network is up).

## Notes

- **Why `apply_patch` separate from `write`/`edit`?** `write`/`edit` work on a single file with full overwrite / find-replace semantics. `apply_patch` handles multi-file atomic operations — closer to `git apply` than to text replacement. Kilo Code chose this format because Anthropic's Claude Code models are pre-trained on it (better reliability).
- **256 KB patch limit.** Larger than a single file's worth of changes; smaller than a refactor PR. Anything bigger should be split into multiple `apply_patch` calls.
- **Atomic rollback on failure.** If hunk 5 of 10 fails, we revert hunk 1-4. Implemented with a simple reverse loop. NOT true ACID — if the rollback itself fails, we're in an inconsistent state. The user will see a warning in the output.
- **`*** Move to:` vs delete + add.** Move preserves the file's git history (rename detection). Delete + add creates two history events. Always prefer move for renames.
- **`apply_patch` requires `*** Begin Patch` literal header.** The model must produce the exact envelope. The `.txt` description shows an example. If the model forgets, the parser fails with a clear error and the model retries.
- **Why a hand-rolled parser, not `diff`?** The `diff` package handles line-level diffs. The `*** Begin Patch` envelope is a different grammar (file operations + chunk anchors). ~150 LOC of hand-rolled parser is clearer than gluing `diff` to it.
- **Recall is in-memory for v1.** Sessions disappear when the process restarts. Prompt 25 swaps in a JSONL-backed index (using SQLite FTS5 for fast search). The interface doesn't change — `recallIndex.search()` works the same.
- **Recall excludes the current session.** Searching the session you're in produces noise (your own messages). Always exclude.
- **LSP via `vscode-langservers-extracted`.** Bundles `typescript-language-server` and `pylsp` as Node packages. We could `import` them directly, but the JSON-RPC stdio interface is more portable. Spawning the binary is the recommended approach.
- **500 ms LSP startup per call.** Each `lsp` call spawns a fresh server process. This is intentional — keeping state across calls would require a persistent client, which adds complexity. For multi-operation workflows, the agent can batch in parallel.
- **Why a 10-second LSP timeout?** Most LSP operations complete in <100 ms. Some (workspaceSymbol on large codebases) take 2-5 seconds. 10 seconds is generous. Beyond that, assume the server is hung and return null.
- **Websearch: Brave vs DuckDuckGo.** Brave is paid ($3 per 1000 queries, free tier 2k/month) but reliable JSON API. DuckDuckGo HTML scrape is free but fragile (CAPTCHAs, markup changes). Brave wins for production; DDG is the dev/CI fallback.
- **No caching of web results.** Each `websearch` call hits the network. v2 could add a 1-hour LRU cache keyed by query. Skipped for v1 to keep things simple.
- **`websearch` returns snippets, not full content.** For full content, the agent should use `webfetch` (out of scope for this prompt; v1 doesn't ship webfetch).
- **No Java LSP, no Go LSP.** The `vscode-langservers-extracted` package only ships TS/JS + Python. Adding more languages requires installing `vscode-langservers-extracted` extras or shipping custom server binaries. v2 can add Go (`gopls`) and Rust (`rust-analyzer`).
- **Patch parser doesn't validate `@@` context uniqueness.** If two `@@` blocks anchor on the same context, both succeed (operating from the same position). The model should write unambiguous anchors. v2 could enforce uniqueness.
- **Why a generic LSP client, not a TS-specific one?** Same client works for Python (`pylsp`) and TS (`typescript-language-server`). v1 supports 2 languages; v2 can add more without changing the client.
- **`websearch` permissions.** Default `"ask"` (the user might not want web access). Set to `"allow"` in `kilo.json` for autonomous agents.
- **No rate limiting.** v1 trusts the agent to not DOS the search backend. v2 adds per-minute quotas.
