#!/usr/bin/env node

/**
 * Test database connection and environment variables in CI/CD context
 * This script helps diagnose database connectivity issues
 */

import { getConnection, testConnection, getCurrentEnvironment } from '../lib/database/connection.js';

console.log('=== Database Connection Test ===\n');

// 1. Check environment variables
console.log('1. Environment Variables:');
console.log('   DATABASE_URL:', process.env.DATABASE_URL ? 'Set (hidden)' : 'NOT SET');
console.log('   NODE_ENV:', process.env.NODE_ENV || 'not set');
console.log('   VERCEL_ENV:', process.env.VERCEL_ENV || 'not set');
console.log('   Current Environment:', getCurrentEnvironment());
console.log('   CI:', process.env.CI || 'not set');
console.log('   GITHUB_ACTIONS:', process.env.GITHUB_ACTIONS || 'not set');
console.log('');

// 2. Test database connection
console.log('2. Testing Database Connection:');
try {
  const connectionTest = await testConnection();

  if (connectionTest.healthy) {
    console.log('   ✅ Database connection successful');
    console.log('   Latency:', connectionTest.latency, 'ms');
    console.log('   Timestamp:', connectionTest.timestamp);
    if (connectionTest.poolInfo) {
      console.log('   Pool info:', connectionTest.poolInfo);
    }
  } else {
    console.log('   ❌ Database connection failed');
    console.log('   Error:', connectionTest.error);
  }
  console.log('');
} catch (error) {
  console.log('   ❌ Exception during connection test');
  console.log('   Error:', error.message);
  console.log('');
}

// 3. Test a simple query
console.log('3. Testing Simple Query:');
try {
  const db = getConnection();
  const result = await db`SELECT COUNT(*) as count FROM eval_results`;
  const count = result[0]?.count || result.rows?.[0]?.count || 0;
  console.log('   ✅ Query successful');
  console.log('   eval_results table has', count, 'records');
  console.log('');
} catch (error) {
  console.log('   ❌ Query failed');
  console.log('   Error:', error.message);
  console.log('   Error code:', error.code);
  console.log('');
}

// 4. Test inserting a dummy evaluation result
console.log('4. Testing Insert Operation:');
try {
  const db = getConnection();
  const testData = {
    suite: 'test-connection',
    id: 'test-' + Date.now(),
    question: 'Test question from CI diagnostic',
    passed: true
  };

  const result = await db`
    INSERT INTO eval_results (
      eval_suite,
      eval_scenario_id,
      question,
      passed,
      environment,
      git_commit
    ) VALUES (
      ${testData.suite},
      ${testData.id},
      ${testData.question},
      ${testData.passed},
      ${getCurrentEnvironment()},
      ${'test-commit-' + Date.now()}
    )
    RETURNING id
  `;

  const insertedId = result[0]?.id || result.rows?.[0]?.id;
  if (insertedId) {
    console.log('   ✅ Insert successful');
    console.log('   Inserted record ID:', insertedId);

    // Clean up test record
    await db`DELETE FROM eval_results WHERE id = ${insertedId}`;
    console.log('   ✅ Test record cleaned up');
  } else {
    console.log('   ❌ Insert succeeded but no ID returned');
  }
  console.log('');
} catch (error) {
  console.log('   ❌ Insert failed');
  console.log('   Error:', error.message);
  console.log('   Error code:', error.code);
  console.log('');
}

// 5. Check if @vercel/postgres is properly configured
console.log('5. Vercel Postgres Configuration:');
try {
  const { sql } = await import('@vercel/postgres');
  console.log('   ✅ @vercel/postgres module loaded');
  console.log('   sql object type:', typeof sql);
  console.log('   sql is function:', typeof sql === 'function');

  // Check for common Vercel Postgres environment variables
  console.log('   POSTGRES_URL:', process.env.POSTGRES_URL ? 'Set' : 'NOT SET');
  console.log('   POSTGRES_URL_NON_POOLING:', process.env.POSTGRES_URL_NON_POOLING ? 'Set' : 'NOT SET');
  console.log('   POSTGRES_DATABASE:', process.env.POSTGRES_DATABASE ? 'Set' : 'NOT SET');
  console.log('');
} catch (error) {
  console.log('   ❌ Failed to load @vercel/postgres');
  console.log('   Error:', error.message);
  console.log('');
}

console.log('=== Test Complete ===\n');
process.exit(0);