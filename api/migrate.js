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

    // Read the migration file
    const migrationPath = path.join(process.cwd(), 'db', 'migrations', '001_initial.sql');

    if (!fs.existsSync(migrationPath)) {
      return res.status(500).json({
        success: false,
        error: 'Migration file not found',
        path: migrationPath,
        environment: getCurrentEnvironment()
      });
    }

    const migrationSql = fs.readFileSync(migrationPath, 'utf8');
    console.log('Migration file loaded, executing...');

    // Run the migration
    const result = await runMigration(migrationSql);
    const responseTime = Date.now() - startTime;

    if (result.success) {
      console.log('Migration completed successfully');

      return res.status(200).json({
        success: true,
        message: 'Database migration completed successfully',
        tablesCreated: [
          'query_logs',
          'eval_results',
          'retrieval_details'
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
          'idx_retrieval_query_rank'
        ],
        environment: getCurrentEnvironment(),
        responseTimeMs: responseTime,
        databaseLatency: connectionTest.latency
      });
    } else {
      console.error('Migration failed:', result.error);

      return res.status(500).json({
        success: false,
        error: 'Migration failed',
        details: result.error,
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