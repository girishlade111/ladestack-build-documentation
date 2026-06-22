# Prompt 06: LLM Provider Abstraction

## Goal

Build the provider layer that abstracts Anthropic, OpenAI, and Google Gemini behind a single interface, supports streaming, handles BYO API keys (encrypted), and computes cost.

## Context (from prompts 01-05)

- Monorepo + Next.js + Hono + Supabase + Daytona all wired up
- `packages/runtime/` has sandbox service; now needs LLM access

Reference: `../system-design.md` §2.6 (LLM provider layer), `../tool-calling.md` §3 (provider dispatch).

## Task

### Step 1: Install dependencies

```bash
cd packages/runtime
pnpm add @anthropic-ai/sdk openai @google/generative-ai
pnpm add token-cost  # cost calculation library
```

### Step 2: Define the provider interface

`packages/runtime/src/providers/types.ts`:

```ts
import { z } from "zod"

export const ModelIDSchema = z.string()  // e.g., "claude-sonnet-4-20250514"
export const ProviderIDSchema = z.enum(["anthropic", "openai", "google"])

export const ModelRefSchema = z.object({
  providerID: ProviderIDSchema,
  modelID: ModelIDSchema
})

export type ModelRef = z.infer<typeof ModelRefSchema>

export type ChatMessage =
  | { role: "user"; content: string | Array<{ type: "text"; text: string } | { type: "image"; source: { type: "base64"; media_type: string; data: string } }> }
  | { role: "assistant"; content: string; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string }

export interface ToolDefinition {
  name: string
  description: string
  input_schema: Record<string, unknown>  // JSON Schema
}

export interface ToolCall {
  id: string
  name: string
  input: unknown
}

export interface CompletionRequest {
  model: ModelRef
  messages: ChatMessage[]
  system?: string
  tools?: ToolDefinition[]
  temperature?: number
  maxTokens?: number
  stream: true
  signal?: AbortSignal
}

export type CompletionChunk =
  | { type: "text"; text: string }
  | { type: "tool_call"; toolCall: ToolCall }
  | { type: "usage"; tokensIn: number; tokensOut: number; costCents: number }
  | { type: "error"; error: { code: string; message: string } }
  | { type: "done"; stopReason: string }

export interface Provider {
  id: ProviderIDSchema
  complete(req: CompletionRequest, apiKey: string): AsyncIterable<CompletionChunk>
  listModels(): ModelInfo[]
}

export interface ModelInfo {
  id: string
  providerID: ProviderIDSchema
  displayName: string
  contextWindow: number
  costPer1kInputCents: number
  costPer1kOutputCents: number
  supportsTools: boolean
  supportsVision: boolean
}
```

### Step 3: Create the encryption helper for API keys

`packages/runtime/src/providers/encryption.ts`:

```ts
import { createCipheriv, createDecipheriv, randomBytes } from "crypto"

const ALG = "aes-256-gcm"
const KEY = Buffer.from(process.env.ENCRYPTION_KEY!, "hex")

if (KEY.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes (64 hex chars)")

export function encryptApiKey(plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALG, KEY, iv)
  const enc = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, enc, tag]).toString("base64")
}

export function decryptApiKey(ciphertext: string): string {
  const buf = Buffer.from(ciphertext, "base64")
  const iv = buf.subarray(0, 12)
  const enc = buf.subarray(12, buf.length - 16)
  const tag = buf.subarray(buf.length - 16)
  const decipher = createDecipheriv(ALG, KEY, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf-8")
}
```

### Step 4: Build the Anthropic provider

`packages/runtime/src/providers/anthropic.ts`:

