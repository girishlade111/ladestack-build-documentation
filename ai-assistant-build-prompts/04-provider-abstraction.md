# Prompt 04: Multi-Provider LLM Abstraction

## Goal

Build a unified LLM provider layer that maps `(providerID, modelID)` → a Vercel AI SDK `LanguageModelV2`, exposing 500+ models across **Anthropic, OpenAI, Google, OpenRouter, Groq, Mistral, xAI, DeepSeek, and Amazon Bedrock**. Track token usage + cost per call, support a fallback chain on failure, and persist conversation messages via the AI SDK's `streamText`/`generateText` primitives — mirroring Kilo Code's `packages/opencode/src/provider/`.

## Context (from prompts 01-03)

- Monorepo bootstrapped (prompt 01); `packages/{cli,server,runtime,sdk}` exist.
- CLI + HTTP server work (prompt 02); `kilo run` calls a stubbed `runSession`.
- `packages/runtime/package.json` already declares `ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`, `zod` (from prompt 02 § Step 7).
- Config schema `ModelRefSchema = { providerID, modelID }` exists at `packages/runtime/src/config/schema.ts`.
- BYOK stubs at `packages/runtime/src/auth.ts` (real impl comes in prompt 05).

References:
- `../../02-competitive-research.md` §3 — Kilo Code provider list (Anthropic / OpenAI / Google / OpenRouter / Bedrock / Azure / GitHub Copilot / Vertex)
- `../../03-system-architecture.md` §4 — provider resolution + cost tracking
- Real Kilo source: `kilocode-clone/packages/opencode/src/provider/{provider,schema,models,model-cache,error}.ts`

The previous prompts stubbed `runSession` with `process.exit(1)`. After this prompt, the stub will still exit (the actual agent loop is prompt 15) — but **the provider layer is fully usable from any code that calls it directly**.

## Task

### Step 1: Install Vercel AI SDK provider packages

```bash
cd packages/runtime && bun add ai@^5.0.0
bun add @ai-sdk/anthropic @ai-sdk/openai @ai-sdk/google
bun add @ai-sdk/openai-compatible
bun add @ai-sdk/groq @ai-sdk/mistral @ai-sdk/xai
bun add @openrouter/ai-sdk-provider
bun add @ai-sdk/amazon-bedrock
```

If a package isn't on the registry yet (e.g. no first-party `@ai-sdk/deepseek`), use `@ai-sdk/openai-compatible` and configure `baseURL: "https://api.deepseek.com"` — that's what Kilo Code does for less-common providers. The full provider list lives in `providers.ts` and is driven by config, not by hard-coded SDK packages.

### Step 2: Provider ID enum

`packages/runtime/src/provider/ids.ts`:

```ts
import { z } from "zod"

// Match Kilo's ProviderID list — extend as the AI SDK ecosystem grows.
// Listed in (rough) order of preference: official first-party SDKs first.
export const PROVIDER_IDS = [
  "anthropic",
  "openai",
  "google",
  "openrouter",
  "groq",
  "mistral",
  "xai",
  "deepseek",
  "bedrock",
] as const

export type ProviderID = (typeof PROVIDER_IDS)[number]

export const ProviderIDSchema = z.enum(PROVIDER_IDS)

// Human-friendly labels for UI
export const PROVIDER_LABELS: Record<ProviderID, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google AI",
  openrouter: "OpenRouter",
  groq: "Groq",
  mistral: "Mistral",
  xai: "xAI (Grok)",
  deepseek: "DeepSeek",
  bedrock: "Amazon Bedrock",
}
```

The list intentionally omits `azure`, `github-copilot`, `google-vertex` — those need extra setup and are v1.1. Tracked in `Notes`.

### Step 3: Provider-specific factory functions

`packages/runtime/src/provider/factories.ts`:

