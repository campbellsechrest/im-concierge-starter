#!/usr/bin/env node

import { config } from 'dotenv';
import { getConnection, testConnection, getCurrentEnvironment } from '../lib/database/connection.js';

// Load environment variables
config();

const ORIGIN_ALLOWED = process.env.ORIGIN_ALLOWED || '*';

async function diagnoseConsistency() {
  console.log('='.repeat(80));
  console.log('DATABASE CONSISTENCY DIAGNOSTIC TOOL');
  console.log('='.repeat(80));
  console.log(`Environment: ${getCurrentEnvironment()}`);
  console.log(`Timestamp: ${new Date().toISOString()}\n`);

  const db = getConnection();

  try {
    // Test connection first
    console.log('Testing database connection...');
    const connTest = await testConnection();
    if (!connTest.healthy) {
      console.error('❌ Database connection failed:', connTest.error);
      process.exit(1);
    }
    console.log(`✅ Database connected (latency: ${connTest.latency}ms)\n`);

    // 1. Check table existence
    console.log('1. CHECKING TABLE EXISTENCE');
    console.log('-'.repeat(40));

    const tables = await db`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename IN ('query_logs', 'routing_decisions', 'retrieval_details')
      ORDER BY tablename
    `;

    const tableList = (tables.rows || tables).map(t => t.tablename);
    console.log('Found tables:', tableList.join(', ') || 'NONE');

    const missingTables = ['query_logs', 'routing_decisions', 'retrieval_details']
      .filter(t => !tableList.includes(t));

    if (missingTables.length > 0) {
      console.error('❌ Missing tables:', missingTables.join(', '));
      console.log('\nRun migrations with: npm run migrate or call /api/migrate endpoint\n');
    } else {
      console.log('✅ All required tables exist\n');
    }

    // 2. Check foreign key constraints
    console.log('2. CHECKING FOREIGN KEY CONSTRAINTS');
    console.log('-'.repeat(40));

    const constraints = await db`
      SELECT
        tc.table_name,
        tc.constraint_name,
        tc.constraint_type,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      LEFT JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.table_schema = 'public'
        AND tc.table_name IN ('routing_decisions', 'retrieval_details')
        AND tc.constraint_type = 'FOREIGN KEY'
    `;

    const constraintsList = constraints.rows || constraints;
    if (constraintsList.length > 0) {
      console.log('Foreign key relationships:');
      constraintsList.forEach(c => {
        console.log(`  - ${c.table_name}.${c.column_name} -> ${c.foreign_table_name}.${c.foreign_column_name}`);
      });
    } else {
      console.log('❌ No foreign key constraints found!');
    }
    console.log();

    // 3. Analyze recent data patterns
    console.log('3. RECENT DATA ANALYSIS (Last 24 hours)');
    console.log('-'.repeat(40));

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Count queries by routing layer
    const queryStats = await db`
      SELECT
        routing_layer,
        COUNT(*) as count,
        MAX(timestamp) as last_query
      FROM query_logs
      WHERE timestamp >= ${oneDayAgo}
      GROUP BY routing_layer
      ORDER BY count DESC
    `;

    const queryRows = queryStats.rows || queryStats;
    const totalQueries = queryRows.reduce((sum, row) => sum + parseInt(row.count), 0);

    console.log(`Total queries logged: ${totalQueries}`);
    if (queryRows.length > 0) {
      console.log('\nBreakdown by routing layer:');
      queryRows.forEach(row => {
        console.log(`  - ${row.routing_layer || 'null'}: ${row.count} queries (last: ${new Date(row.last_query).toLocaleString()})`);
      });
    }

    // Check routing_decisions population
    const routingDecisionStats = await db`
      SELECT
        COUNT(DISTINCT rd.query_log_id) as queries_with_decisions,
        COUNT(*) as total_decisions
      FROM routing_decisions rd
      JOIN query_logs ql ON ql.id = rd.query_log_id
      WHERE ql.timestamp >= ${oneDayAgo}
    `;

    const rdRow = (routingDecisionStats.rows || routingDecisionStats)[0];
    const queriesWithDecisions = parseInt(rdRow?.queries_with_decisions) || 0;
    const totalDecisions = parseInt(rdRow?.total_decisions) || 0;

    console.log(`\nRouting decisions:`);
    console.log(`  - Queries with routing decisions: ${queriesWithDecisions}/${totalQueries} (${((queriesWithDecisions/totalQueries)*100).toFixed(1)}%)`);
    console.log(`  - Total routing decisions: ${totalDecisions}`);
    console.log(`  - Avg decisions per query: ${totalQueries > 0 ? (totalDecisions/queriesWithDecisions).toFixed(1) : 0}`);

    // Check retrieval_details population
    const retrievalStats = await db`
      SELECT
        COUNT(DISTINCT rd.query_log_id) as queries_with_retrievals,
        COUNT(*) as total_retrievals,
        AVG(rd.similarity_score) as avg_similarity
      FROM retrieval_details rd
      JOIN query_logs ql ON ql.id = rd.query_log_id
      WHERE ql.timestamp >= ${oneDayAgo}
    `;

    const retRow = (retrievalStats.rows || retrievalStats)[0];
    const queriesWithRetrievals = parseInt(retRow?.queries_with_retrievals) || 0;
    const totalRetrievals = parseInt(retRow?.total_retrievals) || 0;
    const avgSimilarity = parseFloat(retRow?.avg_similarity) || 0;

    console.log(`\nRetrieval details:`);
    console.log(`  - Queries with retrieval details: ${queriesWithRetrievals}/${totalQueries} (${((queriesWithRetrievals/totalQueries)*100).toFixed(1)}%)`);
    console.log(`  - Total document retrievals: ${totalRetrievals}`);
    console.log(`  - Avg documents per query: ${queriesWithRetrievals > 0 ? (totalRetrievals/queriesWithRetrievals).toFixed(1) : 0}`);
    console.log(`  - Avg similarity score: ${avgSimilarity.toFixed(3)}`);

    // 4. Identify the consistency problem
    console.log('\n4. CONSISTENCY ANALYSIS');
    console.log('-'.repeat(40));

    // Find queries without routing decisions
    const missingRoutingDecisions = await db`
      SELECT
        ql.id,
        ql.timestamp,
        ql.routing_layer,
        ql.user_message,
        ql.response_time_ms
      FROM query_logs ql
      LEFT JOIN routing_decisions rd ON ql.id = rd.query_log_id
      WHERE ql.timestamp >= ${oneDayAgo}
        AND rd.id IS NULL
      ORDER BY ql.timestamp DESC
      LIMIT 10
    `;

    const missingRDRows = missingRoutingDecisions.rows || missingRoutingDecisions;
    if (missingRDRows.length > 0) {
      console.log(`\n❌ Found ${missingRDRows.length} recent queries WITHOUT routing decisions:`);
      missingRDRows.slice(0, 5).forEach(row => {
        console.log(`  - ${row.timestamp}: [${row.routing_layer}] "${row.user_message?.substring(0, 50)}..."`);
      });
    }

    // Find queries without retrieval details (only for RAG layer)
    const missingRetrievalDetails = await db`
      SELECT
        ql.id,
        ql.timestamp,
        ql.routing_layer,
        ql.user_message
      FROM query_logs ql
      LEFT JOIN retrieval_details rd ON ql.id = rd.query_log_id
      WHERE ql.timestamp >= ${oneDayAgo}
        AND ql.routing_layer = 'rag'
        AND rd.id IS NULL
      ORDER BY ql.timestamp DESC
      LIMIT 10
    `;

    const missingRetRows = missingRetrievalDetails.rows || missingRetrievalDetails;
    if (missingRetRows.length > 0) {
      console.log(`\n❌ Found ${missingRetRows.length} RAG queries WITHOUT retrieval details:`);
      missingRetRows.slice(0, 5).forEach(row => {
        console.log(`  - ${row.timestamp}: "${row.user_message?.substring(0, 50)}..."`);
      });
    }

    // 5. Check for errors in query_logs
    console.log('\n5. ERROR ANALYSIS');
    console.log('-'.repeat(40));

    const errorQueries = await db`
      SELECT
        COUNT(*) as error_count,
        COUNT(CASE WHEN error_message LIKE '%relation%does not exist%' THEN 1 END) as table_errors,
        COUNT(CASE WHEN error_message LIKE '%permission%' THEN 1 END) as permission_errors,
        COUNT(CASE WHEN error_message NOT LIKE '%relation%does not exist%'
                   AND error_message NOT LIKE '%permission%' THEN 1 END) as other_errors
      FROM query_logs
      WHERE timestamp >= ${oneDayAgo}
        AND error_message IS NOT NULL
    `;

    const errorRow = (errorQueries.rows || errorQueries)[0];
    const errorCount = parseInt(errorRow?.error_count) || 0;

    if (errorCount > 0) {
      console.log(`Found ${errorCount} queries with errors:`);
      console.log(`  - Table not exist errors: ${errorRow.table_errors}`);
      console.log(`  - Permission errors: ${errorRow.permission_errors}`);
      console.log(`  - Other errors: ${errorRow.other_errors}`);

      // Get sample of recent errors
      const recentErrors = await db`
        SELECT
          timestamp,
          error_message,
          routing_layer
        FROM query_logs
        WHERE timestamp >= ${oneDayAgo}
          AND error_message IS NOT NULL
        ORDER BY timestamp DESC
        LIMIT 3
      `;

      const errorSamples = recentErrors.rows || recentErrors;
      if (errorSamples.length > 0) {
        console.log('\nRecent error samples:');
        errorSamples.forEach(err => {
          console.log(`  - ${err.timestamp}: ${err.error_message?.substring(0, 100)}`);
        });
      }
    } else {
      console.log('✅ No errors found in recent queries');
    }

    // 6. Summary and Recommendations
    console.log('\n' + '='.repeat(80));
    console.log('DIAGNOSIS SUMMARY');
    console.log('='.repeat(80));

    const issues = [];

    if (missingTables.length > 0) {
      issues.push({
        severity: 'CRITICAL',
        issue: `Missing database tables: ${missingTables.join(', ')}`,
        solution: 'Run migrations: npm run migrate or call /api/migrate endpoint'
      });
    }

    if (queriesWithDecisions < totalQueries * 0.5) {
      issues.push({
        severity: 'HIGH',
        issue: `Only ${((queriesWithDecisions/totalQueries)*100).toFixed(1)}% of queries have routing decisions`,
        solution: 'Check logRoutingDecisions() calls in api/chat.js'
      });
    }

    if (queriesWithRetrievals === 0 && totalQueries > 0) {
      issues.push({
        severity: 'HIGH',
        issue: 'No retrieval details are being logged',
        solution: 'Check logRetrievalDetails() calls in api/chat.js for RAG queries'
      });
    }

    if (errorCount > totalQueries * 0.1) {
      issues.push({
        severity: 'MEDIUM',
        issue: `High error rate: ${((errorCount/totalQueries)*100).toFixed(1)}% of queries have errors`,
        solution: 'Review error logs and fix underlying issues'
      });
    }

    if (issues.length === 0) {
      console.log('✅ No major consistency issues detected');
      console.log('\nHowever, if routing_decisions and retrieval_details are still not populating:');
      console.log('1. Check that logRequestAsync() is being called with decisionTrace and retrievalDetails');
      console.log('2. Verify that the async logging with setImmediate() is working correctly');
      console.log('3. Check for any transaction rollbacks or connection pool issues');
    } else {
      console.log('❌ ISSUES DETECTED:\n');
      issues.forEach((issue, idx) => {
        console.log(`${idx + 1}. [${issue.severity}] ${issue.issue}`);
        console.log(`   Solution: ${issue.solution}\n`);
      });
    }

    console.log('\n' + '='.repeat(80));
    console.log('Diagnostic completed at:', new Date().toISOString());
    console.log('='.repeat(80));

  } catch (error) {
    console.error('\n❌ Diagnostic failed with error:', error.message);
    console.error('\nFull error:', error);
    process.exit(1);
  }
}

// Run the diagnostic
diagnoseConsistency().catch(console.error);