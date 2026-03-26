import { useCallback, useEffect, useState } from "react";
import { fetchAnalytics } from "@/utils/backendClient";

const DEFAULT_EVENT_FALLBACK = [
  "page_view",
  "click",
  "error",
  "promise_error",
  "navigation_clicked",
  "signup_started",
  "signup_completed",
  "login_attempted",
  "login_success",
  "loan_application_started",
  "loan_application_submitted",
  "payment_fatal_error_button_clicked",
  "frontend_error_test_clicked",
];

/**
 * Production-grade hook for analytics queries
 * Manages loading, error, and data states
 */
export function useAnalyticsQuery(queryParams) {
  const [data, setData] = useState({ labels: [], datasets: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const executeQuery = useCallback(async (params) => {
    // Validate required parameters
    if (!params.events || params.events.length === 0) {
      setError("No events selected");
      setData({ labels: [], datasets: [] });
      return { labels: [], datasets: [] };
    }

    if (!params.chartType) {
      setError("Chart type is required");
      setData({ labels: [], datasets: [] });
      return { labels: [], datasets: [] };
    }

    try {
      setLoading(true);
      setError(null);

      const result = await fetchAnalytics("/query", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          events: params.events,
          metric: params.metric || "count",
          chartType: params.chartType,
          timeRange: params.timeRange || "7d",
          interval: params.interval || "day",
          filters: Array.isArray(params.filters) ? params.filters : [],
          breakdown: params.breakdown || null,
          startDate: params.startDate,
          endDate: params.endDate,
        }),
      });
      setData(result);
      setError(null);
      return result;
    } catch (err) {
      const errorMessage = err.message || "An error occurred while fetching data";
      setError(errorMessage);
      setData({ labels: [], datasets: [] });
      console.error("Analytics query error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-execute when query parameters change
  useEffect(() => {
    if (queryParams && queryParams.chartType && queryParams.events?.length > 0) {
      executeQuery(queryParams);
    }
  }, [queryParams, executeQuery]);

  return { data, loading, error, refetch: executeQuery };
}

/**
 * Fetch list of available events
 */
export async function fetchEventsList() {
  function normalizeEventNames(items) {
    if (!Array.isArray(items)) return [];
    return items
      .map((item) => {
        if (typeof item === "string") return item;
        return item?.label || item?.name || item?.event_name || "";
      })
      .map((name) => String(name || "").trim())
      .filter(Boolean);
  }

  try {
    // Primary source: purpose-built endpoint.
    const eventsData = await fetchAnalytics("/events?groupBy=event_name", {
      attempts: 2,
      timeout: 15000,
    }).catch(() => []);
    const primary = normalizeEventNames(eventsData);
    if (primary.length > 0) {
      return Array.from(new Set(primary));
    }

    // Secondary source: overview activity feed.
    const overview = await fetchAnalytics("/overview", {
      attempts: 2,
      timeout: 15000,
    }).catch(() => ({ recent_activity: [] }));
    const recent = normalizeEventNames(overview?.recent_activity || []);
    if (recent.length > 0) {
      return Array.from(new Set(recent));
    }

    // Last resort fallback list to keep chart builder usable.
    return DEFAULT_EVENT_FALLBACK;
  } catch (error) {
    console.error("Error fetching events:", error);
    return DEFAULT_EVENT_FALLBACK;
  }
}
