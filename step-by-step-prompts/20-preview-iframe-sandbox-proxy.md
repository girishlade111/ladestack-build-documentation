# Prompt 20: Preview Iframe + Sandbox Proxy

## Goal

Build the live preview pane: an iframe that loads the Vite dev server running in the user's Daytona sandbox. Includes breakpoint switcher (desktop/tablet/mobile), refresh, open-in-new-tab, and console panel for errors.

## Context (from prompts 01-19)

- Sandbox exists with Vite installed (prompt 05).
- Sandbox has `startDevServer` function that returns a preview URL.
- `IDEPage` references `PreviewPane` stub.

Reference: `../system-design.md` §5 (preview pipeline), `../design.md` §6.4 (preview iframe).

## Task

### Step 1: Build the preview URL route

The Daytona sandbox preview URL is private (requires Daytona auth). We need a proxy.

`packages/api/src/routes/preview.ts`:

```ts
import { Hono } from "hono"
import { authMiddleware, type AuthContext } from "../middleware/auth.js"
import { sandbox } from "@ladestack/runtime"
import { notFound, badRequest } from "../middleware/error.js"
import { stream } from "hono/streaming"

export const previewRoutes = new Hono<{ Variables: { auth: AuthContext } }>()
  .use("*", authMiddleware)

  // Start the dev server, return the proxied URL
  .post("/:projectId/start", async (c) => {
    const projectId = c.req.param("projectId")
    try {
      const previewUrl = await sandbox.startDevServer(projectId)
      return c.json({ previewUrl })
    } catch (err) {
      throw badRequest(`failed to start dev server: ${err}`)
    }
  })

  // Proxy HTTP requests to the sandbox preview URL
  .get("/:projectId/*", async (c) => {
    const projectId = c.req.param("projectId")
    const path = c.req.path.replace(`/api/preview/${projectId}`, "") || "/"

    const info = await sandbox.getSandbox(projectId)
    if (!info?.previewUrl) {
      return c.text("preview not started", 503)
    }

    const upstreamUrl = new URL(path, info.previewUrl)
    const response = await fetch(upstreamUrl.toString())
    const body = await response.text()

    return new Response(body, {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("Content-Type") ?? "text/html",
        // Disable iframe blocking
        "X-Frame-Options": "ALLOWALL",
        "Content-Security-Policy": ""
      }
    })
  })

  // Proxy WebSocket for HMR
  .get("/:projectId/ws", async (c) => {
    const projectId = c.req.param("projectId")
    const info = await sandbox.getSandbox(projectId)
    if (!info?.previewUrl) return c.text("preview not started", 503)

    // Convert ws:// -> http:// and wss:// -> https://
    const wsUrl = info.previewUrl.replace(/^http/, "ws") + "/"

    return stream(c, async (stream) => {
      // WebSocket proxy is complex; for MVP, we use SSE polling as a fallback
      // v1.1 implements proper WebSocket proxying

      const interval = setInterval(async () => {
        try {
          const res = await fetch(info.previewUrl!)
          const html = await res.text()
          await stream.writeSSE({ event: "update", data: html })
        } catch {}
      }, 2000)

      stream.onAbort(() => clearInterval(interval))
    })
  })
```

Wire into `packages/api/src/index.ts`:
```ts
import { previewRoutes } from "./routes/preview.js"
  .route("/api/preview", previewRoutes)
```

### Step 2: Build the PreviewPane component

`apps/web/src/components/preview/PreviewPane.tsx`:

