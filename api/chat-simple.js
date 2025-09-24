// Ultra-simple chat endpoint to test step by step
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const ORIGIN_ALLOWED = process.env.ORIGIN_ALLOWED || '*';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN_ALLOWED);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  if (!OPENAI_KEY) return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });

  try {
    const { message } = req.body || {};
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message required' });
    }

    // Test 1: Basic response
    if (message.toLowerCase().includes('test')) {
      return res.json({
        answer: 'Test successful! I can respond to messages.',
        sources: [],
        routing: { layer: 'test' }
      });
    }

    // Test 2: Safety regex (no OpenAI calls)
    if (message.toLowerCase().includes('pregnant')) {
      return res.json({
        answer: "I'm not able to advise on using A-Minus while pregnant. Please discuss with your healthcare professional.",
        sources: [{ id: 'safety', url: 'https://intelligentmolecules.com/pages/faq', score: null }],
        routing: { layer: 'safety-regex', rule: 'pregnancy' }
      });
    }

    // Test 3: Simple OpenAI embedding test
    console.log('Testing OpenAI embedding...');
    const embeddingResponse = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_KEY}`
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: message
      })
    });

    if (!embeddingResponse.ok) {
      const errorText = await embeddingResponse.text();
      throw new Error(`Embedding failed: ${embeddingResponse.status} - ${errorText}`);
    }

    const embeddingJson = await embeddingResponse.json();
    console.log('Embedding successful, vector length:', embeddingJson?.data?.[0]?.embedding?.length);

    // Test 4: File system access
    const fs = await import('fs');
    const path = await import('path');

    const embeddingsPath = path.join(process.cwd(), 'data', 'embeddings.json');
    console.log('Checking embeddings file at:', embeddingsPath);

    if (!fs.existsSync(embeddingsPath)) {
      throw new Error('Embeddings file not found at: ' + embeddingsPath);
    }

    const embeddingsContent = fs.readFileSync(embeddingsPath, 'utf8');
    const corpus = JSON.parse(embeddingsContent);
    console.log('Loaded corpus with', corpus?.docs?.length, 'documents');

    // Simple success response
    return res.json({
      answer: `I processed your message: "${message}". All systems working: embedding (${embeddingJson?.data?.[0]?.embedding?.length} dims), corpus (${corpus?.docs?.length} docs).`,
      sources: [],
      routing: { layer: 'test-full' }
    });

  } catch (error) {
    console.error('Chat-simple error:', error);

    return res.status(500).json({
      error: 'server error in chat-simple',
      message: error.message,
      stack: error.stack?.split('\n').slice(0, 10), // First 10 lines of stack
      step: 'unknown'
    });
  }
}