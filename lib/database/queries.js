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
    const values = retrievalDetails.map((detail, index) => [
      queryLogId,
      detail.documentId,
      detail.documentSection || null,
      detail.similarityScore,
      index + 1, // rank_position (1-indexed)
      detail.scopeFiltered || false
    ]);

    // Use unnest for bulk insert
    await db`
      INSERT INTO retrieval_details (
        query_log_id,
        document_id,
        document_section,
        similarity_score,
        rank_position,
        scope_filtered
      )
      SELECT * FROM unnest(
        ${db.array(values.map(v => v[0]))}, -- query_log_ids
        ${db.array(values.map(v => v[1]))}, -- document_ids
        ${db.array(values.map(v => v[2]))}, -- document_sections
        ${db.array(values.map(v => v[3]))}, -- similarity_scores
        ${db.array(values.map(v => v[4]))}, -- rank_positions
        ${db.array(values.map(v => v[5]))}  -- scope_filtered
      ) AS t(query_log_id, document_id, document_section, similarity_score, rank_position, scope_filtered)
    `;
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
    const values = evalResults.map(result => [
      result.suite,
      result.id,
      result.question || '',
      result.expectation || null,
      result.passed,
      JSON.stringify(result.reasons || []),
      JSON.stringify(result.topDocs || []),
      gitCommit,
      deploymentId,
      getCurrentEnvironment()
    ]);

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
      )
      SELECT * FROM unnest(
        ${db.array(values.map(v => v[0]))}, -- eval_suite
        ${db.array(values.map(v => v[1]))}, -- eval_scenario_id
        ${db.array(values.map(v => v[2]))}, -- question
        ${db.array(values.map(v => v[3]))}, -- expectation
        ${db.array(values.map(v => v[4]))}, -- passed
        ${db.array(values.map(v => v[5]))}, -- reasons
        ${db.array(values.map(v => v[6]))}, -- top_docs
        ${db.array(values.map(v => v[7]))}, -- git_commit
        ${db.array(values.map(v => v[8]))}, -- deployment_id
        ${db.array(values.map(v => v[9]))}  -- environment
      ) AS t(eval_suite, eval_scenario_id, question, expectation, passed, reasons, top_docs, git_commit, deployment_id, environment)
    `;
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
    // Use a single query similar to what works in debug-stats
    const result = await db`
      SELECT
        COUNT(*) as total_queries,
        COUNT(CASE WHEN error_message IS NOT NULL THEN 1 END) as error_count,
        AVG(response_time_ms) as avg_response_time,
        routing_layer,
        COUNT(*) as count
      FROM query_logs
      WHERE timestamp >= NOW() - INTERVAL '1 hour' * ${hours}
        AND environment = ${getCurrentEnvironment()}
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
        const count = parseInt(row.count) || 0;
        const errorCount = parseInt(row.error_count) || 0;
        const avgResponseTime = parseFloat(row.avg_response_time) || 0;

        totalQueries += count;
        totalErrors += errorCount;
        weightedResponseTime += avgResponseTime * count;

        routingBreakdown[row.routing_layer] = {
          count,
          avgResponseTime
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