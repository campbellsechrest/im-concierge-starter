// Working chat API based on successful simple test, gradually building up complexity
import fs from 'fs';
import path from 'path';
import { logQuery, logRetrievalDetails } from '../lib/database/queries.js';

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
      /emergency/i,
      /chest pain/i,
      /shortness of breath/i,
      /trouble breathing/i,
      /faint(ing)?/i,
      /pass(ing)? out/i,
      /unconscious/i,
      /seizure/i,
      /poison(ing)?/i,
      /overdose/i,
      /alcohol poisoning/i
    ],
    message: () =>
      `I'm really sorry you're feeling unwell. I'm not a medical professional, but symptoms like this need immediate care. Please contact emergency services (call 911 or your local equivalent) or poison control right away. Once you're safe, email ${HUMAN_SUPPORT_EMAIL} and the team can follow up.`,
    category: 'emergency'
  },
  {
    name: 'pregnancy',
    patterns: [
      /pregnan(t|cy)/i,
      /trying to conceive/i,
      /\bttc\b/i,
      /ivf/i,
      /fertility/i,
      /postpartum/i,
      /breastfeed(ing)?/i,
      /nursing/i,
      /pumping/i,
      /newborn/i
    ],
    message: () =>
      `I'm not able to advise on using A-Minus while pregnant, trying to conceive, or breastfeeding. It hasn't been studied for those situations, so please discuss it with your healthcare professional and email ${HUMAN_SUPPORT_EMAIL} if you'd like a teammate to follow up.`,
    category: 'pregnancy'
  },
  {
    name: 'medication',
    patterns: [
      /prescription/i,
      /medication/i,
      /medicine/i,
      /drug(s)?/i,
      /ssri/i,
      /snri/i,
      /maoi/i,
      /antidepressant/i,
      /blood thinner/i,
      /eliquis/i,
      /xarelto/i,
      /warfarin/i,
      /adderall/i,
      /vyvanse/i,
      /benzodiazepine/i,
      /anxiety med/i
    ],
    message: () =>
      `I can't provide guidance on combining A-Minus with prescription or OTC medicines. Please check with your doctor or pharmacist, and feel free to email ${HUMAN_SUPPORT_EMAIL} so a human can help.`,
    category: 'medication'
  },
  {
    name: 'underage',
    patterns: [
      /\bi am (?:1[0-7]|under 21)\b/i,
      /\bi'm (?:1[0-7]|under 21)\b/i,
      /underage/i
    ],
    message: () =>
      `A-Minus is only for adults of legal drinking age. I'm not able to help here, but you can reach the team at ${HUMAN_SUPPORT_EMAIL} if you have other questions.`,
    category: 'underage'
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

function normalizeMessage(message = '') {
  return message.toLowerCase().replace(/\s+/g, ' ').trim();
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

async function logRequestAsync(requestData) {
  try {
    const queryLogId = await logQuery(requestData);

    // Log retrieval details if available
    if (requestData.retrievalDetails && requestData.retrievalDetails.length > 0) {
      await logRetrievalDetails(queryLogId, requestData.retrievalDetails);
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

  res.setHeader('Access-Control-Allow-Origin', ORIGIN_ALLOWED);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Support GET for easy browser testing
  if (req.method === 'GET') {
    const message = req.query.message || req.query.q || 'What is A-Minus?';
    req.body = { message };
  } else if (req.method !== 'POST') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  if (!OPENAI_KEY) return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });

  let userMessage = null;
  let normalizedMessage = null;
  let responseData = null;
  let openaiMetadata = {};
  let errorMessage = null;

  try {
    const { message } = req.body || {};
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message required' });
    }

    userMessage = message;
    normalizedMessage = normalizeMessage(message);

    // Check safety regex first
    const safetyRegex = runSafetyRegex(message);
    if (safetyRegex) {
      responseData = {
        answer: safetyRegex.answer,
        sources: [{ id: 'safety', url: 'https://intelligentmolecules.com/pages/faq', score: null }],
        routing: safetyRegex.routing
      };

      // Send response immediately
      res.json(responseData);

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
          errorMessage
        });
      });

      return;
    }

    // Check if embeddings file exists
    if (!fs.existsSync(EMBEDDINGS_PATH)) {
      return res.status(500).json({ error: 'embeddings.json not found. Run npm run ingest.' });
    }

    const corpus = getKnowledgeCorpus();
    if (!corpus?.docs?.length) {
      return res.status(500).json({ error: 'No documents available for retrieval.' });
    }

    // Get embedding for the query
    const qEmbedding = await embedQuery(normalizedMessage);
    openaiMetadata.model = 'text-embedding-3-small';
    openaiMetadata.embeddingCacheHit = false;

    // Score documents
    const scored = corpus.docs
      .map((doc) => ({ ...doc, score: cosine(qEmbedding, doc.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    const context = scored.map((doc) => `[${doc.section}]\n${doc.content}`).join('\n---\n');

    // Call OpenAI chat
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
        sources: buildSources(scored, null),
        routing: { layer: 'rag', intent: null }
      };
    } else {
      answer = answer.replace(/\*\*/g, '');
      responseData = {
        answer,
        sources: buildSources(scored, null),
        routing: { layer: 'rag', intent: null }
      };
    }

    // Send response immediately
    res.json(responseData);

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
          scopeFiltered: false
        }))
      });
    });

    return;

  } catch (err) {
    console.error('Chat-fixed error:', err);
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
        errorMessage
      });
    });
  }
}