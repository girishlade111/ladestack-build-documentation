# Prompt 22: Additional Skill Bundles

## Goal

Ship the **AI/ML + security + accessibility + frontend design** skill bundle — 20 curated `SKILL.md` files. This is the last "from internet" prompt (prompts 19-22). These give the assistant knowledge of LLM patterns (RAG, embeddings, prompt engineering), security baselines (OWASP, PCI, GDPR, auth), accessibility (WCAG 2.2, screen-reader testing), and visual design (Anthropic's design skills + Stitch DESIGN.md patterns).

## Context (from prompts 01-21)

- Skills discovery service scans `bundled/<name>/SKILL.md` (prompt 18)
- Frontmatter validated by `SkillFrontmatterSchema` (prompt 18)
- Bundles shipped so far:
  - Prompt 19: 24 programming skills
  - Prompt 20: 22 devops skills
  - Prompt 21: 18 coder productivity skills
  - Total bundled = 65
- Skill format spec: `../../07-ai-skill-definition.md` — **read this first if you haven't**

**Sources these skills are curated from** (all MIT/Apache 2.0 — see Notes):
- [`anthropics/skills`](https://github.com/anthropics/skills) — design (frontend-design, canvas-design, brand-guidelines, theme-factory, doc-coauthoring, internal-comms, webapp-testing) — adapted, not copy-pasted
- [`wshobson/agents`](https://github.com/wshobson/agents) — AI/ML + security + a11y
- [`antigravity-awesome-skills`](https://github.com/sickn33/antigravity-awesome-skills) — 560 skills
- [`apify/agent-skills`](https://github.com/apify/agent-skills) + [`apify/awesome-skills`](https://github.com/apify/awesome-skills) — scraping/automation
- Stitch DESIGN.md pattern (Google) — documented in `design-md` skill

## Task

### Step 1: SKILL.md template reminder

Same template as prompts 19-21.

### Step 2: AI/ML — `prompt-engineer`

`packages/runtime/src/skill/bundled/prompt-engineer/SKILL.md`:

```markdown
---
name: prompt-engineer
displayName: Prompt Engineer
description: Prompt design — instruction structure, few-shot examples, chain-of-thought, system vs user roles, token economics. Use when authoring or reviewing prompts.
whenToUse:
  - Write a new prompt
  - Diagnose a prompt that underperforms
  - Design few-shot examples
  - Reduce token cost without losing quality
version: 1.0.0
author: curated from wshobson/agents + Anthropic prompt engineering guide
license: MIT
tags: [prompt-engineering, llm, few-shot, chain-of-thought, system-prompt]
agents: [build, llm-ops, code-reviewer]
tools: [read, write, edit]
load: on-demand
---

# Prompt Engineer

A prompt is a program; LLMs are the runtime. Apply software discipline.

## When to invoke

- Authoring a system prompt
- Diagnosing why a prompt returns inconsistent results
- Adding few-shot examples
- Reducing token cost
- Designing prompts for agents (multi-step tool use)

## Core patterns

### Structure

\`\`\`
<role>
You are a senior code reviewer.
</role>

<task>
Review the diff for bugs, security issues, and naming.
</task>

<rules>
- Cite the line number for each finding.
- Mark severity: blocker, important, nit.
- Be concise; no praise.
</rules>

<output_format>
## Findings
- **<line>** — <issue> [severity]
## Verdict
approve | request-changes
</output_format>
\`\`\`

### Few-shot examples

Show 2-3 input/output pairs. Cover happy + edge cases.

\`\`\`
Example 1:
Input: "2 + 2"
Output: 4

Example 2:
Input: "10 - 3"
Output: 7

Now solve: "5 * 6"
\`\`\`

### Chain-of-thought (when reasoning matters)

\`\`\`
Think step-by-step:
1. Identify the operands.
2. Apply the operator.
3. Return the result.

Input: …
\`\`\`

For higher reasoning quality; costs more tokens.

### System vs user

- **System** — role, rules, output format. Stable across turns.
- **User** — the actual request. Variable.
- Keep instructions in system; data in user.

### Token economics

- Trim whitespace (LLMs ignore most of it).
- Avoid repeating the schema in every example — refer to it once.
- Use a small model for cheap tasks (triage, extraction); big model for hard reasoning.
- Cache stable prefixes (Anthropic prompt caching, OpenAI automatic caching).

### JSON-mode / structured output

\`\`\`
Respond with valid JSON matching this schema:
{ "findings": [{ "line": number, "issue": string, "severity": "blocker"|"important"|"nit" }], "verdict": "approve"|"request-changes" }
\`\`\`

Prefer constrained decoding (OpenAI `response_format`, Anthropic tool use with schema) when available.

### Anti-patterns

- Polite fillers ("please", "could you") — wastes tokens.
- Open-ended "do your best" — vague; gets vague.
- Asking the LLM to "not" do something — phrase positively.
- Mixing multiple tasks in one prompt — split into roles or steps.

## Examples

### Agent prompt

\`\`\`
You are a code-fixing agent.
Loop:
1. Read the failing test.
2. Read the source.
3. Apply a minimal fix.
4. Re-run the test.
Stop when the test passes. Never skip the test.
\`\`\`

## Related skills

- `llm-prompt-optimizer` — DSPy-style optimization
- `llm-evaluation` — measuring prompt quality
- `llm-ops` — production observability

## References

- [Anthropic prompt engineering guide](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/overview)
- [OpenAI prompt engineering](https://platform.openai.com/docs/guides/prompt-engineering)
```

### Step 3: `rag-architect`

`packages/runtime/src/skill/bundled/rag-architect/SKILL.md`:

```markdown
---
name: rag-architect
displayName: RAG Architect
description: Retrieval-Augmented Generation — chunking strategies, embedding models, vector stores, reranking, evaluation, hybrid search. Use when designing a RAG pipeline.
whenToUse:
  - Design a RAG system
  - Choose chunking strategy
  - Pick an embedding model
  - Add reranking
  - Evaluate retrieval quality
version: 1.0.0
author: curated from wshobson/agents + Anthropic RAG guide
license: MIT
tags: [rag, embeddings, vector-search, chunking, retrieval, rerank]
agents: [build, llm-ops]
tools: [read, write, edit, bash]
load: on-demand
---

# RAG Architect

Retrieval-Augmented Generation: ground the LLM in your data.

## When to invoke

- Designing a RAG pipeline
- Chunking is producing poor results
- Picking an embedding model
- Adding reranking / hybrid search
- Diagnosing "the LLM made up an answer"

## Core patterns

### Pipeline

\`\`\`
documents → chunk → embed → store in vector DB
query → embed → retrieve top-k → rerank → augment prompt → LLM → answer
\`\`\`

### Chunking

- **By characters** (naive) — fast, breaks sentences.
- **By tokens** — better boundary preservation.
- **By structure** (headers, paragraphs) — semantic but uneven size.
- **Recursive** — try paragraph, then sentence, then token.
- **Sliding window with overlap** — keep context across boundaries.

\`\`\`python
# Recursive splitter (LangChain-style)
splitter = RecursiveCharacterTextSplitter(
    chunk_size=512,
    chunk_overlap=64,
    separators=["\n\n", "\n", ". ", " "],
)
\`\`\`

### Embedding model choice

| Model | Dim | Strength |
|---|---|---|
| OpenAI text-embedding-3-small | 1536 | Cheap, general |
| OpenAI text-embedding-3-large | 3072 | High quality |
| Voyage-3 | 1024 | Code-aware |
| Cohere embed-v3 | 1024 | Multilingual |
| BGE-large-en-v1.5 | 1024 | Open source, strong |
| all-MiniLM-L6-v2 | 384 | Tiny, fast |

Choose by: domain match, dimension (affects DB size), cost.

### Vector store

- **pgvector** — Postgres + vectors; reuse existing DB.
- **Pinecone** — managed, fast, easy.
- **Weaviate** — open source, hybrid search built-in.
- **Qdrant** — open source, Rust, fast.
- **Chroma** — dev-friendly.

### Reranking

- Two-stage: ANN retrieve top-100, then cross-encoder rerank to top-5.
- Models: Cohere Rerank, BGE Reranker, ColBERT.

\`\`\`python
hits = retrieve(query, k=100)
hits = rerank(query, hits, top_k=5)
\`\`\`

### Hybrid search

Combine BM25 (lexical) + vector (semantic):

\`\`\`python
score = α * bm25_score + (1 - α) * vector_score
\`\`\`

Better for queries with specific terms (names, codes).

### Prompt augmentation

\`\`\`
Use the following context to answer the question.
If the answer is not in the context, say "I don't know".

Context:
<chunks>

Question: <query>
\`\`\`

### Evaluation

- **Retrieval**: recall@k, MRR, nDCG — does the right chunk show up?
- **Answer**: faithfulness, relevance, hallucination rate — does the answer use the chunk correctly?
- Tools: RAGAS, TruLens, Phoenix.

## Anti-patterns

❌ **Embedding the entire document** — one chunk per doc; retrieval is binary.
❌ **No overlap** — context split across boundaries lost.
❌ **No reranking** — first-stage ANN often misses the best chunk.
❌ **Trusting the LLM to "say I don't know"** — measure hallucination rate.
❌ **Recomputing embeddings on every ingest** — version them; cache.

## Related skills

- `embedding-strategies` — deeper embedding choices
- `vector-search` — HNSW, IVF, hybrid
- `llm-evaluation` — measuring RAG quality

## References

- [Anthropic RAG guide](https://docs.anthropic.com/en/docs/build-with-claude/retrieval-augmented-generation-overview)
- [RAGAS](https://docs.ragas.io/)
```

### Step 4: `llm-ops`

`packages/runtime/src/skill/bundled/llm-ops/SKILL.md`:

```markdown
---
name: llm-ops
displayName: LLM Ops
description: LLM operations — observability, cost tracking, latency, evaluation, A/B testing, caching. Use when running LLM features in production.
whenToUse:
  - Add observability to LLM calls
  - Track cost per feature
  - Reduce latency
  - Run prompt A/B tests
  - Set up evaluation pipelines
version: 1.0.0
author: curated from wshobson/agents
license: MIT
tags: [llm, ops, observability, cost, latency, evaluation, caching]
agents: [llm-ops, sre-engineer]
tools: [read, write, edit, bash]
load: on-demand
---

# LLM Ops

Production-grade LLM features need production discipline.

## When to invoke

- Adding telemetry to LLM calls
- Tracking cost per feature / user / tenant
- Reducing p99 latency
- A/B testing prompts
- Building an eval pipeline

## Core patterns

### Observability — log the right fields

\`\`\`ts
log.info({
    feature: "summarize_email",
    model: "claude-sonnet-4-5",
    prompt_version: "v1.2",
    input_tokens: 1500,
    output_tokens: 220,
    latency_ms: 850,
    cost_usd: 0.012,
    user_id_hash: hash(userId),
    trace_id: ctx.traceId,
}, "llm_call")
\`\`\`

### Cost tracking

- Tokens in + out × $/token per model.
- Surface per-feature and per-tenant.
- Set budgets; alert at 80%.

\`\`\`ts
const cost = (model: string, inTok: number, outTok: number) => {
    const rates = { "claude-sonnet-4-5": { in: 3e-6, out: 15e-6 } }
    return inTok * rates[model].in + outTok * rates[model].out
}
\`\`\`

### Latency reduction

- **Streaming** — TTFT (time to first token) matters more than total.
- **Prompt caching** — Anthropic, OpenAI offer prefix caching.
- **Batching** — for offline workloads.
- **Smaller model** — Haiku / GPT-4o-mini for simple tasks.
- **Parallel calls** — independent subtasks in parallel.

### Prompt caching

\`\`\`ts
// Anthropic
const msg = await client.messages.create({
    model: "claude-sonnet-4-5",
    system: [{ type: "text", text: STABLE_INSTRUCTIONS, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: query }],
})
\`\`\`

### Eval pipelines

Three tiers:

- **Offline** — run a fixed test set on every prompt change; track regression.
- **Online** — sample 1% of prod traffic; human or auto judge.
- **A/B** — split traffic between two prompt versions; compare.

### Caching strategies

- **Exact-match cache** — `sha1(system + messages)` → response. Cheap, narrow.
- **Semantic cache** — embed query; check nearest neighbor in cache. Broader, more complex.
- **Tool-result cache** — cache expensive tool calls (search, DB).

### Prompt versioning

\`\`\`
prompts/
├── summarize_email/
│   ├── v1.0.txt
│   ├── v1.1.txt
│   └── v1.2.txt
\`\`\`

Reference by version in logs.

### Safety

- Input filtering — PII redaction, prompt-injection detection.
- Output filtering — toxicity, PII leakage.
- Rate limits per user / tenant.
- Model allow-list (no rogue model in prod).

## Anti-patterns

❌ **No version on the prompt** — "which prompt produced this?" is unanswerable.
❌ **Logging the full prompt content with PII** — hash or scrub.
❌ **Single model for everything** — right-size per task.
❌ **No eval before deploying a prompt change** — regressions ship.
❌ **Synchronous LLM calls in user-facing hot paths without timeout** — slow → bad UX.

## Related skills

- `llm-evaluation` — eval methodology
- `prompt-engineer` — writing prompts
- `monitoring-expert` — overall observability

## References

- [Anthropic: Prompt caching](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching)
- [Datadog LLM Observability](https://www.datadoghq.com/product/llm-monitoring/)
```

### Step 5: `embedding-strategies`

`packages/runtime/src/skill/bundled/embedding-strategies/SKILL.md`:

```markdown
---
name: embedding-strategies
displayName: Embedding Strategies
description: Embedding model selection, dimensionality reduction, fine-tuning embeddings, domain adaptation. Use when picking or tuning embeddings for retrieval.
whenToUse:
  - Pick an embedding model
  - Reduce embedding dimensions
  - Fine-tune for a domain
  - Diagnose poor retrieval quality
version: 1.0.0
author: curated from wshobson/agents + MTEB leaderboard
license: MIT
tags: [embeddings, llm, retrieval, fine-tuning, matryoshka]
agents: [llm-ops, build]
tools: [read, write, edit, bash]
load: on-demand
---

# Embedding Strategies

Embeddings are the substrate of retrieval, search, clustering.

## When to invoke

- Choosing an embedding model
- Diagnosing retrieval quality
- Reducing storage / search cost
- Fine-tuning embeddings for your domain

## Core patterns

### Model selection

Use **MTEB leaderboard** ([huggingface.co/spaces/mteb/leaderboard](https://huggingface.co/spaces/mteb/leaderboard)) as a starting point; benchmark on your own data.

Consider:

- **Domain** — code, legal, biomedical have specialized models.
- **Dim** — smaller = cheaper storage / faster search.
- **Max tokens** — 512 / 8192.
- **Multilingual** — needed?
- **License** — commercial use allowed?

### Matryoshka Representation Learning (MRL)

Models trained to support truncated embeddings (e.g., 1536 → 256) with minimal quality loss:

\`\`\`python
import numpy as np
embeddings = model.encode(texts)
short = embeddings[:, :256]   # still ~95% recall for many tasks
\`\`\`

Lower dim = faster ANN search, less storage.

### Fine-tuning embeddings

\`\`\`bash
# Sentence-Transformers
python -m sentence_transformers.train \
    --model BAAI/bge-large-en-v1.5 \
    --train-data my_pairs.jsonl \
    --output my-embeddings
\`\`\`

Format: `(query, positive, negative)` triplets.

### Domain adaptation tricks

- **Hypothetical questions** — for each chunk, generate likely questions it answers. Embed those instead of the chunk.
- **Multi-vector** — embed the chunk + its summary + its key terms.
- **Late interaction** (ColBERT-style) — embed per-token; score at query time.

### When to use BM25 / sparse

- Specific terms (codes, names).
- Long-tail vocabulary.
- Combine with vector for hybrid.

### Storing embeddings

\`\`\`sql
-- pgvector
CREATE TABLE docs (
    id BIGSERIAL PRIMARY KEY,
    content TEXT,
    embedding vector(1024)
);
CREATE INDEX ON docs USING hnsw (embedding vector_cosine_ops);
\`\`\`

### Distillation

Distill a large embedder (Cohere embed-v3, Voyage-3) into a smaller one for cost:

\`\`\`python
# Score = cosine(large_model(q), large_model(d)) — soft labels
# Train small model to match.
\`\`\`

## Anti-patterns

❌ **Embedding the full document** — chunks first.
❌ **Mixing models in the same index** — incompatible vector spaces.
❌ **Re-embedding all docs on a model upgrade without benchmarking** — disruption.
❌ **Embedding without normalizing** — cosine vs dot product matters.
❌ **High-dim embeddings when 256 works** — wasteful.

## Related skills

- `rag-architect` — full RAG
- `vector-search` — ANN algorithms
- `llm-ops` — production observability

## References

- [MTEB leaderboard](https://huggingface.co/spaces/mteb/leaderboard)
- [Sentence-Transformers](https://www.sbert.net/)
- [Matryoshka Representation Learning](https://arxiv.org/abs/2205.13147)
```

### Step 6: `vector-search`

`packages/runtime/src/skill/bundled/vector-search/SKILL.md`:

```markdown
---
name: vector-search
displayName: Vector Search
description: Vector search algorithms — HNSW, IVF, PQ, hybrid search, filtering, evaluation. Use when designing or tuning a vector index.
whenToUse:
  - Pick an ANN algorithm
  - Tune HNSW / IVF parameters
  - Add metadata filters
  - Build hybrid search
  - Diagnose search latency
version: 1.0.0
author: curated from wshobson/agents + Faiss docs, Pinecone guides
license: MIT
tags: [vector-search, hnsw, ivf, ann, hybrid-search, pgvector]
agents: [llm-ops, build]
tools: [read, write, edit, bash]
load: on-demand
---

# Vector Search

Approximate Nearest Neighbor (ANN) over millions of embeddings.

## When to invoke

- Indexing > 100k vectors
- Tuning for recall vs latency
- Adding metadata filters
- Combining with BM25 (hybrid)

## Core patterns

### ANN algorithms

| Algorithm | Recall | Latency | Memory | Notes |
|---|---|---|---|---|
| **Flat (exact)** | 100% | Slowest | 1× | Ground truth; small (<10k). |
| **HNSW** | 99%+ | Fast | ~2× | Graph-based; default in pgvector. |
| **IVF** | 95%+ | Fast | ~1× | Partition-based; needs training. |
| **PQ** | 90%+ | Fast | <0.5× | Compressed; for huge corpora. |

### HNSW (Hierarchical Navigable Small World)

\`\`\`sql
-- pgvector
CREATE INDEX ON docs USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
SET hnsw.ef_search = 100;   -- higher = better recall, slower
\`\`\`

### IVF (Inverted File)

\`\`\`python
import faiss
quantizer = faiss.IndexFlatL2(d)
index = faiss.IndexIVFFlat(quantizer, d, nlist=100)
index.train(vectors)
index.add(vectors)
index.nprobe = 10   # cells to visit at query time
\`\`\`

### Metadata filtering

Two approaches:

- **Pre-filter** — filter before ANN; loses recall if filter is selective.
- **Post-filter** — ANN then filter; can return too few results.

\`\`\`sql
-- pgvector pre-filter (newer versions)
SELECT id FROM docs
WHERE category = 'docs'
ORDER BY embedding <=> $1
LIMIT 10;
\`\`\`

### Hybrid search

\`\`\`python
def hybrid(query, alpha=0.5):
    bm = bm25_search(query, k=100)
    vec = ann_search(query, k=100)
    scores = {}
    for r in bm:  scores[r.id] = alpha * r.score
    for r in vec: scores[r.id] = scores.get(r.id, 0) + (1 - alpha) * r.score
    return top_k(scores, 10)
\`\`\`

Reciprocal Rank Fusion (RRF) is simpler:

\`\`\`python
score(r) = sum(1 / (k + rank_in_list)) for each list
\`\`\`

### Quantization for scale

\`\`\`python
# Product Quantization
index = faiss.IndexIVFPQ(quantizer, d, nlist=100, m=8, nbits=8)
\`\`\`

### Evaluation

- **Recall@k** — fraction of true top-k in your retrieved top-k.
- **Latency** — p50 / p95 / p99.
- **QPS** — sustained.
- Benchmark against exact (Flat) as ground truth.

## Anti-patterns

❌ **Flat scan over > 1M vectors** — use ANN.
❌ **No `nprobe` / `ef_search` tuning** — defaults are conservative.
❌ **Re-indexing on every insert** — batch.
❌ **Mixing normalized and unnormalized vectors** — query scores wrong.
❌ **Filtering after ANN with no margin** — empty result sets.

## Related skills

- `embedding-strategies` — model side
- `rag-architect` — full pipeline
- `postgres-pro` — pgvector in production

## References

- [Faiss wiki](https://github.com/facebookresearch/faiss/wiki)
- [pgvector docs](https://github.com/pgvector/pgvector)
- [Pinecone: Hybrid Search](https://www.pinecone.io/learn/series/basics/hybrid-search/)
```

### Step 7: `llm-evaluation`

`packages/runtime/src/skill/bundled/llm-evaluation/SKILL.md`:

```markdown
---
name: llm-evaluation
displayName: LLM Evaluation
description: LLM evaluation — benchmarks, LLM-as-judge, rubrics, A/B testing, regression suites. Use when measuring prompt / model quality.
whenToUse:
  - Define a quality metric
  - Build a regression eval suite
  - Compare two prompt versions
  - Set up LLM-as-judge
version: 1.0.0
author: curated from wshobson/agents + Anthropic eval guide
license: MIT
tags: [llm, evaluation, llm-as-judge, benchmark, rubric, ab-testing]
agents: [llm-ops, code-reviewer]
tools: [read, write, edit, bash]
load: on-demand
---

# LLM Evaluation

If you can't measure it, you can't improve it.

## When to invoke

- Comparing two prompt versions
- Detecting regression from a prompt / model change
- Setting quality bars for production
- Validating an LLM feature before launch

## Core patterns

### Three tiers

1. **Offline (test set)** — fixed examples, deterministic scoring. Fastest feedback.
2. **Online (sample + label)** — sample prod traffic, human or auto-judge. Real-world signal.
3. **A/B (live split)** — two versions in prod; compare metrics. Slowest, most realistic.

### Build a test set

- 50-200 examples covering happy + edge cases.
- Each example: input + expected output (or rubric).
- Version the set; never mutate in place.

\`\`\`jsonl
{"input": "...", "expected": "...", "tags": ["happy-path"]}
{"input": "...", "expected_contains": ["..."], "tags": ["edge-case"]}
\`\`\`

### Metrics

- **Exact match** — for classification, JSON, code generation.
- **Contains / regex** — for partial structure.
- **Embedding similarity** — for free-form text.
- **LLM-as-judge** — for open-ended quality (faithfulness, helpfulness).

### LLM-as-judge

\`\`\`ts
async function judge(prompt: string, response: string, rubric: string): Promise<number> {
    const r = await client.messages.create({
        model: "claude-sonnet-4-5",
        messages: [{
            role: "user",
            content: `Rate the following response on a 1-5 scale.\n${rubric}\n\n---\nPrompt: ${prompt}\nResponse: ${response}\n\nScore:`
        }],
        max_tokens: 1,
    })
    return parseInt(r.content[0].text)
}
\`\`\`

Pitfalls:

- **Position bias** — judge prefers first response. Randomize.
- **Verbosity bias** — judge prefers longer. Use a rubric.
- **Self-bias** — judge favors its own outputs. Use a different model for judging.

### Pairwise comparison (often more reliable)

\`\`\`
Given the question, which response is better: A or B?
Ignore length; judge substance.
Answer with just "A" or "B".
\`\`\`

### Rubrics

\`\`\`markdown
Score 1-5 for "summarization quality":
5: Captures all key points; concise; faithful to source.
4: Captures most key points; minor omissions.
3: Captures the gist; misses nuance.
2: Misses key points; inaccurate.
1: Unrelated to source.
\`\`\`

### A/B testing

- Same prompt, two model versions or two prompt versions.
- Route 50/50; measure downstream metric (click, conversion, manual rating).
- Run for a fixed time window (≥ 1 week).

### Tooling

- **Braintrust** — eval + observability.
- **Langfuse** — open-source tracing + eval.
- **RAGAS** — RAG-specific metrics.
- **Promptfoo** — CLI eval.

## Anti-patterns

❌ **Test set < 20 examples** — noisy.
❌ **Optimizing for a metric that doesn't track user value** — Goodhart's law.
❌ **LLM-as-judge without spot-checking** — judge has its own biases.
❌ **Single metric** — track multiple (quality, cost, latency).
❌ **No version on the test set** — results not comparable across runs.

## Related skills

- `prompt-engineer` — writing prompts
- `llm-ops` — production observability
- `llm-prompt-optimizer` — automated optimization

## References

- [Anthropic: Building evals](https://docs.anthropic.com/en/docs/build-with-claude/develop-tests)
- [Braintrust docs](https://www.braintrust.dev/docs)
```

### Step 8: `llm-prompt-optimizer`

`packages/runtime/src/skill/bundled/llm-prompt-optimizer/SKILL.md`:

```markdown
---
name: llm-prompt-optimizer
displayName: LLM Prompt Optimizer
description: Automated prompt optimization — DSPy-style, MIPRO, OPRO, gradient-free methods. Use when you want to systematically improve a prompt beyond manual iteration.
whenToUse:
  - Optimize a prompt programmatically
  - Replace hand-tuned prompts with optimized versions
  - Bootstrap few-shot examples from data
  - Multi-objective (quality + cost)
version: 1.0.0
author: curated from wshobson/agents + DSPy, OPRO papers
license: MIT
tags: [prompt-optimization, dspy, opro, mipro, automation]
agents: [llm-ops, build]
tools: [read, write, edit, bash]
load: on-demand
---

# LLM Prompt Optimizer

Stop hand-tuning. Treat the prompt as a learned parameter.

## When to invoke

- Manual prompt tuning has plateaued
- You have a labeled eval set
- Multi-objective (quality + cost / latency)
- You want reproducible prompt improvement

## Core patterns

### DSPy-style

\`\`\`python
import dspy

class Summarize(dspy.Signature):
    """Summarize the email in 1-2 sentences."""
    email: str = dspy.InputField()
    summary: str = dspy.OutputField()

# Define a module
class EmailSummarizer(dspy.Module):
    def __init__(self):
        super().__init__()
        self.summarize = dspy.ChainOfThought(Summarize)
    def forward(self, email):
        return self.summarize(email=email)

# Compile against your metric
def metric(example, pred, trace=None):
    return pred.summary.lower() == example.summary.lower()

optimized = dspy.MIPROv2(metric=metric, auto="light").compile(
    EmailSummarizer(),
    trainset=trainset,
)
\`\`\`

MIPRO searches over instructions + few-shot examples jointly.

### OPRO (Optimization by PROmpting)

Use the LLM to propose prompt improvements:

\`\`\`
Your task is to propose a new prompt that maximizes this score.

Previous prompts and scores:
- "Summarize this email" → 0.62
- "Summarize this email in 1-2 sentences, focusing on the action item." → 0.78

Propose a new prompt.
\`\`\`

### Bootstrap few-shot

From labeled data, select diverse, correct examples and prepend to the prompt.

### Multi-objective

\`\`\`python
def metric(example, pred):
    quality = judge(example.input, pred.output)
    cost = pred.usage.output_tokens * 0.000015
    return quality - 0.5 * cost   # weight cost
\`\`\`

### Iterative loop

1. Start with a baseline prompt.
2. Run on a fixed eval set; record score.
3. Generate candidate prompts (manual or optimizer).
4. Score each; pick the best.
5. Repeat until plateau.

### Tools

- **DSPy** — declarative, MIPRO, BootstrapFewShot.
- **Promptfoo** — CLI eval + comparison.
- **Braintrust** — hosted eval + prompt versioning.
- **OPRO** — research-grade.

## Anti-patterns

❌ **Optimizing on the test set** — overfit; use train / val / test split.
❌ **No upper bound on tokens** — costs explode.
❌ **Optimizing a single example** — overfit; use ≥ 30.
❌ **Keeping an optimized prompt that's no longer maintainable** — readability matters.
❌ **No regression check on a held-out set** — false confidence.

## Related skills

- `prompt-engineer` — manual authoring
- `llm-evaluation` — measuring quality
- `llm-ops` — production ops

## References

- [DSPy docs](https://dspy.ai/)
- [OPRO paper (Google DeepMind)](https://arxiv.org/abs/2309.03409)
- [MIPRO paper](https://arxiv.org/abs/2406.11695)
```

### Step 9: `fine-tuning-expert`

`packages/runtime/src/skill/bundled/fine-tuning-expert/SKILL.md`:

```markdown
---
name: fine-tuning-expert
displayName: Fine-Tuning Expert
description: Fine-tuning LLMs — dataset prep, LoRA / QLoRA, training recipes, evaluation, when to fine-tune vs prompt. Use when adapting a model for a domain or task.
whenToUse:
  - Adapt a model to a domain (legal, medical, code)
  - Reduce prompt tokens with a fine-tuned small model
  - Improve structured output quality
  - Decide between fine-tune and prompt engineering
version: 1.0.0
author: curated from wshobson/agents + Hugging Face, PEFT docs
license: MIT
tags: [fine-tuning, lora, qlora, peft, dataset, training]
agents: [llm-ops, build]
tools: [read, write, edit, bash]
load: on-demand
---

# Fine-Tuning Expert

Fine-tune when prompting can't get you there.

## When to invoke

- Specialized vocabulary / format
- Need consistent structured output
- Latency / cost forces a smaller model
- Domain adaptation (legal, medical, finance)

## Core patterns

### When to fine-tune (vs prompt)

- **Prompt** — task is generic, model has the knowledge.
- **RAG** — task needs external / fresh data.
- **Fine-tune** — task needs a behavior the model doesn't naturally do (style, format, domain).

### Dataset prep

- Quality > quantity. 1000 high-quality > 100k noisy.
- Format: instruction + input + output (ChatML, Alpaca, ShareGPT).
- Deduplicate; balance classes if classification.
- Split: train / val / test (80/10/10).

\`\`\`jsonl
{"messages": [
  {"role": "user", "content": "..."},
  {"role": "assistant", "content": "..."}
]}
\`\`\`

### LoRA / QLoRA

- **LoRA** — low-rank adapters on attention layers; ~1% extra params.
- **QLoRA** — LoRA on a 4-bit quantized base; fits in single GPU.

\`\`\`python
from peft import LoraConfig, get_peft_model

config = LoraConfig(r=16, lora_alpha=32, target_modules=["q_proj", "v_proj"], lora_dropout=0.05, bias="none")
model = get_peft_model(base, config)
\`\`\`

### Training recipe (rough)

- **LR** — 1e-4 (LoRA), 2e-5 (full FT).
- **Batch size** — effective 32-128 via gradient accumulation.
- **Epochs** — 2-5; watch val loss.
- **Warmup** — 3-10% of steps.
- **Scheduler** — cosine.

### Eval before / after

- Same eval set for baseline + fine-tuned.
- Compare on:
  - Quality (your eval metric)
  - Cost (tokens / latency)
  - Safety regressions

### When fine-tuning fails

- Bad data — clean, dedupe, label.
- Overfit on small set — fewer epochs, regularization.
- Catastrophic forgetting — mix with general data; lower LR.
- Eval set is not representative — fix the eval first.

### Tools

- **Hugging Face TRL** — SFTTrainer.
- **Axolotl** — YAML config for fine-tunes.
- **Unsloth** — fast LoRA training.
- **OpenAI / Anthropic fine-tuning APIs** — managed, limited customization.

## Anti-patterns

❌ **Fine-tuning to fix a prompt that doesn't work** — fix the prompt first.
❌ **Fine-tuning on data scraped without license review** — legal risk.
❌ **No held-out test set** — overfit is invisible.
❌ **Fine-tuning a small model to match a large one** — usually worse.
❌ **Skipping safety eval** — model can learn unsafe patterns.

## Related skills

- `llm-evaluation` — measurement
- `prompt-engineer` — try prompting first
- `llm-ops` — production

## References

- [Hugging Face PEFT docs](https://huggingface.co/docs/peft)
- [QLoRA paper](https://arxiv.org/abs/2305.14314)
- [Anthropic: Fine-tuning guide](https://docs.anthropic.com/en/docs/build-with-claude/fine-tune-claude)
```

### Step 10: Security — `security-reviewer`

`packages/runtime/src/skill/bundled/security-reviewer/SKILL.md`:

```markdown
---
name: security-reviewer
displayName: Security Reviewer
description: Application security review — threat modeling, vulnerability patterns, secure defaults, audit checklists. Use when designing or auditing a feature for security.
whenToUse:
  - Threat model a new feature
  - Audit an existing feature
  - Set security defaults for a project
  - Pre-launch security review
version: 1.0.0
author: curated from wshobson/agents + OWASP
license: MIT
tags: [security, threat-model, audit, owasp, vuln, review]
agents: [security-reviewer, build, code-reviewer]
tools: [read, write, edit, grep]
load: on-demand
---

# Security Reviewer

Security is a default, not a feature.

## When to invoke

- New feature with user input or auth
- Pre-launch audit
- After a security incident
- Adopting a new third-party service

## Core patterns

### Threat model (STRIDE)

For each component, list threats:

- **S**poofing — who can impersonate?
- **T**ampering — who can modify data in transit / at rest?
- **R**epudiation — can users deny actions? Are actions logged?
- **I**nformation disclosure — what data leaks?
- **D**enial of service — what can be flooded?
- **E**levation of privilege — how can a user gain more than allowed?

### OWASP Top 10 — quick checklist

\`\`\`
A01 Broken Access Control — every endpoint checks authz?
A02 Cryptographic Failures — TLS only; no MD5/SHA1 for security?
A03 Injection — parameterized queries; no string concat for SQL/HTML?
A04 Insecure Design — threat model exists?
A05 Misconfig — defaults secure (no debug in prod)?
A06 Components — `npm audit` clean? lockfile pinned?
A07 Auth Failures — strong password rules; MFA; secure session?
A08 Integrity — signed updates; CSRF tokens?
A09 Logging — auth events logged; no PII in logs?
A10 SSRF — URL allow-list; metadata IPs blocked?
\`\`\`

### Secure defaults

- TLS 1.2+ only.
- `Secure`, `HttpOnly`, `SameSite=Lax` (or `Strict`) on cookies.
- HSTS, CSP, X-Frame-Options.
- Password hashing: argon2id (or bcrypt cost ≥ 12).
- JWT: short expiry; refresh tokens; rotate signing keys.
- Secrets: env vars, never code; rotate on leak.

### Input validation

\`\`\`ts
const input = CreateUserSchema.parse(req.body)
\`\`\`

Validate at the boundary. Trust nothing internal.

### Output encoding

- HTML: encode `<`, `>`, `&`, `"`, `'`.
- URL: encode per RFC 3986.
- JSON: never build by string concat.

### Secrets handling

- Never log secrets.
- Never commit secrets (use `gitleaks` in CI).
- Use a secrets manager (Vault, AWS Secrets Manager).
- Rotate on suspicion; don't just remove from history.

### Logging hygiene

\`\`\`ts
log.info({ userId: hash(userId), action: "login" }, "auth")
// never: log.info({ password: req.body.password }, "...")
\`\`\`

### Dependency hygiene

- Pin in lockfile.
- `bun audit` / `npm audit` / `snyk test` in CI.
- Renovate / Dependabot for updates.
- Avoid abandoned packages.

## Anti-patterns

❌ **Custom crypto** — use vetted libraries.
❌ **Allow-list bypassed with wildcards** — list specific origins / paths.
❌ **`Secure: false` cookie in prod** — leaks over HTTP.
❌ **No rate limiting on auth** — credential stuffing.
❌ **Logs without structured fields** — useless in incident response.

## Related skills

- `owasp-top-10` — full mapping
- `secret-scanner` — automated detection
- `pci-compliance` — payment data
- `gdpr-data-handling` — privacy

## References

- [OWASP Top 10](https://owasp.org/Top10/)
- [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/)
- [Mozilla Web Security guidelines](https://infosec.mozilla.org/guidelines/web_security)
```

### Step 11: `owasp-top-10`

`packages/runtime/src/skill/bundled/owasp-top-10/SKILL.md`:

```markdown
---
name: owasp-top-10
displayName: OWASP Top 10
description: OWASP Top 10 (2021) — each category with examples, mitigations, code patterns. Use when auditing or learning web app security.
whenToUse:
  - Audit a web app for OWASP coverage
  - Train a team on security
  - Map a vuln to a category
  - Build a security checklist
version: 1.0.0
author: curated from wshobson/agents + OWASP Foundation
license: MIT
tags: [owasp, security, web, audit, top-10]
agents: [security-reviewer, code-reviewer]
tools: [read, write, edit, grep]
load: on-demand
---

# OWASP Top 10

Reference for the OWASP Top 10 (2021) categories with concrete mitigations.

## When to invoke

- Auditing a web app
- Building security training
- Mapping a vulnerability
- Compliance mapping

## Categories

### A01 — Broken Access Control

- IDOR via path params (e.g., `/users/:id` without ownership check).
- Missing function-level access control (admin endpoints open).
- CORS misconfigured (`Access-Control-Allow-Origin: *` with credentials).

Mitigations:
- Deny by default; explicit allow.
- Centralize authz; check on every request.
- Test with low-privilege users.

### A02 — Cryptographic Failures

- TLS off; weak ciphers.
- MD5 / SHA1 for password storage.
- Hardcoded keys.

Mitigations: TLS 1.2+; argon2id for passwords; KMS-managed keys.

### A03 — Injection

- SQL injection via string concat.
- NoSQL injection (`{"$ne": null}`).
- Command injection via shell.
- XSS via unescaped output.

Mitigations: parameterized queries; output encoding; allow-list shell args; CSP.

### A04 — Insecure Design

- No rate limiting → brute force.
- No threat model → missed risk.
- "Security through obscurity".

Mitigations: STRIDE threat model; abuse cases; secure design patterns.

### A05 — Security Misconfiguration

- Default creds (admin/admin).
- Debug mode in prod.
- Open S3 bucket / storage.
- Verbose error messages.

Mitigations: hardened base images; config as code; review prod diffs.

### A06 — Vulnerable & Outdated Components

- Old framework with CVE.
- Unmaintained npm package.
- Transitive dep with vuln.

Mitigations: SBOM; SCA in CI; auto-update PRs (Renovate); regular audits.

### A07 — Identification & Authentication Failures

- No MFA on admin.
- Predictable session IDs.
- Credentials in URL.
- No rate limiting on auth.

Mitigations: MFA; secure session cookies; rate limit; account lockout.

### A08 — Software & Data Integrity Failures

- Auto-update without signature verification.
- Insecure deserialization.
- CI/CD pipeline compromise (no signing).

Mitigations: signed updates; allow-list deserialization types; signed CI artifacts.

### A09 — Security Logging & Monitoring Failures

- Auth events not logged.
- Logs without user / IP / timestamp.
- No alerting on suspicious patterns.

Mitigations: log auth + authz failures with structure; alert on anomalies.

### A10 — Server-Side Request Forgery (SSRF)

- URL fetch from user input → internal metadata endpoint.

Mitigations: allow-list domains; block link-local IPs (169.254.0.0/16); use a proxy; disable redirects.

## Audit workflow

1. Walk each user journey.
2. For each step, ask: which Top 10 applies?
3. Check mitigation in place.
4. Document residual risk.

## Anti-patterns

❌ **"We have a WAF"** — defense in depth, not a single control.
❌ **Annual penetration test as the only check** — shift left.
❌ **No logging of successful auth** — limits forensics.
❌ **Allowing client-set rate limits** — set server-side.

## Related skills

- `security-reviewer` — broader review
- `secret-scanner` — automated detection
- `auth-implementation-patterns` — auth-specific

## References

- [OWASP Top 10 (2021)](https://owasp.org/Top10/)
```

### Step 12: `pci-compliance`

`packages/runtime/src/skill/bundled/pci-compliance/SKILL.md`:

```markdown
---
name: pci-compliance
displayName: PCI-DSS Compliance
description: PCI-DSS v4 — cardholder data, scope reduction, network segmentation, logging, key management. Use when designing or auditing a payment system.
whenToUse:
  - Design a payment system
  - Minimize PCI scope
  - Audit for PCI compliance
  - Implement tokenization
version: 1.0.0
author: curated from wshobson/agents + PCI Security Standards Council
license: MIT
tags: [pci, compliance, payments, security, audit, tokenization]
agents: [security-reviewer, build, sre-engineer]
tools: [read, write, edit, grep]
load: on-demand
---

# PCI-DSS Compliance

PCI-DSS v4. Minimize scope. Tokenize. Use a provider.

## When to invoke

- Designing a payment system
- Auditing for PCI compliance
- Reducing scope with tokenization
- Choosing between SAQ-A, SAQ-A-EP, SAQ-D

## Core patterns

### Scope minimization

The less cardholder data (CHD) you touch, the easier the audit.

- **SAQ-A** — fully outsourced (Stripe Elements, Braintree Hosted Fields). Your page never sees PAN.
- **SAQ-A-EP** — your page loads the provider's iframe but otherwise handles PAN.
- **SAQ-D** — you store / process PAN directly. Heavy.

Default: **SAQ-A** with Stripe Elements / Braintree Hosted Fields.

### Tokenization

\`\`\`ts
// Stripe Elements — your server never sees the PAN
const { token, error } = await stripe.createToken(cardElement)
await fetch("/api/charge", { method: "POST", body: JSON.stringify({ token: token.id }) })
\`\`\`

The token is a single-use reference to the PAN stored at Stripe.

### Storage rules

If you must store PAN:

- Encrypted at rest (AES-256).
- Truncated display (first 6 + last 4).
- Never store CVV/CVC, PIN, full magnetic stripe.
- Retain only as long as needed; documented retention policy.

### Network segmentation

- Cardholder Data Environment (CDE) on isolated VLAN / subnet.
- Firewall between CDE and other networks.
- No admin access from CDE to corp network.
- Jump box for CDE access; logged.

### Logging

Log every access to CHD:

- Who, what, when, where, result.
- Logs themselves protected (integrity + access).
- 12 months online; 3 months immediately searchable.

### Key management

- Keys in HSM or KMS (not code).
- Key rotation per policy (typically annually).
- Split knowledge / dual control for key ceremonies.
- Document key custodians.

### Testing

- ASV scan quarterly (Approved Scanning Vendor).
- Internal vulnerability scan quarterly.
- Penetration test annually + after significant change.
- Web app scan after every major release.

### Common pitfalls

- PAN in logs accidentally (debug print, error trace).
- PAN in backups not encrypted.
- Test data with real PANs.
- S3 buckets with CHD not encrypted / public.

## Anti-patterns

❌ **Building your own payment form** — use Stripe Elements / Braintree Hosted Fields.
❌ **Storing CVV** — illegal.
❌ **Emailing PAN to user "for convenience"** — violates PCI.
❌ **Long-lived admin sessions to the CDE** — high audit risk.
❌ **Logging PAN** — even temporarily, in stack traces.

## Related skills

- `security-reviewer` — broader security
- `owasp-top-10` — web app baseline
- `gdpr-data-handling` — privacy overlap

## References

- [PCI-DSS v4.0](https://www.pcisecuritystandards.org/document_library)
- [Stripe: PCI compliance guide](https://stripe.com/docs/security/guide)
```

### Step 13: `gdpr-data-handling`

`packages/runtime/src/skill/bundled/gdpr-data-handling/SKILL.md`:

```markdown
---
name: gdpr-data-handling
displayName: GDPR Data Handling
description: GDPR / privacy — lawful basis, DSARs, data minimization, retention, cross-border transfers. Use when designing features that process EU personal data.
whenToUse:
  - Design a feature with personal data
  - Implement a DSAR workflow
  - Audit data retention
  - Plan cross-border transfers
version: 1.0.0
author: curated from wshobson/agents + EDPB guidelines
license: MIT
tags: [gdpr, privacy, dsar, compliance, data-protection, edpb]
agents: [security-reviewer, build]
tools: [read, write, edit]
load: on-demand
---

# GDPR Data Handling

Privacy by design. Minimize data; document your basis.

## When to invoke

- Adding a feature that processes personal data
- Implementing DSAR (data subject access request) workflow
- Choosing a data processor
- Cross-border data transfer

## Core patterns

### Lawful basis

Pick one (document it):

- **Consent** — freely given, specific, informed, unambiguous. Easy to withdraw.
- **Contract** — necessary to perform a contract with the user.
- **Legal obligation** — required by law.
- **Vital interests** — life-threatening.
- **Public task** — public interest.
- **Legitimate interests** — balance test against user rights.

Most B2C SaaS uses contract + consent.

### Data minimization

Collect only what's needed for the purpose. If you don't need it, don't collect it.

### Retention

Define a retention schedule:

\`\`\`markdown
| Data | Retention | Basis |
|---|---|---|
| Account data | Account lifetime + 30d | Contract |
| Order history | 7 years (tax) | Legal obligation |
| Session logs | 30 days | Legitimate interest |
| Marketing consent | Until withdrawn | Consent |
\`\`\`

Auto-delete after retention period.

### DSAR (Data Subject Access Request)

GDPR grants users rights:

- **Access** — what data do you have?
- **Rectification** — fix wrong data.
- **Erasure** ("right to be forgotten").
- **Restrict processing**.
- **Data portability** — machine-readable export.
- **Object** to processing.
- **Withdraw consent**.

Response within 30 days (extendable to 90 with notice).

\`\`\`ts
async function exportUser(userId: string) {
    const profile = await db.profile.findOne({ userId })
    const orders = await db.orders.find({ userId })
    const sessions = await db.sessions.find({ userId })
    return { profile, orders, sessions }
}
\`\`\`

\`\`\`ts
async function deleteUser(userId: string) {
    await db.profile.delete({ userId })
    await db.orders.anonymize({ userId })  // keep for legal retention, remove PII
    await db.sessions.delete({ userId })
}
\`\`\`

### Cross-border transfers

Outside the EEA, you need:

- **Adequacy decision** — recipient country is "adequate".
- **SCCs** — Standard Contractual Clauses.
- **BCRs** — Binding Corporate Rules (large orgs).
- **Consent** — narrow, not blanket.

US transfers: Data Privacy Framework (DPF) successor to Privacy Shield.

### Processors

List all subprocessors. Use a DPA (Data Processing Agreement). Maintain a subprocessor list.

### Records of processing (Art. 30)

Maintain a register:

\`\`\`markdown
| Activity | Purpose | Basis | Categories | Recipients | Retention |
|---|---|---|---|---|---|
| User accounts | Service delivery | Contract | Name, email, hashed password | Stripe (payment), Postmark (email) | Account lifetime |
\`\`\`

### Security (Art. 32)

Pseudonymization, encryption, resilience, regular testing — covered by `security-reviewer`.

## Anti-patterns

❌ **Implicit consent** — pre-ticked boxes are not consent.
❌ **Bundled consent** — "I agree to everything" — not specific.
❌ **"By using our service you consent…"** — not freely given.
❌ **Storing data "just in case"** — no purpose = no basis.
❌ **Cross-border transfer without SCCs / DPF** — illegal.

## Related skills

- `security-reviewer` — security baseline
- `pci-compliance` — overlap for payment data
- `auth-implementation-patterns` — auth flows

## References

- [GDPR full text](https://gdpr-info.eu/)
- [EDPB guidelines](https://edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-022023-technical-scope-art-53-eprivacy_en)
- [ICO: Guide to GDPR](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/)
```

### Step 14: `secret-scanner`

`packages/runtime/src/skill/bundled/secret-scanner/SKILL.md`:

```markdown
---
name: secret-scanner
displayName: Secret Scanner
description: Secret detection — git history scanning, pre-commit hooks, CI integration, rotation playbook. Use when setting up secret-scanning pipelines.
whenToUse:
  - Set up secret scanning in CI
  - Audit a repo for leaked secrets
  - Respond to a leaked secret
  - Add pre-commit hook
version: 1.0.0
author: curated from wshobson/agents + gitleaks docs
license: MIT
tags: [secrets, scanning, gitleaks, ci, pre-commit, rotation]
agents: [security-reviewer, devops]
tools: [read, write, edit, bash, grep]
load: on-demand
---

# Secret Scanner

Catch secrets before they're committed. Rotate immediately when leaked.

## When to invoke

- Setting up CI secret scanning
- Pre-commit hook for developers
- Responding to a leak alert
- Auditing a legacy repo

## Core patterns

### Tools

- **gitleaks** — pre-commit + repo scan, regex-based, configurable.
- **trufflehog** — entropy + regex; finds more, higher false-positive rate.
- **detect-secrets** (Yelp) — baseline approach; lock known secrets.
- **GitHub native secret scanning** — for public repos; auto-revokes for some providers.
- **GitLab Secret Detection** — built-in CI.

### gitleaks pre-commit

\`\`\`toml
# .gitleaks.toml
title = "gitleaks config"

[[rules]]
id = "aws-access-token"
description = "AWS Access Key"
regex = '''AKIA[0-9A-Z]{16}'''
tags = ["aws", "key"]

[allowlist]
paths = ['''tests/fixtures/.*''']
\`\`\`

\`\`\`bash
brew install gitleaks
gitleaks protect --staged --config .gitleaks.toml
gitleaks detect --config .gitleaks.toml
\`\`\`

### Pre-commit hook (using pre-commit framework)

\`\`\`yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/gitleaks/gitleaks
    rev: v8.18.0
    hooks:
      - id: gitleaks
\`\`\`

### CI scan

\`\`\`yaml
# GitHub Actions
- name: gitleaks
  uses: gitleaks/gitleaks-action@v2
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
\`\`\`

### Rotate on leak (mandatory)

Removing from history is NOT enough — the secret is still valid until rotation.

\`\`\`markdown
## Rotation playbook
1. Generate new credential in the issuing system.
2. Update all consumers (deploy new env var).
3. Revoke the leaked credential.
4. Verify the new credential works; old one fails.
5. Remove from history (`git filter-repo` + force-push).
6. File an incident if access logs show use of the leaked credential.
\`\`\`

### Detecting accidental commits in-flight

\`\`\`bash
# Block in pre-commit
git secrets --install
git secrets --register-aws
\`\`\`

### AWS-specific

\`\`\`bash
# Use short-lived credentials via IAM Roles Anywhere
# or OIDC from CI (no static keys at all)
aws sts assume-role-with-web-identity --role-arn … --web-identity-token-file …
\`\`\`

### Entropy-based scanning

TruffleHog detects high-entropy strings that look like secrets:

\`\`\`bash
trufflehog git file://. --only-verified
\`\`\`

Higher recall; review findings manually.

## Anti-patterns

❌ **Removing from history without rotating** — leaked secret is still valid.
❌ **Allow-listed "test" secrets that look real** — copy with a clear marker.
❌ **No pre-commit hook** — relying on CI alone.
❌ **Secrets in `.env.example`** — sometimes copied as-is.
❌ **No sub-second revoke when an incident is detected** — assume compromise.

## Related skills

- `security-reviewer` — broader security
- `auth-implementation-patterns` — auth flows
- `git-cleanup` — remove from history

## References

- [gitleaks docs](https://github.com/gitleaks/gitleaks)
- [TruffleHog docs](https://github.com/trufflesecurity/trufflehog)
- [GitHub: Secret scanning](https://docs.github.com/en/code-security/secret-scanning/about-secret-scanning)
```

### Step 15: `auth-implementation-patterns`

`packages/runtime/src/skill/bundled/auth-implementation-patterns/SKILL.md`:

```markdown
---
name: auth-implementation-patterns
displayName: Auth Implementation Patterns
description: Authentication & authorization — sessions, JWT, OAuth/OIDC, password hashing, MFA, RBAC. Use when implementing or reviewing auth.
whenToUse:
  - Implement login / signup
  - Add OAuth (Google, GitHub)
  - Add MFA
  - Implement RBAC / ABAC
  - Audit auth flows
version: 1.0.0
author: curated from wshobson/agents + OWASP ASVS
license: MIT
tags: [auth, oauth, jwt, session, mfa, rbac, oidc]
agents: [security-reviewer, build]
tools: [read, write, edit, grep]
load: on-demand
---

# Auth Implementation Patterns

Auth done right is invisible. Auth done wrong is catastrophic.

## When to invoke

- New login / signup flow
- Adding OAuth provider
- Adding MFA
- Implementing roles / permissions
- Auditing existing auth

## Core patterns

### Password storage

\`\`\`ts
import argon2 from "argon2"
const hash = await argon2.hash(password, { type: argon2.argon2id })
const ok = await argon2.verify(hash, password)
\`\`\`

Use argon2id. Never MD5 / SHA1 / bcrypt cost < 12.

### Sessions

\`\`\`ts
app.post("/login", async (req, res) => {
    const user = await verifyPassword(req.body.email, req.body.password)
    if (!user) return res.status(401).json({ error: "invalid" })
    req.session.regenerate(() => {            // prevent fixation
        req.session.userId = user.id
        req.session.save(() => res.json({ ok: true }))
    })
})
\`\`\`

Cookie attributes: `Secure`, `HttpOnly`, `SameSite=Lax` (or `Strict`), `__Host-` prefix.

### JWT

\`\`\`ts
import jwt from "jsonwebtoken"
const access = jwt.sign({ sub: user.id }, process.env.JWT_SECRET!, { expiresIn: "15m" })
const refresh = jwt.sign({ sub: user.id, type: "refresh" }, process.env.REFRESH_SECRET!, { expiresIn: "30d" })
\`\`\`

- Short-lived access tokens (15m).
- Refresh tokens stored httpOnly; rotated on use.
- Signing key rotation; support `kid` header.
- Don't put PII in payload — it's not encrypted.

### OAuth 2.0 / OIDC

Use a library (NextAuth, Auth.js, Passport, Clerk, WorkOS).

\`\`\`ts
// NextAuth example
import NextAuth from "next-auth"
import GitHub from "next-auth/providers/github"
export const { auth, handlers } = NextAuth({ providers: [GitHub] })
\`\`\`

- `state` parameter (CSRF).
- `PKCE` for public clients (mobile / SPA).
- Validate `aud`, `iss`, `exp`.
- Token rotation; refresh.

### MFA

- TOTP (RFC 6238) with authenticator apps.
- WebAuthn for phishing-resistant.
- Backup codes (one-time, hashed at rest).
- Step-up auth for sensitive actions.

### Authorization (RBAC / ABAC)

\`\`\`ts
type Action = "read" | "write" | "delete"
type Resource = "order" | "user" | "report"

const can = (user: User, action: Action, resource: Resource, ctx: Ctx): boolean => {
    if (user.role === "admin") return true
    if (action === "read" && resource === "order" && ctx.order.userId === user.id) return true
    return false
}
\`\`\`

Centralize the check. Audit every privileged endpoint.

### Rate limiting

\`\`\`ts
import rateLimit from "express-rate-limit"
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 })
app.post("/login", authLimiter, loginHandler)
\`\`\`

Stricter on auth endpoints.

### Account recovery

- Email-based reset (token, single-use, 15-min expiry).
- No security questions.
- Notify on password change.

## Anti-patterns

❌ **JWT in localStorage** — accessible to XSS; use httpOnly cookies.
❌ **Custom crypto / password storage** — use vetted libs.
❌ **Long-lived sessions without rotation** — fix immediately.
❌ **No rate limiting on auth** — credential stuffing.
❌ **Authz checks scattered across handlers** — centralize.

## Related skills

- `security-reviewer` — broader security
- `gdpr-data-handling` — consent for cookies
- `secret-scanner` — JWT secret leaks

## References

- [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/)
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [RFC 6238 (TOTP)](https://www.rfc-editor.org/rfc/rfc6238)
```

### Step 16: `secure-code-guardian`

`packages/runtime/src/skill/bundled/secure-code-guardian/SKILL.md`:

```markdown
---
name: secure-code-guardian
displayName: Secure Code Guardian
description: Secure coding defaults — input validation, output encoding, parameterization, secrets hygiene, dependency checks. Use when authoring new code or auditing existing.
whenToUse:
  - Set up secure defaults for a project
  - Author code that handles user input
  - Audit for common vulnerability patterns
  - Build a secure coding guideline
version: 1.0.0
author: curated from wshobson/agents + OWASP ASVS
license: MIT
tags: [security, defaults, input-validation, output-encoding, parameterization]
agents: [security-reviewer, build]
tools: [read, write, edit, grep]
load: on-demand
---

# Secure Code Guardian

Defaults that prevent the OWASP Top 10 by construction.

## When to invoke

- Setting up a new project
- Authoring code that handles user input
- Reviewing for vulns
- Onboarding engineers

## Core patterns

### Input validation

\`\`\`ts
const CreateUser = z.object({
    email: z.string().email().max(254),
    name: z.string().min(1).max(100),
    age: z.number().int().min(13).max(150),
})
const input = CreateUser.parse(req.body)
\`\`\`

Validate at the boundary. Reject unknown fields (`.strict()`).

### Parameterized queries

\`\`\`ts
// Safe
await db.query("SELECT * FROM users WHERE id = $1", [id])

// Vulnerable
await db.query(`SELECT * FROM users WHERE id = '${id}'`)
\`\`\`

### Output encoding

- **HTML**: framework default (React escapes by default).
- **URL**: `encodeURIComponent`.
- **JSON**: don't build by string concat.
- **Shell**: `execFile` with array args; never string concat.

### CSRF

- Synchronizer token pattern (OWASP).
- SameSite=Lax cookies as default.
- `Origin` / `Referer` checks for state-changing requests.

### Headers

\`\`\`ts
app.use(helmet({
    contentSecurityPolicy: {
        directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"] },
    },
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
}))
\`\`\`

### Logging without PII

\`\`\`ts
log.info({ userId: hash(userId), action: "create" }, "user created")
\`\`\`

### Dependency hygiene

- `bun audit` / `npm audit` in CI.
- Renovate / Dependabot.
- Avoid abandoned / typosquat packages.

### Secrets in code

\`\`\`ts
// Bad
const API_KEY = "sk-live-…"

// Good
const API_KEY = process.env.API_KEY!
\`\`\`

### File uploads

- Validate content type by magic numbers, not just extension.
- Store outside webroot; serve via signed URL.
- Scan for malware if user-generated.
- Limit size.

### Deserialization

- Never `JSON.parse` untrusted input without schema validation.
- For binary formats (pickle, Java serialization), avoid on untrusted input.

## Anti-patterns

❌ **`String.includes` as a security check** — easily bypassed.
❌ **Client-side validation only** — server must validate.
❌ **`disabled` attribute for security** — UI hint, not security control.
❌ **Allowing `*` in CORS** — restrict to specific origins.
❌ **Filtering `'` for SQL injection** — parameterized is the answer.

## Related skills

- `security-reviewer` — review process
- `owasp-top-10` — full mapping
- `secret-scanner` — automated checks
- `auth-implementation-patterns` — auth flows

## References

- [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/)
- [OWASP Cheat Sheet Series](https://cheatsheetseries.owasp.org/)
```

### Step 17: Accessibility — `accessibility-compliance`

`packages/runtime/src/skill/bundled/accessibility-compliance/SKILL.md`:

```markdown
---
name: accessibility-compliance
displayName: Accessibility Compliance
description: WCAG 2.2 AA — perceivable, operable, understandable, robust. Semantic HTML, ARIA, keyboard nav, color contrast. Use when authoring or auditing UI.
whenToUse:
  - Audit a web app for a11y
  - Author accessible components
  - Fix a11y issues found by axe
  - Pass WCAG 2.2 AA
version: 1.0.0
author: curated from wshobson/agents + W3C WAI
license: MIT
tags: [accessibility, a11y, wcag, aria, keyboard, contrast]
agents: [frontend-design, build, code-reviewer]
tools: [read, write, edit, bash]
load: on-demand
---

# Accessibility Compliance

WCAG 2.2 AA. Build for everyone from day one.

## When to invoke

- Authoring UI components
- Auditing an existing site
- Fixing axe / Lighthouse a11y issues
- Targeting compliance (ADA, EAA)

## Core patterns

### POUR — the four principles

- **Perceivable** — text alternatives, captions, color contrast.
- **Operable** — keyboard, no seizures, navigable.
- **Understandable** — readable, predictable, input assistance.
- **Robust** — compatible with assistive tech.

### Semantic HTML first

\`\`\`html
<!-- Bad -->
<div onclick="submit()">Submit</div>

<!-- Good -->
<button type="submit">Submit</button>
\`\`\`

Use `<button>`, `<a>`, `<nav>`, `<main>`, `<header>`, `<label>`, `<fieldset>` instead of divs.

### Keyboard nav

- All interactive elements reachable via Tab.
- Visible focus ring (`:focus-visible`).
- Logical tab order (don't `tabindex=">0"` lightly).
- Escape closes modals; focus returns to trigger.

### ARIA — only when HTML isn't enough

- `aria-label` for icon-only buttons.
- `aria-describedby` for input hints.
- `role="alert"` for live error messages.
- `aria-live="polite"` for status updates.

### Color contrast

- Body text: 4.5:1 (AA) / 7:1 (AAA).
- Large text (18pt+): 3:1.
- Don't use color alone to convey info (also use icon / label).

### Forms

\`\`\`html
<label for="email">Email</label>
<input id="email" type="email" aria-describedby="email-help" />
<div id="email-help">We never share your email.</div>
\`\`\`

- Every input has a `<label>`.
- Error messages associated via `aria-describedby` or `aria-errormessage`.
- Don't disable submit silently; explain why.

### Images

\`\`\`html
<img src="logo.png" alt="Acme Corp logo" />
<img src="decorative.png" alt="" />          <!-- decorative -->
<svg aria-label="Settings">…</svg>
\`\`\`

### Headings

- One `<h1>` per page.
- Don't skip levels (h1 → h3).
- Use headings to outline structure.

### Skip link

\`\`\`html
<a href="#main" class="skip-link">Skip to main content</a>
\`\`\`

\`\`\`css
.skip-link {
    position: absolute;
    left: -9999px;
}
.skip-link:focus {
    left: 1rem; top: 1rem;
}
\`\`\`

### Automated testing

\`\`\`bash
# axe in CI
bunx @axe-core/cli http://localhost:3000

# Playwright + axe
import { AxeBuilder } from "@axe-core/playwright"
await new AxeBuilder({ page }).analyze()
\`\`\`

### Manual testing

- Keyboard-only navigation.
- Screen reader (VoiceOver, NVDA).
- 200% zoom.
- High-contrast mode.

## Anti-patterns

❌ **`<div role="button">`** — use `<button>`.
❌ **`aria-label` with same text as visible label** — redundant.
❌ **Positive `tabindex`** — disrupts natural order.
❌ **Auto-playing audio / video** — disorienting.
❌ **Custom focus ring removal** — `:focus { outline: none }` without replacement.

## Related skills

- `wcag-audit-patterns` — audit workflow
- `screen-reader-testing` — manual SR testing
- `frontend-design` — visual design

## References

- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [WAI-ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/)
- [axe-core rules](https://dequeuniversity.com/rules/axe/)
```

### Step 18: `wcag-audit-patterns`

`packages/runtime/src/skill/bundled/wcag-audit-patterns/SKILL.md`:

```markdown
---
name: wcag-audit-patterns
displayName: WCAG Audit Patterns
description: WCAG audit workflow — automated + manual + screen reader + user testing. Use when conducting an accessibility audit.
whenToUse:
  - Audit a web app
  - Build an a11y regression suite
  - Train engineers on a11y audits
  - Document remediation priorities
version: 1.0.0
author: curated from wshobson/agents + W3C WAI, Deque
license: MIT
tags: [a11y, audit, wcag, accessibility, conformance]
agents: [frontend-design, code-reviewer]
tools: [read, write, edit, bash]
load: on-demand
---

# WCAG Audit Patterns

A11y isn't a checklist — but checklists help.

## When to invoke

- Pre-launch a11y audit
- Periodic compliance review
- After a major redesign
- Resolving a complaint

## Core patterns

### Audit phases

1. **Automated** — axe / Lighthouse / WAVE. Catches ~30% of issues.
2. **Manual code review** — semantic HTML, ARIA, keyboard flow.
3. **Screen reader** — VoiceOver + NVDA on critical journeys.
4. **User testing** — people with disabilities on real flows.

### Automated tools

\`\`\`bash
# axe CLI
bunx @axe-core/cli http://localhost:3000

# Lighthouse
bunx lighthouse http://localhost:3000 --only-categories=accessibility

# Pa11y
bunx pa11y http://localhost:3000
\`\`\`

Integrate into CI:

\`\`\`ts
test("home page passes axe", async ({ page }) => {
    await page.goto("/")
    const results = await new AxeBuilder({ page }).analyze()
    expect(results.violations).toEqual([])
})
\`\`\`

### Common findings → fixes

| Issue | Fix |
|---|---|
| Image missing alt | Add `alt` (or `alt=""` if decorative) |
| Low contrast | Adjust colors to meet 4.5:1 |
| Missing form label | Add `<label for="…">` or `aria-label` |
| Empty button | Add accessible name (text or `aria-label`) |
| Missing lang attr | Add `<html lang="en">` |
| Heading skip | Adjust heading levels |
| No skip link | Add skip-to-main link |
| Focus not visible | Add `:focus-visible` styles |

### Severity rubric

- **Critical** — blocks users (e.g., can't submit form with keyboard).
- **Serious** — significant barrier (e.g., low contrast).
- **Moderate** — inconvenience (e.g., heading skip).
- **Minor** — polish (e.g., redundant alt).

### Report template

\`\`\`markdown
# A11y audit — <app>

## Scope
<URLs, dates, tools>

## Findings summary
- Critical: 3
- Serious: 7
- Moderate: 12
- Minor: 8

## Top critical issues
1. Login form unusable with keyboard (button inside `<div>` without handler).
2. Color contrast on error messages 2.1:1.
3. No skip-to-main link.

## Remediation plan
| Issue | Severity | Owner | Due |
|---|---|---|---|
| … | … | … | … |
\`\`\`

### Conformance levels

- **A** — minimum (must fix).
- **AA** — standard target (legal bar in many jurisdictions).
- **AAA** — aspirational.

Target AA unless contractual AAA.

### Continuous a11y

- Add axe to CI (fail on critical).
- Component library audited once.
- New components audited before merge.
- Quarterly user testing with disabled users.

## Anti-patterns

❌ **"We'll fix a11y later"** — debt compounds.
❌ **Auditing only the homepage** — covers < 30% of journeys.
❌ **Skipping manual testing** — automated misses a lot.
❌ **Treating axe pass as enough** — it's necessary, not sufficient.
❌ **Focus on the easy automated checks** — keyboard + SR matter more.

## Related skills

- `accessibility-compliance` — patterns
- `screen-reader-testing` — manual SR
- `ui-a11y` — component-level audit

## References

- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [axe-core rules](https://github.com/dequelabs/axe-core/tree/develop/doc/rules)
- [The A11Y Project](https://www.a11yproject.com/)
```

### Step 19: `screen-reader-testing`

`packages/runtime/src/skill/bundled/screen-reader-testing/SKILL.md`:

```markdown
---
name: screen-reader-testing
displayName: Screen Reader Testing
description: Manual screen reader testing — VoiceOver (macOS/iOS), NVDA (Windows), JAWS, TalkBack (Android). Use when verifying SR experience.
whenToUse:
  - Verify SR experience for a flow
  - Debug an a11y issue
  - Train a team on SR basics
  - Validate ARIA usage
version: 1.0.0
author: curated from wshobson/agents + WebAIM
license: MIT
tags: [a11y, screen-reader, voiceover, nvda, jaws, aria]
agents: [frontend-design, code-reviewer]
tools: [bash, read]
load: on-demand
---

# Screen Reader Testing

You can't fix what you haven't heard.

## When to invoke

- New feature with custom widgets
- Debugging reported a11y issue
- Pre-launch SR smoke test
- Validating ARIA usage

## Core patterns

### Tools

- **VoiceOver** — macOS (`⌘F5`) / iOS (Settings → Accessibility).
- **NVDA** — Windows; free; install + `Ctrl+Alt+N` to start.
- **JAWS** — Windows; commercial; widely used in enterprise.
- **TalkBack** — Android (Settings → Accessibility).
- **Orca** — Linux.

### Essential commands

\`\`\`
VoiceOver (macOS):
  VO = Ctrl+Option
  VO + A          start reading
  VO + →          next item
  VO + Shift + →  previous
  VO + Space      activate
  Ctrl            stop speaking

NVDA (Windows):
  NVDA = Ctrl+Alt
  NVDA + ↓        next line
  NVDA + Space    activate
  Insert + F7     elements list
\`\`\`

### Testing checklist (per critical journey)

- [ ] Page title announced on load.
- [ ] Headings navigation (VO+Cmd+H / NVDA+H) reflects structure.
- [ ] Form fields have labels announced on focus.
- [ ] Error messages announced (aria-live or focus).
- [ ] Buttons announce their name + state.
- [ ] Links announce their purpose.
- [ ] Modal traps focus; Escape closes; focus returns.
- [ ] Live regions announce updates without stealing focus.

### Common issues

| Heard | Likely cause |
|---|---|
| "button" with no name | Empty / icon-only button; add `aria-label` |
| "image" with no description | Missing `alt` |
| Two fields, same label | `for` mismatch |
| Error not announced | Missing `aria-live` or focus move |
| Reading too much on click | Bad `aria-label` / redundant description |
| Nothing announced on update | Missing live region |

### Live regions

\`\`\`html
<div aria-live="polite" id="status"></div>
<div aria-live="assertive" role="alert" id="errors"></div>
\`\`\`

- `polite` — announces when idle.
- `assertive` — interrupts.

### Forms

- Each input: `<label>` or `aria-label`.
- Required state: `aria-required="true"` or text in label.
- Errors: `aria-invalid="true"` + `aria-describedby` to the error.

### Modal focus trap

1. On open: focus first interactive.
2. Tab cycles within modal.
3. Escape closes.
4. On close: focus returns to trigger.

## Anti-patterns

❌ **`role="button"` on a `<div>`** — works, but loses keyboard support unless you wire it manually.
❌ **Removing `outline` without replacement** — focus invisible to SR user.
❌ **Long alt text** — describe concisely.
❌ **`aria-label="button"`** — don't announce "button" inside a button.
❌ **Skipping SR testing because "we have axe"** — axe is necessary, not sufficient.

## Related skills

- `accessibility-compliance` — patterns
- `wcag-audit-patterns` — audit workflow
- `frontend-design` — visual + a11y together

## References

- [WebAIM: Screen Reader Testing](https://webaim.org/articles/screenreader_testing/)
- [VoiceOver User Guide](https://support.apple.com/guide/voiceover/welcome/mac)
- [NVDA User Guide](https://www.nvaccess.org/files/nvda/documentation/userGuide.html)
```

### Step 20: `ui-a11y`

`packages/runtime/src/skill/bundled/ui-a11y/SKILL.md`:

```markdown
---
name: ui-a11y
displayName: UI Accessibility
description: Component-level a11y — accessible primitives, focus management, keyboard handlers, ARIA patterns. Use when building or auditing UI components.
whenToUse:
  - Build an accessible component
  - Audit a component for a11y
  - Implement a complex widget (combobox, listbox, dialog)
  - Fix focus / keyboard issues
version: 1.0.0
author: curated from wshobson/agents + Radix UI, WAI-ARIA APG
license: MIT
tags: [a11y, components, focus, keyboard, aria, combobox, dialog]
agents: [frontend-design, build]
tools: [read, write, edit]
load: on-demand
---

# UI Accessibility

Component-level a11y for primitives like Dialog, Combobox, Tabs.

## When to invoke

- Build a non-trivial interactive component
- Adopt headless primitives (Radix, React Aria, Headless UI)
- Audit a custom component
- Fix a keyboard / SR issue

## Core patterns

### Prefer headless libraries

\`\`\`tsx
import * as Dialog from "@radix-ui/react-dialog"
import * as Select from "@radix-ui/react-select"
\`\`\`

Radix UI, React Aria, Headless UI, Ark UI — all ship a11y correct. Compose; don't reinvent.

### Keyboard support — every widget needs:

| Key | Common behavior |
|---|---|
| Tab | Move focus to / out of widget |
| Shift+Tab | Reverse |
| Arrow keys | Move within widget |
| Enter / Space | Activate |
| Escape | Cancel / close |
| Home / End | First / last |

### Dialog

\`\`\`tsx
<Dialog.Root>
    <Dialog.Trigger>Open</Dialog.Trigger>
    <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content>
            <Dialog.Title>Confirm</Dialog.Title>
            <Dialog.Description>Are you sure?</Dialog.Description>
            <Dialog.Close>Cancel</Dialog.Close>
            <Dialog.Action>Confirm</Dialog.Action>
        </Dialog.Content>
    </Dialog.Portal>
</Dialog.Root>
\`\`\`

Radix handles: focus trap, Escape to close, restore focus to trigger, body scroll lock.

### Combobox

- Input is `role="combobox"`, `aria-expanded`, `aria-controls`.
- Listbox is `role="listbox"`; options `role="option"`.
- Arrow keys navigate; Enter selects; Escape closes.
- Highlight + active descendant pattern (don't steal focus from input).

\`\`\`tsx
<input
    role="combobox"
    aria-expanded={open}
    aria-controls="listbox"
    aria-activedescendant={active ? `opt-${active}` : undefined}
/>
<ul role="listbox" id="listbox">
    {items.map(it => (
        <li id={`opt-${it.id}`} role="option" aria-selected={it.id === active}>{it.label}</li>
    ))}
</ul>
\`\`\`

### Tabs

- Tablist: `role="tablist"`.
- Each tab: `role="tab"`, `aria-selected`, `aria-controls`.
- Panel: `role="tabpanel"`, `aria-labelledby` to its tab.
- Arrow keys move between tabs (Horizontal: ← →; Vertical: ↑ ↓).

### Disclosure (accordion / collapse)

\`\`\`tsx
<button aria-expanded={open} aria-controls="panel">Toggle</button>
<div id="panel" hidden={!open}>...</div>
\`\`\`

### Skip / dismissable UI

- Toast notifications: `role="status"` + `aria-live="polite"`; auto-dismiss with timeout; let user dismiss.
- Tooltips: appear on focus + hover; dismissible.

### Custom focus styles

\`\`\`css
:focus { outline: none; }       /* never without replacement */
:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
}
\`\`\`

### Reduced motion

\`\`\`css
@media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
        animation-duration: 0.01ms !important;
        transition-duration: 0.01ms !important;
    }
}
\`\`\`

## Anti-patterns

❌ **`onClick` on a `<div>`** — use `<button>`.
❌ **Modal without focus trap** — Tab escapes to background.
❌ **Combobox that loses focus when navigating options** — use `aria-activedescendant`.
❌ **Auto-focusing on page load without user action** — disorienting.
❌ **Disabled buttons without explanation** — disable rarely; explain.

## Related skills

- `accessibility-compliance` — broader patterns
- `screen-reader-testing` — manual SR
- `frontend-design` — visual + a11y together

## References

- [WAI-ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/)
- [Radix UI](https://www.radix-ui.com/)
- [React Aria](https://react-spectrum.adobe.com/react-aria/)
```

### Step 21: Design — `frontend-design`

`packages/runtime/src/skill/bundled/frontend-design/SKILL.md`:

```markdown
---
name: frontend-design
displayName: Frontend Design (Anthropic)
description: Distinctive, intentional visual design — typography, color, layout, motion. Helps make UI choices that don't read as templated defaults. Use when designing or refreshing UI.
whenToUse:
  - Design a new UI
  - Refresh an existing UI
  - Establish a visual language
  - Critique a design for "templated" feel
version: 1.0.0
author: anthropics/skills (frontend-design) — MIT
license: MIT
tags: [design, ui, typography, color, motion, frontend]
agents: [frontend-design, build]
tools: [read, write, edit]
load: on-demand
---

# Frontend Design

Adapted from Anthropic's `frontend-design` skill. Distinctive, intentional choices.

## When to invoke

- Designing new UI
- Reviewing visual design for "templated" feel
- Establishing a project's design language
- Choosing typography / color / motion

## Core patterns

### Start with intent

\`\`\`
What is this product about?
Who is it for?
What feeling should the design evoke?
\`\`\`

"Modern minimal" is a starting point — push further.

### Typography

- **Pair a display + a text face.** Don't use two text faces.
- Establish a scale: 12 / 14 / 16 / 20 / 24 / 32 / 48 / 64.
- Use a modular scale (1.25, 1.333, 1.5) for rhythm.
- Variable fonts for performance.

### Color

- Pick a palette: 1 brand, 1 accent, 4-6 neutrals, 4 status (success / warn / error / info).
- Use OKLCH for predictable lightness / chroma.
- 60-30-10: 60% neutral, 30% secondary, 10% accent.

### Layout

- 12-col grid (or 8-col for content-heavy).
- Generous whitespace — 8 / 16 / 24 / 32 / 48 / 64.
- Asymmetric layouts > centered-everything.

### Motion

- Easing: `cubic-bezier(0.22, 1, 0.36, 1)` for entry; `(0.64, 0, 0.78, 0)` for exit.
- Duration: 150-250ms for small UI, 400-600ms for page-level.
- Honor `prefers-reduced-motion`.

### Distinctive touches

- Custom illustrations (not stock).
- Microcopy with voice (slightly playful / dry / warm).
- Numbers, labels, and metadata on screen — not hidden.
- Sparkline charts, not just bars.
- Empty states with character.

### Avoid templated defaults

- Default Bootstrap / Tailwind UI look — recognizable; feels generic.
- Stock hero images.
- Three-column feature grid with icons in circles.
- "AI-generated" gradients on white.

### Critique your own design

- Remove 50% of the visual elements. Does it still work?
- Print it grayscale — does hierarchy survive?
- View at 200% zoom — does it scale?
- View at 50% zoom — does it still feel designed?

## Anti-patterns

❌ **Hero with stock image + "Welcome to X"** — empty.
❌ **Inter for everything** — pick a font, pair it.
❌ **Purple gradient on white background** — overused AI trope.
❌ **Animation that doesn't serve a purpose** — distracting.
❌ **"Minimal" = no visual hierarchy** — design is choice.

## Related skills

- `canvas-design` — programmatic visual art
- `brand-guidelines` — Anthropic brand
- `theme-factory` — themed artifacts
- `tailwind-design-system` — implementation

## References

- [Anthropic Skills: frontend-design](https://github.com/anthropics/skills/tree/main/skills/frontend-design)
- [Refactoring UI](https://www.refactoringui.com/book)
```

### Step 22: `canvas-design`

`packages/runtime/src/skill/bundled/canvas-design/SKILL.md`:

```markdown
---
name: canvas-design
displayName: Canvas Design (Anthropic)
description: Create visual art via code in a canvas — single HTML file with p5.js or similar. Use when generating an artistic visual artifact.
whenToUse:
  - Generate a programmatic visual
  - Create generative art
  - Build a one-off visual artifact (poster, banner)
  - Explore visual ideas via code
version: 1.0.0
author: anthropics/skills (canvas-design) — MIT
license: MIT
tags: [design, generative, canvas, p5, art]
agents: [frontend-design]
tools: [read, write, edit, bash]
load: on-demand
---

# Canvas Design

Adapted from Anthropic's `canvas-design` skill. Programmatic visual art.

## When to invoke

- Generate a poster / banner / hero image
- Explore visual ideas with code
- Build a generative artwork
- Create a one-off visual artifact

## Core patterns

### Single HTML file

\`\`\`html
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <title>Canvas</title>
    <style>html, body, canvas { margin: 0; padding: 0; }</style>
</head>
<body>
    <script src="https://cdn.jsdelivr.net/npm/p5@1.9.0/lib/p5.min.js"></script>
    <script>
        function setup() {
            createCanvas(windowWidth, windowHeight)
            background(20)
        }
        function draw() {
            const x = noise(frameCount * 0.01) * width
            const y = noise(frameCount * 0.01 + 1000) * height
            fill(255, 100)
            noStroke()
            circle(x, y, 4)
        }
    </script>
</body>
</html>
\`\`\`

### Composition

- Use noise (Perlin) for organic forms.
- Layer: background, mid, foreground with depth.
- Color palette in OKLCH for harmonious neighbors.
- Composition: rule of thirds; off-center focal point.

### Variations

- Seed-based determinism (Mulberry32).
- Stills vs animation.
- Different aspect ratios (1:1, 16:9, 9:16).

### Export

- `saveCanvas("art.png")` for high-DPI export.
- Or `saveFrames("frame", 60)` for a sequence.

## Anti-patterns

❌ **Random colors everywhere** — build a palette first.
❌ **Animation that doesn't end** — make it a still + a slow drift.
❌ **Centered-symmetric composition** — boring.
❌ **"Noise" used as a substitute for intent** — compose deliberately.

## Related skills

- `frontend-design` — UI design
- `theme-factory` — themed artifacts
- `brand-guidelines` — Anthropic brand

## References

- [Anthropic Skills: canvas-design](https://github.com/anthropics/skills/tree/main/skills/canvas-design)
- [p5.js reference](https://p5js.org/reference/)
```

### Step 23: `brand-guidelines`

`packages/runtime/src/skill/bundled/brand-guidelines/SKILL.md`:

```markdown
---
name: brand-guidelines
displayName: Brand Guidelines (Anthropic)
description: Apply Anthropic's brand — colors (ink, paper, taupe), typography (Tiempos, Styrene), voice. Use when designing assets that should feel "Anthropic".
whenToUse:
  - Design a slide deck
  - Create a brand asset
  - Style a doc / landing page
  - Apply Anthropic's visual language
version: 1.0.0
author: anthropics/skills (brand-guidelines) — MIT
license: MIT
tags: [brand, anthropic, design, voice, typography]
agents: [frontend-design, build]
tools: [read, write, edit]
load: on-demand
---

# Brand Guidelines (Anthropic)

Adapted from Anthropic's `brand-guidelines` skill.

## When to invoke

- Designing brand assets
- Styling docs to feel "Anthropic"
- Building marketing pages
- Reviewing for brand consistency

## Core patterns

### Color palette

- **Ink** — near-black, `#141413` (warm gray, not pure black).
- **Paper** — off-white, `#FAF9F5`.
- **Taupe** — mid-gray accent, `#B0AEA5`.
- **Accents** — limited: deep navy, terracotta, sage.
- Never use gradients or shadows heavily.

### Typography

- **Headings**: Tiempos Headline (serif).
- **Body**: Styrene (sans-serif).
- **Mono**: Berkeley Mono / JetBrains Mono.
- Generous leading; tight tracking on display.

### Voice

- Direct, technical, calm.
- Short sentences. Active voice.
- No exclamation points.
- Don't oversell.

### Layout

- Off-center compositions.
- Lots of paper (whitespace).
- Imagery: honest, not aspirational stock.
- Subtle texture (paper grain) where appropriate.

### Components

- Rounded rectangles with small radii (4-8px).
- Thin borders (1px) instead of shadows.
- Minimal iconography (line icons).

## Anti-patterns

❌ **Pure black + pure white** — flat, harsh.
❌ **Bold sans-serif everywhere** — pair serif for hierarchy.
❌ **Generic corporate stock photos** — kills the brand.
❌ **Gradient buttons + drop shadows** — anti-Anthropic.
❌ **Hyperbolic copy** ("revolutionary", "game-changing") — restrains voice.

## Related skills

- `frontend-design` — UI design
- `theme-factory` — themed artifacts
- `canvas-design` — programmatic art

## References

- [Anthropic Skills: brand-guidelines](https://github.com/anthropics/skills/tree/main/skills/brand-guidelines)
```

### Step 24: `theme-factory`

`packages/runtime/src/skill/bundled/theme-factory/SKILL.md`:

```markdown
---
name: theme-factory
displayName: Theme Factory (Anthropic)
description: Apply a consistent visual theme to artifacts — slides, docs, landing pages. Use when producing themed output.
whenToUse:
  - Style a slide deck
  - Brand a one-pager
  - Theme a generated artifact
  - Create a reusable theme
version: 1.0.0
author: anthropics/skills (theme-factory) — MIT
license: MIT
tags: [theme, design, brand, slides, artifacts]
agents: [frontend-design, build]
tools: [read, write, edit]
load: on-demand
---

# Theme Factory

Adapted from Anthropic's `theme-factory` skill. Consistent themed artifacts.

## When to invoke

- Producing a deck or doc in a defined theme
- Creating a one-pager
- Reusing a palette across artifacts
- Exploring themes for a project

## Core patterns

### Theme elements

A theme bundles:

- **Palette** — 4-6 colors (background, surface, ink, accent, secondary).
- **Typography** — 1-2 fonts (heading, body).
- **Spacing** — 8 / 16 / 24 / 32 / 48 / 64.
- **Radius** — 0 / 4 / 8 / 12.
- **Texture** — none / grain / noise.

### Built-in themes

- **Anthropic** — paper + ink + taupe; Tiempos + Styrene.
- **Brutalist** — black + white + one accent; monospace.
- **Editorial** — serif everywhere; generous whitespace.
- **Neubrutalist** — heavy borders, drop shadows, vibrant accents.
- **Soft modern** — pastels, soft shadows, rounded.
- **Cyberpunk** — neon on dark, monospace, glitch.
- **Vaporwave** — pink/purple gradients, retro typography.
- **Warm earth** — terracotta, sage, cream.
- **Mono** — single hue, multiple weights.

### Apply to slides

\`\`\`md
Title slide: full-bleed background color, large serif title, no body.
Content slide: 12-col grid, generous margins, body in sans.
Pull-quote slide: 1 large serif quote, attribution.
Section divider: full color block, section title centered.
\`\`\`

### Apply to docs

- Headings in display face.
- Body in text face; max width 70ch.
- Code in mono.
- Captions in italic.
- Use horizontal rules liberally (small but present).

### Apply to HTML

- CSS variables for the palette.
- `body { background: var(--paper); color: var(--ink); }`
- `h1 { font-family: var(--font-display); }`
- `.card { background: var(--surface); border: 1px solid var(--rule); }`

## Anti-patterns

❌ **Mixing two themes in one artifact** — pick one.
❌ **Accent color on everything** — only for emphasis.
❌ **Different fonts on every heading level** — 1-2 max.
❌ **Themes without intent** — choose what the audience expects.

## Related skills

- `frontend-design` — UI
- `brand-guidelines` — Anthropic brand
- `canvas-design` — programmatic visual

## References

- [Anthropic Skills: theme-factory](https://github.com/anthropics/skills/tree/main/skills/theme-factory)
```

### Step 25: `design-md`

`packages/runtime/src/skill/bundled/design-md/SKILL.md`:

```markdown
---
name: design-md
displayName: Design.md (Stitch pattern)
description: Stitch DESIGN.md — a design-first artifact pattern that pairs natural-language design with HTML/Tailwind code. Use when producing or consuming a DESIGN.md file.
whenToUse:
  - Author a DESIGN.md
  - Generate HTML from a design spec
  - Pair design + code in one artifact
  - Adopt the Stitch workflow
version: 1.0.0
author: curated from wshobson/agents + Google Stitch pattern
license: MIT
tags: [design, stitch, design-md, html, tailwind]
agents: [frontend-design, build]
tools: [read, write, edit]
load: on-demand
---

# Design.md (Stitch pattern)

A DESIGN.md is a single artifact that captures the design intent AND the working code. Useful for hand-off to engineers or to generative tools.

## When to invoke

- Designing a UI artifact
- Handing off to engineering
- Generating HTML from a spec
- Bridging design and code

## Core patterns

### Structure

\`\`\`markdown
# Design: <feature>

## Intent
One paragraph: what is this, who is it for.

## Aesthetic direction
- Theme: <Anthropic / Brutalist / Editorial / …>
- Palette: ink #141413, paper #FAF9F5, taupe #B0AEA5
- Typography: Tiempos Headline (display), Styrene (body)
- Motion: subtle — fade + 200ms ease-out

## Layout
\`\`\`
+------------------------------+
| header                       |
+------------------------------+
| hero (centered, serif)       |
+------------------------------+
| features (3-col, line icons) |
+------------------------------+
| footer                       |
+------------------------------+
\`\`\`

## Components
- **Header**: logo left, nav right.
- **Hero**: serif title (h1, 64px), body (18px), CTA button.
- **Feature card**: line icon + title + body.
- **Footer**: muted, small text.

## HTML / Tailwind

\`\`\`html
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <title>…</title>
    <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-[#FAF9F5] text-[#141413] font-sans">
    <header class="border-b border-[#B0AEA5]/30 px-8 py-6">
        <nav class="flex justify-between">
            <span class="font-serif text-xl">Logo</span>
            <ul class="flex gap-6 text-sm">
                <li>Home</li>
                <li>Docs</li>
            </ul>
        </nav>
    </header>
    <main class="max-w-3xl mx-auto px-8 py-24 text-center">
        <h1 class="font-serif text-6xl leading-tight">Welcome</h1>
        <p class="mt-6 text-lg">A small, intentional landing.</p>
        <a class="inline-block mt-8 px-6 py-3 bg-[#141413] text-[#FAF9F5]">Get started</a>
    </main>
</body>
</html>
\`\`\`

## Implementation notes
- Tailwind via CDN (single-file artifact); switch to compiled for prod.
- Custom fonts via @import or system fallbacks.
- Image placeholders: solid blocks with caption.

## Acceptance criteria
- Renders without errors.
- Passes axe a11y.
- Works at 320px and 1440px.
\`\`\`

### Why DESIGN.md

- **Executable spec** — code is included.
- **Single artifact** — no Figma + Slack + doc.
- **Generatable** — LLMs can produce DESIGN.md from a brief.

## Anti-patterns

❌ **DESIGN.md with no code** — just a doc; pair with implementation.
❌ **Code with no intent / aesthetic notes** — bare HTML; add the story.
❌ **Stitch + lorem ipsum** — placeholder text should be plausible.

## Related skills

- `frontend-design` — visual design
- `theme-factory` — themed artifacts
- `popular-web-designs` — references
- `stitch-clone` — the full pattern

## References

- [Google Stitch DESIGN.md pattern](https://stitch.withgoogle.com/)
```

### Step 26: `popular-web-designs`

`packages/runtime/src/skill/bundled/popular-web-designs/SKILL.md`:

```markdown
---
name: popular-web-designs
displayName: Popular Web Designs (as HTML)
description: Implement 54 real-world popular web designs as HTML — Stripe, Linear, Vercel, Notion, Figma, Apple, etc. Use as reference / starting points for new designs.
whenToUse:
  - Need a design starting point
  - Want to study how top sites are built
  - Quickly scaffold a landing page
  - Compare visual approaches
version: 1.0.0
author: curated from wshobson/agents + public landing pages
license: MIT
tags: [design, landing-page, reference, stripe, linear, vercel]
agents: [frontend-design]
tools: [read, write, edit]
load: on-demand
---

# Popular Web Designs

Reference implementations of popular designs as HTML/Tailwind.

## When to invoke

- "Make us look like Stripe"
- Starting point for a landing page
- Studying visual hierarchy
- Quick prototype in a brand voice

## Core patterns

### How to use

1. Browse the index — find a site whose aesthetic fits.
2. Open the corresponding `popular-web-designs/<slug>/SKILL.md`.
3. Copy the HTML structure; tweak content + palette.

### Patterns commonly adopted

| Brand | Aesthetic |
|---|---|
| Stripe | Gradient mesh, technical, rich motion |
| Linear | Black, mono, ultra-clean |
| Vercel | Black/white, bold type, geometric |
| Notion | Soft pastels, hand-drawn, calm |
| Figma | Bright, grid-heavy, expressive |
| Apple | Massive type, big imagery, minimal |
| Arc | Pastel + bold accents, expressive type |
| Linear/Vercel-style | Dark by default, dense information |

### Aesthetic decomposition

For each, capture:

- **Palette** — bg, fg, accent.
- **Type** — display face, body face, weights.
- **Layout** — grid, whitespace, alignment.
- **Motion** — easing, durations.
- **Distinctive features** — gradient mesh, isometric, etc.

### Workflow

\`\`\`bash
# Search the registry
ls packages/runtime/src/skill/bundled/popular-web-designs/ | grep stripe

# Inspect
cat packages/runtime/src/skill/bundled/popular-web-designs/stripe-2024/SKILL.md
\`\`\`

## Anti-patterns

❌ **Copying exactly** — adapt to your brand.
❌ **Picking a design without considering audience** — Stripe isn't for everyone.
❌ **Ignoring performance** — heavy motion + images = slow.
❌ **Mismatched palette** — your product isn't theirs.

## Related skills

- `frontend-design` — UI design
- `design-md` — Stitch pattern
- `theme-factory` — themed artifacts

## References

- See sibling skills in `popular-web-designs/<slug>/SKILL.md`.
```

### Step 27: `stitch-clone`

`packages/runtime/src/skill/bundled/stitch-clone/SKILL.md`:

```markdown
---
name: stitch-clone
displayName: Stitch Clone (workflow)
description: Reproduce Google Stitch's DESIGN.md workflow — brief → design.md → HTML. Use when adopting the Stitch pattern end-to-end.
whenToUse:
  - Build a new site from a brief
  - Adopt Stitch's design-first workflow
  - Generate a DESIGN.md artifact
  - Hand-off design + code together
version: 1.0.0
author: curated from wshobson/agents + Google Stitch
license: MIT
tags: [stitch, design-md, workflow, html, tailwind]
agents: [frontend-design, build]
tools: [read, write, edit, bash]
load: on-demand
---

# Stitch Clone

End-to-end Stitch-style workflow: brief → DESIGN.md → working HTML.

## When to invoke

- Need a landing page from a brief
- Want a single artifact for design + code
- Adopting Stitch's pattern in your team

## Core patterns

### Step 1 — Brief

\`\`\`markdown
Product: <name>
Audience: <who>
Goal: <conversion / waitlist / docs>
Sections: hero, features, social proof, pricing, footer
Aesthetic: <from popular-web-designs or theme-factory>
\`\`\`

### Step 2 — DESIGN.md

Use the `design-md` skill template. Include intent, aesthetic, layout, components, HTML, acceptance criteria.

### Step 3 — Single-file HTML

\`\`\`html
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <title>…</title>
    <script src="https://cdn.tailwindcss.com"></script>
</head>
<body>…</body>
</html>
\`\`\`

### Step 4 — Verify

\`\`\`bash
bunx serve . &
bunx @axe-core/cli http://localhost:3000
# check 320px, 768px, 1440px
\`\`\`

### Step 5 — Hand off

DESIGN.md + index.html + assets → engineering for productionization.

## Anti-patterns

❌ **Skipping the brief** — DESIGN.md has nothing to anchor.
❌ **No acceptance criteria** — "looks good" isn't measurable.
❌ **Single-file with no production path** — plan the migration.

## Related skills

- `design-md` — the format
- `popular-web-designs` — references
- `frontend-design` — visual craft
- `theme-factory` — themes

## References

- [Google Stitch](https://stitch.withgoogle.com/)
```

### Step 28: Verify all 20 skills load

```bash
cd kilocode-assistant
bun -e '
import { loadAllSkills } from "./packages/runtime/src/skill/loader.ts"
const r = loadAllSkills({ cwd: process.cwd() })
const additional = r.skills.filter(s =>
  ["prompt-engineer","rag-architect","llm-ops","embedding-strategies","vector-search",
   "llm-evaluation","llm-prompt-optimizer","fine-tuning-expert",
   "security-reviewer","owasp-top-10","pci-compliance","gdpr-data-handling",
   "secret-scanner","auth-implementation-patterns","secure-code-guardian",
   "accessibility-compliance","wcag-audit-patterns","screen-reader-testing","ui-a11y",
   "frontend-design","canvas-design","brand-guidelines","theme-factory",
   "design-md","popular-web-designs","stitch-clone"
  ].includes(s.frontmatter.name)
)
console.log("additional-bundle:", additional.length, "skills loaded")
console.log("any errors:", r.errors)
'
```

### Step 29: Commit

```bash
git add -A
git commit -m "feat(skills): additional bundles — 20 SKILL.md files (AI/ML + security + a11y + design) (prompt 22)"
```

## Files created

```
packages/runtime/src/skill/bundled/
├── prompt-engineer/SKILL.md
├── rag-architect/SKILL.md
├── llm-ops/SKILL.md
├── embedding-strategies/SKILL.md
├── vector-search/SKILL.md
├── llm-evaluation/SKILL.md
├── llm-prompt-optimizer/SKILL.md
├── fine-tuning-expert/SKILL.md
├── security-reviewer/SKILL.md
├── owasp-top-10/SKILL.md
├── pci-compliance/SKILL.md
├── gdpr-data-handling/SKILL.md
├── secret-scanner/SKILL.md
├── auth-implementation-patterns/SKILL.md
├── secure-code-guardian/SKILL.md
├── accessibility-compliance/SKILL.md
├── wcag-audit-patterns/SKILL.md
├── screen-reader-testing/SKILL.md
├── ui-a11y/SKILL.md
├── frontend-design/SKILL.md
├── canvas-design/SKILL.md
├── brand-guidelines/SKILL.md
├── theme-factory/SKILL.md
├── design-md/SKILL.md
├── popular-web-designs/SKILL.md
└── stitch-clone/SKILL.md
```

(26 new SKILL.md files — more than the 20 promised because the design cluster has 7 closely-related skills; total bundled after prompts 18-22: **91 skills**.)

## Acceptance criteria

- [ ] 26 new `SKILL.md` files exist (well above the 20 promised; design cluster is dense)
- [ ] Total bundled skills = 91 (1 + 24 + 22 + 18 + 26)
- [ ] Every SKILL.md frontmatter validates
- [ ] Every SKILL.md body has substantive content (≥ 50 lines)
- [ ] `loadAllSkills` returns all 26 new skills with source = `bundled`
- [ ] No errors in `result.errors`
- [ ] `matchSkills({ prompt: "design a RAG system with PGVector and add OAuth login" })` returns top-3 hits from this bundle
- [ ] `skill_invoke("frontend-design")` returns full body
- [ ] `git commit` succeeds

## Verification

```bash
cd kilocode-assistant
bun run typecheck

# Count
ls packages/runtime/src/skill/bundled/ | wc -l
# → 91

# Smoke test
bun -e '
import { loadAllSkills } from "./packages/runtime/src/skill/loader.ts"
import { matchSkills } from "./packages/runtime/src/skill/match.ts"
const r = loadAllSkills({ cwd: process.cwd() })
console.log("total:", r.skills.length)
const matches = matchSkills({ prompt: "build a RAG chatbot with OAuth login and an accessible UI", skills: r.skills, topN: 6 })
matches.forEach(m => console.log(\`\${m.score} \${m.skill.frontmatter.name} — \${m.reasons.slice(0, 2).join(", ")}\`))
'

# End-to-end via CLI
bun run kilo run "build an accessible AI support chatbot with PGVector RAG and Google OAuth" --agent build
# Agent should auto-invoke: rag-architect, pgvector (postgres-pro), auth-implementation-patterns, accessibility-compliance, frontend-design
```

## Notes

- **Sources** (frontmatter `author:` per skill):
  - [`anthropics/skills`](https://github.com/anthropics/skills) — MIT — design cluster (`frontend-design`, `canvas-design`, `brand-guidelines`, `theme-factory`) + `doc-coauthoring`, `internal-comms`, `webapp-testing` (adapted, not copy-pasted; body rewritten)
  - [`wshobson/agents`](https://github.com/wshobson/agents) — MIT — heavy AI/ML + security + a11y
  - [`antigravity-awesome-skills`](https://github.com/sickn33/antigravity-awesome-skills) — MIT
  - [`apify/agent-skills`](https://github.com/apify/agent-skills) + [`apify/awesome-skills`](https://github.com/apify/awesome-skills) — referenced but not directly used
  - Google Stitch DESIGN.md pattern — public; documented in `design-md` + `stitch-clone` skills
- **All content original prose** — patterns synthesized, not copy-pasted. License: MIT.
- **Why 26 instead of 20** — the design cluster (Anthropic's design + Stitch + popular-web-designs + theme-factory) is naturally dense. Each skill has a distinct intent (design philosophy, programmatic art, brand, theming, format, references, workflow). Worth shipping all six rather than collapsing them.
- **`frontend-design`, `canvas-design`, `brand-guidelines`, `theme-factory`** — all adapted from Anthropic's open-source skills. Bodies rewritten to focus on patterns + examples + anti-patterns rather than describing the skill itself.
- **`design-md` + `stitch-clone` + `popular-web-designs`** — the Stitch pattern. These three together form a usable "build a landing page from a brief" workflow.
- **`popular-web-designs` references 54 sibling skills** in its `Related skills` section — those are NOT shipped as separate `SKILL.md` files in this bundle (would be ~50 more files). The pattern is documented; the actual reference set can be added incrementally later.
- **Security cluster** — 7 skills covering the full surface: review, OWASP, PCI, GDPR, secrets, auth, secure defaults. Distinct intents; not redundant.
- **Accessibility cluster** — 4 skills: compliance (patterns), audit (process), screen reader testing (manual), UI components (interactive widgets). Each addresses a different user / role.
- **AI/ML cluster** — 8 skills covering the full LLM lifecycle: prompt, RAG, ops, embeddings, vector search, eval, optimization, fine-tuning. Pair with the LLM providers wired in prompt 04.
- **`prompt-engineer` vs `llm-prompt-optimizer`** — first is manual authoring (you write); second is automated (DSPy-style). Different triggers.
- **`embedding-strategies` vs `vector-search`** — first picks / tunes embeddings; second picks / tunes the ANN index. Different layers.
- **`secure-code-guardian` vs `security-reviewer`** — first is default-coding patterns; second is the review process. Pair them.
- **`accessibility-compliance` vs `wcag-audit-patterns`** — first is "build accessible UI"; second is "audit existing UI". Different intents.
- **Anthropic attribution preserved** — all skills adapted from `anthropics/skills` keep `author: anthropics/skills (skill-name) — MIT` in frontmatter, even though body is rewritten. Be a good citizen.
- **No `apify` skills here** — scraping / automation isn't part of the LadeStack MVP. Could be added in v2.
- **This completes the "from internet" prompts (18-22).** Next batch is integration: MCP (23), LSP (24), sessions/telemetry (25).

---

**Total time estimate: 2-3 hours.**

---

## Final tally — all 91 bundled skills

```
Programming  (24): typescript-pro, python-pro, rust-engineer, go-concurrency-patterns,
                  java-architect, kotlin-specialist, swift-expert, csharp-developer, cpp-pro,
                  react-expert, nextjs-app-router-patterns, vue-expert, sveltekit, astro,
                  tailwind-design-system, shadcn-ui,
                  nodejs-backend-patterns, python-fastapi, graphql-architect, hono,
                  postgres-best-practices, postgres-pro, drizzle-orm-expert, sql-optimization-patterns
DevOps       (22): kubernetes-deployment, helm-chart-scaffolding, docker-security-hardening,
                  k8s-manifest-generator, container-security-hardening,
                  terraform-infrastructure, terraform-engineer, aws-skills, cloudflare-workers-expert,
                  github-actions-advanced, gitlab-ci-patterns, deployment-pipeline-design, changelog-automation,
                  sre-engineer, monitoring-expert, prometheus-configuration, grafana-dashboards, distributed-tracing,
                  on-call-handoff-patterns, incident-runbook-templates, postmortem-writing, chaos-engineer
Coder        (18): tdd, test-fixing, e2e-testing, playwright-expert, webapp-testing,
                  code-review-excellence, requesting-code-review, simplify-code, code-reviewer, brooks-lint,
                  debugger, systematic-debugging, diagnosing-bugs, phase-gated-debugging,
                  pagespeed-enhancer, performance-optimizer, complexity-cuts,
                  doc-coauthoring, readme, api-documentation, tutorial-engineer, internal-comms,
                  git-pr-review, git-advanced-workflows, git-cleanup
Additional   (26): AI/ML (8) — prompt-engineer, rag-architect, llm-ops, embedding-strategies,
                        vector-search, llm-evaluation, llm-prompt-optimizer, fine-tuning-expert
                  Security (7) — security-reviewer, owasp-top-10, pci-compliance, gdpr-data-handling,
                                secret-scanner, auth-implementation-patterns, secure-code-guardian
                  A11y (4) — accessibility-compliance, wcag-audit-patterns, screen-reader-testing, ui-a11y
                  Design (7) — frontend-design, canvas-design, brand-guidelines, theme-factory,
                               design-md, popular-web-designs, stitch-clone
Foundation    (1): build-agent
─────────────────────────────────
TOTAL       (91): all sourced from public OSS; all MIT; all original prose
```

**Matchable, invocable, extensible.** End of Phase 4.
