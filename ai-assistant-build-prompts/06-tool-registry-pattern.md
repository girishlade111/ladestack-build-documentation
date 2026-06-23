# Prompt 06: Tool Registry Pattern (.ts + .txt pair convention)

## Goal

Define the tool system that every subsequent prompt (07+ for file tools, 09-12 for bash/meta/plan/specialty) plugs into. A tool is a **pair of files** at `packages/runtime/src/tools/<name>.ts` + `packages/runtime/src/tools/<name>.txt`. The `.ts` exports a Zod schema + execute function; the `.txt` is the LLM-facing description (system prompt fragment). The registry auto-discovers these pairs at runtime, validates inputs with Zod, and exposes a unified `ToolRegistry` interface to the agent loop (prompt 15).

## Context (from prompts 01-05)

- Monorepo + config + provider layer exist (prompts 01-05).
- The runtime package will house tools at `packages/runtime/src/tools/` — this is the convention we lock in here.
- Effect framework installed but unused — **this prompt uses plain TS classes + Zod**, not Effect Layers. We chose this because tool definitions are leaf-node code (no DI, no async init), and the Effect overhead isn't worth it for ~30 tools. The agent loop (prompt 15) wraps these into Effect if/when needed.
- Zod already a dep of `packages/runtime` (from prompts 02 + 03).

References:
- `../../02-competitive-research.md` §3 — Kilo Code's tool pair convention (`packages/opencode/src/tool/*.ts` + `*.txt`)
- Real Kilo source: `kilocode-clone/packages/opencode/src/tool/{tool.ts,registry.ts}` for the `Tool.define` pattern and Effect-based registry
- Vercel AI SDK: `tool()` function from `ai` package for converting Zod → `Tool<Input, Output>` consumable by `streamText`

## Task

### Step 1: Install `tool` definition deps

The Vercel AI SDK (already installed in prompt 04) ships `import { tool } from "ai"` which converts a Zod schema + execute function into a tool the SDK can pass to the LLM. No new packages needed.

```bash
# No bun add needed.
```

### Step 2: The `Tool` interface (the public contract)

`packages/runtime/src/tools/tool.ts`:

```ts
import { z, type ZodType, type ZodRawShape, type ZodObject } from "zod"

/**
 * The canonical tool contract used by every tool in the system.
 *
 * Every tool:
 *   - has a stable `id` (lowercase, snake_case)
 *   - exposes a `description` string the LLM sees as its docstring
 *   - declares `parameters` as a Zod object schema (LLM-emitted JSON must validate)
 *   - implements `execute(args, ctx)` returning a structured result
 *
 * `ctx` carries the per-call context: session id, abort signal, permission asker.
 *
 * The companion `<name>.txt` file (auto-imported by the registry) is the
 * LLM-facing description — long, with usage examples. The `description` field
 * below is a one-line summary used for UI listings.
 */
export type ToolContext = {
  sessionID: string
  messageID: string
  cwd: string            // resolved worktree
  abort: AbortSignal
  // ask() prompts the user for permission. Throws if denied.
  ask(input: { permission: string; patterns: string[]; metadata?: Record<string, unknown> }): Promise<void>
  // metadata() lets tools annotate the call (e.g. diff, files-touched) for UI.
  metadata(input: { title?: string; metadata?: Record<string, unknown> }): Promise<void>
}

export type ToolResult<M = Record<string, unknown>> = {
  title: string
  output: string          // plain text returned to the LLM (must fit in context window)
  metadata: M
  // Optional attachments: images, files, etc.
  attachments?: Array<{ type: "file"; mime: string; data: Uint8Array | string }>
}

export interface ToolDef<I extends ZodType = ZodType, M = Record<string, unknown>> {
  id: string
  description: string     // one-line summary (UI)
  // The detailed LLM-facing description — populated by the registry from the .txt file.
  // Tools don't fill this in themselves.
  detailedDescription?: string
  parameters: I
  execute(args: z.infer<I>, ctx: ToolContext): Promise<ToolResult<M>>
}

/**
 * The shape tools should export from their <name>.ts file.
 *
 * The registry looks for `export const <CamelCase>Tool: ToolDef = { ... }`.
 * Naming convention: `read` → `readTool`, `grep` → `grepTool`, `apply_patch` → `applyPatchTool`.
 */
export type ToolExport = {
  id: string
  description: string
  parameters: ZodObject<ZodRawShape>
  execute(args: any, ctx: ToolContext): Promise<ToolResult>
}

/**
 * Helper: convert our ToolDef into the Vercel AI SDK's `tool()` shape.
 * Used by prompt 15's agent loop when wiring tools into streamText.
 */
export function toAISDKTool(def: ToolDef): ReturnType<typeof tool> {
  // Lazy import to avoid hard dep at the file's top — keeps tools pure.
  const { tool } = require("ai") as typeof import("ai")
  return (tool as any)({
    description: def.detailedDescription ?? def.description,
    parameters: def.parameters as any,
    execute: async (args: any) => {
      // The AI SDK calls execute with the validated, typed args.
      // We forward to def.execute but can't pass ToolContext here —
      // the agent loop wraps this in a closure that injects ctx.
      // See prompt 15 for the full bridge.
      throw new Error("toAISDKTool() must be wrapped by the agent loop to inject ToolContext")
    },
  })
}
```

