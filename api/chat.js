import fs from 'fs';
import path from 'path';
import { logQuery, logRetrievalDetails, logRoutingDecisions } from '../lib/database/queries.js';

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const ORIGIN_ALLOWED = process.env.ORIGIN_ALLOWED || '*';
const HUMAN_SUPPORT_EMAIL = 'info@intelligentmolecules.com';

const SAFETY_THRESHOLD = Number(process.env.ROUTER_SAFETY_THRESHOLD || 0.42);
const INTENT_FALLBACK_THRESHOLD = Number(process.env.ROUTER_INTENT_THRESHOLD || 0.3);

const EMBEDDINGS_PATH = path.join(process.cwd(), 'data', 'embeddings.json');
const SAFETY_ROUTER_PATH = path.join(process.cwd(), 'data', 'router-safety.json');
const INTENT_ROUTER_PATH = path.join(process.cwd(), 'data', 'router-intents.json');

const SAFETY_REGEX_RULES = [
  {
    name: 'emergency',
    patterns: [
      /\b911\b/i,
      /\bemergency\b/i,
      /\bchest pain\b/i,
      /\bshortness of breath\b/i,
      /\btrouble breathing\b/i,
      /\bfaint(ing)?\b/i,
      /\bpass(ing)? out\b/i,
      /\bunconscious\b/i,
      /\bseizure\b/i,
      /\bpoison(ing)?\b/i,
      /\boverdose\b/i,
      /\balcohol poisoning\b/i,
      // Co-occurrence: risk symptoms + action/concern words
      /(?=.*\b(dizzy|nauseous|vomiting|chest|faint|pain)\b)(?=.*\b(took|feel|after|help|what)\b)/i
    ],
    message: () =>
      `I'm really sorry you're feeling unwell. I'm not a medical professional, but symptoms like this need immediate care. Please contact emergency services (call 911 or your local equivalent) or poison control right away. Once you're safe, email ${HUMAN_SUPPORT_EMAIL} and the team can follow up.`,
    category: 'emergency'
  },
  {
    name: 'pregnancy',
    patterns: [
      // Pregnancy-related terms with action words (co-occurrence)
      /(?=.*\b(pregnant|pregnancy|breastfeeding|nursing|ttc|trying to conceive|fertility|ivf|postpartum|pumping|newborn)\b)(?=.*\b(take|use|safe|can|should|okay)\b)/i,
      // Direct pregnancy statements
      /\bi am pregnant\b/i,
      /\bi'm pregnant\b/i,
      /\bwhile pregnant\b/i,
      /\bif pregnant\b/i,
      /\bduring pregnancy\b/i,
      /\bwhile breastfeeding\b/i,
      /\bwhile nursing\b/i
    ],
    message: () =>
      `I'm not able to advise on using A-Minus while pregnant, trying to conceive, or breastfeeding. It hasn't been studied for those situations, so please discuss it with your healthcare professional and email ${HUMAN_SUPPORT_EMAIL} if you'd like a teammate to follow up.`,
    category: 'pregnancy'
  },
  {
    name: 'medication',
    patterns: [
      // Medication interaction with A-Minus (co-occurrence + negative lookahead for general supplement questions)
      /(?=.*\b(prescription|medication|medicine|drug|ssri|snri|maoi|antidepressant|blood thinner|eliquis|xarelto|warfarin|adderall|vyvanse|benzodiazepine|anxiety med)\b)(?=.*\b(a-?minus|with|combine|take|together|interaction|safe)\b)(?!.*\b(general|other|any|all)\s+(supplements|vitamins)\b)/i,
      // Specific medication names with interaction terms
      /\b(?:combine|take|mix|together with|along with|interaction|safe with).*\b(ssri|prozac|zoloft|lexapro|adderall|vyvanse|warfarin|blood thinner)\b/i,
      /\b(ssri|prozac|zoloft|lexapro|adderall|vyvanse|warfarin|blood thinner).*\b(?:combine|take|mix|together with|along with|interaction|safe with)\b/i
    ],
    message: () =>
      `I can't provide guidance on combining A-Minus with prescription or OTC medicines. Please check with your doctor or pharmacist, and feel free to email ${HUMAN_SUPPORT_EMAIL} so a human can help.`,
    category: 'medication'
  },
  {
    name: 'underage',
    patterns: [
      /\bi am (?:1[0-7]|under (?:18|21))\b/i,
      /\bi'm (?:1[0-7]|under (?:18|21))\b/i,
      /\bunderage\b.*\b(?:drink|alcohol|supplement)\b/i,
      /\b(?:16|17)\s*years?\s*old\b/i
    ],
    message: () =>
      `A-Minus is only for adults of legal drinking age. I'm not able to help here, but you can reach the team at ${HUMAN_SUPPORT_EMAIL} if you have other questions.`,
    category: 'underage'
  }
];