```ts
import type { LanguageModelV2 } from "@ai-sdk/provider"
import type { ProviderID } from "./ids.js"

// Each factory returns an async function (modelID) => LanguageModelV2.
// Kept as factories (not bound SDKs) so dynamic import + lazy load works.
//
// We never throw at import time — every SDK is dynamically imported so
// missing/uninstalled providers don't crash startup.

type Factory = (apiKey: string, opts?: { baseURL?: string; region?: string }) =>
  (modelID: string) => LanguageModelV2

export const PROVIDER_FACTORIES: Record<ProviderID, Factory> = {
  anthropic: (key, opts) => {
    return async (modelID) => {
      const { createAnthropic } = await import("@ai-sdk/anthropic")
      const anthropic = createAnthropic({
        apiKey: key,
        baseURL: opts?.baseURL,
        headers: {
          // Match Kilo's defaults — interleaved thinking + fine-grained tool streaming.
          "anthropic-beta":
            "interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14",
        },
      })
      return anthropic(modelID)
    }
  },

  openai: (key, opts) => {
    return async (modelID) => {
      const { createOpenAI } = await import("@ai-sdk/openai")
      const openai = createOpenAI({ apiKey: key, baseURL: opts?.baseURL })
      // Use the responses API for gpt-5+ models; chat for older ones.
      const useResponses = /^gpt-5/.test(modelID) && !modelID.startsWith("gpt-5-mini")
      return useResponses ? openai.responses(modelID) : openai.chat(modelID)
    }
  },

  google: (key, opts) => {
    return async (modelID) => {
      const { createGoogleGenerativeAI } = await import("@ai-sdk/google")
      const google = createGoogleGenerativeAI({ apiKey: key, baseURL: opts?.baseURL })
      return google(modelID)
    }
  },

  openrouter: (key, opts) => {
    return async (modelID) => {
      const { createOpenRouter } = await import("@openrouter/ai-sdk-provider")
      const openrouter = createOpenRouter({
        apiKey: key,
        baseURL: opts?.baseURL,
        headers: {
          "HTTP-Referer": "https://ladestack.dev/kilo",
          "X-Title": "LadeStack Kilo Assistant",
        },
      })
      return openrouter(modelID)
    }
  },

  groq: (key, opts) => {
    return async (modelID) => {
      const { createGroq } = await import("@ai-sdk/groq")
      const groq = createGroq({ apiKey: key, baseURL: opts?.baseURL })
      return groq(modelID)
    }
  },

  mistral: (key, opts) => {
    return async (modelID) => {
      const { createMistral } = await import("@ai-sdk/mistral")
      const mistral = createMistral({ apiKey: key, baseURL: opts?.baseURL })
      return mistral(modelID)
    }
  },

  xai: (key, opts) => {
    return async (modelID) => {
      const { createXai } = await import("@ai-sdk/xai")
      const xai = createXai({ apiKey: key, baseURL: opts?.baseURL })
      return xai.responses(modelID)
    }
  },

  deepseek: (key, opts) => {
    // No first-party DeepSeek SDK; use OpenAI-compat pointing at DeepSeek's API.
    return async (modelID) => {
      const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible")
      const ds = createOpenAICompatible({
        name: "deepseek",
        apiKey: key,
        baseURL: opts?.baseURL ?? "https://api.deepseek.com",
      })
      return ds.chatModel(modelID)
    }
  },

  bedrock: (key, opts) => {
    return async (modelID) => {
      const { createAmazonBedrock } = await import("@ai-sdk/amazon-bedrock")
      // Bedrock uses AWS credentials, not a single API key. We accept the
      // encoded "key" as either AWS_BEARER_TOKEN_BEDROCK or a JSON blob of
      // { region, accessKeyId, secretAccessKey }. See prompt 05 for encoding.
      const region = opts?.region ?? "us-east-1"
      const bedrock = createAmazonBedrock({
        region,
        // If key starts with "AKIA" assume access-key pair, else bearer token.
        ...(key.startsWith("AKIA")
          ? {
              accessKeyId: process.env["AWS_ACCESS_KEY_ID"]!,
              secretAccessKey: process.env["AWS_SECRET_ACCESS_KEY"]!,
              sessionToken: process.env["AWS_SESSION_TOKEN"],
            }
          : { apiKey: key }),
      })
      return bedrock(modelID)
    }
  },
}
```

### Step 4: Curated model registry (default costs)

`packages/runtime/src/provider/registry.ts`:

