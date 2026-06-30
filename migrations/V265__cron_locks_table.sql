-- V265: Distributed cron locks to prevent duplicate sends across multiple node processes
-- ReportScheduler uses this to coordinate between parallel instances

CREATE TABLE IF NOT EXISTS cron_locks (
  lock_key VARCHAR(255) PRIMARY KEY,
  acquired_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cron_locks_expires_at ON cron_locks(expires_at);

-- Cleanup: auto-delete expired locks (optional trigger or manual cleanup via cron)
-- For now, ReportScheduler handles expiry in _acquireLock query
