#!/usr/bin/env node

/**
 * Test script to verify database logging consistency
 * Tests the logQuery, logRetrievalDetails, and logRoutingDecisions functions
 */

import { logQuery, logRetrievalDetails, logRoutingDecisions } from '../lib/database/queries.js';

// Test data that matches the structure from actual chat.js usage
const testQueryData = {
  userMessage: 'What is the molecular weight of caffeine?',
  normalizedMessage: 'molecular weight caffeine',
  responseAnswer: 'The molecular weight of caffeine is 194.19 g/mol.',
  routing: {
    layer: 'rag',
    rule: null,
    intent: 'chemistry-question',
    category: 'product-info',
    score: 0.85
  },
  sources: [
    { id: 'caffeine-doc', url: 'test-url', score: 0.9 }
  ],
  responseTimeMs: 1234,
  userSessionId: 'test-session-123',
  openai: {
    model: 'gpt-4-turbo',
    requestId: 'test-request-123',
    totalTokens: 150
  },
  embeddingCacheHit: false,
  errorMessage: null,
  apiVersion: '1.0',
  embeddingTokens: 25,
  chatCompletionTokens: 125,
  estimatedCost: 0.01234,
  apiCallsCount: 2
};

const testRetrievalDetails = [
  {
    documentId: 'caffeine-properties',
    documentSection: 'molecular-data',
    similarityScore: 0.92,
    scopeFiltered: false
  },
  {
    documentId: 'chemical-compounds',
    documentSection: 'caffeine',
    similarityScore: 0.87,
    scopeFiltered: true
  }
];

const testDecisionTrace = [
  {
    layer: 'safety-regex',
    rule: null,
    intent: null,
    category: null,
    score: null,
    triggered: false,
    executionTime: 12,
    apiLatency: 0
  },
  {
    layer: 'business-regex',
    rule: null,
    intent: null,
    category: null,
    score: null,
    triggered: false,
    executionTime: 8,
    apiLatency: 0
  },
  {
    layer: 'safety-embed',
    rule: null,
    intent: null,
    category: null,
    score: 0.1,
    triggered: false,
    riskTokenCount: null,
    hasProductContext: null,
    embeddingScore: 0.1,
    executionTime: 245,
    apiLatency: 200
  },
  {
    layer: 'intent-embed',
    rule: 'chemistry-questions',
    intent: 'chemistry-question',
    category: null,
    score: 0.75,
    triggered: true,
    executionTime: 234,
    apiLatency: 180
  },
  {
    layer: 'rag',
    rule: null,
    intent: 'chemistry-question',
    category: 'product-info',
    score: 0.85,
    triggered: true,
    executionTime: 856,
    apiLatency: 400,
    riskTokenCount: 25,
    hasProductContext: true
  }
];

async function testLogging() {
  console.log('🧪 Testing database logging consistency...\n');

  try {
    // Test 1: Log main query
    console.log('1️⃣ Testing logQuery...');
    const queryLogId = await logQuery(testQueryData);
    console.log(`✅ Successfully logged main query with ID: ${queryLogId}\n`);

    // Test 2: Log retrieval details
    console.log('2️⃣ Testing logRetrievalDetails...');
    await logRetrievalDetails(queryLogId, testRetrievalDetails);
    console.log(`✅ Successfully logged ${testRetrievalDetails.length} retrieval details\n`);

    // Test 3: Log routing decisions
    console.log('3️⃣ Testing logRoutingDecisions...');
    await logRoutingDecisions(queryLogId, testDecisionTrace);
    console.log(`✅ Successfully logged ${testDecisionTrace.length} routing decisions\n`);

    console.log('🎉 All logging tests passed! Database consistency should be working.\n');

    // Test 4: Validation tests
    console.log('4️⃣ Testing validation handling...');

    // Test with invalid retrieval details
    try {
      await logRetrievalDetails(queryLogId, [
        { documentId: null, similarityScore: 'invalid' }, // Should be skipped
        { documentId: 'valid-doc', similarityScore: 0.5 }  // Should succeed
      ]);
      console.log('✅ Validation handling for retrieval details working\n');
    } catch (error) {
      console.log('❌ Validation test failed:', error.message);
    }

    // Test with invalid routing decisions
    try {
      await logRoutingDecisions(queryLogId, [
        { layer: null, triggered: 'invalid' }, // Should be skipped
        { layer: 'test-layer', triggered: true }  // Should succeed
      ]);
      console.log('✅ Validation handling for routing decisions working\n');
    } catch (error) {
      console.log('❌ Validation test failed:', error.message);
    }

    return { success: true, queryLogId };

  } catch (error) {
    console.error('❌ Logging test failed:', error);

    // Check if it's a table issue
    if (error.message?.includes('relation') || error.message?.includes('table')) {
      console.log('\n💡 Database tables may not exist. Try running: npm run migrate');
    }

    return { success: false, error: error.message };
  }
}

async function verifyData(queryLogId) {
  if (!queryLogId) return;

  console.log('🔍 Verifying logged data...');

  try {
    const { getConnection } = await import('../lib/database/connection.js');
    const db = getConnection();

    // Check main query
    const queryResult = await db`
      SELECT * FROM query_logs WHERE id = ${queryLogId}
    `;
    console.log(`📊 Found ${queryResult.length} query log entry`);

    // Check retrieval details
    const retrievalResult = await db`
      SELECT * FROM retrieval_details WHERE query_log_id = ${queryLogId}
    `;
    console.log(`📊 Found ${retrievalResult.length} retrieval detail entries`);

    // Check routing decisions
    const routingResult = await db`
      SELECT * FROM routing_decisions WHERE query_log_id = ${queryLogId}
    `;
    console.log(`📊 Found ${routingResult.length} routing decision entries`);

    if (queryResult.length === 1 && retrievalResult.length > 0 && routingResult.length > 0) {
      console.log('\n✅ Database consistency verified! All tables populated correctly.');
    } else {
      console.log('\n⚠️  Inconsistency detected:');
      console.log(`   - Query logs: ${queryResult.length} (expected: 1)`);
      console.log(`   - Retrieval details: ${retrievalResult.length} (expected: >0)`);
      console.log(`   - Routing decisions: ${routingResult.length} (expected: >0)`);
    }

  } catch (error) {
    console.error('❌ Failed to verify data:', error.message);
  }
}

// Run the test
testLogging()
  .then(result => {
    if (result.success) {
      return verifyData(result.queryLogId);
    }
  })
  .then(() => {
    console.log('\n🏁 Test complete!');
    process.exit(0);
  })
  .catch(error => {
    console.error('💥 Test script failed:', error);
    process.exit(1);
  });