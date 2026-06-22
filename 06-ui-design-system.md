# Design System: LadeStack Build

**Status:** Draft v1 (2026-06-22)
**Related:** PRD.md, system-design.md, agent-loop.md

---

## 1. Brand foundation

**LadeStack brand voice (from brand guide):**
- Sharp, minimal, developer-first
- Direct, confident, slightly technical
- No buzzwords, no fluff, no filler
- Sentence case

**Visual identity (inherited from LadeStack portfolio v1):**
- **Palette:** Deep Navy + Gold
- **Type:** Sans-serif primary (Inter), mono secondary (JetBrains Mono)
- **Mood:** Premium minimalist, dark-mode default, restrained accent color

---

## 2. Color tokens

```css
/* Dark theme (default) */
--bg-canvas:      #0A0E1A;     /* deepest background */
--bg-surface:     #0F1424;     /* panel background */
--bg-elevated:    #161B2E;     /* modal, dropdown */
--bg-overlay:     rgba(10, 14, 26, 0.85);  /* modal backdrop */

--border-subtle:  #1F2742;     /* default borders */
--border-default: #2D3656;     /* hover borders */
--border-strong:  #4A5580;     /* focus rings */

--text-primary:   #E8EAF1;     /* headings, body */
--text-secondary: #A0A8C0;     /* captions, labels */
--text-tertiary:  #6B7395;     /* placeholders */
--text-disabled:  #4A5070;

--accent-gold:    #D4A574;     /* primary accent (LadeStack gold) */
--accent-gold-hi: #E6BC8A;     /* hover */
--accent-gold-lo: #8C6F4F;     /* pressed */
--accent-purple:  #7C5DDB;     /* AI/agent indicator */
--accent-blue:    #4A90E2;     /* info, links */
--accent-green:   #4CAF7C;     /* success */
--accent-red:     #E25C5C;     /* error */
--accent-orange:  #E8924C;     /* warning */

/* Light theme (alt) */
--bg-canvas:      #FAFAFC;
--bg-surface:     #FFFFFF;
--bg-elevated:    #FFFFFF;
/* ... mirrors dark, with adjusted contrast */
```

---

## 3. Typography

```css
--font-sans: 'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
--font-mono: 'JetBrains Mono', 'Fira Code', Menlo, monospace;

--text-xs:   11px / 16px;   /* captions, tooltips */
--text-sm:   13px / 20px;   /* body small, code */
--text-base: 14px / 22px;   /* body */
--text-md:   16px / 24px;   /* emphasized body */
--text-lg:   18px / 28px;   /* small headings */
--text-xl:   22px / 30px;   /* section headings */
--text-2xl:  28px / 36px;   /* page headings */
--text-3xl:  36px / 44px;   /* hero */

--weight-regular: 400;
--weight-medium:  500;
--weight-semibold: 600;
--weight-bold:    700;

--tracking-tight:  -0.02em;
--tracking-normal:  0;
--tracking-wide:   0.02em;
```

---

## 4. Spacing & radius

```css
--space-1:  4px;
--space-2:  8px;
--space-3:  12px;
--space-4:  16px;
--space-5:  20px;
--space-6:  24px;
--space-8:  32px;
--space-10: 40px;
--space-12: 48px;
--space-16: 64px;

--radius-sm:   4px;
--radius-md:   8px;
--radius-lg:   12px;
--radius-xl:   16px;
--radius-full: 9999px;
```

---

## 5. Layout: the 3-pane IDE

