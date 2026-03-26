import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import "rrweb-player/dist/style.css";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Icons } from "@/components/ui/Icons";
import { fetchAnalytics, toQuery } from "@/utils/backendClient";

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function formatDuration(durationMs) {
  const safe = Number(durationMs || 0);
  if (safe <= 0) return "0s";
  const totalSeconds = Math.floor(safe / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function formatSessionLocation(session) {
  const city = String(session?.city || "").trim();
  const region = String(session?.region || "").trim();
  const country = String(session?.country || "").trim();

  const parts = [city, region, country].filter(Boolean);
  if (parts.length > 0) return parts.join(", ");

  const timezone = String(session?.timezone || "").trim();
  return timezone || "Unknown location";
}

function toMs(value) {
  const asDate = new Date(value).getTime();
  return Number.isFinite(asDate) ? asDate : 0;
}

function isFullSnapshotEvent(event) {
  if (!event || Number(event?.type) !== 2) return false;
  const node = event?.data?.node;
  return Boolean(node && typeof node === "object");
}

function normalizeReplayEvents(rawEvents) {
  const input = Array.isArray(rawEvents) ? rawEvents : [];
  const events = input
    .filter((event) => event && typeof event === "object")
    .map((event) => ({
      ...event,
      timestamp: Number(event?.timestamp || 0),
      type: Number(event?.type || 0),
    }))
    .filter((event) => Number.isFinite(event.timestamp) && event.timestamp > 0 && event.type > 0)
    .sort((a, b) => a.timestamp - b.timestamp);

  return events;
}

function hasRenderableReplay(events) {
  const normalized = normalizeReplayEvents(events);
  return normalized.length > 1 && normalized.some(isFullSnapshotEvent);
}

function getReplayViewport(events) {
  const normalized = normalizeReplayEvents(events);
  const meta = normalized.find((event) => Number(event?.type) === 4 && event?.data && typeof event.data === "object");
  const width = Number(meta?.data?.width || 0);
  const height = Number(meta?.data?.height || 0);

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }

  return {
    width: Math.round(width),
    height: Math.round(height),
  };
}

function getFittedPlayerSize(viewport, container) {
  const containerWidth = Math.max(320, Number(container?.clientWidth || 0));
  const containerHeight = Math.max(240, Number(container?.clientHeight || 0));

  const sourceWidth = Math.max(1, Number(viewport?.width || containerWidth));
  const sourceHeight = Math.max(1, Number(viewport?.height || containerHeight));

  const widthScale = containerWidth / sourceWidth;
  const heightScale = containerHeight / sourceHeight;
  const scale = Math.min(widthScale, heightScale, 1);

  return {
    width: Math.max(320, Math.round(sourceWidth * scale)),
    height: Math.max(240, Math.round(sourceHeight * scale)),
  };
}

function classifyErrorType(message) {
  const text = String(message || "").toLowerCase();
  if (/(network|failed to fetch|xhr|status\s*[45]\d\d|timeout|cors)/i.test(text)) {
    return "network_error";
  }
  return "console_error";
}

const EVENT_COLORS = {
  click: "#2563eb",
  error: "#dc2626",
  network: "#f59e0b",
  page: "#7c3aed",
};

const EVENT_LABELS = {
  click: "Click",
  error: "Error",
  network: "API",
  page: "Page",
};

function asTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  return toMs(value);
}

function extractNavigationEvents(replayEvents) {
  return (Array.isArray(replayEvents) ? replayEvents : [])
    .filter((event) => Number(event?.type) === 5 && String(event?.data?.tag || "") === "navigation")
    .map((event) => ({
      timestamp: Number(event?.timestamp || 0),
      detail: event?.data?.payload?.path || event?.data?.payload?.url || "route change",
    }))
    .filter((item) => Number.isFinite(item.timestamp) && item.timestamp > 0);
}

function extractCustomReplayEvents(replayEvents) {
  return (Array.isArray(replayEvents) ? replayEvents : [])
    .filter((event) => Number(event?.type) === 5)
    .map((event) => {
      const tag = String(event?.data?.tag || "").toLowerCase();
      const payload = event?.data?.payload && typeof event.data.payload === "object" ? event.data.payload : {};
      return {
        timestamp: Number(event?.timestamp || 0),
        tag,
        payload,
      };
    })
    .filter((item) => Number.isFinite(item.timestamp) && item.timestamp > 0);
}

function extractInteractionEvents(replayEvents) {
  return (Array.isArray(replayEvents) ? replayEvents : [])
    .filter((event) => Number(event?.type) === 3)
    .map((event) => {
      const source = Number(event?.data?.source);
      if (source !== 2) return null;

      const interactionType = Number(event?.data?.type);
      const isClickLike = interactionType === 2 || interactionType === 3 || interactionType === 4;
      if (!isClickLike) return null;

      return {
        timestamp: Number(event?.timestamp || 0),
        type: "click",
        detail: "User click",
        metadata: {
          source: "rrweb",
          x: Number(event?.data?.x || 0),
          y: Number(event?.data?.y || 0),
          interactionType,
        },
      };
    })
    .filter((item) => item && Number.isFinite(item.timestamp) && item.timestamp > 0);
}

