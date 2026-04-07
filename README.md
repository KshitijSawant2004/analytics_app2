# Analytics Platform Workspace

This workspace now keeps only the analytics platform and supporting tracker assets.

- `apps/analytics-platform/dashboard/` -> Next.js analytics dashboard UI
- `apps/analytics-platform/backend/` -> Express + PostgreSQL analytics API
- `tracker/` -> embeddable analytics tracking script + integration snippets
- `docs/` -> implementation and migration notes

## Run

Backend:

```bash
cd apps/analytics-platform/backend
npm install
npm run dev
```

Dashboard:

```bash
cd apps/analytics-platform/dashboard
npm install
npm run dev
```

Open the dashboard on the port shown by Next.js.

## Optional Root Scripts

From workspace root:

```bash
npm run dev:backend
npm run dev:dashboard
```

## Root Files

- `server.js` -> convenience entry that starts backend server
- `package.json` -> root scripts for backend/dashboard
- `apps/` -> product code
- `tracker/` -> tracker distribution assets
- `docs/` -> supplemental docs

## Structure

- `apps/analytics-platform/dashboard/pages/`
- `apps/analytics-platform/dashboard/components/`
- `apps/analytics-platform/dashboard/hooks/`
- `apps/analytics-platform/backend/routes/`
- `apps/analytics-platform/backend/controllers/`
- `apps/analytics-platform/backend/services/`
