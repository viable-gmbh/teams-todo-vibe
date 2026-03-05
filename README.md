# Teams ToDo Bot

Full-stack app that watches Microsoft Teams messages, extracts tasks with OpenAI, and syncs approved tasks to Todoist.

## Stack

- `frontend`: React + Vite + Tailwind + React Query
- `backend`: NestJS + Prisma + Bull queue + Graph/Todoist/OpenAI integrations
- MongoDB + Redis (local Docker or Railway managed)

## Local setup

1. Install dependencies:
   - `cd backend && npm install`
   - `cd frontend && npm install`
2. Configure env files:
   - copy `backend/.env.example` to `backend/.env`
   - copy `frontend/.env.example` to `frontend/.env`
   - OpenAI and Todoist keys are set per-user in the app Settings page (not in env vars)
   - Ensure `DATABASE_URL` includes replica set params for local Mongo:
     - `mongodb://localhost:27017/teams_todo_bot?replicaSet=rs0&directConnection=true`
3. Start local infra:
   - `docker compose up -d`
   - (or `npm run infra:up` from root)
4. Prepare database:
   - `cd backend`
   - `npm run prisma:generate`
   - `npm run prisma:push`
5. Run apps:
   - Backend: `cd backend && npm run start:dev`
   - Frontend: `cd frontend && npm run dev`
   - or both: `npm run dev` (from root)
6. Open the dashboard Settings tab and save your Todoist + OpenAI API keys.

## Key backend routes

- `GET /auth/login`
- `GET /auth/callback`
- `GET /auth/status`
- `POST /webhooks/teams`
- `GET /webhooks/teams/sync` (manual subscription sync)
- `GET /webhooks/teams/pull-latest` (manual pull of recent chat messages)
- `GET/POST/DELETE /trusted-users`
- `GET/PATCH /tasks`
- `DELETE /tasks/:id`
- `DELETE /tasks`
- `GET /tasks/autoreplies`
- `GET /tasks/messages`
- `DELETE /tasks/messages/:id`
- `DELETE /tasks/messages`
- `POST /tasks/messages/:id/reanalyze`
- `GET/PATCH /settings`

## Railway deployment

- Root `railway.json` defines `backend` and `frontend` services.
- Provision Railway MongoDB + Redis and map vars from `backend/.env.example`.
- Set `WEBHOOK_NOTIFICATION_URL` to your public backend webhook URL.
- `WEBHOOK_NOTIFICATION_URL` must be internet-reachable (not localhost).
