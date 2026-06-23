# Prompt 19: Programming Skills Bundle

## Goal

Ship the **programming-languages + web-stacks + databases** skill bundle — 25 curated `SKILL.md` files that get auto-discovered by the loader from prompt 18. These provide LLM-ready reference knowledge (TS 5+ patterns, React 19, Next 15, Postgres internals, etc.) so the assistant generates correct, idiomatic code on the first try instead of inventing outdated APIs.

## Context (from prompts 01-18)

- Monorepo bootstrapped, CLI + HTTP server + skills discovery service working (prompts 01-03, 18)
- Skills loader at `packages/runtime/src/skill/loader.ts` walks `bundled/ + userSkillPaths() + projectSkillPaths(cwd)` and parses YAML frontmatter (prompt 18)
- Skill frontmatter schema validated by `SkillFrontmatterSchema` in `packages/runtime/src/skill/schema.ts`
- 1 starter skill already bundled (`build-agent/` from prompt 18) — this prompt adds 25 more
- Skill format spec is `../../07-ai-skill-definition.md` — **read this first if you haven't**
- Skill inventory referenced from `../../kilocode-prd-2026-06-22/research.md` §12.3

**Real-world sources these skills are curated from** (all MIT/Apache 2.0 — see Notes):
- [`wshobson/agents`](https://github.com/wshobson/agents) — 156 skills, programming-heavy
- [`antigravity-awesome-skills`](https://github.com/sickn33/antigravity-awesome-skills) — 560 skills, all categories
- [`langgenius/dify/.agents/skills`](https://github.com/langgenius/dify) — 6 component skills
- Official docs: TypeScript handbook, React docs, Postgres docs, etc.

## Task

### Step 1: Create the bundle directory structure

```bash
cd kilocode-assistant
mkdir -p packages/runtime/src/skill/bundled
```

The skill loader (prompt 18) walks `bundled/<skill-name>/SKILL.md`. Each skill is its own directory — this lets skills ship companion files later (templates, scripts, schemas).

### Step 2: Define the SKILL.md template

Every skill in this bundle (and bundles 20-22) follows this template:

```markdown
---
name: <kebab-case-name>
displayName: <Human Readable Name>
description: <20-500 char description; used by matcher>
whenToUse:
  - <trigger phrase 1>
  - <trigger phrase 2>
version: 1.0.0
author: <source attribution>
license: MIT
tags: [<3-8 specific keywords>]
agents: [<agent names this skill pairs with>]
tools: [<tools required>]
load: on-demand
---

# <Display Name>

<one-paragraph summary>

## When to invoke

- <scenario 1>
- <scenario 2>
- <scenario 3>

## Core patterns

### <Pattern 1>
<explanation + code>

### <Pattern 2>
<explanation + code>

## Anti-patterns

❌ <thing 1 — what to avoid and why>
❌ <thing 2>

## Examples

### <Example 1>
\`\`\`<lang>
<minimal working code>
\`\`\`

## Related skills

- <other-skill-name>

## References

- <official doc URL>
- <source skill URL>
```

### Step 3: Language skills — `typescript-pro`

`packages/runtime/src/skill/bundled/typescript-pro/SKILL.md`:

```markdown
---
name: typescript-pro
displayName: TypeScript Pro (5.x)
description: TypeScript 5+ idioms — discriminated unions, satisfies operator, const type parameters, template literal types, type-level programming. Use when writing or refactoring TypeScript code that requires strong typing.
whenToUse:
  - Write TypeScript with strict types
  - Design discriminated unions
  - Use the satisfies operator
  - Type-level programming
version: 1.0.0
author: curated from wshobson/agents + official typescriptlang docs
license: MIT
tags: [typescript, types, generics, discriminated-union, satisfies, template-literal-types]
agents: [build, refactor, code-reviewer]
tools: [read, write, edit, grep]
load: on-demand
---

# TypeScript Pro

Modern TypeScript (5.0+) patterns that go beyond `any` and basic generics.

## When to invoke

- Designing a union type that needs exhaustive switching
- Migrating JavaScript with poor types to strict TypeScript
- Choosing between `interface`, `type`, and `class`
- Writing type-safe builders, parsers, or DSLs

## Core patterns

### Discriminated unions for state machines

Use a literal `kind` (or `type`) field as the discriminator. Switch on it with `never` exhaustiveness check:

\`\`\`ts
type Result<T, E = Error> =
  | { kind: "ok"; value: T }
  | { kind: "err"; error: E }

function handle<T>(r: Result<T>) {
  switch (r.kind) {
    case "ok": return r.value
    case "err": return r.error
    default:
      const _exhaustive: never = r
      throw new Error(\`unhandled: \${_exhaustive}\`)
  }
}
\`\`\`

### `satisfies` operator (TS 4.9+)

`satisfies` checks a value conforms to a type **without widening it**. Use when you want type safety AND literal-type preservation:

\`\`\`ts
type Theme = Record<string, { fg: string; bg: string }>

const theme = {
  header: { fg: "white", bg: "blue" },
  footer: { fg: "black", bg: "white" },
} satisfies Theme

theme.header.fg  // type: "white"  (not just string)
\`\`\`

### `const` type parameters (TS 5.0+)

Infer literal types instead of widened ones:

\`\`\`ts
function routes<const T extends readonly string[]>(paths: T) {
  return paths
}
const r = routes(["/users", "/posts"])
//    ^? readonly ["/users", "/posts"]  (literal, not string[])
\`\`\`

### Template literal types

Build string-shaped types from other types:

\`\`\`ts
type EventName<T extends string> = \`on\${Capitalize<T>}\`
type Click = EventName<"click">  // "onClick"
\`\`\`

### Branded (nominal) types

Prevent mixing semantically-distinct primitives that are structurally identical:

\`\`\`ts
type UserId = string & { readonly __brand: "UserId" }
type OrderId = string & { readonly __brand: "OrderId" }
const uid = "u_1" as UserId
const oid = uid  // ERROR — OrderId != UserId
\`\`\`

## Anti-patterns

❌ **Using `any`** — disables all type checking. Use `unknown` and narrow.
❌ **Using `enum`** — prefer `as const` objects (better tree-shaking, no runtime overhead).
❌ **`as` casts without a runtime check** — hides bugs; use type guards or `satisfies`.
❌ **Optional chaining chains of doom** like `a?.b?.c?.d?.e` — refactor to a discriminated union or explicit narrowing.
❌ **`interface` for data only** — use `type` unless you need declaration merging.

## Examples

### Type-safe API client

\`\`\`ts
type HttpMethod = "GET" | "POST" | "PUT" | "DELETE"
type Endpoint<M extends HttpMethod, P extends string> = {
  method: M
  path: P
  response: unknown
}

const endpoints = {
  listUsers: { method: "GET", path: "/users", response: null as User[] },
  createUser: { method: "POST", path: "/users", response: null as User },
} satisfies Record<string, Endpoint<HttpMethod, string>>

async function call<E extends keyof typeof endpoints>(
  endpoint: E,
  body?: unknown,
): Promise<ReturnType<typeof endpoints[E]["response"]>> {
  // ... fetch with type-safe return
}
\`\`\`

## Related skills

- `react-expert` — uses many TS patterns
- `nodejs-backend-patterns` — TS for server code

## References

- [TS Handbook: Type Manipulation](https://www.typescriptlang.org/docs/handbook/2/types-from-types.html)
- [TS 5.0 Release Notes](https://devblogs.microsoft.com/typescript/announcing-typescript-5-0/)
```

### Step 4: `python-pro`

`packages/runtime/src/skill/bundled/python-pro/SKILL.md`:

```markdown
---
name: python-pro
displayName: Python Pro (3.11+)
description: Modern Python 3.11+ patterns — structural pattern matching, type hints, async/await, dataclasses, protocols, generators. Use when writing or reviewing idiomatic Python.
whenToUse:
  - Write Python with strict type hints
  - Use match/case statements
  - Implement async code
  - Design data classes or protocols
version: 1.0.0
author: curated from wshobson/agents + PEPs
license: MIT
tags: [python, asyncio, type-hints, match, dataclasses, protocols]
agents: [build, refactor, code-reviewer]
tools: [read, write, edit, grep, bash]
load: on-demand
---

# Python Pro (3.11+)

Modern Python beyond tutorial basics. Targets 3.11+ for `tomllib`, `Self`, and improved error messages.

## When to invoke

- Choosing between dataclass / pydantic / NamedTuple
- Writing async code (FastAPI, asyncio)
- Designing with Protocols (structural typing)
- Refactoring imperative code to pattern matching

## Core patterns

### Structural pattern matching (PEP 634)

\`\`\`python
def http_status(status: int) -> str:
    match status:
        case 200 | 201 | 204:
            return "ok"
        case 400 | 422:
            return "bad request"
        case 404:
            return "not found"
        case 500 | 502 | 503:
            return "server error"
        case _:
            return "unknown"
\`\`\`

Match on shape (dicts, classes):

\`\`\`python
def handle(event: dict) -> None:
    match event:
        case {"type": "click", "x": int(x), "y": int(y)}:
            click(x, y)
        case {"type": "key", "key": str(k)}:
            keypress(k)
        case {"type": _}:
            raise ValueError(f"unknown event {event['type']}")
\`\`\`

### `Self` type (3.11+)

For fluent builders and class methods that return the class:

\`\`\`python
from typing import Self

class Builder:
    def with_name(self, name: str) -> Self:
        self.name = name
        return self
\`\`\`

### `Protocol` for structural typing

\`\`\`python
from typing import Protocol

class SupportsClose(Protocol):
    def close(self) -> None: ...

def cleanup(resource: SupportsClose) -> None:
    resource.close()
\`\`\`

### `dataclass(slots=True, frozen=True)` (3.10+)

\`\`\`python
from dataclasses import dataclass

@dataclass(slots=True, frozen=True)
class Point:
    x: float
    y: float

p = Point(1, 2)
# p.x = 3  # FrozenInstanceError
\`\`\`

### Async structured concurrency (asyncio.TaskGroup, 3.11+)

\`\`\`python
import asyncio

async def fetch_all(urls: list[str]) -> list[str]:
    async with asyncio.TaskGroup() as tg:
        tasks = [tg.create_task(fetch(u)) for u in urls]
    return [t.result() for t in tasks]
\`\`\`

## Anti-patterns

❌ **`from foo import *`** — pollutes namespace, breaks linters.
❌ **Mutable default args** like `def f(x=[])` — shared across calls. Use `None` + sentinel.
❌ **`except: pass`** — swallows all errors including KeyboardInterrupt.
❌ **`asyncio.run()` inside async code** — use `await` or restructure.
❌ **`type: ignore` without comment explaining why** — flags for the next reader.

## Examples

### Type-safe config

\`\`\`python
from dataclasses import dataclass
from typing import Self
import tomllib

@dataclass(slots=True, frozen=True)
class Config:
    db_url: str
    debug: bool

    @classmethod
    def load(cls, path: str) -> Self:
        with open(path, "rb") as f:
            data = tomllib.load(f)
        return cls(db_url=data["db_url"], debug=data.get("debug", False))
\`\`\`

## Related skills

- `python-fastapi` — async web framework
- `drizzle-orm-expert` — DB layer in TS; pair with SQLAlchemy here

## References

- [PEP 634 – Structural Pattern Matching](https://peps.python.org/pep-0634/)
- [typing module docs](https://docs.python.org/3/library/typing.html)
```

### Step 5: `rust-engineer`

`packages/runtime/src/skill/bundled/rust-engineer/SKILL.md`:

```markdown
---
name: rust-engineer
displayName: Rust Engineer
description: Idiomatic Rust — ownership, borrowing, lifetimes, async/await with Tokio, error handling with Result, trait design, generics, and FFI. Use when writing or reviewing Rust code.
whenToUse:
  - Write Rust code
  - Debug borrow checker errors
  - Design async code with Tokio
  - Implement traits and generics
version: 1.0.0
author: curated from wshobson/agents + rust-lang docs
license: MIT
tags: [rust, ownership, lifetimes, async, tokio, traits]
agents: [build, refactor, code-reviewer]
tools: [read, write, edit, grep, bash]
load: on-demand
---

# Rust Engineer

Idiomatic Rust for application code. Targets stable Rust + Tokio for async.

## When to invoke

- Designing a Rust API (struct/enum shape)
- Working through lifetime/borrow errors
- Choosing between `String` vs `&str`, `Vec<T>` vs `&[T]`
- Implementing async I/O with Tokio
- Deciding `Result<T, E>` vs `panic!`

## Core patterns

### Prefer `&str` / `&[T]` over `String` / `Vec<T>` in function params

\`\`\`rust
// Good — accepts any string-like input
fn greet(name: &str) {
    println!("hello, {name}");
}

// Bad — forces allocation at call site
fn greet_owned(name: String) { ... }
\`\`\`

### `Result<T, E>` with `?` for error propagation

\`\`\`rust
use std::fs::File;
use std::io::{self, Read};

fn read_config(path: &str) -> Result<String, io::Error> {
    let mut s = String::new();
    File::open(path)?.read_to_string(&mut s)?;
    Ok(s)
}
\`\`\`

Define a custom error enum with `thiserror`:

\`\`\`rust
use thiserror::Error;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("config error: {0}")]
    Config(#[from] ConfigError),
    #[error("db error: {0}")]
    Db(#[from] sqlx::Error),
}
\`\`\`

### Async with Tokio

\`\`\`rust
use tokio::task::JoinSet;

async fn fetch_all(urls: Vec<String>) -> Vec<String> {
    let mut set = JoinSet::new();
    for url in urls {
        set.spawn(async move { reqwest::get(&url).await?.text().await });
    }
    let mut out = Vec::new();
    while let Some(res) = set.join_next().await {
        if let Ok(Ok(body)) = res { out.push(body); }
    }
    out
}
\`\`\`

### Builder + `impl Default`

\`\`\`rust
#[derive(Default)]
pub struct ServerOpts {
    pub port: u16,
    pub host: String,
    pub max_conns: usize,
}

impl ServerOpts {
    pub fn new() -> Self {
        Self { port: 8080, host: "0.0.0.0".into(), max_conns: 100 }
    }
    pub fn port(mut self, p: u16) -> Self { self.port = p; self }
}
\`\`\`

### Iterators over loops

\`\`\`rust
// Good
let names: Vec<String> = users.iter().map(|u| u.name.to_uppercase()).collect();

// Bad (when iteration is enough)
let mut names = Vec::new();
for u in &users {
    names.push(u.name.to_uppercase());
}
\`\`\`

## Anti-patterns

❌ **`unwrap()` / `expect()` in library code** — only OK in tests/binaries.
❌ **`clone()` to silence the borrow checker** — usually a sign you need redesigning.
❌ **Public fields on structs** — use accessors or `pub(crate)`.
❌ **Returning `&Vec<T>` from a function** — return `&[T]` instead.
❌ **Mixing sync and async without `spawn_blocking`** — sync calls block the runtime.

## Examples

### Lifetimes on a parser

\`\`\`rust
pub struct Parser<'a> {
    input: &'a str,
    pos: usize,
}

impl<'a> Parser<'a> {
    pub fn new(input: &'a str) -> Self { Self { input, pos: 0 } }
    pub fn peek(&self) -> Option<char> { self.input[self.pos..].chars().next() }
}
\`\`\`

## Related skills

- `cpp-pro` — for porting from C++
- `go-concurrency-patterns` — different concurrency model

## References

- [The Rust Book](https://doc.rust-lang.org/book/)
- [Tokio tutorial](https://tokio.rs/tokio/tutorial)
```

### Step 6: `go-concurrency-patterns`

`packages/runtime/src/skill/bundled/go-concurrency-patterns/SKILL.md`:

```markdown
---
name: go-concurrency-patterns
displayName: Go Concurrency Patterns
description: Go concurrency — goroutines, channels, context, sync primitives, Worker pools, pipelines, errgroup. Use when writing concurrent Go code.
whenToUse:
  - Write concurrent Go code
  - Design goroutine pools or pipelines
  - Use context for cancellation
  - Pick between channel and mutex
version: 1.0.0
author: curated from wshobson/agents + go.dev blog
license: MIT
tags: [go, golang, concurrency, goroutines, channels, context, errgroup]
agents: [build, refactor, code-reviewer]
tools: [read, write, edit, grep, bash]
load: on-demand
---

# Go Concurrency Patterns

Idiomatic concurrency in Go. Stick to the rule: **share memory by communicating; don't communicate by sharing memory.**

## When to invoke

- Building a worker pool, fan-out/fan-in pipeline
- Adding cancellation/timeouts to long-running goroutines
- Choosing between channels and mutexes
- Debugging goroutine leaks

## Core patterns

### `context.Context` for cancellation

\`\`\`go
func Fetch(ctx context.Context, url string) ([]byte, error) {
    req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
    if err != nil { return nil, err }
    resp, err := http.DefaultClient.Do(req)
    if err != nil { return nil, err }
    defer resp.Body.Close()
    return io.ReadAll(resp.Body)
}
\`\`\`

### `errgroup` for parallel work

\`\`\`go
import "golang.org/x/sync/errgroup"

func FetchAll(ctx context.Context, urls []string) ([][]byte, error) {
    g, ctx := errgroup.WithContext(ctx)
    results := make([][]byte, len(urls))
    for i, u := range urls {
        i, u := i, u
        g.Go(func() error {
            body, err := Fetch(ctx, u)
            results[i] = body
            return err
        })
    }
    if err := g.Wait(); err != nil {
        return nil, err
    }
    return results, nil
}
\`\`\`

### Worker pool

\`\`\`go
func Pool[T, R any](ctx context.Context, workers int, in <-chan T, work func(T) R) <-chan R {
    out := make(chan R)
    g, _ := errgroup.WithContext(ctx)
    for i := 0; i < workers; i++ {
        g.Go(func() error {
            for {
                select {
                case <-ctx.Done():
                    return ctx.Err()
                case v, ok := <-in:
                    if !ok { return nil }
                    out <- work(v)
                }
            }
        })
    }
    go func() { g.Wait(); close(out) }()
    return out
}
\`\`\`

### Pipeline

\`\`\`go
// gen -> sq -> sum
gen := func() <-chan int {
    out := make(chan int)
    go func() { defer close(out); for i := 0; i < 10; i++ { out <- i } }()
    return out
}
sq := func(in <-chan int) <-chan int {
    out := make(chan int)
    go func() { defer close(out); for n := range in { out <- n * n } }()
    return out
}
\`\`\`

### Channel direction in signatures

\`\`\`go
func producer() <-chan int          // send-only
func consumer(in <-chan int)        // receive-only
\`\`\`

## Anti-patterns

❌ **Goroutines without a cancellation path** — leaks on shutdown.
❌ **Buffered channels as a queue without backpressure** — silent memory growth.
❌ **Holding a lock while calling a function that may block on I/O** — deadlock risk.
❌ **`go func() { _ = doSomething() }()`** — ignore the error in a goroutine. Use errgroup.
❌ **Mixing `sync.WaitGroup` and `errgroup`** — pick one. errgroup for fallible fan-out.

## Examples

### Concurrent map with sharded mutex

\`\`\`go
type ShardedMap[K comparable, V any] struct {
    shards []shard[K, V]
}
type shard[K comparable, V any] struct {
    mu sync.RWMutex
    m  map[K]V
}
\`\`\`

(See `golang.org/x/sync/singleflight` for dedup of concurrent calls.)

## Related skills

- `rust-engineer` — async/await ownership model
- `kubernetes-deployment` — controllers are Go programs

## References

- [Pipelines and cancellation (go.dev/blog)](https://go.dev/blog/pipelines)
- [errgroup package](https://pkg.go.dev/golang.org/x/sync/errgroup)
```

### Step 7: `java-architect`

`packages/runtime/src/skill/bundled/java-architect/SKILL.md`:

```markdown
---
name: java-architect
displayName: Java Architect (21+)
description: Modern Java 21+ — virtual threads, records, sealed types, pattern matching switch, structured concurrency. Use when designing or reviewing Java applications.
whenToUse:
  - Write modern Java 21+ code
  - Use virtual threads
  - Design with records and sealed types
  - Apply pattern matching
version: 1.0.0
author: curated from wshobson/agents + openjdk.java.net
license: MIT
tags: [java, virtual-threads, records, sealed-types, pattern-matching]
agents: [build, refactor]
tools: [read, write, edit, grep, bash]
load: on-demand
---

# Java Architect (21+)

Modern Java beyond Spring tutorials. Targets JDK 21 LTS.

## When to invoke

- Refactoring legacy Java to records / sealed types / pattern matching
- Adopting virtual threads for I/O-bound code
- Designing immutable data carriers
- Choosing between thread pools and virtual threads

## Core patterns

### Records for immutable data

\`\`\`java
public record Money(BigDecimal amount, Currency currency) {
    public Money {
        Objects.requireNonNull(amount);
        Objects.requireNonNull(currency);
    }
    public Money add(Money other) {
        if (this.currency != other.currency) throw new IllegalArgumentException();
        return new Money(this.amount.add(other.amount), this.currency);
    }
}
\`\`\`

### Sealed types for closed hierarchies

\`\`\`java
public sealed interface Shape permits Circle, Rectangle, Triangle { }
public record Circle(double r) implements Shape { }
public record Rectangle(double w, double h) implements Shape { }

double area(Shape s) {
    return switch (s) {
        case Circle c    -> Math.PI * c.r() * c.r();
        case Rectangle r -> r.w() * r.h();
        case Triangle t  -> 0.5 * t.base() * t.height();
    };
}
\`\`\`

### Virtual threads (JDK 21)

\`\`\`java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    for (var url : urls) {
        executor.submit(() -> fetch(url));   // blocks the v-thread, not an OS thread
    }
}   // waits for all; closes cleanly
\`\`\`

### Pattern matching for instanceof + switch

\`\`\`java
String describe(Object o) {
    return switch (o) {
        case Integer i when i > 0 -> "positive int";
        case Integer i            -> "non-positive int";
        case String s             -> "string of length " + s.length();
        case null                 -> "null";
        default                   -> o.getClass().getName();
    };
}
\`\`\`

### Structured concurrency (preview)

\`\`\`java
try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
    var user  = scope.fork(() -> fetchUser(id));
    var posts = scope.fork(() -> fetchPosts(id));
    scope.join();
    scope.throwIfFailed();
    return new Profile(user.get(), posts.get());
}
\`\`\`

## Anti-patterns

❌ **Thread pools for I/O-bound work** — use virtual threads.
❌ **Lombok `@Data` on a JPA entity** — generates equals/hashCode that breaks on lazy collections.
❌ **`Optional.get()` without `isPresent()`** — use `orElseThrow()` / `orElse()` / `map()`.
❌ **Empty catch blocks** — at minimum log.
❌ **Public mutable fields** — encapsulate.

## Related skills

- `kotlin-specialist` — JVM language with similar goals
- `kubernetes-deployment` — JVM apps in containers

## References

- [JEP 444: Virtual Threads](https://openjdk.org/jeps/444)
- [JEP 440: Record Patterns](https://openjdk.org/jeps/440)
```

### Step 8: `kotlin-specialist`

`packages/runtime/src/skill/bundled/kotlin-specialist/SKILL.md`:

```markdown
---
name: kotlin-specialist
displayName: Kotlin Specialist
description: Idiomatic Kotlin — coroutines, Flow, sealed classes, scope functions, KMP, value classes. Use when writing Kotlin for Android, server, or multiplatform.
whenToUse:
  - Write Kotlin code
  - Use coroutines and Flow
  - Apply Kotlin Multiplatform
  - Pick between sealed class and enum
version: 1.0.0
author: curated from wshobson/agents + kotlinlang.org
license: MIT
tags: [kotlin, coroutines, flow, sealed-classes, kmp]
agents: [build, refactor]
tools: [read, write, edit, grep, bash]
load: on-demand
---

# Kotlin Specialist

Idiomatic Kotlin. Targets Kotlin 2.x.

## When to invoke

- Choosing between coroutines and RxJava
- Designing a Flow-based pipeline
- Modeling states with sealed classes
- Sharing code via Kotlin Multiplatform

## Core patterns

### Coroutines + structured concurrency

\`\`\`kotlin
suspend fun fetchUser(id: String): User = coroutineScope {
    val profile = async { api.getProfile(id) }
    val prefs   = async { db.getPrefs(id) }
    profile.await().copy(prefs = prefs.await())
}
\`\`\`

### Flow pipelines

\`\`\`kotlin
fun events(): Flow<Event> = flow {
    while (true) {
        emit(poll())
        delay(1_000)
    }
}.filterIsInstance<ClickEvent>()
  .map { it.coords }
  .distinctUntilChanged()
\`\`\`

### Sealed class for state

\`\`\`kotlin
sealed interface UiState {
    data object Loading : UiState
    data class Success(val data: Data) : UiState
    data class Error(val cause: Throwable) : UiState
}

fun render(s: UiState) = when (s) {
    UiState.Loading       -> showSpinner()
    is UiState.Success    -> show(s.data)
    is UiState.Error      -> showError(s.cause)
}
\`\`\`

### Value classes for type-safe wrappers

\`\`\`kotlin
@JvmInline value class UserId(val raw: String)
@JvmInline value class Email(val raw: String)
\`\`\`

### Scope functions — pick deliberately

- `let` — null-safe transformation; `?.let { }`
- `run` — configure object, return last expression
- `with` — call many methods on one object
- `apply` — configure and return receiver (builder)
- `also` — side effect, return receiver (logging)

## Anti-patterns

❌ **`GlobalScope.launch`** — no structured concurrency; leaks on cancellation.
❌ **`.first()` on infinite Flow** without timeout — blocks forever.
❌ **`!!` (force-unwrap)** in non-test code — replace with safe call or explicit error.
❌ **`Companion object` for stateless util functions** — use top-level.
❌ **Blocking I/O in suspend functions** — wrap with `Dispatchers.IO { }` or use a non-blocking client.

## Related skills

- `swift-expert` — similar ideas on Apple platforms
- `java-architect` — JVM sibling

## References

- [Kotlin docs: Coroutines](https://kotlinlang.org/docs/coroutines-overview.html)
- [Kotlin docs: Flow](https://kotlinlang.org/docs/flow.html)
```

### Step 9: `swift-expert`

`packages/runtime/src/skill/bundled/swift-expert/SKILL.md`:

```markdown
---
name: swift-expert
displayName: Swift Expert
description: Modern Swift — SwiftUI, async/await, actors, structured concurrency, macros, value-type-first design. Use when building Apple-platform apps or server-side Swift.
whenToUse:
  - Build SwiftUI apps
  - Write async/await or actors
  - Apply Swift 5.9+ macros
  - Design value-type APIs
version: 1.0.0
author: curated from wshobson/agents + developer.apple.com
license: MIT
tags: [swift, swiftui, async-await, actors, structured-concurrency]
agents: [build, refactor]
tools: [read, write, edit, grep, bash]
load: on-demand
---

# Swift Expert

Modern Swift (5.9+). Apple-platform primary; server-side Swift where useful.

## When to invoke

- Building a SwiftUI view hierarchy
- Migrating Combine or GCD to async/await
- Modeling shared mutable state with actors
- Designing an API surface (struct vs class vs enum)

## Core patterns

### `async/await` + `Task`

\`\`\`swift
func loadProfile() async throws -> Profile {
    async let user  = api.fetchUser()
    async let prefs = db.fetchPrefs()
    return try await Profile(user: user, prefs: prefs)
}

// Call site
.task { profile = try? await loadProfile() }
\`\`\`

### Actors for shared mutable state

\`\`\`swift
actor RateLimiter {
    private var tokens = 10
    func tryAcquire() -> Bool {
        guard tokens > 0 else { return false }
        tokens -= 1
        return true
    }
}
\`\`\`

### SwiftUI state

\`\`\`swift
struct CounterView: View {
    @State private var count = 0
    var body: some View {
        Button("Count: \(count)") { count += 1 }
    }
}
\`\`\`

### Result builders for DSLs

\`\`\`swift
@resultBuilder struct HTML {
    static func buildBlock(_ components: String...) -> String {
        components.joined()
    }
}
func page(@HTML _ body: () -> String) -> String {
    "<html>\(body())</html>"
}
let doc = page { "<h1>hi</h1>" }
\`\`\`

### Custom macros (Swift 5.9)

Use `@attached` macros for boilerplate. Avoid hand-rolling what `#Preview`, `#Predicate`, or `@Observable` already do.

## Anti-patterns

❌ **Force-unwraps (`!`) outside test code** — use `guard let` / `if let`.
❌ **Retain cycles in closures** — `[weak self]` for stored closures.
❌ **Class when struct works** — prefer value types.
❌ **Singleton service locator** — inject.
❌ **`MainActor.run { }` from MainActor code** — already on main.

## Related skills

- `kotlin-specialist` — JVM sibling
- `react-expert` — web sibling

## References

- [Swift docs: Concurrency](https://docs.swift.org/swift-book/LanguageGuide/Concurrency.html)
- [SwiftUI tutorials](https://developer.apple.com/tutorials/swiftui)
```

### Step 10: `csharp-developer`

`packages/runtime/src/skill/bundled/csharp-developer/SKILL.md`:

```markdown
---
name: csharp-developer
displayName: C# Developer (.NET 8+)
description: Modern C# / .NET 8+ — records, primary constructors, LINQ, async streams, minimal APIs, pattern matching, file-scoped namespaces. Use when building .NET applications.
whenToUse:
  - Write C# / .NET 8+ code
  - Use minimal APIs or ASP.NET Core
  - Design with records and pattern matching
  - Apply async streams
version: 1.0.0
author: curated from wshobson/agents + learn.microsoft.com
license: MIT
tags: [csharp, dotnet, linq, async-streams, minimal-apis, records]
agents: [build, refactor]
tools: [read, write, edit, grep, bash]
load: on-demand
---

# C# Developer (.NET 8+)

Modern C# beyond the canonical ASP.NET MVC tutorial.

## When to invoke

- Choosing between class, record, struct, record struct
- Using minimal APIs instead of MVC controllers
- Designing async pipelines with `IAsyncEnumerable`
- Adopting .NET 8 primary constructors

## Core patterns

### Record types for data carriers

\`\`\`csharp
public record Money(decimal Amount, string Currency)
{
    public Money Add(Money other) =>
        Currency == other.Currency
            ? this with { Amount = Amount + other.Amount }
            : throw new ArgumentException("currency mismatch");
}
\`\`\`

### Primary constructors (C# 12)

\`\`\`csharp
public class UserService(IUserRepository repo, ILogger<UserService> log)
{
    public async Task<User?> GetAsync(int id, CancellationToken ct)
    {
        log.LogDebug("loading {Id}", id);
        return await repo.FindAsync(id, ct);
    }
}
\`\`\`

### Minimal APIs

\`\`\`csharp
var app = WebApplication.CreateBuilder(args).Build();

app.MapGet("/users/{id:int}", async (int id, IUserRepo repo, CancellationToken ct) =>
    await repo.FindAsync(id, ct) is { } u ? Results.Ok(u) : Results.NotFound());

app.Run();
\`\`\`

### Async streams

\`\`\`csharp
public async IAsyncEnumerable<Order> StreamOrders([EnumeratorCancellation] CancellationToken ct = default)
{
    await foreach (var page in _db.PagesAsync(ct))
        foreach (var o in page.Orders)
            yield return o;
}
\`\`\`

### Pattern matching

\`\`\`csharp
string Describe(object o) => o switch
{
    int n when n > 0          => "positive",
    int                      => "non-positive",
    string s                 => $"string({s.Length})",
    IEnumerable<object> xs   => $"collection({xs.Count()})",
    null                     => "null",
    _                        => o.GetType().Name,
};
\`\`\`

## Anti-patterns

❌ **`async void`** (except event handlers).
❌ **`.Result` / `.Wait()`** on Tasks — deadlocks.
❌ **Public mutable properties on DTOs** — use `init`.
❌ **`DateTime` for new APIs** — use `DateTimeOffset` or `DateOnly`/`TimeOnly`.
❌ **Catching `Exception`** without rethrow or specific reason.

## Related skills

- `java-architect` — JVM sibling
- `python-fastapi` — alternative web stack

## References

- [.NET docs: What's new in C# 12](https://learn.microsoft.com/dotnet/csharp/whats-new/csharp-12)
- [Minimal APIs tutorial](https://learn.microsoft.com/aspnet/core/tutorials/min-web-api)
```

### Step 11: `cpp-pro`

`packages/runtime/src/skill/bundled/cpp-pro/SKILL.md`:

```markdown
---
name: cpp-pro
displayName: C++ Pro (20/23)
description: Modern C++ — RAII, concepts, ranges, modules, coroutines, std::span, std::expected (C++23). Use when writing or reviewing modern C++.
whenToUse:
  - Write C++20/23 code
  - Use concepts, ranges, or coroutines
  - Apply RAII for resource management
  - Design template APIs with concepts
version: 1.0.0
author: curated from wshobson/agents + cppreference.com
license: MIT
tags: [cpp, c++, concepts, ranges, coroutines, raii, modules]
agents: [build, refactor]
tools: [read, write, edit, grep, bash]
load: on-demand
---

# C++ Pro (20/23)

Modern C++. Targets C++20 minimum, C++23 where supported.

## When to invoke

- Replacing raw pointers with smart pointers / RAII
- Constraining templates with concepts
- Replacing iterator pairs with ranges
- Using coroutines for async I/O

## Core patterns

### RAII as the universal resource discipline

\`\`\`cpp
class File {
    FILE* f_;
public:
    explicit File(const char* path) : f_(std::fopen(path, "r")) {
        if (!f_) throw std::runtime_error(std::strerror(errno));
    }
    ~File() { if (f_) std::fclose(f_); }
    File(const File&) = delete;
    File& operator=(const File&) = delete;
    File(File&& o) noexcept : f_(o.f_) { o.f_ = nullptr; }
    FILE* handle() noexcept { return f_; }
};
\`\`\`

### Concepts (C++20)

\`\`\`cpp
template<std::integral T>
T sum(std::span<const T> xs) {
    return std::reduce(xs.begin(), xs.end());
}
\`\`\`

### Ranges (C++20)

\`\`\`cpp
auto big_squares(std::span<const int> xs) {
    return xs
      | std::views::filter([](int x){ return x > 10; })
      | std::views::transform([](int x){ return x * x; });
}
\`\`\`

### Coroutines (C++20)

\`\`\`cpp
generator<int> fib() {
    int a = 0, b = 1;
    while (true) { co_yield a; std::tie(a, b) = std::pair{b, a+b}; }
}
\`\`\`

### `std::expected<T, E>` (C++23)

\`\`\`cpp
std::expected<int, std::errc> parse_int(std::string_view s) {
    int v{};
    auto [ptr, ec] = std::from_chars(s.begin(), s.end(), v);
    if (ec != std::errc{}) return std::unexpected(ec);
    if (ptr != s.end())    return std::unexpected(std::errc::invalid_argument);
    return v;
}
\`\`\`

## Anti-patterns

❌ **Raw `new` / `delete`** — use `std::unique_ptr` / `std::make_unique`.
❌ **`#define` for constants** — use `constexpr` (or `inline constexpr`).
❌ **Inheritance for code reuse** — prefer composition or concepts.
❌ **Member functions with many parameters** — bundle in a struct.
❌ **Manual `gsl::finally`** — implement via RAII destructor.

## Related skills

- `rust-engineer` — modern systems-language sibling

## References

- [C++ Reference](https://en.cppreference.com/)
- [C++ Core Guidelines](https://isocpp.github.io/CppCoreGuidelines/)
```

### Step 12: `react-expert`

`packages/runtime/src/skill/bundled/react-expert/SKILL.md`:

```markdown
---
name: react-expert
displayName: React Expert (19+)
description: React 19+ — Server Components, use() hook, actions, useOptimistic, refs-as-props, concurrent rendering. Use when building or reviewing React applications.
whenToUse:
  - Build React 19+ apps
  - Use Server Components
  - Implement actions and useOptimistic
  - Apply the use() hook for promises
version: 1.0.0
author: curated from wshobson/agents + react.dev
license: MIT
tags: [react, server-components, hooks, suspense, actions, useoptimistic]
agents: [build, refactor, frontend-design]
tools: [read, write, edit, grep]
load: on-demand
---

# React Expert (19+)

Modern React beyond `useEffect`. Targets React 19.

## When to invoke

- Choosing Server vs Client Components
- Migrating class components or old hooks
- Implementing optimistic UI
- Reading promises/context with `use()`

## Core patterns

### Server Components by default

\`\`\`tsx
// app/page.tsx — runs on the server
import { db } from "@/lib/db"

export default async function Page() {
    const posts = await db.post.findMany()
    return <PostList posts={posts} />
}
\`\`\`

### `use()` hook for promises and context

\`\`\`tsx
"use client"
import { use } from "react"

function Comments({ promise }: { promise: Promise<Comment[]> }) {
    const comments = use(promise)   // suspends until resolved
    return <ul>{comments.map(c => <li key={c.id}>{c.text}</li>)}</ul>
}
\`\`\`

### Actions + `useFormStatus`

\`\`\`tsx
"use server"
export async function createPost(formData: FormData) {
    await db.post.create({ data: { title: formData.get("title") } })
}

"use client"
import { useFormStatus } from "react-dom"
function Submit() {
    const { pending } = useFormStatus()
    return <button disabled={pending}>{pending ? "Saving…" : "Save"}</button>
}
\`\`\`

### `useOptimistic`

\`\`\`tsx
function Like({ likes }: { likes: number }) {
    const [optimistic, addOptimistic] = useOptimistic(likes, (s) => s + 1)
    async function action() { addOptimistic(null); await api.like() }
    return <button onClick={action}>♥ {optimistic}</button>
}
\`\`\`

### `useTransition` for non-urgent updates

\`\`\`tsx
const [isPending, startTransition] = useTransition()
startTransition(() => setFilter(next))
\`\`\`

## Anti-patterns

❌ **`useEffect` for data fetching** — use Server Components, React Query, or `use()`.
❌ **`useEffect` for derived state** — compute during render.
❌ **Prop drilling 5+ levels** — use context, composition, or a store.
❌ **Mutating state directly** — always set a new reference.
❌ **Missing `key` prop on lists** — use stable IDs, never index.

## Related skills

- `nextjs-app-router-patterns` — RSC + routing
- `shadcn-ui` — accessible primitives
- `tailwind-design-system` — utility styling

## References

- [React docs: Server Components](https://react.dev/reference/rsc/server-components)
- [React 19 upgrade guide](https://react.dev/blog/2024/12/05/react-19)
```

### Step 13: `nextjs-app-router-patterns`

`packages/runtime/src/skill/bundled/nextjs-app-router-patterns/SKILL.md`:

```markdown
---
name: nextjs-app-router-patterns
displayName: Next.js App Router (15+)
description: Next.js 15 App Router — React Server Components, streaming with Suspense, server actions, parallel + intercepting routes, route handlers, caching. Use when building Next.js apps.
whenToUse:
  - Build Next.js App Router apps
  - Stream with Suspense
  - Use server actions for mutations
  - Implement parallel or intercepting routes
version: 1.0.0
author: curated from wshobson/agents + nextjs.org docs
license: MIT
tags: [nextjs, app-router, rsc, server-actions, streaming, suspense]
agents: [build, refactor]
tools: [read, write, edit, grep]
load: on-demand
---

# Next.js App Router (15+)

Idiomatic Next.js 15 patterns. Default to Server Components; opt into Client only when you need state/effects.

## When to invoke

- Streaming a slow section with Suspense
- Handling form mutations with server actions
- Implementing parallel routes for tabs or modals
- Optimizing cache: `force-cache`, `revalidate`, `no-store`

## Core patterns

### Streaming with Suspense

\`\`\`tsx
import { Suspense } from "react"

export default function Page() {
    return (
        <main>
            <h1>Dashboard</h1>
            <Suspense fallback={<Skeleton />}>
                <SlowStats />
            </Suspense>
            <Suspense fallback={<Skeleton />}>
                <RecentOrders />
            </Suspense>
        </main>
    )
}
\`\`\`

### Server actions with revalidation

\`\`\`tsx
"use server"
import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"

export async function createPost(formData: FormData) {
    await db.post.create({ data: { title: String(formData.get("title")) } })
    revalidatePath("/posts")
}
\`\`\`

### Route handlers (replacing API routes)

\`\`\`ts
import { NextResponse } from "next/server"

export async function GET(_: Request, { params }: { params: { id: string } }) {
    const post = await db.post.findUnique({ where: { id: params.id } })
    if (!post) return NextResponse.json({ error: "not found" }, { status: 404 })
    return NextResponse.json(post)
}
\`\`\`

### Parallel + intercepting routes (modal pattern)

\`\`\`
app/
├── @modal/
│   └── (..)photos/[id]/
│       └── page.tsx        # intercepts /photos/:id
├── photos/
│   ├── page.tsx
│   └── [id]/page.tsx
└── layout.tsx              # accepts @modal slot
\`\`\`

### Data caching

- `fetch(url, { next: { revalidate: 60 } })` — ISR
- `fetch(url, { cache: "no-store" })` — dynamic
- `unstable_cache(...)` — wrap DB queries
- Tag-based invalidation: `revalidateTag("posts")`

## Anti-patterns

❌ **Fetching in `useEffect` for static data** — use Server Components.
❌ **Client Components for everything** — kills streaming.
❌ **Putting secrets in Client Components** — they leak. Server only.
❌ **Mixing Pages Router and App Router in one app** — pick one.
❌ **Forgetting `revalidatePath` after mutations** — stale UI.

## Related skills

- `react-expert` — hooks and patterns
- `tailwind-design-system` — styling
- `drizzle-orm-expert` — typed DB layer

## References

- [Next.js docs: App Router](https://nextjs.org/docs/app)
```

### Step 14: `vue-expert`

`packages/runtime/src/skill/bundled/vue-expert/SKILL.md`:

```markdown
---
name: vue-expert
displayName: Vue 3 Expert
description: Vue 3 Composition API — ref, reactive, computed, watch, Teleport, defineModel, Suspense, Pinia. Use when building Vue 3 applications.
whenToUse:
  - Build Vue 3 apps
  - Use Composition API (script setup)
  - Design with Pinia stores
  - Implement Teleport or Suspense
version: 1.0.0
author: curated from wshobson/agents + vuejs.org
license: MIT
tags: [vue, composition-api, pinia, teleport, script-setup]
agents: [build, refactor]
tools: [read, write, edit, grep]
load: on-demand
---

# Vue 3 Expert

Modern Vue 3 with `<script setup>` + Composition API. Defaults to Composition API; Options API only for legacy code.

## When to invoke

- Choosing ref vs reactive
- Sharing state across components (Pinia)
- Implementing v-model on a custom component
- Using Suspense / Teleport / Transition

## Core patterns

### `ref` for primitives, `reactive` for objects

\`\`\`vue
<script setup lang="ts">
import { ref, computed } from "vue"

const count = ref(0)
const doubled = computed(() => count.value * 2)
\`\`\`

### `defineModel` (3.4+) — clean v-model on custom components

\`\`\`vue
<!-- TextInput.vue -->
<script setup lang="ts">
const model = defineModel<string>()
</script>
<template>
    <input v-model="model" />
</template>
\`\`\`

### Pinia store

\`\`\`ts
import { defineStore } from "pinia"
import { ref, computed } from "vue"

export const useCart = defineStore("cart", () => {
    const items = ref<Item[]>([])
    const total = computed(() => items.value.reduce((s, i) => s + i.price, 0))
    function add(item: Item) { items.value.push(item) }
    return { items, total, add }
})
\`\`\`

### Teleport for modals

\`\`\`vue
<Teleport to="body">
    <div v-if="open" class="modal">…</div>
</Teleport>
\`\`\`

### Async setup + Suspense

\`\`\`vue
<script setup lang="ts">
const data = await fetch("/api/data").then(r => r.json())
</script>
\`\`\`

## Anti-patterns

❌ **Mixing Options API + Composition API arbitrarily** — pick one.
❌ **Mutating `reactive()` props** — emit events.
❌ **Destructuring `reactive()` without `toRefs`** — loses reactivity.
❌ **Storing class instances in Pinia** — store plain reactive state.
❌ **Using `v-if` and `v-for` on the same element** — `v-if` has higher priority; use a wrapper.

## Related skills

- `react-expert` — web sibling
- `tailwind-design-system` — utility styling

## References

- [Vue docs: Composition API](https://vuejs.org/guide/extras/composition-api-faq.html)
- [Pinia docs](https://pinia.vuejs.org/)
```

### Step 15: `sveltekit`

`packages/runtime/src/skill/bundled/sveltekit/SKILL.md`:

```markdown
---
name: sveltekit
displayName: SvelteKit (Svelte 5 runes)
description: SvelteKit + Svelte 5 — runes ($state, $derived, $effect), load functions, form actions, hooks, adapters. Use when building SvelteKit apps.
whenToUse:
  - Build SvelteKit apps
  - Use Svelte 5 runes
  - Implement load functions or form actions
  - Deploy with adapters
version: 1.0.0
author: curated from wshobson/agents + svelte.dev
license: MIT
tags: [svelte, sveltekit, runes, load, form-actions]
agents: [build, refactor]
tools: [read, write, edit, grep]
load: on-demand
---

# SvelteKit (Svelte 5 runes)

Svelte 5 with runes. SvelteKit for routing/SSR.

## When to invoke

- Choosing between runes mode and legacy reactivity
- Loading data server-side with `load`
- Submitting forms without writing JS
- Picking an adapter for deployment

## Core patterns

### Runes — `$state`, `$derived`, `$effect`

\`\`\`svelte
<script lang="ts">
    let count = $state(0)
    const doubled = $derived(count * 2)
    $effect(() => console.log("count is", count))
</script>

<button onclick={() => count++}>{count} (×2 = {doubled})</button>
\`\`\`

### `load` function for SSR data

\`\`\`ts
// src/routes/posts/+page.ts
export async function load({ fetch }) {
    const res = await fetch("/api/posts")
    return { posts: await res.json() }
}
\`\`\`

### Form actions (progressive enhancement)

\`\`\`ts
// src/routes/login/+page.server.ts
import { fail, redirect } from "@sveltejs/kit"

export const actions = {
    default: async ({ request, cookies }) => {
        const data = await request.formData()
        const user = await db.users.findByEmail(String(data.get("email")))
        if (!user) return fail(400, { error: "unknown email" })
        cookies.set("sid", await session.create(user.id), { path: "/" })
        throw redirect(303, "/dashboard")
    },
}
\`\`\`

### `+page.server.ts` vs `+page.ts`

- `+page.ts` — runs on both server and client (universal)
- `+page.server.ts` — server only; can access DB, secrets

### Hooks for auth

\`\`\`ts
// src/hooks.server.ts
export async function handle({ event, resolve }) {
    const sid = event.cookies.get("sid")
    event.locals.user = sid ? await loadUser(sid) : null
    return resolve(event)
}
\`\`\`

## Anti-patterns

❌ **Mixing runes and legacy `let` reactivity in same component** — confusing.
❌ **Putting secrets in `+page.ts`** — runs in browser; use `+page.server.ts`.
❌ **Mutating `$state` from `$effect` infinitely** — guard with a flag.
❌ **Loading in `onMount`** when SSR works — slower + no SEO.

## Related skills

- `react-expert` — web sibling
- `nextjs-app-router-patterns` — alternative meta-framework

## References

- [Svelte 5 docs](https://svelte.dev/docs/svelte/overview)
- [SvelteKit docs](https://kit.svelte.dev/docs)
```

### Step 16: `astro`

`packages/runtime/src/skill/bundled/astro/SKILL.md`:

```markdown
---
name: astro
displayName: Astro (content-driven)
description: Astro — content-driven SSG, islands architecture, view transitions, content collections, framework integrations. Use when building mostly-static content sites with selective interactivity.
whenToUse:
  - Build content-driven sites (docs, blogs, marketing)
  - Use islands for selective interactivity
  - Implement View Transitions
  - Author content collections with type safety
version: 1.0.0
author: curated from wshobson/agents + docs.astro.build
license: MIT
tags: [astro, islands, mdx, content-collections, view-transitions]
agents: [build, refactor, frontend-design]
tools: [read, write, edit, grep]
load: on-demand
---

# Astro

Content-first meta-framework. Ship zero JS by default; hydrate islands as needed.

## When to invoke

- Picking between Astro and Next.js for a content site
- Modeling content collections with Zod
- Mixing React/Vue/Svelte components on the same page
- Adding View Transitions for SPA-like navigation

## Core patterns

### Content collection with Zod schema

\`\`\`ts
// src/content/config.ts
import { defineCollection, z } from "astro:content"

const posts = defineCollection({
    type: "content",
    schema: z.object({
        title: z.string(),
        publishedAt: z.coerce.date(),
        tags: z.array(z.string()).default([]),
    }),
})

export const collections = { posts }
\`\`\`

### Island with explicit client directive

\`\`\`astro
---
import Counter from "../components/Counter.svelte"
---
<Counter client:visible />   <!-- hydrate when scrolled into view -->
\`\`\`

Options: `client:load`, `client:idle`, `client:visible`, `client:only`.

### View transitions

\`\`\`astro
---
import { ViewTransitions } from "astro:transitions"
---
<head>
    <ViewTransitions />
</head>
\`\`\`

### Server endpoints

\`\`\`ts
// src/pages/api/search.ts
import type { APIRoute } from "astro"

export const GET: APIRoute = async ({ url }) => {
    const q = url.searchParams.get("q") ?? ""
    const hits = await search(q)
    return new Response(JSON.stringify(hits), {
        headers: { "content-type": "application/json" },
    })
}
\`\`\`

## Anti-patterns

❌ **`client:load` for every component** — defeats Astro's zero-JS-by-default.
❌ **Fetching data with `useEffect`** in islands — pass as props.
❌ **Heavy framework for a single page** — use plain `.astro` components.
❌ **Not setting `client:visible` for below-the-fold widgets** — wastes initial bundle.

## Related skills

- `nextjs-app-router-patterns` — when you need a true SPA
- `react-expert` — for islands

## References

- [Astro docs](https://docs.astro.build/)
- [Content Collections guide](https://docs.astro.build/en/guides/content-collections/)
```

### Step 17: `tailwind-design-system`

`packages/runtime/src/skill/bundled/tailwind-design-system/SKILL.md`:

```markdown
---
name: tailwind-design-system
displayName: Tailwind Design System
description: Tailwind CSS v4 + design tokens, theme variables, dark mode via `@variant`, container queries, plugins. Use when designing a Tailwind-based design system.
whenToUse:
  - Set up Tailwind v4 in a project
  - Design tokens via CSS variables
  - Implement dark mode
  - Use container queries or arbitrary values
version: 1.0.0
author: curated from wshobson/agents + tailwindcss.com
license: MIT
tags: [tailwind, css, design-system, dark-mode, container-queries]
agents: [build, frontend-design]
tools: [read, write, edit, grep]
load: on-demand
---

# Tailwind Design System

Tailwind v4 (CSS-first config). Use design tokens + CSS variables for theming; avoid `tailwind.config.js` sprawl.

## When to invoke

- Migrating from Tailwind v3 to v4
- Building a design token system
- Adding dark mode
- Using container queries for component responsiveness

## Core patterns

### v4 CSS-first config

\`\`\`css
/* src/app.css */
@import "tailwindcss";

@theme {
    --color-brand-500: oklch(0.7 0.15 200);
    --font-sans: "Inter Variable", system-ui, sans-serif;
    --radius-card: 0.75rem;
}
\`\`\`

### Dark mode via `@variant`

\`\`\`css
@custom-variant dark (&:where(.dark, .dark *));
\`\`\`

\`\`\`tsx
<html className={theme === "dark" ? "dark" : ""}>
    <body className="bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
\`\`\`

### Container queries

\`\`\`tsx
<div className="@container">
    <div className="@md:flex @md:gap-4 grid grid-cols-1 gap-2">
        <Sidebar />
        <Main />
    </div>
</div>
\`\`\`

### Arbitrary values + custom variants

\`\`\`tsx
<div className="grid grid-cols-[200px_1fr] bg-[oklch(0.95_0.05_120)]">
\`\`\`

### Extracting reusable component classes

\`\`\`css
@layer components {
    .btn-primary {
        @apply inline-flex items-center gap-2 rounded-md
               bg-brand-500 px-4 py-2 text-white
               hover:bg-brand-600 focus:outline-none focus-visible:ring-2;
    }
}
\`\`\`

## Anti-patterns

❌ **Duplicating design tokens across components** — centralize in `@theme`.
❌ **`text-white` on a button without `hover:` and `focus-visible:`** — accessibility.
❌ **`@apply` 20+ times** — you're writing CSS again; use components instead.
❌ **Mixing v3 `@tailwind base` directives with v4 `@import`** — pick v4.
❌ **`style={{ ... }}` for theme-driven values** — use Tailwind utilities or CSS vars.

## Related skills

- `shadcn-ui` — uses these tokens
- `react-expert` — most common Tailwind consumer

## References

- [Tailwind v4 docs](https://tailwindcss.com/docs)
```

### Step 18: `shadcn-ui`

`packages/runtime/src/skill/bundled/shadcn-ui/SKILL.md`:

```markdown
---
name: shadcn-ui
displayName: shadcn/ui
description: shadcn/ui — accessible Radix primitives with Tailwind, copy-paste components, cva variants, theming via CSS variables. Use when building accessible component libraries on Tailwind.
whenToUse:
  - Add shadcn/ui components to a project
  - Create accessible Radix-based UI
  - Define component variants with cva
  - Theme via CSS variables
version: 1.0.0
author: curated from wshobson/agents + ui.shadcn.com
license: MIT
tags: [shadcn, radix, tailwind, accessibility, cva, components]
agents: [build, frontend-design]
tools: [read, write, edit, grep]
load: on-demand
---

# shadcn/ui

Radix-based accessible components copied into your project. Owned by you; modify freely.

## When to invoke

- Adding accessible Dialog, Combobox, Tabs, Toast, etc.
- Defining multi-variant components with `cva`
- Customizing the theme via CSS variables
- Migrating from a heavier UI library

## Core patterns

### Add a component

\`\`\`bash
bunx shadcn@latest add button dialog form
\`\`\`

Drops files in `src/components/ui/`. You own them — edit freely.

### `cva` for variants

\`\`\`tsx
import { cva, type VariantProps } from "class-variance-authority"

const button = cva(
    "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2",
    {
        variants: {
            variant: {
                default: "bg-primary text-primary-foreground hover:bg-primary/90",
                destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
                ghost: "hover:bg-accent hover:text-accent-foreground",
            },
            size: {
                default: "h-10 px-4 py-2",
                sm: "h-9 rounded-md px-3",
                icon: "h-10 w-10",
            },
        },
        defaultVariants: { variant: "default", size: "default" },
    }
)
\`\`\`

### Theming via CSS variables

\`\`\`css
:root {
    --background: 0 0% 100%;
    --foreground: 222.2 47.4% 11.2%;
    --primary: 222.2 47.4% 11.2%;
    --primary-foreground: 210 40% 98%;
}
.dark {
    --background: 222.2 84% 4.9%;
    --foreground: 210 40% 98%;
}
\`\`\`

\`\`\`tsx
<button className="bg-background text-foreground">…</button>
\`\`\`

### Form components with `react-hook-form` + `zod`

\`\`\`tsx
const schema = z.object({ email: z.string().email(), password: z.string().min(8) })
const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) })
\`\`\`

## Anti-patterns

❌ **Importing from a shadcn npm package** — there's no npm package. Copy the source.
❌ **Forgetting `asChild` on Button wrapping a Link** — accessibility + styling breaks.
❌ **Dark-mode-only or light-mode-only themes** — support both via CSS vars.
❌ **Using `Dialog` for confirmation without `AlertDialog`** — wrong semantics.

## Related skills

- `tailwind-design-system` — token source
- `react-expert` — host framework

## References

- [shadcn/ui docs](https://ui.shadcn.com/docs)
```

### Step 19: `nodejs-backend-patterns`

`packages/runtime/src/skill/bundled/nodejs-backend-patterns/SKILL.md`:

```markdown
---
name: nodejs-backend-patterns
displayName: Node.js Backend Patterns
description: Node.js / Bun backend — Hono / Express / Fastify, streams, async errors, structured logging, graceful shutdown. Use when designing Node.js HTTP services.
whenToUse:
  - Build Node.js or Bun HTTP services
  - Handle async errors in middleware
  - Stream responses
  - Add graceful shutdown
version: 1.0.0
author: curated from wshobson/agents + nodejs.org
license: MIT
tags: [nodejs, bun, hono, express, fastify, streams, async-errors]
agents: [build, refactor]
tools: [read, write, edit, grep, bash]
load: on-demand
---

# Node.js Backend Patterns

Backend patterns for Node.js / Bun. Framework-agnostic where possible; Hono/Express notes where they differ.

## When to invoke

- Building an HTTP API
- Handling promise rejections in middleware
- Streaming responses (SSE, large downloads)
- Adding graceful shutdown
- Implementing idempotency keys

## Core patterns

### Async error wrapper for Express

\`\`\`ts
type Handler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>
export const ah = (fn: Handler) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res, next).catch(next)
\`\`\`

### Hono — typed routes

\`\`\`ts
import { Hono } from "hono"
import { zValidator } from "@hono/zod-validator"
import { z } from "zod"

const app = new Hono()
    .post("/users", zValidator("json", z.object({ email: z.string().email() })), async (c) => {
        const { email } = c.req.valid("json")
        const user = await db.user.create({ data: { email } })
        return c.json(user, 201)
    })
\`\`\`

### Streaming response

\`\`\`ts
app.get("/export.csv", (c) => {
    return c.stream(async (stream) => {
        await stream.write(new TextEncoder().encode("id,name\n"))
        for await (const row of db.scan()) {
            await stream.write(new TextEncoder().encode(`${row.id},${row.name}\n`))
        }
    })
})
\`\`\`

### Graceful shutdown

\`\`\`ts
const server = app.listen(port)
const shutdown = async (sig: string) => {
    console.log(\`got \${sig}, draining…\`)
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(1), 10_000).unref()
}
process.on("SIGTERM", () => shutdown("SIGTERM"))
process.on("SIGINT",  () => shutdown("SIGINT"))
\`\`\`

### Structured logging with `pino`

\`\`\`ts
import pino from "pino"
export const log = pino({ level: process.env.LOG_LEVEL ?? "info" })
log.info({ userId }, "user created")
\`\`\`

## Anti-patterns

❌ **Throwing inside an async handler without `next`** — Express hangs.
❌ **Logging full request body on every request** — log IDs only.
❌ **Using `fs.readFileSync` in a request handler** — blocks the event loop.
❌ **Reading env vars at module top-level** — kills testability.
❌ **Trusting `req.body` directly** — validate.

## Related skills

- `hono` — ultra-fast web framework
- `python-fastapi` — alternative language
- `graphql-architect` — API design

## References

- [Node.js Best Practices](https://github.com/goldbergyoni/nodebestpractices)
```

### Step 20: `python-fastapi`

`packages/runtime/src/skill/bundled/python-fastapi/SKILL.md`:

```markdown
---
name: python-fastapi
displayName: Python FastAPI
description: FastAPI — async routes, dependency injection, Pydantic models, OpenAPI generation, background tasks. Use when building async Python APIs.
whenToUse:
  - Build FastAPI services
  - Design dependency-injected endpoints
  - Use Pydantic for validation
  - Generate OpenAPI docs
version: 1.0.0
author: curated from wshobson/agents + fastapi.tiangolo.com
license: MIT
tags: [python, fastapi, pydantic, async, dependencies, openapi]
agents: [build, refactor]
tools: [read, write, edit, grep, bash]
load: on-demand
---

# Python FastAPI

FastAPI for async Python web services. Pydantic v2 models.

## When to invoke

- Designing async routes with dependencies
- Validating request/response with Pydantic
- Adding auth via dependency injection
- Generating OpenAPI schemas

## Core patterns

### Pydantic models + route

\`\`\`python
from fastapi import FastAPI, HTTPException, Depends
from pydantic import BaseModel, EmailStr
from sqlalchemy.ext.asyncio import AsyncSession

app = FastAPI()

class UserIn(BaseModel):
    email: EmailStr
    name: str

class UserOut(UserIn):
    id: int

@app.post("/users", response_model=UserOut, status_code=201)
async def create_user(payload: UserIn, db: AsyncSession = Depends(get_db)):
    user = User(**payload.model_dump())
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user
\`\`\`

### Reusable dependency

\`\`\`python
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

bearer = HTTPBearer()

async def current_user(creds: HTTPAuthorizationCredentials = Depends(bearer)) -> User:
    user = await db.user.find_by_token(creds.credentials)
    if not user: raise HTTPException(401)
    return user

@app.get("/me")
async def me(user: User = Depends(current_user)):
    return user
\`\`\`

### Background tasks

\`\`\`python
from fastapi import BackgroundTasks

@app.post("/emails")
async def send_email(payload: EmailIn, bg: BackgroundTasks):
    bg.add_task(mailer.send, payload.to, payload.subject, payload.body)
    return {"queued": True}
\`\`\`

### Lifespan context

\`\`\`python
from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.connect()
    yield
    await db.disconnect()

app = FastAPI(lifespan=lifespan)
\`\`\`

## Anti-patterns

❌ **Sync DB calls in async routes** — blocks the loop.
❌ **Pydantic models as request handlers** — separate In vs Out.
❌ **Catching `Exception` and returning 500 silently** — log + raise HTTPException.
❌ **No CORS / no auth middleware** — surprises in prod.
❌ **`return db_obj` without `response_model`** — leaks fields.

## Related skills

- `nodejs-backend-patterns` — alternative stack
- `postgres-pro` — common backend

## References

- [FastAPI tutorial](https://fastapi.tiangolo.com/tutorial/)
- [Pydantic v2 docs](https://docs.pydantic.dev/latest/)
```

### Step 21: `graphql-architect`

`packages/runtime/src/skill/bundled/graphql-architect/SKILL.md`:

```markdown
---
name: graphql-architect
displayName: GraphQL Architect
description: GraphQL — schema-first design, resolvers, dataloader to fix N+1, federation, persisted queries, security. Use when designing GraphQL APIs.
whenToUse:
  - Design GraphQL schemas
  - Solve N+1 with dataloader
  - Set up Apollo Federation
  - Secure a GraphQL API
version: 1.0.0
author: curated from wshobson/agents + graphql.org
license: MIT
tags: [graphql, schema, dataloader, federation, apollo, resolvers]
agents: [build, refactor]
tools: [read, write, edit, grep]
load: on-demand
---

# GraphQL Architect

Schema-first GraphQL. Use dataloader for batching, federation for multiple services.

## When to invoke

- Designing entity relationships
- Debugging N+1 query problems
- Splitting monolith into federated subgraphs
- Locking down introspection in prod

## Core patterns

### Schema-first with code-first SDL

\`\`\`ts
import { builder } from "./builder"

builder.prismaObject("User", {
    fields: (t) => ({
        id: t.exposeID("id"),
        email: t.exposeString("email"),
        posts: t.relation("posts"),
    }),
})

builder.queryField("user", (t) =>
    t.prismaField({
        type: "User",
        args: { id: t.arg.id({ required: true }) },
        resolve: (query, _root, { id }) => db.user.findUnique({ ...query, where: { id } }),
    })
)
\`\`\`

### Dataloader to fix N+1

\`\`\`ts
import DataLoader from "dataloader"

const userById = new DataLoader<string, User>(async (ids) => {
    const rows = await db.user.findMany({ where: { id: { in: ids as string[] } } })
    return ids.map(id => rows.find(r => r.id === id)!)
})
\`\`\`

### Federation 2 subgraph

\`\`\`ts
import { ApolloServer } from "@apollo/server"
import { buildSubgraphSchema } from "@apollo/subgraph"

const server = new ApolloServer({
    schema: buildSubgraphSchema([{ typeDefs, resolvers }]),
})
\`\`\`

### Persisted queries

- Server accepts only registered operation IDs in prod
- Clients register queries at build time
- Cuts request size + enables CDN caching

### Security checklist

- Disable introspection in prod (`__schema` queries return errors)
- Max depth limit (e.g. 10)
- Max alias / complexity limits
- Rate-limit per operation
- Don't auto-generate mutations for sensitive types

## Anti-patterns

❌ **Resolving relations in resolvers without dataloader** — N+1 disaster.
❌ **GraphQL as a CRUD proxy over a REST API** — defeats the purpose.
❌ **No persisted queries in prod** — bandwidth + DoS risk.
❌ **Stitching with SDL strings** — error-prone; use code-first.
❌ **Returning different shapes per resolver for the same type** — breaks clients.

## Related skills

- `nodejs-backend-patterns` — runtime
- `postgres-pro` — common backing store

## References

- [GraphQL spec](https://spec.graphql.org/)
- [Apollo Federation docs](https://www.apollographql.com/docs/federation/)
```

### Step 22: `hono`

`packages/runtime/src/skill/bundled/hono/SKILL.md`:

```markdown
---
name: hono
displayName: Hono
description: Hono — ultralight web framework on Web Standards, runs on Bun/Node/Cloudflare/Deno. Middleware composition, validators (zod/valibot), RPC client, JWT helpers. Use when building type-safe HTTP APIs on any runtime.
whenToUse:
  - Build Hono apps or APIs
  - Use zValidator with zod
  - Generate RPC client with hc()
  - Deploy to Cloudflare/Bun/Node
version: 1.0.0
author: curated from wshobson/agents + hono.dev
license: MIT
tags: [hono, web-standards, rpc, cloudflare, middleware, zod]
agents: [build, refactor]
tools: [read, write, edit, grep]
load: on-demand
---

# Hono

Ultralight, Web-Standards-first framework. Type-safe RPC via `hc()` client.

## When to invoke

- Building an API that may run on Cloudflare Workers / Bun / Node
- Composing middleware (auth, logging, CORS)
- Generating a type-safe client from the server schema
- Using RPC instead of OpenAPI for internal APIs

## Core patterns

### Basic app + zod validator

\`\`\`ts
import { Hono } from "hono"
import { zValidator } from "@hono/zod-validator"
import { z } from "zod"

const app = new Hono()
    .post("/users", zValidator("json", z.object({ email: z.string().email() })), async (c) => {
        const { email } = c.req.valid("json")
        const user = await db.user.create({ data: { email } })
        return c.json(user, 201)
    })

export type AppType = typeof app
\`\`\`

### RPC client (end-to-end types)

\`\`\`ts
import { hc } from "hono/client"
import type { AppType } from "./server"

const client = hc<AppType>("/")
const res = await client.users.$post({ json: { email: "a@b.c" } })
const user = await res.json()  // typed as User
\`\`\`

### Middleware composition

\`\`\`ts
const auth = () => createMiddleware(async (c, next) => {
    const token = c.req.header("Authorization")
    c.set("user", await verify(token))
    await next()
})

app.post("/admin/*", auth(), adminRoutes)
\`\`\`

### Streaming SSE

\`\`\`ts
import { streamSSE } from "hono/streaming"

app.get("/events", (c) =>
    streamSSE(c, async (stream) => {
        for (let i = 0; i < 10; i++) {
            await stream.writeSSE({ data: String(i) })
            await stream.sleep(1000)
        }
    })
)
\`\`\`

### JWT auth helper

\`\`\`ts
import { jwt } from "hono/jwt"
app.use("/api/*", jwt({ secret: process.env.JWT_SECRET! }))
\`\`\`

## Anti-patterns

❌ **Using Hono as a fullstack framework** — use Next.js for SSR.
❌ **Returning Express-style `res.send()`** — Hono uses `c.json()` / `c.text()`.
❌ **Skipping validators on POST routes** — silent type drift.
❌ **Using `hono/client` for third-party consumers** — emit OpenAPI for them.
❌ **No runtime specifier** — set `"engines": { "node": ">=20" }` etc.

## Related skills

- `cloudflare-workers-expert` — common Hono host
- `nodejs-backend-patterns` — same patterns
- `python-fastapi` — alternative language

## References

- [Hono docs](https://hono.dev/docs/)
```

### Step 23: `postgres-best-practices`

`packages/runtime/src/skill/bundled/postgres-best-practices/SKILL.md`:

```markdown
---
name: postgres-best-practices
displayName: Postgres Best Practices
description: Postgres — EXPLAIN ANALYZE, B-tree / GIN / BRIN indexes, partitioning, VACUUM, connection pooling, common pitfalls. Use when optimizing Postgres queries or schema design.
whenToUse:
  - Optimize slow Postgres queries
  - Design indexes
  - Set up partitioning
  - Debug connection pool issues
version: 1.0.0
author: curated from wshobson/agents + postgresql.org/docs
license: MIT
tags: [postgres, sql, indexes, explain, vacuum, partitioning, connection-pool]
agents: [build, refactor, code-reviewer]
tools: [read, write, edit, grep, bash]
load: on-demand
---

# Postgres Best Practices

Day-to-day Postgres performance and correctness. Read the EXPLAIN plan before optimizing anything.

## When to invoke

- A query is slow — read EXPLAIN ANALYZE
- Choosing between B-tree / hash / GIN / BRIN
- Designing partition strategy for large tables
- Connection pool exhaustion

## Core patterns

### Read the plan

\`\`\`sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT * FROM orders WHERE user_id = 123 AND created_at > now() - interval '7 days';
\`\`\`

Look for: `Seq Scan` on large tables (missing index), `Sort` with high cost (can the index serve ORDER BY?), nested loops with high rows (consider hash join).

### Index types

- **B-tree** — equality + range on scalars. Workhorse.
- **Hash** — equality only. Rarely better than B-tree.
- **GIN** — full-text search, jsonb, arrays (`@@`, `@>`).
- **BRIN** — append-only naturally-ordered data (logs, time-series).
- **Partial** — `CREATE INDEX ... WHERE status = 'pending'`.
- **Covering** — `INCLUDE (col)` to enable index-only scans.

\`\`\`sql
CREATE INDEX CONCURRENTLY idx_orders_user_created
  ON orders (user_id, created_at DESC)
  INCLUDE (status, total);
\`\`\`

### Partitioning

\`\`\`sql
CREATE TABLE orders (
    id bigserial, user_id int, created_at timestamptz, total numeric
) PARTITION BY RANGE (created_at);

CREATE TABLE orders_2025_q3 PARTITION OF orders
    FOR VALUES FROM ('2025-07-01') TO ('2025-10-01');
\`\`\`

Always pair with a constraint-exclusion-friendly WHERE clause; otherwise the planner scans all partitions.

### VACUUM and autovacuum

- `VACUUM` reclaims dead tuples; `ANALYZE` updates stats.
- Autovacuum runs by default but can lag on busy tables. Tune per-table:
  \`\`\`sql
  ALTER TABLE orders SET (
      autovacuum_vacuum_scale_factor = 0.05,
      autovacuum_analyze_scale_factor = 0.02
  );
  \`\`\`

### Connection pooling

- Postgres forks a backend per connection (~10 MB each). Pool at the app or with PgBouncer.
- Server-side: `max_connections = 100` typical. Use PgBouncer in transaction-pool mode for web apps.

## Anti-patterns

❌ **`SELECT *`** — fetch only the columns you need (enables covering indexes).
❌ **N+1 queries** — use a JOIN or `WHERE id = ANY($1)`.
❌ **Float / double for money** — use `numeric(precision, scale)`.
❌ **Implicit type casts** — `'123'::int` in indexes breaks index usage if column is bigint.
❌ **Disabling autovacuum** — guaranteed bloat.

## Examples

### Detect missing index

\`\`\`sql
SELECT schemaname, relname, seq_scan, idx_scan
FROM pg_stat_user_tables
WHERE seq_scan > idx_scan AND n_live_tup > 10000
ORDER BY seq_scan DESC;
\`\`\`

## Related skills

- `postgres-pro` — replication, logical decoding
- `drizzle-orm-expert` — typed queries
- `sql-optimization-patterns` — deeper query tuning

## References

- [PostgreSQL documentation](https://www.postgresql.org/docs/current/)
- [Use The Index, Luke!](https://use-the-index-luke.com/)
```

### Step 24: `postgres-pro`

`packages/runtime/src/skill/bundled/postgres-pro/SKILL.md`:

```markdown
---
name: postgres-pro
displayName: Postgres Pro
description: Advanced Postgres — replication (streaming + logical), logical decoding + CDC, extensions (PostGIS, pgvector, pg_stat_statements), roles + RLS, FDWs. Use when running Postgres in production at scale.
whenToUse:
  - Set up replication
  - Use logical decoding for CDC
  - Add pgvector or PostGIS
  - Implement row-level security
version: 1.0.0
author: curated from wshobson/agents + postgresql.org/docs
license: MIT
tags: [postgres, replication, logical-decoding, cdc, pgvector, postgis, rls]
agents: [build, refactor, sre-engineer]
tools: [read, write, edit, grep, bash]
load: on-demand
---

# Postgres Pro

Production Postgres beyond a single primary. Topics: replication, extensions, security.

## When to invoke

- Adding read replicas
- Implementing CDC with logical decoding
- Using pgvector for similarity search
- Locking down multi-tenant data with RLS

## Core patterns

### Streaming replication

\`\`\`
# postgresql.conf (primary)
wal_level = replica
max_wal_senders = 10
\`\`\`

\`\`\`
# recovery.conf (replica)
primary_conninfo = 'host=primary port=5432 user=replicator password=…'
\`\`\`

### Logical replication / CDC

\`\`\`sql
-- Publication on primary
CREATE PUBLICATION all_orders FOR TABLE orders;

-- Subscription on replica
CREATE SUBSCRIPTION orders_sub
CONNECTION 'host=primary port=5432 dbname=app'
PUBLICATION all_orders;
\`\`\`

For application-level CDC, use `wal2json` or `pgoutput` plugin and consume via Debezium / River / similar.

### Row-level security

\`\`\`sql
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON orders
    USING (tenant_id = current_setting('app.tenant_id')::uuid);
\`\`\`

App sets the GUC at the start of each transaction:

\`\`\`sql
BEGIN;
SET LOCAL app.tenant_id = '…';
SELECT * FROM orders;
COMMIT;
\`\`\`

### pgvector for embeddings

\`\`\`sql
CREATE EXTENSION vector;
CREATE TABLE docs (id bigserial PRIMARY KEY, embedding vector(1536));

-- Index for ANN search
CREATE INDEX ON docs USING hnsw (embedding vector_cosine_ops);

SELECT id FROM docs ORDER BY embedding <=> $1 LIMIT 10;
\`\`\`

### pg_stat_statements for slow query analysis

\`\`\`sql
CREATE EXTENSION pg_stat_statements;
SELECT calls, mean_exec_time, query
FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;
\`\`\`

## Anti-patterns

❌ **Logical replication of tables without primary keys** — updates silently lose rows.
❌ **Replicas in same AZ as primary** — defeats the purpose.
❌ **Trusting client-set GUCs for RLS** — wrap in a transaction the app can't bypass.
❌ **Re-creating pgvector indexes without `CONCURRENTLY`** — blocks writes.
❌ **`DROP EXTENSION` without checking dependencies** — silent cascade.

## Related skills

- `postgres-best-practices` — query/index level
- `vector-search` — RAG workloads
- `monitoring-expert` — observability

## References

- [PostgreSQL Logical Replication](https://www.postgresql.org/docs/current/logical-replication.html)
- [pgvector GitHub](https://github.com/pgvector/pgvector)
```

### Step 25: `drizzle-orm-expert`

`packages/runtime/src/skill/bundled/drizzle-orm-expert/SKILL.md`:

```markdown
---
name: drizzle-orm-expert
displayName: Drizzle ORM
description: Drizzle ORM — type-safe SQL, schema-first, drizzle-kit migrations, relations, query builder, prepared statements. Use when building typed data layers in TypeScript.
whenToUse:
  - Set up Drizzle with Postgres/SQLite/MySQL
  - Define schema and relations
  - Generate and run migrations
  - Write type-safe queries
version: 1.0.0
author: curated from wshobson/agents + orm.drizzle.team
license: MIT
tags: [drizzle, orm, postgres, sqlite, typescript, migrations]
agents: [build, refactor]
tools: [read, write, edit, grep, bash]
load: on-demand
---

# Drizzle ORM

Type-safe SQL-first ORM. Schema in TS; SQL is the source of truth.

## When to invoke

- Picking an ORM for a new TS project
- Writing relational queries with `with`
- Generating migrations from schema
- Composing reusable query fragments

## Core patterns

### Schema

\`\`\`ts
import { pgTable, serial, text, integer, timestamp, varchar } from "drizzle-orm/pg-core"

export const users = pgTable("users", {
    id: serial("id").primaryKey(),
    email: varchar("email", { length: 256 }).notNull().unique(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
})

export const posts = pgTable("posts", {
    id: serial("id").primaryKey(),
    authorId: integer("author_id").notNull().references(() => users.id),
    title: text("title").notNull(),
})
\`\`\`

### Relations

\`\`\`ts
import { relations } from "drizzle-orm"

export const usersRelations = relations(users, ({ many }) => ({
    posts: many(posts),
}))
export const postsRelations = relations(posts, ({ one }) => ({
    author: one(users, { fields: [posts.authorId], references: [users.id] }),
}))
\`\`\`

### Relational query

\`\`\`ts
const result = await db.query.users.findFirst({
    where: eq(users.id, 1),
    with: { posts: { columns: { id: true, title: true } } },
})
\`\`\`

### Migrations

\`\`\`bash
bunx drizzle-kit generate   # writes SQL migration from schema diff
bunx drizzle-kit migrate    # applies migrations
\`\`\`

### Prepared statements

\`\`\`ts
const getUserById = db.select().from(users).where(eq(users.id, sql.placeholder("id"))).prepare()
const u = await getUserById.execute({ id: 42 })
\`\`\`

### Composable fragments

\`\`\`ts
const userPublic = {
    id: users.id,
    email: users.email,
    name: users.name,
}
\`\`\`

## Anti-patterns

❌ **Schema in a separate DSL / Prisma-style** — Drizzle is TS-first; embrace it.
❌ **Calling `.execute()` per row in a loop** — use `IN` with `inArray`.
❌ **Editing generated migration SQL by hand** — fix the schema and re-generate.
❌ **Using `findMany` with no limit** — unbounded queries on large tables.
❌ **Forgetting `references()` on FK columns** — no constraint enforcement.

## Related skills

- `postgres-best-practices` — SQL under the hood
- `nodejs-backend-patterns` — typical host

## References

- [Drizzle docs](https://orm.drizzle.team/docs/overview)
```

### Step 26: `sql-optimization-patterns`

`packages/runtime/src/skill/bundled/sql-optimization-patterns/SKILL.md`:

```markdown
---
name: sql-optimization-patterns
displayName: SQL Optimization Patterns
description: SQL query tuning — reading plans, index selection, JOIN ordering, sargability, statistics, CTEs vs subqueries. Use when SQL is slow or you need a plan review.
whenToUse:
  - Make a slow query faster
  - Add an index and verify it's used
  - Rewrite a query to be sargable
  - Compare CTEs vs subqueries vs JOINs
version: 1.0.0
author: curated from wshobson/agents + use-the-index-luke.com
license: MIT
tags: [sql, optimization, explain, indexes, cte, subquery, sargable]
agents: [build, refactor, code-reviewer]
tools: [read, write, edit, grep, bash]
load: on-demand
---

# SQL Optimization Patterns

Database-agnostic patterns (with Postgres/MySQL notes). Always start by reading the plan.

## When to invoke

- A query is slow and you don't know why
- Considering denormalization or materialized views
- Choosing between CTEs, subqueries, JOINs, temp tables
- Auditing a schema for missing indexes

## Core patterns

### Sargability — write predicates the index can use

\`\`\`sql
-- Sargable (can use index)
WHERE created_at >= '2025-01-01' AND created_at < '2025-02-01'

-- NOT sargable (function on column)
WHERE date_trunc('day', created_at) = '2025-01-01'

-- Fix: rewrite as range
WHERE created_at >= '2025-01-01' AND created_at < '2025-01-02'
\`\`\`

Also avoid leading wildcards: `LIKE '%foo'` is not sargable; `LIKE 'foo%'` is.

### JOIN order matters

The planner usually picks a good order, but complex queries may need hints or explicit `JOIN` order. Check the plan.

\`\`\`sql
-- Filter early, join later
SELECT u.id, p.title
FROM (SELECT id FROM users WHERE active) u
JOIN posts p ON p.author_id = u.id;
\`\`\`

### EXISTS vs IN vs JOIN

- `EXISTS` — short-circuits; good for "has any related row".
- `IN` — fine for small static lists; subquery rewriting may produce duplicates with NULLs.
- `JOIN` — when you need columns from the related table.

### CTE vs subquery

CTEs are not always optimization fences (PG 12+ inlines them by default), but materialization hints are available:

\`\`\`sql
WITH MATERIALIZED recent_orders AS (
    SELECT * FROM orders WHERE created_at > now() - interval '1 day'
)
SELECT * FROM recent_orders WHERE total > 100;
\`\`\`

### Covering indexes

When the index contains all columns the query needs, Postgres uses an index-only scan (no heap fetch):

\`\`\`sql
CREATE INDEX idx_users_email_name ON users (email) INCLUDE (name);
SELECT name FROM users WHERE email = '…';   -- index-only scan
\`\`\`

### Statistics

\`\`\`sql
ANALYZE users;
-- Or per-column extended stats
CREATE STATISTICS s_users_dept_name ON dept_id, name FROM users;
\`\`\`

## Anti-patterns

❌ **`SELECT *` everywhere** — breaks covering-index strategy.
❌ **Implicit type conversions** — `WHERE int_col = '123'` may bypass index.
❌ **Large `OR` chains** — Postgres uses `BitmapOr`; rewrite as `UNION ALL` of indexed queries.
❌ **Per-row subquery in a SELECT** — usually a JOIN.
❌ **`NOT IN (SELECT …)` when subquery may return NULLs** — silently returns zero rows.

## Related skills

- `postgres-best-practices` — Postgres-specific
- `drizzle-orm-expert` — typed query layer

## References

- [Use The Index, Luke!](https://use-the-index-luke.com/)
- [PG docs: Performance Tips](https://www.postgresql.org/docs/current/performance-tips.html)
```

### Step 27: Verify all 25 skills load

```bash
cd kilocode-assistant
bun -e '
import { loadAllSkills } from "./packages/runtime/src/skill/loader.ts"
const r = loadAllSkills({ cwd: process.cwd() })
const programming = r.skills.filter(s => 
  ["typescript-pro","python-pro","rust-engineer","go-concurrency-patterns",
   "java-architect","kotlin-specialist","swift-expert","csharp-developer","cpp-pro",
   "react-expert","nextjs-app-router-patterns","vue-expert","sveltekit","astro",
   "tailwind-design-system","shadcn-ui",
   "nodejs-backend-patterns","python-fastapi","graphql-architect","hono",
   "postgres-best-practices","postgres-pro","drizzle-orm-expert","sql-optimization-patterns"
  ].includes(s.frontmatter.name)
)
console.log("programming-bundle:", programming.length, "of 25")
console.log("any errors:", r.errors)
'
```

### Step 28: Commit

```bash
git add -A
git commit -m "feat(skills): programming bundle — 25 SKILL.md files (languages + web + db) (prompt 19)"
```

## Files created

```
packages/runtime/src/skill/bundled/
├── typescript-pro/SKILL.md
├── python-pro/SKILL.md
├── rust-engineer/SKILL.md
├── go-concurrency-patterns/SKILL.md
├── java-architect/SKILL.md
├── kotlin-specialist/SKILL.md
├── swift-expert/SKILL.md
├── csharp-developer/SKILL.md
├── cpp-pro/SKILL.md
├── react-expert/SKILL.md
├── nextjs-app-router-patterns/SKILL.md
├── vue-expert/SKILL.md
├── sveltekit/SKILL.md
├── astro/SKILL.md
├── tailwind-design-system/SKILL.md
├── shadcn-ui/SKILL.md
├── nodejs-backend-patterns/SKILL.md
├── python-fastapi/SKILL.md
├── graphql-architect/SKILL.md
├── hono/SKILL.md
├── postgres-best-practices/SKILL.md
├── postgres-pro/SKILL.md
├── drizzle-orm-expert/SKILL.md
└── sql-optimization-patterns/SKILL.md
```

(24 new skills; `build-agent` already exists from prompt 18. Total bundled after this prompt: 25.)

## Acceptance criteria

- [ ] 24 new `SKILL.md` files exist in `packages/runtime/src/skill/bundled/<name>/`
- [ ] Total bundled skills = 25 (including `build-agent`)
- [ ] Every SKILL.md frontmatter validates against `SkillFrontmatterSchema`
- [ ] Every SKILL.md has `name`, `description`, `whenToUse`, `version`, `tags`, `agents`
- [ ] Every SKILL.md body has substantive content (≥ 50 lines): When to invoke, Core patterns / Examples, Anti-patterns, References
- [ ] `loadAllSkills({ cwd })` returns all 24 new skills with source = `bundled`
- [ ] No errors in `result.errors` (i.e. all frontmatter parses)
- [ ] `matchSkills({ prompt: "write a Next.js app with Postgres" })` returns top-3 hits from this bundle
- [ ] `skill_invoke("react-expert")` returns the full body
- [ ] `git commit` succeeds

## Verification

```bash
cd kilocode-assistant
bun run typecheck

# Count bundled skills
ls packages/runtime/src/skill/bundled/ | wc -l
# → 25

# Smoke test: list + match
bun -e '
import { loadAllSkills } from "./packages/runtime/src/skill/loader.ts"
import { matchSkills } from "./packages/runtime/src/skill/match.ts"
const r = loadAllSkills({ cwd: process.cwd() })
console.log("total:", r.skills.length)
console.log("bundled names:", r.skills.filter(s => s.source === "bundled").map(s => s.frontmatter.name).sort().join("\n  "))
const matches = matchSkills({ prompt: "build a Next.js dashboard with Postgres", skills: r.skills, topN: 5 })
matches.forEach(m => console.log(\`\${m.score} \${m.skill.frontmatter.name} — \${m.reasons.slice(0, 2).join(", ")}\`))
'

# End-to-end via CLI
bun run kilo run "write a Next.js 15 dashboard with Postgres + Drizzle" --agent build
# Agent should auto-invoke `nextjs-app-router-patterns`, `drizzle-orm-expert`, `react-expert`
```

## Notes

- **Curated from public sources** (see frontmatter `author:` per skill):
  - [`wshobson/agents`](https://github.com/wshobson/agents) — MIT — 156 skills; primary source for language/web/database patterns
  - [`antigravity-awesome-skills`](https://github.com/sickn33/antigravity-awesome-skills) — MIT — 560 skills; reference for breadth
  - [`langgenius/dify/.agents/skills`](https://github.com/langgenius/dify) — referenced for component patterns
  - Official docs: TypeScript handbook, React docs (react.dev), PostgreSQL docs (postgresql.org/docs), Rust Book, Kotlin docs, Swift docs, Microsoft Learn, cppreference
- **All skills are MIT licensed** — same as the LadeStack project. Content is original prose, not copy-pasted.
- **Frontmatter is intentionally minimal** — `name`, `description`, `whenToUse`, `tags`, `agents`. `tools` is included where the skill requires specific tools.
- **Body structure is consistent across all 24 skills** — easier for the LLM to extract patterns: When to invoke → Core patterns → Anti-patterns → Examples → Related skills → References.
- **Tags are specific** (e.g. `nextjs`, `discriminated-union`, `virtual-threads`) — generic tags like `code` or `help` match too broadly and waste skill slots. Per prompt 18's matcher logic.
- **Some skills duplicate content with wshobson's originals** but with attribution in the frontmatter `author` field. We're not claiming authorship of patterns that originated elsewhere.
- **`load: on-demand`** is the default for all skills in this bundle — they're matched when the prompt suggests the domain. Critical-everywhere skills (security baseline, build-agent) would use `load: eager` — none here qualify.
- **Agent field** lists the agent names this skill is most useful with. The `build` agent pairs with most; `refactor` and `code-reviewer` get language-specific skills.
- **Why ship `postgres-best-practices` AND `postgres-pro`** — the first is query/index level (developer daily); the second is replication/extensions/RLS (production/SRE). Distinct audiences.
- **Why `nextjs-app-router-patterns` and `react-expert` are separate** — React is the rendering model; Next.js adds routing, RSC, streaming, caching. Different triggers in prompts.
- **No version skew yet** — all skills are `1.0.0`. v1.1 can add `kilo.json` constraints like `minVersion: "1.1.0"` per the skill schema.

---

**Total time estimate: 3 hours** (most of it is typing SKILL.md bodies — about 80-100 words per skill).