Wait — re-check the `require("ai")` line: this is CommonJS-style require inside an ESM file. Bun supports `require()` in ESM (it auto-detects) but it's brittle. Better to make `ai` a top-level import:

```ts
import { tool } from "ai"

export function toAISDKTool(def: ToolDef) {
  return tool({
    description: def.detailedDescription ?? def.description,
    parameters: def.parameters as any,
    // execute is intentionally not implemented here — agent loop bridges it.
    execute: undefined as any,
  })
}
```

The `execute: undefined as any` is intentional: we don't want tools accidentally invoked without permission/context plumbing. The bridge in prompt 15 overrides `execute` with a closure that injects `ctx`.

### Step 3: The file pair contract + the loader

`packages/runtime/src/tools/loader.ts`:

```ts
import { readdirSync, readFileSync, existsSync, statSync } from "fs"
import { join, basename, extname, resolve } from "path"
import { pathToFileURL } from "url"
import type { ToolExport } from "./tool.js"

/**
 * Discover every <name>.ts + <name>.txt pair under `dir` (default:
 * `packages/runtime/src/tools/`). Returns a map from tool id → ToolExport
 * with the `detailedDescription` field populated from the .txt file.
 *
 * Tool files are dynamically imported — this lets tools be added/removed
 * without recompiling the registry. Hot-reload friendly.
 */
export async function loadToolsFromDir(dir: string): Promise<Map<string, ToolExport & { detailedDescription: string }>> {
  const tools = new Map<string, ToolExport & { detailedDescription: string }>()

  if (!existsSync(dir)) return tools

  const entries = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"))
  for (const entry of entries) {
    const name = basename(entry, ".ts")
    const txtPath = join(dir, `${name}.txt`)

    // Pair requirement: every .ts MUST have a sibling .txt.
    if (!existsSync(txtPath)) {
      throw new Error(`Tool file ${entry} is missing its ${name}.txt description file`)
    }

    const detailedDescription = readFileSync(txtPath, "utf8").trim()

    // Dynamic import — Bun resolves the .ts file directly.
    const absPath = resolve(dir, entry)
    const mod = await import(pathToFileURL(absPath).href)

    // Convention: export is `<camelCaseName>Tool` (e.g. `read.ts` → `readTool`).
    const camel = camelCase(name)
    const exportName = `${camel}Tool`
    const tool = mod[exportName] as ToolExport | undefined
    if (!tool) {
      throw new Error(`Tool file ${entry} must export a \`${exportName}\` const`)
    }

    // Sanity-check the shape.
    if (typeof tool.id !== "string" || typeof tool.description !== "string" || !tool.parameters) {
      throw new Error(`Tool ${entry} is missing required fields (id, description, parameters)`)
    }
    if (typeof tool.execute !== "function") {
      throw new Error(`Tool ${entry} is missing an execute() function`)
    }

    tools.set(tool.id, { ...tool, detailedDescription })
  }

  return tools
}

