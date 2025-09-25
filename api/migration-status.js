import { getMigrationStatus, resetMigrationCache } from '../lib/database/migration-manager.js';

const ORIGIN_ALLOWED = process.env.ORIGIN_ALLOWED || '*';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN_ALLOWED);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    // Return current migration status
    const status = getMigrationStatus();

    return res.json({
      success: true,
      migrationStatus: status
    });
  }

  if (req.method === 'POST') {
    // Reset migration cache (for testing/debugging)
    const { action } = req.body || {};

    if (action === 'reset') {
      resetMigrationCache();
      return res.json({
        success: true,
        message: 'Migration cache reset'
      });
    }

    return res.status(400).json({
      error: 'Invalid action. Use {"action": "reset"} to reset cache.'
    });
  }

  return res.status(405).json({ error: 'GET or POST only' });
}