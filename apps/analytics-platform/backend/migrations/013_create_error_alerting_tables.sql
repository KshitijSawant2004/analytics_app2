-- Error aggregation and alerting tables

-- Store aggregated errors grouped by message, source, line
CREATE TABLE IF NOT EXISTS error_aggregates (
  id SERIAL PRIMARY KEY,
  project_id VARCHAR(255) NOT NULL,
  error_message VARCHAR(1024) NOT NULL,
  error_source VARCHAR(512),
  error_line INTEGER,
  error_count INTEGER DEFAULT 1,
  unique_user_count INTEGER DEFAULT 1,
  first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, error_message, error_source, error_line)
);

-- Track which users have encountered each error
CREATE TABLE IF NOT EXISTS error_users (
  id SERIAL PRIMARY KEY,
  error_aggregate_id INTEGER NOT NULL REFERENCES error_aggregates(id) ON DELETE CASCADE,
  user_id VARCHAR(255) NOT NULL,
  first_occurrence TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(error_aggregate_id, user_id)
);

-- Store alert logs to prevent duplicate alerts
CREATE TABLE IF NOT EXISTS alert_logs (
  id SERIAL PRIMARY KEY,
  project_id VARCHAR(255) NOT NULL,
  error_aggregate_id INTEGER NOT NULL REFERENCES error_aggregates(id) ON DELETE CASCADE,
  alert_type VARCHAR(50) NOT NULL, -- 'frequency', 'user_impact', 'critical_page'
  alert_message TEXT,
  recipients VARCHAR(1024),
  sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_error_aggregates_project_id ON error_aggregates(project_id);
CREATE INDEX IF NOT EXISTS idx_error_aggregates_created_at ON error_aggregates(created_at);
CREATE INDEX IF NOT EXISTS idx_alert_logs_project_id ON alert_logs(project_id);
CREATE INDEX IF NOT EXISTS idx_alert_logs_created_at ON alert_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_alert_logs_error_aggregate_id ON alert_logs(error_aggregate_id);
