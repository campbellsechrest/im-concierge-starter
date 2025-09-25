import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { runMigration, testConnection, getCurrentEnvironment, getConnection } from './connection.js';

// Instance-level cache to avoid repeated database checks within same execution
let instanceCache = {
  lastCheck: null,
  allMigrationsComplete: false,
  checkIntervalMs: 30000 // Re-check every 30 seconds max
};

// Generate instance ID for tracking
const INSTANCE_ID = `${process.env.VERCEL_REGION || 'local'}-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;

/**
 * Acquire advisory lock for migration execution
 * @param {string} lockName - Name of the lock
 * @param {number} timeoutMs - Lock timeout in milliseconds
 * @returns {Promise<boolean>} - True if lock acquired
 */
async function acquireMigrationLock(lockName, timeoutMs = 30000) {
  const db = getConnection();
  const expiresAt = new Date(Date.now() + timeoutMs).toISOString();

  try {
    // Clean up expired locks first
    await db`DELETE FROM migration_locks WHERE expires_at < NOW()`;

    // Try to acquire lock
    const result = await db`
      INSERT INTO migration_locks (lock_name, locked_by, expires_at)
      VALUES (${lockName}, ${INSTANCE_ID}, ${expiresAt})
      ON CONFLICT (lock_name) DO NOTHING
      RETURNING lock_name
    `;

    const acquired = result.length > 0 || (result.rows && result.rows.length > 0);

    if (acquired) {
      console.log(`Migration lock acquired: ${lockName} by ${INSTANCE_ID}`);
    }

    return acquired;
  } catch (error) {
    console.error('Error acquiring migration lock:', error);
    return false;
  }
}

/**
 * Release migration lock
 * @param {string} lockName - Name of the lock
 */
async function releaseMigrationLock(lockName) {
  const db = getConnection();

  try {
    await db`
      DELETE FROM migration_locks
      WHERE lock_name = ${lockName} AND locked_by = ${INSTANCE_ID}
    `;
    console.log(`Migration lock released: ${lockName} by ${INSTANCE_ID}`);
  } catch (error) {
    console.error('Error releasing migration lock:', error);
  }
}

/**
 * Check if a specific migration has been applied
 * @param {string} version - Migration version (filename)
 * @returns {Promise<boolean>}
 */
async function isMigrationApplied(version) {
  const db = getConnection();

  try {
    const result = await db`
      SELECT 1 FROM migration_history
      WHERE version = ${version} AND status = 'completed'
    `;

    return result.length > 0 || (result.rows && result.rows.length > 0);
  } catch (error) {
    // If migration_history table doesn't exist, assume migration not applied
    if (error.message.includes('relation "migration_history" does not exist')) {
      return false;
    }
    throw error;
  }
}

/**
 * Record migration attempt in database
 * @param {string} version - Migration version
 * @param {string} status - Migration status (pending, completed, failed)
 * @param {Object} options - Additional options
 */
async function recordMigrationAttempt(version, status, options = {}) {
  const db = getConnection();

  try {
    const checksum = options.checksum || null;
    const executionTime = options.executionTimeMs || null;
    const errorMessage = options.errorMessage || null;

    await db`
      INSERT INTO migration_history (
        version,
        status,
        checksum,
        execution_time_ms,
        instance_id,
        error_message
      ) VALUES (
        ${version},
        ${status},
        ${checksum},
        ${executionTime},
        ${INSTANCE_ID},
        ${errorMessage}
      )
      ON CONFLICT (version) DO UPDATE SET
        status = EXCLUDED.status,
        execution_time_ms = COALESCE(EXCLUDED.execution_time_ms, migration_history.execution_time_ms),
        instance_id = EXCLUDED.instance_id,
        error_message = EXCLUDED.error_message,
        applied_at = CASE
          WHEN EXCLUDED.status = 'completed' THEN NOW()
          ELSE migration_history.applied_at
        END
    `;

    console.log({
      event: 'migration_recorded',
      version,
      status,
      instance_id: INSTANCE_ID,
      execution_time_ms: executionTime
    });

  } catch (error) {
    console.error('Error recording migration:', error);
    // Don't throw - migration recording is for tracking, not critical
  }
}

/**
 * Calculate SHA-256 checksum of migration content
 * @param {string} content - Migration file content
 * @returns {string} - Hex checksum
 */
function calculateChecksum(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Get all pending migrations by checking database vs filesystem
 * @returns {Promise<Array>} - Array of pending migration info
 */
async function getPendingMigrations() {
  const migrationFiles = [
    '001_initial.sql',
    '002_routing_decisions.sql',
    '003_analytics_enhancements.sql',
    '004_migration_history.sql'
  ];

  const pending = [];

  for (const file of migrationFiles) {
    const migrationPath = path.join(process.cwd(), 'db', 'migrations', file);

    if (!fs.existsSync(migrationPath)) {
      continue;
    }

    const applied = await isMigrationApplied(file);
    if (!applied) {
      const content = fs.readFileSync(migrationPath, 'utf8');
      pending.push({
        version: file,
        checksum: calculateChecksum(content),
        path: migrationPath,
        content
      });
    }
  }

  return pending;
}

/**
 * Ensures all migrations are run before proceeding with API operations.
 * Uses database-backed status tracking with advisory locking.
 *
 * @param {number} timeoutMs - Timeout for migration operations (default: 15000ms)
 * @returns {Promise<boolean>} - True if migrations are ready, false if failed
 */
export async function ensureMigrationsComplete(timeoutMs = 15000) {
  const startTime = Date.now();

  // Check instance cache first (avoid repeated DB queries)
  if (instanceCache.lastCheck && instanceCache.allMigrationsComplete) {
    const timeSinceCheck = Date.now() - instanceCache.lastCheck;
    if (timeSinceCheck < instanceCache.checkIntervalMs) {
      return true;
    }
  }

  try {
    // Test database connection with timeout
    console.log({
      event: 'migration_check_start',
      instance_id: INSTANCE_ID,
      timeout_ms: timeoutMs
    });

    const connectionTest = await testConnection(Math.min(timeoutMs / 3, 5000));

    if (!connectionTest.healthy) {
      throw new Error(`Database connection failed: ${connectionTest.error}`);
    }

    // Get pending migrations
    const pendingMigrations = await getPendingMigrations();

    if (pendingMigrations.length === 0) {
      console.log({
        event: 'migrations_complete',
        instance_id: INSTANCE_ID,
        check_duration_ms: Date.now() - startTime
      });

      // Update instance cache
      instanceCache.lastCheck = Date.now();
      instanceCache.allMigrationsComplete = true;

      return true;
    }

    console.log({
      event: 'migrations_pending',
      instance_id: INSTANCE_ID,
      pending_count: pendingMigrations.length,
      pending_versions: pendingMigrations.map(m => m.version)
    });

    // Try to acquire migration lock
    const lockAcquired = await acquireMigrationLock('migration-execution', timeoutMs);

    if (!lockAcquired) {
      // Another instance is likely running migrations
      console.log({
        event: 'migration_lock_failed',
        instance_id: INSTANCE_ID,
        action: 'waiting_for_completion'
      });

      // Wait and check again (exponential backoff)
      const waitTime = Math.min(1000 + Math.random() * 2000, 5000);
      await new Promise(resolve => setTimeout(resolve, waitTime));

      // Recursive check with reduced timeout
      const remainingTime = timeoutMs - (Date.now() - startTime);
      if (remainingTime > 1000) {
        return ensureMigrationsComplete(remainingTime);
      } else {
        console.warn('Migration timeout reached while waiting for lock');
        return false;
      }
    }

    // Execute pending migrations
    try {
      let allSuccessful = true;

      for (const migration of pendingMigrations) {
        // Double-check if migration was applied by another instance
        if (await isMigrationApplied(migration.version)) {
          console.log({
            event: 'migration_already_applied',
            version: migration.version,
            instance_id: INSTANCE_ID
          });
          continue;
        }

        // Record pending status
        await recordMigrationAttempt(migration.version, 'pending', {
          checksum: migration.checksum
        });

        const migrationStart = Date.now();
        console.log({
          event: 'migration_start',
          version: migration.version,
          instance_id: INSTANCE_ID
        });

        // Execute migration
        const result = await runMigration(migration.content);
        const executionTime = Date.now() - migrationStart;

        if (result.success) {
          await recordMigrationAttempt(migration.version, 'completed', {
            checksum: migration.checksum,
            executionTimeMs: executionTime
          });

          console.log({
            event: 'migration_success',
            version: migration.version,
            instance_id: INSTANCE_ID,
            execution_time_ms: executionTime
          });
        } else {
          await recordMigrationAttempt(migration.version, 'failed', {
            checksum: migration.checksum,
            executionTimeMs: executionTime,
            errorMessage: result.error
          });

          console.error({
            event: 'migration_failed',
            version: migration.version,
            instance_id: INSTANCE_ID,
            error: result.error
          });

          allSuccessful = false;
          // Continue with remaining migrations for idempotency
        }

        // Check timeout
        if (Date.now() - startTime > timeoutMs) {
          console.warn('Migration timeout reached during execution');
          allSuccessful = false;
          break;
        }
      }

      // Update instance cache
      instanceCache.lastCheck = Date.now();
      instanceCache.allMigrationsComplete = allSuccessful;

      console.log({
        event: 'migration_check_complete',
        instance_id: INSTANCE_ID,
        success: allSuccessful,
        total_duration_ms: Date.now() - startTime
      });

      return allSuccessful;

    } finally {
      // Always release the lock
      await releaseMigrationLock('migration-execution');
    }

  } catch (error) {
    console.error({
      event: 'migration_check_error',
      instance_id: INSTANCE_ID,
      error: error.message,
      duration_ms: Date.now() - startTime
    });

    return false;
  }
}

/**
 * Get comprehensive migration status from database
 * @returns {Promise<Object>} Migration status information
 */
export async function getMigrationStatus() {
  const db = getConnection();

  try {
    // Get applied migrations
    const appliedMigrations = await db`
      SELECT version, applied_at, status, execution_time_ms, instance_id, error_message
      FROM migration_history
      ORDER BY applied_at DESC
    `;

    // Get current locks
    const activeLocks = await db`
      SELECT lock_name, locked_by, locked_at, expires_at
      FROM migration_locks
      WHERE expires_at > NOW()
    `;

    // Get pending migrations
    const pendingMigrations = await getPendingMigrations();

    return {
      instance_id: INSTANCE_ID,
      environment: getCurrentEnvironment(),
      applied_migrations: (appliedMigrations.rows || appliedMigrations).map(row => ({
        version: row.version,
        appliedAt: row.applied_at,
        status: row.status,
        executionTimeMs: row.execution_time_ms,
        instanceId: row.instance_id,
        errorMessage: row.error_message
      })),
      pending_migrations: pendingMigrations.map(m => ({
        version: m.version,
        checksum: m.checksum
      })),
      active_locks: (activeLocks.rows || activeLocks).map(lock => ({
        lockName: lock.lock_name,
        lockedBy: lock.locked_by,
        lockedAt: lock.locked_at,
        expiresAt: lock.expires_at
      })),
      instance_cache: {
        lastCheck: instanceCache.lastCheck,
        allMigrationsComplete: instanceCache.allMigrationsComplete
      },
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    console.error('Error getting migration status:', error);
    return {
      instance_id: INSTANCE_ID,
      environment: getCurrentEnvironment(),
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Reset instance-level cache (for testing or manual refresh)
 */
export function resetMigrationCache() {
  instanceCache = {
    lastCheck: null,
    allMigrationsComplete: false,
    checkIntervalMs: 30000
  };

  console.log({
    event: 'migration_cache_reset',
    instance_id: INSTANCE_ID
  });
}