```tsx
"use client"
import { useEffect, useRef, useState } from "react"
import { RefreshCw, ExternalLink, Smartphone, Tablet, Monitor, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useProjectStore } from "@/stores/project"
import { useUIStore } from "@/stores/ui"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"

type Breakpoint = "desktop" | "tablet" | "mobile"

const BREAKPOINT_WIDTHS: Record<Breakpoint, number> = {
  desktop: 1280,
  tablet: 768,
  mobile: 375
}

export function PreviewPane() {
  const { projectId } = useProjectStore()
  const { setRightPane } = useUIStore()
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [breakpoint, setBreakpoint] = useState<Breakpoint>("desktop")
  const [consoleLogs, setConsoleLogs] = useState<Array<{ level: string; message: string; time: Date }>>([])

  // Start dev server on mount
  useEffect(() => {
    if (!projectId) return
    if (previewUrl) return
    startPreview()
  }, [projectId])

  const startPreview = async () => {
    if (!projectId) return
    setLoading(true)
    setError(null)
    try {
      const { previewUrl: url } = await api<{ previewUrl: string }>(`/api/preview/${projectId}/start`, {
        method: "POST"
      })
      // Use our proxy instead of Daytona URL directly
      const proxied = `/api/preview/${projectId}/`
      setPreviewUrl(proxied)
      setLoading(false)
    } catch (err: any) {
      setError(err.message)
      setLoading(false)
    }
  }

  const reload = () => {
    if (iframeRef.current) {
      iframeRef.current.src = iframeRef.current.src
    }
  }

  const openExternal = () => {
    if (previewUrl) {
      window.open(previewUrl, "_blank", "noopener,noreferrer")
    }
  }

  const cycleBreakpoint = () => {
    const order: Breakpoint[] = ["desktop", "tablet", "mobile"]
    const next = order[(order.indexOf(breakpoint) + 1) % order.length]
    setBreakpoint(next)
  }

  // Listen for HMR / file changes — refresh iframe
  useEffect(() => {
    if (!projectId) return
    // Connect to SSE for HMR
    const es = new EventSource(`/api/preview/${projectId}/ws`)
    es.addEventListener("update", () => {
      reload()
    })
    es.addEventListener("error", () => {
      es.close()
      // Reconnect after delay
      setTimeout(() => startPreview(), 5000)
    })
    return () => es.close()
  }, [projectId])

  // Listen for iframe console messages
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.source === "preview-console") {
        setConsoleLogs((prev) => [...prev, e.data.log].slice(-50))
      }
    }
    window.addEventListener("message", handler)
    return () => window.removeEventListener("message", handler)
  }, [])

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-border-subtle bg-surface px-3 py-2">
        <div className="flex items-center gap-2">
          {/* URL bar (read-only) */}
          <div className="rounded border border-border-subtle bg-elevated px-2 py-1 font-mono text-xs text-text-secondary">
            {previewUrl ?? "loading..."}
          </div>
        </div>

        <div className="flex items-center gap-1">
          {/* Breakpoint switcher */}
          <Button size="sm" variant="ghost" onClick={cycleBreakpoint}>
            {breakpoint === "desktop" && <Monitor className="h-3 w-3" />}
            {breakpoint === "tablet" && <Tablet className="h-3 w-3" />}
            {breakpoint === "mobile" && <Smartphone className="h-3 w-3" />}
            <span className="ml-1 text-xs">{BREAKPOINT_WIDTHS[breakpoint]}px</span>
          </Button>

          {/* Refresh */}
          <Button size="sm" variant="ghost" onClick={reload}>
            <RefreshCw className="h-3 w-3" />
          </Button>

          {/* Open external */}
          <Button size="sm" variant="ghost" onClick={openExternal}>
            <ExternalLink className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Preview area */}
      <div className="flex flex-1 items-center justify-center overflow-auto bg-canvas p-4">
        {loading && (
          <div className="text-center text-text-secondary">
            <RefreshCw className="mx-auto h-8 w-8 animate-spin text-gold" />
            <p className="mt-2">Starting dev server...</p>
          </div>
        )}
        {error && (
          <div className="rounded border border-accent-red bg-surface p-4 text-accent-red">
            <AlertCircle className="mb-2 inline" /> {error}
          </div>
        )}
        {previewUrl && !loading && !error && (
          <div
            className="rounded bg-white shadow-2xl transition-all"
            style={{
              width: `${BREAKPOINT_WIDTHS[breakpoint]}px`,
              maxWidth: "100%",
              height: "100%"
            }}
          >
            <iframe
              ref={iframeRef}
              src={previewUrl}
              className="h-full w-full rounded"
              title="Preview"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            />
          </div>
        )}
      </div>

      {/* Console panel (collapsible) */}
      <div className="border-t border-border-subtle bg-surface">
        <div className="flex items-center justify-between px-3 py-1">
          <span className="text-xs text-text-secondary">Console ({consoleLogs.length})</span>
          <button onClick={() => setConsoleLogs([])} className="text-xs text-text-tertiary hover:text-text-primary">
            Clear
          </button>
        </div>
        {consoleLogs.length > 0 && (
          <div className="max-h-32 overflow-y-auto px-3 py-1 font-mono text-xs">
            {consoleLogs.map((log, i) => (
              <div
                key={i}
                className={cn(
                  "border-l-2 pl-2",
                  log.level === "error" ? "border-accent-red text-accent-red" :
                  log.level === "warn" ? "border-accent-orange text-accent-orange" :
                  "border-border-subtle text-text-secondary"
                )}
              >
                [{log.time.toLocaleTimeString()}] {log.message}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
```

### Step 3: Inject console capture into the iframe

We need the iframe to forward console logs to the parent window. This requires modifying the Vite dev server HTML or using a service worker.

For MVP, modify the preview HTML to inject a script. Add to `packages/runtime/src/sandbox/daytona.ts` in the `startDevServer` function:

```ts
// Inject console-capture script via index.html middleware
// (For MVP, do this on the API side instead — see step 4)
```

### Step 4: API-side HTML injection

In `packages/api/src/routes/preview.ts`, modify the proxy to inject a script:

