import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../../server/index.js";

const ADMIN_KEY = "admin123";

async function freshGame() {
  const app = createApp({ adminKey: ADMIN_KEY });
  const res = await request(app).post("/start-game").send({ nickname: "admin", adminKey: ADMIN_KEY });
  return { app, gameId: res.body.gameId, adminToken: res.body.adminToken };
}

// ── UNIFORM: equivalence classes + boundary values ───────────────────────────
const uniformCases = [
  { name: "valid mid-range", body: { type: "uniform", min: 80, max: 120 }, status: 200 },
  { name: "valid boundary min = 0", body: { type: "uniform", min: 0, max: 10 }, status: 200 },
  { name: "valid boundary min = max - 1", body: { type: "uniform", min: 99, max: 100 }, status: 200 },
  { name: "invalid min < 0", body: { type: "uniform", min: -1, max: 100 }, status: 400, error: /less than 0/i },
  { name: "invalid max < 0", body: { type: "uniform", min: 0, max: -1 }, status: 400, error: /less than 0/i },
  { name: "invalid boundary min = max", body: { type: "uniform", min: 100, max: 100 }, status: 400, error: /min cannot be higher/i },
  { name: "invalid min > max", body: { type: "uniform", min: 120, max: 80 }, status: 400, error: /min cannot be higher/i },
  { name: "invalid non-numeric", body: { type: "uniform", min: "x", max: 100 }, status: 400, error: /must be numbers/i }
];

for (const tc of uniformCases) {
  test(`set-distribution uniform EC/boundary — ${tc.name}`, async () => {
    const { app, gameId, adminToken } = await freshGame();
    const res = await request(app).post("/set-distribution").send({ gameId, adminToken, ...tc.body });

    assert.equal(res.status, tc.status);
    if (tc.error) assert.match(res.body.error, tc.error);
    if (tc.status === 200) {
      assert.equal(res.body.distribution.type, "uniform");
      assert.equal(res.body.distribution.min, tc.body.min);
      assert.equal(res.body.distribution.max, tc.body.max);
    }
  });
}

// ── NORMAL: equivalence classes + boundaries (incl. derived min/max output) ───
const normalCases = [
  { name: "valid mean + stdDev", body: { type: "normal", mean: 100, stdDev: 10 }, status: 200, expect: { mean: 100, stdDev: 10, min: 70, max: 130 } },
  { name: "valid boundary stdDev = 0 (deterministic)", body: { type: "normal", mean: 100, stdDev: 0 }, status: 200, expect: { mean: 100, min: 100, max: 100 } },
  { name: "valid clamp: min floored at 0", body: { type: "normal", mean: 5, stdDev: 10 }, status: 200, expect: { mean: 5, min: 0, max: 35 } },
  { name: "valid boundary mean = 1", body: { type: "normal", mean: 1, stdDev: 0 }, status: 200, expect: { mean: 1, min: 1, max: 1 } },
  { name: "valid boundary mean = 0.5 (rounds up to 1)", body: { type: "normal", mean: 0.5, stdDev: 0 }, status: 200, expect: { mean: 1, min: 1, max: 1 } },
  { name: "invalid boundary mean = 0", body: { type: "normal", mean: 0, stdDev: 5 }, status: 400, error: /at least 0.5/i },
  { name: "invalid mean rounds down to 0 (0.3)", body: { type: "normal", mean: 0.3, stdDev: 5 }, status: 400, error: /at least 0.5/i },
  { name: "invalid mean < 0", body: { type: "normal", mean: -5, stdDev: 5 }, status: 400, error: /at least 0.5/i },
  { name: "invalid stdDev < 0", body: { type: "normal", mean: 100, stdDev: -1 }, status: 400, error: /cannot be negative/i },
  { name: "invalid non-numeric mean", body: { type: "normal", mean: "x", stdDev: 5 }, status: 400, error: /must be numbers/i }
];

for (const tc of normalCases) {
  test(`set-distribution normal EC/boundary — ${tc.name}`, async () => {
    const { app, gameId, adminToken } = await freshGame();
    const res = await request(app).post("/set-distribution").send({ gameId, adminToken, ...tc.body });

    assert.equal(res.status, tc.status);
    if (tc.error) assert.match(res.body.error, tc.error);
    if (tc.status === 200) {
      assert.equal(res.body.distribution.type, "normal");
      for (const [key, value] of Object.entries(tc.expect)) {
        assert.equal(res.body.distribution[key], value, `${key}: expected ${value}, got ${res.body.distribution[key]}`);
      }
    }
  });
}

// ── TRIANGULAR: equivalence classes + boundaries (mode must sit inside [min, max]) ─
const triangularCases = [
  { name: "valid mid-range", body: { type: "triangular", min: 80, mode: 100, max: 140 }, status: 200 },
  { name: "valid boundary mode = min", body: { type: "triangular", min: 80, mode: 80, max: 120 }, status: 200 },
  { name: "valid boundary mode = max", body: { type: "triangular", min: 80, mode: 120, max: 120 }, status: 200 },
  { name: "invalid mode < min", body: { type: "triangular", min: 80, mode: 79, max: 120 }, status: 400, error: /mode must be between/i },
  { name: "invalid mode > max", body: { type: "triangular", min: 80, mode: 121, max: 120 }, status: 400, error: /mode must be between/i },
  { name: "invalid boundary min = max", body: { type: "triangular", min: 100, mode: 100, max: 100 }, status: 400, error: /min cannot be higher/i },
  { name: "invalid min < 0", body: { type: "triangular", min: -1, mode: 10, max: 20 }, status: 400, error: /less than 0/i },
  { name: "invalid missing mode", body: { type: "triangular", min: 80, max: 120 }, status: 400, error: /must be numbers/i }
];

for (const tc of triangularCases) {
  test(`set-distribution triangular EC/boundary — ${tc.name}`, async () => {
    const { app, gameId, adminToken } = await freshGame();
    const res = await request(app).post("/set-distribution").send({ gameId, adminToken, ...tc.body });

    assert.equal(res.status, tc.status);
    if (tc.error) assert.match(res.body.error, tc.error);
    if (tc.status === 200) {
      assert.deepEqual(res.body.distribution, tc.body);
    }
  });
}

test("set-distribution cannot change during an active round", async () => {
  const { app, gameId, adminToken } = await freshGame();
  await request(app).post("/start-round").send({ gameId, adminToken });

  const res = await request(app)
    .post("/set-distribution")
    .send({ gameId, adminToken, type: "uniform", min: 50, max: 60 });

  assert.equal(res.status, 400);
  assert.match(res.body.error, /active round/i);
});
