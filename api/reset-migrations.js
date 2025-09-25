import { getConnection, getCurrentEnvironment } from '../lib/database/connection.js';

const ORIGIN_ALLOWED = process.env.ORIGIN_ALLOWED || '*';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN_ALLOWED);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  try {
    const db = getConnection();
    const { version } = req.body || {};

    if (version) {
      // Reset specific migration version
      const result = await db`
        DELETE FROM migration_history
        WHERE version = ${version}
      `;

      return res.json({
        success: true,
        message: `Reset migration: ${version}`,
        environment: getCurrentEnvironment()
      });
    } else {
      // Reset all failed migrations
      const result = await db`
        DELETE FROM migration_history
        WHERE status = 'failed'
      `;

      const deletedCount = result.count || (result.rowCount !== undefined ? result.rowCount : 0);

      return res.json({
        success: true,
        message: `Reset ${deletedCount} failed migrations`,
        environment: getCurrentEnvironment()
      });
    }

  } catch (error) {
    console.error('Reset migrations error:', error);
    return res.status(500).json({
      success: false,
      error: 'Reset migrations failed',
      details: error.message,
      environment: getCurrentEnvironment()
    });
  }
}