# Prompt 21: GitHub OAuth + Sync

## Goal

Add "Connect GitHub" + "Push to GitHub" features. User connects their GitHub account via OAuth, then can push the project as a repo with one click. Auto-push on every internal commit (optional toggle).

## Context (from prompts 01-20)

- All foundation, agent loop, UI built.
- `TopBar` has a placeholder GitHub icon — wire it up.
- Sandbox holds the project files; we read/write them via `sandboxOps`.

Reference: `../PRD.md` §6.1 (GitHub sync), `../design.md` §6.6 (TopBar).

## Task

### Step 1: Create GitHub OAuth app

Go to https://github.com/settings/applications/new:
- Application name: "LadeStack Build"
- Homepage URL: `https://ladestack.in` (or your domain)
- Authorization callback URL: `http://localhost:3001/api/github/oauth/callback` (and your prod URL)

Save the Client ID and Client Secret.

### Step 2: Add GitHub SDK + config

```bash
cd packages/api
pnpm add @octokit/rest
```

Update `packages/api/src/env.ts`:
```ts
GITHUB_CLIENT_ID: z.string(),
GITHUB_CLIENT_SECRET: z.string(),
GITHUB_OAUTH_CALLBACK_URL: z.string().url().default("http://localhost:3001/api/github/oauth/callback")
```

Add to `.env`:
```
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
```

### Step 3: Add DB columns for GitHub

Run this SQL in Supabase:

```sql
alter table public.users
  add column github_access_token text,
  add column github_username text;

alter table public.projects
  add column github_auto_push boolean default false;
```

### Step 4: Build GitHub OAuth + API routes

`packages/api/src/routes/github.ts`:

```ts
import { Hono } from "hono"
import { Octokit } from "@octokit/rest"
import { z } from "zod"
import { zValidator } from "@hono/zod-validator"
import { authMiddleware, type AuthContext } from "../middleware/auth.js"
import { supabaseAdmin } from "../db/client.js"
import { sandboxOps } from "@ladestack/runtime"
import { env } from "../env.js"
import { badRequest, notFound } from "../middleware/error.js"

export const githubRoutes = new Hono()
  // OAuth callback doesn't require auth — it establishes the auth
  .get("/oauth/callback", async (c) => {
    const code = c.req.query("code")
    const state = c.req.query("state")  // contains user ID
    if (!code || !state) throw badRequest("missing_code_or_state")

    // Exchange code for access token
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code
      })
    })
    const tokenData = await tokenRes.json() as any
    if (tokenData.error) throw badRequest(`github_error: ${tokenData.error_description}`)

    const accessToken = tokenData.access_token

    // Get GitHub user info
    const octokit = new Octokit({ auth: accessToken })
    const { data: ghUser } = await octokit.users.getAuthenticated()

    // Save to users table
    await supabaseAdmin
      .from("users")
      .update({
        github_access_token: accessToken,
        github_username: ghUser.login
      })
      .eq("id", state)

    // Redirect back to dashboard
    return c.redirect(`${env.CORS_ORIGINS.split(",")[0]}/dashboard?github=connected`)
  })

  // All routes below require auth
  .use("/*", authMiddleware)

  .get("/status", async (c) => {
    const { userId } = c.get("auth")
    const { data } = await supabaseAdmin
      .from("users")
      .select("github_username")
      .eq("id", userId)
      .single()
    return c.json({ connected: !!data?.github_username, username: data?.github_username })
  })

  .post("/disconnect", async (c) => {
    const { userId } = c.get("auth")
    await supabaseAdmin
      .from("users")
      .update({ github_access_token: null, github_username: null })
      .eq("id", userId)
    return c.json({ disconnected: true })
  })

  // Push project to GitHub
  .post("/push/:projectId", zValidator("json", z.object({
    repoName: z.string().min(1).max(100),
    isPrivate: z.boolean().default(true)
  })), async (c) => {
    const projectId = c.req.param("projectId")
    const { repoName, isPrivate } = c.req.valid("json")
    const { userId } = c.get("auth")

    // Get user's GitHub token
    const { data: user } = await supabaseAdmin
      .from("users")
      .select("github_access_token, github_username")
      .eq("id", userId)
      .single()
    if (!user?.github_access_token) throw badRequest("github_not_connected")

    const octokit = new Octokit({ auth: user.github_access_token })

    // Get project info
    const { data: project } = await supabaseAdmin
      .from("projects")
      .select("name, github_repo")
      .eq("id", projectId)
      .eq("user_id", userId)
      .single()
    if (!project) throw notFound("project_not_found")

    let repoFullName = project.github_repo
    if (!repoFullName) {
      // Create the repo
      try {
        const { data: repo } = await octokit.repos.createForAuthenticatedUser({
          name: repoName,
          private: isPrivate,
          auto_init: true,
          description: `Built with LadeStack Build`
        })
        repoFullName = repo.full_name
      } catch (err: any) {
        if (err.status === 422) {
          // Repo already exists — use it
          repoFullName = `${user.github_username}/${repoName}`
        } else {
          throw err
        }
      }

      // Save repo name to project
      await supabaseAdmin
        .from("projects")
        .update({ github_repo: repoFullName })
        .eq("id", projectId)
    }

    // List all files in sandbox
    const allFiles = await listAllFiles(projectId, "")

    // Push each file
    const [owner, repo] = repoFullName!.split("/")
    for (const filePath of allFiles) {
      const content = await sandboxOps.read(projectId, filePath)
      await pushFile(octokit, owner, repo, filePath, content, `Update ${filePath}`)
    }

    return c.json({ pushed: true, repo: repoFullName, files: allFiles.length })
  })
)

// Recursively list all files
async function listAllFiles(projectId: string, dir: string): Promise<string[]> {
  const items = await sandboxOps.list(projectId, dir)
  const files: string[] = []
  for (const item of items) {
    const fullPath = dir ? `${dir}/${item}` : item
    if (item === "node_modules" || item.startsWith(".")) continue  // skip noise
    // Heuristic: if no extension and starts with lowercase, treat as dir
    if (!item.includes(".")) {
      try {
        const subFiles = await listAllFiles(projectId, fullPath)
        files.push(...subFiles)
      } catch {}
    } else {
      files.push(fullPath)
    }
  }
  return files
}

async function pushFile(octokit: Octokit, owner: string, repo: string, path: string, content: string, message: string) {
  try {
    // Check if file exists (to get its SHA for update)
    let sha: string | undefined
    try {
      const { data: existing } = await octokit.repos.getContent({ owner, repo, path })
      if (!Array.isArray(existing) && "sha" in existing) sha = existing.sha as string
    } catch {
      // File doesn't exist — that's fine, we'll create it
    }

    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path,
      message,
      content: Buffer.from(content, "utf-8").toString("base64"),
      sha,
      branch: "main"
    })
  } catch (err) {
    console.error(`failed to push ${path}`, err)
  }
}
```

