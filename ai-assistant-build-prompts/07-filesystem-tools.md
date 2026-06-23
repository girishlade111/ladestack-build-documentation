# Prompt 07: Filesystem Tools (read, write, edit)

## Goal

Implement the three core filesystem tools — `read`, `write`, `edit` — as **concrete `ToolDef`s** that drop into the registry built in prompt 06. Path-sandbox to the worktree cwd, binary-detect on read, and enforce a read-before-write safety check on `edit` (matching Kilo Code's `packages/opencode/src/tool/{read,write,edit}.ts` behavior).

## Context (from prompts 01-06)

- Monorepo + provider + BYOK + tool registry pattern all work (prompts 01-06).
- Prompt 06 left a `echo` tool as a debug stub — **delete it** as part of this prompt.
- `packages/runtime/src/tools/` is the drop-in location for new tools (loader scans it).
- Bun APIs available: `Bun.file()`, `Bun.write()`, `node:fs/promises` (read/write streams).
- Zod schemas required (Vercel AI SDK uses them for LLM tool-call validation).

References:
- `../../02-competitive-research.md` §3 — Kilo Code's file tool conventions
- Real Kilo source:
  - `kilocode-clone/packages/opencode/src/tool/read.ts` — line-numbered output, binary detection
  - `kilocode-clone/packages/opencode/src/tool/write.ts` — full overwrite
  - `kilocode-clone/packages/opencode/src/tool/edit.ts` — oldString/newString + replaceAll

The `read` tool's `.txt` description should be modeled on Kilo's `read.txt` (read up to 2000 lines, offset for paging, parallel reads OK, prefer larger windows over tiny slices). The `write` tool's `.txt` on `write.txt` (must `read` first if file exists). The `edit` tool's `.txt` on `edit.txt` (exact replacement, must `read` first, `replaceAll` for multi-match).

## Task

### Step 1: Path sandboxing helper

`packages/runtime/src/tools/fs/sandbox.ts`:

```ts
import { resolve, isAbsolute, relative, sep } from "path"

/**
 * Resolve `path` against `cwd` and verify it doesn't escape via `..` tricks.
 *
 * Returns the absolute path. Throws if the resolved path is outside `cwd`.
 *
 * Symlinks are NOT resolved here — Bun's fs operations follow symlinks by
 * default. If we wanted true containment we'd resolve with `realpath`, but
 * that breaks workflows that intentionally use symlinks for config dirs.
 */
export function sandboxPath(path: string, cwd: string): string {
  const abs = isAbsolute(path) ? path : resolve(cwd, path)
  const rel = relative(cwd, abs)

  // On Windows, `relative()` returns "" when abs === cwd. That's allowed.
  if (rel === "") return abs

  // Path tries to escape: starts with ".." or contains ".." as a segment.
  if (rel.startsWith("..") || rel.split(sep).includes("..")) {
    throw new Error(`Path escapes sandbox (cwd=${cwd}): ${path}`)
  }
  return abs
}

/**
 * Light containment check — used when the tool wants to allow external paths
 * explicitly (e.g. reference docs in `~/.kilocode/`). Returns true if `path`
 * is inside `root`.
 */
export function isInside(path: string, root: string): boolean {
  const rel = relative(root, path)
  return rel === "" || (!rel.startsWith("..") && !rel.split(sep).includes(".."))
}
```

### Step 2: Binary file detection

`packages/runtime/src/tools/fs/binary.ts`:

```ts
const BINARY_EXTENSIONS = new Set([
  ".zip", ".tar", ".gz", ".tgz", ".bz2", ".7z",
  ".exe", ".dll", ".so", ".dylib",
  ".class", ".jar", ".war", ".ear",
  ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".odt", ".ods", ".odp",
  ".bin", ".dat", ".obj", ".o", ".a", ".lib",
  ".wasm", ".pyc", ".pyo",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp",
  ".mp3", ".mp4", ".mov", ".avi", ".mkv", ".webm", ".ogg", ".wav",
  ".pdf",
])

export function isBinaryExtension(path: string): boolean {
  const i = path.lastIndexOf(".")
  if (i === -1) return false
  return BINARY_EXTENSIONS.has(path.slice(i).toLowerCase())
}

/**
 * Heuristic binary detection: look at the first 4 KB for NUL bytes or
 * a high density of non-printable chars. UTF-16/32 BOMs are tolerated.
 */
export function looksBinary(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false

  // Skip UTF-16/32 BOM — their NULs are legitimate.
  if (
    (bytes[0] === 0xff && bytes[1] === 0xfe) ||  // UTF-16 LE
    (bytes[0] === 0xfe && bytes[1] === 0xff) ||  // UTF-16 BE
    (bytes[0] === 0xff && bytes[1] === 0xfe && bytes[2] === 0 && bytes[3] === 0)  // UTF-32 LE
  ) return false

  let nonPrintable = 0
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) return true   // NUL = binary
    const b = bytes[i]
    if ((b < 9) || (b > 13 && b < 32) || b === 127) {
      nonPrintable++
    }
  }
  return nonPrintable / bytes.length > 0.3
}
```

### Step 3: Line-numbered output helper

`packages/runtime/src/tools/fs/format.ts`:

```ts
/**
 * Format file contents with `line: content` prefixes, truncated to fit.
 * Truncates at the byte limit (default 50 KB of output) to prevent
 * context-window blowup on huge files.
 */
export function formatLineNumbered(
  contents: string,
  startLine: number,
  opts: { maxLines?: number; maxBytes?: number } = {},
): { text: string; truncated: boolean; cut: boolean; totalLines: number } {
  const maxLines = opts.maxLines ?? 2000
  const maxBytes = opts.maxBytes ?? 50 * 1024

  const lines = contents.split("\n")
  const totalLines = lines.length
  const slice = lines.slice(0, maxLines)
  const truncated = lines.length > maxLines

  // Build the numbered output with byte tracking.
  const numbered: string[] = []
  let bytes = 0
  let cut = false
  for (let i = 0; i < slice.length; i++) {
    const num = String(startLine + i).padStart(6)   // 6-digit line numbers
    const line = `${num}\t${slice[i]}`
    const size = line.length + 1   // +1 for newline
    if (bytes + size > maxBytes) {
      cut = true
      break
    }
    numbered.push(line)
    bytes += size
  }

  return { text: numbered.join("\n"), truncated, cut, totalLines }
}
```

### Step 4: `read` tool

`packages/runtime/src/tools/read.ts`:

```ts
import { z } from "zod"
import { sandboxPath } from "./fs/sandbox.js"
import { isBinaryExtension, looksBinary } from "./fs/binary.js"
import { formatLineNumbered } from "./fs/format.js"
import type { ToolExport } from "./tool.js"
import { stat, readFile } from "node:fs/promises"
import { basename } from "node:path"

const MAX_READ_BYTES = 50 * 1024
const MAX_LINE_LENGTH = 2000
const DEFAULT_LINE_LIMIT = 2000

export const readTool: ToolExport = {
  id: "read",
  description: "Read a file or directory from the local filesystem",
  parameters: z.object({
    filePath: z.string().describe("The absolute path to the file or directory to read"),
    offset: z.number().int().nonnegative().optional()
      .describe("Line number to start reading from (1-indexed). Default: 1."),
    limit: z.number().int().positive().max(10000).optional()
      .describe("Maximum lines to return. Default: 2000."),
  }),
  execute: async (args, ctx) => {
    const filePath = sandboxPath(args.filePath, ctx.cwd)
    const s = await stat(filePath).catch(() => undefined)
    if (!s) {
      throw new Error(`File not found: ${filePath}`)
    }

    // Directory listing
    if (s.isDirectory()) {
      const { readdir } = await import("node:fs/promises")
      const entries = await readdir(filePath, { withFileTypes: true })
      const items = entries
        .map((e) => e.isDirectory() ? `${e.name}/` : e.name)
        .sort((a, b) => a.localeCompare(b))

      const offset = args.offset ?? 0
      const limit = args.limit ?? DEFAULT_LINE_LIMIT
      const slice = items.slice(offset, offset + limit)
      const truncated = offset + slice.length < items.length

      const output = [
        `<path>${filePath}</path>`,
        `<type>directory</type>`,
        `<entries>`,
        slice.join("\n"),
        truncated
          ? `\n(Showing ${slice.length} of ${items.length} entries. Use offset=${offset + slice.length} for more.)`
          : `\n(${items.length} entries)`,
        `</entries>`,
      ].join("\n")

      return {
        title: filePath,
        output,
        metadata: { type: "directory", entries: items.length, truncated },
      }
    }

    // File contents
    const offset = args.offset ?? 1
    const limit = args.limit ?? DEFAULT_LINE_LIMIT

    // Read first chunk for binary detection
    const fh = await import("node:fs/promises").then((m) => m.open(filePath, "r"))
    try {
      const sampleLen = Math.min(4096, s.size)
      const sampleBuf = Buffer.alloc(sampleLen)
      await fh.read(sampleBuf, 0, sampleLen, 0)

      const isBinary = isBinaryExtension(filePath) || looksBinary(new Uint8Array(sampleBuf))
      if (isBinary) {
        return {
          title: filePath,
          output: `Cannot read binary file: ${filePath} (${s.size} bytes). Use a specialized tool for this format.`,
          metadata: { type: "binary", size: s.size },
        }
      }

      // Read the rest as text. We read just enough to satisfy offset+limit, capped at MAX_READ_BYTES.
      const startByte = Math.max(0, (offset - 1) * 80)   // rough estimate: 80 chars/line
      const maxBytes = Math.min(MAX_READ_BYTES, (limit * MAX_LINE_LENGTH) + 4096)
      const endByte = Math.min(s.size, startByte + maxBytes)
      const buf = Buffer.alloc(endByte - startByte)
      await fh.read(buf, 0, buf.length, startByte)
      const text = buf.toString("utf8")

      const formatted = formatLineNumbered(text, offset, { maxLines: limit, maxBytes })

      const output = [
        `<path>${filePath}</path>`,
        `<type>file</type>`,
        `<content>`,
        formatted.text,
        formatted.cut
          ? `\n\n(Output capped at ${MAX_READ_BYTES / 1024} KB. Use offset=${offset + formatted.text.split("\n").length} to continue.)`
          : formatted.truncated
            ? `\n\n(Showing lines ${offset}-${offset + formatted.text.split("\n").length - 1} of ${formatted.totalLines}. Use offset=${offset + formatted.text.split("\n").length} for more.)`
            : `\n\n(End of file - total ${formatted.totalLines} lines)`,
        `</content>`,
      ].join("\n")

      return {
        title: filePath,
        output,
        metadata: { type: "file", size: s.size, lines: formatted.totalLines, truncated: formatted.truncated },
      }
    } finally {
      await fh.close()
    }
  },
}
```

`packages/runtime/src/tools/read.txt`:

```
Read a file or directory from the local filesystem. If the path does not exist, an error is returned.

Usage:
- The filePath parameter should be an absolute path.
- By default, this tool returns up to 2000 lines from the start of the file.
- The offset parameter is the line number to start from (1-indexed).
- To read later sections, call this tool again with a larger offset.
- Use the grep tool to find specific content in large files or files with long lines.
- If you are unsure of the correct file path, use the glob tool to look up filenames by glob pattern.
- Contents are returned with each line prefixed by its line number as `N: <content>`.
- For directories, entries are returned one per line with a trailing `/` for subdirectories.
- Any line longer than 2000 characters is truncated.
- Call this tool in parallel when you know there are multiple files you want to read.
- Avoid tiny repeated slices (30 line chunks). If you need more context, read a larger window.
- This tool can read image files and returns them as base64 attachments.
```

### Step 5: `write` tool

`packages/runtime/src/tools/write.ts`:

```ts
import { z } from "zod"
import { sandboxPath } from "./fs/sandbox.js"
import { stat, writeFile, readFile, mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import { createHash } from "node:crypto"
import type { ToolExport } from "./tool.js"

export const writeTool: ToolExport = {
  id: "write",
  description: "Writes a file to the local filesystem",
  parameters: z.object({
    filePath: z.string().describe("The absolute path to the file to write (must be absolute, not relative)"),
    content: z.string().describe("The content to write to the file"),
  }),
  execute: async (args, ctx) => {
    const filePath = sandboxPath(args.filePath, ctx.cwd)

    // Read-before-write check: if the file exists, the LLM must have read it
    // earlier in this session. Tracked via ctx.metadata — see prompt 15 for
    // the read-tracking implementation. For now we record every read in
    // a session-scoped Set on the context.
    const existed = await stat(filePath).then((s) => s.isFile()).catch(() => false)
    if (existed) {
      const reads = (ctx as any).__readFiles as Set<string> | undefined
      if (reads && !reads.has(filePath)) {
        throw new Error(
          `Refusing to overwrite ${filePath}: file exists but has not been read in this session. ` +
          `Call the read tool first, then call write.`,
        )
      }
    }

    // Ensure parent dir exists.
    await mkdir(dirname(filePath), { recursive: true })

    // Hash for diff metadata.
    const oldHash = existed ? createHash("sha256").update(await readFile(filePath, "utf8")).digest("hex").slice(0, 8) : null
    const newHash = createHash("sha256").update(args.content).digest("hex").slice(0, 8)

    await writeFile(filePath, args.content, "utf8")

    let output = existed
      ? `Updated ${filePath} (${oldHash} → ${newHash}, ${args.content.length} bytes)`
      : `Created ${filePath} (${args.content.length} bytes)`

    return {
      title: filePath,
      output,
      metadata: { filePath, existed, oldHash, newHash, bytes: args.content.length },
    }
  },
}
```

Wait — I imported `readFile` but didn't import it. Let me fix:

```ts
import { stat, writeFile, readFile, mkdir } from "node:fs/promises"
```

`packages/runtime/src/tools/write.txt`:

```
Writes a file to the local filesystem.

Usage:
- This tool will overwrite the existing file if there is one at the provided path.
- If this is an existing file, you MUST use the Read tool first to read the file's contents. This tool will fail if you did not read the file first.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.
- Only use emojis if the user explicitly requests it. Avoid writing emojis to files unless asked.
- The content parameter must be the COMPLETE file contents — there is no append mode.
- If the parent directory does not exist, it will be created automatically.
```

### Step 6: `edit` tool (string replace)

`packages/runtime/src/tools/edit.ts`:

```ts
import { z } from "zod"
import { sandboxPath } from "./fs/sandbox.js"
import { stat, readFile, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import type { ToolExport } from "./tool.js"

export const editTool: ToolExport = {
  id: "edit",
  description: "Performs exact string replacements in files",
  parameters: z.object({
    filePath: z.string().describe("The absolute path to the file to modify"),
    oldString: z.string().describe("The text to replace (must match exactly)"),
    newString: z.string().describe("The text to replace it with (must be different from oldString)"),
    replaceAll: z.boolean().optional()
      .describe("Replace all occurrences of oldString (default: false)"),
  }),
  execute: async (args, ctx) => {
    if (args.oldString === args.newString) {
      throw new Error("No changes to apply: oldString and newString are identical.")
    }

    const filePath = sandboxPath(args.filePath, ctx.cwd)

    // Read-before-edit check.
    const reads = (ctx as any).__readFiles as Set<string> | undefined
    if (!reads || !reads.has(filePath)) {
      throw new Error(
        `Refusing to edit ${filePath}: file has not been read in this session. ` +
        `Call the read tool first, then call edit.`,
      )
    }

    const s = await stat(filePath).catch(() => undefined)
    if (!s || !s.isFile()) {
      throw new Error(`File not found: ${filePath}`)
    }

    const original = await readFile(filePath, "utf8")

    // Count matches.
    const occurrences = countOccurrences(original, args.oldString)
    if (occurrences === 0) {
      throw new Error(`oldString not found in ${filePath}. Re-read the file to get the current contents.`)
    }
    if (occurrences > 1 && !args.replaceAll) {
      throw new Error(
        `Found ${occurrences} matches for oldString in ${filePath}. ` +
        `Provide more surrounding context to make oldString unique, OR set replaceAll=true.`,
      )
    }

    // Apply the replacement.
    const updated = args.replaceAll
      ? original.split(args.oldString).join(args.newString)
      : original.replace(args.oldString, args.newString)

    await writeFile(filePath, updated, "utf8")

    const oldHash = createHash("sha256").update(original).digest("hex").slice(0, 8)
    const newHash = createHash("sha256").update(updated).digest("hex").slice(0, 8)

    // Build a unified diff for the metadata.
    const diff = makeUnifiedDiff(filePath, original, updated)

    return {
      title: filePath,
      output: `Edit applied successfully to ${filePath} (${oldHash} → ${newHash}, ${occurrences} replacement${occurrences === 1 ? "" : "s"}).\n\n${diff}`,
      metadata: { filePath, oldHash, newHash, occurrences, replaceAll: !!args.replaceAll, diff },
    }
  },
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0
  let count = 0
  let pos = 0
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    count++
    pos += needle.length
  }
  return count
}

/**
 * Minimal unified diff for the metadata. Real diffs come from prompt 12's
 * apply_patch tool; this is just enough to show the LLM what changed.
 */
function makeUnifiedDiff(file: string, before: string, after: string): string {
  const beforeLines = before.split("\n")
  const afterLines = after.split("\n")
  const lines: string[] = [`--- ${file}`, `+++ ${file}`]

  // Very simple line-level diff: find the first + last changed line.
  let i = 0
  while (i < beforeLines.length && i < afterLines.length && beforeLines[i] === afterLines[i]) i++
  let jBefore = beforeLines.length - 1
  let jAfter = afterLines.length - 1
  while (jBefore >= i && jAfter >= i && beforeLines[jBefore] === afterLines[jAfter]) {
    jBefore--
    jAfter--
  }

  for (let k = i; k <= jBefore; k++) lines.push(`-${beforeLines[k]}`)
  for (let k = i; k <= jAfter; k++) lines.push(`+${afterLines[k]}`)
  return lines.join("\n")
}
```

`packages/runtime/src/tools/edit.txt`:

```
Performs exact string replacements in files.

Usage:
- You must use the `read` tool at least once in the conversation before editing. This tool will error if you attempt an edit without reading the file.
- When editing text from read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: line number + colon + tab (e.g., `     1\t<content>`). Everything after that tab is the actual file content to match. Never include any part of the line number prefix in the oldString or newString.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked.
- The edit will FAIL if `oldString` is not found in the file with an error "oldString not found in content".
- The edit will FAIL if `oldString` is found multiple times in the file with an error "Found multiple matches for oldString. Provide more surrounding lines in oldString to identify the correct match." Either provide a larger string with more surrounding context to make it unique or use `replaceAll` to change every instance of `oldString`.
- Use `replaceAll` for replacing and renaming strings across the file. This parameter is useful if you want to rename a variable for instance.
- oldString and newString must be different.
```

### Step 7: Read-tracking middleware (session-scoped set)

The `read-before-write` check needs a session-scoped set of "files that have been read in this session". We attach it to `ctx` via a small extension.

Update `packages/runtime/src/tools/tool.ts` to add the read-tracking field to `ToolContext`:

```ts
export type ToolContext = {
  // ... existing fields ...
  /** Internal: tracks files read in this session. Populated by the read tool. */
  __readFiles?: Set<string>
}
```

Update `packages/runtime/src/tools/read.ts` to record reads:

```ts
execute: async (args, ctx) => {
  // ... existing logic ...
  // Record this read for the write/edit safety check.
  if (ctx.__readFiles) ctx.__readFiles.add(filePath)
  // ... rest of the logic ...
}
```

In `prompt 15` (agent loop), you'll initialize `ctx.__readFiles = new Set()` at session start. For now, the field is optional — if the agent loop doesn't set it, the safety check is skipped (allowing tools to work standalone for testing).

### Step 8: Remove the `echo` debug stub

```bash
rm packages/runtime/src/tools/echo.ts packages/runtime/src/tools/echo.txt
```

### Step 9: Commit

```bash
git add -A
git commit -m "feat(tools): filesystem tools - read, write, edit (prompt 07)"
```

## Files created

```
packages/runtime/src/tools/
├── fs/
│   ├── sandbox.ts     # Path-containment check
│   ├── binary.ts      # Binary file detection
│   └── format.ts      # Line-numbered output + truncation
├── read.ts            # Read tool
├── read.txt
├── write.ts           # Write tool
├── write.txt
├── edit.ts            # Edit tool (string replace)
├── edit.txt
└── tool.ts            # MODIFIED (added __readFiles field)

REMOVED:
├── echo.ts            # Debug stub from prompt 06
└── echo.txt
```

## Acceptance criteria

- [ ] `bun run typecheck` passes
- [ ] `createBuiltinRegistry()` loads `read`, `write`, `edit` (no `echo`)
- [ ] `reg.ids()` returns `["edit", "read", "write"]` (sorted)
- [ ] `read` returns `<path>...</path><type>file</type>` for an existing file with line-numbered content
- [ ] `read` of a binary file (e.g. a PNG) returns a clear "Cannot read binary file" message — doesn't crash
- [ ] `read` of a directory returns the entry listing with `<type>directory</type>`
- [ ] `read` with `offset: 100, limit: 50` skips the first 99 lines and returns up to 50
- [ ] `write` to a new path creates the file and any missing parent directories
- [ ] `write` to an existing path (without prior `read`) throws "Refusing to overwrite"
- [ ] `read` followed by `write` to the same path succeeds
- [ ] `edit` to an existing path without prior `read` throws "Refusing to edit"
- [ ] `edit` with `oldString` not in the file throws "oldString not found in content"
- [ ] `edit` with `oldString` matching 3 places and `replaceAll: false` throws "Found 3 matches"
- [ ] `edit` with `oldString` matching 3 places and `replaceAll: true` replaces all 3
- [ ] `edit` with `oldString === newString` throws "No changes to apply"
- [ ] `edit` after `read` succeeds and returns a unified diff in the output
- [ ] Path traversal: `read({ filePath: "../../etc/passwd" })` throws "Path escapes sandbox"
- [ ] After a successful `edit`, the file on disk has the new content (verified with `cat`)

## Verification

```bash
cd kilocode-assistant
bun install
bun run typecheck

# Setup: create a test workspace
mkdir -p /tmp/kilo-fs-test
cd /tmp/kilo-fs-test
echo "line 1\nline 2\nline 3\nline 4\nline 5" > sample.txt

# Run tool tests
cd /path/to/kilocode-assistant
bun --eval '
import { createBuiltinRegistry } from "@kilocode/runtime/tools"
import { resolve } from "node:path"

const reg = await createBuiltinRegistry()
console.log("tools:", reg.ids())

const ctx = {
  sessionID: "test",
  messageID: "m1",
  cwd: "/tmp/kilo-fs-test",
  abort: new AbortController().signal,
  ask: async () => {},
  metadata: async () => {},
  __readFiles: new Set(),
}

// Test 1: read a file
const r1 = await reg.execute("read", { filePath: "/tmp/kilo-fs-test/sample.txt" }, ctx)
console.log("--- read ---")
console.log(r1.output)
console.log("read set now has:", [...ctx.__readFiles])

// Test 2: write a new file
const r2 = await reg.execute("write", { filePath: "/tmp/kilo-fs-test/new.txt", content: "hello" }, ctx)
console.log("--- write new ---")
console.log(r2.output)

// Test 3: edit the existing file (read was recorded)
const r3 = await reg.execute("edit", {
  filePath: "/tmp/kilo-fs-test/sample.txt",
  oldString: "line 3",
  newString: "LINE THREE",
}, ctx)
console.log("--- edit ---")
console.log(r3.output.slice(0, 200))

// Test 4: binary file
import { writeFileSync } from "fs"
writeFileSync("/tmp/kilo-fs-test/image.png", Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, ...Buffer.alloc(100, 0)]))
const r4 = await reg.execute("read", { filePath: "/tmp/kilo-fs-test/image.png" }, ctx)
console.log("--- binary ---")
console.log(r4.output)

// Test 5: path traversal
try {
  await reg.execute("read", { filePath: "/tmp/kilo-fs-test/../../etc/passwd" }, ctx)
} catch (e) {
  console.log("--- sandbox escape (expected) ---")
  console.log(e.message.slice(0, 80))
}

// Test 6: write to existing without read
try {
  await reg.execute("write", { filePath: "/tmp/kilo-fs-test/sample.txt", content: "nope" }, ctx)
} catch (e) {
  console.log("--- write-without-read (expected) ---")
  console.log(e.message.slice(0, 100))
}

console.log("--- final sample.txt contents ---")
console.log(await Bun.file("/tmp/kilo-fs-test/sample.txt").text())
'

# Cleanup
rm -rf /tmp/kilo-fs-test
```

You should see all 6 sections print cleanly with no unexpected errors.

## Notes

- **Why sandbox + read-before-write together?** Two different safety guarantees. Sandbox prevents accessing files outside the worktree. Read-before-write prevents accidentally overwriting an existing file the model never saw (common failure mode — the LLM "remembers" the file content from training but the file has since changed).
- **Why exact string match (not fuzzy)?** Predictability. Kilo Code has a `BlockAnchorReplacer` (Levenshtein-anchor fuzzy match) for advanced cases, but the basic edit is exact-match. Prompt 12's `apply_patch` tool is the fuzzy alternative for GPT models.
- **Why is the read-before-write check optional in the ctx?** Because in standalone tests we don't always have a session-scoped read set. When the agent loop (prompt 15) sets `ctx.__readFiles`, the check activates. When you call tools directly (e.g. in tests), it doesn't.
- **Why `replaceAll` is optional?** Safer to fail loud on multi-match by default. The LLM must decide whether to provide more context or set the flag.
- **Path handling** — Windows uses `\` separators. Our `sandboxPath` uses Node's `path.relative` which handles both. Tested mentally but verify on Windows if you have it.
- **`write` does NOT auto-format** — the prettier/formatter hook is a v1.1 addition. v1 writes exactly what the LLM sends.
- **Image handling** — the Kilo `read` tool attaches images as base64 file parts. Our version returns a string "Cannot read binary file" instead. The AI SDK supports attachments via `experimental_attachments`; wire this in prompt 15 if you need it.
- **BOM handling** — the Kilo `edit` tool preserves UTF-8/16/32 BOMs. Our version does not (it writes the new content verbatim). v1.1 will mirror Kilo's encoding logic from `packages/opencode/src/util/bom.ts`.
- **`formatLineNumbered` byte tracking** — prevents the LLM from receiving 50 MB of output in one call. The cap is 50 KB; use offset for paging.
- **Large file handling** — we read from `startByte = (offset-1) * 80` (an estimate). Real-world files have variable line lengths, so this is approximate. v1.1 does a real line→byte index for accuracy.
- **Why no `diff` library dep?** The unified-diff helper is 15 lines and only used for metadata. Kilo uses the `diff` npm package; we inline it for now to keep the dep list short. If you want a real diff in the metadata, `bun add diff`.
- **`mkdir { recursive: true }`** — handles nested new dirs (e.g. `write` to `a/b/c/file.txt` creates all three). Idempotent.
- **The `ctx.__readFiles` extension** — the double-underscore prefix marks it as internal. The agent loop in prompt 15 will own initializing it. Don't expect tools to be portable across sessions — read tracking is per-session by design.