const pool = require("../db");

/**
 * Production-grade analytics query service
 * Handles proper aggregation, filtering, time bucketing, and metric calculations
 */

/**
 * Time interval bucketing functions
 */
function getBucketKey(date, interval) {
  const d = new Date(date);
  
  if (interval === "hour") {
    return d.toISOString().slice(0, 13) + ":00:00"; // YYYY-MM-DDTHH
  }
  if (interval === "week") {
    const weekStart = new Date(d);
    weekStart.setDate(d.getDate() - d.getDay()); // Sunday
    return weekStart.toISOString().slice(0, 10);
  }
  // Default: day
  return d.toISOString().slice(0, 10);
}

function getInterval(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const daysDiff = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
  
  // Auto-select interval based on time range
  if (daysDiff <= 1) return "hour";
  if (daysDiff <= 90) return "day";
  return "week";
}

function resolveTimeWindow({ timeRange = "7d", startDate, endDate }) {
  const today = new Date();
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let start = new Date(end);

  if (timeRange === "30d") {
    start.setDate(start.getDate() - 29);
  } else if (timeRange === "custom") {
    const customStart = new Date(startDate);
    const customEnd = new Date(endDate);
    if (!Number.isNaN(customStart.getTime()) && !Number.isNaN(customEnd.getTime())) {
      const normalizedStart = new Date(customStart.getFullYear(), customStart.getMonth(), customStart.getDate());
      const normalizedEnd = new Date(customEnd.getFullYear(), customEnd.getMonth(), customEnd.getDate());
      return {
        startDate: normalizedStart,
        endDate: normalizedEnd,
      };
    }
    start.setDate(start.getDate() - 6);
  } else {
    start.setDate(start.getDate() - 6);
  }

  return {
    startDate: start,
    endDate: end,
  };
}

function formatBucketLabel(value, interval) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || "");
  if (interval === "hour") {
    return date.toISOString().slice(0, 13) + ":00";
  }
  return date.toISOString().slice(0, 10);
}

async function executeQueryBuilderAnalytics(params) {
  const {
    events = [],
    metric = "count",
    chartType = "line",
    timeRange = "7d",
    interval = "day",
    filters = [],
    breakdown = null,
    startDate,
    endDate,
  } = params;

  if (!Array.isArray(events) || events.length === 0) {
    return { labels: [], datasets: [] };
  }

  const uniqueEvents = Array.from(new Set(events.map((item) => String(item || "").trim()).filter(Boolean)));
  if (uniqueEvents.length === 0) {
    return { labels: [], datasets: [] };
  }

  const window = resolveTimeWindow({ timeRange, startDate, endDate });
  const startAt = new Date(window.startDate);
  const endAt = new Date(window.endDate);
  const endExclusive = new Date(endAt);
  endExclusive.setDate(endExclusive.getDate() + 1);

  const metricExpr = metric === "unique_users" ? "COUNT(DISTINCT user_id)::int" : "COUNT(*)::int";
  const bucketExpr = interval === "hour" ? "DATE_TRUNC('hour', created_at)" : "DATE_TRUNC('day', created_at)";

  const filterText = Array.isArray(filters) && filters.length > 0 ? String(filters[0] || "").trim() : "";
  const values = [uniqueEvents, startAt.toISOString(), endExclusive.toISOString()];
  const where = [
    `event_name = ANY($1::text[])`,
    `created_at >= $2::timestamptz`,
    `created_at < $3::timestamptz`,
  ];

  if (filterText) {
    values.push(`%${filterText}%`);
    const p = values.length;
    where.push(`(event_name ILIKE $${p} OR COALESCE(page, '') ILIKE $${p} OR COALESCE(user_id, '') ILIKE $${p})`);
  }

  if (chartType === "bar") {
    let labelExpr = "event_name";
    if (breakdown && uniqueEvents.length === 1) {
      const map = {
        page: "COALESCE(NULLIF(TRIM(page::text), ''), '(unknown)')",
        user_id: "COALESCE(NULLIF(TRIM(user_id::text), ''), '(unknown)')",
        session_id: "COALESCE(NULLIF(TRIM(session_id::text), ''), '(unknown)')",
      };
      labelExpr = map[breakdown] || "event_name";
    }

    const barQuery = `
      SELECT
        ${labelExpr} AS label,
        ${metricExpr} AS value
      FROM events
      WHERE ${where.join(" AND ")}
      GROUP BY label
      ORDER BY value DESC, label ASC
      LIMIT 50
    `;

    const result = await pool.query(barQuery, values);
    const labels = result.rows.map((row) => String(row.label || "(unknown)"));
    const seriesLabel = uniqueEvents.length === 1 ? uniqueEvents[0] : "Events";
    return {
      labels,
      datasets: [
        {
          label: seriesLabel,
          data: result.rows.map((row) => Number(row.value || 0)),
        },
      ],
    };
  }

  const trendQuery = `
    SELECT
      ${bucketExpr} AS bucket,
      event_name,
      ${metricExpr} AS value
    FROM events
    WHERE ${where.join(" AND ")}
    GROUP BY bucket, event_name
    ORDER BY bucket ASC, event_name ASC
  `;

  const trendResult = await pool.query(trendQuery, values);
  const labelMap = new Map();
  const seriesMap = new Map(uniqueEvents.map((name) => [name, new Map()]));

  trendResult.rows.forEach((row) => {
    const label = formatBucketLabel(row.bucket, interval);
    if (!labelMap.has(label)) {
      labelMap.set(label, label);
    }
    if (!seriesMap.has(row.event_name)) {
      seriesMap.set(row.event_name, new Map());
    }
    seriesMap.get(row.event_name).set(label, Number(row.value || 0));
  });

  const labels = Array.from(labelMap.keys());
  const datasets = uniqueEvents.map((eventName) => {
    const seriesPoints = seriesMap.get(eventName) || new Map();
    return {
      label: eventName,
      data: labels.map((label) => Number(seriesPoints.get(label) || 0)),
    };
  });

  return { labels, datasets };
}

