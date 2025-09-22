import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const MODEL = 'text-embedding-3-small';
const DATA_DIR = path.join(process.cwd(), 'data');
const KNOWLEDGE_DIR = path.join(DATA_DIR, 'knowledge');
const ROUTER_DIR = path.join(process.cwd(), 'router');

if (!OPENAI_KEY) {
  console.error('Missing OPENAI_API_KEY');
  process.exit(1);
}

async function embed(text) {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_KEY}`
    },
    body: JSON.stringify({
      model: MODEL,
      input: text
    })
  });

  if (!response.ok) {
    const body = await response.text();
    console.error('Embedding request failed:', response.status, response.statusText, body);
    process.exit(1);
  }

  const json = await response.json();
  const vector = json?.data?.[0]?.embedding;
  if (!Array.isArray(vector)) {
    console.error('Unexpected embedding response:', json);
    process.exit(1);
  }
  return vector;
}

function writeJson(relativePath, payload) {
  const fullPath = path.join(process.cwd(), relativePath);
  fs.writeFileSync(fullPath, JSON.stringify(payload));
  console.log('Wrote', relativePath);
}

function loadJson(relativePath) {
  const fullPath = path.join(process.cwd(), relativePath);
  if (!fs.existsSync(fullPath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
}

async function buildKnowledgeEmbeddings() {
  const cache = loadJson(path.join('data', 'embeddings.json'));
  const cachedDocs = new Map();
  if (Array.isArray(cache?.docs)) {
    for (const doc of cache.docs) {
      if (doc?.id) cachedDocs.set(doc.id, doc);
    }
  }

  const files = fs
    .readdirSync(KNOWLEDGE_DIR)
    .filter((file) => file.endsWith('.md'))
    .sort();
  const docs = [];

  for (const file of files) {
    const raw = fs.readFileSync(path.join(KNOWLEDGE_DIR, file), 'utf8');
    const { content, data } = matter(raw);
    const id = data.id || file;
    const cached = cachedDocs.get(id);
    const embedding = cached && cached.content === content ? cached.embedding : await embed(content);
    if (!cached || cached.content !== content) {
      console.log('Embedded knowledge doc', file);
    } else {
      console.log('Reused cached knowledge embedding', file);
    }
    docs.push({
      id,
      url: data.url || '',
      section: data.section || 'general',
      content,
      embedding
    });
  }

  writeJson(path.join('data', 'embeddings.json'), { model: MODEL, docs });
}

async function buildSafetyRouter() {
  const configPath = path.join(ROUTER_DIR, 'safety.json');
  if (!fs.existsSync(configPath)) {
    console.warn('Skipping safety router embeddings (router/safety.json missing)');
    return;
  }

  const cache = loadJson(path.join('data', 'router-safety.json'));
  const cachedEntries = new Map();
  if (Array.isArray(cache?.entries)) {
    for (const entry of cache.entries) {
      if (entry?.id) cachedEntries.set(entry.id, entry);
    }
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const entries = [];
  for (const entry of config) {
    const cached = cachedEntries.get(entry.id);
    const embedding = cached && cached.text === entry.text ? cached.embedding : await embed(entry.text);
    if (!cached || cached.text !== entry.text) {
      console.log('Embedded safety router prompt', entry.id);
    } else {
      console.log('Reused cached safety router embedding', entry.id);
    }
    entries.push({
      id: entry.id,
      category: entry.category,
      response: entry.response,
      text: entry.text,
      embedding
    });
  }

  writeJson(path.join('data', 'router-safety.json'), { model: MODEL, entries });
}

async function buildIntentRouter() {
  const configPath = path.join(ROUTER_DIR, 'intents.json');
  if (!fs.existsSync(configPath)) {
    console.warn('Skipping intent router embeddings (router/intents.json missing)');
    return;
  }

  const cache = loadJson(path.join('data', 'router-intents.json'));
  const cachedIntents = new Map();
  if (Array.isArray(cache?.intents)) {
    for (const intent of cache.intents) {
      if (intent?.id) cachedIntents.set(intent.id, intent);
    }
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const intents = [];

  for (const intent of config) {
    const examples = [];
    const cachedIntent = cachedIntents.get(intent.id);
    for (const example of intent.examples || []) {
      const cachedExample = cachedIntent?.examples?.find((item) => item.text === example);
      const embedding = cachedExample ? cachedExample.embedding : await embed(example);
      if (!cachedExample) {
        console.log(`Embedded intent example for ${intent.id}`);
      } else {
        console.log(`Reused cached intent embedding for ${intent.id}`);
      }
      examples.push({ text: example, embedding });
    }

    intents.push({
      id: intent.id,
      label: intent.label,
      threshold: intent.threshold,
      scope: intent.scope || null,
      response: intent.response || null,
      examples
    });
  }

  writeJson(path.join('data', 'router-intents.json'), { model: MODEL, intents });
}

async function main() {
  await buildKnowledgeEmbeddings();
  await buildSafetyRouter();
  await buildIntentRouter();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
