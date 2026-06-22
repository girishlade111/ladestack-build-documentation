# Prompt 01: Monorepo Bootstrap

## Goal

Initialize a pnpm + Turborepo monorepo at `ladestack-build/` with TypeScript, ESLint, Prettier, and Husky — ready for the Next.js app, Hono API, and agent runtime packages to land.

## Context (nothing built yet — greenfield)

You are starting from scratch. The parent folder has the PRD/spec docs you should skim (NOT generate from):
- `../PRD.md` — vision, scope, MVP
- `../system-design.md` — architecture diagram (what packages we're about to create)

You do NOT need to read these to do this prompt. They're context for later prompts.

## Task

### Step 1: Create the root

```bash
mkdir ladestack-build && cd ladestack-build
pnpm init
```

### Step 2: Install root dev dependencies

```bash
pnpm add -Dw typescript turbo @types/node eslint prettier eslint-config-prettier
pnpm add -Dw @typescript-eslint/parser @typescript-eslint/eslint-plugin
pnpm add -Dw husky lint-staged @changesets/cli
```

### Step 3: Create `pnpm-workspace.yaml`

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

### Step 4: Create `turbo.json`

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**", "!.next/cache/**"]
    },
    "lint": { "outputs": [] },
    "typecheck": { "dependsOn": ["^build"], "outputs": [] },
    "dev": { "cache": false, "persistent": true },
    "clean": { "cache": false }
  }
}
```

### Step 5: Create root `package.json` (extend what `pnpm init` made)

```json
{
  "name": "ladestack-build",
  "private": true,
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "clean": "turbo run clean && rm -rf node_modules",
    "changeset": "changeset",
    "prepare": "husky"
  },
  "packageManager": "pnpm@9.0.0",
  "engines": { "node": ">=20.0.0" }
}
```

### Step 6: Create root `tsconfig.base.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "strict": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": false
  }
}
```

### Step 7: Create `.eslintrc.cjs` (root)

```js
module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended", "prettier"],
  parserOptions: { ecmaVersion: 2022, sourceType: "module" },
  env: { node: true, es2022: true },
  ignorePatterns: ["dist/", ".next/", "node_modules/", "coverage/"]
}
```

### Step 8: Create `.prettierrc`

```json
{ "semi": false, "singleQuote": false, "trailingComma": "all", "printWidth": 100 }
```

### Step 9: Create `.gitignore`

```
node_modules
.next
.turbo
dist
build
coverage
.env
.env.local
.env.*.local
*.log
.DS_Store
.vscode/*
!.vscode/settings.json
```

### Step 10: Initialize git + Husky

```bash
git init
pnpm prepare  # sets up husky
```

Create `.husky/pre-commit`:
```bash
#!/usr/bin/sh
. "$(dirname -- "$0")/_/husky.sh"
pnpm lint-staged
```

Create `.lintstagedrc.json`:
```json
{ "*.{ts,tsx,js,jsx}": ["eslint --fix", "prettier --write"], "*.{json,md,yml,yaml}": ["prettier --write"] }
```

### Step 11: Create the empty package directories

```bash
mkdir -p apps/web packages/runtime packages/sdk packages/ui
```

Add stub `package.json` to each so pnpm recognizes them:

`apps/web/package.json`:
```json
{ "name": "@ladestack/web", "private": true, "version": "0.0.0" }
```

`packages/runtime/package.json`:
```json
{ "name": "@ladestack/runtime", "private": true, "version": "0.0.0", "type": "module", "main": "./src/index.ts", "types": "./src/index.ts" }
```

`packages/sdk/package.json`:
```json
{ "name": "@ladestack/sdk", "private": true, "version": "0.0.0", "type": "module", "main": "./src/index.ts", "types": "./src/index.ts" }
```

`packages/ui/package.json`:
```json
{ "name": "@ladestack/ui", "private": true, "version": "0.0.0", "type": "module", "main": "./src/index.ts", "types": "./src/index.ts" }
```

### Step 12: Create `.changeset/config.json`

```json
{ "$schema": "https://unpkg.com/@changesets/config@2.3.0/schema.json", "changelog": "@changesets/cli/changelog", "commit": false, "linked": [] }
```

### Step 13: Initial commit

```bash
git add -A
git commit -m "chore: bootstrap monorepo (prompt 01)"
```

## Files created

```
ladestack-build/
├── apps/web/package.json
├── packages/runtime/package.json
├── packages/sdk/package.json
├── packages/ui/package.json
├── .changeset/config.json
├── .eslintrc.cjs
├── .gitignore
├── .husky/pre-commit
├── .lintstagedrc.json
├── .prettierrc
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── turbo.json
```

## Acceptance criteria

- [ ] `pnpm install` succeeds with no errors
- [ ] `pnpm typecheck` runs and exits 0
- [ ] `pnpm lint` runs and exits 0
- [ ] `pnpm turbo run build` runs (no packages yet, should succeed vacuously)
- [ ] Git is initialized with the initial commit
- [ ] Husky pre-commit hook runs on `git commit`
- [ ] `apps/` and `packages/` directories exist with stub `package.json`s

## Verification

```bash
cd ladestack-build
pnpm install
pnpm typecheck
pnpm lint
pnpm turbo run build
git log --oneline   # should show 1 commit
```

All commands should exit 0.

## Notes

- **Use pnpm, not npm or yarn.** pnpm is faster and has better workspace support.
- **Don't add Next.js yet** — that's prompt 02.
- **Don't add Hono yet** — that's prompt 03.
- **Pin your pnpm version** with `packageManager` in `package.json` so everyone uses the same version.
- **The empty stub packages are intentional** — they make `pnpm install` happy and reserve names.
- **Common pitfall:** husky hooks don't fire on Windows by default. Add `core.hooksPath` config if needed.