### Step 5: Add OAuth "Connect" button to UI

Update `apps/web/src/components/layout/TopBar.tsx` to add a working GitHub button:

```tsx
// Replace the GitHub button:
const [ghConnected, setGhConnected] = useState(false)
useEffect(() => { api<{ connected: boolean }>("/api/github/status").then(d => setGhConnected(d.connected)) }, [])

<button
  onClick={async () => {
    if (!ghConnected) {
      // Get user ID for OAuth state
      const token = localStorage.getItem("token")
      const payload = JSON.parse(atob(token.split(".")[1]))
      const userId = payload.sub
      window.location.href = `https://github.com/login/oauth/authorize?client_id=${process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID}&scope=repo&state=${userId}`
    } else {
      // Push to GitHub
      const projectId = useProjectStore.getState().projectId
      const repoName = prompt("Repo name?") ?? "ladestack-build-app"
      try {
        const result = await api<{ pushed: boolean; repo: string }>(`/api/github/push/${projectId}`, {
          method: "POST",
          body: JSON.stringify({ repoName, isPrivate: true })
        })
        alert(`Pushed to ${result.repo}`)
      } catch (err: any) {
        alert(`Push failed: ${err.message}`)
      }
    }
  }}
  className={cn(
    "rounded p-1.5 hover:bg-elevated",
    ghConnected ? "text-accent-green" : "text-text-tertiary"
  )}
  title={ghConnected ? "Push to GitHub" : "Connect GitHub"}
>
  <Github className="h-4 w-4" />
</button>
```

Add `NEXT_PUBLIC_GITHUB_CLIENT_ID` to `apps/web/.env.local`:
```
NEXT_PUBLIC_GITHUB_CLIENT_ID=your_github_client_id
```

### Step 6: Wire auto-push toggle into project settings

Update `packages/api/src/routes/projects.ts` — allow updating `github_auto_push`:

```ts
.patch("/:id", zValidator("json", z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  githubAutoPush: z.boolean().optional()
}).strict()), async (c) => {
  const id = c.req.param("id")
  const body = c.req.valid("json")
  const { userId } = c.get("auth")
  // ... update with camelCase -> snake_case mapping
})
```

Update agent loop to push after every assistant message (if enabled):

`packages/runtime/src/loop/run.ts` — add at the end of runLoop, in the `message_end` handler:

```ts
// After appendMessage, check for auto-push
import { maybePushToGithub } from "../integrations/github.js"

