const pool = require("../db");

let ensureErrorAlertTablesPromise = null;

async function ensureErrorAlertTables() {
  if (ensureErrorAlertTablesPromise) return ensureErrorAlertTablesPromise;

  ensureErrorAlertTablesPromise = (async () => {
    await pool.query(`
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
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS error_users (
        id SERIAL PRIMARY KEY,
        error_aggregate_id INTEGER NOT NULL REFERENCES error_aggregates(id) ON DELETE CASCADE,
        user_id VARCHAR(255) NOT NULL,
        first_occurrence TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(error_aggregate_id, user_id)
      )
    `);

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_error_aggregates_project_id ON error_aggregates(project_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_error_aggregates_created_at ON error_aggregates(created_at)`);
  })();

  try {
    await ensureErrorAlertTablesPromise;
  } catch (error) {
    ensureErrorAlertTablesPromise = null;
    throw error;
  }
}

const FATAL_ERROR_RULES = {
  FREQUENCY_THRESHOLD: 10, // min errors in time window
  FREQUENCY_WINDOW_MS: 60 * 1000, // 1 minute
  USER_IMPACT_THRESHOLD: 5, // unique user count
  ALERT_COOLDOWN_MS: 10 * 60 * 1000, // 10 minute cooldown
  CRITICAL_PAGES: ["/checkout", "/payment"],
};

/**
 * Aggregate an error from the tracking system
 * Returns: { isNew, aggregate, alertTriggered }
 */
async function aggregateError(projectId, errorData) {
  const { message, source, line, userId, pageUrl } = errorData;

  await ensureErrorAlertTables();

  try {
    // Normalize error data
    const normalizedMessage = (message || "").slice(0, 1024);
    const normalizedSource = (source || "").slice(0, 512);
    const normalizedLine = parseInt(line) || 0;

    // Upsert error_aggregates
    const aggregateResult = await pool.query(
      `INSERT INTO error_aggregates (project_id, error_message, error_source, error_line, error_count, unique_user_count, last_seen)
       VALUES ($1, $2, $3, $4, 1, 1, NOW())
       ON CONFLICT (project_id, error_message, error_source, error_line) DO UPDATE
       SET error_count = error_aggregates.error_count + 1, last_seen = NOW()
       RETURNING id, error_count, unique_user_count, first_seen, last_seen`,
      [projectId, normalizedMessage, normalizedSource, normalizedLine]
    );

    const aggregate = aggregateResult.rows[0];
    const aggregateId = aggregate.id;

    // Track user (idempotent)
    if (userId) {
      try {
        await pool.query(
          `INSERT INTO error_users (error_aggregate_id, user_id) 
           VALUES ($1, $2)
           ON CONFLICT (error_aggregate_id, user_id) DO NOTHING`,
          [aggregateId, userId]
        );
      } catch (_err) {
        // Silently ignore user tracking failures
      }

      // Update unique_user_count
      const userCountResult = await pool.query(
        `SELECT COUNT(DISTINCT user_id) as user_count FROM error_users WHERE error_aggregate_id = $1`,
        [aggregateId]
      );
      const uniqueUserCount = parseInt(userCountResult.rows[0]?.user_count || 0);

      if (uniqueUserCount > aggregate.unique_user_count) {
        await pool.query(
          `UPDATE error_aggregates SET unique_user_count = $1 WHERE id = $2`,
          [uniqueUserCount, aggregateId]
        );
        aggregate.unique_user_count = uniqueUserCount;
      }
    }

    return {
      isNew: aggregateResult.rowCount === 1,
      aggregate,
      aggregateId,
      normalizedMessage,
      normalizedSource,
      normalizedLine,
      pageUrl,
    };
  } catch (err) {
    console.error("Error in aggregateError:", err);
    throw err;
  }
}

/**
 * Check if fatal error rules are triggered
 * Returns: { isFatal, rules: [] }
 */
function evaluateFatalRules(aggregate, pageUrl) {
  const rules = [];

  // Rule 1: Frequency threshold (10+ same errors in 1 minute)
  if (aggregate.error_count > FATAL_ERROR_RULES.FREQUENCY_THRESHOLD) {
    const lastSeen = new Date(aggregate.last_seen);
    const firstSeen = new Date(aggregate.first_seen);
    const timeDiffMs = lastSeen - firstSeen;

    if (timeDiffMs <= FATAL_ERROR_RULES.FREQUENCY_WINDOW_MS) {
      rules.push({
        type: "frequency",
        message: `Error occurred ${aggregate.error_count} times in ${Math.round(timeDiffMs / 1000)}s`,
      });
    }
  }

  // Rule 2: User impact (5+ unique users)
  if (aggregate.unique_user_count > FATAL_ERROR_RULES.USER_IMPACT_THRESHOLD) {
    rules.push({
      type: "user_impact",
      message: `Error affects ${aggregate.unique_user_count} unique users`,
    });
  }

  // Rule 3: Critical page
  if (pageUrl && FATAL_ERROR_RULES.CRITICAL_PAGES.some((p) => pageUrl.includes(p))) {
    rules.push({
      type: "critical_page",
      message: `Error on critical page: ${pageUrl}`,
    });
  }

  return {
    isFatal: rules.length > 0,
    rules,
  };
}

/**
 * Get error statistics for a project
 */
async function getErrorStats(projectId, timeWindowMinutes = 60) {
  try {
    const result = await pool.query(
      `SELECT 
         COUNT(DISTINCT id) as total_errors,
         SUM(error_count) as total_occurrences,
         MAX(error_count) as max_single_error_count,
         COUNT(CASE WHEN unique_user_count >= $2 THEN 1 END) as high_impact_errors
       FROM error_aggregates
       WHERE project_id = $1 
         AND created_at >= NOW() - INTERVAL '1 minute' * $3`,
      [projectId, FATAL_ERROR_RULES.USER_IMPACT_THRESHOLD, timeWindowMinutes]
    );

    return result.rows[0] || {
      total_errors: 0,
      total_occurrences: 0,
      max_single_error_count: 0,
      high_impact_errors: 0,
    };
  } catch (err) {
    console.error("Error fetching error stats:", err);
    return null;
  }
}

/**
 * Get recent critical errors
 */
async function getRecentCriticalErrors(projectId, limit = 10) {
  try {
    const result = await pool.query(
      `SELECT 
         id, error_message, error_source, error_line, error_count, unique_user_count, last_seen
       FROM error_aggregates
       WHERE project_id = $1 
         AND (error_count >= $2 OR unique_user_count >= $3)
       ORDER BY last_seen DESC
       LIMIT $4`,
      [
        projectId,
        FATAL_ERROR_RULES.FREQUENCY_THRESHOLD,
        FATAL_ERROR_RULES.USER_IMPACT_THRESHOLD,
        limit,
      ]
    );

    return result.rows;
  } catch (err) {
    console.error("Error fetching critical errors:", err);
    return [];
  }
}

module.exports = {
  FATAL_ERROR_RULES,
  aggregateError,
  evaluateFatalRules,
  getErrorStats,
  getRecentCriticalErrors,
};
