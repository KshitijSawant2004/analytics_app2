import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { getBackendBase } from "@/utils/backendBase";
import { resolveActiveProjectId, setActiveProjectId } from "@/utils/projectScope";

const GROUP_OPTIONS = [
  { value: "event_name", label: "Event Name" },
  { value: "page", label: "Page" },
  { value: "user_id", label: "User ID" },
  { value: "session_id", label: "Session ID" },
];

let resolvedBackendBase = null;

function sleep(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function getErrorMessageFromPayload(payload, fallback) {
  if (payload && typeof payload.message === "string" && payload.message.trim()) {
    return payload.message;
  }

  if (payload && typeof payload.error === "string" && payload.error.trim()) {
    return payload.error;
  }

  return fallback;
}

async function requestBackend(path, options = {}) {
  const timeout = Number(options.timeout || 10000);
  const candidateBases = [resolvedBackendBase, getBackendBase()].filter(
    (base, index, values) => Boolean(base) && values.indexOf(base) === index
  );
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const candidatePaths = [`/api${normalizedPath}`, normalizedPath, `/analytics${normalizedPath}`];

  let lastError = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    for (const base of candidateBases) {
      for (const pathVariant of candidatePaths) {
        let timeoutId;
        try {
          const controller = new AbortController();
          timeoutId = setTimeout(() => controller.abort(), timeout);

          const response = await fetch(`${base}${pathVariant}`, {
            ...options,
            signal: controller.signal,
          });

          if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            throw new Error(getErrorMessageFromPayload(payload, `Server ${base} returned ${response.status}`));
          }

          resolvedBackendBase = base;
          return await response.json();
        } catch (error) {
          lastError = error;
        } finally {
          clearTimeout(timeoutId);
        }
      }
    }

    if (attempt < 1) {
      await sleep(350);
    }
  }

  throw lastError || new Error("Could not reach backend");
}

export default function EventsPage() {
  const router = useRouter();
  const [projectId, setProjectId] = useState(resolveActiveProjectId());
  const [eventFilter, setEventFilter] = useState("");
  const [groupBy, setGroupBy] = useState("event_name");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const totalCount = useMemo(() => rows.reduce((sum, row) => sum + Number(row.count || 0), 0), [rows]);

  async function loadEvents() {
    try {
      setLoading(true);
      setError("");

      const params = new URLSearchParams();
      params.set("groupBy", groupBy);
      if (String(projectId || "").trim()) {
        params.set("project_id", String(projectId || "").trim());
      }
      if (String(eventFilter || "").trim()) {
        params.set("events", String(eventFilter || "").trim());
      }

      const data = await requestBackend(`/events?${params.toString()}`);
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      setRows([]);
      setError(err.message || "Could not fetch events");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!router.isReady) return;
    const next = resolveActiveProjectId(router.query.project_id);
    setProjectId(next);
    setActiveProjectId(next);
  }, [router.isReady, router.query.project_id]);

  useEffect(() => {
    void loadEvents();
  }, [projectId]);

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h1 className="font-display text-2xl font-semibold">Events</h1>
        <p className="mt-1 text-sm text-slate-600">
          View collected analytics events for a specific project ID from your tracking script.
        </p>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <label className="block md:col-span-1">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Project ID</span>
            <input
              type="text"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              placeholder="finfinity_website_UAT"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
          </label>

          <label className="block md:col-span-1">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Group By</span>
            <select
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            >
              {GROUP_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block md:col-span-2">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Event Filter (optional)</span>
            <input
              type="text"
              value={eventFilter}
              onChange={(e) => setEventFilter(e.target.value)}
              placeholder="page_view,signup_completed"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={loadEvents}
            disabled={loading}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {loading ? "Loading..." : "Load Events"}
          </button>
          <p className="text-sm text-slate-600">Total Count: {totalCount}</p>
        </div>

        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="overflow-auto rounded-xl border border-slate-200">
          <table className="w-full text-left text-sm text-slate-700">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2 font-semibold">Label</th>
                <th className="px-4 py-2 font-semibold">Count</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={2} className="px-4 py-8 text-center text-sm text-slate-500">
                    {loading ? "Fetching events..." : "No events found for this project/filter."}
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={`${row.label}-${row.count}`} className="border-t border-slate-100">
                    <td className="px-4 py-2 font-medium text-slate-900">{row.label || "(unknown)"}</td>
                    <td className="px-4 py-2">{Number(row.count || 0)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
