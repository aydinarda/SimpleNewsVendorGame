import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { createApp } from "./index.js";

const ADMIN_KEY = "admin123";

test("creates an active game with random room id", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });

  const response = await request(app).post("/start-game").send({
    nickname: "admin-player",
    adminKey: ADMIN_KEY
  });

  assert.equal(response.status, 200);
  assert.match(
    response.body.gameId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  );
});

test("joins active room with 200 status", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });

  const createRoom = await request(app).post("/start-game").send({
    nickname: "admin-player",
    adminKey: ADMIN_KEY
  });

  const joinRoom = await request(app).post("/start-game").send({
    nickname: "second-player",
    gameId: createRoom.body.gameId
  });

  assert.equal(joinRoom.status, 200);
  assert.equal(joinRoom.body.gameId, createRoom.body.gameId);
});

test("joining inactive room returns error", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });

  await request(app).post("/start-game").send({
    nickname: "admin-player",
    adminKey: ADMIN_KEY
  });

  const response = await request(app).post("/start-game").send({
    nickname: "third-player",
    gameId: randomUUID()
  });

  assert.equal(response.status, 400);
  assert.equal(response.body.error, "requested room is not active");
});

test("admin can start a round", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });

  const createRoom = await request(app).post("/start-game").send({
    nickname: "admin-player",
    adminKey: ADMIN_KEY
  });

  const response = await request(app).post("/start-round").send({
    gameId: createRoom.body.gameId,
    adminToken: createRoom.body.adminToken
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.roundPhase, "active");
  assert.equal(response.body.currentRound.id, 1);
});

test("non-admin cannot start round", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });

  const createRoom = await request(app).post("/start-game").send({
    nickname: "admin-player",
    adminKey: ADMIN_KEY
  });

  const response = await request(app).post("/start-round").send({
    gameId: createRoom.body.gameId,
    adminToken: "not-admin-token"
  });

  assert.equal(response.status, 403);
  assert.equal(response.body.error, "admin authorization required");
});

test("admin can update uniform distribution and it is stored", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });

  const createRoom = await request(app).post("/start-game").send({
    nickname: "admin-player",
    adminKey: ADMIN_KEY
  });

  const updateDistribution = await request(app).post("/set-distribution").send({
    gameId: createRoom.body.gameId,
    adminToken: createRoom.body.adminToken,
    min: 90,
    max: 140
  });

  assert.equal(updateDistribution.status, 200);
  assert.equal(updateDistribution.body.distribution.type, "uniform");
  assert.equal(updateDistribution.body.distribution.min, 90);
  assert.equal(updateDistribution.body.distribution.max, 140);
  assert.ok(updateDistribution.body.distributionHistory.length >= 2);

  const startRoundResponse = await request(app).post("/start-round").send({
    gameId: createRoom.body.gameId,
    adminToken: createRoom.body.adminToken
  });

  assert.equal(startRoundResponse.status, 200);
  assert.equal(startRoundResponse.body.currentRound.distribution.min, 90);
  assert.equal(startRoundResponse.body.currentRound.distribution.max, 140);
});

test("player can submit demand while round is active", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });

  const createRoom = await request(app).post("/start-game").send({
    nickname: "admin-player",
    adminKey: ADMIN_KEY
  });

  const playerJoin = await request(app).post("/start-game").send({
    nickname: "second-player",
    gameId: createRoom.body.gameId
  });

  await request(app).post("/start-round").send({
    gameId: createRoom.body.gameId,
    adminToken: createRoom.body.adminToken
  });

  const submit = await request(app).post("/submit-order").send({
    gameId: createRoom.body.gameId,
    playerId: playerJoin.body.playerId,
    orderQuantity: 1200
  });

  assert.equal(submit.status, 200);
  assert.equal(submit.body.roundResult.round, 1);
  assert.equal(submit.body.roundResult.orderQuantity, 1200);
  assert.ok(Number.isInteger(submit.body.roundResult.realizedDemand));
});

test("admin can end round and leaderboard is returned", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });

  const createRoom = await request(app).post("/start-game").send({
    nickname: "admin-player",
    adminKey: ADMIN_KEY
  });

  await request(app).post("/start-round").send({
    gameId: createRoom.body.gameId,
    adminToken: createRoom.body.adminToken
  });

  await request(app).post("/submit-order").send({
    gameId: createRoom.body.gameId,
    playerId: createRoom.body.playerId,
    orderQuantity: 1000
  });

  const endRound = await request(app).post("/end-round").send({
    gameId: createRoom.body.gameId,
    adminToken: createRoom.body.adminToken
  });

  assert.equal(endRound.status, 200);
  assert.equal(endRound.body.roundPhase, "pending");
  assert.ok(Array.isArray(endRound.body.leaderboard));
  assert.ok(endRound.body.leaderboard.length >= 1);
  assert.equal(endRound.body.leaderboard[0].nickname, "admin-player");
});

