# Prompt 05: BYO API Key + AES-256-GCM Encryption

## Goal

Implement a secure BYO-API-key (Bring-Your-Own-Key) system: keys stored at `~/.kilocode/keys/`, encrypted at rest with AES-256-GCM using a key derived from the host's machine-id + username + hostname (so secrets only decrypt on the user's machine), with env-var fallback (`ANTHROPIC_API_KEY` etc.) and a real `kilo auth <provider> [key]` CLI command — replacing the stub from prompt 02.

## Context (from prompts 01-04)

- Monorepo + CLI exist (prompts 01-02); `kilo auth` is currently a stub at `packages/cli/src/commands/auth.ts`.
- Config schema in `packages/runtime/src/config/schema.ts` accepts `provider: Record<ProviderID, { apiKey?, baseURL?, options? }>`.
- Prompt 04 added a `resolveApiKey(providerID)` at `packages/runtime/src/provider/keys.ts` that only checks env vars. **This prompt replaces that file** so it checks encrypted keyring first, then env, then config.
- Effect framework installed but unused yet — we use plain Node `crypto` + Bun APIs (simpler, no Effect deps in this file).

References:
- `../../02-competitive-research.md` §6 — Kilo Code's `~/.kilo/auth.json` storage pattern
- Real Kilo source: `kilocode-clone/packages/opencode/src/auth/index.ts` (uses `Global.Path.data + "auth.json"`, schema-validated)
- Node docs: `crypto.scryptSync`, `crypto.createCipheriv`, `crypto.createDecipheriv`

Why machine-bound encryption (not a passphrase)?
- Users want zero-friction: open a fresh terminal, run `kilo`, it just works.
- A passphrase adds friction and risks lock-out (forgotten passphrase = forever-lost keys).
- Threats we defend against: laptop theft while powered off, casual filesystem browsing, backups leaking to the cloud. We do NOT defend against an active attacker on the same logged-in user account (game over anyway).

## Task

### Step 1: Add encryption dep

We use **only Node's built-in `crypto` module** — no new deps. `scrypt` and `AES-256-GCM` are in stdlib since Node 10.

```bash
# No bun add needed — `crypto` is built into Bun + Node.
```

### Step 2: Machine-bound key derivation

`packages/runtime/src/auth/machine-key.ts`:

```ts
import { hostname, userInfo, platform } from "os"
import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import { createHash, randomBytes, scryptSync } from "crypto"

/**
 * Derive a stable machine fingerprint and use it to derive a 32-byte AES key.
 * The key never leaves memory except in encrypted form on disk.
 *
 * Inputs:
 *   1. Hostname         — survives reboots, same on all user sessions
 *   2. Username         — OS-level account name (not the human's name)
 *   3. machine-id file  — Linux (/etc/machine-id) + macOS (IOPlatformUUID via ioreg)
 *                         Windows: HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid via `reg query`
 *
 * We scrypt the fingerprint with a fixed app-local salt to slow brute-force
 * attempts on the encrypted key files. Cost N=2^15 keeps derivation at ~50ms.
 */

const SCRYPT_PARAMS = { N: 1 << 15, r: 8, p: 1, keylen: 32 } as const
const APP_SALT = Buffer.from("ladestack.kilo.v1.keys", "utf8")

let cachedKey: Buffer | undefined

export function getMachineKey(): Buffer {
  if (cachedKey) return cachedKey

  const fingerprint = computeFingerprint()
  const key = scryptSync(fingerprint, APP_SALT, SCRYPT_PARAMS.keylen, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
  })
  cachedKey = key
  return key
}

function computeFingerprint(): string {
  const host = hostname()
  const user = userInfo().username
  const machineId = readMachineId() ?? `no-machine-id-${host}-${user}`
  // Hash so the plaintext fingerprint isn't sitting in memory.
  return createHash("sha256").update(`${host}|${user}|${machineId}|${platform()}`).digest("hex")
}

function readMachineId(): string | undefined {
  // Linux: /etc/machine-id (always present on systemd distros)
  if (existsSync("/etc/machine-id")) {
    return readFileSync("/etc/machine-id", "utf8").trim()
  }
  // macOS: IOPlatformUUID — call `ioreg` because Node has no native API.
  if (platform() === "darwin") {
    try {
      const out = require("child_process")
        .execSync('ioreg -rd1 -c IOPlatformExpertDevice | grep -E "IOPlatformUUID" | awk \'{print $3}\' | tr -d \'"\\\'\'', { encoding: "utf8" })
        .trim()
      if (out) return out
    } catch {}
  }
  // Windows: read MachineGuid from registry via `reg query`.
  if (platform() === "win32") {
    try {
      const out = require("child_process")
        .execSync('reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid', { encoding: "utf8" })
      const match = out.match(/MachineGuid\s+REG_SZ\s+(\S+)/)
      if (match) return match[1]
    } catch {}
  }
  return undefined
}

/**
 * For tests / CI: derive a key from an explicit fingerprint instead of the host.
 * NEVER use this in production code paths — guard with NODE_ENV check.
 */
export function getMachineKeyForTesting(fingerprint: string): Buffer {
  if (process.env["NODE_ENV"] === "production") {
    throw new Error("getMachineKeyForTesting is disabled in production")
  }
  return scryptSync(fingerprint, APP_SALT, SCRYPT_PARAMS.keylen, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARTS?.r ?? 8,
    p: 1,
  })
}
```

