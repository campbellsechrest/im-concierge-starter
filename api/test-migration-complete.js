import { ensureMigrationsComplete } from '../lib/database/migration-manager-v2.js';

const ORIGIN_ALLOWED = process.env.ORIGIN_ALLOWED || '*';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN_ALLOWED);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'GET only' });
  }

  try {
    console.log('Testing ensureMigrationsComplete...');

    const startTime = Date.now();
    const result = await ensureMigrationsComplete(10000); // 10 second timeout
    const duration = Date.now() - startTime;

    console.log('ensureMigrationsComplete result:', result, 'duration:', duration);

    return res.json({
      success: true,
      migrationsComplete: result,
      durationMs: duration,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Test migration complete error:', error);

    return res.status(500).json({
      success: false,
      error: 'Test migration complete failed',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
}