# Prompt 02: Next.js 14 App Shell

## Goal

Set up the `@ladestack/web` Next.js 14 app with App Router, TypeScript, Tailwind CSS, shadcn/ui, and the LadeStack brand design tokens (Deep Navy + Gold).

## Context (from prompt 01)

You have a pnpm + Turborepo monorepo with empty stub packages at:
- `apps/web/` — currently empty `package.json`
- `packages/ui/` — empty stub
- `packages/runtime/` — empty stub
- `packages/sdk/` — empty stub

The parent docs you should consult for the visual design:
- `../design.md` §2 (color tokens), §3 (typography), §5 (3-pane layout), §8 (animations)

## Task

### Step 1: Convert `apps/web/package.json` to a real Next.js app

```bash
cd apps/web
pnpm add next@14 react@18 react-dom@18
pnpm add -D @types/react @types/react-dom typescript
pnpm add tailwindcss@3 postcss autoprefixer
pnpm add class-variance-authority clsx tailwind-merge lucide-react
pnpm add framer-motion
```

Replace the stub `apps/web/package.json` with:

```json
{
  "name": "@ladestack/web",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf .next .turbo"
  },
  "dependencies": {
    "@ladestack/ui": "workspace:*",
    "next": "^14.2.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "framer-motion": "^11.0.0",
    "lucide-react": "^0.300.0",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.0.0",
    "tailwind-merge": "^2.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "autoprefixer": "^10.4.0",
    "eslint-config-next": "^14.2.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.4.0"
  }
}
```

### Step 2: Create `apps/web/next.config.js`

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@ladestack/ui"],
  experimental: { serverActions: { allowedOrigins: ["localhost:3000"] } }
}
export default nextConfig
```

### Step 3: Create `apps/web/tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "src/**/*.ts", "src/**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

### Step 4: Create `apps/web/tailwind.config.ts`

```ts
import type { Config } from "tailwindcss"

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "var(--bg-canvas)",
        surface: "var(--bg-surface)",
        elevated: "var(--bg-elevated)",
        border: { subtle: "var(--border-subtle)", strong: "var(--border-strong)" },
        text: { primary: "var(--text-primary)", secondary: "var(--text-secondary)", tertiary: "var(--text-tertiary)" },
        gold: { DEFAULT: "var(--accent-gold)", hi: "var(--accent-gold-hi)", lo: "var(--accent-gold-lo)" },
        accent: { purple: "var(--accent-purple)", blue: "var(--accent-blue)", green: "var(--accent-green)", red: "var(--accent-red)", orange: "var(--accent-orange)" }
      },
      fontFamily: {
        sans: "var(--font-sans)",
        mono: "var(--font-mono)"
      }
    }
  },
  plugins: []
}
export default config
```

### Step 5: Create `apps/web/postcss.config.js`

```js
export default { plugins: { tailwindcss: {}, autoprefixer: {} } }
```

### Step 6: Create `apps/web/src/styles/tokens.css` (LadeStack brand tokens)

```css
:root {
  /* Dark theme (default) */
  --bg-canvas: #0A0E1A;
  --bg-surface: #0F1424;
  --bg-elevated: #161B2E;
  --bg-overlay: rgba(10, 14, 26, 0.85);
  --border-subtle: #1F2742;
  --border-default: #2D3656;
  --border-strong: #4A5580;
  --text-primary: #E8EAF1;
  --text-secondary: #A0A8C0;
  --text-tertiary: #6B7395;
  --text-disabled: #4A5070;
  --accent-gold: #D4A574;
  --accent-gold-hi: #E6BC8A;
  --accent-gold-lo: #8C6F4F;
  --accent-purple: #7C5DDB;
  --accent-blue: #4A90E2;
  --accent-green: #4CAF7C;
  --accent-red: #E25C5C;
  --accent-orange: #E8924C;

  /* Spacing */
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px;
  --space-5: 20px; --space-6: 24px; --space-8: 32px; --space-10: 40px;
  --space-12: 48px; --space-16: 64px;

  /* Radius */
  --radius-sm: 4px; --radius-md: 8px; --radius-lg: 12px; --radius-xl: 16px;

  /* Fonts */
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', Menlo, monospace;
}

@media (prefers-color-scheme: light) {
  :root.theme-light {
    --bg-canvas: #FAFAFC;
    --bg-surface: #FFFFFF;
    --bg-elevated: #FFFFFF;
    --text-primary: #0A0E1A;
    --text-secondary: #404858;
    --text-tertiary: #6B7395;
  }
}
```

### Step 7: Create `apps/web/src/styles/globals.css`

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@import "./tokens.css";

