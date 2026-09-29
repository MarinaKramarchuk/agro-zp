# Agro-ZP — waybills and payroll for a farm enterprise

A web app for the record-keeper of an agricultural enterprise. It replaces paper
waybills and hand-calculated wages for machine operators and drivers: the
record-keeper enters completed work, and the app picks the right tariff,
calculates the amount, builds the timesheet and payroll sheet, and prints the
official forms (form No. 68, standard form No. 2).

The UI and domain are in Ukrainian.

**Demo:** https://agro-zp.vercel.app
(the data is fictional and resets whenever the server restarts; the first load
can take up to a minute while the free-tier backend wakes up)

> **Note:** all data in this repository and in the demo — employee names,
> machinery, fields, work records, telematics reports and sample forms — is
> fictional and included solely to demonstrate how the app works. Any
> resemblance to real people or enterprises is coincidental.
>
> **Примітка:** усі дані в репозиторії та в демо — ПІБ працівників, техніка,
> поля, виконані роботи, звіти телематики й приклади форм — вигадані та внесені
> виключно для демонстрації роботи застосунку. Будь-які збіги з реальними
> людьми чи підприємствами випадкові.

## Features

| Section | What it does |
|---|---|
| Work entry | waybill form with the amount calculated on the fly |
| Work log | search and filter all waybills, export to Excel |
| Timesheet | employees × days grid, highlights overtime and missing hours |
| Payroll | summary for a period, per-employee breakdown, month closing |
| Form printing | fills in the official Excel waybill templates |
| Hectare control | processed area vs. field area, per type of work |
| Machinery data | imports engine hours and fuel from OVERSEER telematics |
| Work plans, Repairs | daily work plan and repair hours tracking |
| Reference data | employees, machinery, fields, work types, tariffs, intercity trips |

Payroll calculation details:

- pay by tariff (ha, t, t·km, trips, bales…), hourly from salary or minimum wage,
  composite tariffs, bonuses;
- the rate and amount are stored as a **snapshot** in each record — changing a
  tariff never rewrites wages already accrued;
- imports from OVERSEER and Hecterra (GPS field operations), alerts for
  unmapped records; export for BAS accounting software.

## Tech stack

- **Frontend:** React 19, Vite, Tailwind CSS 4, React Router; tests — Vitest + Testing Library
- **Backend:** Node.js, Express 5, SQLite (`better-sqlite3`), `zod` validation,
  Excel via `exceljs` / `xlsx`; tests — built-in `node --test` (270+ unit and integration)
- **Deployment:** frontend on Vercel, backend on Render

## Project structure

```
backend/              API (Express + SQLite), business logic, tests — see backend/README.md
frontend/             React + Vite SPA
шаблони/              official Excel templates the waybills are printed from
render.yaml           Render service definition for the backend
Відкрити облік.bat    start the offline Windows version ("Open records")
Зупинити облік.bat    stop the offline Windows version ("Stop records")
```

## Running locally

Requires Node.js 22+.

```bash
# backend — http://localhost:4000/api
cd backend
npm install
npm run db:migrate
npm run seed:demo      # fictional demo data
npm run dev

# frontend — http://localhost:5173 (/api requests are proxied to the backend)
cd frontend
npm install
npm run dev
```

Tests: `npm test` in both `backend/` and `frontend/`.

## Offline Windows version

The app was built to run on a single office PC with no internet connection and
no developer tools. For that, the repository root contains two launchers for
the end user:

- **`Відкрити облік.bat`** (“Open records”) — updates the database schema
  (migrations are safe to re-run), starts the backend hidden in the background
  using a portable `node.exe`, and opens the app in a separate Chrome/Edge
  window (`--app` mode). The backend also serves the built frontend, so
  everything runs from http://localhost:4000. Closing the app window stops the
  server automatically.
- **`Зупинити облік.bat`** (“Stop records”) — a fallback that force-stops the
  server if something went wrong.

The launchers expect a `runtime/` folder next to them (portable `node.exe`,
launcher scripts, window icon, a separate Chrome profile). It is **not
committed** to the repository (see `.gitignore`), so after cloning, the `.bat`
files will only show a “runtime\node.exe not found” message. To assemble a
working copy:

1. Install dependencies in `backend/` and build the frontend
   (`cd frontend && npm run build`).
2. Create `runtime/` and copy `node.exe` from your Node.js installation into it,
   along with the launcher scripts.
3. Copy the whole project folder to the target PC and run `Відкрити облік.bat`.

## Deployment

- **Backend — Render.** `render.yaml` defines a Web Service; on start,
  `npm run start:prod` updates the DB schema, seeds an empty DB with demo data,
  and starts the server. The free plan's disk is ephemeral, so the demo
  database is restored on every restart.
- **Frontend — Vercel** (Root Directory: `frontend`). `frontend/vercel.json`
  proxies `/api/*` to the backend and serves `index.html` for SPA routes, so the
  frontend works with a relative `/api` and no CORS.

Detailed technical reference (data model, calculation formulas, full API) —
[`backend/README.md`](backend/README.md) (in Ukrainian).
