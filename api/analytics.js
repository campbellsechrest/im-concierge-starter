import { getQueryStats, getEvaluationSummary } from '../lib/database/queries.js';
import { getConnection, testConnection, getCurrentEnvironment } from '../lib/database/connection.js';
import { withAutoMigration } from '../lib/database/api-middleware.js';

const ORIGIN_ALLOWED = process.env.ORIGIN_ALLOWED || '*';

async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN_ALLOWED);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'GET only' });
  }

  const startTime = Date.now();

  try {
    // Test database connection first
    const connectionTest = await testConnection(5000);

    if (!connectionTest.healthy) {
      return res.status(503).json({
        success: false,
        error: 'Database connection failed',
        details: connectionTest.error,
        environment: getCurrentEnvironment()
      });
    }

    const { type, hours = 24, limit = 10 } = req.query;

    // Route to different analytics endpoints
    switch (type) {
      case 'summary':
        return await handleSummaryMetrics(req, res, hours);

      case 'layers':
        return await handleLayerBreakdown(req, res, hours);

      case 'costs':
        return await handleCostAnalysis(req, res, hours);

      case 'performance':
        return await handlePerformanceMetrics(req, res, hours);

      case 'safety':
        return await handleSafetyMetrics(req, res, hours);

      case 'trace':
        return await handleQueryTrace(req, res);

      case 'evaluation':
        return await handleEvaluationSummary(req, res, limit);

      default:
        // Default: return overview of all metrics
        return await handleOverview(req, res, hours);
    }

  } catch (error) {
    console.error('Analytics endpoint error:', error);

    return res.status(500).json({
      success: false,
      error: 'Analytics endpoint failed',
      details: error.message,
      environment: getCurrentEnvironment(),
      responseTimeMs: Date.now() - startTime
    });
  }
}

// Summary metrics for dashboard overview
async function handleSummaryMetrics(req, res, hours) {
  const db = getConnection();
  const env = getCurrentEnvironment();
  const hoursInt = parseInt(hours) || 24;

  // Calculate timestamp parameter to avoid INTERVAL issues
  const cutoffTime = new Date(Date.now() - hoursInt * 60 * 60 * 1000).toISOString();

  const result = await db`
    SELECT
      COUNT(*) as total_queries,
      COUNT(CASE WHEN error_message IS NOT NULL THEN 1 END) as error_count,
      AVG(response_time_ms) as avg_response_time,
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms) as p95_response_time,
      SUM(estimated_cost) as total_cost,
      SUM(api_calls_count) as total_api_calls,
      SUM(embedding_tokens) as total_embedding_tokens,
      SUM(chat_completion_tokens) as total_chat_tokens
    FROM query_logs
    WHERE timestamp >= ${cutoffTime}
      AND environment = ${env}
  `;

  const row = result[0] || result.rows?.[0];

  return res.json({
    success: true,
    data: {
      totalQueries: parseInt(row.total_queries) || 0,
      errorCount: parseInt(row.error_count) || 0,
      errorRate: row.total_queries > 0 ? (parseInt(row.error_count) / parseInt(row.total_queries) * 100).toFixed(2) : 0,
      avgResponseTime: Math.round(parseFloat(row.avg_response_time) || 0),
      p95ResponseTime: Math.round(parseFloat(row.p95_response_time) || 0),
      totalCost: parseFloat(row.total_cost) || 0,
      totalApiCalls: parseInt(row.total_api_calls) || 0,
      totalEmbeddingTokens: parseInt(row.total_embedding_tokens) || 0,
      totalChatTokens: parseInt(row.total_chat_tokens) || 0,
      timeRange: `${hoursInt} hours`,
      environment: env
    }
  });
}

// Layer breakdown for routing analysis
async function handleLayerBreakdown(req, res, hours) {
  const db = getConnection();
  const env = getCurrentEnvironment();
  const hoursInt = parseInt(hours) || 24;
  const cutoffTime = new Date(Date.now() - hoursInt * 60 * 60 * 1000).toISOString();

  const result = await db`
    SELECT
      routing_layer,
      COUNT(*) as query_count,
      AVG(response_time_ms) as avg_response_time,
      SUM(estimated_cost) as layer_cost,
      COUNT(CASE WHEN error_message IS NOT NULL THEN 1 END) as error_count
    FROM query_logs
    WHERE timestamp >= ${cutoffTime}
      AND environment = ${env}
      AND routing_layer IS NOT NULL
    GROUP BY routing_layer
    ORDER BY query_count DESC
  `;

  const rows = result.rows || result;
  const layerBreakdown = rows.map(row => ({
    layer: row.routing_layer,
    queryCount: parseInt(row.query_count),
    avgResponseTime: Math.round(parseFloat(row.avg_response_time) || 0),
    totalCost: parseFloat(row.layer_cost) || 0,
    errorCount: parseInt(row.error_count) || 0,
    errorRate: row.query_count > 0 ? (parseInt(row.error_count) / parseInt(row.query_count) * 100).toFixed(2) : 0
  }));

  return res.json({
    success: true,
    data: {
      layers: layerBreakdown,
      timeRange: `${hoursInt} hours`,
      environment: env
    }
  });
}

