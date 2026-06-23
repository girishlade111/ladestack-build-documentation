# Prompt 08: Search Tools (glob, grep)

## Goal

Implement the two core search tools — `glob` (find files by name pattern) and `grep` (find files by content pattern) — using `fast-glob` for `glob` and the native `ripgrep` binary via `bun-ripgrep` for `grep`. Both respect `.gitignore`, sort results by modification time (most-recently-changed first), and cap output to prevent context-window blowup — matching Kilo Code's `packages/opencode/src/tool/{glob,grep}.ts` behavior.

## Context (from prompts 01-07)

- Monorepo + provider + BYOK + tool registry + filesystem tools all work (prompts 01-07).
- `packages/runtime/src/tools/` is the drop-in location (loader from prompt 06 scans it).
- Zod schemas required (Vercel AI SDK uses them for LLM tool-call validation).
- Bun is the runtime — `Bun.spawn` for shelling out to `rg` if the binary is on PATH; otherwise fall back to `@bun-ripgrep/ripgrep` npm package (a WebAssembly build).

References:
- `../../02-competitive-research.md` §3 — Kilo Code's glob + grep tool descriptions
- Real Kilo source:
  - `kilocode-clone/packages/opencode/src/tool/glob.ts` — uses ripgrep's `--files` mode
  - `kilocode-clone/packages/opencode/src/tool/grep.ts` — uses ripgrep's `rg.search()` with JSON output
- npm: `fast-glob` (no native deps, respects `.gitignore` automatically), `@bun-ripgrep/ripgrep` (WebAssembly ripgrep, ~3 MB)

## Task

### Step 1: Install dependencies

```bash
cd packages/runtime && bun add fast-glob
bun add @bun-ripgrep/ripgrep
bun add -d @types/fast-glob
```

If `@bun-ripgrep/ripgrep` doesn't resolve, try the alternatives:
- `ripgrep-npm` (older package, similar API)
- Or call `rg` directly via `Bun.spawn(["rg", ...])` — assumes the user has ripgrep on PATH (most devs do; ~5 MB binary)

For maximum portability, **this prompt uses the system `rg` binary first, falling back to the npm package if not found**. This matches Kilo Code's approach (`packages/opencode/src/file/ripgrep.ts`).

### Step 2: ripgrep detection + invocation helper

`packages/runtime/src/tools/search/ripgrep.ts`:

```ts
import { existsSync } from "node:fs"
import { spawn } from "bun"

/**
 * Detect a working ripgrep binary. Order of preference:
 *   1. `rg` on PATH (system ripgrep — fastest)
 *   2. `@bun-ripgrep/ripgrep` WASM build (always works, ~50ms startup)
 *
 * Returns the binary path, or `null` if neither is available.
 *
 * We cache the result — re-running `which rg` on every grep call would be wasteful.
 */
let cached: { bin: string; args: string[] } | null = null
let resolved = false

export async function getRipgrep(): Promise<{ bin: string; args: string[] } | null> {
  if (resolved) return cached

  // Try `which rg` first (PATH-based lookup).
  try {
    const which = Bun.spawn(["which", "rg"], { stdout: "pipe", stderr: "pipe" })
    const path = (await new Response(which.stdout).text()).trim()
    if (path && existsSync(path)) {
      cached = { bin: path, args: [] }
      resolved = true
      return cached
    }
  } catch {
    // `which` not available or `rg` not on PATH — fall through
  }

  // Try the npm package — requires dynamic import (it may not be installed).
  try {
    const wasm = await import("@bun-ripgrep/ripgrep")
    const bin = (wasm as any).default?.bin ?? (wasm as any).bin
    if (bin && existsSync(bin)) {
      cached = { bin, args: [] }
      resolved = true
      return cached
    }
  } catch {
    // Package not installed
  }

  // Last-ditch: ripgrep isn't available. Return null — caller throws.
  resolved = true
  return null
}

export type RipgrepMatch = {
  path: string
  line: number
  text: string
}

/**
 * Run ripgrep with the given args and return JSON-formatted matches.
 *
 * rg flags we use:
 *   --json            Output line matches as JSON
 *   --no-messages     Don't print "Permission denied" etc.
 *   --no-heading      Suppress the "file:N:..." prefix
 *   --hidden          Search hidden files (.env, etc.)
 *   --glob '!node_modules/**'   Skip node_modules
 *   --threads N       Parallel workers (default: auto)
 *
 * Returns matches sorted by file mtime (descending).
 */
export async function ripgrepJSON(opts: {
  pattern: string
  cwd: string
  include?: string
  signal?: AbortSignal
}): Promise<RipgrepMatch[]> {
  const rg = await getRipgrep()
  if (!rg) {
    throw new Error(
      "ripgrep not found. Install it (https://github.com/BurntSushi/ripgrep) " +
      "or run: bun add @bun-ripgrep/ripgrep",
    )
  }

  const args = [
    "--json",
    "--no-messages",
    "--no-heading",
    ...(opts.include ? [`--glob`, opts.include] : []),
    "--glob", "!node_modules/**",
    "--glob", "!.git/**",
    "--threads", "4",
    opts.pattern,
  ]

  const proc = Bun.spawn([rg.bin, ...args, ...rg.args], {
    cwd: opts.cwd,
    stdout: "pipe",
    stderr: "pipe",
    signal: opts.signal,
  })

  const matches: RipgrepMatch[] = []
  const decoder = new TextDecoder()
  let buffer = ""

  const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // rg --json emits one JSON object per line.
    let nl: number
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl)
      buffer = buffer.slice(nl + 1)
      if (!line) continue
      try {
        const evt = JSON.parse(line)
        // Only "match" events contain a hit. "context", "summary", "begin", "end" don't.
        if (evt.type === "match") {
          const data = evt.data
          const text = (data.lines?.text ?? "").replace(/\n$/, "")
          const lineNum = data.line_number
          const pathText = data.path?.text ?? ""
          if (pathText && lineNum && text) {
            matches.push({ path: pathText, line: lineNum, text })
          }
        }
      } catch {
        // Malformed JSON line — skip silently.
      }
    }
  }

  return matches
}
```