```
┌──────────────────────────────────────────────────────────────────────┐
│ TopBar (48px)                                                       │
│ ┌──────┬──────────────────────────────┬──────────────────────────┐ │
│ │ Logo │ Project name · branch · ⎇   │ Deploy · GitHub · Avatar  │ │
│ └──────┴──────────────────────────────┴──────────────────────────┘ │
├──────────┬─────────────────────────────────┬───────────────────────┤
│ Sidebar  │       Center pane               │   Preview pane         │
│ (240px)  │   (resizable, default 50%)      │   (resizable, 50%)     │
│          │                                 │                       │
│ File tree│   ┌───────────────────────┐     │  ┌─────────────────┐  │
│          │   │ Tab bar (open files)  │     │  │ URL bar         │  │
│          │   ├───────────────────────┤     │  │ [desktop][tablet│  │
│          │   │                       │     │  │  [mobile]       │  │
│          │   │   Monaco editor       │     │  ├─────────────────┤  │
│          │   │                       │     │  │                 │  │
│          │   │                       │     │  │   iframe        │  │
│          │   │                       │     │  │   preview       │  │
│          │   │                       │     │  │                 │  │
│          │   │                       │     │  │                 │  │
│          │   └───────────────────────┘     │  │                 │  │
│          │                                 │  │                 │  │
│          │                                 │  └─────────────────┘  │
│          │                                 │   Console panel       │
│          │                                 │   (collapsible)       │
└──────────┴─────────────────────────────────┴───────────────────────┘
```

When chat is open, the center pane becomes **chat-first** (chat occupies 60%, editor 40%).

### Chat-active layout:

```
┌──────────────────────────────────────────────────────────────────────┐
│ TopBar                                                              │
├─────────────────────────────────────┬───────────────────────────────┤
│ Chat panel                          │   Editor + Preview           │
│ (60% width, resizable)              │   (40% width, vertical stack) │
│                                     │                              │
│ Messages stream here                │   ┌──────────┬──────────┐   │
│                                     │   │ Monaco   │ Preview  │   │
│ [User msg]                          │   │          │          │   │
│                                     │   └──────────┴──────────┘   │
│ [Assistant msg + tool calls]        │                              │
│                                     │                              │
│ ┌─────────────────────────────┐    │                              │
│ │ Chat input                   │    │                              │
│ │ [Plan/Build] [Send]          │    │                              │
│ └─────────────────────────────┘    │                              │
└─────────────────────────────────────┴───────────────────────────────┘
```

### Responsive behavior

- **Desktop (≥ 1280px):** all 3 panes visible
- **Tablet (768-1279px):** 2 panes visible, toggle third via tabs
- **Mobile (< 768px):** single-pane with bottom nav (preview / code / chat)

---

## 6. Key components (shadcn/ui based)

### 6.1 Chat message bubble

```tsx
<Message role={msg.role} agent={msg.agent} status={msg.status}>
  <MarkdownRenderer content={msg.content} />
  {msg.toolCalls?.map(call => (
    <ToolCallCard key={call.id} call={call} />
  ))}
  {msg.usage && (
    <UsageBadge tokens={msg.usage.tokensIn + msg.usage.tokensOut} cost={msg.usage.costCents} />
  )}
</Message>
```

**Visual states:**
- `role: user` → right-aligned, bg-elevated, no border
- `role: assistant, agent: build` → left-aligned, bg-surface, left border = accent-gold
- `role: assistant, agent: plan` → left border = accent-purple
- `role: tool` → collapsible card, dimmer, mono font
- `status: streaming` → pulsing dot in corner
- `status: error` → red border + error icon

### 6.2 Tool call card

```
┌─────────────────────────────────────────────────────┐
│ ✓ read package.json                       234 ms  ▾ │
├─────────────────────────────────────────────────────┤
│ {                                                    │
│   "name": "next",                                    │
│   "version": "14.2.0",                               │
│   ...                                                │
│ }                                                    │
└─────────────────────────────────────────────────────┘
```

- Green check + green left-border when successful
- Red x + red left-border when errored
- Collapsed by default if 5+ tool calls; expand to see all
- Click to see input/output JSON

### 6.3 Chat input

```tsx
<ChatInput
  mode={mode}              // 'plan' | 'build'
  onModeChange={setMode}
  onSend={handleSend}
  disabled={!isIdle}
  attachments={images}
  onAttachmentAdd={...}
  placeholder="Describe what to build..."
/>
```

