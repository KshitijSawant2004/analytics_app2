CREATE TABLE IF NOT EXISTS alert_settings (
  id SERIAL PRIMARY KEY,
  project_id VARCHAR(255) NOT NULL UNIQUE,
  emails TEXT[] NOT NULL DEFAULT '{}',
  alerts_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  severity VARCHAR(20) NOT NULL DEFAULT 'fatal',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT alert_settings_severity_check CHECK (severity IN ('fatal', 'high', 'all'))
);

CREATE TABLE IF NOT EXISTS alert_logs (
  id SERIAL PRIMARY KEY,
  project_id VARCHAR(255) NOT NULL,
  error_key VARCHAR(2048) NOT NULL,
  last_sent_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(project_id, error_key)
);

CREATE INDEX IF NOT EXISTS idx_alert_settings_project_id ON alert_settings(project_id);
CREATE INDEX IF NOT EXISTS idx_alert_logs_project_error_key ON alert_logs(project_id, error_key);