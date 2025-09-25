/**
 * Debug endpoint to check database logging consistency
 * Temporary endpoint for verifying logging fixes
 */

import { getConnection, getCurrentEnvironment } from '../lib/database/connection.js';

export default async function handler(req, res) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const db = getConnection();
    const env = getCurrentEnvironment();

    // Get recent queries from the last 30 minutes
    const cutoffTime = new Date(Date.now() - 30 * 60 * 1000).toISOString();

    console.log(`Checking queries since: ${cutoffTime}`);

    // Get recent query logs
    const queryLogsResult = await db`
      SELECT
        id,
        user_message,
        routing_layer,
        timestamp,
        error_message
      FROM query_logs
      WHERE timestamp >= ${cutoffTime}
        AND environment = ${env}
      ORDER BY timestamp DESC
      LIMIT 10
    `;

    const queries = queryLogsResult.rows || queryLogsResult;

    console.log(`Found ${queries.length} recent queries`);

    // Check each query for related data
    const analysisResults = [];

    for (const query of queries) {
      // Check retrieval details
      const retrievalResult = await db`
        SELECT COUNT(*) as count,
               COALESCE(json_agg(json_build_object(
                 'document_id', document_id,
                 'similarity_score', similarity_score
               ) ORDER BY rank_position) FILTER (WHERE document_id IS NOT NULL), '[]') as details
        FROM retrieval_details
        WHERE query_log_id = ${query.id}
      `;
      const retrievalRow = (retrievalResult.rows || retrievalResult)[0];
      const retrievalCount = parseInt(retrievalRow.count);
      const retrievalDetails = retrievalRow.details;

      // Check routing decisions
      const routingResult = await db`
        SELECT COUNT(*) as count,
               COALESCE(json_agg(json_build_object(
                 'layer', layer,
                 'triggered', triggered,
                 'rule', rule,
                 'intent', intent
               ) ORDER BY execution_order) FILTER (WHERE layer IS NOT NULL), '[]') as decisions
        FROM routing_decisions
        WHERE query_log_id = ${query.id}
      `;
      const routingRow = (routingResult.rows || routingResult)[0];
      const routingCount = parseInt(routingRow.count);
      const routingDecisions = routingRow.decisions;

      analysisResults.push({
        query_id: query.id,
        timestamp: query.timestamp,
        user_message: query.user_message?.substring(0, 100) + (query.user_message?.length > 100 ? '...' : ''),
        routing_layer: query.routing_layer,
        error_message: query.error_message,
        retrieval_details_count: retrievalCount,
        routing_decisions_count: routingCount,
        retrieval_details: retrievalDetails,
        routing_decisions: routingDecisions,
        has_issues: {
          missing_retrieval: query.routing_layer === 'rag' && retrievalCount === 0,
          missing_routing: routingCount === 0
        }
      });
    }

    // Summary stats
    const totalQueries = queries.length;
    const missingRetrievalDetails = analysisResults.filter(r => r.has_issues.missing_retrieval).length;
    const missingRoutingDecisions = analysisResults.filter(r => r.has_issues.missing_routing).length;
    const healthyQueries = analysisResults.filter(r => !r.has_issues.missing_retrieval && !r.has_issues.missing_routing).length;

    const summary = {
      timestamp: new Date().toISOString(),
      environment: env,
      time_window: '30 minutes',
      total_queries: totalQueries,
      healthy_queries: healthyQueries,
      missing_retrieval_details: missingRetrievalDetails,
      missing_routing_decisions: missingRoutingDecisions,
      success_rate: totalQueries > 0 ? ((healthyQueries / totalQueries) * 100).toFixed(1) + '%' : '0%'
    };

    return res.json({
      success: true,
      summary,
      queries: analysisResults
    });

  } catch (error) {
    console.error('Debug logging endpoint failed:', error);

    return res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}