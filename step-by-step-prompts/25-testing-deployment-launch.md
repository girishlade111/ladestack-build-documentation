# Prompt 25: Testing + Production Deploy + Launch

## Goal

Final polish: write E2E tests, deploy to production (Vercel for web, DigitalOcean for API/runtime), verify everything works, write launch materials.

## Context (from prompts 01-24)

- Full MVP built. All 24 prompts complete.
- Need to ship: tests, prod deployment, launch.

## Task

### Step 1: Write E2E tests

```bash
cd apps/web
pnpm add -D @playwright/test
pnpm dlx playwright install chromium
```

Create `apps/web/playwright.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure"
  },
  webServer: process.env.CI ? undefined : {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: true
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }]
})
```

Create `apps/web/e2e/signup-chat.spec.ts`:

```ts
import { test, expect } from "@playwright/test"

test("user can sign up, create project, and chat", async ({ page }) => {
  // Sign up
  await page.goto("/signup")
  await page.fill("input[type=email]", `test-${Date.now()}@example.com`)
  await page.fill("input[type=password]", "testpassword123")
  await page.click("button[type=submit]")
  await expect(page).toHaveURL(/\/dashboard/)

  // Create project (click "New project" or use dashboard API)
  await page.click("text=New project")
  await expect(page).toHaveURL(/\/c\//)

  // Send a message
  await page.fill("textarea", "Reply with just the word hello")
  await page.keyboard.press("Control+Enter")

  // Wait for assistant response
  await expect(page.locator("text=hello").first()).toBeVisible({ timeout: 30000 })
})

test("user hits rate limit after 5 messages on free tier", async ({ page }) => {
  // ... similar setup
  for (let i = 0; i < 6; i++) {
    await page.fill("textarea", `Test message ${i}`)
    await page.keyboard.press("Control+Enter")
  }
  // 6th message should show error
  await expect(page.locator("text=rate_limit")).toBeVisible({ timeout: 30000 })
})
```

Run with:
```bash
pnpm --filter @ladestack/web e2e
```

### Step 2: Set up production environment

Create `.env.production` for the API:

```
NODE_ENV=production
PORT=3001

# Supabase
SUPABASE_URL=https://prod-project.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_KEY=...

# Encryption
ENCRYPTION_KEY=***  # MUST match runtime

# LLM providers (BYO preferred, but these as fallback)
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
GOOGLE_API_KEY=...

# OAuth
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=*** VERCEL_SECRET_KEY=*** Stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRO_PRICE_ID=price_...

# Daytona
DAYTONA_API_KEY=...
```

### Step 3: Deploy the web app to Vercel

```bash
cd apps/web
pnpm add -D vercel  # if needed

# Initialize
pnpm dlx vercel link

# Set env vars in Vercel dashboard:
# NEXT_PUBLIC_API_URL=https://api.ladestack.in
# NEXT_PUBLIC_GITHUB_CLIENT_ID=...

# Deploy
pnpm dlx vercel --prod
```

In `apps/web/vercel.json`:
```json
{
  "buildCommand": "pnpm turbo run build --filter=@ladestack/web",
  "framework": "nextjs"
}
```

### Step 4: Deploy the API to DigitalOcean

Create a Dockerfile in `packages/api`:

```dockerfile
FROM node:20-bookworm-slim
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

COPY packages/api ./packages/api
COPY packages/runtime ./packages/runtime
COPY packages/sdk ./packages/sdk
COPY tsconfig.base.json ./
COPY packages/api/tsconfig.json ./packages/api/

RUN pnpm --filter @ladestack/api build

EXPOSE 3001
CMD ["node", "packages/api/dist/index.js"]
```

Add to `docker-compose.yml` at repo root:

```yaml
version: "3.9"
services:
  api:
    build: .
    ports:
      - "3001:3001"
    environment:
      - NODE_ENV=production
      - PORT=3001
    env_file:
      - .env.production
    restart: unless-stopped
```

Deploy:
```bash
# SSH into your DigitalOcean droplet
ssh root@your-droplet

# Pull code, build, run
git clone https://github.com/yourusername/ladestack-build.git
cd ladestack-build
docker compose up -d

# Verify
curl https://api.ladestack.in/health
```

