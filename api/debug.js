import fs from 'fs';
import path from 'path';
import { testConnection } from '../lib/database/connection.js';

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const ORIGIN_ALLOWED = process.env.ORIGIN_ALLOWED || '*';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN_ALLOWED);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const debug = {
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'unknown',
      vercelEnv: process.env.VERCEL_ENV || 'not-vercel',
      hasOpenAIKey: !!OPENAI_KEY,
      currentWorkingDirectory: process.cwd()
    };

    // Check required files
    const requiredFiles = [
      'data/embeddings.json',
      'data/router-safety.json',
      'data/router-intents.json'
    ];

    debug.files = {};
    for (const file of requiredFiles) {
      const fullPath = path.join(process.cwd(), file);
      debug.files[file] = {
        exists: fs.existsSync(fullPath),
        path: fullPath
      };

      if (debug.files[file].exists) {
        try {
          const stats = fs.statSync(fullPath);
          debug.files[file].size = stats.size;
          debug.files[file].modified = stats.mtime;
        } catch (e) {
          debug.files[file].error = e.message;
        }
      }
    }

    // Test database connection
    try {
      const dbTest = await testConnection(5000);
      debug.database = dbTest;
    } catch (error) {
      debug.database = {
        healthy: false,
        error: error.message,
        stack: error.stack
      };
    }

    // Test basic imports
    try {
      const { logQuery } = await import('../lib/database/queries.js');
      debug.imports = {
        queries: 'success',
        logQuery: typeof logQuery
      };
    } catch (error) {
      debug.imports = {
        queries: 'failed',
        error: error.message,
        stack: error.stack
      };
    }

    // Test OpenAI API
    if (OPENAI_KEY) {
      try {
        const response = await fetch('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${OPENAI_KEY}` }
        });
        debug.openai = {
          status: response.status,
          ok: response.ok,
          headers: Object.fromEntries(response.headers.entries())
        };
      } catch (error) {
        debug.openai = {
          error: error.message
        };
      }
    }

    res.status(200).json(debug);

  } catch (error) {
    res.status(500).json({
      error: 'Debug endpoint failed',
      message: error.message,
      stack: error.stack
    });
  }
}