function buildInspectorEvents({ deadClicks, sessionErrors, replayEvents }) {
  const unified = [];

  (Array.isArray(deadClicks) ? deadClicks : []).forEach((item, index) => {
    const timestamp = asTimestamp(item?.timestamp);
    if (!timestamp) return;

    unified.push({
      id: `dead-click-${timestamp}-${index}`,
      timestamp,
      type: "click",
      detail: item?.element || item?.page || "Dead click",
      metadata: {
        source: "dead_click",
        page: item?.page || "",
        x: Number(item?.x || 0),
        y: Number(item?.y || 0),
      },
    });
  });

  extractInteractionEvents(replayEvents).forEach((item, index) => {
    unified.push({
      id: `click-${item.timestamp}-${index}`,
      timestamp: item.timestamp,
      type: "click",
      detail: item.detail,
      metadata: item.metadata,
    });
  });

  (Array.isArray(sessionErrors) ? sessionErrors : []).forEach((item, index) => {
    const timestamp = asTimestamp(item?.timestamp);
    if (!timestamp) return;
    const errorKind = classifyErrorType(item?.message) === "network_error" ? "network" : "error";

    unified.push({
      id: `error-${timestamp}-${index}`,
      timestamp,
      type: errorKind,
      detail: item?.message || "Frontend error",
      metadata: {
        source: item?.source || "console",
        line: item?.line || "",
        stack: item?.stack || "",
      },
    });
  });

  extractNavigationEvents(replayEvents).forEach((item, index) => {
    unified.push({
      id: `page-${item.timestamp}-${index}`,
      timestamp: item.timestamp,
      type: "page",
      detail: item.detail,
      metadata: {
        source: "navigation",
      },
    });
  });

  extractCustomReplayEvents(replayEvents).forEach((item, index) => {
    if (item.tag === "navigation") return;

    const networkLike = ["network", "api", "xhr", "fetch"].includes(item.tag);
    if (networkLike) {
      const status = item.payload?.status;
      const method = item.payload?.method || "GET";
      const path = item.payload?.path || item.payload?.url || "API call";
      const duration = Number(item.payload?.duration || item.payload?.durationMs || 0);

      unified.push({
        id: `api-${item.timestamp}-${index}`,
        timestamp: item.timestamp,
        type: "network",
        detail: `${method} ${path}`,
        metadata: {
          source: "network",
          status,
          duration,
          path,
          method,
        },
      });
      return;
    }

    unified.push({
      id: `custom-${item.timestamp}-${index}`,
      timestamp: item.timestamp,
      type: "page",
      detail: item.tag ? `Custom: ${item.tag}` : "Custom event",
      metadata: {
        source: "custom",
        payload: item.payload,
      },
    });
  });

  return unified.sort((a, b) => a.timestamp - b.timestamp);
}

function buildTimelineMarkers({ inspectorEvents, sessionBaseMs, sessionDurationMs }) {
  if (!sessionBaseMs || !sessionDurationMs) return [];

  const markers = [];

  function pushMarker(type, absoluteTs, detail, meta) {
    const offsetMs = Number(absoluteTs || 0) - sessionBaseMs;
    if (!Number.isFinite(offsetMs)) return;
    const clampedOffsetMs = Math.min(sessionDurationMs, Math.max(0, offsetMs));
    const outsideReplayRange = offsetMs < 0 || offsetMs > sessionDurationMs;

    markers.push({
      id: `${type}-${absoluteTs}-${markers.length}`,
      type,
      detail,
      meta,
      absoluteTs,
      offsetMs: clampedOffsetMs,
      outsideReplayRange,
    });
  }

  (Array.isArray(inspectorEvents) ? inspectorEvents : []).forEach((item) => {
    pushMarker(item.type, item.timestamp, item.detail, {
      ...(item.metadata || {}),
      sourceEventId: item.id,
      sourceType: item.type,
    });
  });

  markers.sort((a, b) => a.offsetMs - b.offsetMs);

  // Assign lanes so nearby markers do not overlap visually.
  const laneLastTs = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  return markers.map((marker, index) => {
    let lane = 0;
    while (lane < laneLastTs.length && marker.offsetMs - laneLastTs[lane] < 1200) {
      lane += 1;
    }
    if (lane >= laneLastTs.length) lane = index % laneLastTs.length;
    laneLastTs[lane] = marker.offsetMs;

    return {
      ...marker,
      lane,
      percent: Math.min(99.6, Math.max(0.4, (marker.offsetMs / sessionDurationMs) * 100)),
    };
  });
}