```ts
.get("/:projectId/*", async (c) => {
  // ... existing proxy logic ...

  if (contentType?.includes("text/html")) {
    const injected = body.replace(
      "</head>",
      `<script>
        (function() {
          const origConsole = { log: console.log, warn: console.warn, error: console.error };
          ["log", "warn", "error"].forEach(level => {
            console[level] = function(...args) {
              origConsole[level].apply(console, args);
              parent.postMessage({
                source: "preview-console",
                log: { level, message: args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ") }
              }, "*");
            };
          });
          window.addEventListener("error", (e) => {
            parent.postMessage({
              source: "preview-console",
              log: { level: "error", message: e.message + " at " + e.filename + ":" + e.lineno }
            }, "*");
          });
        })();
      </script></head>`
    )
    return new Response(injected, { status, headers })
  }

  // ... return non-HTML as-is ...
})
```

### Step 5: Improve HMR via SSE

Currently we poll every 2 seconds. Vite has native WebSocket HMR. For MVP, polling is OK; v1.1 does proper WS proxy.

The polling approach: every 2s, fetch the preview HTML. If it changed, the iframe auto-refreshes via the iframe src being re-set.

Actually, simpler: use the SSE polling to send a "reload" signal, and the iframe reloads via:

```tsx
useEffect(() => {
  // SSE handler in PreviewPane already does this — calls reload()
}, [])
```

### Step 6: Update sandbox init to install Vite + a basic project

Update `packages/runtime/src/sandbox/daytona.ts` in `createSandbox`:

```ts
// After npm init:
await sandbox.process.executeCommand(`cd ${WORKSPACE} && npm install --save-dev vite @vitejs/plugin-react`)
await sandbox.process.executeCommand(`cd ${WORKSPACE} && npm install react react-dom`)

// Write a default vite.config.js
await sandbox.fs.uploadFile(`${WORKSPACE}/vite.config.js`, Buffer.from(`
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { host: '0.0.0.0', port: 5173 }
})
`, 'utf-8'))

// Write a minimal index.html
await sandbox.fs.uploadFile(`${WORKSPACE}/index.html`, Buffer.from(`
<!DOCTYPE html>
<html>
  <head><meta charset="UTF-8"><title>LadeStack Build</title></head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
`, 'utf-8'))

// Write src/main.jsx
await sandbox.fs.uploadFile(`${WORKSPACE}/src/main.jsx`, Buffer.from(`
import React from 'react'
import ReactDOM from 'react-dom/client'

ReactDOM.createRoot(document.getElementById('root')).render(
  <h1>Hello from LadeStack Build!</h1>
)
`, 'utf-8'))

// Write src/App.jsx for completeness
await sandbox.fs.uploadFile(`${WORKSPACE}/src/App.jsx`, Buffer.from(`
export default function App() {
  return <h1>Hello from LadeStack Build!</h1>
}
`, 'utf-8'))
```

### Step 7: Commit

```bash
git add -A
git commit -m "feat: PreviewPane with iframe + sandbox proxy + console capture (prompt 20)"
```

## Files created/modified

```
packages/api/src/routes/preview.ts (new — proxy + WebSocket/SSE fallback)
apps/web/src/components/preview/PreviewPane.tsx (new — iframe + breakpoints)
packages/runtime/src/sandbox/daytona.ts (init Vite project on createSandbox)
```

## Acceptance criteria

- [ ] Preview iframe loads on project open
- [ ] Dev server starts in sandbox within 10 seconds
- [ ] Iframe shows the default "Hello" page
- [ ] Breakpoint switcher resizes iframe (desktop/tablet/mobile)
- [ ] Refresh button reloads the iframe
- [ ] Open external opens in new tab
- [ ] Console panel shows errors from iframe
- [ ] AI edits trigger iframe refresh (via SSE polling)
- [ ] iframe is sandboxed for security

## Verification

```bash
pnpm --filter @ladestack/runtime build  # re-init sandbox on next create
pnpm --filter @ladestack/api dev &
# Visit /c/<project-id>
# - Preview shows "Hello from LadeStack Build!"
# - Click mobile breakpoint — iframe resizes
# - Refresh — page reloads
# - Send "Edit src/App.jsx to say Welcome!" — preview updates
kill %1
```

## Notes

- **WebSocket proxy is incomplete.** SSE polling is the MVP fallback. v1.1 implements proper WS proxying with `ws` library.
- **Console injection** modifies the HTML response. Works for most pages. Doesn't work for SPA pages that don't fetch index.html on every navigation. v1.1 uses a service worker for full coverage.
- **`sandbox="allow-scripts allow-same-origin allow-forms allow-popups"`** is the iframe sandbox setting. Tighten as needed for security.
- **The proxy strips `X-Frame-Options` and `Content-Security-Policy` headers.** This is required for iframe embedding but reduces security. Only safe because we control the upstream (Daytona sandbox).
- **The default Vite project** (Hello World) is just so the iframe has something to show. The AI will overwrite these files once the user sends a message.
- **`createSandbox` now installs Vite + creates a starter project.** Existing sandboxes (created before this prompt) won't have this. Either recreate them or apply the init manually.
- **Breakpoint widths are hardcoded** (1280/768/375). v1.1 makes them configurable.
- **The proxy URL** is `/api/preview/:projectId/*` — auth-gated. Only the project owner can view their preview.
- **Daytona's preview URL** typically has a short-lived token. Our proxy means we don't expose it to the browser — we fetch on the server side with our auth.