function camelCase(name: string): string {
  return name.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
}
```

### Step 4: The registry

`packages/runtime/src/tools/registry.ts`:

```ts
import type { ToolExport, ToolContext, ToolResult } from "./tool.js"
import { loadToolsFromDir } from "./loader.js"
import { resolve } from "path"

/**
 * Singleton-style registry. Built once per process. Thread-safe (no mutation
 * after init).
 */
export class ToolRegistry {
  private tools = new Map<string, ToolExport & { detailedDescription: string }>()
  private initialized = false

  constructor(private readonly toolsDir: string) {}

  async init(): Promise<void> {
    if (this.initialized) return
    this.tools = await loadToolsFromDir(this.toolsDir)
    this.initialized = true
  }

  /** All registered tool ids in deterministic order. */
  ids(): string[] {
    return [...this.tools.keys()].sort()
  }

  /** Full list of tool defs. */
  all(): Array<ToolExport & { detailedDescription: string }> {
    return [...this.tools.values()]
  }

  /** Lookup by id. Throws if not found (don't silent-fail — typos here = bugs). */
  get(id: string): ToolExport & { detailedDescription: string } {
    const t = this.tools.get(id)
    if (!t) throw new Error(`Unknown tool: ${id}. Registered: ${this.ids().join(", ")}`)
    return t
  }

  /** Filter tools by enabled set (from config + per-agent overrides). */
  enabled(enabledIds: Set<string> | undefined): Array<ToolExport & { detailedDescription: string }> {
    if (!enabledIds) return this.all()
    return this.all().filter((t) => enabledIds.has(t.id))
  }

  /**
   * Execute a tool by id with validated args. Throws on:
   *   - unknown tool id
   *   - args that fail Zod validation (caught, formatted, re-thrown as ToolError)
   *   - tool execute() throwing (re-thrown with original cause)
   */
  async execute(
    id: string,
    args: unknown,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const def = this.get(id)

    // Zod-validate args. The LLM should always emit valid args, but real models
    // hallucinate fields, misspell enums, etc. Catch and return a clear error.
    const parsed = def.parameters.safeParse(args)
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("\n")
      throw new ToolValidationError(id, issues)
    }

    try {
      return await def.execute(parsed.data, ctx)
    } catch (err) {
      if (err instanceof ToolError) throw err
      throw new ToolExecutionError(id, err)
    }
  }
}

/**
 * Errors emitted by the registry. The agent loop (prompt 15) catches these
 * and returns them to the LLM as tool-result messages so the model can retry.
 */
export class ToolError extends Error {
  constructor(
    public readonly toolID: string,
    public readonly kind: "validation" | "execution" | "permission",
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message)
    this.name = "ToolError"
  }
}

export class ToolValidationError extends ToolError {
  constructor(id: string, detail: string) {
    super(id, "validation", `Invalid arguments for tool "${id}":\n${detail}`)
  }
}

export class ToolExecutionError extends ToolError {
  constructor(id: string, cause: unknown) {
    super(id, "execution", `Tool "${id}" failed: ${cause instanceof Error ? cause.message : String(cause)}`, cause)
  }
}
```

### Step 5: Default tools directory + barrel

`packages/runtime/src/tools/index.ts`:

```ts
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { ToolRegistry } from "./registry.js"
import type { ToolExport, ToolContext, ToolResult } from "./tool.js"

export { ToolRegistry, ToolError, ToolValidationError, ToolExecutionError } from "./registry.js"
export type { ToolExport, ToolContext, ToolResult } from "./tool.js"
export { loadToolsFromDir } from "./loader.js"
export { toAISDKTool } from "./tool.js"

