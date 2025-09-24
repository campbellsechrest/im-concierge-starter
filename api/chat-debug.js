// Temporary debug version of chat.js with database logging disabled
import fs from 'fs';
import path from 'path';

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
    patterns: [/\b911\b/i, /emergency/i, /chest pain/i],
    message: () =>
      `I'm really sorry you're feeling unwell. I'm not a medical professional, but symptoms like this need immediate care. Please contact emergency services (call 911 or your local equivalent) or poison control right away. Once you're safe, email ${HUMAN_SUPPORT_EMAIL} and the team can follow up.`,
    category: 'emergency'
  },
  {
    name: 'pregnancy',
    patterns: [/pregnan(t|cy)/i, /trying to conceive/i, /breastfeed(ing)?/i],
    message: () =>
      `I'm not able to advise on using A-Minus while pregnant, trying to conceive, or breastfeeding. It hasn't been studied for those situations, so please discuss it with your healthcare professional and email ${HUMAN_SUPPORT_EMAIL} if you'd like a teammate to follow up.`,
    category: 'pregnancy'
  }
];

const SYSTEM = `You are the Intelligent Molecules on-site concierge. Use only the provided context; if unsure, say so and offer to connect the customer with human support at info@intelligentmolecules.com.
Guardrails:
- No medical advice. Avoid disease/treatment claims.
- For pregnancy/breastfeeding or prescription meds (e.g., SSRIs/SNRIs/MAOIs, stimulants, anticoagulants, seizure, diabetes, thyroid, oral contraceptives), do not advise; suggest speaking with a clinician and offer human support.
- Do not include FDA/DSHEA disclaimers; the UI handles this.
Voice: calm, science-forward, friendly. Keep answers short, with bullets when helpful.`;

let knowledgeCorpus;

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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN_ALLOWED);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  if (!OPENAI_KEY) return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });

  try {
    const { message } = req.body || {};
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message required' });
    }

    const normalized = normalizeMessage(message);

    // Check safety regex first
    const safetyRegex = runSafetyRegex(message);
    if (safetyRegex) {
      return res.json({
        answer: safetyRegex.answer,
        sources: [{ id: 'safety', url: 'https://intelligentmolecules.com/pages/faq', score: null }],
        routing: safetyRegex.routing
      });
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
    const qEmbedding = await embedQuery(normalized);

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
    let answer = jr.choices?.[0]?.message?.content?.trim() || '';

    if (!answer) {
      return res.json({
        answer: 'Sorry, I couldn't generate a response.',
        sources: buildSources(scored, null),
        routing: { layer: 'rag', intent: null }
      });
    }

    answer = answer.replace(/\*\*/g, '');

    return res.json({
      answer,
      sources: buildSources(scored, null),
      routing: { layer: 'rag', intent: null }
    });

  } catch (err) {
    console.error('Chat debug error:', err);
    return res.status(500).json({
      error: 'server error',
      details: err.message,
      stack: err.stack
    });
  }
}