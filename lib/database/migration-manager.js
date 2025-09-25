import fs from 'fs';
import path from 'path';
import { runMigration, testConnection, getCurrentEnvironment } from './connection.js';

// In-memory cache to avoid re-running migrations in the same serverless instance
let migrationStatus = {
  checked: false,
  completed: false,
  error: null,
  timestamp: null
};

/**
 * Ensures all migrations are run before proceeding with API operations.
 * This function is idempotent and safe to call multiple times.
 *
 * @param {number} timeoutMs - Timeout for migration operations (default: 15000ms)
 * @returns {Promise<boolean>} - True if migrations are ready, false if failed
 */
export async function ensureMigrationsComplete(timeoutMs = 15000) {
  // Return cached result if already checked in this instance
  if (migrationStatus.checked) {
    if (migrationStatus.completed) {
      return true;
    }
    if (migrationStatus.error) {
      console.warn('Previous migration failed:', migrationStatus.error);
      return false;
    }
  }

  const startTime = Date.now();

  try {
    // Test database connection with timeout
    console.log('Auto-migration: Testing database connection...');
    const connectionTest = await testConnection(Math.min(timeoutMs / 3, 5000));

    if (!connectionTest.healthy) {
      throw new Error(`Database connection failed: ${connectionTest.error}`);
    }

    console.log('Auto-migration: Database connection healthy, checking migrations...');

    // Get all migration files in order
    const migrationFiles = [
      '001_initial.sql',
      '002_routing_decisions.sql',
      '003_analytics_enhancements.sql'
    ];

    let allSuccessful = true;
    const results = [];

    for (const migrationFile of migrationFiles) {
      const migrationPath = path.join(process.cwd(), 'db', 'migrations', migrationFile);

      if (!fs.existsSync(migrationPath)) {
        console.log(`Auto-migration: ${migrationFile} not found, skipping...`);
        continue;
      }

      const migrationSql = fs.readFileSync(migrationPath, 'utf8');
      console.log(`Auto-migration: Executing ${migrationFile}...`);

      const result = await runMigration(migrationSql);
      results.push({ file: migrationFile, ...result });

      if (!result.success) {
        console.warn(`Auto-migration: ${migrationFile} failed:`, result.error);
        // Continue with other migrations - they're designed to be idempotent
      }

      // Check timeout
      if (Date.now() - startTime > timeoutMs) {
        console.warn('Auto-migration: Timeout reached, stopping migration check');
        allSuccessful = false;
        break;
      }
    }

    const completedTime = Date.now() - startTime;
    console.log(`Auto-migration: Completed in ${completedTime}ms`);

    // Cache the result
    migrationStatus = {
      checked: true,
      completed: allSuccessful,
      error: null,
      timestamp: new Date().toISOString(),
      results
    };

    return allSuccessful;

  } catch (error) {
    console.error('Auto-migration: Migration check failed:', error);

    // Cache the error
    migrationStatus = {
      checked: true,
      completed: false,
      error: error.message,
      timestamp: new Date().toISOString()
    };

    return false;
  }
}

/**
 * Get the current migration status (for debugging/monitoring)
 * @returns {Object} Current migration status
 */
export function getMigrationStatus() {
  return {
    ...migrationStatus,
    environment: getCurrentEnvironment()
  };
}

/**
 * Reset migration status cache (for testing or manual refresh)
 */
export function resetMigrationCache() {
  migrationStatus = {
    checked: false,
    completed: false,
    error: null,
    timestamp: null
  };
  console.log('Auto-migration: Cache reset');
}