import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Icons } from "@/components/ui/Icons";

const METRIC_OPTIONS = [
  { value: "count", label: "Count" },
  { value: "unique_users", label: "Unique Users" },
];

const CHART_TYPES = [
  { value: "line", label: "Line" },
  { value: "bar", label: "Bar" },
  { value: "table", label: "Table" },
];

const TIME_RANGES = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "custom", label: "Custom" },
];

const INTERVALS = [
  { value: "day", label: "Daily" },
  { value: "hour", label: "Hourly" },
];

const BREAKDOWN_OPTIONS = [
  { value: "page", label: "Page" },
  { value: "user_id", label: "User" },
  { value: "session_id", label: "Session" },
];

const FALLBACK_EVENTS = [
  "page_view",
  "click",
  "login_success",
  "signup_started",
  "error",
  "promise_error",
];

export default function GuidedQueryBuilder({
  query,
  eventOptions,
  onQueryChange,
  onAddToDashboard,
  disableActions,
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [eventSearch, setEventSearch] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const allEvents = useMemo(() => {
    const base = Array.isArray(eventOptions) && eventOptions.length > 0 ? eventOptions : FALLBACK_EVENTS;
    return Array.from(new Set(base.map((item) => String(item || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  }, [eventOptions]);

  const filteredEvents = useMemo(() => {
    const needle = String(eventSearch || "").trim().toLowerCase();
    if (!needle) return allEvents;
    return allEvents.filter((item) => item.toLowerCase().includes(needle));
  }, [allEvents, eventSearch]);

  function toggleEvent(eventName) {
    const next = Array.isArray(query.events) ? [...query.events] : [];
    const index = next.indexOf(eventName);
    if (index === -1) {
      next.push(eventName);
    } else {
      next.splice(index, 1);
    }
    onQueryChange({ ...query, events: next });
  }

  function removeEvent(eventName) {
    onQueryChange({
      ...query,
      events: (query.events || []).filter((item) => item !== eventName),
    });
  }

  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-base font-semibold text-slate-900">Query Builder</h2>
        <Badge variant="outline" className="text-xs text-slate-500">
          {(query.events || []).length} selected
        </Badge>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-semibold text-slate-600">Events</p>
        <button
          type="button"
          onClick={() => setPickerOpen((prev) => !prev)}
          className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-700"
        >
          <span>{(query.events || []).length > 0 ? `${query.events.length} events selected` : "Select events"}</span>
          <Icons.ChevronDown className="h-4 w-4 text-slate-400" />
        </button>

        {pickerOpen ? (
          <div className="mt-2 rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
            <div className="relative">
              <Icons.Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={eventSearch}
                onChange={(e) => setEventSearch(e.target.value)}
                placeholder="Search events"
                className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500"
              />
            </div>

            <div className="mt-2 max-h-52 overflow-auto rounded-lg border border-slate-100">
              {filteredEvents.length === 0 ? (
                <p className="p-3 text-xs text-slate-500">No matching events.</p>
              ) : (
                filteredEvents.map((eventName) => {
                  const checked = (query.events || []).includes(eventName);
                  return (
                    <label
                      key={eventName}
                      className="flex cursor-pointer items-center gap-2 border-b border-slate-100 px-3 py-2 text-sm last:border-b-0 hover:bg-slate-50"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleEvent(eventName)}
                      />
                      <span className="truncate">{eventName}</span>
                    </label>
                  );
                })
              )}
            </div>
          </div>
        ) : null}

        <div className="mt-2 flex min-h-[42px] flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
          {(query.events || []).length === 0 ? (
            <span className="text-xs text-slate-500">No events selected yet.</span>
          ) : (
            (query.events || []).map((eventName) => (
              <Badge key={eventName} variant="secondary" className="gap-1.5 py-1 pl-2.5 pr-1">
                {eventName}
                <button
                  type="button"
                  onClick={() => removeEvent(eventName)}
                  className="rounded-full p-0.5 text-slate-500 hover:bg-slate-200 hover:text-slate-700"
                >
                  <Icons.X className="h-3 w-3" />
                </button>
              </Badge>
            ))
          )}
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-semibold text-slate-600">Metric</p>
        <div className="grid grid-cols-2 gap-2">
          {METRIC_OPTIONS.map((item) => (
            <label
              key={item.value}
              className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                query.metric === item.value ? "border-blue-400 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-700"
              }`}
            >
              <input
                type="radio"
                name="metric"
                checked={query.metric === item.value}
                onChange={() => onQueryChange({ ...query, metric: item.value })}
              />
              {item.label}
            </label>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-semibold text-slate-600">Chart Type</p>
        <div className="grid grid-cols-3 gap-2">
          {CHART_TYPES.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => onQueryChange({ ...query, chartType: item.value })}
              className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                query.chartType === item.value ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-semibold text-slate-600">Time Range</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <select
            value={query.timeRange}
            onChange={(e) => onQueryChange({ ...query, timeRange: e.target.value })}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500"
          >
            {TIME_RANGES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>

          <select
            value={query.interval}
            onChange={(e) => onQueryChange({ ...query, interval: e.target.value })}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500"
          >
            {INTERVALS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>

        {query.timeRange === "custom" ? (
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <input
              type="date"
              value={query.startDate || ""}
              onChange={(e) => onQueryChange({ ...query, startDate: e.target.value })}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500"
            />
            <input
              type="date"
              value={query.endDate || ""}
              onChange={(e) => onQueryChange({ ...query, endDate: e.target.value })}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500"
            />
          </div>
        ) : null}
      </div>

      <div>
        <button
          type="button"
          onClick={() => setShowAdvanced((prev) => !prev)}
          className="inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900"
        >
          <Icons.ChevronDown className={`h-4 w-4 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
          Advanced Options
        </button>

        {showAdvanced ? (
          <div className="mt-2 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Breakdown</label>
              <select
                value={query.breakdown || ""}
                onChange={(e) => onQueryChange({ ...query, breakdown: e.target.value || null })}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500"
              >
                <option value="">None</option>
                {BREAKDOWN_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Filter</label>
              <input
                type="text"
                value={Array.isArray(query.filters) ? query.filters[0] || "" : ""}
                onChange={(e) => onQueryChange({ ...query, filters: e.target.value ? [e.target.value] : [] })}
                placeholder="Filter by event/page/user text"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-500"
              />
            </div>
          </div>
        ) : null}
      </div>

      <Button type="button" variant="primary" onClick={onAddToDashboard} disabled={disableActions}>
        <Icons.Plus className="mr-1.5 h-4 w-4" />
        Add to Dashboard
      </Button>
    </div>
  );
}