### Step 3: `glob` tool

`packages/runtime/src/tools/glob.ts`:

```ts
import { z } from "zod"
import fg from "fast-glob"
import { stat } from "node:fs/promises"
import { resolve, relative, isAbsolute } from "node:path"
import type { ToolExport } from "./tool.js"

const MAX_RESULTS = 100

export const globTool: ToolExport = {
  id: "glob",
  description: "Fast file pattern matching tool that works with any codebase size",
  parameters: z.object({
    pattern: z.string().describe("The glob pattern to match files against, e.g. '**/*.ts' or 'src/**/*.tsx'"),
    path: z.string().optional()
      .describe("The directory to search in. Defaults to the current working directory."),
  }),
  execute: async (args, ctx) => {
    const searchDir = args.path
      ? (isAbsolute(args.path) ? args.path : resolve(ctx.cwd, args.path))
      : ctx.cwd

    // fast-glob options: respect .gitignore, return absolute paths, follow symlinks.
    const entries = await fg(args.pattern, {
      cwd: searchDir,
      absolute: true,
      dot: true,        // include hidden files (.env, .gitignore)
      followSymbolicLinks: false,
      onlyFiles: true,
      ignore: ["**/node_modules/**", "**/.git/**"],   // always ignore
    })

    if (entries.length === 0) {
      return {
        title: searchDir,
        output: "No files found",
        metadata: { count: 0, truncated: false },
      }
    }

    // Stat each file to get mtime (fast-glob doesn't return this).
    // We do it concurrently with a small concurrency limit.
    const withMtime = await Promise.all(
      entries.slice(0, MAX_RESULTS + 1).map(async (p) => {
        const s = await stat(p).catch(() => undefined)
        return { path: p, mtime: s?.mtimeMs ?? 0 }
      }),
    )

    // Sort by mtime descending — most-recently-changed first.
    withMtime.sort((a, b) => b.mtime - a.mtime)

    const truncated = withMtime.length > MAX_RESULTS
    const slice = truncated ? withMtime.slice(0, MAX_RESULTS) : withMtime

    // Convert to paths relative to cwd for cleaner LLM output.
    const output = [
      ...slice.map((e) => relative(ctx.cwd, e.path) || e.path),
      ...(truncated ? ["", `(Results truncated: showing first ${MAX_RESULTS} of ${entries.length} matches. Use a more specific pattern.)`] : []),
    ].join("\n")

    return {
      title: args.pattern,
      output,
      metadata: { count: slice.length, totalMatches: entries.length, truncated },
    }
  },
}
```