```ts
import type { ProviderID } from "./ids.js"

export type ModelInfo = {
  id: string
  providerID: ProviderID
  // Cost in USD per 1M tokens. null = unknown / dynamic (e.g. OpenRouter).
  cost: { input: number; output: number } | null
  // Context window in tokens. null = unknown.
  contextWindow: number | null
  // Whether the model supports tool/function calling.
  toolCalls: boolean
  // Whether the model supports image (vision) inputs.
  images: boolean
  // Whether the model can reason step-by-step (o1, claude-thinking, deepseek-r1).
  reasoning: boolean
}

export const DEFAULT_MODELS: ModelInfo[] = [
  // Anthropic
  { id: "claude-sonnet-4-5",        providerID: "anthropic", cost: { input: 3,    output: 15    }, contextWindow: 200_000, toolCalls: true,  images: true,  reasoning: true  },
  { id: "claude-opus-4-1",          providerID: "anthropic", cost: { input: 15,   output: 75    }, contextWindow: 200_000, toolCalls: true,  images: true,  reasoning: true  },
  { id: "claude-haiku-4-5",         providerID: "anthropic", cost: { input: 1,    output: 5     }, contextWindow: 200_000, toolCalls: true,  images: true,  reasoning: false },
  { id: "claude-3-5-sonnet-20241022", providerID: "anthropic", cost: { input: 3,  output: 15    }, contextWindow: 200_000, toolCalls: true,  images: true,  reasoning: false },

  // OpenAI
  { id: "gpt-5",          providerID: "openai", cost: { input: 5,    output: 20    }, contextWindow: 400_000, toolCalls: true,  images: true,  reasoning: true  },
  { id: "gpt-5-mini",     providerID: "openai", cost: { input: 0.5,  output: 2     }, contextWindow: 400_000, toolCalls: true,  images: true,  reasoning: true  },
  { id: "gpt-4o",         providerID: "openai", cost: { input: 2.5,  output: 10    }, contextWindow: 128_000, toolCalls: true,  images: true,  reasoning: false },
  { id: "o3",             providerID: "openai", cost: { input: 10,   output: 40    }, contextWindow: 200_000, toolCalls: true,  images: true,  reasoning: true  },
  { id: "o3-mini",        providerID: "openai", cost: { input: 1.1,  output: 4.4   }, contextWindow: 200_000, toolCalls: true,  images: false, reasoning: true  },

  // Google
  { id: "gemini-2.5-pro",   providerID: "google", cost: { input: 1.25, output: 10   }, contextWindow: 1_000_000, toolCalls: true, images: true, reasoning: true  },
  { id: "gemini-2.5-flash", providerID: "google", cost: { input: 0.075, output: 0.3 }, contextWindow: 1_000_000, toolCalls: true, images: true, reasoning: false },

  // Groq (fast inference)
  { id: "llama-3.3-70b-versatile",      providerID: "groq", cost: { input: 0.59, output: 0.79 }, contextWindow: 128_000, toolCalls: true, images: false, reasoning: false },
  { id: "llama-3.1-8b-instant",         providerID: "groq", cost: { input: 0.05, output: 0.08 }, contextWindow: 128_000, toolCalls: true, images: false, reasoning: false },
  { id: "openai/gpt-oss-120b",          providerID: "groq", cost: { input: 0.15, output: 0.6  }, contextWindow: 128_000, toolCalls: true, images: false, reasoning: true  },

  // Mistral
  { id: "mistral-large-latest", providerID: "mistral", cost: { input: 2,  output: 6  }, contextWindow: 128_000, toolCalls: true,  images: false, reasoning: false },
  { id: "codestral-latest",     providerID: "mistral", cost: { input: 0.3, output: 0.9 }, contextWindow: 32_000,  toolCalls: true,  images: false, reasoning: false },

  // xAI
  { id: "grok-4",         providerID: "xai", cost: { input: 5,  output: 15  }, contextWindow: 256_000, toolCalls: true,  images: true, reasoning: false },
  { id: "grok-3-mini",    providerID: "xai", cost: { input: 0.3, output: 0.5 }, contextWindow: 256_000, toolCalls: true, images: false, reasoning: true },

  // DeepSeek
  { id: "deepseek-chat",     providerID: "deepseek", cost: { input: 0.14, output: 0.28 }, contextWindow: 64_000, toolCalls: true,  images: false, reasoning: false },
  { id: "deepseek-reasoner", providerID: "deepseek", cost: { input: 0.55, output: 2.19 }, contextWindow: 64_000, toolCalls: false, images: false, reasoning: true  },

  // OpenRouter — cost is null because it's per-model, fetched dynamically.
  { id: "anthropic/claude-sonnet-4-5", providerID: "openrouter", cost: null, contextWindow: 200_000, toolCalls: true, images: true, reasoning: true },
]

// Index for O(1) lookup: `${providerID}/${modelID}` -> ModelInfo
const modelIndex = new Map<string, ModelInfo>(
  DEFAULT_MODELS.map((m) => [`${m.providerID}/${m.id}`, m])
)

export function getModelInfo(providerID: ProviderID, modelID: string): ModelInfo | undefined {
  return modelIndex.get(`${providerID}/${modelID}`)
}

export function listModels(providerID?: ProviderID): ModelInfo[] {
  return providerID ? DEFAULT_MODELS.filter((m) => m.providerID === providerID) : DEFAULT_MODELS
}

export function resolveModelString(ref: string): { providerID: ProviderID; modelID: string } | undefined {
  // Accepts "anthropic/claude-sonnet-4-5" or "claude-sonnet-4-5" (defaults to anthropic).
  const slash = ref.indexOf("/")
  if (slash === -1) return undefined
  const providerID = ref.slice(0, slash) as ProviderID
  if (!(providerID in PROVIDER_ID_LOOKUP)) return undefined
  return { providerID, modelID: ref.slice(slash + 1) }
}

// Tiny map used above; defined separately to avoid circular import.
import { PROVIDER_IDS } from "./ids.js"
const PROVIDER_ID_LOOKUP = Object.fromEntries(PROVIDER_IDS.map((p) => [p, true]))
```