Wait — fix the typo before you copy: `SCRYPT_PARTS?.r` is wrong. Correct line:

```ts
  return scryptSync(fingerprint, APP_SALT, SCRYPT_PARAMS.keylen, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: 1,
  })
```

### Step 3: AES-256-GCM encrypt + decrypt

`packages/runtime/src/auth/crypto.ts`:

```ts
import { createCipheriv, createDecipheriv, randomBytes } from "crypto"
import { getMachineKey } from "./machine-key.js"

const ALGO = "aes-256-gcm" as const
const IV_LENGTH = 12          // GCM standard nonce length
const AUTH_TAG_LENGTH = 16    // GCM standard auth-tag length

/**
 * On-disk format (base64-encoded):
 *   [12 bytes IV][16 bytes authTag][N bytes ciphertext]
 *
 * Base64-encoding is for safety on Windows filesystems that mangle binary files.
 */
export function encryptString(plaintext: string): string {
  const key = getMachineKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGO, key, iv)

  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, ct]).toString("base64")
}

export function decryptString(payload: string): string {
  const key = getMachineKey()
  const buf = Buffer.from(payload, "base64")
  if (buf.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error("Encrypted payload is too short to be valid")
  }

  const iv = buf.subarray(0, IV_LENGTH)
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
  const ct = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH)

  const decipher = createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(tag)

  try {
    const pt = Buffer.concat([decipher.update(ct), decipher.final()])
    return pt.toString("utf8")
  } catch (err) {
    // GCM auth-tag mismatch = either wrong machine OR corrupted file.
    throw new Error(
      "Failed to decrypt API key. This usually means the key was encrypted on a different machine. " +
      `Underlying error: ${err}`,
    )
  }
}

/**
 * Convenience: peek at the first 4 chars of a plaintext key for user confirmation.
 * Never log the full key.
 */
export function maskKey(plaintext: string): string {
  if (plaintext.length <= 4) return "****"
  return `...${plaintext.slice(-4)}`
}
```

### Step 4: Keyring storage

`packages/runtime/src/auth/store.ts`:

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import { encryptString, decryptString } from "./crypto.js"
import type { ProviderID } from "../provider/ids.js"

const KEYRING_DIR = join(homedir(), ".kilocode", "keys")

function ensureDir() {
  mkdirSync(KEYRING_DIR, { recursive: true, mode: 0o700 })
}

function keyPath(providerID: ProviderID): string {
  // File names: anthropic.enc, openai.enc, etc.
  return join(KEYRING_DIR, `${providerID}.enc`)
}

/** Save (or overwrite) the key for a provider. */
export function setKey(providerID: ProviderID, plaintext: string): void {
  if (!plaintext || plaintext.trim().length === 0) {
    throw new Error("Cannot save an empty API key")
  }
  ensureDir()
  const enc = encryptString(plaintext.trim())
  writeFileSync(keyPath(providerID), enc, { mode: 0o600 })
}