### Step 5: Set up monitoring

Add basic error tracking (PostHog or similar):

```bash
cd packages/api
pnpm add posthog-node
```

Create `packages/api/src/lib/analytics.ts`:

```ts
import { PostHog } from "posthog-node"
import { env } from "../env.js"

let client: PostHog | undefined

if (env.NODE_ENV === "production" && process.env.POSTHOG_API_KEY) {
  client = new PostHog(process.env.POSTHOG_API_KEY, { host: "https://us.i.posthog.com" })
}

export function track(userId: string, event: string, properties?: Record<string, any>) {
  if (!client) return
  client.capture({ distinctId: userId, event, properties })
}

export function shutdown() {
  return client?.shutdown()
}
```

Use in key places:
```ts
track(userId, "project_created", { projectId })
track(userId, "message_sent", { tokensIn, tokensOut, costCents })
track(userId, "deployment_created", { url })
```

### Step 6: Run the eval suite

Create `packages/runtime/evals/run.ts`:

```ts
import { runLoop } from "../src/loop/run.js"

const EVAL_CASES = [
  { input: "Reply with just hello", expected: /hello/i, agent: "build" },
  { input: "What is 2+2?", expected: /4/, agent: "ask" },
  { input: "Plan adding authentication", expected: /plan/i, agent: "plan" }
]

async function runEvals() {
  let pass = 0
  for (const test of EVAL_CASES) {
    const sessionId = "test-" + Date.now()
    let result = ""
    for await (const event of runLoop({
      sessionId,
      userId: "eval-user",
      projectId: "eval-proj",
      userMessage: test.input,
      agentName: test.agent
    })) {
      if (event.type === "text_delta") result += event.data.text
    }
    const passed = test.expected.test(result)
    console.log(`${passed ? "✓" : "✗"} ${test.input} (${test.agent})`)
    if (passed) pass++
  }
  console.log(`\n${pass}/${EVAL_CASES.length} passed`)
}

runEvals()
```

Run weekly to track quality.

### Step 7: Verify production

After deployment, run through these manually:

1. ✅ Sign up with new email
2. ✅ Create project
3. ✅ Send a message → get response
4. ✅ Preview iframe loads
5. ✅ Add BYO API key
6. ✅ Push to GitHub (creates repo)
7. ✅ Deploy to Vercel (creates deployment)
8. ✅ Upgrade to Pro (test card)
9. ✅ Use 6+ messages after upgrade (no rate limit)
10. ✅ Settings page renders correctly
11. ✅ File tree refreshes after edits
12. ✅ Cancel button stops streaming

### Step 8: Write launch blog post

Create `apps/web/src/app/blog/launch/page.tsx` or publish on ladestack.in:

```mdx
---
title: "Introducing LadeStack Build"
date: "2026-06-22"
author: "Girish Lade"
---

# Introducing LadeStack Build

Today we're launching LadeStack Build — an open-core AI website builder that you fully own.

## What is it?

LadeStack Build lets you describe what you want and turns it into a real Next.js + Tailwind + shadcn/ui application that runs in your browser preview, syncs to your GitHub, and deploys to Vercel — all in seconds.

## What's different?

- **Open source** — the agent runtime ships under MIT
- **Bring your own model key** — use your Anthropic, OpenAI, or Google account directly
- **Plan mode first** — every non-trivial change gets a written plan before any code is edited
- **Multi-agent loop** — specialized agents for DevOps, security review, SRE, and more
- **Git worktree isolation** — N parallel AI sessions without conflicts

## Try it

[ladestack.build](https://ladestack.build) — free tier, no credit card.

## What's next?

- VS Code extension (Q3 2026)
- Skill marketplace (Q3 2026)
- Self-hosted Docker Compose (Q4 2026)

Built by [Girish Lade](https://ladestack.in) in Pune, India.
```

### Step 9: Submit to directories

- Product Hunt: https://www.producthunt.com/posts/new
- Hacker News (Show HN): https://news.ycombinator.com/submit
- Reddit: r/SideProject, r/Nextjs, r/LocalLLaMA, r/ClaudeAI
- Indie Hackers: https://www.indiehackers.com/
- X/Twitter: tag @anthropicai, @OpenAI, @GoogleAI
- Dev.to: cross-post the blog post

