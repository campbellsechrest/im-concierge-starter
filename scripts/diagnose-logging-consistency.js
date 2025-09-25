#!/usr/bin/env node

/**
 * Diagnostic script to analyze current database logging consistency
 * Checks for queries that exist in query_logs but missing from related tables
 */

async function diagnoseConsistency() {
  console.log('🔍 Diagnosing database logging consistency...\n');

  try {
    const { getConnection, getCurrentEnvironment } = await import('../lib/database/connection.js');
    const db = getConnection();
    const env = getCurrentEnvironment();

    // Get recent queries from the last 24 hours
    const cutoffTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    console.log(`📊 Analyzing queries from the last 24 hours in ${env} environment...`);
    console.log(`   Since: ${cutoffTime}\n`);

    // Check query logs
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
      LIMIT 20
    `;

    const queries = queryLogsResult.rows || queryLogsResult;
    console.log(`✅ Found ${queries.length} query log entries\n`);

    if (queries.length === 0) {
      console.log('No recent queries found. Try making a chat request first.');
      return;
    }

    // Check each query for missing related data
    let missingRetrievalDetails = 0;
    let missingRoutingDecisions = 0;
    const problemQueries = [];

    for (const query of queries) {
      // Check retrieval details
      const retrievalResult = await db`
        SELECT COUNT(*) as count
        FROM retrieval_details
        WHERE query_log_id = ${query.id}
      `;
      const retrievalCount = parseInt((retrievalResult.rows || retrievalResult)[0].count);

      // Check routing decisions
      const routingResult = await db`
        SELECT COUNT(*) as count
        FROM routing_decisions
        WHERE query_log_id = ${query.id}
      `;
      const routingCount = parseInt((routingResult.rows || routingResult)[0].count);

      // Identify problems
      const hasRetrievalIssue = query.routing_layer === 'rag' && retrievalCount === 0;
      const hasRoutingIssue = routingCount === 0;

      if (hasRetrievalIssue) missingRetrievalDetails++;
      if (hasRoutingIssue) missingRoutingDecisions++;

      if (hasRetrievalIssue || hasRoutingIssue) {
        problemQueries.push({
          id: query.id,
          timestamp: query.timestamp,
          message: query.user_message?.substring(0, 50) + '...',
          routing_layer: query.routing_layer,
          error_message: query.error_message,
          retrievalCount,
          routingCount,
          issues: [
            hasRetrievalIssue && '🔴 Missing retrieval details',
            hasRoutingIssue && '🔴 Missing routing decisions'
          ].filter(Boolean)
        });
      }
    }

    // Report findings
    console.log('📈 CONSISTENCY ANALYSIS RESULTS:');
    console.log(`   • Total queries analyzed: ${queries.length}`);
    console.log(`   • Queries missing retrieval details: ${missingRetrievalDetails}`);
    console.log(`   • Queries missing routing decisions: ${missingRoutingDecisions}`);
    console.log(`   • Healthy queries: ${queries.length - problemQueries.length}\n`);

    if (problemQueries.length > 0) {
      console.log('🚨 INCONSISTENT QUERIES DETECTED:\n');

      problemQueries.forEach((problem, index) => {
        console.log(`${index + 1}. Query ID: ${problem.id}`);
        console.log(`   Time: ${new Date(problem.timestamp).toLocaleString()}`);
        console.log(`   Message: "${problem.message}"`);
        console.log(`   Routing: ${problem.routing_layer}`);
        console.log(`   Retrieval Details: ${problem.retrievalCount}`);
        console.log(`   Routing Decisions: ${problem.routingCount}`);
        if (problem.error_message) {
          console.log(`   Error: ${problem.error_message}`);
        }
        console.log(`   Issues: ${problem.issues.join(', ')}\n`);
      });

      console.log('💡 RECOMMENDED ACTIONS:');
      console.log('   1. Check Vercel Function logs for specific error messages');
      console.log('   2. Run test-logging-consistency.js in production environment');
      console.log('   3. Monitor future queries to see if fixes resolved the issue\n');

    } else {
      console.log('🎉 All queries have consistent logging! No issues detected.\n');
    }

    // Check for recent error patterns
    const errorQueries = queries.filter(q => q.error_message);
    if (errorQueries.length > 0) {
      console.log(`⚠️  Found ${errorQueries.length} queries with errors:`);
      errorQueries.forEach(q => {
        console.log(`   • ${q.error_message} (${new Date(q.timestamp).toLocaleString()})`);
      });
      console.log('');
    }

    return {
      totalQueries: queries.length,
      missingRetrievalDetails,
      missingRoutingDecisions,
      problemQueries: problemQueries.length,
      healthy: problemQueries.length === 0
    };

  } catch (error) {
    console.error('❌ Diagnostic failed:', error);

    if (error.code === 'missing_connection_string') {
      console.log('\n💡 Database not configured locally. Run this in production environment.');
    } else if (error.message?.includes('relation') || error.message?.includes('table')) {
      console.log('\n💡 Database tables may not exist. Try running: npm run migrate');
    }

    return { success: false, error: error.message };
  }
}

// Run the diagnostic
diagnoseConsistency()
  .then(result => {
    if (result && !result.success) {
      process.exit(1);
    }
    console.log('🏁 Diagnostic complete!');
    process.exit(0);
  })
  .catch(error => {
    console.error('💥 Diagnostic script failed:', error);
    process.exit(1);
  });