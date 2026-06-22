# Prompt 23: BYO API Key Management

## Goal

Build the UI + API for users to add/remove their own API keys for Anthropic, OpenAI, Google. Keys are encrypted at rest (AES-256-GCM). The runtime uses these keys when calling LLM providers.

## Context (from prompts 01-22)

- Runtime has `resolveApiKey(userId, provider)` (prompt 06) that looks up BYO keys from DB.
- The encryption helpers exist in `@ladestack/runtime/providers/encryption`.
- No UI to add/manage keys yet.

Reference: `../PRD.md` §6.1 (BYO model key), `../system-design.md` §6 (BYO key flow).

## Task

### Step 1: Verify encryption works end-to-end

The encryption helper from prompt 06 uses AES-256-GCM with `ENCRYPTION_KEY` env var. Make sure:

1. `ENCRYPTION_KEY` is set in `packages/api/.env` AND `packages/runtime/.env` (same value)
2. Generate with: `openssl rand -hex 32`

If not already done:

```bash
echo "ENCRYPTION_KEY=$(openssl rand -hex 32)" >> packages/api/.env
echo "ENCRYPTION_KEY=$(openssl rand -hex 32)" >> packages/runtime/.env
# Edit to make them the same
```

### Step 2: Build API routes for BYO keys

`packages/api/src/routes/api-keys.ts`:

