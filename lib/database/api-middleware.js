import { ensureMigrationsComplete } from './migration-manager-v2.js';
import { getCurrentEnvironment } from './connection.js';

/**
 * Middleware wrapper for API endpoints that need database access.
 * Ensures migrations are complete before proceeding with the actual handler.
 *
 * @param {Function} handler - The actual API handler function
 * @param {Object} options - Configuration options
 * @param {boolean} options.requireMigrations - Whether to enforce migrations (default: true)
 * @param {number} options.migrationTimeout - Timeout for migrations (default: 10000ms)
 * @returns {Function} Wrapped handler function
 */
export function withAutoMigration(handler, options = {}) {
  const {
    requireMigrations = true,
    migrationTimeout = 10000
  } = options;

  return async function wrappedHandler(req, res) {
    // Skip migration check for OPTIONS requests
    if (req.method === 'OPTIONS') {
      return handler(req, res);
    }

    if (requireMigrations) {
      try {
        const migrationsReady = await ensureMigrationsComplete(migrationTimeout);

        if (!migrationsReady) {
          console.error('API request blocked: Migrations not complete');
          return res.status(503).json({
            success: false,
            error: 'Database migrations not complete',
            details: 'The database schema is not ready. Please try again in a moment.',
            environment: getCurrentEnvironment(),
            retryAfter: 30 // Suggest client retry after 30 seconds
          });
        }
      } catch (error) {
        console.error('Migration check error:', error);
        return res.status(503).json({
          success: false,
          error: 'Migration check failed',
          details: error.message,
          environment: getCurrentEnvironment()
        });
      }
    }

    // Proceed with the original handler
    return handler(req, res);
  };
}

/**
 * Express-style middleware function that can be used in route handlers
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @param {Function} next - Next function (if using Express-style middleware)
 * @returns {Promise<void>}
 */
export async function ensureMigrationsMiddleware(req, res, next) {
  if (req.method === 'OPTIONS') {
    return next ? next() : undefined;
  }

  try {
    const migrationsReady = await ensureMigrationsComplete();

    if (!migrationsReady) {
      return res.status(503).json({
        success: false,
        error: 'Database migrations not complete',
        environment: getCurrentEnvironment()
      });
    }

    if (next) {
      next();
    }
  } catch (error) {
    console.error('Migration middleware error:', error);
    return res.status(503).json({
      success: false,
      error: 'Migration check failed',
      details: error.message,
      environment: getCurrentEnvironment()
    });
  }
}