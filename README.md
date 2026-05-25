# Simple Newsvendor Game

Multiplayer newsvendor simulation for classroom use. Students submit inventory orders against a shared randomized demand; an admin controls the game flow round by round.

**Stack:** React + Vite (frontend) · Express + WebSocket (backend) · Supabase PostgreSQL (optional persistence)

---

## Local Development

**Requirements:** Node.js ≥ 18

```bash
npm install
cp .env.example .env
```

Edit `.env`:

```
VITE_API_BASE_URL=http://localhost:4000
ADMIN_KEY=your-secret-key
# Supabase vars are optional — leave blank to run without persistence
```

Start backend and frontend in separate terminals:

```bash
node server/index.js   # backend  →  http://localhost:4000
npm run dev            # frontend →  http://localhost:5173
```

Run unit tests:

```bash
npm test
```

---

## Deploy on Render (free tier)

Two separate Render services — one for the API, one for the static frontend.

### 1. Backend — Web Service

| Setting | Value |
|---|---|
| Runtime | Node |
| Build Command | `npm install` |
| Start Command | `node server/index.js` |
| Root Directory | *(repo root)* |

Environment variables:

| Variable | Required | Notes |
|---|---|---|
| `ADMIN_KEY` | Yes | Secret key for admin login |
| `SUPABASE_URL` | No | Enable DB persistence |
| `SUPABASE_SERVICE_ROLE_KEY` | No | Enable DB persistence |

Note the deployed URL (e.g. `https://your-backend.onrender.com`).

### 2. Frontend — Static Site

| Setting | Value |
|---|---|
| Build Command | `npm run build` |
| Publish Directory | `dist` |
| Root Directory | *(repo root)* |

Environment variables:

| Variable | Value |
|---|---|
| `VITE_API_BASE_URL` | `https://your-backend.onrender.com` |

The WebSocket URL is derived automatically (`https://` → `wss://`). Override with `VITE_WS_BASE_URL` only if needed.

> **Free tier note:** The backend sleeps after 15 minutes of inactivity. The first request after sleep takes ~30s (cold start). Active games keep it awake.

---

## Supabase Database (optional)

Without Supabase the game works fully — state is in memory and lost on server restart. Enable it to persist games, orders, and round history across restarts.

1. Create a project at [supabase.com](https://supabase.com)
2. Open **SQL Editor** and run the full contents of [`supabase/schema.sql`](supabase/schema.sql)
3. Copy **Project URL** and **service_role** key (Settings → API)
4. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` on the Render backend service

DB writes are fire-and-forget — a Supabase failure will not crash or block the game.

---

## GitHub Actions (CI)

Three workflows in `.github/workflows/`:

| Workflow | Trigger | What it does |
|---|---|---|
| `e2e.yml` | Push to `main`, manual | Plays a full game against the live backend via API |
| `k6-load-test.yml` | Manual | k6 load test — 100 VUs, 4 scenarios (poll storm, concurrent submit, health storm, spike join) |
| `load-sim.yml` | Manual | Python async simulation with 50 and 100 concurrent players |

### Required GitHub Secrets

**Settings → Secrets and variables → Actions:**

| Secret | Value |
|---|---|
| `RENDER_URL` | Backend URL, e.g. `https://your-backend.onrender.com` |
| `ADMIN_KEY` | Same value as the backend env var |

Without these, workflows fall back to the default deployed URLs and `admin123`.

---

## Environment Variable Reference

| Variable | Side | Purpose |
|---|---|---|
| `PORT` | Backend | HTTP listen port (default `4000`) |
| `ADMIN_KEY` | Backend | Key required to create a game |
| `SUPABASE_URL` | Backend | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Backend | Supabase service role key |
| `VITE_API_BASE_URL` | Frontend build | Backend HTTP base URL |
| `VITE_WS_BASE_URL` | Frontend build | Backend WebSocket base URL (optional override) |

---

## Game Flow

```
Admin creates game → players join with nickname
→ admin starts round → players submit orders
→ admin ends round → results + leaderboard
→ repeat for configured hands / turns
```

One game is active per server instance. Player sessions survive page refresh via `localStorage` + URL params.