```ts
import Anthropic from "@anthropic-ai/sdk"
import { log } from "../lib/logger.js"
import type { Provider, CompletionRequest, CompletionChunk, ModelInfo } from "./types.js"

const MODELS: ModelInfo[] = [
  { id: "claude-sonnet-4-20250514", providerID: "anthropic", displayName: "Claude Sonnet 4", contextWindow: 200000, costPer1kInputCents: 3, costPer1kOutputCents: 15, supportsTools: true, supportsVision: true },
  { id: "claude-3-5-haiku-20241022", providerID: "anthropic", displayName: "Claude 3.5 Haiku", contextWindow: 200000, costPer1kInputCents: 1, costPer1kOutputCents: 5, supportsTools: true, supportsVision: true }
]

export const anthropicProvider: Provider = {
  id: "anthropic",
  listModels: () => MODELS,
  async *complete(req: CompletionRequest, apiKey: string) {
    const client = new Anthropic({ apiKey })
    try {
      const stream = await client.messages.stream({
        model: req.model.modelID,
        system: req.system,
        messages: req.messages.map(normalizeMessage),
        tools: req.tools?.map(normalizeTool),
        temperature: req.temperature,
        max_tokens: req.maxTokens ?? 8192
      }, { signal: req.signal })

      let usage = { tokensIn: 0, tokensOut: 0 }
      for await (const event of stream) {
        if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
          yield { type: "tool_call", toolCall: { id: event.content_block.id, name: event.content_block.name, input: {} } }
        } else if (event.type === "content_block_delta") {
          if (event.delta.type === "text_delta") {
            yield { type: "text", text: event.delta.text }
          } else if (event.delta.type === "input_json_delta" && event.delta.partial_json) {
            // tool input delta — accumulate and yield at stop
            // For MVP, we collect and yield at end. See note below.
          }
        } else if (event.type === "message_delta" && event.usage) {
          usage.tokensOut = event.usage.output_tokens
        } else if (event.type === "message_start" && event.message.usage) {
          usage.tokensIn = event.message.usage.input_tokens
        }
      }

      const modelInfo = MODELS.find((m) => m.id === req.model.modelID)!
      const costCents = Math.ceil(
        (usage.tokensIn / 1000) * modelInfo.costPer1kInputCents +
        (usage.tokensOut / 1000) * modelInfo.costPer1kOutputCents
      )
      yield { type: "usage", tokensIn: usage.tokensIn, tokensOut: usage.tokensOut, costCents }
      yield { type: "done", stopReason: "end_turn" }
    } catch (err: any) {
      log.error({ err, model: req.model }, "anthropic error")
      yield { type: "error", error: { code: err.status?.toString() || "unknown", message: err.message } }
    }
  }
}

function normalizeMessage(m: any): any {
  if (m.role === "tool") return { role: "user", content: [{ type: "tool_result", tool_use_id: m.tool_call_id, content: m.content }] }
  return m
}

function normalizeTool(t: any): any {
  return { name: t.name, description: t.description, input_schema: t.input_schema }
}
```

### Step 5: Build the OpenAI provider

`packages/runtime/src/providers/openai.ts`:

