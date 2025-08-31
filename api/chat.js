import fs from 'fs';

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const ORIGIN_ALLOWED = process.env.ORIGIN_ALLOWED || '*';

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
- Always append: "These statements have not been evaluated by the Food and Drug Administration. This product is not intended to diagnose, treat, cure or prevent any disease."
Voice: calm, science-forward, friendly. Keep answers short, with bullets when helpful.`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN_ALLOWED);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const embeddingsPath = 'data/embeddings.json';
  if (!OPENAI_KEY) return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });

  try {
    const { message } = req.body || {};
    if (!message) return res.status(400).json({ error: 'message required' });

    if (!fs.existsSync(embeddingsPath)) {
      return res.status(500).json({ error: 'embeddings.json not found. Run npm run ingest.' });
    }
    const corpus = JSON.parse(fs.readFileSync(embeddingsPath, 'utf8'));
    const qEmb = await embedQuery(message);
    const scored = corpus.docs
      .map(d => ({ ...d, score: cosine(qEmb, d.embedding) }))
      .sort((a,b) => b.score - a.score)
      .slice(0, 4);

    const context = scored.map(d => `[${d.section}]\n${d.content}`).join('\n---\n');
    const prompt = `Context:\n${context}\n\nUser question: ${message}`;

    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        system: SYSTEM,
        input: prompt,
        temperature: 0.2
      })
    });
    const j = await r.json();
    const text = j.output_text || j.choices?.[0]?.message?.content || 'Sorry, I couldn’t generate a response.';

    res.json({
      answer: text,
      sources: scored.map(d => ({ id: d.id, url: d.url, score: Number(d.score.toFixed(3)) }))
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server error' });
  }
}
