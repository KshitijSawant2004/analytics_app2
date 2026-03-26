# FluxLend - Frontend/Backend Workspace

Project is now split into separate apps:

- `apps/demo-site/` -> Next.js demo site UI
- `apps/analytics-platform/dashboard/` -> analytics dashboard UI
- `apps/analytics-platform/backend/` -> Express + PostgreSQL analytics API

## Run

Backend:

```bash
cd apps/analytics-platform/backend
npm install
npm run dev
```

Frontend:

```bash
cd apps/demo-site
npm install
npm run dev
```

Open `http://localhost:3000` (or the Next.js port shown in terminal).

Standalone dashboard frontend:

```bash
cd apps/analytics-platform/dashboard
npm install
npm run dev
```

Open `http://localhost:3000` (or next available port) for the dashboard app.

## Optional Root Scripts

From workspace root:

```bash
npm run dev:backend
npm run dev:frontend
npm run dev:dashboard
```

## Product Flow

`Home -> Signup -> Login -> Dashboard -> Apply for Loan -> Loan Confirmation`

Extended journeys:

`Dashboard -> Eligibility Checker -> Loan Offers -> Apply`

`Dashboard -> Application Status Tracker`

`Dashboard -> Profile -> Update`

## Key Features

- Home, Signup, Login, Dashboard, Apply Loan (multi-step), Confirmation pages
- Simulated auth and loan submission via `localStorage`
- Multi-step application form:
	- Step 1: Personal details
	- Step 2: Employment details
	- Step 3: Loan details
	- Step 4: Review and submit
- Analytics hook placeholders via `trackEvent(...)`
- Extra event generators:
	- View Loan Offers page and offer comparison
	- Eligibility checker flow
	- EMI calculator widget
	- Notifications dropdown
	- Support chat modal
	- Application status tracker
	- Profile update journey
	- Delayed recommended offers loader

## Structure

- `apps/demo-site/pages/`
- `apps/demo-site/components/`
- `apps/demo-site/hooks/`
- `apps/demo-site/utils/analytics.js`
- `apps/analytics-platform/dashboard/pages/`
- `apps/analytics-platform/backend/routes/`
- `apps/analytics-platform/backend/controllers/`
- `apps/analytics-platform/backend/services/`
