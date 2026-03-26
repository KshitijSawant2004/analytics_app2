# Production Analytics Refactor - Quick Start Guide

## What Changed?

Your analytics chart system has been **completely refactored** to be production-grade like Amplitude or Metabase.

### Major Improvements
✅ **Server-side aggregation** - Real database queries, not in-memory data  
✅ **Proper metrics** - COUNT and UNIQUE_USERS calculated correctly  
✅ **Real-time charts** - Updates instantly when you change selections  
✅ **Time bucketing** - Auto-detects hour/day/week intervals  
✅ **Production features** - Loading states, error handling, validations  
✅ **Professional UX** - Clean Amplitude-style query builder  

---

## Quick Start (30 seconds)

### 1. Start the backend
```bash
cd c:\Users\Kshitij\Desktop\analytics\backend
npm run dev
```
✓ Should say listening on port 4001

### 2. Start the dashboard frontend
```bash
cd c:\Users\Kshitij\Desktop\analytics\dashboard-frontend
npm run dev -- --webpack -p 3001
```
✓ Should say ready on port 3001

### 3. Open the charts page
```
http://localhost:3001/charts-analysis
```

### 4. Build a chart (30 seconds)
1. Click **"Line"** chart type
2. Search for an event in the dropdown (any event, e.g., "page_view")
3. **Watch the chart appear** in real-time on the right
4. Try switching to **"Bar"** and see X/Y axis selectors
5. Try changing metric from "Count" to "Unique users"
6. Click **"Add to Dashboard"** to save it

---

## What You're Looking At

### Left Panel (Query Builder)
- **Chart Type**: Line / Bar / Table
- **Select Events**: Pick 1+ events to analyze
- **Metric**: Count or Unique Users
- **Time Range**: Last 7/30 days or custom
- **Optional**: Breakdown, Filter, X/Y axes (bar only)

### Right Panel (Chart Preview)
- **Real-time chart** that updates as you build the query
- **Loading spinner** shows when fetching data
- **Empty state** guides you to select events first
- **Bar scaffold** shows placeholder when Bar type selected

---

## Key Features

### ✨ Single Source of Truth
All charts now fetch from a single backend endpoint: `/analytics/query`

No more in-memory calculations. Every chart is **accurate, fresh data**.

### 🚀 Auto-Bucketing
The system automatically chooses the best time interval:
- **Hourly** for data < 1 day old
- **Daily** for data < 90 days old
- **Weekly** for longer ranges

You never have to choose manually.

### 🛡️ Validation
Invalid states are **prevented**:
- Can't apply without selecting events
- Can't apply without selecting chart type
- Can't save without giving it a name
- Error messages tell you exactly what's wrong

### 📊 Multiple Chart Types
- **Line Chart**: Time-series with dates on X-axis
- **Bar Chart**: Custom X/Y axes (event, page, user, date, etc.)
- **Table View**: Tabular data with sorting

---

## Example Workflows

### Scenario 1: "How many users purchased last 7 days?"

1. Select **Line** chart
2. Type "purchase" in event search
3. Click **"Unique users"** metric
4. Keep timerange at "Last 7 days"
5. ➜ Chart appears showing daily unique purchasers

✓ Chart is accurate, real data from database

### Scenario 2: "Which pages are most visited?"

1. Select **Bar** chart
2. Type "page_view" in event search  
3. Set X-axis to **"Page"**
4. Set Y-axis to **"Count"**
5. ➜ Bar chart shows top pages by views

✓ Automatically sorted by highest count

### Scenario 3: "Compare signup rates"

1. Select **Line** chart
2. Add events: "signup", "email_confirmed"
3. Metric: **"Unique users"**
4. Time range: **"Last 30 days"**
5. ➜ Two lines show each event daily

✓ Compare trends side-by-side

---

## Under the Hood

### Backend Changes
- **New service**: `backend/services/analyticsQueryService.js`
  - Handles SQL aggregation, time bucketing, metric calculation
- **New endpoint**: `POST /analytics/query`
  - Single source of truth for all chart data
  - Proper validation and error handling

### Frontend Changes
- **New hook**: `dashboard-frontend/hooks/useAnalyticsQuery.js`
  - Fetches data from /analytics/query
  - Manages loading/error/data states
  - Auto-refetch on query param changes
- **Refactored page**: `dashboard-frontend/pages/charts-analysis.js`
  - Now uses server-side data, not in-memory
  - Query state properly separated (draft vs applied)
  - Loading/error states integrated

---

## Testing Data

To test with real events:

### Option 1: Use existing events
If your database has events from previous tracking, they'll show up in the dropdown automatically.

### Option 2: Create test events
Use the tracking script to generate events:
```bash
# From frontend or dashboard-frontend directory
# Find TRACKING_SCRIPT_TO_COPY.txt in root
node <tracking-script.js>
```

---

## Troubleshooting

### I don't see any events in the dropdown
**Solutions:**
1. Make sure backend is running (`npm run dev` on port 4001)
2. Check database has events table with data
3. Try in a seconds and refresh (API might be initializing)
4. Check browser console for errors
   
### Chart shows "No data for selected filters"
**Solutions:**
1. Try expanding date range (last 30 days instead of 7)
2. Make sure the event actually exists in database
3. Try selecting a different event
4. Check backend logs for errors

### Chart is very slow
**This is normal**:
1. First query initializes database - might be slow
2. Subsequent queries are cached and faster
3. If persistently slow, check backend logs

---

## Next Steps

1. **Explore the UI**: Try different chart types, metrics, events
2. **Save to dashboard**: Pin your favorite charts
3. **Edit existing queries**: Click the Edit icon on pinned charts
4. **Test with your own events**: Add real events via tracking script
5. **Check the logs**: See `PRODUCTION_ANALYTICS_REFACTOR.md` for detailed docs

---

## Questions?

Refer to `PRODUCTION_ANALYTICS_REFACTOR.md` for:
- Detailed architecture docs
- SQL query examples
- API reference
- Future enhancements
- Debug tips
