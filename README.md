# Yconsoft Intern Ops Hub — Backend + AI

This build upgrades the original Mini Trello app from browser-only `localStorage` to a real backend-owned data layer.

## What is included

- **SQLite database** for interns, tasks and progress updates.
- REST API:
  - `GET/POST/DELETE /api/interns`
  - `GET/POST/PATCH/DELETE /api/tasks`
  - `GET/POST /api/updates`
  - `GET /api/ai/performance`
  - `GET /api/health`
- Server-side performance scoring using completion, on-time delivery, high-priority handling, progress-update consistency and overdue-workload signals.
- Optional OpenAI-powered insight generation. The score remains deterministic and auditable; the model turns the metrics into concise management insights.
- Existing frontend now reads/writes through the backend instead of `localStorage`.
- Drag-and-drop task movement is persisted server-side.
- Progress updates are stored separately from tasks.

## Run locally

1. Install Node.js 20+.
2. Open a terminal in this folder.
3. Run `npm install`.
4. Copy `.env.example` to `.env` and add `OPENAI_API_KEY` if you want LLM-generated insights.
5. Run `npm start`.
6. Open `http://localhost:3000`.

Without an API key, the dashboard still works and uses deterministic fallback insights.

## Scoring model

`score = completion 40% + on-time completion 25% + priority handling 15% + update consistency 10% + workload health 10%`.

The score is intentionally kept on the backend so users cannot alter their own score by editing browser storage.

## Production next steps

- Add authentication/roles before exposing it publicly.
- Use Postgres for multi-instance production deployments.
- Add audit logs and task assignment history.
- Add pagination and rate limiting.
- Store the OpenAI key only in server environment variables.


## Latest UI/AI update
- Added a visible **AI Performance Insights** dashboard button with loading, success, fallback, and error states.
- The backend now loads a local `.env` file without requiring an additional package.
- Reworked **Add New Task** into a structured, responsive form with grouped task details and assignment fields.
- The Express 5 wildcard route is compatible with current `path-to-regexp` syntax.
- The default OpenAI model is `gpt-5`; override it with `OPENAI_MODEL` in `.env` if needed. Keep `OPENAI_API_KEY` server-side and never expose it in frontend code. OpenAI recommends loading API keys securely on the server via environment variables. See the official quickstart: https://platform.openai.com/docs/quickstart/make-your-first-api-request


## Login

The app now has a login page and server-side session authentication. On the first run, if the database has no users, it creates an admin account from these environment variables:

- `ADMIN_USERNAME` (default: `admin`)
- `ADMIN_PASSWORD` (default: `ChangeMe123!`)

For a real deployment, set both values in `.env` before the first server start. The password is stored as a salted scrypt hash and the session is stored server-side in SQLite.

After signing in, the dashboard is protected and the header includes a **Log out** button.
