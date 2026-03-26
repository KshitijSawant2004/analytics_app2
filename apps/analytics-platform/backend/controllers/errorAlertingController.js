const {
  FATAL_ERROR_RULES,
  aggregateError,
  evaluateFatalRules,
  getErrorStats,
  getRecentCriticalErrors,
} = require("../services/errorAggregationService");
const { sendErrorAlert, testEmailConfiguration, sendTestAlertEmail } = require("../services/alertingService");
const {
  getAlertSettings: getAlertSettingsForProject,
  saveAlertSettings: saveAlertSettingsForProject,
  buildErrorKey,
  shouldSendAlertByErrorKey,
  recordAlertSent,
} = require("../services/errorAlertSettingsService");

function evaluateHighSeverity(aggregate, isFatal) {
  if (isFatal) return true;
  return Number(aggregate?.error_count || 0) >= 5 || Number(aggregate?.unique_user_count || 0) >= 3;
}

function shouldTriggerForSeverity(severity, aggregate, isFatal) {
  const normalized = String(severity || "fatal").toLowerCase();
  if (normalized === "all") return true;
  if (normalized === "high") return evaluateHighSeverity(aggregate, isFatal);
  return isFatal;
}

async function processErrorPayload(payload = {}) {
  const {
    project_id,
    event_name,
    user_id,
    session_id,
    page,
    url,
    timestamp,
    properties = {},
  } = payload;

  if (event_name !== "error") {
    return { success: false, status: 400, error: "Invalid event type" };
  }

  if (!project_id) {
    return { success: false, status: 400, error: "project_id is required" };
  }

  const { message, source, line } = properties;

  if (!message) {
    return { success: false, status: 400, error: "Error message is required in properties" };
  }

  const errorData = await aggregateError(project_id, {
    message,
    source,
    line,
    userId: user_id,
    sessionId: session_id,
    timestamp,
    pageUrl: url || page,
  });

  const { isFatal, rules } = evaluateFatalRules(errorData.aggregate, errorData.pageUrl);
  const settings = await getAlertSettingsForProject(project_id);
  const shouldTrigger = settings.alertsEnabled
    && shouldTriggerForSeverity(settings.severity, errorData.aggregate, isFatal);

  if (shouldTrigger) {
    const errorKey = buildErrorKey(errorData);
    const canSendAlert = await shouldSendAlertByErrorKey(
      project_id,
      errorKey,
      FATAL_ERROR_RULES.ALERT_COOLDOWN_MS
    );

    if (canSendAlert) {
      const severityReason =
        settings.severity === "all"
          ? "Severity setting: all"
          : settings.severity === "high"
            ? "Severity setting: high"
            : "Severity setting: fatal";
      const ruleMessages = rules.length > 0
        ? rules.map((rule) => rule.message)
        : ["High severity threshold triggered", severityReason];

      const alertSent = await sendErrorAlert(
        project_id,
        errorData,
        errorData.aggregate,
        ruleMessages.map((msg) => ({ message: msg })),
        settings.emails,
        {
          sessionId: session_id,
            userId: user_id,
          timestamp,
        }
      );

      if (alertSent) {
        try {
          await recordAlertSent(project_id, errorKey);
        } catch (logError) {
          console.warn("Alert sent but failed to persist alert log:", logError?.message || logError);
        }
      }
    }
  }

  return {
    success: true,
    aggregateId: errorData.aggregateId,
    isFatal,
    isHigh: evaluateHighSeverity(errorData.aggregate, isFatal),
    alertSeverity: settings.severity,
    alertsEnabled: settings.alertsEnabled,
    rulesTriggered: rules.length,
  };
}

/**
 * Process error events from tracking system
 * POST /errors
 */
async function processError(req, res) {
  try {
    const result = await processErrorPayload(req.body || {});
    if (!result.success) {
      return res.status(result.status || 400).json({ error: result.error || "Failed to process error" });
    }
    res.json(result);
  } catch (err) {
    console.error("Error processing error event:", err);
    res.status(500).json({ error: "Failed to process error" });
  }
}