**Visual:**
```
┌──────────────────────────────────────────────────────┐
│ [textarea, 1-6 rows, auto-grow]                      │
│                                                       │
│ [📎 image] [🎤 voice] [📋 attach context] [⚙️]    │
│                                                       │
│ Plan | Build              [model: Claude Sonnet ▾] [Send ➤]
└──────────────────────────────────────────────────────┘
```

### 6.4 Preview iframe

```tsx
<PreviewFrame
  src={previewUrl}
  breakpoint={breakpoint}    // 'desktop' | 'tablet' | 'mobile'
  onError={(e) => showInConsole(e)}
  onLoad={() => hideSpinner()}
/>
```

**Toolbar:**
- URL bar (locked to assigned subdomain + path)
- Breakpoint switcher (3 icons)
- Refresh button
- Open in new tab
- Console toggle

**Console panel:**
- Errors in red, warnings in orange, logs in default
- "Copy all" button
- "Clear" button
- Source mapped to file:line

### 6.5 File tree

```tsx
<FileTree
  nodes={files}
  onSelect={openFile}
  selected={activeTab}
  dirty={dirtyPaths}
  onContextMenu={showFileMenu}
/>
```

**Visual:**
- Indented tree (8px per level)
- Folder chevrons (rotate on expand)
- File icons by extension (.tsx = purple, .css = blue, .json = orange, .md = gray)
- Dirty indicator (•) next to modified files
- Right-click menu: rename, delete, duplicate, download

### 6.6 TopBar

```tsx
<TopBar
  project={project}
  gitStatus={gitStatus}
  onDeploy={openDeployDialog}
  onGitHub={openGitHubDialog}
  user={user}
/>
```

**Elements (left → right):**
- LadeStack logo
- Project name (editable inline)
- Branch indicator (click to switch branches in v2)
- Auto-save status (✓ saved 2s ago)

**Elements (right → left):**
- Deploy button (green when live, gray when none)
- GitHub sync button (✓ synced / ⚠ push / —)
- Token usage indicator (today: 12k / 100k)
- User avatar (dropdown: settings, billing, sign out)

---

## 7. Empty / loading / error states

### 7.1 Empty states

**New project (no files yet):**
```
┌──────────────────────────────────────┐
│                                       │
│            ✨                        │
│                                       │
│   Build something with AI            │
│                                       │
│   Try: "Build me a SaaS landing      │
│   page for a productivity app"       │
│                                       │
│   [Start with template ▾]            │
│   [Start from screenshot]            │
│   [Start blank]                      │
│                                       │
└──────────────────────────────────────┘
```

**First message sent, agent thinking:**
- Animated dots in chat
- Preview pane shows skeleton (gray boxes mimicking next.js loading)
- After 3s: "Still working... (started 3s ago, 5 tool calls so far)"

### 7.2 Loading states

- **Vite dev server starting:** spinner with "Starting dev server..."
- **Build in progress:** progress bar + "Compiling 23 of 47 modules"
- **Deploy in progress:** stepper (build → upload → assign domain)

### 7.3 Error states

**LLM API down:**
```
┌──────────────────────────────────────┐
│ ⚠ AI temporarily unavailable        │
│                                      │
│ We're having trouble reaching the    │
│ AI provider. Your work is saved.     │
│                                      │
│ [Retry] [Use fallback model]         │
└──────────────────────────────────────┘
```

**Sandbox crashed:**
```
┌──────────────────────────────────────┐
│ ⚠ Preview server crashed             │
│                                      │
│ Restarting... (usually takes 5s)     │
│                                      │
│ [Force restart] [Open logs]          │
└──────────────────────────────────────┘
```

**Build error (TypeScript):**
- Red squiggle in Monaco (normal Monaco behavior)
- Inline card in chat: "⚠ Type error in src/app/page.tsx:23 — implicit any. Fix it?"
- Agent auto-corrects in next turn

