-- Migration History Table: Database-backed migration status tracking
-- Eliminates per-instance cache issues and provides audit trail

-- Create migration history table for tracking applied migrations
CREATE TABLE IF NOT EXISTS migration_history (
    version VARCHAR(255) PRIMARY KEY,
    applied_at TIMESTAMPTZ DEFAULT NOW(),
    checksum VARCHAR(64),
    execution_time_ms INTEGER,
    instance_id VARCHAR(255),
    status VARCHAR(20) DEFAULT 'completed',
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_migration_history_applied_at
ON migration_history(applied_at DESC);

CREATE INDEX IF NOT EXISTS idx_migration_history_status
ON migration_history(status);

-- Create migration locks table for advisory locking
CREATE TABLE IF NOT EXISTS migration_locks (
    lock_name VARCHAR(255) PRIMARY KEY,
    locked_at TIMESTAMPTZ DEFAULT NOW(),
    locked_by VARCHAR(255),
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for lock cleanup
CREATE INDEX IF NOT EXISTS idx_migration_locks_expires_at
ON migration_locks(expires_at);

-- Comments for documentation
COMMENT ON TABLE migration_history IS 'Tracks applied database migrations across all serverless instances';
COMMENT ON COLUMN migration_history.version IS 'Migration file name (e.g., 001_initial.sql)';
COMMENT ON COLUMN migration_history.checksum IS 'SHA-256 hash of migration content for integrity checking';
COMMENT ON COLUMN migration_history.execution_time_ms IS 'Time taken to execute migration in milliseconds';
COMMENT ON COLUMN migration_history.instance_id IS 'Serverless function instance identifier';
COMMENT ON COLUMN migration_history.status IS 'Migration status: pending, completed, failed';

COMMENT ON TABLE migration_locks IS 'Provides advisory locking for migration coordination';
COMMENT ON COLUMN migration_locks.lock_name IS 'Name of the lock (e.g., migration-execution)';
COMMENT ON COLUMN migration_locks.locked_by IS 'Instance ID that acquired the lock';
COMMENT ON COLUMN migration_locks.expires_at IS 'Lock expiration timestamp for cleanup';

-- Function to clean up expired locks (PostgreSQL function)
CREATE OR REPLACE FUNCTION cleanup_expired_migration_locks()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM migration_locks
    WHERE expires_at < NOW();

    GET DIAGNOSTICS deleted_count = ROW_COUNT;

    RETURN deleted_count;
END;
$$;