```ts
import OpenAI from "openai"
import type { Provider, CompletionRequest, CompletionChunk, ModelInfo } from "./types.js"

const MODELS: ModelInfo[] = [
  { id: "gpt-4o", providerID: "openai", displayName: "GPT-4o", contextWindow: 128000, costPer1kInputCents: 2.5, costPer1kOutputCents: 10, supportsTools: true, supportsVision: true },
  { id: "gpt-4o-mini", providerID: "openai", displayName: "GPT-4o Mini", contextWindow: 128000, costPer1kInputCents: 0.15, costPer1kOutputCents: 0.6, supportsTools: true, supportsVision: true }
]

export const openaiProvider: Provider = {
  id: "openai",
  listModels: () => MODELS,
  async *complete(req: CompletionRequest, apiKey: string) {
    const client = new OpenAI({ apiKey })
    try {
      const stream = await client.chat.completions.create({
        model: req.model.modelID,
        messages: [
          ...(req.system ? [{ role: "system" as const, content: req.system }] : []),
          ...req.messages.map(normalizeMessage)
        ],
        tools: req.tools?.map((t) => ({
          type: "function" as const,
          function: { name: t.name, description: t.description, parameters: t.input_schema }
        })),
        temperature: req.temperature,
        max_tokens: req.maxTokens,
        stream: true
      }, { signal: req.signal })

      let usage = { tokensIn: 0, tokensOut: 0 }
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta
        if (delta?.content) yield { type: "text", text: delta.content }
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (tc.function?.name) {
              yield { type: "tool_call", toolCall: { id: tc.id, name: tc.function.name, input: {} } }
            }
          }
        }
        if (chunk.usage) {
          usage.tokensIn = chunk.usage.prompt_tokens
          usage.tokensOut = chunk.usage.completion_tokens
        }
      }

      const modelInfo = MODELS.find((m) => m.id === req.model.modelID)!
      const costCents = Math.ceil(
        (usage.tokensIn / 1000) * modelInfo.costPer1kInputCents +
        (usage.tokensOut / 1000) * modelInfo.costPer1kOutputCents
      )
      yield { type: "usage", tokensIn: usage.tokensIn, tokensOut: usage.tokensOut, costCents }
      yield { type: "done", stopReason: "end_turn" }
    } catch (err: any) {
      yield { type: "error", error: { code: err.status?.toString() || "unknown", message: err.message } }
    }
  }
}

function normalizeMessage(m: any): any {
  if (m.role === "assistant" && m.tool_calls) {
    return { role: "assistant", content: m.content, tool_calls: m.tool_calls }
  }
  if (m.role === "tool") return { role: "tool", tool_call_id: m.tool_call_id, content: m.content }
  return { role: m.role, content: m.content }
}
```

### Step 6: Build the Google provider

`packages/runtime/src/providers/google.ts`:

```ts
import { GoogleGenerativeAI } from "@google/generative-ai"
import type { Provider, CompletionRequest, CompletionChunk, ModelInfo } from "./types.js"

const MODELS: ModelInfo[] = [
  { id: "gemini-2.5-pro", providerID: "google", displayName: "Gemini 2.5 Pro", contextWindow: 1000000, costPer1kInputCents: 1.25, costPer1kOutputCents: 10, supportsTools: true, supportsVision: true },
  { id: "gemini-2.5-flash", providerID: "google", displayName: "Gemini 2.5 Flash", contextWindow: 1000000, costPer1kInputCents: 0.075, costPer1kOutputCents: 0.3, supportsTools: true, supportsVision: true }
]

export const googleProvider: Provider = {
  id: "google",
  listModels: () => MODELS,
  async *complete(req: CompletionRequest, apiKey: string) {
    const genai = new GoogleGenerativeAI(apiKey)
    const model = genai.getGenerativeModel({
      model: req.model.modelID,
      systemInstruction: req.system,
      tools: req.tools ? [{ functionDeclarations: req.tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.input_schema as any
      })) }] : undefined
    })
    try {
      // For MVP, use non-streaming and yield all at once. Streaming support is complex.
      const result = await model.generateContent({
        contents: req.messages.map(googleMessage),
        generationConfig: { temperature: req.temperature, maxOutputTokens: req.maxTokens }
      })
      const response = result.response
      const text = response.text()
      if (text) yield { type: "text", text }
      const usage = response.usageMetadata
      const modelInfo = MODELS.find((m) => m.id === req.model.modelID)!
      const tokensIn = usage?.promptTokenCount ?? 0
      const tokensOut = usage?.candidatesTokenCount ?? 0
      const costCents = Math.ceil(
        (tokensIn / 1000) * modelInfo.costPer1kInputCents +
        (tokensOut / 1000) * modelInfo.costPer1kOutputCents
      )
      yield { type: "usage", tokensIn, tokensOut, costCents }
      yield { type: "done", stopReason: "end_turn" }
    } catch (err: any) {
      yield { type: "error", error: { code: err.status?.toString() || "unknown", message: err.message } }
    }
  }
}

function googleMessage(m: any): any {
  if (m.role === "assistant") return { role: "model", parts: [{ text: m.content }] }
  if (m.role === "tool") return { role: "function", parts: [{ functionResponse: { name: m.name, response: { result: m.content } } }] }
  return { role: "user", parts: [{ text: m.content }] }
}
```

