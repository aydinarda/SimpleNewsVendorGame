/**
 * k6 Full Session Load Test — SimpleNewsVendorGame
 *
 * Realistic, heavy scenario:
 *   - 1 admin + 100 players in a single game, 12 rounds (hands) played end to end.
 *   - The admin scenario (1 VU) drives the rounds sequentially: each round it sets a
 *     DIFFERENT distribution, starts the round, gives players a window, then ends it.
 *   - The players scenario (100 VUs) continuously polls /game-state and submits a
 *     random order while a round is active. Occasional re-submits, random leaderboard/
 *     health requests, and jittered poll cadence model real user noise.
 *   - The admin logs each round's realized demand so distribution behavior is visible.
 *
 * Tens of thousands of requests in total. This is the heaviest scenario.
 *
 * Run: k6 run --env BASE_URL=... --env ADMIN_KEY=... k6/game_full_session.js
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Counter } from "k6/metrics";

const BASE = (__ENV.BASE_URL || "https://simplenewsvendorgame.onrender.com").replace(/\/$/, "");
const ADMIN_KEY = __ENV.ADMIN_KEY || "admin123";
const HDR = { headers: { "Content-Type": "application/json" } };

const N_PLAYERS = 100;
const N_ROUNDS = 12;
const PLAY_WINDOW = Number(__ENV.PLAY_WINDOW || 6); // seconds: the players' submit window per round
const DURATION = __ENV.DURATION || "3m"; // players scenario duration; must cover the whole game

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
      maxDuration: "5m",
      startTime: "2s", // small head start so players are already polling
      exec: "driveGame",
      tags: { role: "admin" }
    },
    // 100 players continuously poll + submit.
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

  const admin = j(post("/start-game", { nickname: "admin_load", adminKey: ADMIN_KEY, handsPerTur: N_ROUNDS, totalTurs: 1 }));
  if (!admin.gameId || !admin.adminToken) throw new Error("setup: could not create game");

  const players = [];
  for (let i = 0; i < N_PLAYERS; i++) {
    const d = j(post("/start-game", { nickname: `L${String(i + 1).padStart(3, "0")}`, gameId: admin.gameId }));
    if (d.playerId) players.push({ playerId: d.playerId });
  }
  if (players.length < N_PLAYERS) throw new Error(`setup: only ${players.length}/${N_PLAYERS} players joined`);

  console.log(`setup: game ${admin.gameId.slice(0, 8)} ready, ${players.length} players, ${N_ROUNDS} rounds`);
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

    sleep(PLAY_WINDOW); // players submit during this window

    const er = j(post("/end-round", { gameId, adminToken }));
    roundsDriven.add(1);
    console.log(`Round ${r + 1}/${N_ROUNDS} | ${describe(dist)} | demand=${er.realizedDemand} | finished=${er.finished}`);
  }

  const lb = j(http.get(`${BASE}/leaderboard?gameId=${gameId}`, HDR));
  const top = (lb.leaderboard || [])[0];
  console.log(`Final leaderboard: ${(lb.leaderboard || []).length} players | leader=${top?.nickname} $${top?.cumulativeProfit}`);
}

// ── Player: poll continuously + submit while active + random noise ──────────
export function playerLoop(data) {
  const player = data.players[(__VU - 1) % data.players.length];
  const stateUrl = `${BASE}/game-state?gameId=${data.gameId}&playerId=${player.playerId}`;

  const t0 = Date.now();
  const gs = j(http.get(stateUrl, HDR));
  pollLatency.add(Date.now() - t0);

  check(gs, { "poll ok": (x) => typeof x.roundPhase === "string" || x.finished === true });

  if (gs.finished) {
    sleep(3); // game over -> cheap idle
    return;
  }

  if (gs.roundPhase === "active" && gs.player && !gs.player.submittedThisRound) {
    const qty = chooseOrder(gs.distribution);

    const s0 = Date.now();
    const r = post("/submit-order", { gameId: data.gameId, playerId: player.playerId, orderQuantity: qty });
    submitLatency.add(Date.now() - s0);

    if (r.status === 200) submitAccepted.add(1);
    else if (r.status === 429) submitRateLimited.add(1);
    else if (r.status >= 500) gameErrors.add(1);

    // ~12%: try to re-submit (the server should reject with 400).
    if (Math.random() < 0.12) {
      const dup = post("/submit-order", { gameId: data.gameId, playerId: player.playerId, orderQuantity: qty });
      if (dup.status === 400) submitDuplicateRejected.add(1);
      else if (dup.status === 429) submitRateLimited.add(1);
      else if (dup.status >= 500) gameErrors.add(1);
    }
  }

  // Random extra activity (realistic noise).
  const roll = Math.random();
  if (roll < 0.15) http.get(`${BASE}/leaderboard?gameId=${data.gameId}`, HDR);
  else if (roll < 0.2) http.get(`${BASE}/health`, HDR);

  sleep(0.4 + Math.random() * 1.6); // 0.4-2.0s jittered poll
}

// ── Teardown: close a round if the driver left one open (safety) ─────────────
export function teardown(data) {
  post("/end-round", { gameId: data.gameId, adminToken: data.adminToken });
}
