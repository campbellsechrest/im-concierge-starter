import { getConnection, getCurrentEnvironment } from '../lib/database/connection.js';

const ORIGIN_ALLOWED = process.env.ORIGIN_ALLOWED || '*';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN_ALLOWED);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'GET only' });
  }

  try {
    const db = getConnection();
    const env = getCurrentEnvironment();

    // Check if migration_history table exists
    const tableExists = await db`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'migration_history'
      )
    `;

    const exists = tableExists[0]?.exists || tableExists.rows?.[0]?.exists;

    if (!exists) {
      return res.json({
        success: false,
        error: 'migration_history table does not exist',
        environment: env
      });
    }

    // Get migration records
    const migrations = await db`
      SELECT version, applied_at, status, instance_id
      FROM migration_history
      ORDER BY applied_at DESC
      LIMIT 10
    `;

    // Get active locks
    const locks = await db`
      SELECT lock_name, locked_by, expires_at
      FROM migration_locks
      WHERE expires_at > NOW()
    `;

    return res.json({
      success: true,
      data: {
        environment: env,
        migration_history_exists: true,
        migrations: (migrations.rows || migrations).map(row => ({
          version: row.version,
          appliedAt: row.applied_at,
          status: row.status,
          instanceId: row.instance_id
        })),
        active_locks: (locks.rows || locks).map(row => ({
          lockName: row.lock_name,
          lockedBy: row.locked_by,
          expiresAt: row.expires_at
        }))
      }
    });

  } catch (error) {
    console.error('Debug migration error:', error);
    return res.status(500).json({
      success: false,
      error: 'Debug migration failed',
      details: error.message,
      environment: getCurrentEnvironment()
    });
  }
}