const BUSINESS_REGEX_RULES = [
  {
    name: 'shipping-keywords',
    intent: 'shipping',
    patterns: [
      /\bship(ping)?\b/i,
      /\bdeliver(y|ies)?\b/i,
      /\bwhere do you ship\b/i,
      /\bfree\s*shipping\b/i, // Handle "freeshipping" and "free shipping"
      /\bshipping\s+cost\b/i,
      /\bhow\s+fast.*ship\b/i,
      /\binternational\s+shipping\b/i
    ]
  },
  {
    name: 'returns-keywords',
    intent: 'returns',
    patterns: [
      /\breturn(s)?\b/i,
      /\brefund\b/i,
      /\bmoney\s+back\b/i,
      /\bsatisfaction\s+guarantee\b/i,
      /\bcan\s+i\s+return\b/i,
      /\bhow.*return\b/i
    ]
  },
  {
    name: 'order-keywords',
    intent: 'order',
    patterns: [
      /\border\s+status\b/i,
      /\btracking\b/i,
      /\bwhere\s+is\s+my\s+order\b/i,
      /\border\s+number\b/i,
      /\bwhen\s+will\s+my\s+order\b/i,
      /\btrack\s+my\s+(order|package)\b/i
    ]
  },
  {
    name: 'product-overview',
    intent: 'product-overview',
    patterns: [
      /\bwhat\s+is\s+a-?minus\b/i,
      /\btell\s+me\s+about\s+a-?minus\b/i,
      /\bexplain\s+a-?minus\b/i,
      /\ba-?minus\s+(overview|summary|info|information)\b/i,
      /\bwhat\s+does\s+a-?minus\s+do\b/i,
      /\bdescribe\s+a-?minus\b/i
    ]
  },
  {
    name: 'product-mechanism',
    intent: 'product-mechanism',
    patterns: [
      /\bhow\s+does\s+(a-?minus|it)\s+work\b/i,
      /\bhow.*a-?minus.*work\b/i,
      /\bmechanism\s+of\s+action\b/i,
      /\bactivated\s+carbon.*work\b/i,
      /\bscience\s+behind\s+a-?minus\b/i,
      /\btechnology.*a-?minus\b/i,
      /\bwhy\s+does\s+a-?minus\s+work\b/i
    ]
  },
  {
    name: 'product-ingredients',
    intent: 'product-ingredients',
    patterns: [
      /\bingredients?\b/i,
      /\bwhat.*in\s+a-?minus\b/i,
      /\bmade\s+of\b/i,
      /\bcomposition\b/i,
      /\bcontains?\b/i,
      /\bwhat's\s+in\s+a-?minus\b/i
    ]
  },
  {
    name: 'product-usage',
    intent: 'product-usage',
    patterns: [
      /\bhow.*take\s+a-?minus\b/i,
      /\bwhen.*take\s+a-?minus\b/i,
      /\bdosage\b/i,
      /\bserving\s+size\b/i,
      /\bdose\b/i,
      /\bhow\s+many.*capsules?\b/i,
      /\binstructions\s+for\s+(use|taking)\b/i,
      /\bhow\s+to\s+use\s+a-?minus\b/i
    ]
  }
];

const SYSTEM = `You are the Intelligent Molecules on-site concierge. Use only the provided context; if unsure, say so and offer to connect the customer with human support at info@intelligentmolecules.com.
Guardrails:
- No medical advice. Avoid disease/treatment claims.
- For pregnancy/breastfeeding or prescription meds (e.g., SSRIs/SNRIs/MAOIs, stimulants, anticoagulants, seizure, diabetes, thyroid, oral contraceptives), do not advise; suggest speaking with a clinician and offer human support.
- Do not include FDA/DSHEA disclaimers; the UI handles this.
Voice: calm, science-forward, friendly. Keep answers short, with bullets when helpful.`;

