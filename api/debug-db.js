import { getConnection, getCurrentEnvironment } from '../lib/database/connection.js';

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
    const db = getConnection();
    const env = getCurrentEnvironment();

    // Simple count query without any parameters
    const result = await db`
      SELECT
        COUNT(*) as total_queries,
        COUNT(CASE WHEN timestamp >= NOW() - INTERVAL '1 day' THEN 1 END) as recent_queries
      FROM query_logs
      WHERE environment = ${env}
    `;

    const row = result[0] || result.rows?.[0];

    return res.json({
      success: true,
      data: {
        totalQueries: parseInt(row.total_queries) || 0,
        recentQueries: parseInt(row.recent_queries) || 0,
        environment: env
      }
    });

  } catch (error) {
    console.error('Debug DB error:', error);
    return res.status(500).json({
      error: 'Debug query failed',
      details: error.message
    });
  }
}