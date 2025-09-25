import { sql } from '@vercel/postgres';

let cachedConnection = null;
let connectionPromise = null;

/**
 * Ensure environment variables are properly set for @vercel/postgres
 * Maps DATABASE_URL to POSTGRES_URL if needed (for CI/CD compatibility)
 */
function ensurePostgresEnvVars() {
  // If POSTGRES_URL is not set but DATABASE_URL is, use DATABASE_URL
  if (!process.env.POSTGRES_URL && process.env.DATABASE_URL) {
    process.env.POSTGRES_URL = process.env.DATABASE_URL;
    console.log('[Database] Using DATABASE_URL as POSTGRES_URL for compatibility');
  }

  // Also set POSTGRES_URL_NON_POOLING if not present
  if (!process.env.POSTGRES_URL_NON_POOLING && process.env.DATABASE_URL) {
    process.env.POSTGRES_URL_NON_POOLING = process.env.DATABASE_URL;
  }
}

/**
 * Get database connection with connection caching for serverless functions.
 * Reuses connection across function invocations to minimize cold start impact.
 *
 * @returns {Object} Vercel Postgres sql client
 */
export function getConnection() {
  if (!cachedConnection) {
    // Ensure environment variables are set before creating connection
    ensurePostgresEnvVars();
    cachedConnection = sql;
  }
  return cachedConnection;
}

/**
 * Test database connectivity with timeout handling.
 * Used for health checks and connection validation.
 *
 * @param {number} timeoutMs - Timeout in milliseconds (default 5000)
 * @returns {Promise<{healthy: boolean, latency?: number, error?: string, poolInfo?: object}>}
 */
export async function testConnection(timeoutMs = 5000) {
  // Ensure environment variables are set before testing
  ensurePostgresEnvVars();
  const db = getConnection();
  const startTime = Date.now();

  try {
    // Create promise that resolves with query result or rejects on timeout
    const queryPromise = db`SELECT 1 as test, NOW() as timestamp`;
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Database query timeout after ${timeoutMs}ms`)), timeoutMs)
    );

    const result = await Promise.race([queryPromise, timeoutPromise]);
    const latency = Date.now() - startTime;

    // Get connection pool stats if available (Vercel Postgres specific)
    let poolInfo = null;
    try {
      if (db.pool) {
        poolInfo = {
          totalCount: db.pool.totalCount,
          idleCount: db.pool.idleCount,
          waitingCount: db.pool.waitingCount
        };
      }
    } catch (e) {
      // Pool info not available, continue without it
    }

    return {
      healthy: true,
      latency,
      timestamp: result[0]?.timestamp,
      poolInfo
    };
  } catch (error) {
    return {
      healthy: false,
      latency: Date.now() - startTime,
      error: error.message
    };
  }
}

/**
 * Execute database migration with error handling.
 * Reads and executes SQL migration files.
 *
 * @param {string} migrationSql - SQL migration content
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function runMigration(migrationSql) {
  const db = getConnection();

  try {
    // Split migration into individual statements and execute
    const statements = migrationSql
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0);

    for (const statement of statements) {
      await db.query(statement);
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: `Migration failed: ${error.message}`
    };
  }
}

/**
 * Get current environment from NODE_ENV or Vercel environment.
 * Used for tagging database records by environment.
 *
 * @returns {string} Environment name (development, preview, production)
 */
export function getCurrentEnvironment() {
  if (process.env.VERCEL_ENV) {
    return process.env.VERCEL_ENV;
  }

  return process.env.NODE_ENV || 'development';
}

/**
 * Execute query with automatic retry on connection failure.
 * Provides resilience for temporary database issues.
 *
 * @param {Function} queryFn - Function that returns query promise
 * @param {number} maxRetries - Maximum retry attempts (default 2)
 * @returns {Promise} Query result
 */
export async function executeWithRetry(queryFn, maxRetries = 2) {
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await queryFn();
    } catch (error) {
      lastError = error;

      // Don't retry on syntax errors or constraint violations
      if (error.code === '42601' || error.code === '23505') {
        throw error;
      }

      // Wait before retry (exponential backoff)
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 100));
      }
    }
  }

  throw lastError;
}