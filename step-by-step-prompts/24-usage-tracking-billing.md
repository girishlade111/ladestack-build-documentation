# Prompt 24: Usage Tracking + Stripe Billing

## Goal

Track per-user usage (tokens, cost), display usage dashboard, gate features by plan (free vs Pro), integrate Stripe for $25/mo Pro subscription.

## Context (from prompts 01-23)

- Usage events are already tracked (prompt 10's `trackUsage` function).
- Subscription table exists (prompt 04 schema).
- Need to wire it all together.

Reference: `../PRD.md` §3.1 (pricing), §6.2 (FR-8 billing).

## Task

### Step 1: Install Stripe

```bash
cd packages/api
pnpm add stripe
```

Add to `packages/api/src/env.ts`:
```ts
STRIPE_SECRET_KEY: z.string().startsWith("sk_"),
STRIPE_WEBHOOK_SECRET: z.string().optional(),
STRIPE_PRO_PRICE_ID: z.string().startsWith("price_")
```

Add to `.env`:
```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PRO_PRICE_ID=price_...
STRIPE_WEBHOOK_SECRET=whsec_...  # optional in dev
```

### Step 2: Create Stripe products in your dashboard

1. Go to https://dashboard.stripe.com/products
2. Create a product: "LadeStack Build Pro"
3. Add a recurring price: $25/month
4. Copy the `price_xxx` ID into `STRIPE_PRO_PRICE_ID`

### Step 3: Build Stripe routes

`packages/api/src/routes/billing.ts`:

```ts
import { Hono } from "hono"
import { z } from "zod"
import { zValidator } from "@hono/zod-validator"
import Stripe from "stripe"
import { authMiddleware, type AuthContext } from "../middleware/auth.js"
import { supabaseAdmin } from "../db/client.js"
import { env } from "../env.js"
import { badRequest } from "../middleware/error.js"

const stripe = new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: "2024-11-20.acacia" as any })

export const billingRoutes = new Hono<{ Variables: { auth: AuthContext } }>()
  .use("*", authMiddleware)

  // Get current subscription status
  .get("/subscription", async (c) => {
    const { userId } = c.get("auth")
    const { data: sub } = await supabaseAdmin
      .from("subscriptions")
      .select("*")
      .eq("user_id", userId)
      .single()

    if (!sub) {
      return c.json({ plan: "free", status: "active", currentPeriodEnd: null })
    }

    return c.json(sub)
  })

  // Create Stripe Checkout session for Pro
  .post("/checkout", zValidator("json", z.object({
    successUrl: z.string().url(),
    cancelUrl: z.string().url()
  })), async (c) => {
    const { userId } = c.get("auth")
    const { successUrl, cancelUrl } = c.req.valid("json")

    // Get or create Stripe customer
    const { data: sub } = await supabaseAdmin
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", userId)
      .single()

    let customerId = sub?.stripe_customer_id
    if (!customerId) {
      const { data: user } = await supabaseAdmin
        .from("users")
        .select("email")
        .eq("id", userId)
        .single()
      const customer = await stripe.customers.create({ email: user!.email, metadata: { userId } })
      customerId = customer.id
      await supabaseAdmin
        .from("subscriptions")
        .upsert({ user_id: userId, stripe_customer_id: customerId }, { onConflict: "user_id" })
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      line_items: [{ price: env.STRIPE_PRO_PRICE_ID, quantity: 1 }],
      mode: "subscription",
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { userId }
    })

    return c.json({ url: session.url })
  })

  // Create customer portal session (for managing subscription)
  .post("/portal", zValidator("json", z.object({
    returnUrl: z.string().url()
  })), async (c) => {
    const { userId } = c.get("auth")
    const { returnUrl } = c.req.valid("json")

    const { data: sub } = await supabaseAdmin
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", userId)
      .single()
    if (!sub?.stripe_customer_id) throw badRequest("no_subscription")

    const session = await stripe.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: returnUrl
    })

    return c.json({ url: session.url })
  })

  // Webhook endpoint (no auth — Stripe calls this)
  // Mounted separately, not on this router
```

Webhook handler in `packages/api/src/routes/stripe-webhook.ts`:

```ts
import { Hono } from "hono"
import Stripe from "stripe"
import { supabaseAdmin } from "../db/client.js"
import { env } from "../env.js"

const stripe = new Stripe(env.STRIPE_SECRET_KEY)

export const webhookRoutes = new Hono()
  .post("/webhook", async (c) => {
    const sig = c.req.header("stripe-signature")
    const body = await c.req.text()
    if (!sig || !env.STRIPE_WEBHOOK_SECRET) return c.text("missing_config", 400)

    let event: Stripe.Event
    try {
      event = stripe.webhooks.constructEvent(body, sig, env.STRIPE_WEBHOOK_SECRET)
    } catch (err: any) {
      return c.text(`webhook_error: ${err.message}`, 400)
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session
        const userId = session.metadata?.userId
        if (!userId) return c.text("no_user_id", 400)

        const subscriptionId = session.subscription as string
        const subscription = await stripe.subscriptions.retrieve(subscriptionId)

        await supabaseAdmin.from("subscriptions").upsert({
          user_id: userId,
          stripe_customer_id: session.customer as string,
          stripe_subscription_id: subscriptionId,
          plan: "pro",
          status: subscription.status,
          current_period_end: new Date(subscription.current_period_end * 1000).toISOString()
        }, { onConflict: "user_id" })
        break
      }
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription
        const plan = sub.status === "active" ? "pro" : "free"
        await supabaseAdmin.from("subscriptions").update({
          plan,
          status: sub.status,
          current_period_end: new Date(sub.current_period_end * 1000).toISOString()
        }).eq("stripe_subscription_id", sub.id)
        break
      }
    }

    return c.json({ received: true })
  })
```

Wire into `packages/api/src/index.ts`:
```ts
import { billingRoutes } from "./routes/billing.js"
import { webhookRoutes } from "./routes/stripe-webhook.js"
  .route("/api/billing", billingRoutes)
  .route("/api/stripe", webhookRoutes)  // public, no auth middleware
```

### Step 4: Add a usage tracking helper in the agent loop

Already done in prompt 11's `runLoop` via `trackUsage`. Verify it's called.

### Step 5: Add plan-gating helper

`packages/api/src/lib/plan.ts`:

```ts
import { supabaseAdmin } from "../db/client.js"

export type Plan = "free" | "pro"

export interface Limits {
  messagesPerDay: number
  canUsePrivateProjects: boolean
  canUseCustomDomain: boolean
  canDeploy: boolean
}

export const PLAN_LIMITS: Record<Plan, Limits> = {
  free: { messagesPerDay: 5, canUsePrivateProjects: false, canUseCustomDomain: false, canDeploy: false },
  pro: { messagesPerDay: Infinity, canUsePrivateProjects: true, canUseCustomDomain: true, canDeploy: true }
}

export async function getUserPlan(userId: string): Promise<Plan> {
  const { data } = await supabaseAdmin
    .from("subscriptions")
    .select("plan, status, current_period_end")
    .eq("user_id", userId)
    .single()

  if (!data || data.status !== "active") return "free"
  if (data.current_period_end && new Date(data.current_period_end) < new Date()) return "free"
  return data.plan as Plan
}

export async function checkMessageLimit(userId: string): Promise<{ allowed: boolean; remaining: number }> {
  const plan = await getUserPlan(userId)
  const limit = PLAN_LIMITS[plan].messagesPerDay
  if (limit === Infinity) return { allowed: true, remaining: Infinity }

  // Count today's usage
  const today = new Date().toISOString().slice(0, 10)
  const { count } = await supabaseAdmin
    .from("usage_events")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("event_type", "message")
    .gte("created_at", `${today}T00:00:00Z`)

  const used = count ?? 0
  return { allowed: used < limit, remaining: Math.max(0, limit - used) }
}
```

### Step 6: Apply limit in the session message route

`packages/api/src/routes/sessions.ts`:

```ts
.post("/:id/messages", zValidator("json", sendMessageSchema), async (c) => {
  const sessionId = c.req.param("id")
  const body = c.req.valid("json")
  const { auth } = c.var

  // Check rate limit
  const limit = await checkMessageLimit(auth.userId)
  if (!limit.allowed) {
    return c.json({ error: "rate_limit", message: `Daily limit reached (${limit.remaining} remaining). Upgrade to Pro for unlimited messages.`, upgradeUrl: "/billing" }, 429)
  }

  // ... existing SSE logic ...
})
```

### Step 7: Build the billing UI

`apps/web/src/app/billing/page.tsx`:

```tsx
"use client"
import { useState, useEffect } from "react"
import { useUIStore } from "@/stores/ui"
import { api } from "@/lib/api"

interface Subscription {
  plan: "free" | "pro"
  status: string
  current_period_end: string | null
}

export default function BillingPage() {
  const [sub, setSub] = useState<Subscription | null>(null)
  const [usage, setUsage] = useState<{ tokensIn: number; tokensOut: number; costCents: number } | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    api<{ plan: string }>("/api/billing/subscription").then(setSub)
    api<{ usage: any[] }>("/api/billing/usage").then((d) => {
      const total = (d.usage ?? []).reduce((acc, u) => ({
        tokensIn: acc.tokensIn + (u.tokensIn ?? 0),
        tokensOut: acc.tokensOut + (u.tokensOut ?? 0),
        costCents: acc.costCents + (u.costCents ?? 0)
      }), { tokensIn: 0, tokensOut: 0, costCents: 0 })
      setUsage(total)
    })
  }, [])

  const handleUpgrade = async () => {
    setLoading(true)
    try {
      const { url } = await api<{ url: string }>("/api/billing/checkout", {
        method: "POST",
        body: JSON.stringify({
          successUrl: `${window.location.origin}/billing?success=1`,
          cancelUrl: `${window.location.origin}/billing?canceled=1`
        })
      })
      window.location.href = url
    } catch (err: any) {
      alert(`Upgrade failed: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  const handleManage = async () => {
    setLoading(true)
    try {
      const { url } = await api<{ url: string }>("/api/billing/portal", {
        method: "POST",
        body: JSON.stringify({ returnUrl: window.location.href })
      })
      window.location.href = url
    } finally {
      setLoading(false)
    }
  }

  if (!sub) return <div className="p-8 text-text-secondary">Loading...</div>

  const isPro = sub.plan === "pro" && sub.status === "active"

  return (
    <main className="min-h-screen bg-canvas p-8">
      <div className="mx-auto max-w-3xl">
        <h1 className="mb-8 text-3xl font-bold text-text-primary">Billing</h1>

        {/* Current plan */}
        <div className="mb-6 rounded-lg border border-border-subtle bg-surface p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-text-primary">
                {isPro ? "Pro" : "Free"}
              </h2>
              <p className="text-sm text-text-secondary">
                {isPro
                  ? `Renews on ${new Date(sub.current_period_end!).toLocaleDateString()}`
                  : "Limited to 5 messages/day"}
              </p>
            </div>
            {isPro ? (
              <button onClick={handleManage} disabled={loading} className="rounded border border-border-subtle px-4 py-2 text-sm">
                Manage
              </button>
            ) : (
              <button onClick={handleUpgrade} disabled={loading} className="rounded bg-gold px-4 py-2 text-sm text-canvas hover:bg-gold-hi">
                {loading ? "Loading..." : "Upgrade to Pro · $25/mo"}
              </button>
            )}
          </div>
        </div>

        {/* Usage */}
        {usage && (
          <div className="mb-6 rounded-lg border border-border-subtle bg-surface p-6">
            <h2 className="mb-4 text-xl font-semibold text-text-primary">Last 30 days</h2>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <div className="text-xs text-text-tertiary">Input tokens</div>
                <div className="text-2xl text-text-primary">{usage.tokensIn.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-xs text-text-tertiary">Output tokens</div>
                <div className="text-2xl text-text-primary">{usage.tokensOut.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-xs text-text-tertiary">Cost</div>
                <div className="text-2xl text-gold">${(usage.costCents / 100).toFixed(2)}</div>
              </div>
            </div>
          </div>
        )}

        {/* Pricing */}
        <div className="rounded-lg border border-border-subtle bg-surface p-6">
          <h2 className="mb-4 text-xl font-semibold text-text-primary">Plans</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded border border-border-subtle p-4">
              <h3 className="font-semibold text-text-primary">Free</h3>
              <div className="my-2 text-3xl text-text-primary">$0</div>
              <ul className="space-y-1 text-sm text-text-secondary">
                <li>5 messages/day</li>
                <li>Public projects only</li>
                <li>BYO API key required</li>
                <li>ladestack.app subdomain</li>
              </ul>
            </div>
            <div className="rounded border border-gold bg-gold/5 p-4">
              <h3 className="font-semibold text-gold">Pro</h3>
              <div className="my-2 text-3xl text-gold">$25<span className="text-sm text-text-secondary">/mo</span></div>
              <ul className="space-y-1 text-sm text-text-secondary">
                <li>Unlimited messages</li>
                <li>Private projects</li>
                <li>Custom domains</li>
                <li>Priority support</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
```

Add usage endpoint in `packages/api/src/routes/billing.ts`:

```ts
.get("/usage", async (c) => {
  const { userId } = c.get("auth")
  const { data } = await supabaseAdmin
    .from("usage_events")
    .select("tokens_in, tokens_out, cost_cents, date")
    .eq("user_id", userId)
    .gte("date", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10))
  return c.json({ usage: data ?? [] })
})
```

### Step 8: Wire billing button in TopBar

Already wired:
```tsx
<button className="rounded p-1.5 ...">
  <CreditCard className="h-4 w-4" />
</button>
```

Add onClick:
```tsx
<button onClick={() => router.push("/billing")}>
  <CreditCard className="h-4 w-4" />
</button>
```

### Step 9: Stripe webhook in production

Set up the webhook URL in Stripe dashboard:
- URL: `https://yourdomain.com/api/stripe/webhook`
- Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
- Copy webhook signing secret to `STRIPE_WEBHOOK_SECRET`

For local testing, use Stripe CLI:
```bash
stripe listen --forward-to localhost:3001/api/stripe/webhook
```

### Step 10: Commit

```bash
git add -A
git commit -m "feat: Stripe billing + usage dashboard + plan gating (prompt 24)"
```

## Files created/modified

```
packages/api/src/routes/billing.ts (new)
packages/api/src/routes/stripe-webhook.ts (new)
packages/api/src/lib/plan.ts (new)
packages/api/src/routes/sessions.ts (rate limit check)
apps/web/src/app/billing/page.tsx (new)
apps/web/src/components/layout/TopBar.tsx (billing link)
```

## Acceptance criteria

- [ ] Free user can send 5 messages/day
- [ ] 6th message returns 429 with upgrade prompt
- [ ] Upgrade button creates Stripe Checkout session
- [ ] After Stripe payment, user is "Pro"
- [ ] Pro user has unlimited messages
- [ ] Manage button opens Stripe customer portal
- [ ] Usage dashboard shows last 30 days of tokens + cost
- [ ] Webhook updates subscription status correctly

## Verification

```bash
# In dev mode with Stripe test keys
pnpm --filter @ladestack/api dev &

# 1. Sign up, send 5 messages — all succeed
# 2. 6th message returns 429
# 3. Click Upgrade → Stripe Checkout opens (use test card 4242 4242 4242 4242)
# 4. After payment, user is Pro
# 5. Send 10 more messages — all succeed
# 6. Visit /billing — see usage stats

kill %1
```

## Notes

- **Use Stripe test mode** for development. Test card: `4242 4242 4242 4242`, any future date, any CVC.
- **The webhook needs Stripe CLI** for local dev. In production, the webhook is public but Stripe signs requests; verify signature in handler.
- **Free tier message counting** includes both user messages AND any tool calls. We count `event_type = 'message'` (one per assistant turn). If a user message triggers 5 LLM calls, that counts as 1 message.
- **Plan limits are in `PLAN_LIMITS`** — easy to adjust.
- **`current_period_end` is the source of truth** for Pro access. If the timestamp is past, user is "free" regardless of Stripe status (handles failed renewals).
- **The portal session** lets users cancel, update card, etc. without you building a billing UI.
- **Cost display is dollars** (costCents / 100). For international, add currency formatting.
- **No usage cap for Pro BYO users.** They pay the LLM provider directly; we don't meter. v1.1 adds soft limits for cost protection.
- **Stripe customer creation is idempotent.** We check for existing customer before creating new.
- **Test mode vs Live mode** — switch in Stripe dashboard. Live mode needs real business details.