// Resolve the default tools dir relative to this source file.
// At runtime: <repo>/packages/runtime/src/tools/
const HERE = dirname(fileURLToPath(import.meta.url))
export const DEFAULT_TOOLS_DIR = join(HERE, ".")   // same dir as this index.ts

/**
 * Helper: build a registry pre-loaded with all built-in tools.
 */
export async function createBuiltinRegistry(): Promise<ToolRegistry> {
  const reg = new ToolRegistry(DEFAULT_TOOLS_DIR)
  await reg.init()
  return reg
}
```

### Step 6: Sample tool stub (proves the convention works)

This is a placeholder tool. It will be removed in prompt 07 when real `read`/`write`/`edit` arrive — but proves the loader works end-to-end.

`packages/runtime/src/tools/echo.ts`:

```ts
import { z } from "zod"
import type { ToolExport } from "./tool.js"

/**
 * A minimal tool that proves the registry pattern works. Removed in prompt 07
 * (or kept as `kilo_echo` if you want a built-in test/debug tool).
 */
export const echoTool: ToolExport = {
  id: "echo",
  description: "Echoes back the input text (debug helper)",
  parameters: z.object({
    text: z.string().describe("Text to echo back"),
  }),
  execute: async (args) => ({
    title: "echo",
    output: args.text,
    metadata: { length: args.text.length },
  }),
}
```

`packages/runtime/src/tools/echo.txt`:

```
- Debug-only tool that returns the input text verbatim
- Used to verify the tool registry wiring during development
- Not exposed to end users (remove in production builds)
```

### Step 7: Wire into runtime index

Add to `packages/runtime/src/index.ts`:

```ts
export * as tools from "./tools/index.js"
export * from "./tools/tool.js"
export * from "./tools/registry.js"
```

### Step 8: Commit

```bash
git add -A
git commit -m "feat(tools): tool registry pattern (.ts + .txt pair convention) (prompt 06)"
```

## Files created

```
packages/runtime/src/tools/
├── tool.ts        # ToolDef interface + Vercel AI SDK bridge
├── loader.ts      # Pair discovery (scans .ts + .txt)
├── registry.ts    # ToolRegistry class + error types
├── echo.ts        # Sample tool (removed in prompt 07 or kept as debug)
├── echo.txt       # Sample description
└── index.ts       # Barrel + DEFAULT_TOOLS_DIR + createBuiltinRegistry()
```

Plus 2 lines added to `packages/runtime/src/index.ts`.

## Acceptance criteria

- [ ] `bun run typecheck` passes
- [ ] `createBuiltinRegistry()` loads the `echo` tool without error
- [ ] `reg.ids()` returns `["echo"]` (sorted)
- [ ] `reg.get("echo").description === "Echoes back the input text (debug helper)"`
- [ ] `reg.get("echo").detailedDescription` matches the contents of `echo.txt` (trimmed)
- [ ] `reg.execute("echo", { text: "hi" }, mockCtx)` returns `{ title: "echo", output: "hi", metadata: { length: 2 } }`
- [ ] `reg.execute("echo", { wrong: "field" }, mockCtx)` throws `ToolValidationError` with a clear message
- [ ] `reg.execute("nonexistent", {}, mockCtx)` throws an `Error` mentioning the unknown id and listing known tools
- [ ] Removing `echo.txt` and re-running `createBuiltinRegistry()` throws with the exact filename mentioned
- [ ] `reg.execute("echo", { text: "" }, mockCtx)` works (empty string is valid per the schema)
- [ ] A .ts file missing its .txt pair fails to load with a clear error
- [ ] A .ts file missing the `<name>Tool` export fails to load with a clear error

## Verification

```bash
cd kilocode-assistant
bun install
bun run typecheck

# End-to-end registry test
bun --eval '
import { createBuiltinRegistry } from "@kilocode/runtime/tools"

const reg = await createBuiltinRegistry()
console.log("tool ids:", reg.ids())               // ["echo"]
console.log("description:", reg.get("echo").description)
console.log("detailed desc starts:", reg.get("echo").detailedDescription?.slice(0, 30))

