# Prompt 21: Coder Productivity Skills Bundle

## Goal

Ship the **testing + code review + debugging + performance + docs + git** skill bundle — 18 curated `SKILL.md` files that the skills loader (prompt 18) auto-discovers. These teach the assistant disciplined engineering workflows (TDD, blameless code review, systematic debugging, performance measurement) so it doesn't just generate code — it generates code that ships safely.

## Context (from prompts 01-20)

- Skills discovery service scans `bundled/<name>/SKILL.md` (prompt 18)
- Programming bundle (24 skills) and DevOps bundle (22 skills) shipped in prompts 19-20
- 1 starter skill (`build-agent`) from prompt 18. Total bundled now: 47
- Skill format spec: `../../07-ai-skill-definition.md` — **read this first if you haven't**

**Sources these skills are curated from** (all MIT/Apache 2.0 — see Notes):
- [`wshobson/agents`](https://github.com/wshobson/agents) — heavy testing + debugging coverage
- [`antigravity-awesome-skills`](https://github.com/sickn33/antigravity-awesome-skills) — 560 skills
- [`anthropics/skills`](https://github.com/anthropics/skills) — `webapp-testing`, `doc-coauthoring`, `internal-comms`
- [`subsy/ralph-tui/skills`](https://github.com/subsy/ralph-tui) — TUI patterns
- Authored practices: TDD (Beck), systematic debugging, blameless review

## Task

### Step 1: SKILL.md template reminder

Same template as prompts 19-20. Frontmatter + body with When to invoke / Core patterns / Anti-patterns / Examples / Related skills / References.

### Step 2: Testing — `tdd`

`packages/runtime/src/skill/bundled/tdd/SKILL.md`:

```markdown
---
name: tdd
displayName: Test-Driven Development
description: TDD — red-green-refactor, writing tests first, choosing the next test, keeping the cycle short. Use when writing new code, especially with a safety bar.
whenToUse:
  - Add new code with tests
  - Refactor with confidence
  - Diagnose where a behavior should live
  - Bootstrap a bug fix
version: 1.0.0
author: curated from wshobson/agents + Kent Beck "Test-Driven Development"
license: MIT
tags: [tdd, testing, red-green-refactor, unit-tests, junit, vitest]
agents: [build, refactor, code-reviewer]
tools: [read, write, edit, bash]
load: on-demand
---

# Test-Driven Development

Red → Green → Refactor. The discipline is the cycle, not the tests.

## When to invoke

- Implementing a new function / endpoint / module
- Reproducing a bug before fixing it
- Refactoring safely
- Onboarding to a codebase (test = executable spec)

## Core patterns

### Red — write a failing test first

The test names behavior, not implementation.

\`\`\`ts
test("applies percentage discount", () => {
    expect(applyDiscount(100, 10)).toBe(90)
})
\`\`\`

Confirm it fails for the right reason (`Expected 90, received undefined` — not a syntax error).

### Green — write the minimum code to pass

\`\`\`ts
function applyDiscount(price: number, pct: number): number {
    return price - (price * pct) / 100
}
\`\`\`

Don't add features the test doesn't demand.

### Refactor — clean up with the test as a safety net

- Remove duplication.
- Rename for clarity.
- Keep tests green after every refactor commit.

### Choose the next test

- **Triangulate** — write a second test with different inputs to force a more general implementation.
- **Obvious implementation** — if the code is trivial (e.g., `add`), skip the red step.
- **One to many** — write a test for "one", then a test for "many", then implement.

### Test taxonomy

- **Unit** — pure function, no I/O.
- **Integration** — multiple units + I/O.
- **End-to-end** — full system via UI / API.
- **Property-based** — generate inputs (fast-check, hypothesis).

### Anti-test anti-patterns

- Tests that depend on each other.
- Tests that depend on real time / network.
- Assertions inside `setUp` that silently fail.
- 100% line coverage as a goal (encourages vacuous tests).

## Anti-patterns

❌ **Tests written after code "to pass CI"** — they encode current behavior, not desired behavior.
❌ **One mega-test that exercises 30 things** — breaks debuggability.
❌ **`sleep(1000)` instead of awaiting a signal** — flaky.
❌ **Mocking the system under test** — tests pass, code is broken.
❌ **Coverage as a goal** — write tests that catch real bugs.

## Examples

### Bug fix as TDD

1. **Red** — write a test that reproduces the bug:
   \`\`\`ts
   test("rejects empty input", () => {
       expect(() => parse("")).toThrow(EmptyInputError)
   })
   \`\`\`
2. **Green** — make it pass.
3. **Refactor** — clean up.

## Related skills

- `test-fixing` — repair broken tests
- `e2e-testing` — full-stack patterns
- `playwright-expert` — browser E2E

## References

- [Kent Beck, "Test-Driven Development by Example"](https://www.pearson.com/en-us/subject-catalog/p/test-driven-development-by-example/P200000000257/9780321146533)
- [Test Desiderata (Kent Beck)](https://medium.com/@kentbeck_7670/test-desiderata-5fda1f5e8b04)
```

### Step 3: `test-fixing`

`packages/runtime/src/skill/bundled/test-fixing/SKILL.md`:

```markdown
---
name: test-fixing
displayName: Test Fixing
description: Systematic test repair — distinguishing flaky, broken, wrong-target failures; isolating root cause; surgical fixes. Use when tests fail and you don't know why.
whenToUse:
  - Diagnose failing tests in CI
  - Distinguish flaky from broken tests
  - Repair tests that no longer reflect the spec
  - Stabilize a flaky suite
version: 1.0.0
author: curated from wshobson/agents
license: MIT
tags: [testing, flaky, ci, debugging, test-repair]
agents: [build, refactor, code-reviewer]
tools: [read, write, edit, bash]
load: on-demand
---

# Test Fixing

Don't immediately "fix" a failing test. Diagnose first.

## When to invoke

- A test fails in CI but passes locally
- A test suite becomes flaky
- A test fails after a refactor
- You're tempted to `.skip` something

## Core patterns

### Classify the failure

\`\`\`
Failure categories:
  F1 — Flaky (passes on rerun, no code change)
  F2 — Broken by recent change (passes on previous commit)
  F3 — Wrong target (test asserts the wrong behavior)
  F4 — Missing setup (test depends on missing fixture)
  F5 — Environment (DB / network / clock)
\`\`\`

### F1 — Flaky

- **Time-dependent** — replace `Date.now()` or `new Date()` injection.
- **Order-dependent** — tests share global state; reset between tests.
- **Network-dependent** — use a fake server or `MSW` / `nock` / `WireMock`.
- **Race condition** — use `findBy*` (testing-library) instead of `getBy*`.

### F2 — Broken by change

\`\`\`bash
git bisect start
git bisect bad HEAD
git bisect good <last-green-commit>
# run the test at each step
\`\`\`

### F3 — Wrong target

- **Test was wrong from day one.** Update both the test and the code if the new behavior is intentional; update only the test if not.
- Add a regression test that pins the corrected behavior.

### F4 — Missing setup

- Add factory; share via fixture file.
- Use `beforeEach` to reset state; not `beforeAll`.

### F5 — Environment

- Pin versions in CI (lockfile).
- Use ephemeral DB / Docker image.
- Inject clock via `vi.useFakeTimers()` (Vitest) / `jest.useFakeTimers()`.

### Decision tree

\`\`\`
Failure in CI?
├── Fails locally too
│   ├── Recent change? → bisect (F2)
│   └── Always? → F3 or F4
└── Passes locally
    ├── Rerun? → if pass, F1
    └── Always fail in CI only? → F5
\`\`\`

## Anti-patterns

❌ **`.skip` or `.todo`** instead of fixing — debt compounds.
❌ **`sleep(1000)` in tests** — masks races.
❌ **Re-running CI until green** — never solve, just hide.
❌ **Mocking the system under test** — see `tdd`.
❌ **Touching production code to make a test pass without understanding why** — usually a sign the test was right.

## Related skills

- `tdd` — write the test right first time
- `systematic-debugging` — beyond tests
- `phase-gated-debugging` — strict protocol

## References

- [Google Testing Blog: Flaky Tests](https://testing.googleblog.com/)
- [Martin Fowler: Eradicating Non-Determinism in Tests](https://martinfowler.com/articles/nonDeterminism.html)
```

### Step 4: `e2e-testing`

`packages/runtime/src/skill/bundled/e2e-testing/SKILL.md`:

```markdown
---
name: e2e-testing
displayName: E2E Testing Patterns
description: End-to-end testing — full-stack flows, isolation per test, deterministic waits, seeding strategies. Use when building a reliable E2E suite.
whenToUse:
  - Build a Playwright or Cypress suite
  - Stabilize a flaky E2E suite
  - Cover a critical user journey
  - Test cross-service flows
version: 1.0.0
author: curated from wshobson/agents + playwright.dev
license: MIT
tags: [e2e, end-to-end, playwright, cypress, integration, isolation]
agents: [build, refactor, code-reviewer]
tools: [read, write, edit, bash]
load: on-demand
---

# E2E Testing Patterns

Reliable E2E: deterministic, isolated, fast feedback.

## When to invoke

- Authoring a critical-path E2E suite
- Stabilizing a flaky E2E pipeline
- Seeding test data reproducibly
- Choosing Playwright vs Cypress

## Core patterns

### Test isolation

- **Per-test database** — use a transaction that rolls back; or a fresh DB per test.
- **Per-test user** — don't share a session across tests.
- **Unique URLs / names** — avoid collisions when running parallel.

### Deterministic waits

\`\`\`ts
// Playwright — auto-wait locators
await page.getByRole("button", { name: /submit/i }).click()
await expect(page.getByTestId("success")).toBeVisible()

// Avoid this
await page.waitForTimeout(1000)
\`\`\`

### Data factories

\`\`\`ts
function userFactory(overrides: Partial<User> = {}): User {
    return { id: faker.string.uuid(), email: faker.internet.email(), ...overrides }
}
\`\`\`

### API-state setup (don't click through the UI)

\`\`\`ts
test("shows order", async ({ page, request }) => {
    const order = await request.post("/api/orders", { data: orderFactory() })
    await page.goto(`/orders/${order.id}`)
    await expect(page.getByRole("heading")).toContainText(order.id)
})
\`\`\`

### Network mocking

\`\`\`ts
await page.route("**/api/payments", (route) => route.fulfill({ json: { ok: true } }))
\`\`\`

### Auth setup reuse

\`\`\`ts
test.use({ storageState: "auth/user.json" })
\`\`\`

### CI parallelism

\`\`\`ts
// playwright.config.ts
projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }]
workers: process.env.CI ? 4 : undefined
\`\`\`

### Trace on failure

\`\`\`ts
use: { trace: "on-first-retry", video: "retain-on-failure" }
\`\`\`

## Anti-patterns

❌ **`page.waitForTimeout`** — masks races.
❌ **Test depends on another test's state** — break isolation, parallel run breaks.
❌ **Same user session across tests** — order matters; can't parallelize.
❌ **`page.click` with CSS selectors** — use role / text / test-id.
❌ **E2E test for unit-testable behavior** — slower feedback.

## Related skills

- `playwright-expert` — Playwright specifics
- `tdd` — unit-level discipline
- `webapp-testing` — Anthropic's QA skill

## References

- [Playwright best practices](https://playwright.dev/docs/best-practices)
- [Cypress best practices](https://docs.cypress.io/guides/references/best-practices)
```

### Step 5: `playwright-expert`

`packages/runtime/src/skill/bundled/playwright-expert/SKILL.md`:

```markdown
---
name: playwright-expert
displayName: Playwright Expert
description: Playwright — locator strategies, parallel runs, traces, fixtures, component testing, API testing. Use when authoring or operating Playwright.
whenToUse:
  - Build Playwright tests
  - Configure parallelism and sharding
  - Read trace viewer output
  - Add component tests
version: 1.0.0
author: curated from wshobson/agents + playwright.dev
license: MIT
tags: [playwright, e2e, testing, locators, traces, fixtures, components]
agents: [build, refactor, code-reviewer]
tools: [read, write, edit, bash]
load: on-demand
---

# Playwright Expert

Playwright (test runner + browser automation). Multi-language: TS, Python, .NET, Java.

## When to invoke

- Authoring a Playwright suite
- Configuring projects / workers / sharding
- Debugging a flake via trace viewer
- Setting up component testing

## Core patterns

### Locator strategy — role / text / label / test-id

\`\`\`ts
// Best (semantic)
page.getByRole("button", { name: /save/i })
page.getByLabel("Email")
page.getByText("Welcome")

// Acceptable
page.getByTestId("submit-btn")

// Last resort
page.locator("[data-testid=submit-btn]")
\`\`\`

### Auto-waiting

\`\`\`ts
await page.getByRole("button", { name: /save/i }).click()
await expect(page.getByTestId("status")).toHaveText("Saved")
\`\`\`

No `waitForTimeout` — Playwright waits for actionability.

### Fixtures

\`\`\`ts
import { test as base } from "@playwright/test"

export const test = base.extend<{ app: App }>({
    app: async ({ page }, use) => {
        const app = new App(page)
        await app.goto()
        await use(app)
        await app.cleanup()
    },
})
\`\`\`

### Traces / videos / screenshots

\`\`\`ts
// playwright.config.ts
use: {
    trace: "on-first-retry",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
}
\`\`\`

\`\`\`bash
bunx playwright show-trace test-results/.../trace.zip
\`\`\`

### Component testing

\`\`\`ts
import { test, expect } from "@playwright/experimental-ct-react"
import { Counter } from "./Counter"

test("increments", async ({ mount }) => {
    const component = await mount(<Counter />)
    await component.getByRole("button", { name: "+" }).click()
    await expect(component).toContainText("1")
})
\`\`\`

### API testing

\`\`\`ts
test("GET /users returns 200", async ({ request }) => {
    const res = await request.get("/api/users")
    expect(res.status()).toBe(200)
})
\`\`\`

### Sharding in CI

\`\`\`bash
bunx playwright test --shard=1/4
bunx playwright test --shard=2/4
# merge with --merge-reports
bunx playwright merge-reports --reporter html ./all-results
\`\`\`

## Anti-patterns

❌ **`.locator("css")` everywhere** — use role/test-id.
❌ **`waitForLoadState("networkidle")`** — flaky on long-polling apps.
❌ **Page object model that's a wrapper for every action** — over-engineering.
❌ **No `test.beforeEach` cleanup** — test pollution.
❌ **Single huge `chromium` project** — add `webkit` / `firefox` for cross-browser sanity.

## Related skills

- `e2e-testing` — general E2E
- `webapp-testing` — Anthropic skill

## References

- [Playwright docs](https://playwright.dev/docs/intro)
- [Trace viewer](https://playwright.dev/docs/trace-viewer)
```

### Step 6: `webapp-testing`

`packages/runtime/src/skill/bundled/webapp-testing/SKILL.md`:

```markdown
---
name: webapp-testing
displayName: Webapp Testing (Anthropic)
description: Webapp testing — full app QA, dev-server automation, build verification, multi-page testing with Playwright. Use when running comprehensive tests against a running web app.
whenToUse:
  - Run end-to-end tests against a local dev server
  - Verify a build / deploy works
  - Generate test code for a UI
  - QA multi-page flows
version: 1.0.0
author: anthropics/skills (webapp-testing) — MIT
license: MIT
tags: [testing, webapp, qa, e2e, playwright, dev-server]
agents: [build, code-reviewer]
tools: [read, write, edit, bash]
load: on-demand
---

# Webapp Testing

Adapted from Anthropic's `webapp-testing` skill. Comprehensive QA against a running app.

## When to invoke

- Verifying a deploy / build before release
- Running scripted smoke tests after deploy
- Generating test code from manual exploration
- QA a multi-page app

## Core patterns

### Spin up the dev server

\`\`\`bash
bun run dev > /tmp/dev.log 2>&1 &
DEV_PID=$!
# wait for "ready"
\`\`\`

### Smoke test via Playwright

\`\`\`ts
import { test, expect } from "@playwright/test"

test("home loads", async ({ page }) => {
    await page.goto("http://localhost:3000")
    await expect(page.getByRole("heading")).toBeVisible()
})

test("login flow", async ({ page }) => {
    await page.goto("/login")
    await page.getByLabel("Email").fill("test@example.com")
    await page.getByLabel("Password").fill("password")
    await page.getByRole("button", { name: /sign in/i }).click()
    await page.waitForURL("/dashboard")
    await expect(page.getByTestId("user-menu")).toBeVisible()
})
\`\`\`

### Multi-page traversal

\`\`\`ts
for (const path of ["/", "/about", "/pricing", "/docs"]) {
    test(\`loads \${path}\`, async ({ page }) => {
        const res = await page.goto(path)
        expect(res?.status()).toBeLessThan(400)
    })
}
\`\`\`

### Capture artifacts

\`\`\`ts
use: { video: "retain-on-failure", screenshot: "only-on-failure", trace: "on-first-retry" }
\`\`\`

### Build verification

\`\`\`bash
bun run build
bunx serve dist &
SERVE_PID=$!
bunx playwright test
kill $SERVE_PID
\`\`\`

### Visual regression (optional)

\`\`\`ts
await expect(page).toHaveScreenshot("home.png", { maxDiffPixels: 200 })
\`\`\`

## Anti-patterns

❌ **Tests against `localhost` of someone else's machine** — pin the port / use container.
❌ **No cleanup of dev server** — orphans in CI.
❌ **UI tests for behavior better covered by unit tests** — slower feedback.
❌ **Login via UI for every test** — set up session via API once.

## Related skills

- `e2e-testing` — patterns
- `playwright-expert` — tool specifics

## References

- [Anthropic Skills: webapp-testing](https://github.com/anthropics/skills/tree/main/skills/webapp-testing)
- [Playwright docs](https://playwright.dev/)
```

### Step 7: Review — `code-review-excellence`

`packages/runtime/src/skill/bundled/code-review-excellence/SKILL.md`:

```markdown
---
name: code-review-excellence
displayName: Code Review Excellence
description: Code review craft — feedback taxonomy, severity labels, scope discipline, blameless tone, learning mindset. Use when reviewing or training reviewers.
whenToUse:
  - Review a pull request
  - Train a reviewer
  - Calibrate team norms
  - Audit your own review comments
version: 1.0.0
author: curated from wshobson/agents + Google engineering practices
license: MIT
tags: [code-review, pr, feedback, blameless, severity, scope]
agents: [code-reviewer, refactor, build]
tools: [read, write, edit]
load: on-demand
---

# Code Review Excellence

Review for the codebase, not the author.

## When to invoke

- Reviewing a PR (PR > 200 LOC, multiple files, behavior change)
- Calibrating team feedback norms
- Auditing your own reviews for tone
- Resolving disagreements

## Core patterns

### Feedback taxonomy

Prefix every comment with severity:

- **🔴 blocker** — must fix before merge (bug, security, data loss)
- **🟡 important** — strongly recommend fixing
- **🟢 nit** — style / preference; author can ignore
- **💡 question** — clarification only
- **📚 learn** — link to a doc / article; not a blocker

\`\`\`markdown
🟡 important: this query could N+1 under load — consider using a JOIN or DataLoader.
\`\`\`

### Scope discipline

- **Stay in scope.** Out-of-scope improvements → new ticket, not this PR.
- **Don't bundle a refactor with a bug fix.** Two reviews, two PRs.

### What to look for

- Correctness (logic, error paths)
- Security (auth, input validation, secrets)
- Performance (N+1, O(n²) loops)
- Readability (names, structure)
- Tests (covering the change?)
- Observability (logs / metrics / traces added?)
- Backwards compatibility (API, data)

### Tone

- **Question, don't demand.** "Would it make sense to…" vs "Don't do X."
- **Explain why.** "This N+1s under load" not just "this is slow."
- **Suggest, don't prescribe.** Provide an alternative, not just criticism.

### Resolving disagreements

1. Defer to the author's judgement unless it's a blocker.
2. If reviewer disagrees, escalate to another reviewer.
3. Document the decision in the PR for future readers.

### Review checklist (use as PR template)

\`\`\`markdown
## PR checklist
- [ ] Tests cover new behavior
- [ ] No new lint / type errors
- [ ] No secrets / credentials in code
- [ ] Changelog / migration noted
- [ ] Docs updated (if user-visible)
- [ ] Observability hooks in place (logs / metrics)
\`\`\`

## Anti-patterns

❌ **LGTM after 30 seconds** — review theater.
❌ **"Why didn't you just…"** — implies the author is stupid.
❌ **Blocking PR over style when linters exist** — let the linter enforce.
❌ **Reviewing your own PR with approval** — defeats the purpose.
❌ **Scope creep disguised as "while you're here"** — separate PR.

## Related skills

- `requesting-code-review` — the other side
- `simplify-code` — applying review feedback
- `code-reviewer` — security-focused review

## References

- [Google Engineering Practices: Code Review](https://google.github.io/eng-practices/review/)
- [Conventional Comments](https://conventionalcomments.org/)
```

### Step 8: `requesting-code-review`

`packages/runtime/src/skill/bundled/requesting-code-review/SKILL.md`:

```markdown
---
name: requesting-code-review
displayName: Requesting Code Review
description: How to request a good code review — PR description, scope, screenshots, "what to focus on", pre-review self-checks. Use when opening a PR or asking for review.
whenToUse:
  - Open a pull request
  - Ask a teammate for review
  - Pre-submission self-review
  - Write a PR description
version: 1.0.0
author: curated from wshobson/agents
license: MIT
tags: [pr, code-review, pull-request, description, self-review]
agents: [build, refactor]
tools: [read, write, edit]
load: on-demand
---

# Requesting Code Review

Help the reviewer help you. Most PRs are reviewed poorly because they're described poorly.

## When to invoke

- Opening a PR
- Drafting a PR description
- Doing a pre-submission self-review
- Re-requesting review after changes

## Core patterns

### PR description template

\`\`\`markdown
## What
One-sentence summary of the change.

## Why
The problem it solves, with a link to the ticket / discussion.

## How
Brief technical summary. Optional: tradeoffs, alternatives considered.

## Testing
- [ ] Unit tests added/updated
- [ ] Manual test steps
- [ ] Screenshots / recordings (for UI)

## Risks
What could go wrong? Rollback plan?

## What to focus on
Areas where you're uncertain or want a second opinion.
\`\`\`

### "What to focus on"

Always include. Tells the reviewer where to spend their attention:

\`\`\`
Focus on:
- The cache-invalidation logic in `cache.ts` — first time using this pattern.
- The migration script — irreversible without ops involvement.
\`\`\`

### Pre-submission self-review

Walk through your own diff before requesting review:

1. Re-read your own diff as if you're seeing it for the first time.
2. Run the test suite locally.
3. Run linters / type checks.
4. Read the PR description — would a stranger understand?
5. Are there any debugging artifacts (`console.log`, commented-out code)?
6. Did you update related docs / changelog?

### Size matters

- Aim for < 400 LOC changed.
- Split larger changes into stacked PRs.
- One PR = one logical change.

### Reviewer selection

- **Codebase owner** — if there's a clear owner.
- **2 reviewers for risky changes** (auth, data, billing).
- **Avoid reviewers with no context** — they'll rubber-stamp.
- **For cross-team work** — add a reviewer from each team.

### Responding to feedback

- Reply to every comment (even "done").
- Push back if you disagree — with reasoning.
- After addressing, re-request review.

## Anti-patterns

❌ **"Fix stuff" as a PR title** — uninformative.
❌ **No description** — reviewer has to read the diff to know the goal.
❌ **Reviewer has to ask "why?"** — that's your job to preempt.
❌ **PR with 50 files changed** — break it up.
❌ **Marking all comments resolved without reply** — looks dismissive.

## Related skills

- `code-review-excellence` — reviewer's guide
- `simplify-code` — applying feedback
- `git-pr-review` — git CLI for PRs

## References

- [GitHub: Best practices for pull requests](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests)
```

### Step 9: `simplify-code`

`packages/runtime/src/skill/bundled/simplify-code/SKILL.md`:

```markdown
---
name: simplify-code
displayName: Simplify Code
description: Code simplification — removing dead code, deduplication, naming, structural cleanup without changing behavior. Use when cleaning up after a feature lands or a review requests simplification.
whenToUse:
  - Reduce duplication
  - Improve naming
  - Remove dead / commented-out code
  - Apply "simplify" review feedback
version: 1.0.0
author: curated from wshobson/agents + Refactoring (Fowler)
license: MIT
tags: [refactor, simplify, dedupe, naming, dead-code, cleanup]
agents: [refactor, code-reviewer, build]
tools: [read, write, edit, grep, bash]
load: on-demand
---

# Simplify Code

Behavior-preserving cleanup. Tests stay green.

## When to invoke

- Cleaning up after a feature lands
- A review requests "simplify this"
- Spotting duplication as it emerges
- Reducing surface area of an API

## Core patterns

### The refactor checklist

- [ ] Tests exist and pass
- [ ] Behavior is locked in (snapshot / property tests help)
- [ ] One thing at a time (commit per refactor)
- [ ] Re-run tests after each commit

### Dead code removal

\`\`\`bash
# Find unused exports
bunx ts-prune
# Find unused dependencies
bunx depcheck
# Find unused functions
rg --no-heading "function (\w+)" | rg -v "\1\(" | head
\`\`\`

Remove: unused exports, commented-out code, "we might need this later" code, dead branches.

### Extract function / variable

\`\`\`ts
// Before
function processOrder(o: Order) {
    const t = o.items.reduce((s, i) => s + i.price * i.qty, 0)
    if (t > 1000) console.log("big order")
    // ...
}

// After
const orderTotal = (o: Order) => o.items.reduce((s, i) => s + i.price * i.qty, 0)
function processOrder(o: Order) {
    if (orderTotal(o) > 1000) console.log("big order")
    // ...
}
\`\`\`

### Rename for clarity

- Names should reveal intent. `d` → `elapsedDays`.
- Use IDE rename (refactor, not search-and-replace).
- Don't rename public API without a deprecation path.

### Inline trivial wrappers

If a function just calls another with the same args, it's noise:

\`\`\`ts
const getUser = (id: string) => db.user.findUnique({ where: { id } })
\`\`\`

If used in 3+ places, keep. If 1, inline.

### Replace magic numbers / strings

\`\`\`ts
if (status === 3) ...
// →
enum Status { Active = 3, Inactive = 4 }
if (status === Status.Active) ...
\`\`\`

### Parallel agent cleanup (advanced)

Three concurrent agents, each with the same scope but a different lens:

- Agent A: remove dead code.
- Agent B: dedupe.
- Agent C: rename for clarity.

Reviewer picks best suggestions. (Inspired by `refactor-helper` patterns.)

## Anti-patterns

❌ **Refactor + feature in one PR** — undo on review is painful.
❌ **Behavior change disguised as refactor** — tests must remain green; if they don't, it's a feature.
❌ **Renaming things reviewers asked you not to rename** — respect scope.
❌ **Premature abstraction** — wait for the third use case before extracting.
❌ **"Drive-by" changes unrelated to the PR** — split into a separate commit.

## Related skills

- `code-review-excellence` — reviewer's perspective
- `requesting-code-review` — PR hygiene
- `brooks-lint` — automated quality checks

## References

- [Refactoring (Fowler, 2nd ed.)](https://refactoring.com/)
- [Working Effectively with Legacy Code (Feathers)](https://www.pearson.com/en-us/subject-catalog/p/working-effectively-with-legacy-code/P200000000508/9780131177055)
```

### Step 10: `code-reviewer`

`packages/runtime/src/skill/bundled/code-reviewer/SKILL.md`:

```markdown
---
name: code-reviewer
displayName: Code Reviewer (security-focused)
description: Security-flavored code review — auth, input validation, secrets, dependency CVEs, OWASP categories. Use when reviewing changes with security implications.
whenToUse:
  - Review auth / authz code
  - Review inputs and validation
  - Audit for secrets / credentials
  - Check OWASP Top 10 in a diff
version: 1.0.0
author: curated from wshobson/agents + OWASP
license: MIT
tags: [security, code-review, owasp, secrets, authn, authz]
agents: [code-reviewer, security-reviewer, build]
tools: [read, write, edit, grep]
load: on-demand
---

# Code Reviewer (security-focused)

Combine with `code-review-excellence` for tone. This skill adds a security lens.

## When to invoke

- Reviewing auth flows
- Reviewing file uploads / deserialization
- Auditing dependency changes
- Reviewing admin / privileged paths

## Core patterns

### OWASP Top 10 — quick scan

| # | Risk | Look for |
|---|---|---|
| A01 | Broken Access Control | Authz checks on every route; IDOR via path params |
| A02 | Cryptographic Failures | TLS only; no MD5/SHA1 for security; key in env |
| A03 | Injection | Parameterized queries; output encoding; no `eval` |
| A04 | Insecure Design | Threat model? Rate limiting? Lock-out? |
| A05 | Security Misconfig | Default creds; debug mode; open CORS |
| A06 | Vulnerable Components | `npm audit`; lockfile changes; abandoned packages |
| A07 | Auth Failures | Strong password rules; MFA; secure session |
| A08 | Data Integrity | Signed updates; CSRF tokens |
| A09 | Logging Failures | Auth events logged; no PII in logs |
| A10 | SSRF | URL allow-list; metadata IP block |

### Auth checks

- Authn: who is this user?
- Authz: is this user allowed to do this?
- Both checked at every privileged endpoint?
- Server-side, not client-side.

### Input validation

\`\`\`ts
// Use a schema; never trust the request body
const input = CreateUserSchema.parse(req.body)   // throws on bad input
\`\`\`

### Secret scan in PR

\`\`\`bash
gitleaks detect --source . --no-banner
\`\`\`

### Dependency audit

\`\`\`bash
bun audit                            # built-in
bunx better-npm-audit audit
# or
snyk test
\`\`\`

### Review comments for security

\`\`\`markdown
🔴 blocker: this query is constructed by string concatenation — switch to a parameterized query (SQL injection, A03).
\`\`\`

## Anti-patterns

❌ **Trusting client-set headers for auth** — server must verify.
❌ **Custom crypto** — use vetted libraries.
❌ **Secrets in code, even briefly** — block on PR; force rotate if merged.
❌ **Mass-allow in CORS** — list specific origins.
❌ **JWT in localStorage** — accessible to any XSS; prefer httpOnly cookies.

## Related skills

- `security-reviewer` — broader security skill
- `owasp-top-10` — full OWASP map
- `secret-scanner` — automated detection
- `code-review-excellence` — tone + non-security review

## References

- [OWASP Top 10](https://owasp.org/Top10/)
- [Google Web Security guidelines](https://developers.google.com/web/fundamentals/security)
```

### Step 11: `brooks-lint`

`packages/runtime/src/skill/bundled/brooks-lint/SKILL.md`:

```markdown
---
name: brooks-lint
displayName: Brooks Lint
description: Automated code-quality lint patterns — beyond ESLint. Naming, complexity, duplication, error-handling smells, dependency hygiene. Use when setting up quality gates.
whenToUse:
  - Configure quality gates
  - Audit a codebase for smells
  - Extend ESLint / oxlint rules
  - Catch duplicates and dead code
version: 1.0.0
author: curated from wshobson/agents
license: MIT
tags: [lint, code-quality, complexity, duplication, dead-code, quality-gate]
agents: [code-reviewer, refactor]
tools: [read, write, edit, bash, grep]
load: on-demand
---

# Brooks Lint

Quality gates that go beyond ESLint's default ruleset.

## When to invoke

- Adding quality gates to CI
- Auditing a codebase for smells
- Extending ESLint / oxlint
- Establishing team coding standards

## Core patterns

### Complexity

\`\`\`bash
bunx eslint . --rule '{"complexity": ["error", 10]}'        # cyclomatic
bunx eslint . --rule '{"max-lines-per-function": ["error", 50]}'
bunx eslint . --rule '{"max-depth": ["error", 4]}'
\`\`\`

Also: ESLint `sonarjs` plugin for cognitive complexity.

### Naming

- Variables / functions: descriptive nouns/verbs; no abbreviations.
- Classes / types: PascalCase; nouns.
- Constants: UPPER_SNAKE_CASE for module-level immutable values.
- Booleans: `is*`, `has*`, `can*`, `should*`.

\`\`\`ts
const isAdmin = user.role === "admin"
const canEditPost = isAdmin || post.authorId === user.id
\`\`\`

### Duplication detection

\`\`\`bash
bunx jscpd src --reporters html
\`\`\`

Threshold: < 3% duplication. Reject PRs that add significant dupes.

### Dead code

\`\`\`bash
bunx ts-prune                # unused exports
bunx knip                    # unused files / deps
bunx depcheck                # unused dependencies
\`\`\`

### Error-handling smells

- Swallowed exceptions: \`\`\`catch {}\`\`\` — log at minimum.
- Generic catch: \`\`\`catch (e) {}\`\`\` — narrow to specific types.
- Throw string instead of Error — `throw new Error("...")`.
- Re-throw without `throw e` — preserves stack.

### Dependency hygiene

- Pin in lockfile.
- Audit on every PR (`bun audit`).
- Watch for typosquat packages (`bunx socket` to detect).
- Avoid bringing in a whole library for one function (`is-odd`, etc.).

### Pre-commit gate

\`\`\`yaml
# .pre-commit-config.yaml
repos:
  - repo: local
    hooks:
      - id: typecheck
        name: typecheck
        entry: bun run typecheck
        language: system
        pass_filenames: false
      - id: lint
        name: lint
        entry: bun run lint
        language: system
        pass_filenames: false
\`\`\`

## Anti-patterns

❌ **`eslint-disable` without comment** — debt hides.
❌ **Custom lint rules to enforce style over readability** — bikeshed.
❌ **Disable rules globally to make CI pass** — defeats the gate.
❌ **`@ts-ignore` everywhere** — use `@ts-expect-error` with a reason.
❌ **Linter warnings as "non-blocking"** — they multiply.

## Related skills

- `simplify-code` — applying refactor feedback
- `code-review-excellence` — manual review
- `code-reviewer` — security review

## References

- [Refactoring (Fowler)](https://refactoring.com/)
- [ESLint rules](https://eslint.org/docs/latest/rules/)
```

### Step 12: Debugging — `debugger`

`packages/runtime/src/skill/bundled/debugger/SKILL.md`:

```markdown
---
name: debugger
displayName: Debugger (breakpoints)
description: Using a debugger — breakpoints, step-through, conditional breakpoints, watch expressions, logpoints. Use when `console.log` isn't enough.
whenToUse:
  - Step through code
  - Set conditional breakpoints
  - Inspect call stacks and scopes
  - Debug a Node.js / Bun / browser process
version: 1.0.0
author: curated from wshobson/agents
license: MIT
tags: [debugging, breakpoints, devtools, inspector, vscode]
agents: [build, refactor]
tools: [read, write, edit, bash]
load: on-demand
---

# Debugger

Beyond `console.log`. The fastest way to understand unfamiliar code is to step through it.

## When to invoke

- Bug doesn't reproduce from logs
- Tracing through async code
- Understanding a third-party library
- Investigating flaky behavior

## Core patterns

### VS Code launch config

\`\`\`json
// .vscode/launch.json
{
    "version": "0.2.0",
    "configurations": [
        {
            "type": "node",
            "request": "launch",
            "name": "Debug tests",
            "program": "${workspaceFolder}/node_modules/.bin/bun",
            "args": ["test", "${file}"],
            "console": "integratedTerminal"
        }
    ]
}
\`\`\`

### Node / Bun inspector

\`\`\`bash
node --inspect-brk dist/server.js
bun --inspect dist/server.js
# Chrome DevTools → chrome://inspect
\`\`\`

### Conditional breakpoints

In DevTools / VS Code: right-click → "Edit breakpoint" → condition.

\`\`\`js
user.id === "target-user-123"
\`\`\`

### Logpoints

Non-breaking log: DevTools / VS Code → "Add logpoint".

\`\`\`js
"hit checkout for user " + user.id
\`\`\`

Useful for hot paths you can't pause.

### Watch expressions

\`\`\`
cart.items.length
user.permissions.includes("admin")
\`\`\`

### Call stacks

Use the call stack pane to navigate up/down. Click a frame to inspect its locals.

### Step commands

- **Step over** — execute current line, don't enter functions.
- **Step into** — enter the next function call.
- **Step out** — return to the caller.
- **Continue** — run to next breakpoint.

### Async debugging

- DevTools has "Async stack traces" toggle — turns nested callbacks into a chain.
- Use `--async-stack-traces` flag in Node.

### Memory profiling

\`\`\`bash
node --inspect dist/server.js
# Heap snapshot → look at retained size
\`\`\`

## Anti-patterns

❌ **Debugger step-through for trivial bugs** — `console.log` is faster.
❌ **Modifying code to add breakpoints** — use the IDE, not source edits.
❌ **Running in production with `--inspect`** — security risk; debug elsewhere.
❌ **Skipping the call stack pane** — often the answer is "who called this?"
❌ **Stepping into library internals repeatedly** — skip them; step out.

## Related skills

- `systematic-debugging` — protocol for finding the bug
- `diagnosing-bugs` — performance regression patterns
- `phase-gated-debugging` — strict protocol

## References

- [VS Code: Node.js debugging](https://code.visualstudio.com/docs/nodejs/nodejs-debugging)
- [Chrome DevTools docs](https://developer.chrome.com/docs/devtools/)
```

### Step 13: `systematic-debugging`

`packages/runtime/src/skill/bundled/systematic-debugging/SKILL.md`:

```markdown
---
name: systematic-debugging
displayName: Systematic Debugging
description: 4-phase debugging protocol — reproduce, isolate, root-cause, fix. Use when facing a non-trivial bug, especially under time pressure.
whenToUse:
  - Bug doesn't have an obvious cause
  - Time pressure on incident response
  - Multiple plausible hypotheses
  - Bug has been "almost fixed" before
version: 1.0.0
author: curated from wshobson/agents + debugging literature
license: MIT
tags: [debugging, root-cause, protocol, reproduce, isolate, hypothesis]
agents: [build, refactor, code-reviewer]
tools: [read, write, edit, bash, grep]
load: on-demand
---

# Systematic Debugging

Process beats intuition. Especially under pressure.

## When to invoke

- Bug report is vague ("it doesn't work sometimes")
- Multiple changes recently, hard to bisect
- Previous fix attempts failed
- Production incident in progress

## Core patterns

### Phase 1 — Reproduce

\`\`\`
Inputs:
- Exact steps
- Environment (versions, data, time)
- Expected vs actual

Goal: reproduce deterministically (or characterize the flakiness).
\`\`\`

If you can't reproduce, gather more info — don't guess.

### Phase 2 — Isolate

\`\`\`
Where in the system is the bug?
- Bisect commits (\`git bisect\`)
- Bisect inputs (smallest failing input)
- Bisect code path (remove layers)
\`\`\`

Goal: narrow to one component / function / line.

### Phase 3 — Root cause

\`\`\`
Why is it failing?
- Read the code, don't guess.
- Form a hypothesis, design an experiment.
- Use the debugger or logs to verify.
- Repeat until the hypothesis explains all observed behavior.
\`\`\`

Common shortcuts (be skeptical):

- "It worked yesterday" — what changed?
- "It works on my machine" — what's different?
- "Flaky test" — usually not flaky; usually an order / timing bug.

### Phase 4 — Fix + verify

- Fix addresses root cause, not symptom.
- Add a regression test (TDD-style, see `tdd` skill).
- Verify the fix:
  - Original repro now passes.
  - Existing tests still pass.
  - New regression test fails before fix, passes after.
- Document the cause in the commit message.

### Hypothesis table

\`\`\`markdown
| # | Hypothesis | Test | Result |
|---|---|---|---|
| 1 | DB connection leak | Count conns over time | Confirmed |
| 2 | Network timeout | Check timeout config | Refuted |
| 3 | Bad data shape | Log incoming payload | Refuted |
\`\`\`

### Bisect

\`\`\`bash
git bisect start
git bisect bad HEAD
git bisect good v1.2.2
# automated test at each step
git bisect run bun test
\`\`\`

## Anti-patterns

❌ **Skipping reproduction** — you can't fix what you can't reproduce.
❌ **"Try this" without a hypothesis** — random changes accumulate risk.
❌ **Fixing the symptom** — bug recurs in a different form.
❌ **No regression test** — same bug returns in 6 months.
❌ **Debugging in prod without a feature flag** — blast radius.

## Related skills

- `debugger` — using the debugger tool
- `diagnosing-bugs` — perf regressions
- `phase-gated-debugging` — strict 5-phase protocol

## References

- [The Art of Debugging (Matthias)](https://nostarch.com/debugging.htm)
- [Chrome DevTools: Debugging JavaScript](https://developer.chrome.com/docs/devtools/javascript/)
```

### Step 14: `diagnosing-bugs`

`packages/runtime/src/skill/bundled/diagnosing-bugs/SKILL.md`:

```markdown
---
name: diagnosing-bugs
displayName: Diagnosing Bugs (performance regressions)
description: Diagnosing performance regressions — flame graphs, profiling, before/after comparison, common patterns. Use when something got slower and you don't know why.
whenToUse:
  - Latency regression
  - Memory leak
  - CPU spike under load
  - "It got slow after deploy X"
version: 1.0.0
author: curated from wshobson/agents + Brendan Gregg
license: MIT
tags: [performance, profiling, flamegraph, regression, memory-leak, latency]
agents: [build, refactor, sre-engineer]
tools: [read, write, edit, bash]
load: on-demand
---

# Diagnosing Bugs (perf regressions)

Performance regressions are bugs. Treat them with the same protocol.

## When to invoke

- A latency SLO is burning
- Memory grows unbounded
- CPU saturates after a deploy
- "It was fast before"

## Core patterns

### Phase 1 — Confirm

- Reproduce in a controlled environment.
- Quantify: was it 50ms p99, now 500ms? By how much?

### Phase 2 — Profile

\`\`\`bash
# CPU — V8
node --prof dist/server.js
node --prof-process isolate-*.log > processed.txt

# CPU — flame graph
bunx clinic doctor -- node dist/server.js
0x dist/server.js

# Heap snapshot
node --inspect dist/server.js   # then Heap snapshot in DevTools
\`\`\`

### Phase 3 — Read the profile

- **On-CPU flame graph** — what code is burning CPU? Wide bars = candidates.
- **Off-CPU flame graph** — what is the code waiting on? Network, locks, GC.
- **Heap snapshot** — what objects are retained? Compare 2 snapshots for leaks.

### Phase 4 — Hypothesize + verify

\`\`\`
Hypothesis: N+1 query in `getOrderDetails`.
Test: add a query count metric; observe 1 query per item.
Confirmed. Fix: JOIN.
\`\`\`

### Common regression patterns

- **N+1 query** — added a relation without batching.
- **Sync I/O in async path** — `fs.readFileSync` inside `await`-using function.
- **JSON.stringify huge objects** — in hot path / logging.
- **Missing index** — new query without matching index.
- **Closure capture in a hot loop** — allocates per iteration.
- **React re-render storm** — useMemo missing; parent re-renders cascade.
- **Memory leak** — listener / timer / closure retained.
- **Lock contention** — new shared lock on hot path.

### Diff the deploy

\`\`\`bash
git diff v1.2.2..v1.2.3 -- src/
# Look for: new dependencies, sync APIs, query changes, new middleware
\`\`\`

### Add a regression test

If you can write a perf test, do it. Most teams can't — capture a trace as the artifact.

## Anti-patterns

❌ **Optimizing without profiling** — guessing.
❌ **"Premature optimization" used as an excuse to skip diagnosis** — profile when it's broken, not before.
❌ **One big "performance fix" commit** — split into diagnosed cause + targeted fix.
❌ **Reverting without understanding** — same regression returns next deploy.
❌ **No baseline** — "is this faster?" requires a number to compare.

## Related skills

- `systematic-debugging` — general protocol
- `performance-optimizer` — code-level patterns
- `pagespeed-enhancer` — web vitals
- `monitoring-expert` — observability

## References

- [Brendan Gregg: Performance](https://www.brendangregg.com/)
- [0x: flame graph generator](https://github.com/davidmarkclements/0x)
- [Clinic.js](https://clinicjs.org/)
```

### Step 15: `phase-gated-debugging`

`packages/runtime/src/skill/bundled/phase-gated-debugging/SKILL.md`:

```markdown
---
name: phase-gated-debugging
displayName: Phase-Gated Debugging
description: Strict 5-phase debugging protocol — collect, hypothesize, instrument, fix, verify. Gated: no moving to next phase until current is complete. Use when debugging must be defensible (incidents, audits).
whenToUse:
  - Major incident in progress
  - Bug requires root cause for compliance
  - Team has "we tried this before" memory
  - Training new on-call engineers
version: 1.0.0
author: curated from wshobson/agents
license: MIT
tags: [debugging, protocol, incident, root-cause, audit]
agents: [build, refactor, sre-engineer]
tools: [read, write, edit, bash, grep]
load: on-demand
---

# Phase-Gated Debugging

Strict 5-phase protocol. No skipping. No guessing.

## When to invoke

- SEV-1 / SEV-2 incident
- Audit-required root cause
- You've been "stuck" for > 30 minutes
- Multiple teams need to align on cause

## Core patterns

### Phase 1 — Collect

- What changed recently? (deploys, configs, traffic)
- What's the symptom, exactly? (metric, error, log)
- Who's affected? (route, user, region)
- Reproduce in dev / staging.

**Gate:** can you state the symptom in one sentence with numbers?

### Phase 2 — Hypothesize

- List 3-5 plausible causes (brainstorm, don't filter).
- For each: how would you test it? What would you see if true? False?
- Rank by likelihood × testability.

**Gate:** do you have at least 2 testable hypotheses?

### Phase 3 — Instrument

- Add logs / metrics / traces that distinguish the hypotheses.
- Use existing dashboards when possible.
- Don't change production behavior to debug.

**Gate:** can your instrumentation confirm or refute each hypothesis?

### Phase 4 — Fix

- Choose the fix that addresses the **root cause**, not the symptom.
- If multiple causes, fix in priority order.
- Consider: rollback vs forward-fix. Rollback is faster; forward-fix teaches.

**Gate:** is the fix small enough to revert safely?

### Phase 5 — Verify

- Symptom no longer observed.
- Original repro passes.
- Existing tests still pass.
- New regression test added.
- Customer-visible impact communicated.

**Gate:** would this fix be reproducible by reading the diff + the postmortem?

### Anti-skip shortcuts

If you find yourself skipping a phase:

- "Just try this fix" → back to Phase 2.
- "I know what's wrong" → Phase 3 still required.
- "It's fixed" → Phase 5 still required.

## Anti-patterns

❌ **Skipping Phase 1** — you don't know if you fixed the right thing.
❌ **Single hypothesis** — confirmation bias.
❌ **"Just deploy the fix"** — without instrumentation, you can't verify.
❌ **No regression test** — same bug, 6 months from now.
❌ **Bypassing gates "because it's urgent"** — urgency is when protocols matter most.

## Related skills

- `systematic-debugging` — lighter-weight 4-phase
- `incident-runbook-templates` — operational response
- `postmortem-writing` — document after
- `parallel-debugging` — multi-agent debugging

## References

- [Google SRE Book: Incident Response](https://sre.google/sre-book/managing-incidents/)
- [Atlassian Incident Handbook](https://www.atlassian.com/incident-management/handbook)
```

### Step 16: Performance — `pagespeed-enhancer`

`packages/runtime/src/skill/bundled/pagespeed-enhancer/SKILL.md`:

```markdown
---
name: pagespeed-enhancer
displayName: PageSpeed Enhancer (Core Web Vitals)
description: Core Web Vitals — LCP, INP, CLS; image optimization, font loading, JS bundle splitting, prefetch, CDN. Use when improving real-user web performance.
whenToUse:
  - Improve LCP / INP / CLS
  - Reduce JS bundle size
  - Optimize images / fonts
  - Diagnose poor PageSpeed Insights score
version: 1.0.0
author: curated from wshobson/agents + web.dev
license: MIT
tags: [performance, web-vitals, lcp, inp, cls, bundle, images, fonts]
agents: [build, frontend-design, refactor]
tools: [read, write, edit, bash]
load: on-demand
---

# PageSpeed Enhancer

Core Web Vitals: LCP < 2.5s, INP < 200ms, CLS < 0.1.

## When to invoke

- PageSpeed Insights score dropped
- Users report sluggish UI
- Mobile experience is poor
- Bundle size growing

## Core patterns

### LCP — Largest Contentful Paint

- Preload the LCP image: `<link rel="preload" as="image" href="hero.webp">`.
- Serve responsive images with `srcset` + `sizes`.
- Use `fetchpriority="high"` on the LCP element.
- SSR the hero so it's in initial HTML.

### INP — Interaction to Next Paint

- Reduce JS work on the main thread.
- Break long tasks (> 50ms) with `scheduler.yield()` or chunking.
- Use `startTransition` for non-urgent updates.
- Avoid layout thrash — batch DOM reads/writes.

### CLS — Cumulative Layout Shift

- Always set `width` + `height` on images / videos.
- Reserve space for ads / embeds (`aspect-ratio`).
- Avoid inserting content above existing content.
- Use `font-display: swap` + `size-adjust` to minimize font-swap shift.

### Images

\`\`\`html
<img
    src="hero-800.avif"
    srcset="hero-400.avif 400w, hero-800.avif 800w, hero-1600.avif 1600w"
    sizes="(max-width: 600px) 100vw, 800px"
    width="1600" height="900"
    alt="Hero"
    loading="eager"
    fetchpriority="high"
/>
\`\`\`

### Fonts

\`\`\`html
<link rel="preload" href="/fonts/inter.woff2" as="font" type="font/woff2" crossorigin>
\`\`\`

Use `font-display: swap`; consider `size-adjust` to minimize CLS.

### JS bundle

\`\`\`ts
// Route-based splitting
const Checkout = lazy(() => import("./Checkout"))
\`\`\`

Analyze: `bunx source-map-explorer dist/main.js` or `bunx esbuild --metafile`.

### Prefetch / preload

- `<link rel="preconnect" href="https://api.example.com">` for critical origins.
- Speculation Rules API for prerender on hover.

### CDN + cache

- Set `Cache-Control: public, max-age=31536000, immutable` on hashed assets.
- Use CDN edge caching for HTML with appropriate `stale-while-revalidate`.

## Anti-patterns

❌ **Lazy-loading the LCP image** — delays the hero.
❌ **Render-blocking 3rd-party scripts** (analytics, chat widgets).
❌ **Unoptimized PNG hero images** — use AVIF/WebP.
❌ **Sync `<script>` in `<head>`** — defer or async.
❌ **Animations on layout-affecting properties** — use `transform`/`opacity`.

## Related skills

- `performance-optimizer` — code-level patterns
- `react-expert` — bundle splitting
- `nextjs-app-router-patterns` — RSC streaming

## References

- [web.dev: Core Web Vitals](https://web.dev/vitals/)
- [PageSpeed Insights](https://pagespeed.web.dev/)
```

### Step 17: `performance-optimizer`

`packages/runtime/src/skill/bundled/performance-optimizer/SKILL.md`:

```markdown
---
name: performance-optimizer
displayName: Performance Optimizer
description: Code-level performance patterns — caching, memoization, batching, big-O reduction, async pipelines. Use when a function or service is too slow.
whenToUse:
  - Reduce function time complexity
  - Add caching
  - Batch I/O
  - Profile hot paths
version: 1.0.0
author: curated from wshobson/agents
license: MIT
tags: [performance, big-o, caching, memoization, batching, profiling]
agents: [build, refactor]
tools: [read, write, edit, bash]
load: on-demand
---

# Performance Optimizer

Measure first, optimize second. Big wins come from algorithmic change, not micro-optimization.

## When to invoke

- A function takes > 100ms for its inputs
- N+1 patterns
- Hot path identified via profiling
- Repeated identical work

## Core patterns

### Algorithmic first

\`\`\`
O(n²)   → O(n log n) — sort + binary search
O(n²)   → O(n)     — hash map lookup
O(n)    → O(1)     — precompute / memoize
\`\`\`

### Caching

- **Memoization** — pure functions; cache by args.
- **TTL cache** — short-lived (10s–10m) for external calls.
- **LRU** — bounded memory; for unbounded input spaces.

\`\`\`ts
const memo = new Map<string, User>()
function getUser(id: string): User {
    let u = memo.get(id)
    if (!u) { u = db.user.find(id); memo.set(id, u) }
    return u
}
\`\`\`

### Batching

\`\`\`ts
// Bad — N+1
for (const id of ids) await db.user.find(id)

// Good — one round-trip
const users = await db.user.findMany({ where: { id: { in: ids } } })
const map = new Map(users.map(u => [u.id, u]))
const resolved = ids.map(id => map.get(id))
\`\`\`

### Concurrency

\`\`\`ts
// Sequential
for (const u of urls) await fetch(u)
// Parallel (with limit!)
await Promise.all(urls.map(u => limit(() => fetch(u))))
\`\`\`

Use a semaphore / pool — `Promise.all` of 10k fetches will melt a process.

### Data structures

- `Map` / `Set` for O(1) lookup.
- Avoid `Array.includes` in loops → `Set.has`.
- Avoid `Array.find` in loops → index map.

### Strings

- Avoid repeated `JSON.parse(JSON.stringify(x))` — use a structured clone.
- Avoid `+=` in tight loops — `Array.push` then `join`.

### Memory

- Avoid closures that retain large objects.
- Stream large files instead of reading fully.
- `WeakMap` / `WeakSet` when lifetime matters.

### Hot-path discipline

- No logging in tight loops (use sampling).
- No allocation in inner loops (reuse buffers).
- Avoid `try/catch` in JS hot paths historically (now JIT-friendly).

## Anti-patterns

❌ **Micro-optimizations before profiling** — Knuth's "premature optimization".
❌ **Caching mutable data without invalidation** — stale reads.
❌ **Memoizing impure functions** — wrong cached values.
❌ **`Promise.all` of unbounded work** — resource exhaustion.
❌ **Caching by reference equality** — won't hit on new objects.

## Related skills

- `pagespeed-enhancer` — web vitals
- `complexity-cuts` — algorithmic rewrites
- `diagnosing-bugs` — perf regression protocol

## References

- [High Performance Browser Networking (Grigorik)](https://hpbn.co/)
- [Effective Java (Bloch) — Item on lazy init](https://www.pearson.com/en-us/subject-catalog/p/effective-java/P200000000508/9780134685991)
```

### Step 18: `complexity-cuts`

`packages/runtime/src/skill/bundled/complexity-cuts/SKILL.md`:

```markdown
---
name: complexity-cuts
displayName: Complexity Cuts
description: Reducing algorithmic complexity — O(n²) → O(n log n), O(n) → O(1), turning scans into indexed lookups. Use when a slow operation has a structural fix.
whenToUse:
  - Nested loops over large datasets
  - Repeated linear scans
  - Repeated computation in a hot path
  - Constant-time lookups possible
version: 1.0.0
author: curated from wshobson/agents
license: MIT
tags: [algorithm, complexity, big-o, optimization, data-structures]
agents: [build, refactor]
tools: [read, write, edit]
load: on-demand
---

# Complexity Cuts

The biggest performance wins come from changing the algorithm, not tweaking constants.

## When to invoke

- O(n²) or worse in production code
- Input size growing → perf degrades non-linearly
- "It's fast enough for 100, but we have 100,000"

## Core patterns

### O(n²) → O(n) with a hash map

\`\`\`ts
// Before
function intersection(a: number[], b: number[]) {
    return a.filter(x => b.includes(x))   // O(n*m)
}

// After
function intersection(a: number[], b: number[]) {
    const setB = new Set(b)
    return a.filter(x => setB.has(x))     // O(n + m)
}
\`\`\`

### O(n²) → O(n log n) with sort + two pointers

\`\`\`ts
// Before
function twoSum(nums: number[], target: number) {
    for (let i = 0; i < nums.length; i++)
        for (let j = i + 1; j < nums.length; j++)
            if (nums[i] + nums[j] === target) return [i, j]
}

// After
function twoSum(nums: number[], target: number) {
    const sorted = nums.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0])
    let l = 0, r = sorted.length - 1
    while (l < r) {
        const s = sorted[l][0] + sorted[r][0]
        if (s === target) return [sorted[l][1], sorted[r][1]]
        if (s < target) l++; else r--
    }
}
\`\`\`

### O(n) → O(1) with precompute

\`\`\`ts
// Before — recompute prefix sum each call
function rangeSum(arr: number[], l: number, r: number) {
    let s = 0
    for (let i = l; i <= r; i++) s += arr[i]
    return s
}

// After — O(1) per query after O(n) prep
class PrefixSum {
    private prefix: number[]
    constructor(arr: number[]) {
        this.prefix = [0]
        for (const x of arr) this.prefix.push(this.prefix[this.prefix.length - 1] + x)
    }
    range(l: number, r: number) {
        return this.prefix[r + 1] - this.prefix[l]
    }
}
\`\`\`

### String concat in loop → join

\`\`\`ts
// Before — O(n²) on long strings
let out = ""
for (const s of parts) out += s + ","

// After — O(n)
const out = parts.join(",")
\`\`\`

### Frequent `array.find` → Map by key

\`\`\`ts
// Before — O(n) per lookup
for (const o of orders) {
    const user = users.find(u => u.id === o.userId)
    // ...
}

// After — O(1) per lookup after O(n) prep
const usersById = new Map(users.map(u => [u.id, u]))
for (const o of orders) {
    const user = usersById.get(o.userId)
    // ...
}
\`\`\`

### Trie for prefix lookups

For "does any of these strings start with X?", a trie gives O(L) lookup vs O(n) scan.

## Anti-patterns

❌ **Reaching for sort when an unsorted scan suffices** — sort is O(n log n).
❌ **`Map` for tiny constant-size data** — over-engineered.
❌ **Memoizing on references** — same value, new reference → cache miss.
❌ **Pre-compute when the workload is one-shot** — wasted work.
❌ **"I'll just add a cache"** — often a band-aid for the wrong algorithm.

## Related skills

- `performance-optimizer` — broader patterns
- `sql-optimization-patterns` — DB-level cuts
- `diagnosing-bugs` — perf regression diagnosis

## References

- [Big-O Cheat Sheet](https://www.bigocheatsheet.com/)
- [Introduction to Algorithms (CLRS)](https://mitpress.mit.edu/9780262033848/)
```

### Step 19: Docs — `doc-coauthoring`

`packages/runtime/src/skill/bundled/doc-coauthoring/SKILL.md`:

```markdown
---
name: doc-coauthoring
displayName: Doc Co-authoring (Anthropic)
description: Co-authoring documentation with the user — gather context, iterate, structure for the audience. Use when writing or reviewing a doc with a user.
whenToUse:
  - Help a user write a doc
  - Restructure an existing doc
  - Edit for a specific audience
  - Draft technical prose
version: 1.0.0
author: anthropics/skills (doc-coauthoring) — MIT
license: MIT
tags: [docs, writing, audience, structure, iteration]
agents: [build, tutorial-engineer]
tools: [read, write, edit]
load: on-demand
---

# Doc Co-authoring

Adapted from Anthropic's `doc-coauthoring` skill. Workflow for collaborative doc drafting.

## When to invoke

- User asks for help writing a doc
- User has notes / fragments and wants structure
- Audience is ambiguous
- A doc needs to be re-cast for a new audience

## Core patterns

### Phase 1 — Gather

\`\`\`
Questions to ask:
- Who is the audience? (engineers, executives, end users)
- What's the goal? (inform, persuade, instruct)
- What's the desired length? (1 page, 10 pages, ongoing)
- What format? (blog post, RFC, tutorial, runbook)
- What's the existing material?
\`\`\`

### Phase 2 — Outline

- Working outline first; refine iteratively.
- One-sentence-per-section.
- Surface contradictions before drafting.

### Phase 3 — Draft

- Short paragraphs (3-5 sentences).
- Use the audience's vocabulary (jargon if expert; plain if general).
- Lead with the conclusion; details follow.

### Phase 4 — Iterate

- Read aloud. Mark places you stumble.
- Cut anything that doesn't earn its place.
- Add concrete examples for every abstract claim.

### Audience profiles

\`\`\`markdown
Audience: Backend engineers, 5+ years experience, new to the project.
- Vocabulary: technical jargon OK.
- Examples: code-heavy.
- Length: detail is fine.

Audience: Product managers, no engineering background.
- Vocabulary: avoid jargon; define when used.
- Examples: user-journey / outcome-driven.
- Length: 1-2 pages.
\`\`\`

## Anti-patterns

❌ **Drafting before outlining** — wastes iteration cycles.
❌ **One big dump of text** — user can't review structurally.
❌ **Audience-agnostic voice** — sounds generic; serves no one.
❌ **Hedging language** ("might", "could", "perhaps") — erodes trust.
❌ **No concrete examples** — abstract prose doesn't teach.

## Related skills

- `internal-comms` — short status updates
- `tutorial-engineer` — step-by-step teaching
- `readme` — repo-level docs

## References

- [Anthropic Skills: doc-coauthoring](https://github.com/anthropics/skills/tree/main/skills/doc-coauthoring)
- [Style guides: Google Developer Documentation Style Guide](https://developers.google.com/style)
```

### Step 20: `readme`

`packages/runtime/src/skill/bundled/readme/SKILL.md`:

```markdown
---
name: readme
displayName: README Authoring
description: Writing a great README.md — what it must include, common sections, anti-patterns, audience focus. Use when creating or refreshing a project README.
whenToUse:
  - Author a README for a new project
  - Refresh an outdated README
  - Adopt a standard template
  - Make the project discoverable
version: 1.0.0
author: curated from wshobson/agents + standard practice
license: MIT
tags: [readme, docs, github, open-source, project]
agents: [build, refactor]
tools: [read, write, edit]
load: on-demand
---

# README Authoring

The README is the front door. Most readers won't go past it.

## When to invoke

- New repo / project
- README is stale or missing critical sections
- Onboarding friction is high
- Open-source release

## Core patterns

### Standard sections

\`\`\`markdown
# <Project Name>

<One-sentence tagline>

<Optional: badges (CI, license, version)>

## What is it?
Two-sentence description of the problem and solution.

## Why?
The motivation. Why does this exist? What did you try before?

## Quick start
\`\`\`bash
# 5-line install + runnable demo
\`\`\`

## Usage
\`\`\`ts
// minimal example
\`\`\`

## Documentation
Link to full docs site.

## Contributing
How to contribute; link to CONTRIBUTING.md.

## License
\`\`\`

### Open-source additions

- **Demo / screenshots** — GIF for UI projects.
- **Roadmap** — what's next, what's deferred.
- **Maintainers** — who to ping.
- **Code of conduct** — link.

### Tone

- Conversational but precise.
- Show, don't tell (links, screenshots, code blocks).
- Write for someone arriving from a search engine: title the value in the first paragraph.

## Anti-patterns

❌ **"This is awesome / amazing / cool"** — let the value speak.
❌ **Massive code blocks** — link to docs for detail.
❌ **Installation requiring 10 manual steps** — wrap in a script.
❌ **Missing Quick start** — the reader bounces.
❌ **"See the wiki"** — the wiki doesn't exist.

## Related skills

- `doc-coauthoring` — broader doc workflow
- `api-documentation` — for libraries
- `tutorial-engineer` — for end-user docs

## References

- [Make a README](https://www.makeareadme.com/)
- [Standard README](https://github.com/RichardLitt/standard-readme)
```

### Step 21: `api-documentation`

`packages/runtime/src/skill/bundled/api-documentation/SKILL.md`:

```markdown
---
name: api-documentation
displayName: API Documentation
description: API documentation — OpenAPI 3.1, request/response examples, error schemas, authentication, rate limits. Use when authoring or refreshing API docs.
whenToUse:
  - Author OpenAPI / Swagger spec
  - Document a new endpoint
  - Refresh existing API docs
  - Generate SDK reference
version: 1.0.0
author: curated from wshobson/agents + swagger.io
license: MIT
tags: [api, openapi, swagger, docs, sdk, rest]
agents: [build, refactor, tutorial-engineer]
tools: [read, write, edit, bash]
load: on-demand
---

# API Documentation

OpenAPI 3.1 for REST. Document behavior, not just shapes.

## When to invoke

- New public API
- Doc-rot on existing API
- Generating SDK reference
- Designing a contract for partners

## Core patterns

### OpenAPI 3.1 — minimum viable

\`\`\`yaml
openapi: 3.1.0
info:
  title: Orders API
  version: "1.0.0"
  description: |
    Manages customer orders. Auth via bearer token.
servers:
  - url: https://api.example.com
paths:
  /orders:
    post:
      summary: Create an order
      security: [{ bearerAuth: [] }]
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/CreateOrder" }
            examples:
              basic:
                value: { items: [{ sku: "ABC", qty: 2 }] }
      responses:
        "201":
          description: Created
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Order" }
        "400":
          $ref: "#/components/responses/BadRequest"
        "401":
          $ref: "#/components/responses/Unauthorized"
components:
  securitySchemes:
    bearerAuth: { type: http, scheme: bearer }
  schemas:
    CreateOrder:
      type: object
      required: [items]
      properties:
        items:
          type: array
          items:
            type: object
            required: [sku, qty]
            properties:
              sku: { type: string }
              qty: { type: integer, minimum: 1 }
\`\`\`

### Document behavior

- **Errors** — every status code with a meaningful body.
- **Idempotency** — note which endpoints support idempotency keys.
- **Rate limits** — headers (`X-RateLimit-Remaining`) and policy.
- **Pagination** — cursor vs offset; example responses.
- **Versioning** — URL path vs header; deprecation timeline.
- **Webhooks** — payload shape, signing, retry behavior.

### Tools

- **Redoc / Swagger UI** — render the spec.
- **Stoplight Elements** — embeddable.
- **Spectral** — lint the spec.
- **openapi-typescript** — generate types from spec.

### Reference + guide split

- **Reference** — auto-generated from spec (Redoc).
- **Guide** — narrative docs: "How to create an order", with runnable code.

## Anti-patterns

❌ **No example requests / responses** — readers guess.
❌ **Error schemas omitted** — clients can't handle errors.
❌ **Stale docs** — generate from spec; spec lives with the code.
❌ **Missing auth section** — readers can't start.
❌ **Doc-only fields not actually enforced by the server** — drift.

## Related skills

- `doc-coauthoring` — narrative docs
- `tutorial-engineer` — runnable examples
- `readme` — repo overview

## References

- [OpenAPI 3.1 spec](https://spec.openapis.org/oas/v3.1.0)
- [Redoc](https://redocly.com/)
- [Spectral](https://stoplight.io/open-source/spectral)
```

### Step 22: `tutorial-engineer`

`packages/runtime/src/skill/bundled/tutorial-engineer/SKILL.md`:

```markdown
---
name: tutorial-engineer
displayName: Tutorial Engineer
description: Writing step-by-step tutorials — running examples, copy-pasteable code, progressive complexity, troubleshooting. Use when creating an end-user tutorial.
whenToUse:
  - Author a "Getting started" tutorial
  - Build a multi-step walkthrough
  - Create a workshop / class material
  - Refresh outdated tutorial
version: 1.0.0
author: curated from wshobson/agents + Divio docs framework
license: MIT
tags: [tutorial, docs, walkthrough, getting-started, education]
agents: [build, tutorial-engineer]
tools: [read, write, edit, bash]
load: on-demand
---

# Tutorial Engineer

A tutorial is "do this, then this, then this" — and every step works.

## When to invoke

- Author a tutorial for end users
- Build a getting-started guide
- Create a workshop / lab
- Refresh outdated steps

## Core patterns

### Divio framework

Four doc types; tutorials are one of them:

- **Tutorial** — learning-oriented; "do this with me".
- **How-to** — problem-oriented; "I need to do X".
- **Reference** — information-oriented; "what is X".
- **Explanation** — understanding-oriented; "why X".

Don't mix. A tutorial should not be a reference.

### Tutorial skeleton

\`\`\`markdown
# Build a <thing> in 10 minutes

You'll build a real <thing> by the end. Every step works.

## What you'll need
- Node 20+
- 5 minutes

## 1. Initialize
\`\`\`bash
bun init my-app
cd my-app
bun add <pkg>
\`\`\`

## 2. Create <thing>
\`\`\`ts
// src/thing.ts
\`\`\`

## 3. Run it
\`\`\`bash
bun run src/thing.ts
\`\`\`

You should see: \`...\`

## 4. Extend
...

## Troubleshooting
- **Step 3 fails with X** — make sure you have Y.
- **No output** — check the console for Z.
\`\`\`

### Principles

- **Each step is testable** — copy-paste, see result, continue.
- **Show the output** — readers know what success looks like.
- **No placeholders** — `TODO`, `<insert-api-key>` blocks learning.
- **Progressive** — each step builds on the previous.
- **Troubleshooting** — common pitfalls, real causes.

### Test the tutorial

\`\`\`
Run it yourself on a clean machine.
Have a teammate follow it without help.
Time it; cut what isn't needed.
\`\`\`

### Tone

- "We" / "you" — collaborative.
- Encouraging — "great, now you have…".
- Direct — "Save this file as `thing.ts`", not "you may wish to consider saving".

## Anti-patterns

❌ **Mixing tutorial with reference** — readers get lost.
❌ **Skipping the "you should see X"** — readers don't know if it worked.
❌ **Assuming too much** — every step explicit, even obvious ones.
❌ **Outdated code blocks** — test the tutorial every time you change the code.
❌ **No troubleshooting** — every tutorial has pitfalls; document them.

## Related skills

- `doc-coauthoring` — narrative docs
- `api-documentation` — reference docs
- `readme` — repo overview

## References

- [Divio: Documentation framework](https://documentation.divio.com/)
- [Tone in technical writing (Google)](https://developers.google.com/style/tone)
```

### Step 23: `internal-comms`

`packages/runtime/src/skill/bundled/internal-comms/SKILL.md`:

```markdown
---
name: internal-comms
displayName: Internal Communications
description: Writing status updates, PR descriptions, RFCs, incident updates — concise, structured, audience-aware. Use when drafting team-facing communication.
whenToUse:
  - Write a status update
  - Draft an RFC
  - Communicate during an incident
  - Write a launch announcement
version: 1.0.0
author: anthropics/skills (internal-comms) — MIT
license: MIT
tags: [comms, status-update, rfc, incident-update, writing]
agents: [build, refactor, sre-engineer]
tools: [read, write, edit]
load: on-demand
---

# Internal Communications

Adapted from Anthropic's `internal-comms` skill. Concise, structured, audience-aware.

## When to invoke

- Writing a weekly status update
- Drafting an RFC
- Updating during an incident
- Announcing a launch

## Core patterns

### Status update (3P format)

\`\`\`markdown
**Progress**
- Shipped feature X (PR #123).
- Reduced checkout p99 from 800ms → 320ms.

**Plans**
- Start work on feature Y next week.
- Pair with @alice on cache invalidation.

**Problems**
- Still flaky test in suite Z (PR #456 open).
\`\`\`

### RFC (lightweight)

\`\`\`markdown
# RFC: <Title>

**Status:** Draft / In Review / Accepted / Rejected
**Author:** @name
**Reviewers:** @a, @b

## Summary
Two-paragraph summary.

## Motivation
Why now? What problem?

## Detailed design
Architecture, API, schema, rollout plan.

## Alternatives considered
Why this approach over X, Y, Z?

## Open questions
- [ ] Question 1
- [ ] Question 2

## Rollout plan
Feature flag → canary → full.
\`\`\`

### Incident update

\`\`\`markdown
**Status:** Mitigating
**Impact:** Checkout 5xx elevated to ~3% since 14:07 UTC.
**Mitigation:** Rolled back to v1.2.2 at 14:31. Monitoring.
**Next update:** 15:00 UTC or on material change.
\`\`\`

### Launch announcement

\`\`\`markdown
**What's new:** <Feature>
**Who:** Now available to all customers on Pro plan.
**Docs:** <link>
**Rollout:** Gradual, 10% → 50% → 100% over 24h.
**Known issues:** …
\`\`\`

### Tone

- Active voice ("we shipped", not "X has been shipped").
- Specific ("reduced p99 from 800ms to 320ms", not "improved performance").
- No emoji unless your team's culture uses them.
- Brevity — assume the reader is busy.

## Anti-patterns

❌ **Status updates that bury the lede** — lead with the conclusion.
❌ **RFC with no alternatives considered** — feels like the decision is already made.
❌ **Incident update that says "fixing" with no detail** — readers need to know scope.
❌ **Wall of text** — break into sections.
❌ **"Should we…" questions in status updates** — save for RFCs.

## Related skills

- `doc-coauthoring` — broader docs
- `requesting-code-review` — PR hygiene
- `postmortem-writing` — incident follow-up

## References

- [Anthropic Skills: internal-comms](https://github.com/anthropics/skills/tree/main/skills/internal-comms)
- [Google: How to write a status report](https://rework.withgoogle.com/guides/communication-guides/stay-in-the-loop)
```

### Step 24: Git — `git-pr-review`

`packages/runtime/src/skill/bundled/git-pr-review/SKILL.md`:

```markdown
---
name: git-pr-review
displayName: Git PR Review Workflow
description: Git + PR workflow — branches, commits, fetch + rebase, PR description, addressing feedback. Use when operating a PR-driven git workflow.
whenToUse:
  - Open / update a PR
  - Address review feedback
  - Keep a PR current with main
  - Squash / merge / rebase decisions
version: 1.0.0
author: curated from wshobson/agents
license: MIT
tags: [git, pr, pull-request, rebase, squash, merge]
agents: [build, refactor]
tools: [bash, read, write, edit]
load: on-demand
---

# Git PR Review Workflow

Trunk-based development with short-lived PRs.

## When to invoke

- Opening a PR
- Updating a PR after feedback
- Resolving merge conflicts
- Choosing a merge strategy

## Core patterns

### Branch hygiene

\`\`\`bash
git switch -c feat/login         # short, kebab-case
git fetch origin main
git rebase origin/main            # keep current
\`\`\`

### Commits

- One logical change per commit.
- Imperative subject (`Add user login`, not `Added`).
- Body explains "why", not "what".

\`\`\`bash
git commit -m "Add login form validation

Validates email format and password length before submit.
Adds unit tests for both happy and error paths."
\`\`\`

### Keeping PR current

\`\`\`bash
git fetch origin main
git rebase origin/main
git push --force-with-lease
\`\`\`

`--force-with-lease` instead of `--force` — fails if someone else pushed.

### Addressing feedback

\`\`\`bash
git add -p                       # stage hunks
git commit --fixup=<sha>         # fixup commit
# later:
git rebase -i --autosquash main  # squash fixups
git push --force-with-lease
\`\`\`

### Merge strategies

- **Squash merge** — single commit on main; good for feature branches.
- **Merge commit** — preserves history; good for long-lived branches.
- **Rebase merge** — linear history; common default.

Configure per repo (GitHub Settings → Allow squash / merge / rebase).

### Conflict resolution

\`\`\`bash
git status                       # see conflicted files
# edit, then:
git add <file>
git rebase --continue            # or `git merge --continue`
\`\`\`

### Bisect (when a regression appears)

\`\`\`bash
git bisect start
git bisect bad HEAD
git bisect good v1.2.2
git bisect run bun test
git bisect reset
\`\`\`

## Anti-patterns

❌ **`git push --force`** — clobbers others; use `--force-with-lease`.
❌ **Long-lived feature branches (> 1 week)** — rebase pain grows.
❌ **`git commit --amend` after pushing** — rewriting shared history.
❌ **Mixing rebase and merge on the same branch** — choose one.
❌ **Force-pushing to `main`** — never.

## Related skills

- `git-advanced-workflows` — rebase, reflog, submodules
- `git-cleanup` — cleaning up after
- `requesting-code-review` — PR description

## References

- [Pro Git book (free)](https://git-scm.com/book/en/v2)
- [GitHub: About merge methods](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/incorporating-changes-from-a-pull-request/about-merge-methods-on-github)
```

### Step 25: `git-advanced-workflows`

`packages/runtime/src/skill/bundled/git-advanced-workflows/SKILL.md`:

```markdown
---
name: git-advanced-workflows
displayName: Git Advanced Workflows
description: Advanced git — reflog, submodules, worktrees, hooks, bisect, filter-branch / filter-repo. Use when standard git isn't enough.
whenToUse:
  - Recover lost work
  - Use submodules or worktrees
  - Customize git hooks
  - Run scripted history rewrites
version: 1.0.0
author: curated from wshobson/agents
license: MIT
tags: [git, reflog, worktrees, submodules, hooks, bisect]
agents: [build, refactor]
tools: [bash, read, write, edit]
load: on-demand
---

# Git Advanced Workflows

Beyond add/commit/push.

## When to invoke

- Recover from a botched rebase
- Work on multiple branches in parallel (worktrees)
- Vendor a dependency (submodules / subtree)
- Enforce hooks (pre-commit, pre-push)
- Bulk-rewrite history (filter-repo)

## Core patterns

### Reflog — recover "lost" commits

\`\`\`bash
git reflog
# 3a4b5c6 (HEAD@{1}) commit: WIP feature
# 1a2b3c4 (HEAD@{2}) checkout: moving from main to feat
git checkout 3a4b5c6             # recover the WIP
git switch -c feat/recovered
\`\`\`

### Worktrees — multiple working directories, one repo

\`\`\`bash
git worktree add ../wt-hotfix main
cd ../wt-hotfix && git switch -c hotfix/x
# original repo stays on feat/login
\`\`\`

### Submodules — vendoring pinned deps

\`\`\`bash
git submodule add https://github.com/x/y.git vendor/y
git submodule update --init --recursive
\`\`\`

Caveat: submodules are easy to misconfigure; prefer package managers.

### Subtree — vendoring with simpler workflow

\`\`\`bash
git remote add vendor-y https://github.com/x/y.git
git fetch vendor-y
git merge -s ours --no-commit --allow-unrelated-histories vendor-y/main
git read-tree -u -m vendor-y/main
git commit -m "Import vendor/y"
git pull -s subtree vendor-y main
\`\`\`

### Hooks

\`\`\`bash
# .git/hooks/pre-commit
#!/usr/bin/env bash
bun run lint || exit 1
bunx tsc --noEmit || exit 1
\`\`\`

For teams, use `lefthook`, `pre-commit`, or `husky` for shareable config.

### Bisect — automated regression hunt

\`\`\`bash
git bisect start
git bisect bad HEAD
git bisect good v1.0.0
git bisect run bun test
git bisect reset
\`\`\`

### filter-repo — bulk history rewrite

\`\`\`bash
git filter-repo --path-glob '*.log' --invert-paths
git filter-repo --replace-text expressions.txt   # e.g. remove leaked secrets
\`\`\`

(More performant and safer than `git filter-branch`.)

### Rerere — record resolved conflicts

\`\`\`bash
git config --global rerere.enabled true
\`\`\`

Replays your conflict resolutions when the same conflict recurs.

## Anti-patterns

❌ **`git push --force` after filter-repo** — coordinate with team.
❌ **Submodules for active dependencies** — they're pinned, not built.
❌ **Hook bypassed with `--no-verify`** — defeats the gate.
❌ **Reflog as a substitute for branches** — it's recovery, not workflow.
❌ **`filter-branch`** — slow and unsafe; use `filter-repo`.

## Related skills

- `git-pr-review` — standard PR flow
- `changelog-automation` — release notes

## References

- [Pro Git book: Git Internals](https://git-scm.com/book/en/v2/Git-Internals-Plumbing-and-Porcelain)
- [git-filter-repo](https://github.com/newren/git-filter-repo)
```

### Step 26: `git-cleanup`

`packages/runtime/src/skill/bundled/git-cleanup/SKILL.md`:

```markdown
---
name: git-cleanup
displayName: Git Cleanup
description: Cleaning up git state — squashing commits, deleting merged branches, removing untracked files, sanitizing history. Use after a feature merges or when the repo accumulates cruft.
whenToUse:
  - Squash commits before merge
  - Delete merged branches locally + remote
  - Remove accidentally committed artifacts
  - Sanitize a leaked secret from history
version: 1.0.0
author: curated from wshobson/agents
license: MIT
tags: [git, cleanup, squash, branches, secret-rotation]
agents: [build, refactor]
tools: [bash, read, write, edit]
load: on-demand
---

# Git Cleanup

A clean repo is a happy repo. But cleanup can destroy work — back up first.

## When to invoke

- Squash WIP commits before merging
- Remove merged local + remote branches
- Purge accidentally committed files
- Sanitize a leaked secret (and rotate it!)

## Core patterns

### Squash WIP commits before merging

\`\`\`bash
git log --oneline main..HEAD
# interactive rebase to squash
git rebase -i main
# change "pick" → "squash" for the WIP commits
\`\`\`

### Delete merged branches

\`\`\`bash
# local
git branch --merged main | grep -v "^[* ] main$" | xargs git branch -d
# remote
git remote prune origin
git branch -r --merged main | grep -v "main" | sed 's/origin\///' | xargs -I {} git push origin --delete {}
\`\`\`

### Remove a file from history

\`\`\`bash
git filter-repo --path path/to/file --invert-paths
# then force-push and coordinate with team
\`\`\`

### Remove a file from the latest commit only

\`\`\`bash
git rm --cached path/to/file
echo "path/to/file" >> .gitignore
git commit --amend --no-edit
\`\`\`

### Sanitize a leaked secret

\`\`\`bash
git filter-repo --replace-text <(printf 'AKIAIOSFODNN7EXAMPLE==>REDACTED\n')
git push --force-with-lease
# CRITICAL: rotate the leaked secret — history is forever
\`\`\`

### Untracked file hygiene

\`\`\`bash
git status --ignored
git clean -n          # dry run
git clean -fd         # delete (d = directories)
git clean -fdx        # include ignored files (dangerous)
\`\`\`

### Resetting

\`\`\`bash
git restore <file>            # undo unstaged changes
git restore --staged <file>   # unstage
git reset --soft HEAD~1       # uncommit, keep changes staged
git reset --mixed HEAD~1      # uncommit, unstage
git reset --hard HEAD~1       # uncommit, drop changes (DANGER)
\`\`\`

### Stash workflow

\`\`\`bash
git stash push -m "wip feature"
git stash list
git stash pop                 # apply + drop
git stash apply stash@{0}     # apply, keep
\`\`\`

## Anti-patterns

❌ **`git reset --hard` without reflog backup** — recoverable via reflog, but easy to panic.
❌ **Cleaning files you didn't mean to** — always `git clean -n` first.
❌ **Force-pushing after `filter-repo` without coordinating** — team members' clones diverge.
❌ **Removing a secret from history without rotating it** — the secret is still valid.
❌ **Deleting untracked work because it's "old"** — commit it to a `scratch` branch first.

## Related skills

- `git-pr-review` — workflow
- `git-advanced-workflows` — reflog, worktrees
- `secret-scanner` — prevent future leaks

## References

- [Pro Git book: Rewriting History](https://git-scm.com/book/en/v2/Git-Tools-Rewriting-History)
- [git-filter-repo](https://github.com/newren/git-filter-repo)
```

### Step 27: Verify all 18 skills load

```bash
cd kilocode-assistant
bun -e '
import { loadAllSkills } from "./packages/runtime/src/skill/loader.ts"
const r = loadAllSkills({ cwd: process.cwd() })
const coder = r.skills.filter(s =>
  ["tdd","test-fixing","e2e-testing","playwright-expert","webapp-testing",
   "code-review-excellence","requesting-code-review","simplify-code","code-reviewer","brooks-lint",
   "debugger","systematic-debugging","diagnosing-bugs","phase-gated-debugging",
   "pagespeed-enhancer","performance-optimizer","complexity-cuts","sql-optimization-patterns",
   "doc-coauthoring","readme","api-documentation","tutorial-engineer","internal-comms",
   "git-pr-review","changelog-automation","git-advanced-workflows","git-cleanup"
  ].includes(s.frontmatter.name)
)
console.log("coder-bundle:", coder.length, "skills loaded")
console.log("any errors:", r.errors)
'
```

### Step 28: Commit

```bash
git add -A
git commit -m "feat(skills): coder-productivity bundle — 18 SKILL.md files (testing/review/debug/perf/docs/git) (prompt 21)"
```

## Files created

```
packages/runtime/src/skill/bundled/
├── tdd/SKILL.md
├── test-fixing/SKILL.md
├── e2e-testing/SKILL.md
├── playwright-expert/SKILL.md
├── webapp-testing/SKILL.md
├── code-review-excellence/SKILL.md
├── requesting-code-review/SKILL.md
├── simplify-code/SKILL.md
├── code-reviewer/SKILL.md
├── brooks-lint/SKILL.md
├── debugger/SKILL.md
├── systematic-debugging/SKILL.md
├── diagnosing-bugs/SKILL.md
├── phase-gated-debugging/SKILL.md
├── pagespeed-enhancer/SKILL.md
├── performance-optimizer/SKILL.md
├── complexity-cuts/SKILL.md
├── sql-optimization-patterns/SKILL.md  (already shipped in prompt 19; re-ship / cross-link here)
├── doc-coauthoring/SKILL.md
├── readme/SKILL.md
├── api-documentation/SKILL.md
├── tutorial-engineer/SKILL.md
├── internal-comms/SKILL.md
├── git-pr-review/SKILL.md
├── git-advanced-workflows/SKILL.md
└── git-cleanup/SKILL.md
```

(18 new unique skills; `sql-optimization-patterns` already exists from prompt 19 — not duplicated. Total bundled after prompts 18-21: 65.)

## Acceptance criteria

- [ ] 18 new unique `SKILL.md` files exist
- [ ] Total bundled skills = 65 (1 + 24 + 22 + 18)
- [ ] Every SKILL.md frontmatter validates
- [ ] Every SKILL.md body has substantive content (≥ 50 lines)
- [ ] `loadAllSkills` returns all new skills with source = `bundled`
- [ ] No errors in `result.errors`
- [ ] `matchSkills({ prompt: "review my PR and run e2e tests" })` returns top-3 hits from this bundle
- [ ] `skill_invoke("playwright-expert")` returns full body
- [ ] `git commit` succeeds

## Verification

```bash
cd kilocode-assistant
bun run typecheck

# Count
ls packages/runtime/src/skill/bundled/ | wc -l
# → 65

# Smoke test
bun -e '
import { loadAllSkills } from "./packages/runtime/src/skill/loader.ts"
import { matchSkills } from "./packages/runtime/src/skill/match.ts"
const r = loadAllSkills({ cwd: process.cwd() })
console.log("total:", r.skills.length)
const matches = matchSkills({ prompt: "write Playwright tests for my new feature and review the PR", skills: r.skills, topN: 5 })
matches.forEach(m => console.log(\`\${m.score} \${m.skill.frontmatter.name} — \${m.reasons.slice(0, 2).join(", ")}\`))
'

# End-to-end via CLI
bun run kilo run "add Playwright e2e tests for the login flow and review the PR before merging" --agent build
# Agent should auto-invoke `playwright-expert`, `e2e-testing`, `code-review-excellence`
```

## Notes

- **Sources** (frontmatter `author:` per skill):
  - [`wshobson/agents`](https://github.com/wshobson/agents) — MIT — heavy testing/debugging/refactor coverage
  - [`antigravity-awesome-skills`](https://github.com/sickn33/antigravity-awesome-skills) — MIT
  - [`anthropics/skills`](https://github.com/anthropics/skills) — MIT — `webapp-testing`, `doc-coauthoring`, `internal-comms` (adapted, not copy-pasted)
  - [`subsy/ralph-tui/skills`](https://github.com/subsy/ralph-tui) — TUI patterns (referenced)
  - Authored practices: TDD (Beck), systematic debugging (Matthias), conventional comments (Google)
- **Distinct from programming + devops bundles** — strictly productivity / process / discipline.
- **`sql-optimization-patterns` already shipped in prompt 19** — referenced from `complexity-cuts` here. No duplicate file.
- **`changelog-automation` already shipped in prompt 20** — referenced from `git-advanced-workflows` here. No duplicate file.
- **`code-reviewer` vs `code-review-excellence`** — first is security-focused (OWASP lens); second is craft (tone, taxonomy, scope). Pair them in reviews.
- **Why three debugging skills** — `debugger` (tool), `systematic-debugging` (process, 4-phase), `phase-gated-debugging` (strict 5-phase for incidents). Different intents, different audiences.
- **`webapp-testing` adapted from Anthropic** — preserves the intent (QA a running app) but body is rewritten. Attribution: `anthropics/skills — MIT`.
- **`doc-coauthoring` + `internal-comms` adapted from Anthropic** — same.
- **TDD + test-fixing + e2e-testing + playwright-expert + webapp-testing** — five skills in the testing cluster. Distinct: philosophy (TDD), repair (test-fixing), patterns (e2e), tool (playwright), workflow (webapp-testing).
- **`git-cleanup` is the safety-net skill** — pair with `git-pr-review` (workflow) and `git-advanced-workflows` (deep ops). Same triangle as debugging.
- **No new `subsy/ralph-tui` skills here** — that source's TUI patterns would land under prompt 22 if at all.

---

**Total time estimate: 2-3 hours.**