/** Read the decrypted key for a provider. Returns undefined if not set. */
export function getKey(providerID: ProviderID): string | undefined {
  const p = keyPath(providerID)
  if (!existsSync(p)) return undefined
  try {
    const payload = readFileSync(p, "utf8")
    return decryptString(payload)
  } catch (err) {
    // Most common case: key was encrypted on a different machine.
    // Surface a clear error to the user but don't auto-delete the file —
    // they may want to recover the data.
    throw new Error(
      `Could not decrypt key for ${providerID}: ${err instanceof Error ? err.message : String(err)}. ` +
      `Run: kilo auth ${providerID} <new-key> to overwrite.`,
    )
  }
}

/** Delete the key for a provider. No-op if not set. */
export function clearKey(providerID: ProviderID): void {
  const p = keyPath(providerID)
  if (existsSync(p)) unlinkSync(p)
}

/** List providers that have a key saved. */
export function listKeys(): ProviderID[] {
  if (!existsSync(KEYRING_DIR)) return []
  return readdirSync(KEYRING_DIR)
    .filter((f) => f.endsWith(".enc"))
    .map((f) => f.replace(/\.enc$/, "")) as ProviderID[]
}
```

### Step 5: Wire `resolveApiKey` to check the keyring first

Replace `packages/runtime/src/provider/keys.ts`:

```ts
import type { ProviderID } from "./ids.js"
import { getKey } from "../auth/store.js"