export default function SessionReplaysPage() {
  const router = useRouter();

  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [deleting, setDeleting] = useState(false);

  const [filters, setFilters] = useState({
    date: "",
    user: "",
    errorsOnly: false,
  });

  const [selectedSession, setSelectedSession] = useState(null);
  const [replayEvents, setReplayEvents] = useState([]);
  const [sessionErrors, setSessionErrors] = useState([]);
  const [deadClicks, setDeadClicks] = useState([]);
  const [replayLoading, setReplayLoading] = useState(false);
  const [replayError, setReplayError] = useState("");
  const [replayCurrentTime, setReplayCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [hoveredMarkerId, setHoveredMarkerId] = useState("");
  const [activeSidebarTab, setActiveSidebarTab] = useState("events");
  const [metricFilter, setMetricFilter] = useState("all");
  const [selectedInspectorEventId, setSelectedInspectorEventId] = useState("");
  const [playerZoom, setPlayerZoom] = useState(1);
  const [pathScopedSessionIds, setPathScopedSessionIds] = useState([]);
  const [pathScopeLoading, setPathScopeLoading] = useState(false);

  const playerContainerRef = useRef(null);
  const playerInstanceRef = useRef(null);
  const deepLinkAttemptedRef = useRef(false);

  useEffect(() => {
    loadSessions();
  }, []);

  useEffect(() => {
    const refresh = () => {
      void loadSessions({ silent: true });
    };

    const intervalId = window.setInterval(refresh, 10000);
    window.addEventListener("focus", refresh);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  useEffect(() => {
    deepLinkAttemptedRef.current = false;
  }, [router.query.sessionId, router.query.session_id, router.query.userId, router.query.user_id]);

  useEffect(() => {
    async function loadPathScopedSessions() {
      const path = String(router.query.path || "").trim();
      const source = String(router.query.source || "").trim();
      const target = String(router.query.target || "").trim();

      if (!path && !(source && target)) {
        setPathScopedSessionIds([]);
        return;
      }

      try {
        setPathScopeLoading(true);
        const query = toQuery({ path, source, target, limit: 500 });
        const payload = await fetchAnalytics(`/user-journeys/path-sessions?${query}`);
        const nextSessionIds = Array.isArray(payload?.sessions)
          ? payload.sessions.map((item) => String(item.session_id || "").trim()).filter(Boolean)
          : [];
        setPathScopedSessionIds(nextSessionIds);
      } catch (_err) {
        setPathScopedSessionIds([]);
      } finally {
        setPathScopeLoading(false);
      }
    }

    loadPathScopedSessions();
  }, [router.query.path, router.query.source, router.query.target]);

  useEffect(() => {
    const sessionId = String(router.query.sessionId || router.query.session_id || "").trim();
    const userId = String(router.query.userId || router.query.user_id || "").trim();

    if (!sessionId || selectedSession || deepLinkAttemptedRef.current) return;

    const match = sessions.find((item) => {
      if (String(item.session_id || "") !== sessionId) return false;
      if (!userId) return true;
      return String(item.user_id || "") === userId;
    });

    deepLinkAttemptedRef.current = true;

    if (match) {
      void openReplay(match);
      return;
    }

    // Fallback: open exact deep-linked session even if it is not in the current cards window.
    void openReplay({
      session_id: sessionId,
      user_id: userId,
      start_timestamp: null,
      end_timestamp: null,
      country: null,
      city: null,
      region: null,
      timezone: null,
      event_count: 0,
      error_count: 0,
      duration_ms: 0,
    });
  }, [router.query.sessionId, router.query.session_id, router.query.userId, router.query.user_id, sessions, selectedSession]);

  const replayViewport = useMemo(() => getReplayViewport(replayEvents), [replayEvents]);

  useEffect(() => {
    if (!selectedSession || replayEvents.length === 0 || !playerContainerRef.current) return;

    if (!hasRenderableReplay(replayEvents)) {
      setReplayError("This session is missing a full snapshot. Capture a new session and try again.");
      return;
    }

    let cancelled = false;
    const container = playerContainerRef.current;

    import("rrweb-player")
      .then(({ default: RRWebPlayer }) => {
        if (cancelled || !container) return;

        if (typeof RRWebPlayer !== "function") {
          throw new Error("rrweb-player constructor is unavailable");
        }

        container.innerHTML = "";

        const safeEvents = normalizeReplayEvents(replayEvents);
        const fittedSize = getFittedPlayerSize(replayViewport, container);
        const zoomedWidth = Math.max(320, Math.round(fittedSize.width * playerZoom));
        const zoomedHeight = Math.max(240, Math.round(fittedSize.height * playerZoom));
        const player = new RRWebPlayer({
          target: container,
          props: {
            events: safeEvents,
            width: zoomedWidth,
            height: zoomedHeight,
            autoPlay: false,
            skipInactive: true,
            showController: true,
          },
        });

        playerInstanceRef.current = player;
        setReplayCurrentTime(0);
        setIsPlaying(false);

        player.addEventListener("ui-update-current-time", ({ payload }) => {
          if (!cancelled) {
            setReplayCurrentTime(Number(payload) || 0);
          }
        });

        player.addEventListener("ui-update-player-state", ({ payload }) => {
          if (!cancelled) {
            setIsPlaying(payload === "playing");
          }
        });
      })
      .catch((err) => {
        const details = String(err?.message || "").trim();
        if (/snapshot|event|malformed|replay/i.test(details)) {
          setReplayError("Replay data is malformed or incomplete for this session.");
          return;
        }
        setReplayError("Unable to load replay player.");
      });

    return () => {
      cancelled = true;
      playerInstanceRef.current = null;
      if (container) container.innerHTML = "";
      setIsPlaying(false);
    };
  }, [selectedSession, replayEvents, replayViewport, playerZoom]);

  const filteredSessions = useMemo(() => {
    const hasPathScope = pathScopedSessionIds.length > 0;
    const sessionIdSet = hasPathScope ? new Set(pathScopedSessionIds) : null;

    return sessions
      .filter((item) => {
        const hasRecordedActivity = Number(item.event_count || 0) > 0 || Number(item.error_count || 0) > 0;
        if (!hasRecordedActivity) return false;

        const userMatch = !filters.user || String(item.user_id || "").toLowerCase().includes(filters.user.toLowerCase());
        const errorsMatch = !filters.errorsOnly || Number(item.error_count || 0) > 0;
        const pathMatch = !hasPathScope || sessionIdSet.has(String(item.session_id || ""));

        let dateMatch = true;
        if (filters.date) {
          const start = item.start_timestamp ? new Date(item.start_timestamp) : null;
          if (!start || Number.isNaN(start.getTime())) {
            dateMatch = false;
          } else {
            const d = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
            dateMatch = d === filters.date;
          }
        }

        return userMatch && errorsMatch && dateMatch && pathMatch;
      })
      .sort((a, b) => {
        const aTs = new Date(a.end_timestamp || a.start_timestamp || 0).getTime() || 0;
        const bTs = new Date(b.end_timestamp || b.start_timestamp || 0).getTime() || 0;
        return bTs - aTs;
      });
  }, [sessions, filters, pathScopedSessionIds]);

  const sessionBaseMs = useMemo(() => {
    if (replayEvents.length === 0) return 0;
    return Number(replayEvents[0]?.timestamp || 0);
  }, [replayEvents]);

  const sessionDurationMs = useMemo(() => {
    if (replayEvents.length < 2) return 0;
    const first = Number(replayEvents[0]?.timestamp || 0);
    const last = Number(replayEvents[replayEvents.length - 1]?.timestamp || 0);
    return Math.max(0, last - first);
  }, [replayEvents]);

  const inspectorEvents = useMemo(
    () =>
      buildInspectorEvents({
        deadClicks,
        sessionErrors,
        replayEvents,
      }),
    [deadClicks, sessionErrors, replayEvents]
  );

  const timelineMarkers = useMemo(
    () =>
      buildTimelineMarkers({
        inspectorEvents,
        sessionBaseMs,
        sessionDurationMs,
      }),
    [inspectorEvents, sessionBaseMs, sessionDurationMs]
  );

  const hoveredMarker = useMemo(
    () => timelineMarkers.find((item) => item.id === hoveredMarkerId) || null,
    [timelineMarkers, hoveredMarkerId]
  );

  const timelineSummary = useMemo(() => {
    const summary = {
      click: 0,
      error: 0,
      network: 0,
      page: 0,
    };

    inspectorEvents.forEach((event) => {
      summary[event.type] = (summary[event.type] || 0) + 1;
    });

    return summary;
  }, [inspectorEvents]);

  const filteredInspectorEvents = useMemo(() => {
    let base = inspectorEvents;

    if (activeSidebarTab === "errors") {
      base = base.filter((item) => item.type === "error");
    } else if (activeSidebarTab === "network") {
      base = base.filter((item) => item.type === "network");
    }

    if (metricFilter !== "all") {
      base = base.filter((item) => item.type === metricFilter);
    }

    return base;
  }, [inspectorEvents, activeSidebarTab, metricFilter]);

  const playbackPercent = useMemo(() => {
    if (!sessionDurationMs) return 0;
    return Math.max(0, Math.min(100, (replayCurrentTime / sessionDurationMs) * 100));
  }, [replayCurrentTime, sessionDurationMs]);

  const activeTimelineEventId = useMemo(() => {
    if (!timelineMarkers.length) return "";
    const closest = timelineMarkers.reduce((best, current) => {
      const currentDiff = Math.abs(current.offsetMs - replayCurrentTime);
      const bestDiff = Math.abs(best.offsetMs - replayCurrentTime);
      return currentDiff < bestDiff ? current : best;
    }, timelineMarkers[0]);
    return closest?.id || "";
  }, [timelineMarkers, replayCurrentTime]);

  useEffect(() => {
    if (!activeTimelineEventId) return;
    if (!isPlaying && selectedInspectorEventId) return;
    setSelectedInspectorEventId(activeTimelineEventId);
  }, [activeTimelineEventId, isPlaying, selectedInspectorEventId]);

  const selectedTimelineMarker = useMemo(
    () => timelineMarkers.find((item) => item.id === selectedInspectorEventId) || null,
    [timelineMarkers, selectedInspectorEventId]
  );

  const highlightedMarkerType = useMemo(() => {
    if (metricFilter !== "all") return metricFilter;
    return null;
  }, [metricFilter]);

  const sidebarItems = useMemo(() => {
    return filteredInspectorEvents
      .map((eventItem) => {
        const marker = timelineMarkers.find((item) => item.meta?.sourceEventId === eventItem.id);
        if (!marker) return null;
        return {
          ...eventItem,
          markerId: marker.id,
          offsetMs: marker.offsetMs,
          percent: marker.percent,
        };
      })
      .filter(Boolean);
  }, [filteredInspectorEvents, timelineMarkers]);

  async function loadSessions(options = {}) {
    const { silent = false } = options;

    try {
      if (!silent) {
        setLoading(true);
        setError("");
        setMessage("");
      }

      const rows = await fetchAnalytics("/session-recordings?limit=250", { cache: "no-store", skipCache: true });
      setSessions(Array.isArray(rows) ? rows : []);
    } catch (err) {
      if (!silent) {
        setError(err.message || "Unable to load sessions.");
        setSessions([]);
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }

  async function openReplay(session) {
    setSelectedSession(session);
    setReplayLoading(true);
    setReplayError("");
    setReplayEvents([]);
    setSessionErrors([]);
    setDeadClicks([]);
    setReplayCurrentTime(0);
    setHoveredMarkerId("");
    setActiveSidebarTab("events");
    setMetricFilter("all");
    setSelectedInspectorEventId("");
    setPlayerZoom(1);

    try {
      const queryWithUser = toQuery({ user_id: session.user_id || "" });
      const sessionPath = encodeURIComponent(session.session_id);

      let eventsPayload;
      let deadClickPayload;

      try {
        [eventsPayload, deadClickPayload] = await Promise.all([
          fetchAnalytics(`/session-recordings/${sessionPath}/events?${queryWithUser}`, { skipCache: true }),
          fetchAnalytics(`/session-recordings/${sessionPath}/dead-clicks?${queryWithUser}`, { skipCache: true }),
        ]);
      } catch {
        [eventsPayload, deadClickPayload] = await Promise.all([
          fetchAnalytics(`/session-recordings/${sessionPath}/events`, { skipCache: true }),
          fetchAnalytics(`/session-recordings/${sessionPath}/dead-clicks`, { skipCache: true }),
        ]);
      }

      let events = normalizeReplayEvents(eventsPayload?.events);
      let errors = Array.isArray(eventsPayload?.errors) ? eventsPayload.errors : [];
      let clicks = Array.isArray(deadClickPayload) ? deadClickPayload : [];

      if (!hasRenderableReplay(events)) {
        const [fallbackEventsPayload, fallbackDeadClickPayload] = await Promise.all([
          fetchAnalytics(`/session-recordings/${sessionPath}/events`, { skipCache: true }),
          fetchAnalytics(`/session-recordings/${sessionPath}/dead-clicks`, { skipCache: true }),
        ]);

        const fallbackEvents = normalizeReplayEvents(fallbackEventsPayload?.events);
        if (hasRenderableReplay(fallbackEvents)) {
          events = fallbackEvents;
          errors = Array.isArray(fallbackEventsPayload?.errors) ? fallbackEventsPayload.errors : errors;
          clicks = Array.isArray(fallbackDeadClickPayload) ? fallbackDeadClickPayload : clicks;
        }
      }

      setReplayEvents(events);
      setSessionErrors(errors);
      setDeadClicks(clicks);

      if (events.length === 0) {
        setReplayError("No replay events available for this session.");
      } else if (!hasRenderableReplay(events)) {
        setReplayError("Replay data exists but is not renderable (missing full snapshot). Capture a fresh session.");
      }
    } catch (err) {
      setReplayError(err.message || "Unable to load replay.");
    } finally {
      setReplayLoading(false);
    }
  }

  async function deleteAllReplays() {
    if (deleting) return;

    const confirmed = window.confirm("Delete all stored replays and frontend errors?");
    if (!confirmed) return;

    try {
      setDeleting(true);
      setError("");
      setMessage("");

      const payload = await fetchAnalytics("/session-recordings", { method: "DELETE", attempts: 1 });
      const deletedSessions = Number(payload?.deleted_session_recordings || 0);
      const deletedErrors = Number(payload?.deleted_frontend_errors || 0);

      setSessions([]);
      setMessage(`Deleted ${deletedSessions} replay batches and ${deletedErrors} frontend errors.`);
      closeReplay();
    } catch (err) {
      setError(err.message || "Unable to delete replays.");
    } finally {
      setDeleting(false);
    }
  }

  async function deleteReplay(session) {
    const confirmed = window.confirm(`Delete replay for session ${session.session_id}?`);
    if (!confirmed) return;

    try {
      setError("");
      setMessage("");

      const query = toQuery({ user_id: session.user_id || "" });
      const payload = await fetchAnalytics(`/session-recordings/${encodeURIComponent(session.session_id)}?${query}`, {
        method: "DELETE",
        attempts: 1,
      });

      setSessions((prev) => prev.filter((item) => !(item.session_id === session.session_id && item.user_id === session.user_id)));

      const deletedSessions = Number(payload?.deleted_session_recordings || 0);
      const deletedErrors = Number(payload?.deleted_frontend_errors || 0);
      setMessage(`Deleted replay (${deletedSessions} batches, ${deletedErrors} errors).`);

      if (selectedSession && selectedSession.session_id === session.session_id && selectedSession.user_id === session.user_id) {
        closeReplay();
      }
    } catch (err) {
      setError(err.message || "Unable to delete replay.");
    }
  }

  function closeReplay() {
    setSelectedSession(null);
    setReplayEvents([]);
    setSessionErrors([]);
    setDeadClicks([]);
    setReplayCurrentTime(0);
    setReplayError("");
    setHoveredMarkerId("");
    setIsPlaying(false);
    setPlaybackSpeed(1);
    setActiveSidebarTab("events");
    setMetricFilter("all");
    setSelectedInspectorEventId("");
    setPlayerZoom(1);
  }

  function jumpToTime(offsetMs) {
    const player = playerInstanceRef.current;
    if (!player) return;

    try {
      if (typeof player.goto === "function") {
        player.goto(offsetMs);
        return;
      }
      const replayer = typeof player.getReplayer === "function" ? player.getReplayer() : null;
      if (replayer && typeof replayer.pause === "function") {
        replayer.pause(offsetMs);
      }
    } catch {
      // ignore player API differences
    }
  }

  function jumpToInspectorEvent(eventItem) {
    if (!eventItem) return;
    const offsetMs = Number(eventItem.offsetMs || 0);
    setSelectedInspectorEventId(String(eventItem.markerId || eventItem.id || ""));
    jumpToTime(offsetMs);
  }

  function togglePlayback() {
    const player = playerInstanceRef.current;
    if (!player) return;

    try {
      player.toggle();
    } catch {
      // ignore
    }
  }

  function handleSpeedChange(speed) {
    setPlaybackSpeed(speed);

    const player = playerInstanceRef.current;
    if (!player) return;

    try {
      player.setSpeed(speed);
    } catch {
      // ignore
    }
  }

  function handleTimelineClick(event) {
    if (!sessionDurationMs) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    jumpToTime(Math.round(ratio * sessionDurationMs));
  }

  return (
    <div className="space-y-6 pb-8">
      <section className="mx-auto max-w-[1300px] px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-semibold text-slate-900 tracking-tight">Session Replays</h1>
            <p className="mt-1 text-sm text-slate-500">Sessions with user id, timestamp, location, and event timeline.</p>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => loadSessions()}>
              <Icons.Activity className="mr-2 h-4 w-4" />
              Refresh
            </Button>
            <Button variant="secondary" onClick={deleteAllReplays} disabled={deleting} className={deleting ? "opacity-60" : ""}>
              <Icons.Trash className="mr-2 h-4 w-4" />
              {deleting ? "Deleting..." : "Clear All"}
            </Button>
            <Link href="/">
              <Button variant="secondary">Dashboard</Button>
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1300px] px-4 sm:px-6 lg:px-8">
        <Card className="p-0 overflow-hidden mb-6">
          <div className="border-b border-slate-100 bg-slate-50 p-4 flex flex-wrap items-center gap-3">
            <input
              type="date"
              value={filters.date}
              onChange={(e) => setFilters((prev) => ({ ...prev, date: e.target.value }))}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
            />

            <div className="relative">
              <Icons.Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={filters.user}
                onChange={(e) => setFilters((prev) => ({ ...prev, user: e.target.value }))}
                placeholder="Search user id"
                className="pl-9 pr-4 rounded-lg border border-slate-200 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 w-64"
              />
            </div>

            <label className="ml-auto flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={filters.errorsOnly}
                onChange={(e) => setFilters((prev) => ({ ...prev, errorsOnly: e.target.checked }))}
                className="h-4 w-4 rounded border-slate-300"
              />
              Errors Only
            </label>

            {(String(router.query.path || "").trim() || (String(router.query.source || "").trim() && String(router.query.target || "").trim())) ? (
              <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
                {pathScopeLoading ? "Applying journey path filter..." : `Journey scope: ${pathScopedSessionIds.length} sessions`}
              </span>
            ) : null}
          </div>

          <div className="p-6">
            {loading ? <div className="py-12 text-center text-sm text-slate-500">Loading sessions...</div> : null}
            {error ? <p className="mb-4 text-sm text-red-600">{error}</p> : null}
            {message ? <p className="mb-4 text-sm text-emerald-700">{message}</p> : null}

            {!loading && sessions.length === 0 ? (
              <div className="py-16 text-center">
                <p className="text-base font-medium text-slate-900">No session recordings yet</p>
                <p className="mt-1 text-sm text-slate-500">New sessions will appear here automatically.</p>
              </div>
            ) : null}

            {!loading && sessions.length > 0 && filteredSessions.length === 0 ? (
              <p className="py-10 text-center text-sm text-slate-500">No sessions match your filters.</p>
            ) : null}

            {!loading && filteredSessions.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {filteredSessions.map((session) => (
                  (() => {
                    const replayLikelyReady = Number(session.event_count || 0) > 1;
                    return (
                  <article
                    key={`${session.user_id}-${session.session_id}`}
                    className={`group rounded-xl border bg-white p-4 transition-all ${replayLikelyReady ? "border-slate-200 hover:border-slate-300 hover:shadow-sm cursor-pointer" : "border-slate-100 opacity-80 cursor-not-allowed"}`}
                    onClick={() => {
                      if (!replayLikelyReady) return;
                      void openReplay(session);
                    }}
                  >
                    <div className="mb-3 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">{session.user_id || "Unknown user"}</p>
                        <p className="truncate text-[11px] text-slate-500">{session.session_id}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-slate-400 hover:text-red-600"
                        onClick={(e) => {
                          e.stopPropagation();
                          void deleteReplay(session);
                        }}
                      >
                        <Icons.Trash className="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    <div className="space-y-1 text-xs text-slate-600">
                      <p><span className="font-medium text-slate-700">Start:</span> {formatDateTime(session.start_timestamp)}</p>
                      <p><span className="font-medium text-slate-700">End:</span> {formatDateTime(session.end_timestamp)}</p>
                      <p><span className="font-medium text-slate-700">Location:</span> {formatSessionLocation(session)}</p>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-slate-700">
                        {formatDuration(session.duration_ms)}
                      </span>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-slate-700">
                        {Number(session.event_count || 0)} events
                      </span>
                      <span className={`rounded-full border px-2 py-1 ${Number(session.error_count || 0) > 0 ? "border-red-200 bg-red-50 text-red-700" : "border-slate-200 bg-slate-50 text-slate-700"}`}>
                        {Number(session.error_count || 0)} errors
                      </span>
                      <span className={`rounded-full border px-2 py-1 ${replayLikelyReady ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
                        {replayLikelyReady ? "Replay ready" : "Metadata only"}
                      </span>
                    </div>
                  </article>
                    );
                  })()
                ))}
              </div>
            ) : null}
          </div>
        </Card>
      </section>

      {selectedSession ? (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm p-4 sm:p-6">
          <div className="mx-auto flex h-[92vh] w-full max-w-[1240px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <header className="border-b border-slate-100 px-5 py-4 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900">{selectedSession.user_id || "Unknown user"}</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {formatSessionLocation(selectedSession)} | {formatDateTime(selectedSession.start_timestamp)}
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">Session: {selectedSession.session_id}</p>
              </div>
              <Button variant="ghost" size="icon" onClick={closeReplay} className="h-8 w-8 text-slate-500">ESC</Button>
            </header>

            <div className="flex-1 overflow-hidden bg-slate-50 flex flex-col">
              {replayLoading ? <div className="p-10 text-center text-sm text-slate-500">Loading replay...</div> : null}
              {replayError ? <div className="p-10 text-center text-sm text-red-600">{replayError}</div> : null}

              {!replayLoading && !replayError ? (
                <>
                  <section className="border-b border-slate-200 bg-white px-4 py-3 flex flex-wrap items-center gap-2 text-xs flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setMetricFilter("click");
                        setActiveSidebarTab("events");
                      }}
                      className={`rounded-full border px-3 py-1.5 font-medium ${metricFilter === "click" ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200 bg-slate-50 text-slate-700"}`}
                    >
                      Dead Clicks: {timelineSummary.click}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMetricFilter("error");
                        setActiveSidebarTab("errors");
                      }}
                      className={`rounded-full border px-3 py-1.5 font-medium ${metricFilter === "error" ? "border-red-300 bg-red-50 text-red-700" : "border-slate-200 bg-slate-50 text-slate-700"}`}
                    >
                      Console Errors: {timelineSummary.error}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMetricFilter("network");
                        setActiveSidebarTab("network");
                      }}
                      className={`rounded-full border px-3 py-1.5 font-medium ${metricFilter === "network" ? "border-amber-300 bg-amber-50 text-amber-700" : "border-slate-200 bg-slate-50 text-slate-700"}`}
                    >
                      API Calls: {timelineSummary.network}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMetricFilter("page");
                        setActiveSidebarTab("events");
                      }}
                      className={`rounded-full border px-3 py-1.5 font-medium ${metricFilter === "page" ? "border-violet-300 bg-violet-50 text-violet-700" : "border-slate-200 bg-slate-50 text-slate-700"}`}
                    >
                      Pages: {timelineSummary.page}
                    </button>
                    <button
                      type="button"
                      onClick={() => setMetricFilter("all")}
                      className="ml-auto rounded-full border border-slate-200 bg-white px-3 py-1.5 font-medium text-slate-600 hover:bg-slate-50"
                    >
                      Clear Filter
                    </button>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-slate-700">
                      Duration: {formatDuration(sessionDurationMs)}
                    </span>
                  </section>

                  <section className="flex-1 min-h-0 overflow-hidden bg-slate-100/70 px-4 py-3">
                    <div className="grid h-full min-h-0 grid-cols-[330px_minmax(0,1fr)] gap-3">
                      <aside className="min-h-0 overflow-hidden rounded-xl border border-slate-200 bg-white flex flex-col">
                        <div className="border-b border-slate-100 p-2 grid grid-cols-3 gap-1 text-xs">
                          {[
                            { id: "events", label: "Events" },
                            { id: "errors", label: "Errors" },
                            { id: "network", label: "Network" },
                          ].map((tab) => (
                            <button
                              key={tab.id}
                              type="button"
                              onClick={() => setActiveSidebarTab(tab.id)}
                              className={`rounded-md px-2 py-1.5 font-semibold ${activeSidebarTab === tab.id ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
                            >
                              {tab.label}
                            </button>
                          ))}
                        </div>

                        <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-2">
                          {sidebarItems.length === 0 ? (
                            <p className="px-2 py-4 text-xs text-slate-500">No logs for this filter.</p>
                          ) : (
                            sidebarItems.map((eventItem) => {
                              const selected = selectedInspectorEventId === eventItem.markerId;
                              const color = EVENT_COLORS[eventItem.type] || "#64748b";
                              return (
                                <button
                                  key={eventItem.id}
                                  type="button"
                                  onClick={() => jumpToInspectorEvent(eventItem)}
                                  className={`w-full rounded-lg border p-2 text-left transition ${selected ? "border-slate-900 bg-slate-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold" style={{ color }}>
                                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                                      {EVENT_LABELS[eventItem.type] || eventItem.type}
                                    </span>
                                    <span className="text-[10px] text-slate-500">{formatDuration(eventItem.offsetMs)}</span>
                                  </div>
                                  <p className="mt-1 text-[11px] text-slate-800 break-words">{eventItem.detail}</p>

                                  {eventItem.type === "error" ? (
                                    <>
                                      <p className="mt-1 text-[10px] font-mono text-slate-600 break-words">
                                        {eventItem.metadata?.source || "console"}{eventItem.metadata?.line ? `:${eventItem.metadata.line}` : ""}
                                      </p>
                                      {eventItem.metadata?.stack ? (
                                        <p className="mt-1 text-[10px] text-slate-500 line-clamp-3 break-words">{eventItem.metadata.stack}</p>
                                      ) : null}
                                    </>
                                  ) : null}

                                  {eventItem.type === "network" ? (
                                    <p className="mt-1 text-[10px] text-slate-600">
                                      Status: {eventItem.metadata?.status || "-"} | Duration: {eventItem.metadata?.duration ? `${eventItem.metadata.duration}ms` : "-"}
                                    </p>
                                  ) : null}
                                </button>
                              );
                            })
                          )}
                        </div>
                      </aside>

                      <div className="min-h-0 overflow-hidden rounded-xl border border-slate-200 bg-white flex flex-col">
                        <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2 text-xs text-slate-600">
                          <span>Replay Workspace</span>
                          <div className="flex items-center gap-1">
                            {[1, 1.25, 1.5].map((zoom) => (
                              <button
                                key={zoom}
                                type="button"
                                onClick={() => setPlayerZoom(zoom)}
                                className={`rounded px-2 py-1 font-semibold ${playerZoom === zoom ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
                              >
                                {zoom}x
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="relative flex-1 min-h-0 p-2">
                          <div className="h-full w-full overflow-hidden rounded-lg border border-slate-100 bg-white">
                            <div ref={playerContainerRef} className="flex h-full w-full items-center justify-center overflow-hidden" style={{ contain: "layout style paint" }} />
                          </div>

                          {selectedTimelineMarker?.type === "click" ? (
                            <div className="pointer-events-none absolute right-8 top-8">
                              <span className="relative flex h-4 w-4">
                                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
                                <span className="relative inline-flex h-4 w-4 rounded-full bg-blue-500" />
                              </span>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </section>

                  {sessionDurationMs > 0 ? (
                    <section className="border-t border-slate-200 bg-white px-4 py-3 flex-shrink-0">
                      <div className="mb-2 flex flex-wrap items-center gap-3 text-[11px] text-slate-600">
                        {Object.keys(EVENT_LABELS).map((type) => (
                          <span key={type} className="inline-flex items-center gap-1">
                            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: EVENT_COLORS[type] }} />
                            {EVENT_LABELS[type]}
                          </span>
                        ))}
                      </div>

                      <div className="relative h-10" onClick={handleTimelineClick} onMouseLeave={() => setHoveredMarkerId("")}> 
                        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-slate-200">
                          <div className="h-full rounded-full bg-slate-900" style={{ width: `${playbackPercent}%` }} />
                        </div>

                        {timelineMarkers.map((marker) => {
                          const dimmed = highlightedMarkerType && marker.type !== highlightedMarkerType;
                          const active = marker.id === selectedInspectorEventId || marker.id === activeTimelineEventId;
                          return (
                            <button
                              key={marker.id}
                              type="button"
                              title={`${EVENT_LABELS[marker.type]} - ${marker.detail}`}
                              onMouseEnter={() => setHoveredMarkerId(marker.id)}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedInspectorEventId(marker.id);
                                jumpToTime(marker.offsetMs);
                              }}
                              className={`absolute h-5 w-[3px] -translate-x-1/2 rounded-full shadow ${active ? "ring-2 ring-slate-900" : ""}`}
                              style={{
                                left: `${marker.percent}%`,
                                top: "50%",
                                marginTop: marker.lane * 2 - 8,
                                backgroundColor: EVENT_COLORS[marker.type] || "#334155",
                                opacity: dimmed ? 0.22 : 1,
                              }}
                            />
                          );
                        })}

                        <div
                          className="absolute h-3.5 w-3.5 -translate-y-1/2 rounded-full border-2 border-slate-900 bg-white shadow"
                          style={{ left: `${playbackPercent}%`, top: "50%" }}
                        />

                        {hoveredMarker ? (
                          <div
                            className="absolute bottom-full mb-2 -translate-x-1/2 rounded-md bg-slate-900 px-2 py-1 text-xs text-white"
                            style={{ left: `${hoveredMarker.percent}%` }}
                          >
                            {EVENT_LABELS[hoveredMarker.type]} | {formatDuration(hoveredMarker.offsetMs)} | {hoveredMarker.detail}
                          </div>
                        ) : null}
                      </div>

                      <div className="mt-3 flex items-center justify-between gap-3">
                        <div className="text-xs text-slate-500">
                          {formatDuration(replayCurrentTime)} / {formatDuration(sessionDurationMs)}
                        </div>

                        <div className="flex items-center gap-2">
                          <Button variant="secondary" size="sm" onClick={() => jumpToTime(Math.max(0, replayCurrentTime - 10000))}>-10s</Button>
                          <Button variant="primary" size="md" onClick={togglePlayback}>
                            {isPlaying ? <Icons.Pause className="h-4 w-4" /> : <Icons.Play className="h-4 w-4 ml-0.5" />}
                          </Button>
                          <Button variant="secondary" size="sm" onClick={() => jumpToTime(Math.min(sessionDurationMs, replayCurrentTime + 10000))}>+10s</Button>
                        </div>

                        <div className="flex items-center gap-1">
                          {[1, 2, 4].map((speed) => (
                            <button
                              key={speed}
                              type="button"
                              onClick={() => handleSpeedChange(speed)}
                              className={`rounded px-2 py-1 text-xs font-semibold ${playbackSpeed === speed ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-100"}`}
                            >
                              {speed}x
                            </button>
                          ))}
                        </div>
                      </div>
                    </section>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
