-- Log table schema for CLI logging
-- This is a reference schema, not applied automatically

CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  level TEXT NOT NULL CHECK (level IN ('trace', 'debug', 'info', 'warn', 'error')),
  message TEXT NOT NULL,
  data TEXT,           -- JSON serialized additional data
  session_id TEXT,     -- Groups logs by CLI session
  command TEXT,        -- CLI command that generated the log (e.g., 'lib.refresh')
  context TEXT,        -- Additional context (e.g., package name)
  error_stack TEXT,    -- Stack trace if error
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_logs_session ON logs(session_id);
CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level);
CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_logs_command ON logs(command);
