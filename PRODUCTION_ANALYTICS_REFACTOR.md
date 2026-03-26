# Production-Grade Analytics Chart Refactoring

## Overview

The analytics chart system has been completely refactored from a demo/prototype into a **production-grade system** inspired by tools like Amplitude and Metabase.

### Key Transformation

**Before:**
- Charts rendered from in-memory `.recent_activity` data (limited to 20 items)
- No real database aggregation
- Incorrect data calculations
- Invalid states allowed (empty filters, broken configs)
- Low performance and unreliable insights

**After:**
- **Server-side aggregation** with proper SQL queries
- **Single source of truth**: `/analytics/query` endpoint
- **Real-time data**: Fresh queries on every change
- **Proper metrics**: COUNT and UNIQUE_USERS calculated correctly
- **Time bucketing**: Auto-detect optimal intervals (hour/day/week)
- **State validation**: Prevents invalid queries
- **Professional UI**: Clean, Amplitude-style query builder
- **Production features**: Loading states, error handling, empty states

---

## Architecture

### Backend (Node.js/Express)

#### New Service: `analyticsQueryService.js`

Three core query functions:

1. **`executeAnalyticsQuery()`** - General-purpose grouping queries
   - Supports grouping by: event_name, page, user_id, session_id, created_at, device_type, country
   - Supports metrics: count, unique_users
   - Returns aggregated data for table/breakdown views

2. **`executeTimeSeriesQuery()`** - Time-series (line chart) queries
   - Auto-selects interval based on date range:
     - ≤1 day: hourly bucketing
     - ≤90 days: daily bucketing
     - \>90 days: weekly bucketing
   - Proper SQL `DATE_TRUNC()` for accurate grouping

3. **`executeBarChartQuery()`** - Bar chart with custom X/Y axes
   - X-axis options: event_name, page, user_id, session_id, created_at, device_type, country
   - Y-axis metrics: count, unique_users
   - Sorted by value (descending), limited to top 50

#### New Endpoint: `POST /analytics/query`

**Request Body:**
```json
{
  "eventNames": ["purchase", "signup"],
  "metric": "count" | "unique_users",
  "chartType": "line" | "bar" | "table",
  "groupBy": "event_name",
  "xAxis": "event_name" | "page" | "user_id" | "session_id" | "created_at" | "device_type",
  "yAxis": "count" | "unique_users",
  "startDate": "2026-03-01",
  "endDate": "2026-03-25",
  "filterText": "optional search string"
}
```

**Response:**
```json
{
  "labels": ["2026-03-01", "2026-03-02", ...],
  "datasets": [{
    "label": "Count",
    "data": [120, 180, ...]
  }],
  "raw": [{...}, {...}, ...]
}
```

**Validation:**
- `eventNames`: required, non-empty array
- `startDate`, `endDate`: required, ISO format (YYYY-MM-DD)
- `chartType`: must be "line", "bar", or "table"
- `metric`: must be "count" or "unique_users"

---

### Frontend (React/Next.js)

#### New Hook: `useAnalyticsQuery()`

**Purpose:** Single, reusable hook for all analytics data fetching

**Features:**
- Auto-fetches when query params change
- Manages loading/error/data states
- Validates required parameters before fetching
- Handles errors gracefully with descriptive messages
- Returns: `{ data, loading, error, refetch }`

**Usage:**
```js
const { data, loading, error } = useAnalyticsQuery({
  eventNames: ["purchase"],
  metric: "count",
  chartType: "line",
  startDate: "2026-03-01",
  endDate: "2026-03-25"
});
```

#### Refactored Page: `charts-analysis.js`