/**
 * Get error statistics for a project
 * GET /errors/stats?project_id=...&minutes=60
 */
async function getErrorStats_(req, res) {
  try {
    const { project_id, minutes = 60 } = req.query;

    if (!project_id) {
      return res.status(400).json({ error: "project_id is required" });
    }

    const stats = await getErrorStats(project_id, parseInt(minutes));

    res.json({
      success: true,
      project_id,
      timeWindowMinutes: parseInt(minutes),
      stats,
    });
  } catch (err) {
    console.error("Error fetching stats:", err);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
}

/**
 * Get recent critical errors
 * GET /errors/critical?project_id=...&limit=10
 */
async function getCriticalErrors(req, res) {
  try {
    const { project_id, limit = 10 } = req.query;

    if (!project_id) {
      return res.status(400).json({ error: "project_id is required" });
    }

    const errors = await getRecentCriticalErrors(project_id, parseInt(limit));

    res.json({
      success: true,
      project_id,
      errors,
    });
  } catch (err) {
    console.error("Error fetching critical errors:", err);
    res.status(500).json({ error: "Failed to fetch critical errors" });
  }
}

/**
 * Test email alerting configuration
 * GET /errors/test-alert
 */
async function testAlert(req, res) {
  try {
    const projectId = String(req.query.project_id || "*").trim() || "*";
    const verifyResult = await testEmailConfiguration();

    if (!verifyResult.success) {
      return res.status(400).json({
        success: false,
        message: verifyResult.message,
      });
    }

    const settings = await getAlertSettingsForProject(projectId);
    const sendResult = await sendTestAlertEmail({
      recipients: settings.emails || [],
      projectId,
    });

    if (!sendResult.success) {
      return res.status(400).json({
        success: false,
        message: sendResult.message,
      });
    }

    res.json({
      success: true,
      message: `Test alert email sent to ${(sendResult.recipients || []).join(", ")}`,
      project_id: projectId,
      recipients: sendResult.recipients || [],
      message_id: sendResult.messageId || "",
    });
  } catch (err) {
    console.error("Error testing alert:", err);
    res.status(500).json({ error: "Failed to test alert" });
  }
}

/**
 * Get alert settings for project
 * GET /alerts/settings?project_id=proj_123
 */
async function getAlertSettings(req, res) {
  try {
    const projectId = String(req.query.project_id || "*").trim() || "*";
    const config = await getAlertSettingsForProject(projectId);

    res.json({
      success: true,
      project_id: projectId,
      emails: config.emails || [],
      alerts_enabled: config.alertsEnabled,
      severity: config.severity,
      source: config.source,
      resolved_project_id: config.projectId,
    });
  } catch (err) {
    console.error("Error fetching alert settings:", err);
    res.status(500).json({ error: "Failed to fetch alert settings" });
  }
}

/**
 * Upsert alert settings for project
 * POST /alerts/settings
 */
async function updateAlertSettings(req, res) {
  try {
    const projectId = String(req.body.project_id || "*").trim() || "*";
    const { emails = [], alerts_enabled = true, severity = "fatal" } = req.body;

    const result = await saveAlertSettingsForProject(projectId, {
      emails,
      alerts_enabled,
      severity,
    });

    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error,
        invalidEmails: result.invalidEmails || [],
      });
    }

    res.json({
      success: true,
      project_id: result.projectId,
      emails: result.emails,
      alerts_enabled: result.alertsEnabled,
      severity: result.severity,
    });
  } catch (err) {
    console.error("Error updating alert settings:", err);
    res.status(500).json({ error: "Failed to update alert settings" });
  }
}

module.exports = {
  processError,
  processErrorPayload,
  getErrorStats: getErrorStats_,
  getCriticalErrors,
  testAlert,
  getAlertSettings,
  updateAlertSettings,
};
