# Intelligent Molecules — Shopify Concierge (RAG) Starter

This is a ready-to-deploy Retrieval‑Augmented (RAG) concierge for your Shopify store. It answers product FAQs, timing/stacking/safety questions with DSHEA guardrails, and checks order status via Shopify Admin.

## 1) Vercel env vars (Project → Settings → Environment Variables)
```
OPENAI_API_KEY=sk-...
SHOPIFY_SHOP=yourshop.myshopify.com
SHOPIFY_ADMIN_TOKEN=shpat_...
SHOPIFY_API_VERSION=2024-07
ORIGIN_ALLOWED=https://YOUR_STORE_DOMAIN
```

## 2) Knowledge → embeddings
1. Edit the files in `data/knowledge/` as needed.
2. Install deps and build embeddings:
```
npm i
npm run ingest
```
This creates `data/embeddings.json` (ignored by git). Re-run whenever the knowledge changes.

## 3) Deploy
Push or upload the ZIP to Vercel. After deploy, note your URL, e.g. `https://your-vercel-app.vercel.app`.

## 4) Add widget to Shopify theme
In **Online Store → Themes → Edit code**, open `layout/theme.liquid` and paste **before `</body>`**:
```liquid
<script
  defer
  src="https://YOUR-VERCEL-APP.vercel.app/im-assistant.js"
  data-api-base="https://YOUR-VERCEL-APP.vercel.app"
  data-brand-email="info@intelligentmolecules.com">
</script>
```

## Endpoints
- `POST /api/chat` → `{ message }` → returns `{ answer, sources[] }`
- `POST /api/order` → `{ orderNumber, email }` → returns order summary

## Safety
- No medical advice; DSHEA disclaimer appended in responses.
- Auto-escalates meds/pregnancy/conditions to human support.