let knowledgeCorpus;
let safetyRouter;
let intentRouter;

// Product entities that should be protected during normalization
const PRODUCT_ENTITIES = [
  { original: 'A-Minus', normalized: 'a-minus', variants: ['A‑Minus', 'A-minus', 'a‑minus', 'AMinus', 'aminus'] },
  { original: 'Intelligent Molecules', normalized: 'intelligent molecules', variants: ['intelligent-molecules', 'intelligentmolecules'] }
];

// Generate entity protection tokens (unlikely to appear in normal text)
const ENTITY_TOKENS = new Map();
PRODUCT_ENTITIES.forEach((entity, index) => {
  const token = `__ENTITY_${index}__`;
  ENTITY_TOKENS.set(token, entity);
});

function protectEntities(message) {
  let protectedMessage = message;
  let entityMap = new Map();

  PRODUCT_ENTITIES.forEach((entity, index) => {
    const token = `__ENTITY_${index}__`;
    const allVariants = [entity.original, ...entity.variants];

    // Create regex that matches any variant (case insensitive)
    const pattern = new RegExp(`\\b(${allVariants.map(v => v.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')).join('|')})\\b`, 'gi');

    if (pattern.test(protectedMessage)) {
      protectedMessage = protectedMessage.replace(pattern, (match) => {
        entityMap.set(token, entity.normalized);
        return token;
      });
    }
  });

  return { message: protectedMessage, entityMap };
}

function restoreEntities(message, entityMap) {
  let restoredMessage = message;

  entityMap.forEach((normalizedForm, token) => {
    // Replace both original case and lowercase version of token
    restoredMessage = restoredMessage.replace(new RegExp(token, 'gi'), normalizedForm);
  });

  return restoredMessage;
}

function normalizeMessage(message = '') {
  return message
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[\u2010-\u2015\u2212\uFE63\uFF0D]/g, '-') // Normalize various hyphen/dash characters to regular hyphen
    .trim();
}

function entityAwareNormalize(message = '') {
  // Stage 1: Protect entities
  const { message: protectedMessage, entityMap } = protectEntities(message);

  // Stage 2: Apply standard normalization
  const normalizedMessage = normalizeMessage(protectedMessage);

  // Stage 3: Restore protected entities
  return restoreEntities(normalizedMessage, entityMap);
}

function loadJsonCache(cacheRef, filePath) {
  if (cacheRef && cacheRef.current) {
    return cacheRef.current;
  }
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const json = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (cacheRef) {
    cacheRef.current = json;
  }
  return json;
}

function getKnowledgeCorpus() {
  if (!knowledgeCorpus) {
    knowledgeCorpus = loadJsonCache({ current: null }, EMBEDDINGS_PATH);
  }
  return knowledgeCorpus;
}

function getSafetyRouter() {
  if (!safetyRouter) {
    safetyRouter = loadJsonCache({ current: null }, SAFETY_ROUTER_PATH);
  }
  return safetyRouter;
}

function getIntentRouter() {
  if (!intentRouter) {
    intentRouter = loadJsonCache({ current: null }, INTENT_ROUTER_PATH);
    if (intentRouter && Array.isArray(intentRouter.intents)) {
      intentRouter.map = new Map(intentRouter.intents.map((intent) => [intent.id, intent]));
    }
  }
  return intentRouter;
}

function runSafetyRegex(message) {
  if (!message) return null;
  for (const rule of SAFETY_REGEX_RULES) {
    if (rule.patterns.some((regex) => regex.test(message))) {
      return {
        answer: rule.message(message),
        routing: {
          layer: 'safety-regex',
          rule: rule.name,
          category: rule.category
        }
      };
    }
  }
  return null;
}

function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function embedQuery(input) {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_KEY}`
    },
    body: JSON.stringify({ model: 'text-embedding-3-small', input })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Embedding request failed: ${response.status} ${response.statusText} — ${body}`);
  }

  const json = await response.json();
  const vector = json?.data?.[0]?.embedding;
  if (!Array.isArray(vector)) {
    throw new Error('Unexpected embedding response');
  }
  return vector;
}

