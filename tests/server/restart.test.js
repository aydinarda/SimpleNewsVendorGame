import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../../server/index.js";

const ADMIN_KEY = "admin123";

async function gameWithPlayer() {
  const app = createApp({ adminKey: ADMIN_KEY });
  const admin = await request(app).post("/start-game").send({ nickname: "admin", adminKey: ADMIN_KEY });
  const player = await request(app).post("/start-game").send({ nickname: "alice", gameId: admin.body.gameId });
  return { app, admin: admin.body, player: player.body };
}

function restart(app, gameId, adminToken) {
  return request(app).post("/restart-game").send({ gameId, adminToken });
}

test("a player on a pre-restart game id is pointed at the restarted game", async () => {
  const { app, admin, player } = await gameWithPlayer();
  const restarted = await restart(app, admin.gameId, admin.adminToken);

  const stale = await request(app)
    .get("/game-state")
    .query({ gameId: admin.gameId, playerId: player.playerId });

  assert.equal(stale.status, 400);
  assert.equal(stale.body.restartedGameId, restarted.body.gameId);

  const current = await request(app)
    .get("/game-state")
    .query({ gameId: stale.body.restartedGameId, playerId: player.playerId });

  assert.equal(current.status, 200);
  assert.equal(current.body.player.nickname, "alice");
});

test("an id from several restarts ago still resolves to the latest game", async () => {
  const { app, admin, player } = await gameWithPlayer();
  const first = await restart(app, admin.gameId, admin.adminToken);
  const second = await restart(app, first.body.gameId, admin.adminToken);

  const stale = await request(app)
    .get("/game-state")
    .query({ gameId: admin.gameId, playerId: player.playerId });

  assert.equal(stale.body.restartedGameId, second.body.gameId);
});

test("the restarted game id is not revealed to unknown players or unrelated ids", async () => {
  const { app, admin } = await gameWithPlayer();
  await restart(app, admin.gameId, admin.adminToken);

  const unknownPlayer = await request(app)
    .get("/game-state")
    .query({ gameId: admin.gameId, playerId: "not-a-player" });
  const unrelatedGame = await request(app).get("/game-state").query({ gameId: "some-other-game" });

  assert.equal(unknownPlayer.status, 400);
  assert.equal(unknownPlayer.body.restartedGameId, undefined);
  assert.equal(unrelatedGame.body.restartedGameId, undefined);
});