```ts
import { Hono } from "hono"
import { z } from "zod"
import { zValidator } from "@hono/zod-validator"
import { authMiddleware, type AuthContext } from "../middleware/auth.js"
import { supabaseAdmin } from "../db/client.js"
import { encryptApiKey } from "@ladestack/runtime"
import { badRequest } from "../middleware/error.js"

const PROVIDERS = ["anthropic", "openai", "google"] as const

const upsertKeySchema = z.object({
  provider: z.enum(PROVIDERS),
  apiKey: z.string().min(10).max(200)
})

export const apiKeyRoutes = new Hono<{ Variables: { auth: AuthContext } }>()
  .use("*", authMiddleware)

  // List configured keys (only shows hints, not the keys)
  .get("/", async (c) => {
    const { userId } = c.get("auth")
    const { data, error } = await supabaseAdmin
      .from("api_keys")
      .select("provider, key_hint, created_at")
      .eq("user_id", userId)
    if (error) throw error
    return c.json({ keys: data ?? [] })
  })

  // Upsert a key
  .put("/", zValidator("json", upsertKeySchema), async (c) => {
    const { userId } = c.get("auth")
    const { provider, apiKey } = c.req.valid("json")

    // Basic format validation per provider
    if (provider === "anthropic" && !apiKey.startsWith("sk-ant-")) {
      throw badRequest("anthropic_keys_start_with_sk-ant")
    }
    if (provider === "openai" && !apiKey.startsWith("sk-")) {
      throw badRequest("openai_keys_start_with_sk-")
    }
    if (provider === "google" && apiKey.length < 30) {
      throw badRequest("google_key_too_short")
    }

    const encrypted = encryptApiKey(apiKey)
    const hint = apiKey.slice(-4)

    // Upsert (replace if exists)
    const { error } = await supabaseAdmin
      .from("api_keys")
      .upsert({
        user_id: userId,
        provider,
        encrypted_key: encrypted,
        key_hint: hint
      }, { onConflict: "user_id,provider" })

    if (error) throw error
    return c.json({ saved: true, provider, hint })
  })

  // Delete a key
  .delete("/:provider", async (c) => {
    const { userId } = c.get("auth")
    const provider = c.req.param("provider")
    if (!PROVIDERS.includes(provider as any)) {
      throw badRequest("invalid_provider")
    }

    await supabaseAdmin
      .from("api_keys")
      .delete()
      .eq("user_id", userId)
      .eq("provider", provider)

    return c.json({ deleted: provider })
  })

  // Test the key (make a small API call)
  .post("/test", zValidator("json", z.object({ provider: z.enum(PROVIDERS) })), async (c) => {
    const { userId } = c.get("auth")
    const { provider } = c.req.valid("json")
    // resolveApiKey handles BYO + managed fallback
    const { resolveApiKey } = await import("@ladestack/runtime")
    const apiKey = await resolveApiKey(userId, provider)
    // Make a minimal test call per provider
    if (provider === "anthropic") {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: "claude-3-5-haiku-20241022",
          max_tokens: 10,
          messages: [{ role: "user", content: "hi" }]
        })
      })
      return c.json({ ok: res.ok, status: res.status })
    }
    if (provider === "openai") {
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` }
      })
      return c.json({ ok: res.ok, status: res.status })
    }
    if (provider === "google") {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`)
      return c.json({ ok: res.ok, status: res.status })
    }
    throw badRequest("unknown_provider")
  })
```

Wire into `packages/api/src/index.ts`:
```ts
import { apiKeyRoutes } from "./routes/api-keys.js"
  .route("/api/api-keys", apiKeyRoutes)
```

### Step 3: Update runtime to expose `resolveApiKey`

Already done in prompt 06 (`packages/runtime/src/providers/keys.ts`). Verify it's exported from `@ladestack/runtime`.

### Step 4: Build the settings UI

`apps/web/src/components/settings/ApiKeysSettings.tsx`:

```tsx
"use client"
import { useState, useEffect } from "react"
import { Eye, EyeOff, Check, X, Trash2 } from "lucide-react"
import { api } from "@/lib/api"

interface ApiKey {
  provider: "anthropic" | "openai" | "google"
  key_hint: string
  created_at: string
}

const PROVIDER_LABELS: Record<string, { name: string; placeholder: string; docsUrl: string }> = {
  anthropic: { name: "Anthropic", placeholder: "sk-ant-...", docsUrl: "https://console.anthropic.com/" },
  openai: { name: "OpenAI", placeholder: "sk-...", docsUrl: "https://platform.openai.com/api-keys" },
  google: { name: "Google Gemini", placeholder: "AIza...", docsUrl: "https://aistudio.google.com/app/apikey" }
}

export function ApiKeysSettings() {
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [input, setInput] = useState("")
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; status: number } | null>>({})

  const load = async () => {
    const { keys } = await api<{ keys: ApiKey[] }>("/api/api-keys")
    setKeys(keys)
  }

  useEffect(() => { load() }, [])

  const handleSave = async (provider: string) => {
    try {
      await api("/api/api-keys", { method: "PUT", body: JSON.stringify({ provider, apiKey: input }) })
      setEditing(null)
      setInput("")
      await load()
    } catch (err: any) {
      alert(`Save failed: ${err.message}`)
    }
  }

  const handleDelete = async (provider: string) => {
    if (!confirm(`Delete your ${PROVIDER_LABELS[provider].name} API key?`)) return
    await api(`/api/api-keys/${provider}`, { method: "DELETE" })
    await load()
  }

  const handleTest = async (provider: string) => {
    setTesting(provider)
    setTestResult((prev) => ({ ...prev, [provider]: null }))
    try {
      const result = await api<{ ok: boolean; status: number }>("/api/api-keys/test", {
        method: "POST",
        body: JSON.stringify({ provider })
      })
      setTestResult((prev) => ({ ...prev, [provider]: result }))
    } catch (err: any) {
      setTestResult((prev) => ({ ...prev, [provider]: { ok: false, status: 0 } }))
    } finally {
      setTesting(null)
    }
  }

  return (
    <div className="space-y-4 p-6">
      <h2 className="text-lg font-semibold text-text-primary">API keys</h2>
      <p className="text-sm text-text-secondary">
        Bring your own API keys to use your LLM provider accounts directly. We never log or display your keys after saving.
      </p>

      <div className="space-y-3">
        {Object.entries(PROVIDER_LABELS).map(([provider, info]) => {
          const existing = keys.find((k) => k.provider === provider)
          const isEditing = editing === provider

          return (
            <div key={provider} className="rounded border border-border-subtle bg-surface p-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-text-primary">{info.name}</div>
                  {existing && !isEditing && (
                    <div className="text-xs text-text-tertiary">
                      ••••{existing.key_hint}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-1">
                  {existing && (
                    <>
                      <button
                        onClick={() => handleTest(provider)}
                        disabled={testing === provider}
                        className="rounded p-1.5 text-xs text-text-secondary hover:bg-elevated"
                      >
                        {testing === provider ? "..." : "Test"}
                      </button>
                      <button
                        onClick={() => handleDelete(provider)}
                        className="rounded p-1.5 text-xs text-accent-red hover:bg-accent-red/10"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </>
                  )}
                  {!isEditing && (
                    <button
                      onClick={() => { setEditing(provider); setInput("") }}
                      className="rounded bg-elevated px-3 py-1 text-xs text-text-primary hover:bg-canvas"
                    >
                      {existing ? "Replace" : "Add"}
                    </button>
                  )}
                </div>
              </div>

              {testResult[provider] && (
                <div className={`mt-2 text-xs ${testResult[provider]!.ok ? "text-accent-green" : "text-accent-red"}`}>
                  {testResult[provider]!.ok ? "✓ Key works" : `✗ Failed (HTTP ${testResult[provider]!.status})`}
                </div>
              )}

              {isEditing && (
                <div className="mt-3 space-y-2">
                  <div className="relative">
                    <input
                      type={showKey ? "text" : "password"}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder={info.placeholder}
                      className="w-full rounded border border-border-subtle bg-canvas px-3 py-2 pr-10 font-mono text-sm text-text-primary"
                    />
                    <button
                      onClick={() => setShowKey(!showKey)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-text-tertiary"
                    >
                      {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <div className="flex items-center justify-between">
                    <a href={info.docsUrl} target="_blank" className="text-xs text-gold underline">
                      Get a key
                    </a>
                    <div className="flex gap-2">
                      <button
                        onClick={() => { setEditing(null); setInput("") }}
                        className="rounded px-3 py-1 text-xs text-text-secondary"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => handleSave(provider)}
                        disabled={!input}
                        className="rounded bg-gold px-3 py-1 text-xs text-canvas disabled:opacity-50"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

### Step 5: Wire settings modal into TopBar

`apps/web/src/components/layout/TopBar.tsx`:

The Settings icon opens a modal. Create `apps/web/src/components/settings/SettingsModal.tsx`:

```tsx
"use client"
import { useUIStore } from "@/stores/ui"
import { ApiKeysSettings } from "./ApiKeysSettings"

export function SettingsModal() {
  const { modals } = useUIStore()
  if (!modals.settings) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="max-h-[80vh] w-full max-w-2xl overflow-auto rounded-lg border border-border-subtle bg-canvas shadow-2xl">
        <ApiKeysSettings />
      </div>
    </div>
  )
}
```

Render in IDE layout (`apps/web/src/app/c/[projectId]/page.tsx`):

```tsx
import { SettingsModal } from "@/components/settings/SettingsModal"