This is a **curated starter set**. v1.1 will fetch a live catalog from `https://models.dev/api.json` (which Kilo Code uses) and merge.

### Step 5: API key resolution (lazy — defers real impl to prompt 05)

`packages/runtime/src/provider/keys.ts`:

```ts
import type { ProviderID } from "./ids.js"

// In prompt 05 this becomes a real resolver that:
//   1. Checks `kilo auth` keyring (~/.kilocode/keys/<provider>.enc)
//   2. Falls back to env vars (ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.)
//   3. Falls back to kilo.json provider.<id>.apiKey
//
// For now we only resolve env vars so prompt 04 can be tested standalone.

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

export function resolveApiKey(providerID: ProviderID): string | undefined {
  const vars = ENV_VAR_BY_PROVIDER[providerID]
  for (const v of vars) {
    const k = process.env[v]
    if (k && k.length > 0) return k
  }
  return undefined
}
```

### Step 6: Provider resolution — `getLanguageModel`

`packages/runtime/src/provider/resolve.ts`:

```ts
import type { LanguageModelV2 } from "@ai-sdk/provider"
import { PROVIDER_FACTORIES } from "./factories.js"
import { resolveApiKey } from "./keys.js"
import { getModelInfo, resolveModelString } from "./registry.js"
import type { ProviderID } from "./ids.js"

export class ProviderError extends Error {
  constructor(public readonly code:
    | "missing_api_key"
    | "unknown_provider"
    | "unknown_model"
    | "load_failed",
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message)
    this.name = "ProviderError"
  }
}

export async function getLanguageModel(ref: string | { providerID: ProviderID; modelID: string }): Promise<LanguageModelV2> {
  const resolved = typeof ref === "string" ? resolveModelString(ref) : ref
  if (!resolved) {
    throw new ProviderError("unknown_model",
      `Unknown model reference: ${typeof ref === "string" ? ref : JSON.stringify(ref)}. Expected "providerID/modelID".`,
    )
  }

  const { providerID, modelID } = resolved
  const factory = PROVIDER_FACTORIES[providerID]
  if (!factory) {
    throw new ProviderError("unknown_provider", `Unknown provider: ${providerID}`)
  }

  const apiKey = resolveApiKey(providerID)
  if (!apiKey) {
    throw new ProviderError("missing_api_key",
      `No API key for provider "${providerID}". Set the env var or run: kilo auth ${providerID} <key>`,
    )
  }

  try {
    const builder = factory(apiKey, { baseURL: process.env[`${providerID.toUpperCase()}_BASE_URL`] })
    const model = await builder(modelID)
    return model
  } catch (err) {
    throw new ProviderError("load_failed", `Failed to load ${providerID}/${modelID}: ${err}`, err)
  }
}

/**
 * The most useful helper for downstream code: pass the raw user string
 * "anthropic/claude-sonnet-4-5" and get back a model, or a typed error.
 */
export async function requireLanguageModel(ref: string): Promise<LanguageModelV2> {
  return getLanguageModel(ref)
}
```

