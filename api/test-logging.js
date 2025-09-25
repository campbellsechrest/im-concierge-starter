/**
 * Test endpoint to verify logging functionality in real-time
 * Makes actual logging calls and reports success/failure immediately
 */

import { logQuery, logRetrievalDetails, logRoutingDecisions } from '../lib/database/queries.js';
import { getCurrentEnvironment } from '../lib/database/connection.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  const startTime = Date.now();
  const results = {
    timestamp: new Date().toISOString(),
    environment: getCurrentEnvironment(),
    tests: []
  };

  try {
    // Test 1: Log a main query
    console.log('[TEST] Starting logQuery test...');
    const testQueryData = {
      userMessage: 'Test logging functionality',
      normalizedMessage: 'test logging functionality',
      responseAnswer: 'This is a test response for logging verification.',
      routing: {
        layer: 'rag',
        rule: null,
        intent: 'test',
        category: 'diagnostics',
        score: 0.99
      },
      sources: [{ id: 'test-doc', url: 'test-url', score: 0.9 }],
      responseTimeMs: 1000,
      userSessionId: 'test-session',
      openai: {
        model: 'gpt-4-turbo',
        requestId: 'test-request',
        totalTokens: 100
      },
      embeddingCacheHit: false,
      errorMessage: null,
      apiVersion: '1.0',
      embeddingTokens: 20,
      chatCompletionTokens: 80,
      estimatedCost: 0.001,
      apiCallsCount: 1
    };

    let queryLogId;
    try {
      queryLogId = await logQuery(testQueryData);
      console.log(`[TEST] logQuery succeeded: ${queryLogId}`);
      results.tests.push({
        test: 'logQuery',
        success: true,
        queryLogId,
        duration: Date.now() - startTime
      });
    } catch (error) {
      console.error(`[TEST] logQuery failed:`, error);
      results.tests.push({
        test: 'logQuery',
        success: false,
        error: error.message,
        duration: Date.now() - startTime
      });
      // Can't continue without queryLogId
      return res.json({ success: false, results });
    }

    // Test 2: Log retrieval details
    console.log('[TEST] Starting logRetrievalDetails test...');
    const testRetrievalDetails = [
      {
        documentId: 'test-doc-1',
        documentSection: 'test-section',
        similarityScore: 0.95,
        scopeFiltered: false
      },
      {
        documentId: 'test-doc-2',
        documentSection: 'test-section-2',
        similarityScore: 0.87,
        scopeFiltered: true
      }
    ];

    try {
      await logRetrievalDetails(queryLogId, testRetrievalDetails);
      console.log(`[TEST] logRetrievalDetails succeeded for query ${queryLogId}`);
      results.tests.push({
        test: 'logRetrievalDetails',
        success: true,
        count: testRetrievalDetails.length,
        duration: Date.now() - startTime
      });
    } catch (error) {
      console.error(`[TEST] logRetrievalDetails failed:`, error);
      results.tests.push({
        test: 'logRetrievalDetails',
        success: false,
        error: error.message,
        duration: Date.now() - startTime
      });
    }

    // Test 3: Log routing decisions
    console.log('[TEST] Starting logRoutingDecisions test...');
    const testDecisionTrace = [
      {
        layer: 'safety-regex',
        rule: null,
        intent: null,
        category: null,
        score: null,
        triggered: false,
        executionTime: 5,
        apiLatency: 0,
        riskTokenCount: null,
        hasProductContext: null,
        embeddingScore: null
      },
      {
        layer: 'business-regex',
        rule: null,
        intent: null,
        category: null,
        score: null,
        triggered: false,
        executionTime: 3,
        apiLatency: 0,
        riskTokenCount: null,
        hasProductContext: null,
        embeddingScore: null
      },
      {
        layer: 'rag',
        rule: null,
        intent: 'test',
        category: 'diagnostics',
        score: 0.99,
        triggered: true,
        executionTime: 100,
        apiLatency: 50,
        riskTokenCount: 20,
        hasProductContext: false,
        embeddingScore: null
      }
    ];

    try {
      await logRoutingDecisions(queryLogId, testDecisionTrace);
      console.log(`[TEST] logRoutingDecisions succeeded for query ${queryLogId}`);
      results.tests.push({
        test: 'logRoutingDecisions',
        success: true,
        count: testDecisionTrace.length,
        duration: Date.now() - startTime
      });
    } catch (error) {
      console.error(`[TEST] logRoutingDecisions failed:`, error);
      results.tests.push({
        test: 'logRoutingDecisions',
        success: false,
        error: error.message,
        duration: Date.now() - startTime
      });
    }

    // Test 4: Verify data was actually written
    console.log('[TEST] Verifying data persistence...');
    try {
      const { getConnection } = await import('../lib/database/connection.js');
      const db = getConnection();

      // Check if data exists
      const queryCheck = await db`SELECT id FROM query_logs WHERE id = ${queryLogId}`;
      const retrievalCheck = await db`SELECT COUNT(*) as count FROM retrieval_details WHERE query_log_id = ${queryLogId}`;
      const routingCheck = await db`SELECT COUNT(*) as count FROM routing_decisions WHERE query_log_id = ${queryLogId}`;

      const retrievalCount = parseInt((retrievalCheck.rows || retrievalCheck)[0].count);
      const routingCount = parseInt((routingCheck.rows || routingCheck)[0].count);

      results.tests.push({
        test: 'dataVerification',
        success: true,
        verification: {
          queryExists: (queryCheck.rows || queryCheck).length > 0,
          retrievalDetailsCount: retrievalCount,
          routingDecisionsCount: routingCount,
          expectedRetrievalCount: testRetrievalDetails.length,
          expectedRoutingCount: testDecisionTrace.length
        },
        duration: Date.now() - startTime
      });

      console.log(`[TEST] Data verification complete - retrieval: ${retrievalCount}/${testRetrievalDetails.length}, routing: ${routingCount}/${testDecisionTrace.length}`);

    } catch (error) {
      console.error(`[TEST] Data verification failed:`, error);
      results.tests.push({
        test: 'dataVerification',
        success: false,
        error: error.message,
        duration: Date.now() - startTime
      });
    }

    const allTestsSuccessful = results.tests.every(test => test.success);
    const totalDuration = Date.now() - startTime;

    return res.json({
      success: allTestsSuccessful,
      results: {
        ...results,
        summary: {
          totalTests: results.tests.length,
          successfulTests: results.tests.filter(t => t.success).length,
          failedTests: results.tests.filter(t => !t.success).length,
          totalDuration
        }
      }
    });

  } catch (error) {
    console.error('[TEST] Test endpoint failed:', error);

    return res.status(500).json({
      success: false,
      error: error.message,
      results: {
        ...results,
        totalDuration: Date.now() - startTime
      }
    });
  }
}