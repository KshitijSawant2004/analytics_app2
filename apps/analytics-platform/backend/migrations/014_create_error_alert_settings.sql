CREATE TABLE IF NOT EXISTS error_alert_settings (
  project_id VARCHAR(255) PRIMARY KEY,
  recipients TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);