### Step 7: Cost + usage tracking

`packages/runtime/src/provider/usage.ts`:

```ts
import type { LanguageModelUsage } from "ai"
import { getModelInfo } from "./registry.js"
import type { ProviderID } from "./ids.js"

export type CostEstimate = {
  inputTokens: number
  outputTokens: number
  inputCostUsd: number
  outputCostUsd: number
  totalCostUsd: number
  // true if cost was based on our curated table; false if cost unknown (model not in registry).
  known: boolean
}

/**
 * Estimate USD cost from token counts. Returns `known: false` if the model
 * isn't in the curated registry (e.g. dynamic OpenRouter models).
 */
export function estimateCost(
  providerID: ProviderID,
  modelID: string,
  usage: Pick<LanguageModelUsage, "inputTokens" | "outputTokens">,
): CostEstimate {
  const info = getModelInfo(providerID, modelID)
  const input = usage.inputTokens ?? 0
  const output = usage.outputTokens ?? 0

  if (!info?.cost) {
    return { inputTokens: input, outputTokens: output, inputCostUsd: 0, outputCostUsd: 0, totalCostUsd: 0, known: false }
  }

  // Costs in registry are per 1M tokens.
  const inputCost = (input / 1_000_000) * info.cost.input
  const outputCost = (output / 1_000_000) * info.cost.output
  return {
    inputTokens: input,
    outputTokens: output,
    inputCostUsd: inputCost,
    outputCostUsd: outputCost,
    totalCostUsd: inputCost + outputCost,
    known: true,
  }
}

export function formatCost(c: CostEstimate): string {
  if (!c.known) return `$${c.totalCostUsd.toFixed(4)} (cost unknown — model not in registry)`
  return `$${c.totalCostUsd.toFixed(6)} (in: $${c.inputCostUsd.toFixed(6)}, out: $${c.outputCostUsd.toFixed(6)})`
}
```

### Step 8: `streamText` wrapper with kilo-specific defaults

`packages/runtime/src/provider/stream.ts`:

```ts
import { streamText, type StreamTextOptions, type LanguageModelUsage } from "ai"
import type { LanguageModelV2 } from "@ai-sdk/provider"
import { getLanguageModel } from "./resolve.js"
import { estimateCost, type CostEstimate } from "./usage.js"
import type { ProviderID } from "./ids.js"

export type StreamOptions = Omit<
  StreamTextOptions<any, any>,
  "model" | "experimental_telemetry"
> & {
  model: string | { providerID: ProviderID; modelID: string }
  // Optional fallback chain: tried in order if primary fails.
  fallbacks?: Array<string | { providerID: ProviderID; modelID: string }>
  // If true, log cost to stderr on each completion.
  logCost?: boolean
}

/**
 * Thin wrapper around AI SDK streamText that:
 *   1. Resolves the model string to a LanguageModelV2.
 *   2. Adds kilo telemetry headers.
 *   3. On failure, walks the fallback chain (if any).
 *   4. Reports token usage + cost via a callback.
 */
export async function* streamWithFallback(opts: StreamOptions) {
  const refs = [opts.model, ...(opts.fallbacks ?? [])]
  let lastErr: unknown

  for (const ref of refs) {
    try {
      const model = await getLanguageModel(ref)
      const result = streamText({
        ...opts,
        model,
        experimental_telemetry: {
          isEnabled: true,
          functionId: "kilo.stream",
          metadata: {
            "kilo.model": typeof ref === "string" ? ref : `${ref.providerID}/${ref.modelID}`,
            "kilo.sessionID": (opts as any).experimental_providerMetadata?.sessionID ?? "unknown",
          },
        },
      })

      // Forward the full stream + capture usage.
      let usage: LanguageModelUsage | undefined
      for await (const chunk of result.fullStream) {
        if (chunk.type === "finish") {
          usage = (chunk as any).usage
        }
        yield chunk
      }

      // Log cost on completion.
      if (usage && opts.logCost !== false) {
        const resolved = typeof ref === "string"
          ? { providerID: ref.split("/")[0] as ProviderID, modelID: ref.split("/").slice(1).join("/") }
          : ref
        const cost = estimateCost(resolved.providerID, resolved.modelID, usage)
        if (process.env["KILO_DEBUG"] === "1") {
          console.error(`[kilo] model=${resolved.providerID}/${resolved.modelID} cost=${formatCostInline(cost)}`)
        }
        // Yield a synthetic chunk so callers can observe the final cost.
        yield { type: "kilo-cost", providerID: resolved.providerID, modelID: resolved.modelID, usage, cost }
      }
      return // success — stop walking fallback chain
    } catch (err) {
      lastErr = err
      if (process.env["KILO_DEBUG"] === "1") {
        console.error(`[kilo] fallback triggered for ${typeof ref === "string" ? ref : ref.providerID + "/" + ref.modelID}: ${err}`)
      }
      // continue to next fallback
    }
  }

  throw lastErr ?? new Error("No models provided")
}

function formatCostInline(c: CostEstimate): string {
  return c.known ? `$${c.totalCostUsd.toFixed(6)}` : `$${c.totalCostUsd.toFixed(6)} (unknown)`
}
```

