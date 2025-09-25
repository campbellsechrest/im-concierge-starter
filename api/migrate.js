import fs from 'fs';
import path from 'path';
import { runMigration, testConnection, getCurrentEnvironment } from '../lib/database/connection.js';

const ORIGIN_ALLOWED = process.env.ORIGIN_ALLOWED || '*';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN_ALLOWED);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  const startTime = Date.now();

  try {
    // Test database connection first
    console.log('Testing database connection...');
    const connectionTest = await testConnection(10000); // 10 second timeout

    if (!connectionTest.healthy) {
      return res.status(503).json({
        success: false,
        error: 'Database connection failed',
        details: connectionTest.error,
        environment: getCurrentEnvironment()
      });
    }

    console.log('Database connection healthy, proceeding with migration...');

    // Handle all migrations in order
    const migrationsToRun = [
      '001_initial.sql',
      '002_routing_decisions.sql',
      '003_analytics_enhancements.sql'
    ];

    let allResults = [];

    for (const migrationFile of migrationsToRun) {
      const migrationPath = path.join(process.cwd(), 'db', 'migrations', migrationFile);

      if (!fs.existsSync(migrationPath)) {
        console.log(`Migration file ${migrationFile} not found, skipping...`);
        continue;
      }

      const migrationSql = fs.readFileSync(migrationPath, 'utf8');
      console.log(`Executing migration: ${migrationFile}`);

      const result = await runMigration(migrationSql);
      allResults.push({ file: migrationFile, ...result });

      if (!result.success) {
        console.error(`Migration ${migrationFile} failed:`, result.error);
        // Continue with next migration even if one fails (for idempotency)
      }
    }

    const responseTime = Date.now() - startTime;
    const successfulMigrations = allResults.filter(r => r.success);
    const failedMigrations = allResults.filter(r => !r.success);

    if (successfulMigrations.length > 0) {
      console.log(`Migrations completed: ${successfulMigrations.length} successful, ${failedMigrations.length} failed`);

      return res.status(200).json({
        success: true,
        message: 'Database migrations completed',
        migrationsRun: allResults,
        tablesCreated: [
          'query_logs',
          'eval_results',
          'retrieval_details',
          'routing_decisions'
        ],
        indexesCreated: [
          'idx_query_logs_timestamp',
          'idx_query_logs_routing',
          'idx_query_logs_session',
          'idx_query_logs_environment',
          'idx_eval_results_suite_time',
          'idx_eval_results_passed',
          'idx_eval_results_commit',
          'idx_retrieval_similarity',
          'idx_retrieval_query_rank',
          'idx_routing_decisions_query_log_id',
          'idx_routing_decisions_layer',
          'idx_routing_decisions_layer_triggered',
          'idx_routing_decisions_layer_score',
          'idx_routing_decisions_decision_time',
          'idx_routing_decisions_flow'
        ],
        environment: getCurrentEnvironment(),
        responseTimeMs: responseTime,
        databaseLatency: connectionTest.latency
      });
    } else {
      console.error('All migrations failed');

      return res.status(500).json({
        success: false,
        error: 'All migrations failed',
        details: allResults,
        environment: getCurrentEnvironment(),
        responseTimeMs: responseTime
      });
    }

  } catch (error) {
    console.error('Migration endpoint error:', error);

    return res.status(500).json({
      success: false,
      error: 'Migration endpoint failed',
      details: error.message,
      environment: getCurrentEnvironment(),
      responseTimeMs: Date.now() - startTime
    });
  }
}