/**
 * Build WHERE clause and values based on filters
 */
function buildWhereClause(filters = {}) {
  const clauses = [];
  const values = [];
  let paramCount = 1;

  const { eventNames = [], startDate, endDate, filterText } = filters;

  if (eventNames.length > 0) {
    values.push(eventNames);
    clauses.push(`event_name = ANY($${paramCount}::text[])`);
    paramCount++;
  }

  if (startDate) {
    values.push(startDate);
    clauses.push(`DATE(created_at) >= $${paramCount}::date`);
    paramCount++;
  }

  if (endDate) {
    values.push(endDate);
    clauses.push(`DATE(created_at) <= $${paramCount}::date`);
    paramCount++;
  }

  if (filterText) {
    values.push(`%${filterText}%`);
    clauses.push(`(event_name ILIKE $${paramCount} OR page ILIKE $${paramCount} OR user_id ILIKE $${paramCount})`);
    paramCount++;
  }

  return { clauses, values, paramCount };
}

/**
 * Core query builder for analytics
 * Supports: event aggregation, metrics, time bucketing, grouping, filtering
 */
async function executeAnalyticsQuery(params) {
  const {
    eventNames = [],
    metric = "count", // count, unique_users
    groupBy = "event_name", // event_name, page, user_id, session_id, created_at, device_type
    startDate,
    endDate,
    filterText,
    breakdown,
    projectId,
  } = params;

  // Validate required parameters
  if (!eventNames || eventNames.length === 0) {
    return { labels: [], datasets: [] };
  }

  if (!startDate || !endDate) {
    return { labels: [], datasets: [] };
  }

  const interval = getInterval(startDate, endDate);
  const { clauses, values } = buildWhereClause({ eventNames, startDate, endDate, filterText });

  if (projectId) {
    values.push(String(projectId));
    clauses.push(`project_id = $${values.length}`);
  }

  // Map groupBy to SQL column names
  const groupByMap = {
    event_name: "event_name",
    page: "COALESCE(NULLIF(TRIM(page::text), ''), '(unknown)')",
    user_id: "user_id",
    session_id: "session_id",
    created_at: `DATE(created_at)::text`,
    device_type: "COALESCE(device_type, '(unknown)')",
    country: "COALESCE(country, '(unknown)')",
    hour: `DATE_TRUNC('hour', created_at)::text`,
    day: `DATE(created_at)::text`,
    week: `DATE_TRUNC('week', created_at)::text`,
  };

  const groupByCol = groupByMap[groupBy] || groupByMap.event_name;
  let groupByClause = `${groupByCol} AS bucket`;
  let selectClause = `${groupByCol} AS label`;

  // Time-based grouping
  if (groupBy === "created_at" || groupBy === "date") {
    if (interval === "hour") {
      selectClause = `DATE_TRUNC('hour', created_at)::text AS label`;
      groupByClause = `DATE_TRUNC('hour', created_at)`;
    } else if (interval === "week") {
      selectClause = `DATE_TRUNC('week', created_at)::text AS label`;
      groupByClause = `DATE_TRUNC('week', created_at)`;
    } else {
      selectClause = `DATE(created_at)::text AS label`;
      groupByClause = `DATE(created_at)`;
    }
  }

  // Build metric select
  let metricSelect = "COUNT(*)::int AS value";
  if (metric === "unique_users") {
    metricSelect = "COUNT(DISTINCT user_id)::int AS value";
  }

  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

  const query = `
    SELECT
      ${selectClause},
      ${metricSelect}
    FROM events
    ${whereSql}
    GROUP BY ${groupByClause}
    ORDER BY label ASC
    LIMIT 500
  `;

  try {
    const result = await pool.query(query, values);

    // Transform to chart-friendly format
    const labels = result.rows.map((row) => row.label);
    const dataset = {
      label: `${metric === "unique_users" ? "Unique Users" : "Count"} by ${groupBy}`,
      data: result.rows.map((row) => row.value),
    };

    return {
      labels,
      datasets: [dataset],
      raw: result.rows, // Include raw data for table view
    };
  } catch (error) {
    console.error("Analytics query error:", error.message);
    throw new Error(`Failed to execute analytics query: ${error.message}`);
  }
}