---

## 8. Animation & motion

**Principles:**
- Subtle, fast (150-300ms for most transitions)
- Purpose-driven (loading, completion, attention)
- Reduce-motion friendly (respect `prefers-reduced-motion`)

**Specific animations:**
- **Chat message arrival:** slide up + fade in (200ms)
- **Tool call execution:** pulse on the card border (1s loop while running)
- **Tool call complete:** brief green flash (300ms)
- **Preview refresh:** subtle fade between old/new (150ms) — Vite HMR handles most of this
- **File save:** small ✓ icon appears briefly next to filename (1s)
- **Plan mode toggle:** mode chip slides to new position (250ms ease-out)

**No animation for:**
- Mouse hover (color change is enough)
- Page transitions (instant — this is a tool, not a marketing site)

---

## 9. Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Cmd/Ctrl + Enter` | Send message |
| `Cmd/Ctrl + .` | Toggle Plan/Build mode |
| `Cmd/Ctrl + K` | Quick command palette (search files, jump to symbol) |
| `Cmd/Ctrl + S` | Save current file (auto-saves anyway, but feedback) |
| `Cmd/Ctrl + P` | Command palette |
| `Cmd/Ctrl + B` | Toggle file tree |
| `Cmd/Ctrl + J` | Toggle chat panel |
| `Cmd/Ctrl + /` | Toggle preview pane |
| `Cmd/Ctrl + Shift + P` | Open preview in new tab |
| `Esc` | Cancel in-flight request |
| `?` | Show shortcuts cheatsheet |

---

## 10. Accessibility (WCAG 2.2 AA)

- All text meets 4.5:1 contrast (dark theme validated)
- All interactive elements keyboard-reachable
- Focus rings visible (border-strong, 2px)
- Screen reader labels on icon-only buttons
- ARIA live regions for chat streaming
- Skip-to-content link on app pages
- Reduce-motion respected
- Color is never the only signal (icons + text accompany color states)

---

## 11. Component inventory (MVP)

Build order:

1. `ChatPanel` + `Message` + `ChatInput` (priority 1)
2. `ToolCallCard` (priority 1)
3. `PreviewFrame` + `ConsolePanel` (priority 1)
4. `FileTree` + `Editor` (priority 1)
5. `TopBar` (priority 1)
6. `PlanReviewDialog` (priority 2)
7. `SettingsDialog` (priority 2)
8. `UsageBadge` (priority 2)
9. `EmptyState`, `LoadingState`, `ErrorState` (priority 2)
10. `CommandPalette` (priority 3)
11. `KeyboardShortcutsDialog` (priority 3)

**Stack:** shadcn/ui primitives + custom LadeStack components in `src/components/ui/`.

---

## 12. Design tokens → CSS variables

All tokens exported as CSS variables in `src/styles/tokens.css`:

```css
:root {
  /* colors, spacing, typography, radius from above */
}

@media (prefers-color-scheme: light) {
  :root.theme-light { /* light overrides */ }
}
```

Use via Tailwind config:
```ts
// tailwind.config.ts
theme: {
  extend: {
    colors: {
      canvas: 'var(--bg-canvas)',
      surface: 'var(--bg-surface)',
      elevated: 'var(--bg-elevated)',
      gold: 'var(--accent-gold)',
      'gold-hi': 'var(--accent-gold-hi)',
      // ...
    },
    fontFamily: {
      sans: 'var(--font-sans)',
      mono: 'var(--font-mono)',
    },
  },
}
```

---

## 13. What we explicitly DON'T do in v1

- ❌ Drag-and-drop file upload to file tree (use file picker)
- ❌ Multiple cursors / collaborative editing (defer to v2)
- ❌ Custom themes / theme editor
- ❌ Light theme polish (works but minimal effort)
- ❌ Onboarding animations (simple walkthrough modal only)
- ❌ Emoji-heavy UI (LadeStack brand is restrained)

---

**End of design.md** — next: skill.md
