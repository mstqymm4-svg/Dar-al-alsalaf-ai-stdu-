# DAR AL ULOOM — Independent Backend

Independent REST API for the **DAR AL ULOOM** Islamic Digital Library.
Built with **Node.js + Express + TypeScript + Prisma + PostgreSQL**.

This backend is fully independent of the Base44 platform and can be deployed
on any Node.js host (VPS, Docker, Railway, Render, …).

---

## Architecture

```
Frontend (React/Vite)
      │  VITE_API_URL
      ▼
DAR AL ULOOM REST API (Express + TypeScript)
      │
      ├── PostgreSQL (Prisma ORM)
      └── File Storage (local now, S3-compatible later)
```

```
backend/
  src/
    config/        env + prisma + storage config
    controllers/   request handlers (thin)
    middleware/    auth, authorize, validate, error, rateLimit
    models/        (Prisma is the model layer)
    routes/        express routers
    services/      business logic
    utils/         apiResponse, logger, hash, jwt, ApiError
    validators/    zod schemas
    types/         shared TS types
    app.ts         express app (middleware + routes)
    server.ts      bootstrap (connect DB, listen)
    scripts/       createAdmin.ts
  prisma/
    schema.prisma  full data model
  uploads/         local file storage
```

---

## Quick Start (local)

```bash
cd backend
npm install
cp .env.example .env        # then fill in DATABASE_URL + JWT secrets
npm run prisma:generate
npm run prisma:migrate      # creates tables
npm run create-admin        # create first SUPER_ADMIN
npm run dev                 # http://localhost:5000/api/health
```

Frontend (separate terminal):

```bash
cd <frontend>
npm install
npm run dev                 # uses VITE_API_URL
```

---

## Environment Variables

| Variable | Description |
|---|---|
| `NODE_ENV` | development / production |
| `PORT` | server port (default 5000) |
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_ACCESS_SECRET` | secret for access tokens |
| `JWT_REFRESH_SECRET` | secret for refresh tokens |
| `ACCESS_TOKEN_EXPIRES_IN` | e.g. `15m` |
| `REFRESH_TOKEN_EXPIRES_IN` | e.g. `7d` |
| `FRONTEND_URL` | allowed CORS origin(s), comma-separated |
| `STORAGE_DRIVER` | `local` (s3 later) |
| `UPLOAD_DIR` | local upload directory |
| `MAX_UPLOAD_BYTES` | max upload size (default 50MB) |
| `RATE_LIMIT_WINDOW_MS` | rate-limit window |
| `RATE_LIMIT_MAX` | max requests per window |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` | optional, for `create-admin` script |

---

## Database

- PostgreSQL required. Create an empty DB, then set `DATABASE_URL`.
- `npm run prisma:migrate` (dev) — applies migrations.
- `npm run prisma:deploy` (production) — applies migrations without prompts.
- `npm run prisma:studio` — GUI to inspect data.

---

## Create First Admin

```bash
npm run create-admin -- <email> <password> <name>
# or set ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME in .env then: npm run create-admin
```

---

## Auth

`POST /api/auth/register` · `POST /api/auth/login` · `POST /api/auth/refresh` ·
`POST /api/auth/logout` · `GET /api/auth/me`

Access token (short-lived) + refresh token (stored hashed in DB, revocable).
Roles: `USER`, `ADMIN`, `SUPER_ADMIN`.

---

## API Response Shape

```jsonc
// success
{ "success": true, "data": { ... } }
// error
{ "success": false, "message": "..." }
```

Health: `GET /api/health` → `{ "success": true, "data": { "status": "ok" } }`

---

## Docker

```bash
docker compose up --build
# backend on :5000, postgres on :5432 (volume: pgdata)
```

Data and uploaded files are on named volumes so removing a container
does **not** delete data.

---

## Backup / Restore

PostgreSQL:
```bash
# backup
docker compose exec db pg_dump -U postgres dar_al_uloom > backup.sql
# restore
docker compose exec -T db psql -U postgres dar_al_uloom < backup.sql
```

Uploaded files: back up the `uploads/` directory (or the `uploads` volume).

---

## Production Notes

- Set `NODE_ENV=production`.
- Generate strong `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` (`openssl rand -hex 64`).
- Point `FRONTEND_URL` to the real frontend origin (no `*` CORS).
- Run `npm run build && npm start`.
- Serve behind a reverse proxy (Nginx/Caddy) for TLS.
- To switch storage to S3 later, set `STORAGE_DRIVER=s3` and add the S3 adapter (TODO).

---

## Status

See the **Remaining Base44 Dependencies** section in the chat for what still
needs the frontend rewiring (Phase 7+). This backend is deployable now; the
live Base44 preview stays on Base44 until the backend is deployed and the
frontend API layer is wired in.