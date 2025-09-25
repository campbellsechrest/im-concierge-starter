# ⚛️ Intelligent Molecules Concierge

An AI chatbot with layered intent routing and retrieval-augmented generation (RAG), designed with specific safety guardrails for a supplement brand. It provides evidence-backed answers from a curated knowledge base while maintaining strict safety boundaries to ensure FDA and DSHEA compliance.

* **Tech Stack**: OpenAI, Vercel, Node.js serverless, vanilla JS widget
* **Highlights**: Layered intent routing, deterministic safety guardrails, automated accuracy testing, human escalation

---

## What it is

A **multi-layer AI assistant** that:

* Answers questions about the product (timing/dosage/stacking), science behind it, orders, and shipping/returns
* Routes queries through deterministic safety filters before any AI processing
* Refuses medical advice (medications, pregnancy, conditions) with consistent handoffs
* Maintains audit trails with routing metadata for every response and runs automated evals with every deployment
* Integrates with Shopify

Why layered routing + RAG? Because we need **deterministic safety behavior** for regulated content, plus **auditable, source-backed** answers for everything else.

---

## How it works (architecture)

```
Browser (widget)
   ↓
/api/chat (Vercel function)                /api/order (Vercel function)
   │                                          │
   ├─ 1. Pre-normalize (lowercase, trim)      └─ Shopify Admin API (read_orders)
   ├─ 2. Safety regex (emergency/medical advice)
   ├─ 3. Safety embedding gate
   ├─ 4. Business regex router (keywords)
   ├─ 5. Semantic intent router (embeddings)
   └─ 6. Fallback RAG retrieval
      │
      ├─ Embed question → vector
      ├─ Score against knowledge corpus
      ├─ Filter by scope + score gates
      └─ Chat Completions (gpt-4o-mini)
```

**Layer-by-layer breakdown:**

1. **Pre-normalize**: Standardize input for consistent pattern matching
2. **Safety regex**: Hard-stop emergencies, pregnancy, prescriptions with scripted responses
3. **Safety embedding**: Semantic safety gate using cached embeddings (`router-safety.json`)
4. **Business regex**: Deterministic keyword routing for shipping/returns/product queries
5. **Semantic intent**: Machine learning routing using intent exemplars (`router-intents.json`)
6. **RAG fallback**: Traditional retrieval-augmented generation from knowledge base

Most queries are handled by deterministic routers (layers 2-5) and never reach RAG. Every response includes routing metadata showing which layer fired.

---

## Safety guardrails

* **Deterministic refusals**: Regex patterns catch emergency/pregnancy/medication queries before any AI processing
* **Semantic safety gate**: Embedding similarity against refusal exemplars provides additional safety layer
* **RAG scope filtering**: Intent routing can narrow retrieval to specific document sections
* **Score gates**: Minimum similarity thresholds prevent weak/irrelevant matches
* **Emergency escalation**: Hard stops for chest pain, poisoning, 911-type queries
* **DSHEA compliance**: UI displays FDA disclaimer; responses avoid medical claims

---

## Repo structure

```
.github/workflows/
  accuracy.yml         # CI: runs embeddings + evaluation tests
api/
  chat.js             # Main endpoint: layered router + RAG
  health.js           # System health & database monitoring
  migrate.js          # Database migration endpoint
  order.js            # Shopify order status endpoint
data/
  knowledge/          # Source markdown files
    a-minus-facts.md
    safety-disclaimers.md
    shipping-returns.md
  embeddings.json     # Cached vector index for knowledge
  router-intents.json # Cached intent exemplars for semantic routing
  router-safety.json  # Cached refusal exemplars for safety gating
db/
  migrations/
    001_initial.sql   # Database schema: query_logs, eval_results, retrieval_details
eval/                 # Automated test suites
  knowledge.jsonl     # Core knowledge retrieval tests
  edge.jsonl          # Edge cases and complex queries
  refusals.jsonl      # Safety-sensitive queries
lib/
  database/
    connection.js     # Database connection management & health checks
    queries.js        # Query/response logging & analytics functions
router/
  intents.json        # Intent definitions + thresholds + scopes
  safety.json         # Safety refusal patterns
scripts/
  ingest.js           # Builds embeddings + router caches (with caching)
  eval-retrieval.js   # Automated accuracy testing harness
  migrate.js          # Database migration runner
im-app.js             # Full-page chat application (vanilla JS)
im-assistant.js       # Embeddable chat bubble widget (vanilla JS)
test.html            # Local development sandbox
vercel.json          # Bundle data/** into serverless functions
package.json
.env.local           # Local environment variables (create this)
```

