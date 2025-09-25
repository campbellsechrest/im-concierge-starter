import fs from 'fs';
import path from 'path';
import { logEvaluationResults } from '../lib/database/queries.js';

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
const TOP_K_DEFAULT = Number(process.env.EVAL_TOP_K || 4);
const EVAL_DIR = process.env.EVAL_DIR || 'eval';

// Get git commit hash for tracking evaluation runs
function getGitCommit() {
  try {
    const { execSync } = require('child_process');
    const commit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    return commit;
  } catch (error) {
    console.warn('Could not determine git commit:', error.message);
    return null;
  }
}

// Get deployment ID from Vercel environment
function getDeploymentId() {
  return process.env.VERCEL_DEPLOYMENT_ID || process.env.DEPLOYMENT_ID || null;
}

if (!OPENAI_KEY) {
  console.error('Missing OPENAI_API_KEY for evaluation');
  process.exit(1);
}

function readJson(relativePath) {
  const fullPath = path.join(process.cwd(), relativePath);
  if (!fs.existsSync(fullPath)) {
    console.error(`Required file not found: ${relativePath}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
}

function loadScenarios() {
  const dir = path.join(process.cwd(), EVAL_DIR);
  if (!fs.existsSync(dir)) {
    console.error(`Evaluation directory not found: ${EVAL_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort();
  if (!files.length) {
    console.error(`No .jsonl files found in ${EVAL_DIR}`);
    process.exit(1);
  }

  const scenarios = [];

  for (const file of files) {
    const suite = path.basename(file, '.jsonl');
    const fullPath = path.join(dir, file);
    const lines = fs.readFileSync(fullPath, 'utf8').split(/\r?\n/);

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const payload = JSON.parse(trimmed);
        if (!payload.id) {
          payload.id = `${suite}-${index + 1}`;
        }
        payload.suite = suite;
        payload._source = `${file}:${index + 1}`;
        scenarios.push(payload);
      } catch (err) {
        console.error(`Failed to parse ${file}:${index + 1}: ${err.message}`);
        process.exit(1);
      }
    });
  }

  return scenarios;
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

async function embedQuery(query) {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_KEY}`
    },
    body: JSON.stringify({ model: MODEL, input: query })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Embedding request failed: ${response.status} ${response.statusText} — ${errorBody}`);
  }

  const payload = await response.json();
  const vector = payload?.data?.[0]?.embedding;
  if (!Array.isArray(vector)) {
    throw new Error(`Unexpected embedding response for query: ${query}`);
  }
  return vector;
}

function evaluateScenario(scenario, scored, topK) {
  const topDocs = scored.slice(0, topK);
  const report = {
    id: scenario.id,
    suite: scenario.suite,
    question: scenario.question,
    expectation: scenario.expectation || null,
    passed: true,
    reasons: [],
    topDocs
  };

  if (scenario.expectedTopDoc) {
    if (topDocs[0]?.id !== scenario.expectedTopDoc) {
      report.passed = false;
      report.reasons.push(
        `Expected top doc ${scenario.expectedTopDoc}, got ${topDocs[0]?.id ?? 'none'}`
      );
    }
  }

  if (Array.isArray(scenario.expectedDocIds) && scenario.expectedDocIds.length) {
    for (const expected of scenario.expectedDocIds) {
      if (!topDocs.some(doc => doc.id === expected)) {
        report.passed = false;
        report.reasons.push(`Expected doc ${expected} within Top-${topK}`);
      }
    }
  }

  if (typeof scenario.minScore === 'number' && scenario.expectedTopDoc) {
    const match = topDocs.find(doc => doc.id === scenario.expectedTopDoc);
    if (!match) {
      report.passed = false;
      report.reasons.push(`Top-${topK} did not contain ${scenario.expectedTopDoc} to enforce minScore`);
    } else if (match.score < scenario.minScore) {
      report.passed = false;
      report.reasons.push(
        `Score ${match.score.toFixed(3)} for ${scenario.expectedTopDoc} was below minScore ${scenario.minScore}`
      );
    }
  }

  if (typeof scenario.maxScore === 'number') {
    const target = scenario.expectedTopDoc
      ? topDocs.find(doc => doc.id === scenario.expectedTopDoc)
      : topDocs[0];
    if (target && target.score > scenario.maxScore) {
      report.passed = false;
      report.reasons.push(
        `Score ${target.score.toFixed(3)} exceeded maxScore ${scenario.maxScore}`
      );
    }
  }

  return report;
}