### Step 10: Set up customer support channels

- Add a "Help" link in the app → opens mailto:support@ladestack.in
- Create a Discord server (free): https://discord.com/
- Set up a status page: https://statuspage.io (free tier) or https://upptime.js.org (self-hosted)

### Step 11: Commit final changes

```bash
git add -A
git commit -m "feat: production launch — tests + deploy + monitoring (prompt 25)"
git tag v1.0.0
git push origin main --tags
```

### Step 12: Post-launch checklist

Week 1:
- [ ] Monitor error rates daily (target < 1%)
- [ ] Respond to user feedback in Discord / Twitter
- [ ] Fix critical bugs as they come in
- [ ] Ship v1.1 (compact UX polish + Stripe fixes)

Week 2-4:
- [ ] Analyze usage data — what features are used? what's ignored?
- [ ] A/B test pricing tiers
- [ ] Add most-requested features
- [ ] Write launch retrospective

Month 2+:
- [ ] Plan v1.5 (custom domains, Stripe integration)
- [ ] Start VS Code extension
- [ ] Build skill marketplace
```

### Step 13: Final commit

```bash
git add -A
git commit -m "chore: launch checklist complete" --allow-empty
git push
```

## Files created

```
apps/web/e2e/signup-chat.spec.ts
apps/web/playwright.config.ts
apps/web/vercel.json
packages/api/Dockerfile
docker-compose.yml
packages/api/src/lib/analytics.ts
packages/runtime/evals/run.ts
apps/web/src/app/blog/launch/page.tsx
```

## Acceptance criteria

- [ ] E2E tests pass on CI
- [ ] Web app deployed to Vercel, accessible at production URL
- [ ] API deployed to DigitalOcean, accessible at production URL
- [ ] Health check endpoint returns 200
- [ ] Production env vars set correctly
- [ ] Stripe webhook receives events
- [ ] Monitoring (PostHog) tracks events
- [ ] Launch blog post published
- [ ] Product Hunt / Hacker News submissions done

## Verification

```bash
# Run E2E tests
pnpm --filter @ladestack/web e2e

# Production health check
curl https://api.ladestack.in/health
# expect: {"status":"ok",...}

# Production smoke test
# 1. Visit https://ladestack.build
# 2. Sign up, send a message, verify response
# 3. Check PostHog dashboard for events
```

## Notes

- **Don't skip the eval suite.** Without it, you can't measure quality regressions from prompt changes.
- **PostHog free tier is 1M events/month** — enough for early days. Migrate to paid as you grow.
- **The eval cases above are minimal.** v1.1 adds 50+ cases covering tool use, error recovery, plan mode, etc.
- **Status page is critical.** Users want to know when things are down. https://upptime.js.org is free + open-source.
- **Don't publish the blog post before you've manually verified everything.** First impressions matter.
- **Product Hunt timing:** Launch Tuesday-Thursday, 12:01 AM Pacific. Have a teammate respond to comments all day.
- **Hacker News "Show HN":** Be technical. Lead with the architecture (open-source agent runtime). Show the code.
- **Reddit rules:** Each subreddit has different rules. Read them before posting. Don't spam multiple subs at once.
- **The `playwright install` step is required.** Without it, tests fail to launch chromium.
- **For solo founders, automated E2E is overkill for MVP.** Manual smoke testing is fine. Add E2E in v1.1.
- **Vercel + DigitalOcean is the standard split.** Web on Vercel (best DX for Next.js), API on a VPS (cheaper, more control).
- **Backup strategy:** Postgres on Supabase has automatic daily backups. Local API logs are ephemeral. v1.1 adds log shipping to a service.

---

**🎉 You shipped LadeStack Build.**

You now have a working AI website builder with:
- 8 built-in agents + 2 specialized (DevOps, Security)
- Plan mode + multi-agent foundation
- Live preview iframe
- Monaco editor with file tree
- GitHub sync + Vercel deploy
- BYO API key + Stripe billing
- Full observability via PostHog

**Next steps:** Monitor, iterate, listen to users. The MVP is shipped; the real work starts now.

Good luck. 🚀