### Step 9: Public barrel

`packages/runtime/src/provider/index.ts`:

```ts
export * from "./ids.js"
export * from "./registry.js"
export * from "./resolve.js"
export * from "./usage.js"
export * from "./stream.js"
export { PROVIDER_FACTORIES } from "./factories.js"
export { resolveApiKey } from "./keys.js"
export { ProviderError } from "./resolve.js"
```

And wire into `packages/runtime/src/index.ts`:

```ts
export * from "./config/schema.js"
export * from "./config/loader.js"
export * from "./discovery/index.js"
export * from "./provider/index.js"
export * as config from "./config/loader.js"
export * as provider from "./provider/index.js"
```

### Step 10: Commit

```bash
git add -A
git commit -m "feat(provider): multi-provider LLM layer (anthropic/openai/google/etc) (prompt 04)"
```

## Files created

```
packages/runtime/src/provider/
├── ids.ts           # ProviderID enum + labels
├── factories.ts     # Per-provider SDK factories (dynamic import)
├── registry.ts      # Curated model table + cost
├── keys.ts          # Env-var resolver (BYOK impl in prompt 05)
├── resolve.ts       # getLanguageModel(ref) + ProviderError
├── usage.ts         # Token → USD cost + formatting
├── stream.ts        # streamText wrapper + fallback chain
└── index.ts         # Barrel export
```

Plus 2 lines added to `packages/runtime/src/index.ts`.

## Acceptance criteria

- [ ] `bun run typecheck` passes
- [ ] `getLanguageModel("anthropic/claude-sonnet-4-5")` returns a `LanguageModelV2` (or throws `ProviderError("missing_api_key")` if no key set)
- [ ] `getLanguageModel("garbage/whatever")` throws `ProviderError("unknown_model")`
- [ ] `getLanguageModel("unknownProvider/foo")` throws `ProviderError("unknown_provider")`
- [ ] `estimateCost("anthropic", "claude-sonnet-4-5", { inputTokens: 1_000_000, outputTokens: 500_000 })` returns `{ totalCostUsd: 10.5, known: true, ... }` (1M × $3 + 500k × $15)
- [ ] `estimateCost("openrouter", "anthropic/claude-sonnet-4-5", ...)` returns `{ known: false, totalCostUsd: 0 }`
- [ ] `listModels("anthropic")` returns 4 Anthropic entries; `listModels()` returns 25+ entries
- [ ] With `KILO_DEBUG=1` set, calling `streamWithFallback` logs cost on completion
- [ ] Fallback chain works: if primary `anthropic/claude-sonnet-4-5` fails (bad key), the call transparently retries the next ref
- [ ] `resolveApiKey("anthropic")` returns `process.env.ANTHROPIC_API_KEY` if set
- [ ] Missing SDK packages don't crash startup (dynamic import wrapped in try/catch)

