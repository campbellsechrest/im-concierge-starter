import { getConnection, executeWithRetry, getCurrentEnvironment } from './connection.js';

/**
 * Log a chat query and response to the database.
 * Called asynchronously after response is sent to user.
 *
 * @param {Object} queryData - Query and response data
 * @param {string} queryData.userMessage - Original user message
 * @param {string} queryData.normalizedMessage - Normalized message used for processing
 * @param {string} queryData.responseAnswer - Generated response
 * @param {Object} queryData.routing - Routing metadata
 * @param {Array} queryData.sources - Source documents with scores
 * @param {number} queryData.responseTimeMs - Response time in milliseconds
 * @param {Object} [queryData.openai] - OpenAI request metadata
 * @param {string} [queryData.userSessionId] - User session identifier
 * @param {string} [queryData.correlationId] - Request correlation ID for tracing
 * @param {string} [queryData.errorMessage] - Error message if any
 * @returns {Promise<string>} Query log ID
 */
export async function logQuery(queryData) {
  const db = getConnection();

  return executeWithRetry(async () => {
    const result = await db`
      INSERT INTO query_logs (
        user_message,
        normalized_message,
        response_answer,
        routing_layer,
        routing_rule,
        routing_intent,
        routing_category,
        routing_score,
        sources,
        response_time_ms,
        user_session_id,
        openai_model,
        openai_request_id,
        total_tokens,
        embedding_cache_hit,
        environment,
        error_message,
        api_version
      ) VALUES (
        ${queryData.userMessage},
        ${queryData.normalizedMessage},
        ${queryData.responseAnswer},
        ${queryData.routing?.layer},
        ${queryData.routing?.rule || null},
        ${queryData.routing?.intent || null},
        ${queryData.routing?.category || null},
        ${queryData.routing?.score || null},
        ${JSON.stringify(queryData.sources || [])},
        ${queryData.responseTimeMs},
        ${queryData.userSessionId || null},
        ${queryData.openai?.model || null},
        ${queryData.openai?.requestId || null},
        ${queryData.openai?.totalTokens || null},
        ${queryData.embeddingCacheHit || false},
        ${getCurrentEnvironment()},
        ${queryData.errorMessage || null},
        ${queryData.apiVersion || '1.0'}
      )
      RETURNING id
    `;

    // Handle both array-style and rows-style results from Vercel Postgres
    const row = result[0] || result.rows?.[0];
    if (!row || !row.id) {
      throw new Error(`No ID returned from insert: ${JSON.stringify(result)}`);
    }
    return row.id;
  });
}

/**
 * Log detailed document retrieval information for a query.
 * Stores similarity scores and ranking for each document retrieved.
 *
 * @param {string} queryLogId - ID of the query log record
 * @param {Array} retrievalDetails - Array of document retrieval details
 * @returns {Promise<void>}
 */
export async function logRetrievalDetails(queryLogId, retrievalDetails) {
  const db = getConnection();

  if (!retrievalDetails || retrievalDetails.length === 0) {
    return;
  }

  return executeWithRetry(async () => {
    // Insert each retrieval detail individually to avoid db.array() issues
    for (let index = 0; index < retrievalDetails.length; index++) {
      const detail = retrievalDetails[index];
      await db`
        INSERT INTO retrieval_details (
          query_log_id,
          document_id,
          document_section,
          similarity_score,
          rank_position,
          scope_filtered
        ) VALUES (
          ${queryLogId},
          ${detail.documentId},
          ${detail.documentSection || null},
          ${detail.similarityScore},
          ${index + 1},
          ${detail.scopeFiltered || false}
        )
      `;
    }
  });
}

/**
 * Store evaluation test results in the database.
 * Called from the evaluation harness to track performance over time.
 *
 * @param {Array} evalResults - Array of evaluation results
 * @param {string} [gitCommit] - Git commit hash
 * @param {string} [deploymentId] - Deployment identifier
 * @returns {Promise<void>}
 */
export async function logEvaluationResults(evalResults, gitCommit = null, deploymentId = null) {
  const db = getConnection();

  if (!evalResults || evalResults.length === 0) {
    return;
  }

  return executeWithRetry(async () => {
    // Insert each evaluation result individually to avoid db.array() issues
    for (const result of evalResults) {
      await db`
        INSERT INTO eval_results (
          eval_suite,
          eval_scenario_id,
          question,
          expectation,
          passed,
          reasons,
          top_docs,
          git_commit,
          deployment_id,
          environment
        ) VALUES (
          ${result.suite},
          ${result.id},
          ${result.question || ''},
          ${result.expectation || null},
          ${result.passed},
          ${JSON.stringify(result.reasons || [])},
          ${JSON.stringify(result.topDocs || [])},
          ${gitCommit},
          ${deploymentId},
          ${getCurrentEnvironment()}
        )
      `;
    }
  });
}

