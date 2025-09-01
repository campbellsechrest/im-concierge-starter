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

(An optional keyword-based **intent router** can sit before RAG to deterministically route RED/BLACK cases to refusal; see “Roadmap”.)

---

## Repo layout

```
api/
  chat.js          # RAG answer endpoint (Chat Completions; DSHEA; citations)
  order.js         # (Optional) Shopify order-status endpoint (read_orders)
data/
  knowledge/
    a-minus-facts.md
    safety-disclaimers.md
    shipping-returns.md
  embeddings.json  # Vector index (committed for sandbox, see below)
scripts/
  ingest.js        # Build embeddings.json from /data/knowledge/*.md
im-assistant.js    # Embeddable widget (vanilla JS)
test.html          # Sandbox page (no Shopify theme needed)
vercel.json        # Bundle data/** into serverless functions
package.json
README.md
```

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

* **Intent router** (pre-RAG): lightweight rules (or tiny classifier) to route:

  * GREEN → RAG answer
  * YELLOW → cautious answer + invite human
  * RED → refusal + handoff
  * BLACK → emergency stop
* **Programmatic FAQ hubs** the bot can cite (SEO × CX).
* **Internationalization** once labels/claims are approved.
* **Build-time eval**: CI step that runs a small scenario set and fails on unsafe answers.

---