async function main() {
  const scenarios = loadScenarios();
  if (!scenarios.length) {
    console.error('No evaluation scenarios found.');
    process.exit(1);
  }

  const corpus = readJson('data/embeddings.json');
  const docs = Array.isArray(corpus?.docs) ? corpus.docs : [];
  if (!docs.length) {
    console.error('No documents found in data/embeddings.json');
    process.exit(1);
  }

  const suiteNames = [...new Set(scenarios.map(s => s.suite))];
  console.log(
    `Running ${scenarios.length} evaluation${scenarios.length === 1 ? '' : 's'} across ${suiteNames.length} suite${suiteNames.length === 1 ? '' : 's'}...`
  );

  const results = [];

  for (const scenario of scenarios) {
    if (!scenario.question) {
      console.warn(`Skipping scenario ${scenario.suite}/${scenario.id} — question missing.`);
      continue;
    }

    try {
      const queryEmbedding = await embedQuery(scenario.question);
      const scored = docs
        .map(doc => ({
          id: doc.id,
          url: doc.url,
          section: doc.section,
          score: cosine(queryEmbedding, doc.embedding)
        }))
        .sort((a, b) => b.score - a.score);

      const topK = Number.isFinite(scenario.topK) ? Number(scenario.topK) : TOP_K_DEFAULT;
      const report = evaluateScenario(scenario, scored, topK);
      results.push(report);

      const status = report.passed ? '✅ PASS' : '❌ FAIL';
      const expectation = scenario.expectation ? ` (${scenario.expectation})` : '';
      const topSummary = scored
        .slice(0, topK)
        .map(doc => `${doc.id} (${doc.score.toFixed(3)})`)
        .join(', ');
      console.log(`${status} [${scenario.suite}/${scenario.id}]${expectation} ${scenario.question}`);
      console.log(`   Top-${topK}: ${topSummary}`);
      if (!report.passed) {
        for (const reason of report.reasons) {
          console.log(`   ↳ ${reason}`);
        }
      }
    } catch (err) {
      console.error(`Scenario ${scenario.suite}/${scenario.id} failed with error:`, err.message);
      results.push({
        id: scenario.id,
        suite: scenario.suite,
        expectation: scenario.expectation || null,
        passed: false,
        reasons: [err.message],
        topDocs: []
      });
    }
  }

  const summaryBySuite = new Map();
  for (const report of results) {
    const entry = summaryBySuite.get(report.suite) || { passed: 0, total: 0 };
    entry.total += 1;
    if (report.passed) entry.passed += 1;
    summaryBySuite.set(report.suite, entry);
  }

  console.log('');
  console.log('Summary by suite:');
  for (const [suite, stats] of summaryBySuite.entries()) {
    console.log(` - ${suite}: ${stats.passed}/${stats.total} passed`);
  }

  const failed = results.filter(r => !r.passed);
  console.log(`Overall: ${results.length - failed.length} passed / ${results.length} total`);

  // Store evaluation results in database
  try {
    const gitCommit = getGitCommit();
    const deploymentId = getDeploymentId();

    console.log('');
    console.log('Database Storage:');
    console.log('  Attempting to store evaluation results...');
    console.log('  Environment:', process.env.VERCEL_ENV || process.env.NODE_ENV || 'unknown');
    console.log('  DATABASE_URL set:', !!process.env.DATABASE_URL);
    console.log('  POSTGRES_URL set:', !!process.env.POSTGRES_URL);
    console.log('  POSTGRES_URL_NON_POOLING set:', !!process.env.POSTGRES_URL_NON_POOLING);

    if (gitCommit) {
      console.log('  Git commit:', gitCommit.substring(0, 8));
    }
    if (deploymentId) {
      console.log('  Deployment ID:', deploymentId);
    }

    await logEvaluationResults(results, gitCommit, deploymentId);
    console.log('  ✅ Evaluation results stored successfully in database');
  } catch (error) {
    console.error('  ❌ Failed to store evaluation results in database');
    console.error('  Error type:', error.constructor.name);
    console.error('  Error message:', error.message);

    // Log more details in CI environment
    if (process.env.CI || process.env.GITHUB_ACTIONS) {
      console.error('  Full error:', error);
      console.error('  Stack trace:', error.stack);
    }

    // Still don't fail the evaluation if database storage fails
    console.log('  ⚠️ Continuing despite database storage failure...');
  }

  if (failed.length) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Evaluation run failed:', err);
  process.exit(1);
});