if (toolCalls.length > 0) {
  await maybePushToGithub(input.projectId)
}
```

Create `packages/runtime/src/integrations/github.ts`:

```ts
import { Octokit } from "@octokit/rest"
import { supabaseAdmin } from "../db/client.js"
import { sandboxOps } from "../sandbox/operations.js"
import { log } from "../lib/logger.js"

export async function maybePushToGithub(projectId: string): Promise<void> {
  try {
    const { data: project } = await supabaseAdmin
      .from("projects")
      .select("github_repo, github_auto_push, user_id")
      .eq("id", projectId)
      .single()
    if (!project?.github_repo || !project.github_auto_push) return

    const { data: user } = await supabaseAdmin
      .from("users")
      .select("github_access_token")
      .eq("id", project.user_id)
      .single()
    if (!user?.github_access_token) return

    const octokit = new Octokit({ auth: user.github_access_token })
    const [owner, repo] = project.github_repo.split("/")
    const files = await listFilesRecursive(projectId, "")
    const message = `Auto-push: ${files.length} files updated`

    for (const path of files) {
      const content = await sandboxOps.read(projectId, path)
      try {
        const { data: existing } = await octokit.repos.getContent({ owner, repo, path })
        const sha = !Array.isArray(existing) && "sha" in existing ? existing.sha as string : undefined
        await octokit.repos.createOrUpdateFileContents({
          owner, repo, path, message,
          content: Buffer.from(content, "utf-8").toString("base64"),
          sha, branch: "main"
        })
      } catch (err) {
        log.warn({ err, path }, "auto-push file failed")
      }
    }
    log.info({ projectId, fileCount: files.length }, "auto-push complete")
  } catch (err) {
    log.error({ err, projectId }, "auto-push failed")
  }
}

async function listFilesRecursive(projectId: string, dir: string): Promise<string[]> {
  const items = await sandboxOps.list(projectId, dir)
  const files: string[] = []
  for (const item of items) {
    const fullPath = dir ? `${dir}/${item}` : item
    if (item === "node_modules" || item.startsWith(".") && item !== ".gitignore") continue
    if (!item.includes(".")) {
      try {
        files.push(...(await listFilesRecursive(projectId, fullPath)))
      } catch {}
    } else {
      files.push(fullPath)
    }
  }
  return files
}
```

### Step 7: Commit

```bash
git add -A
git commit -m "feat: GitHub OAuth + push + auto-push (prompt 21)"
```

## Files created/modified

```
packages/api/src/routes/github.ts (new)
packages/runtime/src/integrations/github.ts (new)
packages/runtime/src/loop/run.ts (auto-push after tool calls)
packages/api/src/routes/projects.ts (PATCH project settings)
apps/web/src/components/layout/TopBar.tsx (Connect/Push button)
```

## Acceptance criteria

- [ ] Click GitHub icon → redirects to GitHub OAuth
- [ ] After OAuth, returns to dashboard with "Connected" status
- [ ] Click GitHub when connected → prompts for repo name → pushes
- [ ] Pushed repo shows all project files
- [ ] Auto-push (if enabled) happens after every AI edit
- [ ] Disconnect removes GitHub auth

## Verification

```bash
pnpm --filter @ladestack/api dev &
# 1. Click GitHub icon in TopBar
# 2. Authorize on github.com
# 3. Should redirect back to dashboard
# 4. Click GitHub icon again
# 5. Enter repo name
# 6. Check github.com — repo created with all files
kill %1
```

## Notes

- **OAuth state is the user ID.** In production, use a signed/random state token to prevent CSRF. For MVP, this is acceptable.
- **Access tokens are stored in `users.github_access_token`** (plaintext for MVP). Encrypt in v1.1.
- **Repo creation uses `auto_init: true`** so the repo has a default branch.
- **The `listAllFiles` heuristic** treats files without extensions as directories. This works for most projects. v1.1 uses `stat` to determine type.
- **node_modules is skipped** — never push dependencies.
- **`.gitignore` IS pushed.** Otherwise GitHub's default `.gitignore` (Node template) will commit `node_modules`.
- **Rate limits:** GitHub allows 5000 API requests/hour per user. One push = N files = N requests. For projects with 50+ files, batch with Git Trees API in v1.1.
- **Concurrent pushes** are not handled. If user clicks push twice quickly, second push may fail. v1.1 adds a lock.
- **The auto-push runs after every tool call batch.** That's chatty. v1.1 adds debouncing (only push if 30s passed since last push).
- **Disconnect doesn't revoke the OAuth app** — user must do that on github.com. We just clear our stored token.