// Risk tokens that indicate potential safety concerns
const RISK_TOKENS = [
  // Medical/health terms
  'pregnant', 'pregnancy', 'breastfeeding', 'nursing', 'conceive', 'ttc', 'trying to conceive',
  // Medication terms
  'ssri', 'snri', 'maoi', 'antidepressant', 'prozac', 'zoloft', 'lexapro', 'wellbutrin',
  'adderall', 'vyvanse', 'ritalin', 'stimulant', 'adhd', 'add',
  'warfarin', 'blood thinner', 'anticoagulant', 'coumadin',
  'seizure', 'epilepsy', 'diabetes', 'thyroid', 'insulin',
  'birth control', 'contraceptive',
  // Dosage/overdose terms
  'overdose', 'too many', 'too much', 'mg', 'milligram', 'gram',
  // Emergency terms
  'chest pain', 'poisoning', 'emergency', '911', 'hospital',
  // Drug interaction terms
  'interaction', 'combine', 'mix', 'together with', 'along with'
];

// Product context indicators (reduce safety concern weight)
const PRODUCT_CONTEXT_INDICATORS = [
  'a-minus', 'supplement', 'activated carbon', 'acetaldehyde',
  'ingredients', 'what is', 'how does', 'science', 'technology',
  'mechanism', 'work', 'take', 'dosage', 'serving', 'capsule'
];

function countRiskTokens(message) {
  const lowerMessage = message.toLowerCase();
  return RISK_TOKENS.filter(token => lowerMessage.includes(token.toLowerCase())).length;
}

function hasProductContext(message) {
  const lowerMessage = message.toLowerCase();
  return PRODUCT_CONTEXT_INDICATORS.some(indicator => lowerMessage.includes(indicator));
}

async function runSafetyEmbedding(normalizedMessage, getEmbedding) {
  const router = getSafetyRouter();
  if (!router?.entries?.length) return null;

  const embedding = await getEmbedding();
  let best = null;

  for (const entry of router.entries) {
    const score = cosine(embedding, entry.embedding);
    if (!best || score > best.score) {
      best = { ...entry, score };
    }
  }

  if (!best) return null;

  // Calculate weighted safety score
  const embeddingScore = best.score;
  const riskTokenCount = countRiskTokens(normalizedMessage);
  const hasProductCtx = hasProductContext(normalizedMessage);

  // Risk token score (0-1 scale, capped at 1)
  const riskTokenScore = Math.min(riskTokenCount * 0.3, 1.0);

  // Weighted safety score: embedding (70%) + risk tokens (30%)
  let safetyScore = (embeddingScore * 0.7) + (riskTokenScore * 0.3);

  // Reduce score if it's clearly about product information
  if (hasProductCtx && riskTokenCount < 2) {
    safetyScore *= 0.6; // Reduce safety score by 40%
  }

  if (safetyScore >= SAFETY_THRESHOLD) {
    return {
      answer: best.response,
      routing: {
        layer: 'safety-embed',
        rule: best.id,
        category: best.category,
        score: Number(safetyScore.toFixed(3)),
        // Add debug info for analysis
        embeddingScore: Number(embeddingScore.toFixed(3)),
        riskTokenCount,
        hasProductContext: hasProductCtx
      }
    };
  }

  return null;
}

function runBusinessRegex(normalizedMessage) {
  if (!normalizedMessage) return null;
  for (const rule of BUSINESS_REGEX_RULES) {
    if (rule.patterns.some((regex) => regex.test(normalizedMessage))) {
      return {
        intent: rule.intent,
        routing: {
          layer: 'business-regex',
          rule: rule.name,
          intent: rule.intent
        }
      };
    }
  }
  return null;
}

function applyIntentMetadata(intentId, layer, score = null) {
  const router = getIntentRouter();
  const meta = router?.map?.get(intentId) || null;

  const routing = {
    layer,
    intent: intentId
  };
  if (score !== null) {
    routing.score = Number(score.toFixed(3));
  }

  if (meta?.label) {
    routing.label = meta.label;
  }

  const scope = Array.isArray(meta?.scope) ? meta.scope : null;
  const response = meta?.response || null;

  return { routing, scope, response };
}

