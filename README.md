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
/api/chat (Vercel function)          /api/analytics       /api/migration-status
   │                                      │                    │
   ├─ Auto-migration check ←──────────────┼────────────────────┤
   ├─ 1. Pre-normalize                    │                    │
   ├─ 2. Safety regex                     ├─ Cost tracking     ├─ Database state
   ├─ 3. Safety embedding                 ├─ Performance       ├─ Migration history
   ├─ 4. Business regex                   ├─ Layer analysis    └─ Lock management
   ├─ 5. Semantic intent                  └─ Safety analytics
   └─ 6. Fallback RAG
      │                                   /api/order (Vercel function)
      ├─ Cost & token tracking ────────────┐     │
      ├─ Embed question → vector           ├─→ Database logging
      ├─ Score against knowledge corpus    │     │
      ├─ Filter by scope + score gates     │     └─ Shopify Admin API
      └─ Chat Completions (gpt-4o-mini) ──┘
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
  analytics.js        # Comprehensive analytics API (7 endpoint types)
  health-check.js     # Database schema validation & monitoring
  migrate.js          # Database migration endpoint
  migration-status.js # Database-backed migration status tracking
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
    002_routing_decisions.sql # Routing analysis tables
    003_analytics_enhancements.sql # Cost tracking & performance columns
    004_migration_history.sql # Database-backed migration status tracking
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
- `ROUTER_SAFETY_THRESHOLD`: Safety gate sensitivity (default: 0.42)
- `ROUTER_INTENT_THRESHOLD`: Intent matching threshold (default: 0.3)

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

## Database Migration System

**Automatic Migration Management:**
The system features a fully automated, database-backed migration system with:

- **Automatic execution**: Migrations run automatically via API middleware on first request
- **Concurrency control**: PostgreSQL advisory locks prevent race conditions during high load
- **Smart recovery**: Detects partially applied migrations and auto-recovers
- **Audit trail**: Complete migration history stored in `migration_history` table
- **Instance tracking**: Each serverless instance tracked independently with detailed logs

**Migration Commands:**
```bash
# Check migration status and history
curl https://your-app.vercel.app/api/migration-status

# View detailed system health and schema validation
curl https://your-app.vercel.app/api/health-check

# Force migration run (if auto-migration disabled)
curl https://your-app.vercel.app/api/migrate
```

**Migration Files:**
- `001_initial.sql` - Core tables (query_logs, eval_results, retrieval_details)
- `002_routing_decisions.sql` - Routing analysis tables
- `003_analytics_enhancements.sql` - Cost tracking & performance columns
- `004_migration_history.sql` - Migration status tracking & advisory locks

**Recovery from Failed Migrations:**
The system automatically detects and recovers from failed migrations by:
1. Checking if database objects exist despite failure status in migration_history
2. Auto-marking migrations as completed if required objects are present
3. Retrying failed migrations with smart detection on next API call
4. Maintaining detailed error logs for troubleshooting

**Troubleshooting Common Issues:**
```bash
# Check for migration conflicts or locks
curl https://your-app.vercel.app/api/migration-status | jq '.migrationStatus.active_locks'

# Verify database schema completeness
curl https://your-app.vercel.app/api/health-check | jq '.details.schema'

# View recent migration attempts
curl https://your-app.vercel.app/api/migration-status | jq '.migrationStatus.applied_migrations'
```

---

## Database & logging

**Query/response logging** (PostgreSQL via Neon):
- All user interactions automatically logged for analytics and model improvement
- Comprehensive metadata: routing decisions, performance metrics, OpenAI usage
- Asynchronous logging pattern - doesn't block chat responses
- Environment-specific data separation (development/preview/production)

**Extended Database Schema:**

**Core Tables (Enhanced):**
- **`query_logs`**: User messages, responses, routing metadata, timing, error tracking
  - *New columns*: `embedding_tokens`, `chat_completion_tokens`, `estimated_cost`, `api_calls_count`
- **`eval_results`**: Automated test results with git commit tracking
- **`retrieval_details`**: Document similarity scores and ranking information

**Analytics Tables (New):**
- **`routing_decisions`**: Detailed routing analysis with execution timing and API latency
- **`metrics_hourly`**: Pre-aggregated dashboard metrics (planned)

**Migration Tables (New):**
- **`migration_history`**: Complete audit trail of all migration attempts with timestamps, errors, and instance tracking
- **`migration_locks`**: PostgreSQL advisory locking for serverless concurrency control

**API Endpoints:**
```bash
GET /api/health-check        # Database schema validation & data statistics
GET /api/analytics           # Comprehensive analytics with multiple analysis types
GET /api/migration-status    # Database-backed migration status and history
GET /api/migrate             # Manual migration execution (auto-migration preferred)
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

## Analytics & Monitoring

**Comprehensive Analytics API:**
Access detailed system metrics via `/api/analytics` with multiple analysis types:

**Endpoint Types:**
- `?type=summary` - Overall system metrics, costs, and performance overview
- `?type=layers` - Routing layer performance breakdown and distribution analysis
- `?type=costs` - Detailed cost analysis with OpenAI pricing calculations
- `?type=performance` - Response times, throughput metrics, and timing breakdown
- `?type=safety` - Safety refusal patterns, categories, and frequency analysis
- `?type=trace&queryId=<id>` - Individual query trace analysis with routing decisions
- `?type=evaluation` - Test suite performance and accuracy metrics

**Cost Tracking:**
Automatic cost calculation based on current OpenAI pricing (as of 2024):
- **text-embedding-3-small**: $0.02 per 1M tokens
- **GPT-4o-mini**: $0.15 (input) / $0.60 (output) per 1M tokens
- Tracks token usage per query with real-time cost estimates
- Aggregated cost reporting by routing layer and time period

**Usage Examples:**
```bash
# Get 24-hour system summary
curl https://your-app.vercel.app/api/analytics?type=summary&hours=24

# Analyze routing layer distribution over 7 days
curl https://your-app.vercel.app/api/analytics?type=layers&hours=168

# Track costs and token usage
curl https://your-app.vercel.app/api/analytics?type=costs&hours=24

# Performance metrics and timing analysis
curl https://your-app.vercel.app/api/analytics?type=performance

# Safety refusal patterns
curl https://your-app.vercel.app/api/analytics?type=safety

# Trace individual query routing decisions
curl https://your-app.vercel.app/api/analytics?type=trace&queryId=<query-id>
```

**Response Metadata:**
Every query response includes comprehensive routing information:
```json
{
  "answer": "...",
  "sources": [...],
  "routing": {
    "layer": "semantic-intent",
    "rule": "product-questions",
    "intent": "dosage-timing",
    "category": "product-info",
    "score": 0.76
  },
  "performance": {
    "responseTimeMs": 1247,
    "embeddingTokens": 12,
    "chatCompletionTokens": 156,
    "estimatedCost": 0.0034,
    "apiCalls": 2
  }
}
```

**Historical Metrics Tracking:**
- Distribution of routing layers over time
- Top failing test cases in CI runs
- Low-scoring retrievals that might need knowledge updates
- Frequency of human escalations and refusal patterns
- Cost trends and optimization opportunities