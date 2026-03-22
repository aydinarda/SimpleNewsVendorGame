# Simple Newsvendor Game

A multiplayer Newsvendor simulation with a React + Vite frontend and a Node.js + Express backend.

## Overview

- Players join the same game room and play across multiple rounds.
- The admin controls round lifecycle and demand distribution.
- Demand is generated once per round and shared fairly across all players.
- Profit is committed only when the round ends.
- Session recovery is supported on the client via URL params + local storage.
- Optional Supabase persistence can store game events and round/order data in SQL.

## Tech Stack

- Frontend: React, Vite
- Backend: Express, WebSocket (`ws`)
- Testing: Node test runner + Supertest
- Optional persistence: Supabase Postgres

## Project Structure

```text
server/
  dbLogger.js
  index.js
  index.test.js
  rounds.js
  utils/
    demand.js
    profit.js

src/
  components/
    Leaderboard.jsx
    OrderForm.jsx
    ProgressBar.jsx
    RoundInfo.jsx
    RoundResult.jsx
  utils/
    api.js
    sessionStorage.js
  App.jsx
  main.jsx

supabase/
  schema.sql
```

## Local Development

1. Install dependencies:

```bash
npm install
```

2. Start backend:

```bash
npm run server
```

3. Start frontend:

```bash
npm run dev
```

By default, the frontend targets `http://localhost:4000`.

## Environment Variables

Use `.env` (local only, not committed):

```bash
VITE_API_BASE_URL=http://localhost:4000
VITE_WS_BASE_URL=ws://localhost:4000
ADMIN_KEY=admin123
PORT=4000

# Optional Supabase persistence
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

## API Endpoints

### Health

- `GET /health`

### Game Setup and Join

- `POST /start-game`
  - Admin creates a new game by sending `adminKey`.
  - Players join an active game using `gameId` and `nickname`.

### Admin Controls

- `POST /set-distribution`
  - Updates uniform distribution bounds (`min`, `max`) while round is pending.
- `POST /start-round`
  - Starts the current round and generates one shared demand value.
- `POST /end-round`
  - Commits round results for all submitted players and updates leaderboard.

### Player Action

- `POST /submit-order`
  - Submits one order quantity per round per player.

### Read Models

- `GET /game-state?gameId=...&playerId=...`
  - Returns current round/phase, distribution, and player state/history.
- `GET /leaderboard?gameId=...`
  - Returns ranked cumulative profits.

### WebSocket

- `ws://<host>/ws`
  - Subscribe with a message:

```json
{ "type": "subscribe", "gameId": "...", "playerId": "..." }
```

## Optional Supabase Persistence

Supabase logging is optional and non-blocking. If env vars are missing, the game still runs in memory.

### 1) Create tables

Run `supabase/schema.sql` in Supabase SQL Editor.

### 2) Configure backend env vars

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

### 3) What gets persisted

- Game creation
- Player join events
- Distribution updates
- Round starts/ends (including realized demand)
- Player order submissions
- Round-end order metrics (`sold`, `leftover`, `stockout`, `profit`)

## Build and Test

Run tests:

```bash
npm test
```

Create production build:

```bash
npm run build
```

Preview production build locally:

```bash
npm run preview
```

## Deployment Notes

- A practical free setup is:
  - Backend: Render Web Service
  - Frontend: Render Static Site
- With free tiers, occasional cold starts are expected.
- If Supabase persistence is configured, game events remain queryable even if the backend process restarts.