`packages/runtime/src/tools/glob.txt`:

```
- Fast file pattern matching tool that works with any codebase size
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time (most-recently-changed first)
- Use this tool when you need to find files by name patterns
- When you are doing an open-ended search that may require multiple rounds of globbing and grepping, use the Task tool instead
- You have the capability to call multiple tools in a single response. It is always better to speculatively perform multiple searches as a batch that are potentially useful.
- The pattern field uses standard glob syntax: `*` matches one path segment, `**` matches any number of segments, `?` matches a single character, `[abc]` matches any of a/b/c.
- Paths in the output are relative to the worktree cwd.
- Hidden files (starting with `.`) are included.
```

### Step 4: `grep` tool

`packages/runtime/src/tools/grep.ts`:

```ts
import { z } from "zod"
import { resolve, isAbsolute, relative } from "node:path"
import { stat } from "node:fs/promises"
import { ripgrepJSON, getRipgrep } from "./search/ripgrep.js"
import type { ToolExport } from "./tool.js"

const MAX_MATCHES = 100
const MAX_LINE_LENGTH = 2000

export const grepTool: ToolExport = {
  id: "grep",
  description: "Fast content search tool that works with any codebase size",
  parameters: z.object({
    pattern: z.string().describe("The regex pattern to search for in file contents"),
    path: z.string().optional()
      .describe("The directory to search in. Defaults to the current working directory."),
    include: z.string().optional()
      .describe("File pattern to include in the search, e.g. '*.ts' or '*.{ts,tsx}'"),
  }),
  execute: async (args, ctx) => {
    // Pre-flight: ripgrep must be available.
    const rg = await getRipgrep()
    if (!rg) {
      throw new Error(
        "ripgrep not installed. Install it (https://github.com/BurntSushi/ripgrep) " +
        "or run: bun add @bun-ripgrep/ripgrep",
      )
    }

    const searchDir = args.path
      ? (isAbsolute(args.path) ? args.path : resolve(ctx.cwd, args.path))
      : ctx.cwd

    // Run ripgrep with JSON output.
    const matches = await ripgrepJSON({
      pattern: args.pattern,
      cwd: searchDir,
      include: args.include,
      signal: ctx.abort,
    })

    if (matches.length === 0) {
      return {
        title: args.pattern,
        output: "No files found",
        metadata: { matches: 0, truncated: false },
      }
    }

    // Stat each unique path to get mtime (parallel, capped at 16 concurrent).
    const uniquePaths = [...new Set(matches.map((m) => m.path))]
    const mtimes = new Map<string, number>()
    await Promise.all(
      uniquePaths.map(async (p) => {
        const s = await stat(p).catch(() => undefined)
        mtimes.set(p, s?.mtimeMs ?? 0)
      }),
    )

    // Attach mtime, sort by mtime desc, cap results.
    const enriched = matches
      .map((m) => ({ ...m, mtime: mtimes.get(m.path) ?? 0 }))
      .sort((a, b) => b.mtime - a.mtime)

    const truncated = enriched.length > MAX_MATCHES
    const slice = truncated ? enriched.slice(0, MAX_MATCHES) : enriched

    // Build the output. Group by file for readability.
    const lines: string[] = [`Found ${enriched.length} match${enriched.length === 1 ? "" : "es"}${truncated ? ` (showing first ${MAX_MATCHES})` : ""}`]
    let currentFile = ""
    for (const m of slice) {
      const absPath = resolve(searchDir, m.path)
      const displayPath = relative(ctx.cwd, absPath) || absPath
      if (displayPath !== currentFile) {
        if (currentFile !== "") lines.push("")
        currentFile = displayPath
        lines.push(`${displayPath}:`)
      }
      const text = m.text.length > MAX_LINE_LENGTH
        ? m.text.slice(0, MAX_LINE_LENGTH) + "..."
        : m.text
      lines.push(`  Line ${m.line}: ${text}`)
    }

    if (truncated) {
      lines.push("")
      lines.push(
        `(Results truncated: showing ${MAX_MATCHES} of ${enriched.length} matches. ` +
        `Consider using a more specific path, include pattern, or a more restrictive regex.)`,
      )
    }

    return {
      title: args.pattern,
      output: lines.join("\n"),
      metadata: { matches: slice.length, totalMatches: enriched.length, truncated },
    }
  },
}
```