const ctx = { sessionID: "s1", messageID: "m1", cwd: "/tmp", abort: new AbortController().signal,
              ask: async () => {}, metadata: async () => {} }
const r = await reg.execute("echo", { text: "hello world" }, ctx)
console.log("output:", r.output)                  // "hello world"
console.log("metadata:", JSON.stringify(r.metadata))  // {"length":11}

// Validation error
try {
  await reg.execute("echo", { wrong: "field" }, ctx)
} catch (e) {
  console.log("expected validation error:", e.message.slice(0, 80))
}

// Unknown tool
try {
  await reg.execute("nope", {}, ctx)
} catch (e) {
  console.log("expected unknown-tool error:", e.message.slice(0, 80))
}
'
```

You should see all 4 expected outputs (tool ids, description, echo result, validation error, unknown error).

```bash
# Pair-missing error
mv packages/runtime/src/tools/echo.txt /tmp/echo.txt.bak
bun --eval 'import("@kilocode/runtime/tools").then(m => m.createBuiltinRegistry())'
# Expected: Error mentioning "echo.txt"
mv /tmp/echo.txt.bak packages/runtime/src/tools/echo.txt
```

## Notes

- **Why `.ts` + `.txt`?** Separation of code (deterministic, hot-reloaded) from natural-language description (long, hand-edited, no escaping headaches). The `.txt` content goes directly to the LLM as the tool's `description` field — no JSON encoding, no markdown stripping, just plain English.
- **Why dynamic import?** Tools can be added/removed without recompiling the core registry. This is critical for v1.1's plugin model (prompt 23+). Dynamic import via `pathToFileURL` works on all 3 OSes including Windows (where absolute paths with backslashes break `import()`).
- **Why no Effect for tools?** Tools are leaf nodes — no DI, no async init. Effect's overhead isn't worth it. The agent loop (prompt 15) wraps the registry in Effect if it needs to.
- **`detailedDescription` vs `description`** — `description` is a one-liner shown in `kilo tools` CLI output and IDE pickers. `detailedDescription` (from .txt) is the long-form sent to the LLM. Keeping them separate prevents token bloat in listings.
- **Naming convention** — `read.ts` exports `readTool`, `apply_patch.ts` exports `applyPatchTool`. The `camelCase()` helper in `loader.ts` handles the `_` → camelCase transform. If you break this convention, the loader throws with the expected export name.
- **Why `ZodObject<ZodRawShape>` and not `ZodType`?** Constrains tools to object-shaped parameters (the Vercel AI SDK requires this). Tools that need no args declare `parameters: z.object({})`. Tools needing a single string can declare `parameters: z.object({ input: z.string() })`.
- **`toAISDKTool` bridge** — the `execute: undefined` pattern is intentional. The agent loop in prompt 15 wraps each tool with a closure that injects `ToolContext` and validates args. Don't try to call a tool directly through `toAISDKTool` — it'll throw.
- **Pair requirement is strict** — a `.ts` without a `.txt` is a bug (the LLM has no description to read). The loader throws. If you want to disable a tool temporarily, move both files out, don't delete just one.
- **`createBuiltinRegistry()` is async** because dynamic imports are async. Call it once at process start, then reuse the returned `ToolRegistry`.
- **Built-in tool list (from the task brief)** — `read`, `write`, `edit`, `glob`, `grep`, `bash`, `todowrite`, `question`, `plan_enter`, `plan_write`, `plan_exit`, `apply_patch`, `recall`, `lsp`, `websearch`. Prompts 07+ implement each. The `echo` tool from this prompt is a debug-only stub — remove it in prompt 07's verification step.
- **Error visibility** — `ToolValidationError`, `ToolExecutionError`, and the unknown-tool error are all *returned to the LLM* as tool-result messages. The model sees the error, corrects its args (or reports the failure to the user), and continues. This is critical for graceful failure — don't hide errors from the model.
- **Hot-reload caveat** — the registry caches after `init()`. If you edit a tool while running, the change won't take effect until restart. v1.1 adds `chokidar` watching with auto-reload.