// At the end of the JSX:
<SettingsModal />
```

### Step 6: Update TopBar Settings icon to open modal

Already wired:
```tsx
<button onClick={() => openModal("settings")}>
  <Settings className="h-4 w-4" />
</button>
```

### Step 7: Surface key issues in the UI

If a request fails due to invalid API key, surface a helpful error:

`apps/web/src/components/chat/Message.tsx` — add error handling:

```tsx
{/* In the error rendering */}
{error && error.includes("auth") && (
  <div className="mt-2 text-sm">
    <a href="#" onClick={() => useUIStore.getState().openModal("settings")} className="text-gold underline">
      Open settings to add an API key
    </a>
  </div>
)}
```

### Step 8: Commit

```bash
git add -A
git commit -m "feat: BYO API key management with encryption + test (prompt 23)"
```

## Files created/modified

```
packages/api/src/routes/api-keys.ts (new)
apps/web/src/components/settings/ApiKeysSettings.tsx (new)
apps/web/src/components/settings/SettingsModal.tsx (new)
apps/web/src/components/layout/TopBar.tsx (no change, already wired)
apps/web/src/app/c/[projectId]/page.tsx (render SettingsModal)
```

## Acceptance criteria

- [ ] User can add Anthropic, OpenAI, Google API keys
- [ ] Keys are validated (sk-ant- prefix, etc.)
- [ ] Keys are encrypted in DB (AES-256-GCM)
- [ ] Test button verifies key works
- [ ] User can replace/delete keys
- [ ] Keys are never displayed after saving (only last 4 chars)
- [ ] Settings modal opens from Settings icon
- [ ] Runtime uses BYO key when available (verified by sending a message)

## Verification

```bash
pnpm --filter @ladestack/api dev &
# 1. Open settings (Settings icon)
# 2. Add Anthropic key (use a real test key)
# 3. Click Test — should show "✓ Key works"
# 4. Check DB: api_keys.encrypted_key is base64 gibberish, not the raw key
# 5. Send a message — should work using the BYO key
kill %1
```

## Notes

- **The encryption key (`ENCRYPTION_KEY`) must be identical** in API and runtime `.env`. If they differ, decryption fails silently and you get auth errors.
- **The "Test" button makes a real API call.** It costs ~$0.0001 per test. Cheap but not free.
- **Format validation is lightweight.** Real key validation happens on first use. A "valid-looking" key that doesn't actually work will surface as an error during chat.
- **`upsert` with `onConflict`** uses the unique constraint `user_id, provider` (defined in prompt 04 migration).
- **The "Replace" button is intentional.** Users frequently rotate keys; explicit replace is better than deleting + re-adding.
- **No bulk import.** Users add keys one at a time. v1.1 adds env-var-based bulk import for power users.
- **Key hints (last 4 chars)** are stored in plaintext. They're safe to display (don't reveal enough to use the key).
- **The Anthropic SDK accepts keys via `x-api-key` header** — we don't pass keys via query string or body, which is the recommended approach.
- **OAuth flows (GitHub, Vercel) store tokens in plaintext** for MVP. Encrypt in v1.1 alongside BYO keys.
