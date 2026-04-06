import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import GuidedQueryBuilder from "@/components/analysis/GuidedQueryBuilder";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Icons } from "@/components/ui/Icons";
import { useAnalyticsQuery, fetchEventsList } from "@/hooks/useAnalyticsQuery";
import { useDashboard } from "@/context/DashboardContext";

const DEFAULT_QUERY = {
  events: [],
  metric: "count",
  chartType: "line",
  timeRange: "7d",
  interval: "day",
  filters: [],
  breakdown: null,
  startDate: "",
  endDate: "",
};

const SERIES_COLORS = ["#0f172a", "#0284c7", "#16a34a", "#f59e0b", "#ef4444", "#7c3aed", "#0891b2"];

function metricLabel(metric) {
  return metric === "unique_users" ? "unique users" : "count";
}

function buildSummary(query) {
  if (!query.events || query.events.length === 0) {
    return "Select one or more events to start analysis.";
  }

  if (query.events.length === 1) {
    return `Showing ${query.events[0]} ${metricLabel(query.metric)} over time`;
  }

  if (query.events.length === 2) {
    return `Comparing ${query.events[0]} vs ${query.events[1]}`;
  }

  return `Comparing ${query.events.length} events by ${metricLabel(query.metric)}`;
}

export default function ChartsAnalysisPage() {
  const { addWidgetToDashboard, widgetLibrary } = useDashboard();
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [eventOptions, setEventOptions] = useState([]);
  const [initError, setInitError] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const events = await fetchEventsList();
        setEventOptions(events);
        setInitError("");
      } catch (error) {
        console.error("Failed to load events", error);
        setInitError("Could not load events. You can still type and select fallback events.");
      }
    }

    load().catch((error) => {
      console.error("Unexpected charts bootstrap failure", error);
      setInitError("Could not load events. You can still type and select fallback events.");
      setEventOptions([]);
    });
  }, []);

  const querySummary = useMemo(() => buildSummary(query), [query]);
  const queryPayload = useMemo(() => ({ ...query }), [query]);

  const { data: chartData, loading: chartLoading, error: chartError } = useAnalyticsQuery(queryPayload);

  const chartRows = useMemo(() => {
    const labels = Array.isArray(chartData?.labels) ? chartData.labels : [];
    const datasets = Array.isArray(chartData?.datasets) ? chartData.datasets : [];

    return labels.map((label, index) => {
      const row = { label };
      let total = 0;
      datasets.forEach((series) => {
        const key = series.label;
        const value = Number(series?.data?.[index] || 0);
        row[key] = value;
        total += value;
      });
      row.total = total;
      return row;
    });
  }, [chartData]);

  const hasEvents = (query.events || []).length > 0;
  const hasData = chartRows.length > 0;

  function addToDashboard() {
    if (!hasEvents || !hasData) return;

    const compactData = chartRows.map((row) => ({ label: row.label, count: row.total }));

    addWidgetToDashboard({
      type: "custom-query",
      title: `Analysis: ${(query.events || []).slice(0, 2).join(" vs ")}`,
      chartType: query.chartType,
      metric: query.metric,
      selectedEvents: query.events,
      timeRange: query.timeRange,
      interval: query.interval,
      filters: query.filters,
      breakdown: query.breakdown,
      sourcePage: "/charts-analysis",
      sourceLabel: "Explore / Analysis",
      description: querySummary,
      data: compactData,
    });
  }

  const pinnedAnalyses = useMemo(
    () => widgetLibrary.filter((item) => item.sourcePage === "/charts-analysis"),
    [widgetLibrary]
  );

  return (
    <div className="space-y-5 pb-6">
      <section className="mx-auto max-w-[1300px] px-4 pt-5 sm:px-6 lg:px-8">
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <h1 className="font-display text-xl font-semibold tracking-tight text-slate-900">Explore / Analysis</h1>
          <p className="text-xs text-slate-500">Build analytics charts like Amplitude/PostHog with clean controls.</p>
        </div>
      </section>

      <section className="mx-auto grid max-w-[1300px] gap-4 px-4 sm:px-6 lg:grid-cols-[360px_minmax(0,1fr)] lg:px-8">
        <GuidedQueryBuilder
          query={query}
          eventOptions={eventOptions}
          onQueryChange={setQuery}
          onAddToDashboard={addToDashboard}
          disableActions={!hasEvents || !hasData}
        />

        <Card className="min-h-[560px] overflow-hidden p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <h2 className="font-display flex items-center gap-2 text-lg font-semibold text-slate-900">
                <Icons.BarChart className="h-5 w-5 text-slate-400" />
                Chart Preview
              </h2>
              <p className="mt-1 text-sm text-slate-600">{querySummary}</p>
            </div>
            <Badge variant="outline" className="text-xs text-slate-500">
              {metricLabel(query.metric)}
            </Badge>
          </div>

          {initError ? (
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">{initError}</div>
          ) : null}

          {chartError ? (
            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{chartError}</div>
          ) : null}

          {!hasEvents ? (
            <EmptyState label="Select at least one event to render a chart." />
          ) : chartLoading ? (
            <EmptyState label="Loading chart data..." />
          ) : !hasData ? (
            <EmptyState label="No data available for this configuration." />
          ) : query.chartType === "table" ? (
            <TableView rows={chartRows} datasets={chartData.datasets || []} />
          ) : query.chartType === "bar" ? (
            <BarChartView rows={chartRows} datasets={chartData.datasets || []} />
          ) : (
            <LineChartView rows={chartRows} datasets={chartData.datasets || []} />
          )}
        </Card>
      </section>

      <section className="mx-auto max-w-[1300px] px-4 sm:px-6 lg:px-8">
        <Card className="overflow-hidden p-0 shadow-sm">
          <div className="border-b border-slate-100 bg-white p-5">
            <h2 className="font-display text-lg font-semibold text-slate-900">Pinned Analyses</h2>
          </div>
          <div className="bg-slate-50/50 p-5">
            {pinnedAnalyses.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
                No analyses pinned yet. Build a chart and click Add to Dashboard.
              </p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {pinnedAnalyses.map((item) => (
                  <Card key={item.id} className="border-slate-200 bg-white p-4 shadow-sm">
                    <p className="text-sm font-semibold text-slate-900">{item.title || "Custom Analysis"}</p>
                    <p className="mt-1 text-xs text-slate-500">{item.description || "Saved analysis"}</p>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </Card>
      </section>
    </div>
  );
}

function EmptyState({ label }) {
  return (
    <div className="flex h-[380px] items-center justify-center rounded-xl border border-dashed border-slate-300 text-sm text-slate-500">
      {label}
    </div>
  );
}

function LineChartView({ rows, datasets }) {
  return (
    <div className="h-[420px] w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 16, right: 20, left: 0, bottom: 24 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#dbe3ef" />
          <XAxis dataKey="label" interval={0} angle={-15} textAnchor="end" height={72} />
          <YAxis allowDecimals={false} />
          <Tooltip />
          <Legend />
          {datasets.map((series, index) => (
            <Line
              key={series.label}
              type="monotone"
              dataKey={series.label}
              stroke={SERIES_COLORS[index % SERIES_COLORS.length]}
              strokeWidth={2.5}
              dot={{ r: 2 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function BarChartView({ rows, datasets }) {
  return (
    <div className="h-[420px] w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 16, right: 20, left: 0, bottom: 24 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#dbe3ef" />
          <XAxis dataKey="label" interval={0} angle={-15} textAnchor="end" height={72} />
          <YAxis allowDecimals={false} />
          <Tooltip />
          <Legend />
          {datasets.map((series, index) => (
            <Bar
              key={series.label}
              dataKey={series.label}
              fill={SERIES_COLORS[index % SERIES_COLORS.length]}
              radius={[6, 6, 0, 0]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function TableView({ rows, datasets }) {
  return (
    <div className="h-[420px] overflow-auto rounded-xl border border-slate-200">
      <table className="w-full text-left text-sm text-slate-700">
        <thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2 font-semibold">Time</th>
            {datasets.map((series) => (
              <th key={series.label} className="px-4 py-2 font-semibold">
                {series.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-t border-slate-100 hover:bg-slate-50">
              <td className="px-4 py-2 font-medium text-slate-900">{row.label}</td>
              {datasets.map((series) => (
                <td key={`${row.label}-${series.label}`} className="px-4 py-2">
                  {Number(row[series.label] || 0)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