html, body { background: var(--bg-canvas); color: var(--text-primary); font-family: var(--font-sans); }
* { box-sizing: border-box; }

/* Subtle scrollbars */
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: var(--bg-canvas); }
::-webkit-scrollbar-thumb { background: var(--border-default); border-radius: var(--radius-md); }
::-webkit-scrollbar-thumb:hover { background: var(--border-strong); }
```

### Step 8: Create `apps/web/src/app/layout.tsx`

```tsx
import type { Metadata } from "next"
import "../styles/globals.css"

export const metadata: Metadata = {
  title: "LadeStack Build",
  description: "AI-powered website builder"
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  )
}
```

### Step 9: Create `apps/web/src/app/page.tsx` (landing — minimal for now)

```tsx
export default function HomePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas">
      <div className="text-center">
        <h1 className="text-5xl font-bold text-text-primary mb-4">LadeStack Build</h1>
        <p className="text-text-secondary text-lg">AI-powered website builder — coming soon</p>
      </div>
    </main>
  )
}
```

### Step 10: Set up shadcn/ui

```bash
cd apps/web
pnpm dlx shadcn@latest init
```

When prompted:
- TypeScript: yes
- Style: Default
- Base color: Slate
- CSS variables: yes
- `components.json` path: keep default
- Tailwind config: `tailwind.config.ts`
- Import alias: `@/*`

Then install the components we'll need:

```bash
pnpm dlx shadcn@latest add button input dialog dropdown-menu tooltip avatar separator
pnpm dlx shadcn@latest add scroll-area tabs card badge sonner
```

### Step 11: Create the IDE layout shell (`src/app/c/[projectId]/layout.tsx`)

```tsx
import { redirect } from "next/navigation"

export default function IDELayout({ children, params }: { children: React.ReactNode; params: { projectId: string } }) {
  // TODO: auth check in prompt 04
  if (!params.projectId) redirect("/")
  return <div className="h-screen w-screen flex flex-col bg-canvas">{children}</div>
}
```

Create `src/app/c/[projectId]/page.tsx` with a placeholder:

```tsx
export default function IDEPage({ params }: { params: { projectId: string } }) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center">
        <p className="text-text-secondary">IDE for project <span className="text-gold">{params.projectId}</span> — building UI in prompt 15+</p>
      </div>
    </div>
  )
}
```

### Step 12: Verify build

```bash
cd ladestack-build
pnpm install
pnpm turbo run typecheck
pnpm turbo run build
```

Then `pnpm --filter @ladestack/web dev` and visit `http://localhost:3000` — should see the landing page.

### Step 13: Commit

```bash
git add -A
git commit -m "feat(web): Next.js 14 shell with brand tokens + shadcn/ui (prompt 02)"
```

## Files created

```
apps/web/
├── next.config.js
├── package.json
├── postcss.config.js
├── tailwind.config.ts
├── tsconfig.json
├── components.json (from shadcn init)
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   └── c/[projectId]/
│   │       ├── layout.tsx
│   │       └── page.tsx
│   ├── styles/
│   │   ├── globals.css
│   │   └── tokens.css
│   └── lib/utils.ts (from shadcn init)
└── ... (shadcn components in src/components/ui/)
```

## Acceptance criteria

- [ ] `pnpm --filter @ladestack/web dev` starts on port 3000
- [ ] `http://localhost:3000` shows the LadeStack landing page
- [ ] `http://localhost:3000/c/test` shows the IDE placeholder
- [ ] Dark theme is default; brand colors render correctly
- [ ] `pnpm turbo run build` succeeds
- [ ] shadcn/ui components are in `src/components/ui/`
- [ ] Tailwind classes work (text-gold, bg-canvas, etc.)

## Verification

```bash
pnpm --filter @ladestack/web dev &
sleep 5
curl -s http://localhost:3000 | grep "LadeStack Build"
curl -s http://localhost:3000/c/test | grep "IDE for project"
kill %1
```

Both curls should return HTML containing the expected text.

## Notes

- **shadcn/ui over a component library.** It's MIT, owned-by-you, copy-paste components. Best for this kind of project.
- **Don't worry about auth yet** — `c/[projectId]/layout.tsx` has a placeholder TODO.
- **Don't build the chat UI yet** — that's prompts 15-18.
- **Use `pnpm dlx`, not `npx`.** We're in a pnpm workspace.
- **Inter font:** install via `next/font` later if needed. For now, fallback to system fonts is fine.
- **Custom cursor:** the user has a custom gold cursor in the portfolio project. If you want to add it later, see `../design.md` §3 for the pattern.
