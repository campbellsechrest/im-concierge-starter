import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

const OPENAI_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_KEY) {
  console.error('Missing OPENAI_API_KEY');
  process.exit(1);
}

async function embed(text) {
  const r = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_KEY}`
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: text
    })
  });
  const j = await r.json();
  if (!j.data) {
    console.error('Embedding error:', j);
    process.exit(1);
  }
  return j.data[0].embedding;
}

async function main() {
  const dir = path.join(process.cwd(), 'data', 'knowledge');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
  const docs = [];
  for (const f of files) {
    const raw = fs.readFileSync(path.join(dir, f), 'utf8');
    const { content, data } = matter(raw);
    const e = await embed(content);
    docs.push({
      id: data.id || f,
      url: data.url || '',
      section: data.section || 'general',
      content,
      embedding: e
    });
    console.log('Embedded', f);
  }
  fs.writeFileSync(path.join(process.cwd(), 'data', 'embeddings.json'),
    JSON.stringify({ model: 'text-embedding-3-small', docs }));
  console.log('Wrote data/embeddings.json');
}

main().catch(err => { console.error(err); process.exit(1); });
