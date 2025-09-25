#!/usr/bin/env node

import { config } from 'dotenv';
import { logQuery, logRetrievalDetails, logRoutingDecisions } from '../lib/database/queries.js';
import { getConnection, testConnection, getCurrentEnvironment } from '../lib/database/connection.js';

// Load environment variables
config();

async function testLoggingFlow() {
  console.log('='.repeat(80));
  console.log('TESTING DATABASE LOGGING FLOW');
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

    // Create test data matching what api/chat.js would send
    const testQueryData = {
      userMessage: 'Test query: What is A-Minus?',
      normalizedMessage: 'test query: what is a-minus?',
      responseAnswer: 'A-Minus is a supplement designed to help reduce acetaldehyde.',
      routing: {
        layer: 'rag',
        intent: 'product-overview',
        score: 0.85
      },
      sources: [
        { id: 'doc1', url: 'https://example.com/doc1', score: 0.92 },
        { id: 'doc2', url: 'https://example.com/doc2', score: 0.87 }
      ],
      responseTimeMs: 1250,
      openai: {
        model: 'gpt-4o-mini',
        requestId: 'test-request-123',
        totalTokens: 500
      },
      embeddingCacheHit: false,
      embeddingTokens: 50,
      chatCompletionTokens: 450,
      estimatedCost: 0.005,
      apiCallsCount: 2
    };

    // Test retrieval details data
    const testRetrievalDetails = [
      {
        documentId: 'doc1',
        documentSection: 'Overview',
        similarityScore: 0.92,
        scopeFiltered: false
      },
      {
        documentId: 'doc2',
        documentSection: 'Science',
        similarityScore: 0.87,
        scopeFiltered: false
      },
      {
        documentId: 'doc3',
        documentSection: 'FAQ',
        similarityScore: 0.81,
        scopeFiltered: false
      }
    ];

    // Test routing decision trace
    const testDecisionTrace = [
      {
        layer: 'safety-regex',
        rule: null,
        intent: null,
        category: null,
        score: null,
        triggered: false,
        executionTime: 2,
        apiLatency: 0
      },
      {
        layer: 'business-regex',
        rule: 'product-overview',
        intent: 'product-overview',
        category: null,
        score: null,
        triggered: false,
        executionTime: 1,
        apiLatency: 0
      },
      {
        layer: 'safety-embed',
        rule: null,
        intent: null,
        category: null,
        score: 0.12,
        triggered: false,
        riskTokenCount: 0,
        hasProductContext: true,
        embeddingScore: 0.2,
        executionTime: 150,
        apiLatency: 145
      },
      {
        layer: 'intent-embed',
        rule: null,
        intent: 'product-overview',
        category: null,
        score: 0.85,
        triggered: false,
        executionTime: 5,
        apiLatency: 0
      },
      {
        layer: 'rag',
        rule: null,
        intent: 'product-overview',
        category: null,
        score: 0.92,
        triggered: true,
        executionTime: 1100,
        apiLatency: 1050
      }
    ];

    // Step 1: Log the main query
    console.log('Step 1: Logging main query...');
    let queryLogId;
    try {
      queryLogId = await logQuery(testQueryData);
      console.log(`✅ Query logged successfully with ID: ${queryLogId}`);
    } catch (error) {
      console.error(`❌ Failed to log query: ${error.message}`);
      throw error;
    }

    // Step 2: Log retrieval details
    console.log('\nStep 2: Logging retrieval details...');
    try {
      await logRetrievalDetails(queryLogId, testRetrievalDetails);
      console.log(`✅ Logged ${testRetrievalDetails.length} retrieval details`);
    } catch (error) {
      console.error(`❌ Failed to log retrieval details: ${error.message}`);
      console.error('Error details:', error);
    }

    // Step 3: Log routing decisions
    console.log('\nStep 3: Logging routing decisions...');
    try {
      await logRoutingDecisions(queryLogId, testDecisionTrace);
      console.log(`✅ Logged ${testDecisionTrace.length} routing decisions`);
    } catch (error) {
      console.error(`❌ Failed to log routing decisions: ${error.message}`);
      console.error('Error details:', error);
    }

    // Step 4: Verify the data was actually written
    console.log('\nStep 4: Verifying logged data...');

    // Check query_logs
    const queryCheck = await db`
      SELECT id, user_message, routing_layer, estimated_cost
      FROM query_logs
      WHERE id = ${queryLogId}
    `;
    const queryRow = (queryCheck.rows || queryCheck)[0];
    if (queryRow) {
      console.log(`✅ Query verified in query_logs table`);
      console.log(`   - ID: ${queryRow.id}`);
      console.log(`   - Message: ${queryRow.user_message}`);
      console.log(`   - Layer: ${queryRow.routing_layer}`);
      console.log(`   - Cost: $${queryRow.estimated_cost || 0}`);
    } else {
      console.error('❌ Query not found in query_logs table!');
    }

    // Check retrieval_details
    const retrievalCheck = await db`
      SELECT COUNT(*) as count, AVG(similarity_score) as avg_score
      FROM retrieval_details
      WHERE query_log_id = ${queryLogId}
    `;
    const retrievalRow = (retrievalCheck.rows || retrievalCheck)[0];
    const retrievalCount = parseInt(retrievalRow?.count) || 0;
    if (retrievalCount > 0) {
      console.log(`✅ Retrieval details verified: ${retrievalCount} documents`);
      console.log(`   - Avg similarity: ${parseFloat(retrievalRow.avg_score).toFixed(3)}`);
    } else {
      console.error('❌ No retrieval details found!');
    }

    // Check routing_decisions
    const routingCheck = await db`
      SELECT COUNT(*) as count, STRING_AGG(layer, ', ' ORDER BY execution_order) as layers
      FROM routing_decisions
      WHERE query_log_id = ${queryLogId}
    `;
    const routingRow = (routingCheck.rows || routingCheck)[0];
    const routingCount = parseInt(routingRow?.count) || 0;
    if (routingCount > 0) {
      console.log(`✅ Routing decisions verified: ${routingCount} decisions`);
      console.log(`   - Layers: ${routingRow.layers}`);
    } else {
      console.error('❌ No routing decisions found!');
    }

    // Step 5: Test async logging pattern (like api/chat.js uses)
    console.log('\nStep 5: Testing async logging with setImmediate...');

    const asyncTestData = {
      ...testQueryData,
      userMessage: 'Async test: How does A-Minus work?',
      normalizedMessage: 'async test: how does a-minus work?'
    };

    let asyncQueryId;

    // Simulate the pattern used in api/chat.js
    await new Promise((resolve) => {
      setImmediate(async () => {
        try {
          console.log('  - Executing async log...');
          asyncQueryId = await logQuery(asyncTestData);
          console.log(`  - Async query logged with ID: ${asyncQueryId}`);

          await logRetrievalDetails(asyncQueryId, testRetrievalDetails);
          console.log(`  - Async retrieval details logged`);

          await logRoutingDecisions(asyncQueryId, testDecisionTrace);
          console.log(`  - Async routing decisions logged`);

          resolve();
        } catch (error) {
          console.error(`  ❌ Async logging failed: ${error.message}`);
          resolve();
        }
      });
    });

    // Verify async data
    if (asyncQueryId) {
      const asyncVerify = await db`
        SELECT
          (SELECT COUNT(*) FROM retrieval_details WHERE query_log_id = ${asyncQueryId}) as retrieval_count,
          (SELECT COUNT(*) FROM routing_decisions WHERE query_log_id = ${asyncQueryId}) as routing_count
      `;
      const asyncRow = (asyncVerify.rows || asyncVerify)[0];
      console.log(`✅ Async logging verification:`);
      console.log(`   - Retrieval details: ${asyncRow.retrieval_count}`);
      console.log(`   - Routing decisions: ${asyncRow.routing_count}`);
    }

    // Summary
    console.log('\n' + '='.repeat(80));
    console.log('TEST SUMMARY');
    console.log('='.repeat(80));

    const allTestsPassed = queryRow && retrievalCount > 0 && routingCount > 0;

    if (allTestsPassed) {
      console.log('✅ All logging functions are working correctly!');
      console.log('\nThe logging flow is functional. If production data is missing:');
      console.log('1. Check that api/chat.js is passing the correct data structure');
      console.log('2. Verify that decisionTrace and retrievalDetails are populated');
      console.log('3. Check for any errors being silently caught');
      console.log('4. Monitor for transaction rollbacks or connection issues');
    } else {
      console.log('❌ Some logging functions are not working properly');
      console.log('\nIssues detected:');
      if (!queryRow) console.log('  - Main query logging failed');
      if (retrievalCount === 0) console.log('  - Retrieval details logging failed');
      if (routingCount === 0) console.log('  - Routing decisions logging failed');
    }

    // Cleanup test data (optional)
    console.log('\nCleaning up test data...');
    if (queryLogId) {
      await db`DELETE FROM query_logs WHERE id = ${queryLogId}`;
      console.log('✅ Test query cleaned up');
    }
    if (asyncQueryId) {
      await db`DELETE FROM query_logs WHERE id = ${asyncQueryId}`;
      console.log('✅ Async test query cleaned up');
    }

  } catch (error) {
    console.error('\n❌ Test failed with error:', error.message);
    console.error('\nFull error:', error);
    process.exit(1);
  }
}

// Run the test
testLoggingFlow().catch(console.error);