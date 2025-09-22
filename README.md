# ⚛️ Intelligent Molecules Concierge

A small, Retrieval-Augmented Generation chatbot designed with specific safety guardrails for Intelligent Molecules. It answers from a single source-of-truth and refuses anything outside its scope, while still maintaining the conversationalism and helpfulness of ChatGPT.

* **Tech Stack**:  OpenAI, Vercel, Node.js serverless, vanilla JS widget
* **Highlights**: evidence-first answers, deterministic guardrails, human escalation

---

## What this is

A **RAG** concierge for the Intelligent Molecules

* Answers timing/dosage/stacking, safety positioning, shipping/returns
* Refuses medical advice (medications, pregnancy, conditions) with a warm, consistent handoff
* Embeddable Shopify widget that connects to API for order info

Why RAG (not a “plain” chatbot)? Because we want **auditable, source-backed** answers—or a friendly refusal—every time.

---

## How it works (architecture)

```
Browser (widget)
   ↓
/api/chat  (Vercel function)         /api/order  (Vercel function)
   │                                    │
   ├─ Embed question → vector           └─ Shopify Admin API (read_orders)
   ├─ Compare to embedded SSoT chunks
   ├─ Select Top-K above a score gate
   └─ Chat Completions (short answer + DSHEA + citations)
```

* **Knowledge** lives in `data/knowledge/*.md` → embedded into `data/embeddings.json`.
* `/api/chat` retrieves top matches by **cosine similarity**, applies a **minimum score gate**, and composes a short answer via **`/v1/chat/completions`** (`gpt-4o-mini`).
* `/api/order` (optional) fetches by `name` (order number), **verifies `email`**, returns status/tracking.

---

## Safety guardrails

* **No medical advice**; refuse meds/pregnancy/specific conditions; emergency queries get a **hard stop**.
* **RAG gate:** if no doc chunk clears the similarity threshold, **don’t answer**—escalate.
* **DSHEA footer** appended to every answer.
* **Citations** only for chunks that clear a citation floor.

(A layered intent router now sits before RAG to deterministically handle safety refusal triggers and route high-confidence intents; see “Layered intent router”.)

---

## Repo layout

````
api/
  chat.js          # Layered router + RAG answer endpoint
  order.js         # (Optional) Shopify order-status endpoint (read_orders)
data/
  knowledge/
    a-minus-facts.md
    safety-disclaimers.md
    shipping-returns.md
  embeddings.json      # Vector index for knowledge docs
  router-intents.json  # Cached intent exemplars for semantic routing
  router-safety.json   # Cached refusal exemplars for safety gating
im-assistant.js    # Embeddable widget (vanilla JS)
router/
  intents.json     # Intent definitions + thresholds
  safety.json      # Refusal exemplars for safety gating
scripts/
  ingest.js        # Builds embeddings + router caches
test.html          # Sandbox page (no Shopify theme needed)
vercel.json        # Bundle data/** into serverless functions
package.json
README.md
```

---

## Layered intent router

The chat endpoint runs a layered router before RAG to keep refusals deterministic and steer confident intents:

1. **Pre-normalize** — lowercase, trim, collapse whitespace (hook ready for spell-fix or PII scrubbing).
2. **Safety regex** — hard-stop emergencies, pregnancy, prescriptions, or under-age wording with scripted refusals.
3. **Safety embed gate** — compare the normalized query against `router-safety.json`; refuse if cosine ≥ `ROUTER_SAFETY_THRESHOLD` (default 0.42).
4. **Business regex router** — deterministic keywords for shipping/returns/order/product intents, pulling scope/response metadata from `router/intents.json`.
5. **Semantic intent router** — embed once, score against per-intent exemplars from `router-intents.json`; route when scores clear intent thresholds.
6. **Fallback RAG** — if no layer wins, run retrieval normally (optionally narrowed to docs in the routed scope).

Every response now includes a `routing` object describing which layer fired, so you can audit behavior in the UI or logs.

---

## Retrieval tuning (scores, Top-K, gates)

Inside `api/chat.js` you’ll find (or can add) the knobs:

```js
const TOP_K = 4;               // how many chunks to include
const MIN_SCORE = 0.25;        // retrieval gate: must be >= to use in context
const CITATION_MIN_SCORE = 0.25; // must be >= to appear in "Based on:"
```

**What they do:**

* **Cosine score** (≈ 0.05–0.60 typical; higher = closer) measures question↔chunk similarity.
* **Top-K** balances coverage vs. noise (default 4).
* **Gate** enforces “no strong evidence → no answer”.
* **Citation floor** keeps weak matches out of the “Based on:” footnote.

> With a small corpus, a low-scoring chunk can still rank Top-K by **order**, but the **gate** prevents it from being **used or cited**.

---

## Security & compliance notes

* Never commit secrets. Keys live in **Vercel envs**.
* Don’t log PII. `/api/order` verifies email and returns only status/tracking.
* DSHEA disclaimer is appended to every answer.
* The bot **refuses** medical advice (medications, pregnancy/breastfeeding, conditions) and emergency queries.

---

## Roadmap / nice-to-haves

* **Programmatic FAQ hubs** the bot can cite (SEO × CX).
* **Internationalization** once labels/claims are approved.

---
---

## Automated accuracy checks

Set `OPENAI_API_KEY` and run `npm run eval:accuracy`. The runner walks every JSONL suite in `eval/` and fails when expectations break.

- `eval/knowledge.jsonl` – questions that should be satisfied directly from the KB.
- `eval/refusals.jsonl` – pregnancy/medication/emergency prompts that should trigger a refusal path.
- `eval/edge.jsonl` – ambiguous, multi-hop, or long prompts for stress testing retrieval.

Each line asserts expected doc ids, top doc, and score floors/ceilings so you can wire the check into CI. If you enable the included GitHub Action (`.github/workflows/accuracy.yml`), add an `OPENAI_API_KEY` repository secret so the ingest + eval steps can call OpenAI.
Run `npm run ingest` whenever you edit knowledge or router configs so the cached embeddings stay in sync before running the eval.