/**
 * Time series query - buckets by date/hour/week
 */
async function executeTimeSeriesQuery(params) {
  const {
    eventNames = [],
    metric = "count",
    startDate,
    endDate,
    filterText,
  } = params;

  if (!eventNames || eventNames.length === 0) {
    return { labels: [], datasets: [] };
  }

  if (!startDate || !endDate) {
    return { labels: [], datasets: [] };
  }

  const interval = getInterval(startDate, endDate);
  const { clauses, values } = buildWhereClause({ eventNames, startDate, endDate, filterText });
  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

  // Build time bucket select
  let dateSelect = `DATE(created_at)::text AS label`;
  let dateGroup = `DATE(created_at)`;

  if (interval === "hour") {
    dateSelect = `DATE_TRUNC('hour', created_at)::text AS label`;
    dateGroup = `DATE_TRUNC('hour', created_at)`;
  } else if (interval === "week") {
    dateSelect = `DATE_TRUNC('week', created_at)::text AS label`;
    dateGroup = `DATE_TRUNC('week', created_at)`;
  }

  let metricSelect = "COUNT(*)::int AS value";
  if (metric === "unique_users") {
    metricSelect = "COUNT(DISTINCT user_id)::int AS value";
  }

  const query = `
    SELECT
      ${dateSelect},
      ${metricSelect}
    FROM events
    ${whereSql}
    GROUP BY ${dateGroup}
    ORDER BY label ASC
  `;

  try {
    const result = await pool.query(query, values);
    const labels = result.rows.map((row) => row.label);
    const dataset = {
      label: metric === "unique_users" ? "Unique Users" : "Count",
      data: result.rows.map((row) => row.value),
    };

    return {
      labels,
      datasets: [dataset],
      raw: result.rows,
    };
  } catch (error) {
    console.error("Time series query error:", error.message);
    throw new Error(`Failed to execute time series query: ${error.message}`);
  }
}

/**
 * Bar chart query with custom grouping
 */
async function executeBarChartQuery(params) {
  const {
    eventNames = [],
    xAxis = "event_name",
    yAxis = "count",
    startDate,
    endDate,
    filterText,
  } = params;

  if (!eventNames || eventNames.length === 0) {
    return { labels: [], datasets: [] };
  }

  if (!startDate || !endDate) {
    return { labels: [], datasets: [] };
  }

  // For bar charts, group by xAxis
  const { clauses, values } = buildWhereClause({ eventNames, startDate, endDate, filterText });
  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

  const xAxisMap = {
    event_name: "event_name",
    page: "COALESCE(NULLIF(TRIM(page::text), ''), '(unknown)')",
    user_id: "user_id",
    session_id: "session_id",
    created_at: "DATE(created_at)::text",
    device_type: "COALESCE(device_type, '(unknown)')",
    country: "COALESCE(country, '(unknown)')",
  };

  const xAxisCol = xAxisMap[xAxis] || xAxisMap.event_name;
  const yAxisMetric = yAxis === "unique_users" ? "COUNT(DISTINCT user_id)::int" : "COUNT(*)::int";

  const query = `
    SELECT
      ${xAxisCol} AS label,
      ${yAxisMetric} AS value
    FROM events
    ${whereSql}
    GROUP BY ${xAxisCol}
    ORDER BY value DESC
    LIMIT 50
  `;

  try {
    const result = await pool.query(query, values);
    const labels = result.rows.map((row) => row.label);
    const dataset = {
      label: yAxis === "unique_users" ? "Unique Users" : "Count",
      data: result.rows.map((row) => row.value),
    };

    return {
      labels,
      datasets: [dataset],
      raw: result.rows,
    };
  } catch (error) {
    console.error("Bar chart query error:", error.message);
    throw new Error(`Failed to execute bar chart query: ${error.message}`);
  }
}

module.exports = {
  executeAnalyticsQuery,
  executeTimeSeriesQuery,
  executeBarChartQuery,
  executeQueryBuilderAnalytics,
  getInterval,
  getBucketKey,
};
