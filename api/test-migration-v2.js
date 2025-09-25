import { getMigrationStatus } from '../lib/database/migration-manager-v2.js';

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
    console.log('Testing migration-manager-v2 getMigrationStatus...');

    const status = await getMigrationStatus();

    console.log('Migration status result:', JSON.stringify(status, null, 2));

    return res.json({
      success: true,
      migrationStatus: status,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Test migration v2 error:', error);
    console.error('Error stack:', error.stack);

    return res.status(500).json({
      success: false,
      error: 'Test migration v2 failed',
      details: error.message,
      stack: error.stack
    });
  }
}