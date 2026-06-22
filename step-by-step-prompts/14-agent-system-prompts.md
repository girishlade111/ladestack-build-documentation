# Prompt 14: Agent System Prompts (Real Content)

## Goal

Replace the stubbed `.txt` prompt files with the real content from `../prompt.md`. These are the system prompts that shape the AI's personality and behavior.

## Context (from prompts 01-13)

- All foundation, agents, tools, sessions, loop, plan mode, subagents, skills all built.
- Stubs exist at `packages/runtime/src/agents/prompts/*.txt`.
- `../prompt.md` in the parent folder has the real content for each prompt.

Reference: `../prompt.md` (full source — copy sections as-is).

## Task

For each prompt file below, **copy the verbatim content from `../prompt.md`** into the corresponding file at `packages/runtime/src/agents/prompts/`.

The `../prompt.md` file is structured as: code blocks tagged "File: `name.txt`" — extract each block and save to the matching file.

### Step 1: Copy `soul.txt`

Source: `../prompt.md` §"File: `soul.txt`"

Target: `packages/runtime/src/agents/prompts/soul.txt`

(The soul is the base personality. Inject this into every agent's prompt.)

### Step 2: Copy `build.txt`

Source: `../prompt.md` §"File: `build.txt`"

Target: `packages/runtime/src/agents/prompts/build.txt`

(The primary code-writing agent.)

### Step 3: Copy `plan.txt`

Source: `../prompt.md` §"File: `plan.txt`"

Target: `packages/runtime/src/agents/prompts/plan.txt`

(The read-only planning agent.)

### Step 4: Copy `explore.txt`

Source: `../prompt.md` §"File: `explore.txt`"

Target: `packages/runtime/src/agents/prompts/explore.txt`

### Step 5: Copy `scout.txt`

Source: `../prompt.md` §"File: `scout.txt`"

Target: `packages/runtime/src/agents/prompts/scout.txt`

### Step 6: Copy `summarize.txt`

Source: `../prompt.md` §"File: `summarize.txt`"

Target: `packages/runtime/src/agents/prompts/summarize.txt`

### Step 7: Copy `title.txt`

Source: `../prompt.md` §"File: `title.txt`"

Target: `packages/runtime/src/agents/prompts/title.txt`

### Step 8: Copy `environment.txt`

Source: `../prompt.md` §"File: `environment.txt`"

Target: `packages/runtime/src/agents/prompts/environment.txt`

(Note: this prompt has placeholders like `<DATE>`, `<PROJECT_NAME>` etc. The composer will substitute these at runtime — see step 11.)

### Step 9: Copy `tools.txt`

Source: `../prompt.md` §"File: `tools.txt`"

Target: `packages/runtime/src/agents/prompts/tools.txt`

(This is the reference doc the agent sees. The actual tool definitions come from the runtime, but the prose descriptions are stable.)

### Step 10: Verify all 9 files exist and have content

```bash
ls -la packages/runtime/src/agents/prompts/
wc -l packages/runtime/src/agents/prompts/*.txt
```

Expected:
- `soul.txt` (~30 lines)
- `build.txt` (~70 lines)
- `plan.txt` (~80 lines)
- `explore.txt` (~30 lines)
- `scout.txt` (~15 lines)
- `summarize.txt` (~50 lines)
- `title.txt` (~30 lines)
- `environment.txt` (~25 lines)
- `tools.txt` (~150 lines)

### Step 11: Update environment.txt rendering to substitute placeholders

`packages/runtime/src/agents/compose.ts` — update `renderEnvironment`:

```ts
function renderEnvironment(env: PromptContext["env"], sessionId: string): string {
  let template = loadPromptFile("environment")
  return template
    .replace(/<PLATFORM>/g, env.platform)
    .replace(/<NODE_VERSION>|<NODE>/g, env.nodeVersion)
    .replace(/<DATE>/g, env.today)
    .replace(/<PROJECT_NAME>/g, env.projectName)
    .replace(/<PROJECT_TYPE>/g, env.projectType)
    .replace(/<WORKING_DIRECTORY>|<CWD>/g, env.workingDirectory)
    .replace(/<DEFAULT_MODE>/g, env.defaultMode)
    .replace(/<DEFAULT_MODEL>/g, `${env.defaultModel.providerID}/${env.defaultModel.modelID}`)
    .replace(/<MODEL_ID>/g, env.defaultModel.modelID)
    .replace(/<SESSION_ID>/g, sessionId)
    .replace(/<SKILL_COUNT>/g, "0")  // TODO: dynamic
    .replace(/<SKILL_LIST>/g, "(none)")
    .replace(/<MCP_SERVER_COUNT>/g, "0")
}
```

### Step 12: Update composeSystemPrompt signature

```ts
export async function composeSystemPrompt(ctx: PromptContext): Promise<BuiltPrompt> {
  // ... existing code ...
  const envText = renderEnvironment(ctx.env, ctx.sessionId)
  // ... rest
}
```

### Step 13: Verify the soul loads correctly

Write a quick test:

`packages/runtime/src/agents/loader.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { loadPromptFile } from "./loader.js"

describe("prompt loader", () => {
  it("loads soul.txt with content", () => {
    const soul = loadPromptFile("soul")
    expect(soul).toContain("Lade")  // character name
    expect(soul.length).toBeGreaterThan(500)  // non-trivial
  })

  it("loads build.txt", () => {
    const build = loadPromptFile("build")
    expect(build).toContain("primary code-writing")
  })

  it("loads plan.txt", () => {
    const plan = loadPromptFile("plan")
    expect(plan).toContain("PLAN MODE")
  })

  it("returns empty string for missing file", () => {
    const missing = loadPromptFile("nonexistent")
    expect(missing).toBe("")
  })
})
```

### Step 14: Run the integration test

```bash
pnpm --filter @ladestack/runtime test
# expect: all tests pass
```

### Step 15: Commit

```bash
git add -A
git commit -m "feat(runtime): real system prompts (soul + 7 agents + env + tools) (prompt 14)"
```

## Files modified

```
packages/runtime/src/agents/prompts/
├── soul.txt (real content)
├── build.txt (real content)
├── plan.txt (real content)
├── explore.txt (real content)
├── scout.txt (real content)
├── summarize.txt (real content)
├── title.txt (real content)
├── environment.txt (real content, with placeholders)
└── tools.txt (real content, reference)

packages/runtime/src/agents/compose.ts (update renderEnvironment)
packages/runtime/src/agents/loader.test.ts (new)
```

## Acceptance criteria

- [ ] All 9 prompt files have real content (not stub)
- [ ] `soul.txt` mentions the Lade persona
- [ ] `build.txt` describes the primary code-writing agent
- [ ] `plan.txt` enforces PLAN MODE restrictions
- [ ] `environment.txt` has placeholders that get substituted
- [ ] `tools.txt` has descriptions for all 11 tools
- [ ] Compose produces valid system prompts
- [ ] Loader returns empty string for missing files (graceful fallback)
- [ ] All tests pass

## Verification

```bash
# Check file sizes
wc -l packages/runtime/src/agents/prompts/*.txt

# Run all tests
pnpm --filter @ladestack/runtime test

# Manual end-to-end: send a message and observe behavior
pnpm --filter @ladestack/api dev &
# (signup, create project, create session, send message)
# The response should reflect the soul's anti-sycophancy + build agent's directness
kill %1
```

## Notes

- **Don't modify the prompt content.** The text from `../prompt.md` is the canonical version. If you want to change it, update both this prompt's targets AND `../prompt.md` to keep them in sync.
- **The composer caches loaded prompts in memory.** If you change a `.txt` file, restart the runtime to pick it up.
- **`environment.txt` is dynamic** — every call substitutes placeholders. The other prompts are static (loaded once).
- **`tools.txt` is reference only.** The LLM sees tool descriptions in the `tools` section of the prompt (built dynamically from the registry). `tools.txt` is for human reading.
- **The `ask.txt` and `generate.txt` are still stubbed.** Fill them in if needed for v1.5.
- **Test that the soul loads first** — if it fails, every agent's prompt will be broken (no personality).
- **The "STRICTLY FORBIDDEN from starting with Great/Certainly/etc." rule** in the soul is critical for the LadeStack brand voice. Don't weaken it.
- **Plan mode tools restriction in `plan.txt`** is the second layer of defense (first is in `listToolsForAgent`). Both must agree.
