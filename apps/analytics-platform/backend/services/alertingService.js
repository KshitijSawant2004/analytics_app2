const nodemailer = require("nodemailer");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

// Configure email transporter from environment variables
let transporter = null;

function initializeTransporter() {
  const emailService = process.env.EMAIL_SERVICE || "gmail";
  const emailUser = process.env.EMAIL_USER;
  const emailPass = process.env.EMAIL_PASSWORD;
  const emailHost = process.env.EMAIL_HOST;
  const emailPort = process.env.EMAIL_PORT;
  const emailSecure = process.env.EMAIL_SECURE === "true";

  // Use custom SMTP config if provided
  if (emailHost && emailPort) {
    transporter = nodemailer.createTransport({
      host: emailHost,
      port: parseInt(emailPort),
      secure: emailSecure,
      auth: emailUser && emailPass ? { user: emailUser, pass: emailPass } : undefined,
    });
  }
  // Otherwise use service provider
  else if (emailService && emailUser && emailPass) {
    transporter = nodemailer.createTransport({
      service: emailService,
      auth: { user: emailUser, pass: emailPass },
    });
  } else {
    console.warn("Email credentials not configured. Error alerts will not be sent.");
    transporter = null;
  }
}

/**
 * Build HTML email body for error alert
 */
function buildErrorEmailHtml(projectId, errorData, aggregate, ruleMessages, context = {}) {
  const {
    normalizedMessage,
    normalizedSource,
    normalizedLine,
    pageUrl,
  } = errorData;

  const dashboardBase = String(process.env.DASHBOARD_URL || "http://localhost:3001").replace(/\/+$/, "");
  const replayParams = new URLSearchParams();
  if (context.sessionId) {
    replayParams.set("sessionId", String(context.sessionId));
  }
  if (context.userId) {
    replayParams.set("userId", String(context.userId));
  }
  const replayQuery = replayParams.toString();
  const replayLink = `${dashboardBase}/session-replays${replayQuery ? `?${replayQuery}` : ""}`;
  const occurredAt = context.timestamp ? new Date(context.timestamp).toISOString() : new Date().toISOString();

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #ef4444; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
        .header h1 { margin: 0; font-size: 24px; }
        .content { background: #f9fafb; padding: 20px; border-radius: 0 0 8px 8px; }
        .section { margin-bottom: 20px; }
        .section-title { font-weight: 600; color: #1f2937; margin-bottom: 8px; }
        .error-message { background: #fee2e2; padding: 12px; border-left: 4px solid #ef4444; border-radius: 4px; font-family: 'Monaco', monospace; font-size: 13px; }
        .stats { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px; }
        .stat-box { background: white; padding: 12px; border-radius: 4px; border: 1px solid #e5e7eb; }
        .stat-label { font-size: 12px; color: #6b7280; }
        .stat-value { font-size: 24px; font-weight: 600; color: #1f2937; }
        .rules { background: #fef3c7; padding: 12px; border-left: 4px solid #f59e0b; border-radius: 4px; }
        .rule-item { margin: 8px 0; font-size: 14px; }
        .cta { margin-top: 20px; }
        .cta a { display: inline-block; background: #3b82f6; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 500; }
        .footer { font-size: 12px; color: #6b7280; margin-top: 20px; text-align: center; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🚨 Critical Error Detected</h1>
        </div>
        <div class="content">
          <div class="section">
            <div class="section-title">Error Message</div>
            <div class="error-message">${escapeHtml(normalizedMessage)}</div>
          </div>

          <div class="section">
            <div class="section-title">Details</div>
            <p><strong>Source:</strong> ${escapeHtml(normalizedSource || "Unknown")}</p>
            <p><strong>Line:</strong> ${normalizedLine || "Unknown"}</p>
            <p><strong>Page:</strong> ${escapeHtml(pageUrl || "Unknown")}</p>
            <p><strong>Project:</strong> ${escapeHtml(projectId)}</p>
            <p><strong>Timestamp:</strong> ${escapeHtml(occurredAt)}</p>
          </div>

          <div class="section">
            <div class="section-title">Impact</div>
            <div class="stats">
              <div class="stat-box">
                <div class="stat-label">Total Occurrences</div>
                <div class="stat-value">${aggregate.error_count}</div>
              </div>
              <div class="stat-box">
                <div class="stat-label">Unique Users Affected</div>
                <div class="stat-value">${aggregate.unique_user_count}</div>
              </div>
            </div>
          </div>

          <div class="section">
            <div class="section-title">Alert Reasons</div>
            <div class="rules">
              ${ruleMessages.map((msg) => `<div class="rule-item">✓ ${escapeHtml(msg)}</div>`).join("")}
            </div>
          </div>

          <div class="cta">
            <a href="${replayLink}">View Replay →</a>
          </div>

          <div class="footer">
            <p>Analytics Alert System | Sent at ${new Date().toISOString()}</p>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text) {
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return String(text).replace(/[&<>"']/g, (char) => map[char]);
}

/**
 * Send error alert email
 */
async function sendErrorAlert(projectId, errorData, aggregate, rules, recipients = [], context = {}) {
  if (!transporter) {
    console.warn("Email transporter not configured. Alert not sent.");
    return false;
  }

  try {
    const recipientList = Array.isArray(recipients)
      ? recipients.filter(Boolean)
      : String(recipients || "")
          .split(/[;,\n]/)
          .map((email) => email.trim())
          .filter(Boolean);

    if (recipientList.length === 0) {
      console.warn("No alert email recipients configured.");
      return false;
    }

    const ruleMessages = rules.map((r) => r.message);

    const mailOptions = {
      from: process.env.EMAIL_USER || "noreply@analytics.local",
      to: recipientList.join(","),
      subject: "🚨 Critical Error Detected",
      html: buildErrorEmailHtml(projectId, errorData, aggregate, ruleMessages, context),
    };

    const info = await transporter.sendMail(mailOptions);
    console.log("Error alert email sent:", info.messageId);
    return true;
  } catch (err) {
    console.error("Error sending alert email:", err);
    return false;
  }
}

/**
 * Test email configuration
 */
async function testEmailConfiguration() {
  if (!transporter) {
    return { success: false, message: "Email transporter not configured" };
  }

  try {
    await transporter.verify();
    return { success: true, message: "Email configuration verified" };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

async function sendTestAlertEmail({ recipients = [], projectId = "*" } = {}) {
  if (!transporter) {
    return { success: false, message: "Email transporter not configured" };
  }

  const recipientList = Array.isArray(recipients)
    ? recipients.filter(Boolean)
    : String(recipients || "")
        .split(/[;,\n]/)
        .map((email) => email.trim())
        .filter(Boolean);

  if (recipientList.length === 0) {
    return { success: false, message: "No recipients configured for test email" };
  }

  const nowIso = new Date().toISOString();

  try {
    const info = await transporter.sendMail({
      from: process.env.EMAIL_USER || "noreply@analytics.local",
      to: recipientList.join(","),
      subject: "Analytics Test Alert",
      text: [
        "This is a test alert from your Analytics backend.",
        `Project: ${projectId}`,
        `Timestamp: ${nowIso}`,
      ].join("\n"),
      html: `
        <div style="font-family:Segoe UI,Arial,sans-serif;max-width:620px;margin:0 auto;padding:18px;border:1px solid #e2e8f0;border-radius:10px;background:#fff;">
          <h2 style="margin:0 0 10px;color:#0f172a;">Analytics Test Alert</h2>
          <p style="margin:0 0 8px;color:#334155;">This is a test email to confirm alert delivery is working.</p>
          <p style="margin:0 0 4px;color:#475569;"><strong>Project:</strong> ${escapeHtml(projectId)}</p>
          <p style="margin:0;color:#475569;"><strong>Timestamp:</strong> ${escapeHtml(nowIso)}</p>
        </div>
      `,
    });

    console.log("Test alert email sent:", info.messageId);
    return {
      success: true,
      message: "Test alert email sent",
      messageId: info.messageId,
      recipients: recipientList,
    };
  } catch (err) {
    return {
      success: false,
      message: err?.message || "Failed to send test email",
    };
  }
}

// Initialize transporter on load
initializeTransporter();

module.exports = {
  sendErrorAlert,
  testEmailConfiguration,
  sendTestAlertEmail,
  buildErrorEmailHtml,
};
