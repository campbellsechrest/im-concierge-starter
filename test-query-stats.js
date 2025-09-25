#!/usr/bin/env node

import { getQueryStats } from './lib/database/queries.js';
import { testConnection } from './lib/database/connection.js';

async function testQueryStats() {
  console.log('Testing database connection...');
  const dbHealth = await testConnection(5000);

  if (!dbHealth.healthy) {
    console.error('Database is not healthy:', dbHealth.error);
    process.exit(1);
  }

  console.log('Database connection healthy, testing getQueryStats()...\n');

  try {
    const stats = await getQueryStats(24);
    console.log('SUCCESS! Query stats retrieved:');
    console.log(JSON.stringify(stats, null, 2));

    // Validate the structure
    if (typeof stats.totalQueries !== 'number') {
      throw new Error('Invalid totalQueries');
    }
    if (typeof stats.errorCount !== 'number') {
      throw new Error('Invalid errorCount');
    }
    if (typeof stats.avgResponseTime !== 'number') {
      throw new Error('Invalid avgResponseTime');
    }
    if (!stats.routingBreakdown || typeof stats.routingBreakdown !== 'object') {
      throw new Error('Invalid routingBreakdown');
    }

    console.log('\n✅ All validations passed!');
    process.exit(0);
  } catch (error) {
    console.error('FAILED! Error calling getQueryStats():');
    console.error(error);
    process.exit(1);
  }
}

testQueryStats();