**Key Changes:**
1. **Removed:** In-memory data calculation using `recentActivityRows`
2. **Added:** `useAnalytics Query` hook for server-side aggregation
3. **Query State:** Single source of truth using `useState`
   - `query`: Draft state (user's active selections)
   - `appliedQuery`: Applied state (drives data fetching and preview)
4. **Validation:**
   - Both chart type and events required before Apply
   - Invalid states disabled
   - Clear error messages
5. **Loading States:** Spinner shows during chart reload
6. **Error States:** Red banner with error message
7. **Empty States:** Scaffold chart for bar type, empty state prompt for others

**Query Object Schema:**
```js
{
  name: "",
  metric: "count",
  view: "", // "line", "bar", "table"
  breakdown: "none",
  showBreakdown: false,
  filterText: "",
  showFilter: false,
  selectedEvents: [],
  xAxis: "event_name", // Bar chart only
  yAxis: "count",      // Bar chart only
  timeRange: "last_7_days",
  startDate: "",
  endDate: "",
}
```

---

## Data Flow

### 1. User Selects Chart Type
```
User clicks "Line" 
  → setQuery({ view: "line" }) 
  → applyQuery()
  → queryParams computed
```

### 2. User Adds Event
```
User clicks "purchase" event 
  → setQuery({ selectedEvents: [..., "purchase"] }) 
  → applyQuery()
  → queryParams computed (eventNames: ["purchase"])
```

### 3. queryParams Change Triggers Fetch
```
queryParams useMemo updates 
  → useAnalyticsQuery hook detects change
  → POST /analytics/query with eventNames, metric, chartType, dates...
  → Backend executes SQL aggregation
  → Returns labels, datasets
```

### 4. Chart Renders
```
chartData received 
  → previewData transformed to ChartRenderer format
  → ChartRenderer renders Line/Bar/Table
  → User sees live,  accurate data
```

---

## Key Improvements

### 1. **Accuracy**
- ✅ Server-side aggregation using PostgreSQL
- ✅ Proper COUNT(*) and COUNT(DISTINCT user_id)
- ✅ Correct time bucketing with DATE_TRUNC()
- ✅ No data duplication or double-counting

### 2. **Reliability**
- ✅ Single query endpoint (no multiple endpoints)
- ✅ Comprehensive error handling
- ✅ Input validation
- ✅ Graceful fallbacks for missing data

### 3. **Performance**
- ✅ Indexed database queries (on created_at, event_name, etc.)
- ✅ Server caches results briefly
- ✅ Client-side query parameter memoization prevents unnecessary refetches
- ✅ Limits resultsets to 50-500 rows

### 4. **User Experience**
- ✅ Real-time preview on every change
- ✅ Clear loading indicators
- ✅ Descriptive error messages
- ✅ Empty state prompts guide users
- ✅ No invalid states permitted
- ✅ Amplitude-style interface

### 5. **Maintainability**
- ✅ Separation of concerns: services, hooks, components
- ✅ Clear naming conventions
- ✅ Reusable query hook
- ✅ No state duplication
- ✅ Type-safe parameter validation

---

## Supported Features

### Chart Types
- **Line:** Time-series with auto-bucketing (hour/day/week)
- **Bar:** Custom X/Y axis selection
- **Table:** Tabular data view

### Metrics
- **Count:** Total event occurrences
- **Unique Users:** Distinct `COUNT(DISTINCT user_id)`

### Grouping
- **event_name:** Most common
- **page:** URL patterns
- **user_id:** Per-user analysis
- **session_id:** Session-level aggregation
- **created_at:** Time-based grouping
- **device_type:** Device breakdown
- **country:** Geographic analysis

### Time Ranges
- **Preset:** Last 7 days, Last 30 days, This month
- **Custom:** Date range picker
- **Auto-interval:** System selects hour/day/week based on range

### Filters
- Optional text search (event_name, page, user_id)
- Date range filtering
- Event selection

---

## Example Queries

### "How many users signed up last 7 days?"
```json
POST /analytics/query
{
  "eventNames": ["signup"],
  "metric": "unique_users",
  "chartType": "line",
  "startDate": "2026-03-19",
  "endDate": "2026-03-25"
}
```

**Response:**
```json
{
  "labels": ["2026-03-19", "2026-03-20", ...],
  "datasets": [{
    "label": "Unique Users",
    "data": [45, 52, 41, ...]
  }]
}
```

### "Show me page views by page"
```json
POST /analytics/query
{
  "eventNames": ["page_view"],
  "metric": "count",
  "chartType": "bar", 
  "xAxis": "page",
  "yAxis": "count",
  "startDate": "2026-03-01",
  "endDate": "2026-03-25"
}
```

**Response:**
```json
{
  "labels": ["/", "/pricing", "/docs", "/blog"],
  "datasets": [{
    "label": "Count",
    "data": [2485, 891, 634, 412]
  }]
}
```

---

## Migration Guide

### For Dashboard Widgets

Old format:
```js
{
  type: "custom-query",
  chartType: "line",
  metric: "count",
  view: "line",
  groupBy: "created_at",
  selectedEvents: ["purchase"],
  data: [...] // Stale data
}
```

New format (same structure):
- Same saving structure
- `data` field now regenerated on load via hook
- Backwards compatible with library

---

## Testing the System

### 1. Start Backend
```bash
cd backend
npm run dev  # Port 4001
```

### 2. Start Dashboard Frontend
```bash
cd dashboard-frontend
npm run dev -- --webpack -p 3001
```

### 3. Visit Charts-Analysis Page
```
http://localhost:3001/charts-analysis
```

### 4. Test Flow
1. Create a few test events using the tracking script
2. Select "Line" chart
3. Select an event (e.g., "page_view")
4. Observe real-time chart preview
5. Switch to "Bar" chart and select X/Y axes
6. Change metric from "Count" to "Unique users"
7. Adjust time range
8. Pin to dashboard

---

## Debug Tips

### Backend Logs
```bash
# Test query endpoint
curl -X POST http://localhost:4001/analytics/query \
  -H "Content-Type: application/json" \
  -d '{
    "eventNames": ["page_view"],
    "metric": "count",
    "chartType": "line",
    "startDate": "2026-03-01",
    "endDate": "2026-03-25"
  }'
```

### Frontend Logs
- Open DevTools Console
- Check for `useAnalyticsQuery` hook logs
- Network tab to inspect POST requests

### Common Issues
- **"No events selected"**: Make sure events exist in database
- **"No data for selected filters"**: Date range may be outside data range
- **Slow queries**: Add indexes on frequently filtered columns

---

## Future Enhancements

1. **Breakdown by multiple dimensions**
   - e.g., "Count by country AND device_type"

2. **Multi-event comparison**
   - Compare "signup" vs "purchase" side-by-side

3. **Custom metrics**
   - Define ratio, percentile, moving average

4. **Data export**
   - CSV, JSON export of query results

5. **Query sharing**
   - Shareable URL snapshots
   - Saved queries library

6. **Real-time updates**
   - WebSocket for live dashboards
   - Auto-refresh options

---

## Summary

The refactored chart system is now:
- **Accurate:** Proper SQL aggregation
- **Reliable:** Comprehensive validation and error handling
- **Fast:** Optimized queries and caching
- **Intuitive:** Amplitude-style UX
- **Maintainable:** Clean code architecture
- **Production-ready:** Can handle real analytics workloads

Charts feel like a **real analytics tool**, not a demo.
