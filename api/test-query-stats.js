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

    console.log('Starting test-query-stats with environment:', env);

    // Try the exact query from getQueryStats
    let queryResult;
    let queryError;

    try {
      queryResult = await db`
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
      console.log('Query succeeded, result:', queryResult);
    } catch (error) {
      queryError = error;
      console.error('Query failed:', error);
      console.error('Error code:', error.code);
      console.error('Error detail:', error.detail);
      console.error('Error stack:', error.stack);
    }

    // Also try without executeWithRetry wrapper
    let directResult;
    let directError;

    try {
      // Import and call getQueryStats
      const { getQueryStats } = await import('../lib/database/queries.js');
      directResult = await getQueryStats(24);
      console.log('getQueryStats succeeded:', directResult);
    } catch (error) {
      directError = error;
      console.error('getQueryStats failed:', error);
      console.error('Error stack:', error.stack);
    }

    return res.json({
      success: !queryError && !directError,
      environment: env,
      queryTest: {
        success: !queryError,
        result: queryResult ? {
          rows: queryResult.rows || queryResult,
          rowCount: queryResult.rows?.length || queryResult?.length
        } : null,
        error: queryError ? {
          message: queryError.message,
          code: queryError.code,
          detail: queryError.detail
        } : null
      },
      getQueryStatsTest: {
        success: !directError,
        result: directResult,
        error: directError ? {
          message: directError.message,
          stack: directError.stack?.split('\n').slice(0, 5)
        } : null
      }
    });

  } catch (error) {
    console.error('Test query stats error:', error);

    return res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack?.split('\n').slice(0, 10)
    });
  }
}