// Cost analysis breakdown
async function handleCostAnalysis(req, res, hours) {
  const db = getConnection();
  const env = getCurrentEnvironment();
  const hoursInt = parseInt(hours) || 24;
  const cutoffTime = new Date(Date.now() - hoursInt * 60 * 60 * 1000).toISOString();

  const result = await db`
    SELECT
      routing_layer,
      SUM(estimated_cost) as total_cost,
      SUM(embedding_tokens) as embedding_tokens,
      SUM(chat_completion_tokens) as completion_tokens,
      SUM(api_calls_count) as api_calls,
      COUNT(*) as queries,
      AVG(estimated_cost) as avg_cost_per_query
    FROM query_logs
    WHERE timestamp >= ${cutoffTime}
      AND environment = ${env}
      AND estimated_cost IS NOT NULL
    GROUP BY routing_layer
    ORDER BY total_cost DESC
  `;

  const rows = result.rows || result;
  const costBreakdown = rows.map(row => ({
    layer: row.routing_layer,
    totalCost: parseFloat(row.total_cost) || 0,
    embeddingTokens: parseInt(row.embedding_tokens) || 0,
    completionTokens: parseInt(row.completion_tokens) || 0,
    apiCalls: parseInt(row.api_calls) || 0,
    queries: parseInt(row.queries),
    avgCostPerQuery: parseFloat(row.avg_cost_per_query) || 0
  }));

  return res.json({
    success: true,
    data: {
      costByLayer: costBreakdown,
      timeRange: `${hoursInt} hours`,
      environment: env
    }
  });
}

// Performance metrics with timing breakdown
async function handlePerformanceMetrics(req, res, hours) {
  const db = getConnection();
  const env = getCurrentEnvironment();
  const hoursInt = parseInt(hours) || 24;
  const cutoffTime = new Date(Date.now() - hoursInt * 60 * 60 * 1000).toISOString();

  // Get routing decision performance
  const perfResult = await db`
    SELECT
      rd.layer,
      AVG(rd.execution_time_ms) as avg_execution_time,
      PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY rd.execution_time_ms) as p95_execution_time,
      AVG(rd.api_latency_ms) as avg_api_latency,
      COUNT(*) as decision_count
    FROM routing_decisions rd
    JOIN query_logs ql ON rd.query_log_id = ql.id
    WHERE ql.timestamp >= ${cutoffTime}
      AND ql.environment = ${env}
      AND rd.execution_time_ms IS NOT NULL
    GROUP BY rd.layer
    ORDER BY avg_execution_time DESC
  `;

  const perfRows = perfResult.rows || perfResult;
  const performanceByLayer = perfRows.map(row => ({
    layer: row.layer,
    avgExecutionTime: Math.round(parseFloat(row.avg_execution_time) || 0),
    p95ExecutionTime: Math.round(parseFloat(row.p95_execution_time) || 0),
    avgApiLatency: Math.round(parseFloat(row.avg_api_latency) || 0),
    decisionCount: parseInt(row.decision_count)
  }));

  return res.json({
    success: true,
    data: {
      performanceByLayer,
      timeRange: `${hoursInt} hours`,
      environment: env
    }
  });
}

// Safety metrics and refusal analysis
async function handleSafetyMetrics(req, res, hours) {
  const db = getConnection();
  const env = getCurrentEnvironment();
  const hoursInt = parseInt(hours) || 24;
  const cutoffTime = new Date(Date.now() - hoursInt * 60 * 60 * 1000).toISOString();

  const result = await db`
    SELECT
      routing_category,
      routing_rule,
      COUNT(*) as refusal_count,
      AVG(response_time_ms) as avg_response_time
    FROM query_logs
    WHERE timestamp >= ${cutoffTime}
      AND environment = ${env}
      AND routing_layer IN ('safety-regex', 'safety-embed')
    GROUP BY routing_category, routing_rule
    ORDER BY refusal_count DESC
  `;

  const rows = result.rows || result;
  const safetyBreakdown = rows.map(row => ({
    category: row.routing_category,
    rule: row.routing_rule,
    refusalCount: parseInt(row.refusal_count),
    avgResponseTime: Math.round(parseFloat(row.avg_response_time) || 0)
  }));

  return res.json({
    success: true,
    data: {
      safetyRefusals: safetyBreakdown,
      totalRefusals: safetyBreakdown.reduce((sum, item) => sum + item.refusalCount, 0),
      timeRange: `${hoursInt} hours`,
      environment: env
    }
  });
}

