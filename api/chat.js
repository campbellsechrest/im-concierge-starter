import fs from 'fs';

import path from 'path';

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const ORIGIN_ALLOWED = process.env.ORIGIN_ALLOWED || '*';

const HUMAN_SUPPORT_EMAIL = 'info@intelligentmolecules.com';

const ROUTE_RULES = [
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
    message: (question) => 
      `I'm really sorry you're feeling unwell. I'm not a medical professional, but symptoms like this need immediate care. Please contact emergency services (call 911 or your local equivalent) or poison control right away. Once you're safe, email ${HUMAN_SUPPORT_EMAIL} and the team can follow up.`
  },
  {
    name: 'pregnancy',
    patterns: [
      /pregnan(t|cy)/i,
      /trying to conceive/i,
      /ttc/i,
      /ivf/i,
      /fertility/i,
      /postpartum/i,
      /breastfeed(ing)?/i,
      /nursing/i,
      /pumping/i,
      /newborn/i
    ],
    message: (question) => 
      `I’m not able to advise on using A-Minus while pregnant, trying to conceive, or breastfeeding. It hasn’t been studied for those situations, so please discuss it with your healthcare professional and email ${HUMAN_SUPPORT_EMAIL} if you’d like a teammate to follow up.`
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
    message: (question) => 
      `I can’t provide guidance on combining A-Minus with prescription or OTC medicines. Please check with your doctor or pharmacist, and feel free to email ${HUMAN_SUPPORT_EMAIL} so a human can help.`
  },
  {
    name: 'underage',
    patterns: [
      /i am (?:1[0-7]|under 21)/i,
      /i'm (?:1[0-7]|under 21)/i,
      /underage/i
    ],
    message: (question) => 
      `A-Minus is only for adults of legal drinking age. I’m not able to help here, but you can reach the team at ${HUMAN_SUPPORT_EMAIL} if you have other questions.`
  }
];

function routeIntent(question = '') {
  const text = question.toLowerCase();
  for (const rule of ROUTE_RULES) {
    if (rule.patterns.some((regex) => regex.test(text))) {
      return { rule: rule.name, message: rule.message(question) };
    }
  }
  return null;
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function embedQuery(q) {
  const r = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: q })
  });
  const j = await r.json();
  return j.data?.[0]?.embedding || [];
}

const SYSTEM = `You are the Intelligent Molecules on-site concierge. Use only the provided context; if unsure, say so and offer to connect the customer with human support at info@intelligentmolecules.com.
Guardrails:
- No medical advice. Avoid disease/treatment claims.
- For pregnancy/breastfeeding or prescription meds (e.g., SSRIs/SNRIs/MAOIs, stimulants, anticoagulants, seizure, diabetes, thyroid, oral contraceptives), do not advise; suggest speaking with a clinician and offer human support.
- Do not include FDA/DSHEA disclaimers; the UI handles this.
Voice: calm, science-forward, friendly. Keep answers short, with bullets when helpful.`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN_ALLOWED);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const embeddingsPath = path.join(process.cwd(), 'data', 'embeddings.json');

  if (!OPENAI_KEY) return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });

  try {
    const { message } = req.body || {};
    if (!message) return res.status(400).json({ error: 'message required' });

    const routed = routeIntent(message);
    if (routed) {
      return res.json({
        answer: routed.message,
        sources: [{ id: 'safety', url: 'https://intelligentmolecules.com/pages/faq', score: null, rule: routed.rule }]
      });
    }

    if (!fs.existsSync(embeddingsPath)) {
      return res.status(500).json({ error: 'embeddings.json not found. Run npm run ingest.' });
    }
    const corpus = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'data', 'embeddings.json'), 'utf8')
);


    const qEmb = await embedQuery(message);
    const scored = corpus.docs
      .map(d => ({ ...d, score: cosine(qEmb, d.embedding) }))
      .sort((a,b) => b.score - a.score)
      .slice(0, 4);

    const context = scored.map(d => `[${d.section}]\n${d.content}`).join('\n---\n');
    const prompt = `Context:\n${context}\n\nUser question: ${message}`;

    // sources metadata for the UI
const sources = scored.map(d => ({ id: d.id, url: d.url, score: +d.score.toFixed(3) }));

// Disclaimer is rendered in the UI; do not append here.

const chatResp = await fetch('https://api.openai.com/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${OPENAI_KEY}`
  },
  body: JSON.stringify({
    model: 'gpt-4o-mini',
    temperature: 0.2,
    max_tokens: 400,
    messages: [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content:
`Context:
${context}

User question: ${message}

Instructions:
- Answer briefly (2–4 sentences) using ONLY the Context.
- If the info isn’t in Context, say you don’t have it and invite the user to email info@intelligentmolecules.com.
- Do NOT provide medical advice or disease claims.
- Do NOT add an FDA/DSHEA disclaimer; the UI displays it.`
      }
    ]
  })
});

const jr = await chatResp.json();
let answer = jr.choices?.[0]?.message?.content?.trim() || '';

if (!answer) {
  return res.json({ answer: "Sorry, I couldn’t generate a response.", sources });
}

// Remove Markdown bold markers (**bold**) from responses
answer = answer.replace(/\*\*/g, '');

return res.json({ answer, sources });


    res.json({
      answer: text,
      sources: scored.map(d => ({ id: d.id, url: d.url, score: Number(d.score.toFixed(3)) }))
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server error' });
  }
}