async function runIntentEmbedding(getEmbedding) {
  const router = getIntentRouter();
  if (!router?.intents?.length) return null;

  const embedding = await getEmbedding();
  let bestIntent = null;

  for (const intent of router.intents) {
    let maxScore = -Infinity;
    for (const example of intent.examples || []) {
      const score = cosine(embedding, example.embedding);
      if (score > maxScore) maxScore = score;
    }

    const threshold = Number.isFinite(intent.threshold) ? intent.threshold : INTENT_FALLBACK_THRESHOLD;
    if (maxScore >= threshold) {
      if (!bestIntent || maxScore > bestIntent.score) {
        bestIntent = { intent: intent.id, score: maxScore };
      }
    }
  }

  if (!bestIntent) return null;
  return applyIntentMetadata(bestIntent.intent, 'intent-embed', bestIntent.score);
}

function filterDocsByScope(corpusDocs, scope) {
  if (!Array.isArray(scope) || scope.length === 0) {
    return corpusDocs;
  }
  const allowed = new Set(scope);
  const filtered = corpusDocs.filter((doc) => allowed.has(doc.id));
  return filtered.length ? filtered : corpusDocs;
}

function buildSources(scoredDocs, routing) {
  const sources = scoredDocs.map((doc) => ({
    id: doc.id,
    url: doc.url,
    score: Number(doc.score.toFixed(3))
  }));

  if (routing) {
    return sources.map((source) => ({ ...source, routingHint: routing.intent || routing.rule || null }));
  }

  return sources;
}

function respond(res, payload) {
  const { answer, sources = [], routing } = payload;
  return res.json({ answer, sources, routing });
}

async function logRequestAsync(requestData) {
  try {
    const queryLogId = await logQuery(requestData);

    // Log retrieval details if available
    if (requestData.retrievalDetails && requestData.retrievalDetails.length > 0) {
      await logRetrievalDetails(queryLogId, requestData.retrievalDetails);
    }

    // Log routing decisions if available
    if (requestData.decisionTrace && requestData.decisionTrace.length > 0) {
      await logRoutingDecisions(queryLogId, requestData.decisionTrace);
    }
  } catch (error) {
    // Check if it's a missing table error
    if (error.message?.includes('relation "query_logs" does not exist') ||
        error.message?.includes('table') ||
        error.code === '42P01') {
      console.warn('Database tables not created yet. Run /api/migrate to create tables.');
    } else {
      console.error('Failed to log query to database:', error.message);
    }
    // Don't throw - logging failures shouldn't break the chat
  }
}