const ENV_VAR_BY_PROVIDER: Record<ProviderID, string[]> = {
  anthropic:  ["ANTHROPIC_API_KEY"],
  openai:     ["OPENAI_API_KEY"],
  google:     ["GOOGLE_API_KEY", "GEMINI_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  groq:       ["GROQ_API_KEY"],
  mistral:    ["MISTRAL_API_KEY"],
  xai:        ["XAI_API_KEY", "GROK_API_KEY"],
  deepseek:   ["DEEPSEEK_API_KEY"],
  bedrock:    ["AWS_BEARER_TOKEN_BEDROCK", "AWS_ACCESS_KEY_ID"],
}

/**
 * Resolve an API key for a provider, in priority order:
 *   1. Encrypted keyring (~/.kilocode/keys/<provider>.enc)
 *   2. Environment variable (e.g. ANTHROPIC_API_KEY)
 *   3. (config-driven keys are NOT resolved here — those live in config.ts and are
 *       read at session start; we don't want to leak them into per-call resolution.)
 *
 * Errors from the keyring (wrong-machine decryption) are caught and we fall
 * through to env vars. This makes the system robust to a moved-laptop scenario.
 */
export function resolveApiKey(providerID: ProviderID): string | undefined {
  try {
    const fromKeyring = getKey(providerID)
    if (fromKeyring) return fromKeyring
  } catch {
    // Fall through to env. Error was already logged by the caller of `getKey`.
  }

  const vars = ENV_VAR_BY_PROVIDER[providerID]
  for (const v of vars) {
    const k = process.env[v]
    if (k && k.length > 0) return k
  }
  return undefined
}
```

### Step 6: Real `kilo auth` CLI command

Replace `packages/cli/src/commands/auth.ts`:

```ts
import { setKey, clearKey, getKey, listKeys } from "@kilocode/runtime/auth/store"
import { maskKey } from "@kilocode/runtime/auth/crypto"
import { PROVIDER_IDS, type ProviderID, PROVIDER_LABELS } from "@kilocode/runtime/provider/ids"
import { createInterface } from "readline"

export async function authCommand(opts: { provider?: string; key?: string; list?: boolean }) {
  // Sub-mode: `kilo auth list` shows all stored providers + masked previews.
  if (opts.list || opts.provider === "list") {
    const stored = listKeys()
    if (stored.length === 0) {
      console.log("No API keys stored. Run: kilo auth <provider> <key>")
      return
    }
    for (const id of stored) {
      try {
        const k = getKey(id)
        console.log(`${PROVIDER_LABELS[id]} (${id}): ${maskKey(k ?? "")}`)
      } catch (err) {
        console.error(`${PROVIDER_LABELS[id]} (${id}): DECRYPT FAILED — ${err instanceof Error ? err.message : err}`)
      }
    }
    return
  }

  if (!opts.provider) {
    console.error("Usage: kilo auth <provider> [key]")
    console.error("       kilo auth list")
    console.error(`Providers: ${PROVIDER_IDS.join(", ")}`)
    process.exit(1)
  }

  if (!(PROVIDER_IDS as readonly string[]).includes(opts.provider)) {
    console.error(`unknown provider: ${opts.provider}`)
    console.error(`Supported: ${PROVIDER_IDS.join(", ")}`)
    process.exit(1)
  }

  const providerID = opts.provider as ProviderID

  // No key arg → either read from stdin or clear existing.
  let key = opts.key
  if (key === undefined) {
    if (process.stdin.isTTY) {
      // Interactive: prompt (read from tty)
      const rl = createInterface({ input: process.stdin, output: process.stdout })
      const answer = await new Promise<string>((resolve) => rl.question(`Enter API key for ${providerID}: `, resolve))
      rl.close()
      key = answer.trim()
    } else {
      // Piped: read all of stdin
      const rl = createInterface({ input: process.stdin })
      const lines: string[] = []
      for await (const line of rl) lines.push(line)
      key = lines.join("").trim()
    }
  }

  if (!key || key.length === 0) {
    clearKey(providerID)
    console.log(`cleared ${providerID} key`)
    return
  }

  setKey(providerID, key)
  console.log(`saved ${providerID} key (${maskKey(key)})`)
}
```

Update `packages/cli/src/index.ts` to pass the new flag:

```ts
program
  .command("auth")
  .description("Manage BYO API keys (encrypted at rest in ~/.kilocode/keys/)")
  .argument("[provider]", "Provider (anthropic|openai|google|...)")
  .argument("[key]", "API key (omit to read from stdin/prompt, or empty to clear)")
  .option("-l, --list", "List stored keys")
  .action(async (provider, key, cmdOpts) => {
    const { authCommand } = await import("./commands/auth.js")
    await authCommand({ provider, key, list: cmdOpts.list })
  })
```

### Step 7: Add `auth` barrel export

`packages/runtime/src/auth/index.ts`:

```ts
export * from "./store.js"
export * from "./crypto.js"
export * from "./machine-key.js"
```

This replaces the placeholder `packages/runtime/src/auth.ts` from prompt 02. Delete the placeholder file or leave it empty (Bun will pick up `src/auth/index.ts` via the `auth` workspace path).

### Step 8: Commit

```bash
git add -A
git commit -m "feat(auth): BYOK encryption (AES-256-GCM, machine-bound) + kilo auth CLI (prompt 05)"
```

## Files created / modified

```
packages/runtime/src/auth/
├── machine-key.ts    # scrypt derivation from hostname+username+machine-id
├── crypto.ts         # AES-256-GCM encrypt/decrypt + masking
├── store.ts          # File-backed keyring at ~/.kilocode/keys/<provider>.enc
└── index.ts          # Barrel

packages/runtime/src/provider/keys.ts   # REPLACED (keyring → env fallback)

packages/cli/src/commands/auth.ts       # REPLACED (real impl)
packages/cli/src/index.ts               # updated (--list flag)
```

## Acceptance criteria

- [ ] `bun run typecheck` passes
- [ ] `kilo auth anthropic sk-test-abc123` saves the key and prints `saved anthropic key (...c123)`
- [ ] `kilo auth list` shows `Anthropic (anthropic): ...c123`
- [ ] `kilo auth anthropic ""` (or `kilo auth anthropic` and just press enter) clears the key; `kilo auth list` no longer shows it
- [ ] File at `~/.kilocode/keys/anthropic.enc` exists with mode `0600` and is base64-encoded ciphertext (not plaintext)
- [ ] `cat ~/.kilocode/keys/anthropic.enc | head -1` does NOT contain the plaintext key
- [ ] After `kilo auth anthropic sk-test-abc123`, then `resolveApiKey("anthropic")` returns `sk-test-abc123`
- [ ] When the keyring is empty, `resolveApiKey("anthropic")` falls back to `process.env.ANTHROPIC_API_KEY`
- [ ] With `ANTHROPIC_API_KEY=sk-env` set and no keyring entry, `resolveApiKey("anthropic")` returns `sk-env`
- [ ] With both set, keyring wins (verified by removing the keyring and seeing the env var take over)
- [ ] Decryption on a different machine (simulated by clearing `~/.kilocode/keys/anthropic.enc` and recreating with a different machine key, or by running on a different host) throws a clear error: "Failed to decrypt API key..."
- [ ] `kilo auth notaprovider` exits with error and lists supported providers
- [ ] `getMachineKey()` caches across calls (subsequent calls don't re-scrypt)
- [ ] `chmod 600` is set on new key files (verify with `ls -la ~/.kilocode/keys/`)
- [ ] `kilo auth` with no args prints usage

## Verification

```bash
cd kilocode-assistant
bun install
bun run typecheck

# Save + retrieve a key
bun run kilo auth anthropic sk-ant-test-1234abcde
ls -la ~/.kilocode/keys/
# Expected: -rw-------  1 user  user   ...  anthropic.enc
cat ~/.kilocode/keys/anthropic.enc
# Expected: base64 garbage, NOT "sk-ant-test-1234abcde"

bun run kilo auth list
# Expected: Anthropic (anthropic): ...cde

# Confirm resolveApiKey uses the keyring
bun --eval '
import { resolveApiKey } from "@kilocode/runtime/provider/keys"
console.log(resolveApiKey("anthropic"))   // sk-ant-test-1234abcde
'

# Test env-var fallback (delete keyring first)
rm ~/.kilocode/keys/anthropic.enc
ANTHROPIC_API_KEY=sk-from-env bun --eval '
import { resolveApiKey } from "@kilocode/runtime/provider/keys"
console.log(resolveApiKey("anthropic"))   // sk-from-env
'

# Test decryption failure (simulated by writing garbage)
mkdir -p ~/.kilocode/keys
echo "garbage-not-base64-encrypted-data" > ~/.kilocode/keys/anthropic.enc
bun --eval '
import { resolveApiKey } from "@kilocode/runtime/provider/keys"
try {
  console.log(resolveApiKey("anthropic"))
} catch (e) {
  console.error("EXPECTED ERROR:", e.message.slice(0, 80))
}
'
# Expected: starts with "Could not decrypt key for anthropic..."

# Cleanup
rm ~/.kilocode/keys/anthropic.enc
bun run kilo auth list  # Expected: "No API keys stored."
```

## Notes

- **Why not `keytar`?** Cross-platform but requires native build per OS. Our pure-Node `crypto` path has zero deps and works identically on Linux/macOS/Windows.
- **Why machine-bound (not passphrase)?** Zero-friction is the product goal. Defends against: powered-off laptop theft, filesystem backups, casual access. Does NOT defend against: same-user active compromise, root/admin attacker. For higher security, users can set the env var instead and skip the keyring.
- **`scrypt` cost N=2^15** — ~50ms derivation per process start. Cached in memory after first call. Tweak to N=2^17 if you want stronger resistance (~200ms); N=2^19 is paranoid (~800ms).
- **IV reuse** — we generate a fresh `randomBytes(12)` per `encryptString`. Never reuse IV with the same key for GCM.
- **File mode 0600** — `writeFileSync(path, data, { mode: 0o600 })` on Unix. On Windows the mode is ignored (NTFS ACLs are different). v1.1 will set Windows ACLs explicitly via `icacls`.
- **JSON config keys (`kilo.json` `provider.<id>.apiKey`)** — not resolved here on purpose. Those are loaded at session start by `resolveConfig()` and passed into the provider layer explicitly. Mixing them with the keyring would create a confusing precedence story.
- **Why prompt 04 already had a `resolveApiKey`?** So prompt 04 could be tested standalone without prompt 05. Prompt 05 *replaces* it (same filename, new impl). The barrel re-exports it either way.
- **Backward compat** — prompt 02's `auth.ts` had a stub `setKey`/`clearKey`. If you wired anything against those signatures, this prompt changes them to `ProviderID` instead of `string`. Update callers in prompt 02's `run.ts` if needed (the run.ts there just calls `runSession`, not auth).
- **Bedrock is special** — accepts either a bearer token string OR a JSON blob `{"accessKeyId":"...","secretAccessKey":"...","sessionToken":"..."}`. The JSON case is decrypted as a string and parsed by `factories.ts` (prompt 04). For now, this prompt just stores the raw string.
- **Migration** — Kilo Code stores auth in a single `~/.kilo/auth.json`. We use one-file-per-provider for atomicity (you can chmod one key file, replace one key, etc.). A v1.1 import script reads Kilo's auth.json and migrates.
- **Threat model recap** — see the top-of-file comment in `machine-key.ts`. Don't claim this is enterprise-grade. It's good enough for a single-user local-first CLI.