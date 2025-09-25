import { getConnection, testConnection, getCurrentEnvironment } from '../lib/database/connection.js';

const ORIGIN_ALLOWED = process.env.ORIGIN_ALLOWED || '*';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN_ALLOWED);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'GET only' });
  }

  const startTime = Date.now();

  try {
    // Test database connection
    const connectionTest = await testConnection(5000);
    if (!connectionTest.healthy) {
      return res.status(503).json({
        success: false,
        error: 'Database connection failed',
        details: connectionTest.error,
        environment: getCurrentEnvironment(),
        responseTimeMs: Date.now() - startTime
      });
    }

    const db = getConnection();
    const env = getCurrentEnvironment();

    // Validate schema by checking required columns exist
    const schemaCheck = await db`
      SELECT
        table_name,
        column_name,
        data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('query_logs', 'routing_decisions', 'eval_results', 'retrieval_details')
        AND column_name IN (
          'embedding_tokens', 'chat_completion_tokens', 'estimated_cost', 'api_calls_count',
          'execution_time_ms', 'api_latency_ms'
        )
      ORDER BY table_name, column_name
    `;

    const expectedColumns = [
      'query_logs.embedding_tokens',
      'query_logs.chat_completion_tokens',
      'query_logs.estimated_cost',
      'query_logs.api_calls_count',
      'routing_decisions.execution_time_ms',
      'routing_decisions.api_latency_ms'
    ];

    const foundColumns = (schemaCheck.rows || schemaCheck).map(row =>
      `${row.table_name}.${row.column_name}`
    );

    const missingColumns = expectedColumns.filter(col => !foundColumns.includes(col));

    // Check recent data
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const dataCheck = await db`
      SELECT
        COUNT(*) as total_queries,
        COUNT(CASE WHEN timestamp >= ${oneDayAgo} THEN 1 END) as recent_queries,
        COUNT(CASE WHEN estimated_cost IS NOT NULL THEN 1 END) as queries_with_cost
      FROM query_logs
      WHERE environment = ${env}
    `;

    const dataStats = dataCheck[0] || dataCheck.rows?.[0];

    return res.json({
      success: true,
      health: {
        database: 'healthy',
        schema: missingColumns.length === 0 ? 'complete' : 'incomplete',
        data: 'accessible'
      },
      details: {
        connectionLatency: connectionTest.latency,
        environment: env,
        schema: {
          expectedColumns: expectedColumns.length,
          foundColumns: foundColumns.length,
          missingColumns
        },
        data: {
          totalQueries: parseInt(dataStats?.total_queries) || 0,
          recentQueries: parseInt(dataStats?.recent_queries) || 0,
          queriesWithCost: parseInt(dataStats?.queries_with_cost) || 0
        },
        responseTimeMs: Date.now() - startTime
      }
    });

  } catch (error) {
    console.error('Health check error:', error);

    return res.status(500).json({
      success: false,
      health: {
        database: 'error',
        schema: 'unknown',
        data: 'unknown'
      },
      error: 'Health check failed',
      details: error.message,
      environment: getCurrentEnvironment(),
      responseTimeMs: Date.now() - startTime
    });
  }
}