### Step 7: Build the registry

`packages/runtime/src/providers/registry.ts`:

```ts
import { anthropicProvider } from "./anthropic.js"
import { openaiProvider } from "./openai.js"
import { googleProvider } from "./google.js"
import type { Provider, ProviderIDSchema } from "./types.js"

const providers = new Map<string, Provider>([
  ["anthropic", anthropicProvider],
  ["openai", openaiProvider],
  ["google", googleProvider]
])

export function getProvider(id: ProviderIDSchema): Provider {
  const p = providers.get(id)
  if (!p) throw new Error(`unknown provider: ${id}`)
  return p
}

export function listAllModels() {
  const all: any[] = []
  for (const p of providers.values()) all.push(...p.listModels())
  return all
}
```

### Step 8: Build the key resolver

`packages/runtime/src/providers/keys.ts`:

```ts
import { supabaseAdmin } from "../db/client.js"
import { decryptApiKey } from "./encryption.js"
import { env } from "../env.js"
import type { ProviderIDSchema } from "./types.js"

export async function resolveApiKey(userId: string, provider: ProviderIDSchema): Promise<string> {
  // 1. Try user's BYO key
  const { data, error } = await supabaseAdmin
    .from("api_keys")
    .select("encrypted_key")
    .eq("user_id", userId)
    .eq("provider", provider)
    .single()

  if (data && !error) {
    return decryptApiKey(data.encrypted_key)
  }

  // 2. Fall back to managed key (paid users only — TODO check subscription)
  const fallback = getManagedKey(provider)
  if (!fallback) throw new Error(`no API key for ${provider}: user has no BYO key and no managed key available`)
  return fallback
}

function getManagedKey(provider: ProviderIDSchema): string | undefined {
  switch (provider) {
    case "anthropic": return env.ANTHROPIC_API_KEY
    case "openai": return env.OPENAI_API_KEY
    case "google": return env.GOOGLE_API_KEY
    default: return undefined
  }
}
```

### Step 9: Update runtime index

`packages/runtime/src/index.ts`:

```ts
export * from "./sandbox/types.js"
export * as sandbox from "./sandbox/daytona.js"
export * from "./sandbox/operations.js"
export * from "./providers/types.js"
export * from "./providers/anthropic.js"
export * from "./providers/openai.js"
export * from "./providers/google.js"
export * from "./providers/registry.js"
export * from "./providers/encryption.js"
export * from "./providers/keys.js"
export { log } from "./lib/logger.js"
```

### Step 10: Add `supabaseAdmin` import to runtime

The runtime needs DB access for API key lookup. Create `packages/runtime/src/db/client.ts`:

```ts
import { createClient } from "@supabase/supabase-js"
import { env } from "../env.js"  // <-- needs env.ts in runtime

export const supabaseAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
})
```

