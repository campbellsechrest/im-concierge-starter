import { getConnection, getCurrentEnvironment } from '../lib/database/connection.js';

const ORIGIN_ALLOWED = process.env.ORIGIN_ALLOWED || '*';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN_ALLOWED);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const db = getConnection();
    const env = getCurrentEnvironment();

    // First, let's see what records exist
    console.log('Checking records in query_logs table...');
    const countResult = await db`
      SELECT COUNT(*) as count FROM query_logs
    `;
    console.log('Count result:', countResult);

    const envCountResult = await db`
      SELECT COUNT(*) as count FROM query_logs WHERE environment = ${env}
    `;
    console.log('Environment count result:', envCountResult);

    // Check recent records
    const recentResult = await db`
      SELECT
        id, timestamp, routing_layer, environment, response_time_ms
      FROM query_logs
      ORDER BY timestamp DESC
      LIMIT 5
    `;
    console.log('Recent records result:', recentResult);

    // Now try the actual stats query
    const statsResult = await db`
      SELECT
        COUNT(*) as total_queries,
        COUNT(CASE WHEN error_message IS NOT NULL THEN 1 END) as error_count,
        AVG(response_time_ms) as avg_response_time,
        routing_layer,
        COUNT(*) as count
      FROM query_logs
      WHERE timestamp >= NOW() - INTERVAL '24 hours'
        AND environment = ${env}
      GROUP BY routing_layer
      ORDER BY count DESC
    `;
    console.log('Stats query result:', statsResult);

    return res.json({
      success: true,
      environment: env,
      totalRecords: countResult.rows?.[0]?.count || countResult[0]?.count || 'unknown',
      envRecords: envCountResult.rows?.[0]?.count || envCountResult[0]?.count || 'unknown',
      recentRecords: recentResult.rows || recentResult,
      statsQuery: statsResult.rows || statsResult,
      debug: {
        countResultStructure: typeof countResult,
        hasRows: !!countResult.rows,
        hasDirectAccess: !!countResult[0]
      }
    });

  } catch (error) {
    console.error('Debug stats error:', error);

    return res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack?.split('\n').slice(0, 10)
    });
  }
}