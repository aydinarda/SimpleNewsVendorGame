/**
 * k6 Full Session Load Test — SimpleNewsVendorGame
 *
 * Realistic, classroom-paced scenario:
 *   - 1 admin + 100 players in a single game, 12 rounds (hands) played end to end.
 *   - The admin (1 VU) drives the rounds sequentially: each round sets a DIFFERENT
 *     distribution, starts the round, gives players a ~1 minute window to decide and
 *     submit, then ends it. A short review gap follows before the next round.
 *   - The players (100 VUs) behave like real users: they refresh /game-state at a
 *     RELAXED cadence (the real client is WebSocket-push driven, not a 1s poller),
 *     submit one order while a round is active, and occasionally browse the leaderboard.
 *     ~25% are "active" users who keep hitting endpoints throughout the waits.
 *   - The admin logs each round's realized demand so distribution behavior is visible.
 *
 * The long windows let you JOIN the same game in a browser and watch for latency while
 * the load runs. Point both at the same backend:
 *   k6:      k6 run --env BASE_URL=http://localhost:4000 --env ADMIN_KEY=admin123 k6/game_full_session.js
 *   browser: http://localhost:5173  (joins the active game the load test created)
 *
 * Tune the pacing:  --env ROUND_WINDOW=60  --env REVIEW_GAP=8
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Counter } from "k6/metrics";

const BASE = (__ENV.BASE_URL || "https://simplenewsvendorgame.onrender.com").replace(/\/$/, "");
const ADMIN_KEY = __ENV.ADMIN_KEY || "admin123";
const HDR = { headers: { "Content-Type": "application/json" } };

const N_PLAYERS = 100;
const N_ROUNDS = 12;
const ROUND_WINDOW = Number(__ENV.ROUND_WINDOW || 60); // seconds a round stays active (~1 min to decide + submit)
const REVIEW_GAP = Number(__ENV.REVIEW_GAP || 8); // seconds between rounds (players review results/leaderboard)
const SESSION_SECONDS = N_ROUNDS * (ROUND_WINDOW + REVIEW_GAP) + 60; // whole game + buffer
const DURATION = __ENV.DURATION || `${SESSION_SECONDS}s`; // players scenario; must cover the whole game

// 400/409/429 are expected responses (re-submit, rate-limit); keep them out of http_req_failed.
http.setResponseCallback(http.expectedStatuses(200, 400, 409, 429));

// ── Custom metrics ──────────────────────────────────────────────────────────
const pollLatency = new Trend("poll_latency", true);
const submitLatency = new Trend("submit_latency", true);
const gameErrors = new Counter("game_errors"); // 5xx only
const submitAccepted = new Counter("submit_accepted");
const submitDuplicateRejected = new Counter("submit_duplicate_rejected");
const submitRateLimited = new Counter("submit_rate_limited");
const roundsDriven = new Counter("rounds_driven");

// Varied distributions across the 12 rounds (to observe their behavior).
const DISTRIBUTIONS = [
  { type: "uniform", min: 80, max: 120 },
  { type: "uniform", min: 50, max: 150 },
  { type: "normal", mean: 100, stdDev: 10 },
  { type: "normal", mean: 100, stdDev: 30 },
  { type: "uniform", min: 90, max: 110 },
  { type: "normal", mean: 120, stdDev: 5 },
  { type: "uniform", min: 0, max: 200 },
  { type: "normal", mean: 80, stdDev: 20 },
  { type: "normal", mean: 100, stdDev: 0 }, // deterministic
  { type: "uniform", min: 100, max: 140 },
  { type: "normal", mean: 150, stdDev: 25 },
  { type: "uniform", min: 70, max: 130 }
];

export const options = {
  scenarios: {
    // The admin drives the game (starts/ends rounds, changes distributions).
    admin: {
      executor: "shared-iterations",
      vus: 1,
      iterations: 1,
      maxDuration: `${SESSION_SECONDS + 60}s`,
      startTime: "2s", // small head start so players are already polling
      exec: "driveGame",
      tags: { role: "admin" }
    },
    // 100 players refresh + submit at a realistic, relaxed cadence.
    players: {
      executor: "constant-vus",
      vus: N_PLAYERS,
      duration: DURATION, // covers the whole game; players idle cheaply once it finishes
      exec: "playerLoop",
      tags: { role: "player" }
    }
  },
  thresholds: {
    submit_latency: ["p(95)<8000"],
    poll_latency: ["p(95)<5000"],
    game_errors: ["count<50"], // 5xx only
    http_req_failed: ["rate<0.05"]
  }
};

// ── Helpers ─────────────────────────────────────────────────────────────────
function post(path, body) {
  return http.post(`${BASE}${path}`, JSON.stringify(body), HDR);
}
function j(res) {
  try {
    return JSON.parse(res.body) || {};
  } catch {
    return {};
  }
}
function describe(d) {
  return d.type === "normal" ? `normal(μ=${d.mean},σ=${d.stdDev})` : `uniform[${d.min},${d.max}]`;
}

// Crude newsvendor: order around the distribution center with +/-40% noise.
function chooseOrder(distribution) {
  const d = distribution || {};
  let center = 100;
  if (d.type === "normal" && typeof d.mean === "number") center = d.mean;
  else if (typeof d.min === "number" && typeof d.max === "number") center = (d.min + d.max) / 2;
  const noise = (Math.random() * 0.8 - 0.4) * center;
  return Math.max(1, Math.round(center + noise));
}

// ── Setup: create the game + 100 players ────────────────────────────────────
export function setup() {
  let alive = false;
  for (let i = 0; i < 8; i++) {
    if (http.get(`${BASE}/health`, HDR).status === 200) {
      alive = true;
      break;
    }
    sleep(5);
  }
  if (!alive) throw new Error("setup: backend /health did not respond");

  const admin = j(post("/start-game", { nickname: "admin_load", adminKey: ADMIN_KEY, handsPerTur: N_ROUNDS }));
  if (!admin.gameId || !admin.adminToken) throw new Error("setup: could not create game");

  const players = [];
  for (let i = 0; i < N_PLAYERS; i++) {
    const d = j(post("/start-game", { nickname: `L${String(i + 1).padStart(3, "0")}`, gameId: admin.gameId }));
    if (d.playerId) players.push({ playerId: d.playerId });
  }
  if (players.length < N_PLAYERS) throw new Error(`setup: only ${players.length}/${N_PLAYERS} players joined`);

  console.log(
    `setup: game ${admin.gameId.slice(0, 8)} ready, ${players.length} players, ${N_ROUNDS} rounds, ` +
      `${ROUND_WINDOW}s window + ${REVIEW_GAP}s gap (~${Math.round(SESSION_SECONDS / 60)}m total)`
  );
  return { gameId: admin.gameId, adminToken: admin.adminToken, players };
}

// ── Admin: drive the 12 rounds, a different distribution each round ──────────
export function driveGame(data) {
  const { gameId, adminToken } = data;

  for (let r = 0; r < N_ROUNDS; r++) {
    const dist = DISTRIBUTIONS[r % DISTRIBUTIONS.length];

    const sd = post("/set-distribution", { gameId, adminToken, ...dist });
    check(sd, { "set-distribution 200": (x) => x.status === 200 });

    // Occasionally change prices too (variety).
    if (r % 4 === 0) {
      post("/set-prices", { gameId, adminToken, wholesaleCost: 10, retailPrice: 35 + (r % 3) * 5, salvagePrice: 5 });
    }

    const sr = post("/start-round", { gameId, adminToken });
    if (j(sr).roundPhase !== "active") gameErrors.add(1);

    // ~1 minute window: players think, submit, and browse while traffic keeps flowing.
    sleep(ROUND_WINDOW);

    const er = j(post("/end-round", { gameId, adminToken }));
    roundsDriven.add(1);
    console.log(`Round ${r + 1}/${N_ROUNDS} | ${describe(dist)} | demand=${er.realizedDemand} | finished=${er.finished}`);

    // Between rounds: a short review gap before the next round starts.
    if (r < N_ROUNDS - 1) sleep(REVIEW_GAP);
  }

  const lb = j(http.get(`${BASE}/leaderboard?gameId=${gameId}`, HDR));
  const top = (lb.leaderboard || [])[0];
  console.log(`Final leaderboard: ${(lb.leaderboard || []).length} players | leader=${top?.nickname} $${top?.cumulativeProfit}`);
}

// ── Player: realistic, relaxed refresh + submit while active + light noise ───
export function playerLoop(data) {
  const player = data.players[(__VU - 1) % data.players.length];
  const stateUrl = `${BASE}/game-state?gameId=${data.gameId}&playerId=${player.playerId}`;

  // ~25% of players stay "active": they keep refreshing/browsing throughout the
  // 1-minute waits. The rest submit, then mostly wait (like a real classroom).
  const isActiveUser = __VU % 4 === 0;

  const t0 = Date.now();
  const gs = j(http.get(stateUrl, HDR));
  pollLatency.add(Date.now() - t0);

  check(gs, { "poll ok": (x) => typeof x.roundPhase === "string" || x.finished === true });

  if (gs.finished) {
    sleep(5 + Math.random() * 5); // game over -> cheap idle
    return;
  }

  if (gs.roundPhase === "active" && gs.player && !gs.player.submittedThisRound) {
    sleep(Math.random() * 3); // brief human reaction delay before ordering
    const qty = chooseOrder(gs.distribution);

    const s0 = Date.now();
    const r = post("/submit-order", { gameId: data.gameId, playerId: player.playerId, orderQuantity: qty });
    submitLatency.add(Date.now() - s0);

    if (r.status === 200) submitAccepted.add(1);
    else if (r.status === 429) submitRateLimited.add(1);
    else if (r.status >= 500) gameErrors.add(1);

    // ~10%: accidental double-submit (the server should reject with 400).
    if (Math.random() < 0.1) {
      const dup = post("/submit-order", { gameId: data.gameId, playerId: player.playerId, orderQuantity: qty });
      if (dup.status === 400) submitDuplicateRejected.add(1);
      else if (dup.status === 429) submitRateLimited.add(1);
      else if (dup.status >= 500) gameErrors.add(1);
    }
  }

  // Light extra activity — active users browse the leaderboard often, others rarely.
  const roll = Math.random();
  if (isActiveUser && roll < 0.5) http.get(`${BASE}/leaderboard?gameId=${data.gameId}`, HDR);
  else if (roll < 0.08) http.get(`${BASE}/leaderboard?gameId=${data.gameId}`, HDR);
  else if (roll < 0.1) http.get(`${BASE}/health`, HDR);

  // Relaxed cadence: the real client is WebSocket-push driven (150s HTTP fallback),
  // so model occasional human-driven refreshes instead of 1s polling.
  if (isActiveUser) sleep(3 + Math.random() * 5); // active: refresh every 3-8s
  else sleep(12 + Math.random() * 13); // lazy: refresh every 12-25s
}

// ── Teardown: close a round if the driver left one open (safety) ─────────────
export function teardown(data) {
  post("/end-round", { gameId: data.gameId, adminToken: data.adminToken });
}