## Verification

```bash
cd kilocode-assistant
bun install
bun run typecheck

# Test env-var resolution
ANTHROPIC_API_KEY=sk-test-1 OPENAI_API_KEY=sk-test-2 bun --eval '
import { resolveApiKey, getModelInfo, estimateCost } from "@kilocode/runtime/provider"
console.log(resolveApiKey("anthropic"))     // sk-test-1
console.log(resolveApiKey("openai"))        // sk-test-2
console.log(resolveApiKey("nonexistent"))   // undefined
console.log(getModelInfo("anthropic", "claude-sonnet-4-5")?.cost)  // { input: 3, output: 15 }
console.log(estimateCost("anthropic", "claude-sonnet-4-5", { inputTokens: 1_000_000, outputTokens: 0 }).totalCostUsd)  // 3
console.log(estimateCost("anthropic", "claude-sonnet-4-5", { inputTokens: 0, outputTokens: 1_000_000 }).totalCostUsd)  // 15
'

# Test stream fallback (this needs a valid key; the error path is more important)
ANTHROPIC_API_KEY=invalid-key bun --eval '
import { streamWithFallback } from "@kilocode/runtime/provider"
const out = streamWithFallback({
  model: "anthropic/claude-sonnet-4-5",
  fallbacks: ["openai/gpt-4o"],
  prompt: "say hi",
  logCost: false,
})
try {
  for await (const c of out) console.log(c.type ?? c)
} catch (e) {
  console.error("both failed:", e.message.slice(0, 80))
}
'
```

You should see the first call fail with 401, then the fallback to OpenAI either succeed or fail with its own error — proving the fallback chain is wired.

## Notes

- **Dynamic imports** for every SDK — `await import("@ai-sdk/anthropic")`. This keeps startup fast (~50ms cold) and lets the binary work even if you uninstall a provider package. Cost: ~10ms cold-start per provider on first call.
- **Why no `models.dev` fetch?** v1 ships with curated pricing. v1.1 fetches `https://models.dev/api.json` on first run, caches in `~/.kilocode/models-cache.json` for 24h, and merges dynamic models. That mirrors what Kilo does (`packages/opencode/src/provider/model-cache.ts`).
- **`responses` vs `chat`** — OpenAI's `gpt-5` and xAI's `grok-4` use the `responses` API; older models use `chat`. The factory detects this from the model ID. If you forget to add a new pattern, the AI SDK throws a clean error — fix in `factories.ts`.
- **Bedrock credentials** — we accept either a bearer token (`AWS_BEARER_TOKEN_BEDROCK`) or a JSON-encoded `{accessKeyId, secretAccessKey, sessionToken}` blob (saved via `kilo auth bedrock <json>` in prompt 05). Real IAM-role assumption (no env vars) is a separate task using `@aws-sdk/credential-providers`.
- **`experimental_telemetry`** in `streamText` sends token + cost data to whatever OTLP endpoint you configure via `OTEL_EXPORTER_OTLP_ENDPOINT`. Off by default; set `KILO_TELEMETRY=1` to enable.
- **Cost table drift** — Anthropic, OpenAI, and Google change prices ~every 6 months. The `provider:cost:refresh` admin command (v1.1) re-syncs from `models.dev`.
- **Provider list is not exhaustive** — Kilo Code supports 14+ providers including Azure, GitHub Copilot, Google Vertex, and GitLab. Add them in `ids.ts` + `factories.ts` + `registry.ts` when you need them. The schema in `config/schema.ts` already allows them.
- **Why not implement `runSession`?** That wires together prompts, tools, and the provider — that's prompt 15's job. This prompt delivers a provider layer you can call directly.
- **Why a fallback chain?** Real users hit rate limits, billing errors, and provider outages. A `fallbacks: ["openai/gpt-4o"]` in `kilo.json` lets the agent keep working when Claude is down.
- **Token counting** — AI SDK reports `promptTokens` and `completionTokens` (which we map to `inputTokens`/`outputTokens`). Cache-read tokens are reported separately; we don't discount them yet (v1.1).