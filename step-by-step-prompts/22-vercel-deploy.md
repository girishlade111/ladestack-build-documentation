# Prompt 22: Vercel Deploy

## Goal

Add "Deploy" button: user connects Vercel account via OAuth, then can one-click deploy the project. Display deploy status (building/ready/error) and the live URL.

## Context (from prompts 01-21)

- GitHub sync works (prompt 21).
- `TopBar` has a "Deploy" button that needs wiring.
- Project files are in the sandbox; Vercel deploys from a GitHub repo.

Reference: `../PRD.md` §6.2 (deploy), `../system-design.md` §6 (deploy).

## Task

### Step 1: Create Vercel OAuth integration

Vercel uses a different OAuth flow than GitHub. Two options:

**Option A: Vercel Marketplace OAuth** (recommended for marketplace apps)
**Option B: Personal Access Token** (simpler for MVP — user pastes a token)

For MVP, use **Option B** (personal access token). The user creates a token at https://vercel.com/account/tokens and pastes it in settings.

This avoids needing to register an OAuth app and is good enough for solo-founder use.

### Step 2: Add Vercel SDK

```bash
cd packages/api
pnpm add @vercel/sdk
```

### Step 3: Add DB columns for Vercel

```sql
alter table public.users
  add column vercel_token text,
  add column vercel_team_id text;

alter table public.projects
  add column vercel_project_id text,
  add column vercel_deployment_id text;
```

### Step 4: Build Vercel settings API

`packages/api/src/routes/vercel.ts`:

```ts
import { Hono } from "hono"
import { z } from "zod"
import { zValidator } from "@hono/zod-validator"
import { Vercel } from "@vercel/sdk"
import { authMiddleware, type AuthContext } from "../middleware/auth.js"
import { supabaseAdmin } from "../db/client.js"
import { badRequest, notFound } from "../middleware/error.js"

export const vercelRoutes = new Hono<{ Variables: { auth: AuthContext } }>()
  .use("*", authMiddleware)

  // Save the user's Vercel token
  .post("/token", zValidator("json", z.object({
    token: z.string().min(20).max(200)
  })), async (c) => {
    const { userId } = c.get("auth")
    const { token } = c.req.valid("json")

    // Validate the token by trying to list teams
    try {
      const vercel = new Vercel({ bearerToken: token })
      const { teams } = await vercel.teams.getTeams()
      const teamId = teams?.[0]?.id

      await supabaseAdmin
        .from("users")
        .update({ vercel_token: token, vercel_team_id: teamId ?? null })
        .eq("id", userId)

      return c.json({ connected: true, teamId })
    } catch (err: any) {
      throw badRequest(`invalid_vercel_token: ${err.message}`)
    }
  })

  .delete("/token", async (c) => {
    const { userId } = c.get("auth")
    await supabaseAdmin
      .from("users")
      .update({ vercel_token: null, vercel_team_id: null })
      .eq("id", userId)
    return c.json({ disconnected: true })
  })

  .get("/status", async (c) => {
    const { userId } = c.get("auth")
    const { data } = await supabaseAdmin
      .from("users")
      .select("vercel_team_id")
      .eq("id", userId)
      .single()
    return c.json({ connected: !!data?.vercel_team_id, teamId: data?.vercel_team_id })
  })

  // Deploy a project
  .post("/deploy/:projectId", async (c) => {
    const projectId = c.req.param("projectId")
    const { userId } = c.get("auth")

    // Get project
    const { data: project } = await supabaseAdmin
      .from("projects")
      .select("name, github_repo, vercel_project_id")
      .eq("id", projectId)
      .eq("user_id", userId)
      .single()
    if (!project?.github_repo) throw badRequest("github_not_connected")

    // Get user's Vercel token
    const { data: user } = await supabaseAdmin
      .from("users")
      .select("vercel_token, vercel_team_id")
      .eq("id", userId)
      .single()
    if (!user?.vercel_token) throw badRequest("vercel_not_connected")

    const vercel = new Vercel({ bearerToken: user.vercel_token, teamId: user.vercel_team_id ?? undefined })

    // Create or get Vercel project
    let vercelProjectId = project.vercel_project_id
    if (!vercelProjectId) {
      try {
        const created = await vercel.projects.createProject({
          name: project.name.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
          framework: "nextjs"
        })
        vercelProjectId = created.id
      } catch (err: any) {
        if (err.statusCode === 409) {
          // Already exists
          const existing = await vercel.projects.getProjects({ name: project.name })
          vercelProjectId = existing.projects?.[0]?.id
        } else {
          throw err
        }
      }

      // Link the GitHub repo to the Vercel project
      const [owner, repo] = project.github_repo.split("/")
      await vercel.projects.linkProject({
        projectId: vercelProjectId!,
        repo: {
          type: "github",
          repo: `${owner}/${repo}`,
          branch: "main"
        }
      })

      await supabaseAdmin
        .from("projects")
        .update({ vercel_project_id: vercelProjectId })
        .eq("id", projectId)
    }

    // Trigger a deploy
    const deployment = await vercel.deployments.createDeployment({
      projectId: vercelProjectId!,
      meta: { branch: "main" },
      target: "production"
    })

    await supabaseAdmin
      .from("projects")
      .update({
        vercel_deployment_id: deployment.id,
        deploy_status: "building"
      })
      .eq("id", projectId)

    // Insert deploys row
    await supabaseAdmin.from("deploys").insert({
      project_id: projectId,
      vercel_deployment_id: deployment.id,
      status: "building",
      url: `https://${deployment.url}`
    })

    return c.json({
      deploymentId: deployment.id,
      url: `https://${deployment.url}`,
      status: "building"
    })
  })

  // Get deploy status
  .get("/deploy/:projectId/status", async (c) => {
    const projectId = c.req.param("projectId")
    const { userId } = c.get("auth")

    const { data: project } = await supabaseAdmin
      .from("projects")
      .select("vercel_deployment_id, deploy_status, vercel_project_id")
      .eq("id", projectId)
      .eq("user_id", userId)
      .single()
    if (!project?.vercel_project_id) throw notFound("not_deployed")

    const { data: user } = await supabaseAdmin
      .from("users")
      .select("vercel_token, vercel_team_id")
      .eq("id", userId)
      .single()
    const vercel = new Vercel({ bearerToken: user!.vercel_token!, teamId: user!.vercel_team_id ?? undefined })

    const deployment = await vercel.deployments.getDeployment({
      idOrUrl: project.vercel_deployment_id!,
      teamId: user!.vercel_team_id ?? undefined
    })

    // Map Vercel status to ours
    const statusMap: Record<string, string> = {
      QUEUED: "building",
      BUILDING: "building",
      READY: "ready",
      ERROR: "error",
      CANCELED: "error"
    }
    const ourStatus = statusMap[deployment.readyState] ?? "building"

    // Update DB
    await supabaseAdmin
      .from("projects")
      .update({ deploy_status: ourStatus })
      .eq("id", projectId)

    return c.json({
      status: ourStatus,
      url: deployment.url ? `https://${deployment.url}` : null,
      vercelStatus: deployment.readyState
    })
  })
```

Wire into `packages/api/src/index.ts`:
```ts
import { vercelRoutes } from "./routes/vercel.js"
  .route("/api/vercel", vercelRoutes)
```

### Step 5: Add Settings UI for Vercel token

`apps/web/src/components/settings/VercelSettings.tsx`:

```tsx
"use client"
import { useState, useEffect } from "react"
import { useUIStore } from "@/stores/ui"
import { api } from "@/lib/api"