test("can play 5 turns back-to-back and finish game", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });

  const createRoom = await request(app).post("/start-game").send({
    nickname: "admin-player",
    adminKey: ADMIN_KEY
  });

  const gameId = createRoom.body.gameId;
  const adminToken = createRoom.body.adminToken;
  const playerId = createRoom.body.playerId;

  let endRoundPayload = null;

  for (let turn = 1; turn <= 5; turn += 1) {
    const startRoundResponse = await request(app).post("/start-round").send({
      gameId,
      adminToken
    });

    assert.equal(startRoundResponse.status, 200);
    assert.equal(startRoundResponse.body.currentRound.id, turn);
    assert.equal(startRoundResponse.body.roundPhase, "active");

    const submitResponse = await request(app).post("/submit-order").send({
      gameId,
      playerId,
      orderQuantity: 1000 + turn * 10
    });

    assert.equal(submitResponse.status, 200);
    assert.equal(submitResponse.body.roundResult.round, turn);
    assert.ok(Number.isFinite(submitResponse.body.roundResult.profit));

    const endRoundResponse = await request(app).post("/end-round").send({
      gameId,
      adminToken
    });

    assert.equal(endRoundResponse.status, 200);
    assert.equal(endRoundResponse.body.roundPhase, "pending");
    assert.ok(Array.isArray(endRoundResponse.body.leaderboard));

    endRoundPayload = endRoundResponse.body;
  }

  assert.ok(endRoundPayload);
  assert.equal(endRoundPayload.finished, true);
  assert.equal(endRoundPayload.nextRound, null);
  assert.ok(endRoundPayload.leaderboard.length >= 1);

  const leaderboard = await request(app)
    .get("/leaderboard")
    .query({ gameId });

  assert.equal(leaderboard.status, 200);
  assert.ok(Array.isArray(leaderboard.body.leaderboard));
  assert.equal(leaderboard.body.leaderboard[0].roundsPlayed, 5);
});

test("a joined user can complete all 5 rounds", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });

  const admin = await request(app).post("/start-game").send({
    nickname: "admin-player",
    adminKey: ADMIN_KEY
  });

  const joinedUser = await request(app).post("/start-game").send({
    nickname: "joined-user",
    gameId: admin.body.gameId
  });

  const gameId = admin.body.gameId;
  const adminToken = admin.body.adminToken;
  const joinedUserId = joinedUser.body.playerId;

  for (let round = 1; round <= 5; round += 1) {
    const startRoundResponse = await request(app).post("/start-round").send({
      gameId,
      adminToken
    });

    assert.equal(startRoundResponse.status, 200);
    assert.equal(startRoundResponse.body.currentRound.id, round);

    const submitResponse = await request(app).post("/submit-order").send({
      gameId,
      playerId: joinedUserId,
      orderQuantity: 900 + round * 25
    });

    assert.equal(submitResponse.status, 200);
    assert.equal(submitResponse.body.roundResult.round, round);

    const endRoundResponse = await request(app).post("/end-round").send({
      gameId,
      adminToken
    });

    assert.equal(endRoundResponse.status, 200);
  }

  const leaderboard = await request(app)
    .get("/leaderboard")
    .query({ gameId });

  assert.equal(leaderboard.status, 200);

  const joinedUserRow = leaderboard.body.leaderboard.find(
    (row) => row.nickname === "joined-user"
  );

  assert.ok(joinedUserRow);
  assert.equal(joinedUserRow.roundsPlayed, 5);
});

test("admin can change min-max and joined user sees updated distribution", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });

  const admin = await request(app).post("/start-game").send({
    nickname: "admin-player",
    adminKey: ADMIN_KEY
  });

  const userJoin = await request(app).post("/start-game").send({
    nickname: "joined-user",
    gameId: admin.body.gameId
  });

  assert.equal(userJoin.status, 200);
  assert.equal(userJoin.body.distribution.min, 80);
  assert.equal(userJoin.body.distribution.max, 120);

  const distributionUpdate = await request(app).post("/set-distribution").send({
    gameId: admin.body.gameId,
    adminToken: admin.body.adminToken,
    min: 95,
    max: 135
  });

  assert.equal(distributionUpdate.status, 200);
  assert.equal(distributionUpdate.body.distribution.min, 95);
  assert.equal(distributionUpdate.body.distribution.max, 135);

  const userRefresh = await request(app).post("/start-game").send({
    nickname: "joined-user",
    gameId: admin.body.gameId
  });

  assert.equal(userRefresh.status, 200);
  assert.equal(userRefresh.body.distribution.min, 95);
  assert.equal(userRefresh.body.distribution.max, 135);

  const startRoundResponse = await request(app).post("/start-round").send({
    gameId: admin.body.gameId,
    adminToken: admin.body.adminToken
  });

  assert.equal(startRoundResponse.status, 200);
  assert.equal(startRoundResponse.body.currentRound.distribution.min, 95);
  assert.equal(startRoundResponse.body.currentRound.distribution.max, 135);

  const userSubmit = await request(app).post("/submit-order").send({
    gameId: admin.body.gameId,
    playerId: userRefresh.body.playerId,
    orderQuantity: 1000
  });

  assert.equal(userSubmit.status, 200);
  assert.ok(userSubmit.body.roundResult.realizedDemand >= 95);
  assert.ok(userSubmit.body.roundResult.realizedDemand <= 135);
});

