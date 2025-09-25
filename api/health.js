import { testConnection, getCurrentEnvironment } from '../lib/database/connection.js';
import { getQueryStats, getEvaluationSummary } from '../lib/database/queries.js';

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const ORIGIN_ALLOWED = process.env.ORIGIN_ALLOWED || '*';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN_ALLOWED);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const startTime = Date.now();

  try {
    // Check database connectivity
    const dbHealth = await testConnection(5000);

    // Get basic system info
    const systemInfo = {
      environment: getCurrentEnvironment(),
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      nodeVersion: process.version,
      hasOpenAIKey: !!OPENAI_KEY
    };

    // Get query statistics (only if database is healthy)
    let stats = null;
    let evaluationSummary = null;

    if (dbHealth.healthy) {
      // Get query statistics independently
      try {
        stats = await getQueryStats(24); // Last 24 hours
      } catch (error) {
        console.warn('Failed to fetch query stats:', error.message);
        stats = { error: 'Failed to fetch query stats' };
      }

      // Get evaluation summary independently
      try {
        evaluationSummary = await getEvaluationSummary(5); // Last 5 evaluation runs
      } catch (error) {
        console.warn('Failed to fetch evaluation summary:', error.message);
        evaluationSummary = { error: 'Failed to fetch evaluation summary' };
      }
    }

    const responseTime = Date.now() - startTime;

    const healthData = {
      status: dbHealth.healthy ? 'healthy' : 'unhealthy',
      responseTimeMs: responseTime,
      database: {
        healthy: dbHealth.healthy,
        latencyMs: dbHealth.latency,
        error: dbHealth.error || null,
        timestamp: dbHealth.timestamp || null
      },
      system: systemInfo,
      queryStats: stats,
      evaluations: evaluationSummary
    };

    // Return 200 if healthy, 503 if unhealthy
    const statusCode = dbHealth.healthy ? 200 : 503;
    res.status(statusCode).json(healthData);

  } catch (error) {
    console.error('Health check failed:', error);

    const errorResponse = {
      status: 'unhealthy',
      responseTimeMs: Date.now() - startTime,
      error: error.message,
      database: {
        healthy: false,
        error: 'Health check failed'
      },
      system: {
        environment: getCurrentEnvironment(),
        timestamp: new Date().toISOString(),
        hasOpenAIKey: !!OPENAI_KEY
      }
    };

    res.status(503).json(errorResponse);
  }
}