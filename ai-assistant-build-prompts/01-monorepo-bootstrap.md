# Prompt 01: Monorepo Bootstrap

## Goal

Initialize a Bun + TypeScript + Effect framework monorepo at `kilocode-assistant/` with Turborepo, lint/format/typecheck tooling, and the package skeleton that matches Kilo Code's structure.

## Context (greenfield)

You are starting fresh. The parent folder has the design docs you should skim for architecture:

- `../../00-README.md` — project overview
- `../../02-competitive-research.md` §3 — Kilo Code repo layout to replicate
- `../../03-system-architecture.md` — runtime architecture
- `../../07-ai-skill-definition.md` — portable skill format
- `../../08-system-prompts.md` — agent prompts (later prompts)

You do NOT need to read these to do this prompt. They are context for prompts 02+.

## Task

### Step 1: Create the root

```bash
mkdir kilocode-assistant && cd kilocode-assistant
bun init  # creates package.json with type: module
```

### Step 2: Install root dev dependencies

```bash
bun add -d typescript turbo @types/node @types/bun
bun add -d oxlint oxfmt
bun add -d @changesets/cli
bun add -d effect
```

### Step 3: Create `package.json` (extend `bun init` output)

```json
{
  "name": "kilocode-assistant",
  "private": true,
  "type": "module",
  "packageManager": "bun@1.3.14",
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",
    "lint": "oxlint",
    "format": "oxfmt",
    "typecheck": "bun turbo typecheck",
    "test": "bun test",
    "clean": "turbo run clean && rm -rf node_modules bun.lockb"
  },
  "engines": { "bun": ">=1.3.0" }
}
```

### Step 4: Create `bunfig.toml`

```toml
[install]
exact = false
```

### Step 5: Create `turbo.json`

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "dev": { "cache": false, "persistent": true },
    "lint": { "outputs": [] },
    "typecheck": { "dependsOn": ["^build"], "outputs": [] },
    "test": { "outputs": ["coverage/**"] },
    "clean": { "cache": false }
  }
}
```

### Step 6: Create `tsconfig.base.json`

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ESNext"],
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "strict": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": false,
    "types": ["bun"]
  }
}
```

### Step 7: Create `oxlintrc.json`

```json
{
  "categories": {
    "correctness": "error",
    "suspicious": "error",
    "perf": "warn",
    "style": "warn"
  },
  "rules": {
    "no-unused-vars": "error",
    "no-console": "off"
  }
}
```

### Step 8: Create `.gitignore`

```
node_modules/
dist/
build/
.turbo/
*.log
.env
.env.local
.DS_Store
.idea/
.vscode/
coverage/
```

### Step 9: Create the package directory skeleton

```bash
mkdir -p packages/cli packages/server packages/runtime packages/sdk
mkdir -p packages/runtime/src packages/cli/src packages/server/src packages/sdk/src
```

Stub each `package.json`:

`packages/cli/package.json`:
```json
{
  "name": "@kilocode/cli",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "main": "./src/index.ts",
  "scripts": { "dev": "bun run --watch src/index.ts", "build": "bun build src/index.ts --outdir dist --target bun" }
}
```

`packages/server/package.json`:
```json
{ "name": "@kilocode/server", "private": true, "version": "0.0.0", "type": "module", "main": "./src/index.ts" }
```

`packages/runtime/package.json`:
```json
{ "name": "@kilocode/runtime", "private": true, "version": "0.0.0", "type": "module", "main": "./src/index.ts" }
```

`packages/sdk/package.json`:
```json
{ "name": "@kilocode/sdk", "private": true, "version": "0.0.0", "type": "module", "main": "./src/index.ts" }
```

### Step 10: Create `tsconfig.json` at root

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "paths": {
      "@kilocode/cli": ["./packages/cli/src/index.ts"],
      "@kilocode/server": ["./packages/server/src/index.ts"],
      "@kilocode/runtime": ["./packages/runtime/src/index.ts"],
      "@kilocode/sdk": ["./packages/sdk/src/index.ts"]
    }
  },
  "include": ["packages/*/src/**/*"]
}
```

### Step 11: Create `.changeset/config.json`

```json
{
  "$schema": "https://unpkg.com/@changesets/config@2.3.0/schema.json",
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "linked": []
}
```

### Step 12: Initial commit

```bash
git init -b main
git add -A
git commit -m "chore: bootstrap monorepo (prompt 01)"
```

## Files created

```
kilocode-assistant/
├── packages/{cli,server,runtime,sdk}/package.json
├── bunfig.toml
├── package.json
├── turbo.json
├── tsconfig.json
├── tsconfig.base.json
├── oxlintrc.json
├── .gitignore
└── .changeset/config.json
```

## Acceptance criteria

- [ ] `bun install` succeeds
- [ ] `bun run typecheck` runs and exits 0 (vacuous — no source yet)
- [ ] `bun run lint` runs and exits 0
- [ ] `bun run build` succeeds (vacuously)
- [ ] 4 package directories exist with stub `package.json`s
- [ ] Git initialized with initial commit

## Verification

```bash
cd kilocode-assistant
bun install
bun run typecheck
bun run lint
ls packages/
git log --oneline
```

All should succeed without errors.

## Notes

- **Bun over Node** — Kilo Code uses Bun. Stick with it. Faster, native TS, built-in test runner.
- **Effect framework** is imported but not used yet. Prompt 02 wires it up.
- **`type: "module"` everywhere** — pure ESM. No CommonJS.
- **Turborepo + Bun workspaces** is the standard monorepo combo. Both are fast.
- **The 4 packages mirror Kilo Code's structure:** cli (the `kilo` binary), server (HTTP+ SSE), runtime (agent core), sdk (auto-generated client).
- **Don't add source files yet.** Just stubs. Real source comes in prompts 02+.
- **Pin Bun version** in `packageManager` so the team uses the same version.