And `packages/runtime/src/env.ts` (mirror of API's env.ts):

```ts
import { z } from "zod"

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.string().default("info"),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_KEY: z.string(),
  ENCRYPTION_KEY: z.string().length(64),
  DAYTONA_API_KEY: z.string()
})

export const env = envSchema.parse(process.env)
```

Add to runtime `.env` (copy from API's):
```
SUPABASE_URL=...
SUPABASE_SERVICE_KEY=...
ENCRYPTION_KEY=...
DAYTONA_API_KEY=...
```

### Step 11: Write a test

`packages/runtime/src/providers/registry.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { getProvider, listAllModels } from "./registry.js"

describe("provider registry", () => {
  it("lists all models", () => {
    const models = listAllModels()
    expect(models.length).toBeGreaterThan(0)
    expect(models.find((m: any) => m.providerID === "anthropic")).toBeDefined()
    expect(models.find((m: any) => m.providerID === "openai")).toBeDefined()
    expect(models.find((m: any) => m.providerID === "google")).toBeDefined()
  })

  it("returns provider by ID", () => {
    expect(getProvider("anthropic").id).toBe("anthropic")
    expect(getProvider("openai").id).toBe("openai")
    expect(getProvider("google").id).toBe("google")
  })
})

describe("encryption", () => {
  it("round-trips", async () => {
    const { encryptApiKey, decryptApiKey } = await import("./encryption.js")
    const original = "sk-test-1234567890"
    const encrypted = encryptApiKey(original)
    expect(encrypted).not.toBe(original)
    const decrypted = decryptApiKey(encrypted)
    expect(decrypted).toBe(original)
  })
})
```

### Step 12: Commit

```bash
git add -A
git commit -m "feat(runtime): LLM provider abstraction (Anthropic + OpenAI + Google) with BYO key encryption (prompt 06)"
```

## Files created

```
packages/runtime/src/
├── env.ts
├── db/client.ts
├── providers/
│   ├── types.ts
│   ├── registry.ts
│   ├── encryption.ts
│   ├── keys.ts
│   ├── anthropic.ts
│   ├── openai.ts
│   ├── google.ts
│   ├── registry.test.ts
│   └── encryption.test.ts
```

## Acceptance criteria

- [ ] `pnpm --filter @ladestack/runtime typecheck` passes
- [ ] `pnpm --filter @ladestack/runtime test` passes (registry + encryption)
- [ ] `listAllModels()` returns 6 models (2 per provider)
- [ ] `encryptApiKey` → `decryptApiKey` round-trips
- [ ] Each provider has a `complete()` generator that yields typed chunks
- [ ] Tool calls are yielded as separate chunks
- [ ] Usage chunks include accurate token counts + cost

## Verification

```bash
pnpm --filter @ladestack/runtime test
# expect: 3 tests pass (registry, encryption, integration if API key set)
```

Manual integration test (requires real API keys):
```bash
export ANTHROPIC_API_KEY=sk-...
export ENCRYPTION_KEY=$(openssl rand -hex 32)
cd packages/runtime
node --input-type=module -e "
import { anthropicProvider } from './src/providers/anthropic.js';
const stream = anthropicProvider.complete({
  model: { providerID: 'anthropic', modelID: 'claude-3-5-haiku-20241022' },
  messages: [{ role: 'user', content: 'Say hello in 5 words' }],
  stream: true
}, process.env.ANTHROPIC_API_KEY);
for await (const chunk of stream) console.log(chunk);
"
# expect: text chunks, usage chunk, done chunk
```

## Notes

- **Don't stream Google yet** — the streaming API is more complex. For MVP, use non-streaming and yield all-at-once. v1.5 can add proper streaming.
- **Tool call input accumulation** is incomplete in the Anthropic provider. The `input_json_delta` events are not yet aggregated into a final tool call. For MVP, accept that tool inputs may be empty or incomplete from streaming — fall back to non-streaming for tool-heavy requests. v1.1 fixes this properly.
- **Cost is approximate.** Real Anthropic/OpenAI billing may differ by a few cents. Don't promise exact cost to users.
- **Managed key fallback** is gated on subscription tier. For MVP, allow it for everyone (you eat the cost). Add tier gating in prompt 24 (billing).
- **ENCRYPTION_KEY** must be 32 bytes (64 hex chars). Generate with `openssl rand -hex 32`.
- **Never log API keys.** The provider code should NEVER include the key in error messages or logs.
- **The provider layer is the most error-prone part of the system.** Add retry logic with exponential backoff in v1.1 (not MVP).