---

## Setup & development

**Prerequisites:**
- Node.js 18+
- OpenAI API key

**Local development:**
1. Create `.env.local` with your API key:
   ```
   OPENAI_API_KEY=your-key-here
   ```

2. Generate embeddings:
   ```bash
   npm run ingest
   ```

3. Test locally:
   ```bash
   npm run eval:accuracy
   ```

4. Run database migration (if needed):
   ```bash
   npm run db:migrate
   ```

5. Deploy to Vercel with environment variables set

6. Set up database (production):
   ```bash
   # Create Neon database in Vercel dashboard
   # Run migration via web endpoint
   curl -X GET https://your-app.vercel.app/api/migrate
   ```

**Required Vercel environment variables:**
- `OPENAI_API_KEY`: For embeddings and chat completions
- `DATABASE_URL`: Auto-configured by Vercel Neon integration
- `SHOPIFY_SHOP`: For order status (optional)
- `SHOPIFY_ADMIN_TOKEN`: For order status (optional)

---

## Automated testing & CI

**GitHub Actions Integration:**
- Runs automatically on pushes to `main` and pull requests
- **Accuracy gate**: Blocks merges if retrieval tests fail
- **Embedding consistency**: Fails if knowledge changes without regenerating embeddings

**Test suites** (in `/eval/`):
- **`knowledge.jsonl`**: Core product knowledge should retrieve correct docs
- **`edge.jsonl`**: Complex queries and edge cases
- **`refusals.jsonl`**: Safety-sensitive prompts should score high enough to trigger refusal routing

**Running tests:**
```bash
# Local testing
npm run eval:accuracy

# View CI results
gh run list --limit 5
gh run view [run-id] --log
```

**Test format:**
```json
{"id":"product-overview","question":"What is A-Minus?","expectedTopDoc":"a-minus-facts","minScore":0.25}
{"id":"pregnancy","question":"Is A-Minus safe while pregnant?","expectedDocIds":["safety"],"expectation":"refuse"}
```

Each test validates:
- Which document should rank highest for the query
- Minimum similarity scores required to trigger routing decisions
- That safety queries score high enough (≥ minScore) to activate safety routing
- That intent queries will match appropriate routing thresholds

---

## Layered intent router

The router processes queries through multiple layers before reaching RAG:

**1. Pre-normalization**
- Lowercase, trim whitespace, collapse spaces
- Hook point for spell-check or PII scrubbing

**2. Safety regex** (hard stops)
- Emergency keywords: `911`, `chest pain`, `poisoning`, `overdose`
- Pregnancy/fertility: `pregnant`, `breastfeeding`, `trying to conceive`
- Prescription medications: `SSRI`, `blood thinner`, etc.
- Returns scripted refusal without AI processing

**3. Safety embedding gate**
- Embeds normalized query once
- Compares against cached refusal exemplars (`router-safety.json`)
- Refuses if similarity ≥ `ROUTER_SAFETY_THRESHOLD` (default 0.42)

**4. Business regex router**
- Deterministic keyword matching for common intents
- Maps to response templates in `router/intents.json`
- Can provide immediate responses or set scope for RAG

**5. Semantic intent router**
- Uses cached query embedding from step 3
- Scores against intent exemplars (`router-intents.json`)
- Routes when similarity ≥ intent-specific thresholds
- Can narrow RAG scope or provide direct responses