export function VercelSettings() {
  const { closeModal } = useUIStore()
  const [connected, setConnected] = useState(false)
  const [token, setToken] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api<{ connected: boolean }>("/api/vercel/status").then(d => setConnected(d.connected))
  }, [])

  const handleConnect = async () => {
    setLoading(true)
    setError(null)
    try {
      await api("/api/vercel/token", { method: "POST", body: JSON.stringify({ token }) })
      setConnected(true)
      setToken("")
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleDisconnect = async () => {
    await api("/api/vercel/token", { method: "DELETE" })
    setConnected(false)
  }

  return (
    <div className="space-y-4 p-6">
      <h2 className="text-lg font-semibold text-text-primary">Vercel integration</h2>
      <p className="text-sm text-text-secondary">
        Create a Vercel personal access token at{" "}
        <a href="https://vercel.com/account/tokens" target="_blank" className="text-gold underline">
          vercel.com/account/tokens
        </a>{" "}
        and paste it below.
      </p>

      {connected ? (
        <div className="space-y-2">
          <div className="rounded border border-accent-green bg-accent-green/10 px-3 py-2 text-sm text-accent-green">
            ✓ Connected to Vercel
          </div>
          <button onClick={handleDisconnect} className="text-xs text-accent-red hover:underline">
            Disconnect
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="vercel_..."
            className="w-full rounded border border-border-subtle bg-elevated px-3 py-2 font-mono text-sm text-text-primary"
          />
          {error && <p className="text-sm text-accent-red">{error}</p>}
          <button
            onClick={handleConnect}
            disabled={!token || loading}
            className="rounded bg-gold px-4 py-2 text-canvas hover:bg-gold-hi disabled:opacity-50"
          >
            {loading ? "Verifying..." : "Connect"}
          </button>
        </div>
      )}

      <button onClick={() => closeModal("settings")} className="text-xs text-text-tertiary">
        Close
      </button>
    </div>
  )
}
```

### Step 6: Wire Deploy button in TopBar

Update `apps/web/src/components/layout/TopBar.tsx`:

```tsx
import { useState } from "react"
import { api } from "@/lib/api"

const DeployButton = () => {
  const { projectId } = useProjectStore()
  const [deploying, setDeploying] = useState(false)
  const [deployUrl, setDeployUrl] = useState<string | null>(null)

  const handleDeploy = async () => {
    if (!projectId) return
    setDeploying(true)
    try {
      const { url } = await api<{ url: string }>(`/api/vercel/deploy/${projectId}`, { method: "POST" })
      setDeployUrl(url)
    } catch (err: any) {
      alert(`Deploy failed: ${err.message}`)
    } finally {
      setDeploying(false)
    }
  }

  return (
    <div className="relative">
      <button
        onClick={handleDeploy}
        disabled={deploying}
        className="flex items-center gap-1 rounded bg-gold px-3 py-1 text-sm text-canvas hover:bg-gold-hi disabled:opacity-50"
      >
        <Rocket className="h-3 w-3" />
        {deploying ? "Deploying..." : "Deploy"}
      </button>
      {deployUrl && (
        <a
          href={deployUrl}
          target="_blank"
          className="absolute right-0 top-full mt-1 rounded bg-accent-green px-2 py-1 text-xs text-canvas"
        >
          ✓ Live at {deployUrl}
        </a>
      )}
    </div>
  )
}
```

### Step 7: Commit

```bash
git add -A
git commit -m "feat: Vercel deploy via personal access token (prompt 22)"
```

## Files created/modified

```
packages/api/src/routes/vercel.ts (new)
apps/web/src/components/settings/VercelSettings.tsx (new)
apps/web/src/components/layout/TopBar.tsx (DeployButton)
```

## Acceptance criteria

- [ ] User can paste Vercel token in settings
- [ ] Invalid token shows error
- [ ] Valid token saves + shows "Connected"
- [ ] Click Deploy → triggers Vercel deploy
- [ ] Build status visible (building / ready / error)
- [ ] Live URL displayed when ready
- [ ] Disconnect clears the token

## Verification

```bash
pnpm --filter @ladestack/api dev &
# 1. Open settings, paste Vercel token, connect
# 2. Click Deploy in TopBar
# 3. Wait for build
# 4. Click live URL
kill %1
```

## Notes

- **Personal Access Token is the MVP shortcut.** Real OAuth requires registering a Vercel Integration. Defer to v2.
- **Tokens are stored in plaintext** in DB. Encrypt in v1.1 (same pattern as BYO LLM keys).
- **Vercel project creation uses Next.js framework detection.** For other frameworks, this needs adjustment.
- **`vercel.deployments.createDeployment` with `target: "production"`** deploys to the production branch. For previews, use `target: "preview"`.
- **The deployment URL is auto-assigned** by Vercel (e.g., `myapp-abc123.vercel.app`).
- **Custom domain** is a v1.5 feature. Defer to prompt 24+ follow-ups.
- **Auto-deploy on git push** is enabled automatically when you link a GitHub repo to a Vercel project. So push to GitHub (prompt 21) → Vercel auto-deploys.
- **This prompt's explicit deploy button** is for one-click deploys without waiting for git push.
- **Vercel SDK types may differ** by version. If `vercel.projects.createProject` doesn't exist, use `POST /v9/projects` via raw `fetch`.