/**
 * Log routing decisions for a query to enable detailed routing analysis.
 * Stores decision trace showing how query flowed through routing layers.
 *
 * @param {string} queryLogId - ID of the query log record
 * @param {Array} decisionTrace - Array of routing decisions
 * @returns {Promise<void>}
 */
export async function logRoutingDecisions(queryLogId, decisionTrace) {
  const db = getConnection();

  if (!decisionTrace || decisionTrace.length === 0) {
    return;
  }

  return executeWithRetry(async () => {
    // Insert each routing decision individually
    for (let index = 0; index < decisionTrace.length; index++) {
      const decision = decisionTrace[index];
      await db`
        INSERT INTO routing_decisions (
          query_log_id,
          layer,
          rule,
          intent,
          category,
          score,
          triggered,
          execution_order,
          risk_token_count,
          has_product_context,
          embedding_score
        ) VALUES (
          ${queryLogId},
          ${decision.layer},
          ${decision.rule || null},
          ${decision.intent || null},
          ${decision.category || null},
          ${decision.score || null},
          ${decision.triggered},
          ${index + 1},
          ${decision.riskTokenCount || null},
          ${decision.hasProductContext || null},
          ${decision.embeddingScore || null}
        )
      `;
    }
  });
}

/**
 * Get recent query statistics for monitoring and health checks.
 *
 * @param {number} [hours=24] - Number of hours to look back
 * @returns {Promise<Object>} Query statistics
 */
export async function getQueryStats(hours = 24) {
  const db = getConnection();

  return executeWithRetry(async () => {
    // Use the EXACT pattern from debug-stats.js that we know works
    const env = getCurrentEnvironment();

    // Match the exact working query from debug-stats.js
    const result = await db`
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

    // Handle both array-style and rows-style results from Vercel Postgres
    const rows = result.rows || result;

    // Calculate overall stats from the routing breakdown
    let totalQueries = 0;
    let totalErrors = 0;
    let weightedResponseTime = 0;
    const routingBreakdown = {};

    for (const row of rows) {
      if (row.routing_layer) {
        // Use the same column names as in the query
        const count = parseInt(row.count) || 0;
        const errors = parseInt(row.error_count) || 0;
        const avgResponseTime = parseFloat(row.avg_response_time) || 0;

        totalQueries += count;
        totalErrors += errors;
        weightedResponseTime += avgResponseTime * count;

        routingBreakdown[row.routing_layer] = {
          count,
          avgResponseTime,
          errors
        };
      }
    }

    const stats = {
      totalQueries,
      errorCount: totalErrors,
      avgResponseTime: totalQueries > 0 ? weightedResponseTime / totalQueries : 0,
      routingLayersUsed: Object.keys(routingBreakdown).length,
      routingBreakdown
    };

    return stats;
  });
}

/**
 * Get recent evaluation results summary.
 *
 * @param {number} [limit=10] - Number of recent evaluation runs to include
 * @returns {Promise<Object>} Evaluation summary
 */
export async function getEvaluationSummary(limit = 10) {
  const db = getConnection();

  return executeWithRetry(async () => {
    const result = await db`
      SELECT
        eval_suite,
        git_commit,
        timestamp,
        COUNT(*) as total_tests,
        COUNT(CASE WHEN passed THEN 1 END) as passed_tests,
        ROUND(COUNT(CASE WHEN passed THEN 1 END) * 100.0 / COUNT(*), 1) as pass_rate
      FROM eval_results
      WHERE environment = ${getCurrentEnvironment()}
      ORDER BY timestamp DESC
      LIMIT ${limit}
    `;

    // Handle both array-style and rows-style results from Vercel Postgres
    const rows = result.rows || result;

    return rows.map(row => ({
      evalSuite: row.eval_suite,
      gitCommit: row.git_commit,
      timestamp: row.timestamp,
      totalTests: parseInt(row.total_tests),
      passedTests: parseInt(row.passed_tests),
      passRate: parseFloat(row.pass_rate)
    }));
  });
}

/**
 * Clean up old logs based on retention policy.
 * Called periodically to manage database size.
 *
 * @param {number} [retentionDays=90] - Number of days to retain logs
 * @returns {Promise<{queryLogs: number, evalResults: number}>} Number of records deleted
 */
export async function cleanupOldLogs(retentionDays = 90) {
  const db = getConnection();

  return executeWithRetry(async () => {
    const queryLogsDeleted = await db`
      DELETE FROM query_logs
      WHERE timestamp < NOW() - INTERVAL '${retentionDays} days'
    `;

    const evalResultsDeleted = await db`
      DELETE FROM eval_results
      WHERE timestamp < NOW() - INTERVAL '${retentionDays} days'
    `;

    return {
      queryLogs: queryLogsDeleted.count,
      evalResults: evalResultsDeleted.count
    };
  });
}