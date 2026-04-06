# Analytics Platform

A self-hosted web analytics SDK — tracks events, sessions, heatmaps, and recordings from any website.

## Project Structure

```
analytics-finfinity/
├── analytics.js                        ← SDK to embed on external websites
├── TRACKING_SCRIPT_TO_COPY.txt         ← Embed instructions
├── apps/
│   └── analytics-platform/
│       ├── backend/                    ← Node.js/Express API server
│       └── dashboard/                  ← Analytics dashboard (Next.js)
└── dashboard-frontend/                 ← Legacy dashboard (if applicable)
```

## Quick Start

### 1. Backend

```bash
cd apps/analytics-platform/backend
cp .env.example .env   # set DATABASE_URL
npm install
npm run dev            # starts on port 4001
```

### 2. Embed the SDK on your website

See `TRACKING_SCRIPT_TO_COPY.txt` for the exact snippet.

```html
<script
  src="https://YOUR_BACKEND_DOMAIN/analytics.js"
  data-project-id="my-website"
  data-endpoint="https://YOUR_BACKEND_DOMAIN/api"
></script>
```

### 3. Dashboard

```bash
npm run dev:dashboard  # starts dashboard dev server
```

## Environment Variables (backend/.env)

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (Supabase or self-hosted) |
| `PORT` | Server port (default: 4001) |
| `ALLOWED_ORIGINS` | Comma-separated allowed CORS origins for read endpoints (optional) |
| `EMAIL_USER` | Gmail address for error alerts |
| `EMAIL_PASSWORD` | Gmail app password for error alerts |
| `ALERT_EMAIL_RECIPIENTS` | Comma-separated alert recipient emails |
| `DASHBOARD_URL` | Dashboard URL used in alert emails |

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `GET` | `/analytics.js` | Serve SDK to external sites |
| `GET` | `/rrweb.js` | Serve rrweb session recorder |
| `POST` | `/api/track` | Ingest analytics events |
| `POST` | `/api/session-record` | Ingest session recording chunks |
| `POST` | `/api/frontend-error` | Ingest JS errors |
| `POST` | `/api/dead-click` | Ingest dead clicks |
| `POST` | `/api/heatmap/click` | Ingest click heatmap (batched) |
| `POST` | `/api/heatmap/hover` | Ingest hover heatmap (batched) |
| `POST` | `/api/heatmap/scroll` | Ingest scroll depth |
| `POST` | `/api/heatmap/snapshot` | Ingest DOM snapshots |
| `GET` | `/api/overview` | Dashboard metrics overview |
| `POST` | `/api/query` | Analytics query builder |
| `GET` | `/api/session-recordings` | List session recordings |

## What the SDK Tracks

- Page views (including SPA route changes via history patch)
- Clicks & rage clicks
- Dead clicks (MutationObserver-based)
- JavaScript errors & unhandled promise rejections
- Scroll depth heatmap
- Mouse hover heatmap (sampled, batched)
- Click heatmap (batched, up to 50 per flush)
- Session recordings via rrweb (30 min max, 5 min inactivity timeout)
- DOM snapshots (sanitized — no scripts, no inline handlers)

## Public JS API

```js
window.analytics.track("purchase", { amount: 99 });
window.analytics.identify("user@email.com");
window.analytics.setUserProperties({ plan: "pro" });
```
