const pool = require("../db");

let ensureSettingsTablePromise = null;
const SEVERITIES = new Set(["fatal", "high", "all"]);

async function ensureSettingsTable() {
  if (ensureSettingsTablePromise) return ensureSettingsTablePromise;

  ensureSettingsTablePromise = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS alert_settings (
        id SERIAL PRIMARY KEY,
        project_id VARCHAR(255) NOT NULL UNIQUE,
        emails TEXT[] NOT NULL DEFAULT '{}',
        alerts_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        severity VARCHAR(20) NOT NULL DEFAULT 'fatal',
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT alert_settings_severity_check CHECK (severity IN ('fatal', 'high', 'all'))
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS alert_logs (
        id SERIAL PRIMARY KEY,
        project_id VARCHAR(255) NOT NULL,
        error_key VARCHAR(2048) NOT NULL,
        last_sent_at TIMESTAMP NOT NULL DEFAULT NOW(),
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE(project_id, error_key)
      )
    `);

    await pool.query(`ALTER TABLE alert_logs ADD COLUMN IF NOT EXISTS error_key VARCHAR(2048)`);
    await pool.query(`ALTER TABLE alert_logs ADD COLUMN IF NOT EXISTS last_sent_at TIMESTAMP DEFAULT NOW()`);
    await pool.query(`ALTER TABLE alert_logs ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW()`);
    await pool.query(`ALTER TABLE alert_logs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_alert_settings_project_id ON alert_settings(project_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_alert_logs_project_error_key ON alert_logs(project_id, error_key)`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_logs_project_error_key ON alert_logs(project_id, error_key)`);
  })();

  try {
    await ensureSettingsTablePromise;
  } catch (error) {
    ensureSettingsTablePromise = null;
    throw error;
  }
}

function normalizeEmails(input) {
  const raw = Array.isArray(input) ? input.join(",") : String(input || "");

  const seen = new Set();

  return raw
    .split(/[;,\n]/)
    .map((email) => email.trim())
    .filter(Boolean)
    .filter((email) => {
      const key = email.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function validateEmails(emails) {
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emails.filter((email) => !emailPattern.test(email));
}

function sanitizeSeverity(value) {
  const normalized = String(value || "fatal").toLowerCase();
  return SEVERITIES.has(normalized) ? normalized : "fatal";
}

function buildErrorKey({ normalizedMessage, normalizedSource, normalizedLine }) {
  return [
    String(normalizedMessage || ""),
    String(normalizedSource || ""),
    String(normalizedLine || 0),
  ].join("|");
}

async function getAlertSettings(projectId) {
  await ensureSettingsTable();

  const scopedProjectId = String(projectId || "*").trim() || "*";

  const scopedResult = await pool.query(
    `SELECT project_id, emails, alerts_enabled, severity FROM alert_settings WHERE project_id = $1 LIMIT 1`,
    [scopedProjectId]
  );

  const globalResult = await pool.query(
    `SELECT project_id, emails, alerts_enabled, severity FROM alert_settings WHERE project_id = '*' LIMIT 1`
  );

  const scopedRow = scopedResult.rows[0] || null;
  const globalRow = globalResult.rows[0] || null;
  const envEmails = normalizeEmails(process.env.ALERT_EMAIL_RECIPIENTS || "");

  const mergedEmails = normalizeEmails([
    ...(Array.isArray(scopedRow?.emails) ? scopedRow.emails : []),
    ...(Array.isArray(globalRow?.emails) ? globalRow.emails : []),
    ...envEmails,
  ]);

  const alertsEnabled =
    scopedRow?.alerts_enabled != null
      ? Boolean(scopedRow.alerts_enabled)
      : globalRow?.alerts_enabled != null
        ? Boolean(globalRow.alerts_enabled)
        : true;

  const severity = sanitizeSeverity(scopedRow?.severity || globalRow?.severity || "fatal");

  if (scopedRow) {
    return {
      projectId: scopedRow.project_id,
      emails: mergedEmails,
      alertsEnabled,
      severity,
      source: globalRow ? "db-merged" : "db",
    };
  }

  if (globalRow) {
    return {
      projectId: globalRow.project_id,
      emails: mergedEmails,
      alertsEnabled,
      severity,
      source: scopedProjectId === "*" ? "db" : "db-global",
    };
  }

  return {
    projectId: scopedProjectId,
    emails: envEmails,
    alertsEnabled: true,
    severity: "fatal",
    source: "env",
  };
}

async function saveAlertSettings(projectId, settingsInput = {}) {
  await ensureSettingsTable();

  const scopedProjectId = String(projectId || "*").trim() || "*";
  const parsedEmails = normalizeEmails(settingsInput.emails);
  const invalidEmails = validateEmails(parsedEmails);
  const alertsEnabled = settingsInput.alerts_enabled !== false;
  const severity = sanitizeSeverity(settingsInput.severity);

  if (alertsEnabled && parsedEmails.length === 0) {
    return {
      success: false,
      error: "At least one recipient email is required when alerts are enabled",
      invalidEmails,
    };
  }

  if (invalidEmails.length > 0) {
    return {
      success: false,
      error: "Invalid email format detected",
      invalidEmails,
    };
  }

  await pool.query(
    `INSERT INTO alert_settings (project_id, emails, alerts_enabled, severity, updated_at)
     VALUES ($1, $2::text[], $3, $4, NOW())
     ON CONFLICT (project_id)
     DO UPDATE SET emails = EXCLUDED.emails, alerts_enabled = EXCLUDED.alerts_enabled, severity = EXCLUDED.severity, updated_at = NOW()`,
    [scopedProjectId, parsedEmails, alertsEnabled, severity]
  );

  return {
    success: true,
    projectId: scopedProjectId,
    emails: parsedEmails,
    alertsEnabled,
    severity,
  };
}

async function shouldSendAlertByErrorKey(projectId, errorKey, cooldownMs) {
  await ensureSettingsTable();

  const scopedProjectId = String(projectId || "*").trim() || "*";
  const result = await pool.query(
    `SELECT last_sent_at FROM alert_logs WHERE project_id = $1 AND error_key = $2 LIMIT 1`,
    [scopedProjectId, errorKey]
  );

  if (result.rows.length === 0) return true;

  const lastSentAt = new Date(result.rows[0].last_sent_at).getTime();
  return Date.now() - lastSentAt >= Number(cooldownMs || 0);
}

async function recordAlertSent(projectId, errorKey) {
  await ensureSettingsTable();

  const scopedProjectId = String(projectId || "*").trim() || "*";
  await pool.query(
    `INSERT INTO alert_logs (project_id, error_key, last_sent_at, updated_at)
     VALUES ($1, $2, NOW(), NOW())
     ON CONFLICT (project_id, error_key)
     DO UPDATE SET last_sent_at = NOW(), updated_at = NOW()`,
    [scopedProjectId, errorKey]
  );
}

module.exports = {
  normalizeEmails,
  getAlertSettings,
  saveAlertSettings,
  sanitizeSeverity,
  buildErrorKey,
  shouldSendAlertByErrorKey,
  recordAlertSent,
};