export default async function handler(req, res) {
  const startTime = Date.now();
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  res.setHeader('Access-Control-Allow-Origin', ORIGIN_ALLOWED);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  if (!OPENAI_KEY) return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });

  let userMessage = null;
  let normalizedMessage = null;
  let responseData = null;
  let openaiMetadata = {};
  let errorMessage = null;
  let decisionTrace = []; // Track routing decisions for analysis

  try {
    const { message } = req.body || {};
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message required' });
    }

    userMessage = message;
    normalizedMessage = entityAwareNormalize(message);

    // 1. Safety Regex - Fast deterministic safety checks
    const safetyRegex = runSafetyRegex(message);
    decisionTrace.push({
      layer: 'safety-regex',
      rule: safetyRegex?.routing?.rule || null,
      intent: null,
      category: safetyRegex?.routing?.category || null,
      score: null,
      triggered: !!safetyRegex
    });

    if (safetyRegex) {
      responseData = {
        answer: safetyRegex.answer,
        sources: [{ id: 'safety', url: 'https://intelligentmolecules.com/pages/faq', score: null }],
        routing: safetyRegex.routing
      };

      // Send response immediately
      respond(res, responseData);

      // Log async after response sent
      setImmediate(() => {
        logRequestAsync({
          userMessage,
          normalizedMessage,
          responseAnswer: responseData.answer,
          routing: responseData.routing,
          sources: responseData.sources,
          responseTimeMs: Date.now() - startTime,
          openai: openaiMetadata,
          errorMessage,
          retrievalDetails: [], // Safety-regex doesn't do document retrieval
          decisionTrace
        });
      });

      return;
    }

    // 2. Business Regex - Fast template responses for common queries (no API calls)
    let routing = null;
    let scope = null;

    const business = runBusinessRegex(normalizedMessage);
    decisionTrace.push({
      layer: 'business-regex',
      rule: business?.routing?.rule || null,
      intent: business?.intent || null,
      category: null,
      score: null,
      triggered: !!business
    });

    if (business) {
      const applied = applyIntentMetadata(business.intent, 'business-regex');
      routing = applied.routing;
      scope = applied.scope;
      if (applied.response) {
        responseData = {
          answer: applied.response,
          sources: [],
          routing
        };

        // Send response immediately
        respond(res, responseData);

        // Log async after response sent
        setImmediate(() => {
          logRequestAsync({
            userMessage,
            normalizedMessage,
            responseAnswer: responseData.answer,
            routing: responseData.routing,
            sources: responseData.sources,
            responseTimeMs: Date.now() - startTime,
            openai: openaiMetadata,
            embeddingCacheHit: false, // No embedding used
            errorMessage,
            retrievalDetails: [], // Business-regex doesn't do document retrieval
            decisionTrace
          });
        });

        return;
      }
    }

    // 3. Setup embedding computation for remaining layers (computed once, reused)
    const getEmbedding = (() => {
      let cached;
      return async () => {
        if (!cached) {
          cached = await embedQuery(normalizedMessage);
          // Store embedding metadata for logging
          openaiMetadata.model = 'text-embedding-3-small';
          openaiMetadata.embeddingCacheHit = false;
        } else {
          openaiMetadata.embeddingCacheHit = true;
        }
        return cached;
      };
    })();

    // 4. Safety Embedding - Weighted semantic safety detection
    const safetyEmbed = await runSafetyEmbedding(normalizedMessage, getEmbedding);
    decisionTrace.push({
      layer: 'safety-embed',
      rule: safetyEmbed?.routing?.rule || null,
      intent: null,
      category: safetyEmbed?.routing?.category || null,
      score: safetyEmbed?.routing?.score || null,
      triggered: !!safetyEmbed,
      riskTokenCount: safetyEmbed?.routing?.riskTokenCount || null,
      hasProductContext: safetyEmbed?.routing?.hasProductContext || null,
      embeddingScore: safetyEmbed?.routing?.embeddingScore || null
    });

    if (safetyEmbed) {
      responseData = {
        answer: safetyEmbed.answer,
        sources: [{ id: 'safety', url: 'https://intelligentmolecules.com/pages/faq', score: safetyEmbed.routing.score ?? null }],
        routing: safetyEmbed.routing
      };

      // Send response immediately
      respond(res, responseData);

      // Log async after response sent
      setImmediate(() => {
        logRequestAsync({
          userMessage,
          normalizedMessage,
          responseAnswer: responseData.answer,
          routing: responseData.routing,
          sources: responseData.sources,
          responseTimeMs: Date.now() - startTime,
          openai: openaiMetadata,
          embeddingCacheHit: openaiMetadata.embeddingCacheHit,
          errorMessage,
          retrievalDetails: [], // Safety-embed doesn't do document retrieval
          decisionTrace
        });
      });

      return;
    }

    // 5. Intent Embedding - Semantic intent classification (reuses embedding)
    const semanticIntent = await runIntentEmbedding(getEmbedding);
    decisionTrace.push({
      layer: 'intent-embed',
      rule: semanticIntent?.routing?.rule || null,
      intent: semanticIntent?.routing?.intent || null,
      category: null,
      score: semanticIntent?.routing?.score || null,
      triggered: !!semanticIntent
    });

    if (semanticIntent) {
      routing = semanticIntent.routing;
      scope = semanticIntent.scope;
      if (semanticIntent.response) {
          responseData = {
            answer: semanticIntent.response,
            sources: [],
            routing
          };

          // Send response immediately
          respond(res, responseData);

          // Log async after response sent
          setImmediate(() => {
            logRequestAsync({
              userMessage,
              normalizedMessage,
              responseAnswer: responseData.answer,
              routing: responseData.routing,
              sources: responseData.sources,
              responseTimeMs: Date.now() - startTime,
              openai: openaiMetadata,
              embeddingCacheHit: openaiMetadata.embeddingCacheHit,
              errorMessage,
              retrievalDetails: [], // Intent-embed doesn't do document retrieval
              decisionTrace
            });
          });

          return;
        }
    }

    // 6. RAG - Final fallback with document retrieval (reuses embedding)
    if (!fs.existsSync(EMBEDDINGS_PATH)) {
      return res.status(500).json({ error: 'embeddings.json not found. Run npm run ingest.' });
    }

    const corpus = getKnowledgeCorpus();

    // Record RAG decision (always triggered as final fallback)
    decisionTrace.push({
      layer: 'rag',
      rule: null,
      intent: routing?.intent || null,
      category: null,
      score: null, // Will be updated with min score of retrieved docs
      triggered: true
    });
    if (!corpus?.docs?.length) {
      return res.status(500).json({ error: 'No documents available for retrieval.' });
    }

    const qEmbedding = await getEmbedding();
    const docsToScore = filterDocsByScope(corpus.docs, scope);

    const scored = docsToScore
      .map((doc) => ({ ...doc, score: cosine(qEmbedding, doc.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    const context = scored.map((doc) => `[${doc.section}]\n${doc.content}`).join('\n---\n');

    const chatResp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        max_tokens: 400,
        messages: [
          { role: 'system', content: SYSTEM },
          {
            role: 'user',
            content: `Context:\n${context}\n\nUser question: ${message}\n\nInstructions:\n- Answer briefly (2–4 sentences) using ONLY the Context.\n- If the info isn't in Context, say you don't have it and invite the user to email info@intelligentmolecules.com.\n- Do NOT provide medical advice or disease claims.\n- Do NOT add an FDA/DSHEA disclaimer; the UI displays it.`
          }
        ]
      })
    });

    const jr = await chatResp.json();

    // Capture OpenAI metadata
    openaiMetadata.chatModel = 'gpt-4o-mini';
    openaiMetadata.requestId = chatResp.headers.get('openai-request-id') || null;
    openaiMetadata.totalTokens = jr.usage?.total_tokens || null;

    let answer = jr.choices?.[0]?.message?.content?.trim() || '';

    if (!answer) {
      responseData = {
        answer: 'Sorry, I couldn\'t generate a response.',
        sources: buildSources(scored, routing),
        routing: routing || { layer: 'rag', intent: null }
      };

      // Send response immediately
      respond(res, responseData);

      // Log async after response sent
      setImmediate(() => {
        logRequestAsync({
          userMessage,
          normalizedMessage,
          responseAnswer: responseData.answer,
          routing: responseData.routing,
          sources: responseData.sources,
          responseTimeMs: Date.now() - startTime,
          openai: openaiMetadata,
          embeddingCacheHit: openaiMetadata.embeddingCacheHit,
          errorMessage,
          retrievalDetails: scored?.map((doc, index) => ({
            documentId: doc.id,
            documentSection: doc.section,
            similarityScore: doc.score,
            scopeFiltered: scope && scope.length > 0
          })),
          decisionTrace
        });
      });

      return;
    }

    answer = answer.replace(/\*\*/g, '');

    responseData = {
      answer,
      sources: buildSources(scored, routing),
      routing: routing || { layer: 'rag', intent: null }
    };

    // Send response immediately
    respond(res, responseData);

    // Log async after response sent
    setImmediate(() => {
      logRequestAsync({
        userMessage,
        normalizedMessage,
        responseAnswer: responseData.answer,
        routing: responseData.routing,
        sources: responseData.sources,
        responseTimeMs: Date.now() - startTime,
        openai: openaiMetadata,
        embeddingCacheHit: openaiMetadata.embeddingCacheHit,
        errorMessage,
        retrievalDetails: scored?.map((doc, index) => ({
          documentId: doc.id,
          documentSection: doc.section,
          similarityScore: doc.score,
          scopeFiltered: scope && scope.length > 0
        })),
        decisionTrace
      });
    });

    return;

  } catch (err) {
    console.error(err);
    errorMessage = err.message;

    const errorResponse = { error: 'server error' };
    res.status(500).json(errorResponse);

    // Log error async
    setImmediate(() => {
      logRequestAsync({
        userMessage,
        normalizedMessage,
        responseAnswer: null,
        routing: null,
        sources: [],
        responseTimeMs: Date.now() - startTime,
        openai: openaiMetadata,
        embeddingCacheHit: openaiMetadata.embeddingCacheHit,
        errorMessage,
        retrievalDetails: [] // Error cases don't have document retrieval
      });
    });
  }
}