// Individual query trace for detailed analysis
async function handleQueryTrace(req, res) {
  const { queryId } = req.query;

  if (!queryId) {
    return res.status(400).json({ error: 'queryId parameter required' });
  }

  const db = getConnection();

  // Get query details
  const queryResult = await db`
    SELECT * FROM query_logs WHERE id = ${queryId}
  `;

  const query = queryResult[0] || queryResult.rows?.[0];
  if (!query) {
    return res.status(404).json({ error: 'Query not found' });
  }

  // Get routing decisions
  const decisionsResult = await db`
    SELECT * FROM routing_decisions
    WHERE query_log_id = ${queryId}
    ORDER BY execution_order
  `;

  const decisions = decisionsResult.rows || decisionsResult;

  // Get retrieval details
  const retrievalResult = await db`
    SELECT * FROM retrieval_details
    WHERE query_log_id = ${queryId}
    ORDER BY rank_position
  `;

  const retrievalDetails = retrievalResult.rows || retrievalResult;

  return res.json({
    success: true,
    data: {
      query: {
        id: query.id,
        userMessage: query.user_message,
        normalizedMessage: query.normalized_message,
        responseAnswer: query.response_answer,
        responseTime: query.response_time_ms,
        estimatedCost: query.estimated_cost,
        apiCalls: query.api_calls_count,
        embeddingTokens: query.embedding_tokens,
        chatTokens: query.chat_completion_tokens,
        timestamp: query.timestamp,
        environment: query.environment,
        errorMessage: query.error_message
      },
      routingDecisions: decisions.map(d => ({
        layer: d.layer,
        rule: d.rule,
        intent: d.intent,
        category: d.category,
        score: d.score,
        triggered: d.triggered,
        executionOrder: d.execution_order,
        executionTime: d.execution_time_ms,
        apiLatency: d.api_latency_ms,
        riskTokenCount: d.risk_token_count,
        hasProductContext: d.has_product_context,
        embeddingScore: d.embedding_score
      })),
      retrievalDetails: retrievalDetails.map(r => ({
        documentId: r.document_id,
        documentSection: r.document_section,
        similarityScore: r.similarity_score,
        rankPosition: r.rank_position,
        scopeFiltered: r.scope_filtered
      }))
    }
  });
}

// Evaluation summary
async function handleEvaluationSummary(req, res, limit) {
  try {
    const summary = await getEvaluationSummary(parseInt(limit) || 10);

    return res.json({
      success: true,
      data: {
        evaluationRuns: summary,
        environment: getCurrentEnvironment()
      }
    });
  } catch (error) {
    console.error('Evaluation summary error:', error);
    return res.status(500).json({
      error: 'Failed to fetch evaluation summary',
      details: error.message
    });
  }
}

// Overview combining key metrics
async function handleOverview(req, res, hours) {
  try {
    const summaryResponse = await handleSummaryMetrics({ query: { hours } }, { json: data => data }, hours);
    const layersResponse = await handleLayerBreakdown({ query: { hours } }, { json: data => data }, hours);

    // Get recent queries for activity feed
    const db = getConnection();
    const env = getCurrentEnvironment();

    const recentQueries = await db`
      SELECT
        id,
        user_message,
        routing_layer,
        response_time_ms,
        estimated_cost,
        timestamp,
        error_message IS NOT NULL as has_error
      FROM query_logs
      WHERE environment = ${env}
      ORDER BY timestamp DESC
      LIMIT 10
    `;

    const queries = (recentQueries.rows || recentQueries).map(q => ({
      id: q.id,
      userMessage: q.user_message?.substring(0, 100) + (q.user_message?.length > 100 ? '...' : ''),
      routingLayer: q.routing_layer,
      responseTime: q.response_time_ms,
      cost: q.estimated_cost,
      timestamp: q.timestamp,
      hasError: q.has_error
    }));

    return res.json({
      success: true,
      data: {
        summary: summaryResponse.data,
        layerBreakdown: layersResponse.data.layers,
        recentQueries: queries,
        environment: env
      }
    });
  } catch (error) {
    console.error('Overview error:', error);
    return res.status(500).json({
      error: 'Failed to fetch overview',
      details: error.message
    });
  }
}

// Export handler wrapped with auto-migration
export default withAutoMigration(handler, {
  requireMigrations: true,
  migrationTimeout: 10000 // 10 seconds timeout for analytics API
});