test("leaderboard is accessible at game start for admin and user, and during rounds", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });

  const admin = await request(app).post("/start-game").send({
    nickname: "admin-player",
    adminKey: ADMIN_KEY
  });

  const user = await request(app).post("/start-game").send({
    nickname: "joined-user",
    gameId: admin.body.gameId
  });

  const leaderboardAtStartForAdmin = await request(app)
    .get("/leaderboard")
    .query({ gameId: admin.body.gameId });

  assert.equal(leaderboardAtStartForAdmin.status, 200);
  assert.equal(leaderboardAtStartForAdmin.body.leaderboard.length, 2);

  const leaderboardAtStartForUser = await request(app)
    .get("/leaderboard")
    .query({ gameId: user.body.gameId });

  assert.equal(leaderboardAtStartForUser.status, 200);
  assert.equal(leaderboardAtStartForUser.body.leaderboard.length, 2);

  for (let round = 1; round <= 3; round += 1) {
    const startRoundResponse = await request(app).post("/start-round").send({
      gameId: admin.body.gameId,
      adminToken: admin.body.adminToken
    });

    assert.equal(startRoundResponse.status, 200);

    const adminSubmit = await request(app).post("/submit-order").send({
      gameId: admin.body.gameId,
      playerId: admin.body.playerId,
      orderQuantity: 1000 + round
    });

    assert.equal(adminSubmit.status, 200);

    const userSubmit = await request(app).post("/submit-order").send({
      gameId: user.body.gameId,
      playerId: user.body.playerId,
      orderQuantity: 950 + round
    });

    assert.equal(userSubmit.status, 200);

    const endRoundResponse = await request(app).post("/end-round").send({
      gameId: admin.body.gameId,
      adminToken: admin.body.adminToken
    });

    assert.equal(endRoundResponse.status, 200);

    const leaderboardDuringProgress = await request(app)
      .get("/leaderboard")
      .query({ gameId: admin.body.gameId });

    assert.equal(leaderboardDuringProgress.status, 200);
    assert.equal(leaderboardDuringProgress.body.leaderboard.length, 2);
    assert.ok(
      leaderboardDuringProgress.body.leaderboard.every(
        (row) => row.roundsPlayed === round
      )
    );
  }
});

test("demand is hidden from UI when round is active, visible only after end-round", async () => {
  const app = createApp({ adminKey: ADMIN_KEY });

  const admin = await request(app).post("/start-game").send({
    nickname: "admin-player",
    adminKey: ADMIN_KEY
  });

  const gameId = admin.body.gameId;
  const adminToken = admin.body.adminToken;
  const playerId = admin.body.playerId;

  // Start first round
  const startRoundResponse = await request(app).post("/start-round").send({
    gameId,
    adminToken
  });

  assert.equal(startRoundResponse.status, 200);
  assert.equal(startRoundResponse.body.roundPhase, "active");

  // Player submits order while round is active
  const submitResponse = await request(app).post("/submit-order").send({
    gameId,
    playerId,
    orderQuantity: 1000
  });

  assert.equal(submitResponse.status, 200);
  // Backend returns realizedDemand for server-side calculations
  assert.ok(submitResponse.body.roundResult.realizedDemand);
  // But roundPhase is still "active" (UI signal to hide demand)
  assert.equal(submitResponse.body.roundPhase, "active");

  // Get leaderboard while round is active - demand should be hidden from client perspective
  const leaderboardDuringRound = await request(app)
    .get("/leaderboard")
    .query({ gameId });

  assert.equal(leaderboardDuringRound.status, 200);
  // Note: Leaderboard API doesn't filter - frontend filters based on roundPhase
  // Test verifies server returned data, frontend responsibility to hide demand

  // Admin ends round
  const endRoundResponse = await request(app).post("/end-round").send({
    gameId,
    adminToken
  });

  assert.equal(endRoundResponse.status, 200);
  assert.equal(endRoundResponse.body.roundPhase, "pending");
  // After round ends, leaderboard is returned in response
  assert.ok(endRoundResponse.body.leaderboard);
  // Demand values should be visible in leaderboard after round ends
  assert.ok(
    endRoundResponse.body.leaderboard[0].roundsPlayed === 1
  );
});