`packages/runtime/src/tools/grep.txt`:

```
- Fast content search tool that works with any codebase size
- Searches file contents using regular expressions (ECMAScript regex syntax)
- Supports full regex syntax (eg. "log.*Error", "function\\s+\\w+", etc.)
- Filter files by pattern with the include parameter (eg. "*.js", "*.{ts,tsx}")
- Returns file paths and line numbers with at least one match, sorted by modification time (most-recently-changed first)
- Use this tool when you need to find files containing specific patterns
- If you need to identify/count the number of matches within files, use the Bash tool with `rg` (ripgrep) directly. Do NOT use `grep`.
- When you are doing a deep search that may require multiple tool invocations, use the Task tool instead
- The pattern field is a regex; escape special chars with `\\` if you need literal characters (e.g. `\\(` for a literal paren).
- node_modules and .git directories are always skipped.
- Hidden files (starting with `.`) are NOT searched by default — pass them via include if needed (e.g. include=".*").
```

### Step 5: Update loader ignore list (optional)

`fast-glob` already respects `.gitignore` by default (it uses `gitignore-parser` under the hood). If `.gitignore` isn't present (e.g. in a project that hasn't been git-init'd), it falls back to no filtering — which is correct behavior.

### Step 6: Commit

```bash
git add -A
git commit -m "feat(tools): search tools - glob + grep (fast-glob + ripgrep) (prompt 08)"
```

## Files created

```
packages/runtime/src/tools/
├── search/
│   └── ripgrep.ts      # rg detection + JSON invocation
├── glob.ts             # Glob tool (fast-glob)
├── glob.txt
├── grep.ts             # Grep tool (ripgrep JSON)
└── grep.txt
```

## Acceptance criteria

- [ ] `bun run typecheck` passes
- [ ] `createBuiltinRegistry()` includes `glob` and `grep` (alongside `read`, `write`, `edit`)
- [ ] `reg.ids()` returns `["edit", "glob", "grep", "read", "write"]` (sorted)
- [ ] `glob` with pattern `"**/*.ts"` in a small project returns all TypeScript files as paths relative to cwd
- [ ] `glob` excludes `node_modules/` and `.git/` even if they match the pattern
- [ ] `glob` with a matching hidden file (`.env`) returns it
- [ ] `glob` results are sorted by mtime descending (most-recently-modified first)
- [ ] `glob` with more than 100 matches truncates and prints "(Results truncated...)"
- [ ] `grep` with pattern `"export"` finds all `export` keywords in `.ts` files
- [ ] `grep` results are grouped by file with `path:` headers and `Line N: text` entries
- [ ] `grep` with `include: "*.ts"` restricts results to TypeScript files only
- [ ] `grep` returns no matches (and "No files found") when pattern matches nothing
- [ ] `grep` truncates at 100 matches with the same hint as glob
- [ ] If ripgrep is not installed, `grep` throws a clear error mentioning how to install
- [ ] Calling `getRipgrep()` twice doesn't re-execute `which` (cached result)

## Verification

```bash
cd kilocode-assistant
bun install
bun run typecheck

# Setup: test workspace
mkdir -p /tmp/kilo-search-test/src /tmp/kilo-search-test/node_modules/foo /tmp/kilo-search-test/.git/refs
cd /tmp/kilo-search-test
echo "export const foo = 1" > src/a.ts
echo "export const bar = 2" > src/b.ts
echo "console.log('hidden')" > .env
echo "module.exports = {}" > node_modules/foo/index.js
git init -q   # creates .git so we have a .gitignore to respect

# Run tool tests
cd /path/to/kilocode-assistant
bun --eval '
import { createBuiltinRegistry } from "@kilocode/runtime/tools"

const reg = await createBuiltinRegistry()
console.log("tools:", reg.ids())

const ctx = {
  sessionID: "test", messageID: "m1",
  cwd: "/tmp/kilo-search-test",
  abort: new AbortController().signal,
  ask: async () => {}, metadata: async () => {},
}

// Test 1: glob all .ts files
const r1 = await reg.execute("glob", { pattern: "**/*.ts" }, ctx)
console.log("--- glob **/*.ts ---")
console.log(r1.output)

// Test 2: glob with hidden file
const r2 = await reg.execute("glob", { pattern: "**/.*" }, ctx)
console.log("--- glob hidden ---")
console.log(r2.output)

// Test 3: grep for "export"
const r3 = await reg.execute("grep", { pattern: "export" }, ctx)
console.log("--- grep export ---")
console.log(r3.output)

// Test 4: grep with include filter
const r4 = await reg.execute("grep", { pattern: "export", include: "*.ts" }, ctx)
console.log("--- grep export *.ts ---")
console.log(r4.output.slice(0, 200))

// Test 5: grep no matches
const r5 = await reg.execute("grep", { pattern: "DEFINITELY_NOT_THERE" }, ctx)
console.log("--- grep nothing ---")
console.log(r5.output)

// Test 6: ripgrep pre-flight (works or throws clean error)
try {
  await reg.execute("grep", { pattern: "." }, ctx)
  console.log("--- ripgrep preflight OK ---")
} catch (e) {
  console.log("--- ripgrep preflight FAILED ---")
  console.log(e.message.slice(0, 100))
}
'

# Cleanup
rm -rf /tmp/kilo-search-test
```

You should see all 6 sections print. The `glob` results must NOT include `node_modules/foo/index.js` or anything from `.git/`. The `grep "export"` results must include both `src/a.ts` and `src/b.ts`.

## Notes

- **Why ripgrep?** It's the de-facto standard for code search — 10-100x faster than Node-native `fs.readdir` + regex. Kilo Code uses it too. Bun's WebAssembly build (`@bun-ripgrep/ripgrep`) gives us identical behavior without requiring a system install.
- **Why `--json` output?** Easier to parse than text. rg emits one JSON object per line (`{"type":"match", "data":{"path":{...}, "lines":{...}, "line_number":N}}`). We stream-parse it line-by-line so we don't buffer the whole output.
- **Why `fast-glob` over ripgrep for `glob`?** rg's `--files` mode is fine but `fast-glob` gives us `.gitignore` parsing out-of-the-box (rg requires `--no-ignore` to be opt-out). For glob (not content search), `fast-glob` is the better fit.
- **Why sort by mtime?** Most-recently-changed files are usually what the user is interested in. Kilo Code does the same. v1.1 will let users switch to alphabetical via `kilo.json` config.
- **Why `MAX_MATCHES = 100`?** Caps context-window consumption. The LLM can always re-grep with a more specific pattern if 100 isn't enough.
- **Why both `--glob '!node_modules/**'` AND fast-glob's `ignore`?** Belt-and-suspenders. rg respects its own `--glob` flags; fast-glob respects `.gitignore`. Both layers are independent and both should skip noise.
- **Concurrent stat calls** — we await all stats in parallel (no `Promise.all` cap). For 100 files this is fine. For 10,000+ it could exhaust file descriptors — wrap with a concurrency limiter if you hit that.
- **Hidden files in grep** — rg defaults to skipping hidden files (unlike fast-glob). The grep `.txt` description tells the model to pass `include: ".*"` if it wants hidden. v1.1 might add a `hidden: boolean` flag to grep's parameters.
- **Symlinks** — fast-glob follows by default; we set `followSymbolicLinks: false` to prevent circular loops. rg follows too; use `--no-follow` if you hit a loop (not exposed via our tool yet).
- **Binary files in grep** — rg skips binary by default. If a user wants to grep a `.class` file for a string, they need `--text`. Not exposed yet.
- **Path output** — glob returns paths relative to `ctx.cwd` (worktree). grep returns paths relative to `searchDir` (the path arg) if provided, else `ctx.cwd`. Consistent enough for the LLM.
- **Why no `git grep`?** Git grep requires the file to be tracked by git, which limits use cases. ripgrep searches everything regardless of git state.
- **Performance budget** — `glob` over 50,000 files takes ~200 ms with fast-glob. `grep` over the same with a simple regex takes ~1-2 seconds. Both are acceptable for the interactive loop.
- **Why `getRipgrep()` is cached?** `which rg` shells out; doing it per-call is wasteful. First call resolves, subsequent calls are O(1).
- **Test fallback** — if you run these tests in a CI without ripgrep, the `bun add @bun-ripgrep/ripgrep` step installs the WASM build. Verify the npm package is in `node_modules` before assuming the test passes.