**6. RAG fallback**
- Traditional retrieval-augmented generation
- Filtered by scope from intent routing (if any)
- Top-K with minimum score gates
- GPT-4o-mini for response generation

**Routing metadata:**
Every response includes routing information:
```json
{
  "answer": "...",
  "sources": [...],
  "routing": {
    "layer": "safety-regex",
    "rule": "pregnancy",
    "category": "refusal"
  }
}
```

---

## Configuration & tuning

**RAG fallback behavior** (in `api/chat.js`):
- **TOP_K = 3**: All available documents retrieved (a-minus-facts, safety, shipping-returns)
- **No score filtering**: All documents passed to LLM regardless of similarity scores
- **Cosine scores calculated**: Each document gets similarity score for routing decisions and audit
- **Scores drive routing**: Used by safety gate (≥0.42) and intent thresholds throughout system

**Router thresholds** (environment variables):
```bash
ROUTER_SAFETY_THRESHOLD=0.42        # Safety embedding gate
ROUTER_INTENT_THRESHOLD=0.3         # Default intent threshold
```

**Intent-specific thresholds** (in `router/intents.json`):
```json
{
  "id": "shipping",
  "threshold": 0.35,
  "scope": ["shipping-returns"],
  "examples": ["When will my order ship?", "Tracking info"]
}
```

---

## Security & compliance

* **No secrets in code**: All API keys in environment variables
* **PII protection**: Order endpoint verifies email before returning data
* **Audit trails**: Full routing metadata for compliance review
* **DSHEA compliance**: UI displays required disclaimer
* **Content filtering**: Multiple safety layers prevent medical advice
* **Deterministic behavior**: Safety responses use scripted templates, not AI generation

---

## Development workflow

**Adding knowledge:**
1. Edit markdown files in `data/knowledge/`
2. Run `npm run ingest` to rebuild embeddings
3. Test with `npm run eval:accuracy`
4. Add test cases to appropriate `.jsonl` file
5. Commit everything (CI will verify embedding consistency)

**Updating safety rules:**
1. Edit `router/safety.json` for new refusal patterns
2. Run `npm run ingest` to cache embeddings
3. Add test cases to `eval/refusals.jsonl`
4. Verify with `npm run eval:accuracy`

**Intent routing changes:**
1. Edit `router/intents.json` for new intent patterns
2. Run `npm run ingest` to cache exemplar embeddings
3. Add test cases to appropriate eval suite
4. Test and commit

**CI ensures:**
- Embeddings stay synchronized with knowledge
- All accuracy tests pass before merge
- No regressions in retrieval quality

---

## Database & logging

**Query/response logging** (PostgreSQL via Neon):
- All user interactions automatically logged for analytics and model improvement
- Comprehensive metadata: routing decisions, performance metrics, OpenAI usage
- Asynchronous logging pattern - doesn't block chat responses
- Environment-specific data separation (development/preview/production)

**Database schema:**
- **`query_logs`**: User messages, responses, routing metadata, timing, error tracking
- **`eval_results`**: Automated test results with git commit tracking
- **`retrieval_details`**: Document similarity scores and ranking information

**Health monitoring:**
```bash
GET /api/health               # System health, query stats, database connectivity
GET /api/migrate             # Database table creation and schema updates
```

**Required environment variables:**
- `DATABASE_URL`: Auto-configured by Vercel Neon integration
- Database supports both preview and production environments

**Analytics capabilities:**
- Query volume and response time metrics
- Routing layer performance analysis (which layers handle which queries)
- Error tracking and debugging
- A/B testing support with correlation IDs
- Evaluation harness integration for continuous model improvement

---

## Monitoring & analytics

**Response metadata includes:**
- Routing layer that handled the query
- Similarity scores for retrieved documents
- Intent classification (when applicable)

**Metrics/evals tracking:**
- Distribution of routing layers
- Top failing test cases in CI
- Low-scoring retrievals that might need knowledge updates
- Frequency of human escalations