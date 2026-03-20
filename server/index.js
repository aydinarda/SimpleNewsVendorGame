import express from "express";
import cors from "cors";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { rounds } from "./rounds.js";
import { sampleDemand } from "./utils/demand.js";
import { calculateProfit } from "./utils/profit.js";

const PORT = Number(process.env.PORT || 4000);
const DEFAULT_ADMIN_KEY = process.env.ADMIN_KEY || "admin123";

function buildLeaderboard(game) {
  return Array.from(game.players.values())
    .map((player) => ({
      nickname: player.nickname,
      cumulativeProfit: player.cumulativeProfit,
      roundsPlayed: player.history.length
    }))
    .sort((a, b) => b.cumulativeProfit - a.cumulativeProfit)
    .map((row, index) => ({ rank: index + 1, ...row }));
}

function sanitizeNickname(raw) {
  return String(raw || "").trim().slice(0, 20);
}

function getRoundForGame(game) {
  const baseRound = rounds[game.currentRoundIndex];

  if (!baseRound) {
    return null;
  }

  return {
    ...baseRound,
    distribution: { ...game.distribution }
  };
}

export function createApp({ adminKey = DEFAULT_ADMIN_KEY, onGameEvent } = {}) {
  const app = express();
  let activeGame = null;

  const emitGameEvent = (game, type, extra = {}) => {
    if (typeof onGameEvent !== "function" || !game) {
      return;
    }

    onGameEvent({
      type,
      gameId: game.id,
      roundPhase: game.roundPhase,
      currentRound: getRoundForGame(game),
      distribution: game.distribution,
      timestamp: new Date().toISOString(),
      ...extra
    });
  };

  app.use(cors());
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ ok: true, activeGameId: activeGame?.id || null });
  });

  app.post("/start-game", (req, res) => {
    const nickname = sanitizeNickname(req.body?.nickname);
    const requestedAdminKey = req.body?.adminKey;
    const requestedGameId = req.body?.gameId;

    if (!nickname) {
      return res.status(400).json({ error: "nickname is required" });
    }

    if (requestedAdminKey) {
      if (requestedAdminKey !== adminKey) {
        return res.status(403).json({ error: "invalid admin key" });
      }

      activeGame = {
        id: randomUUID(),
        adminToken: randomUUID(),
        players: new Map(),
        createdAt: new Date().toISOString(),
        currentRoundIndex: 0,
        roundPhase: "pending",
        distribution: { type: "uniform", min: 80, max: 120 },
        distributionHistory: []
      };

      activeGame.distributionHistory.push({
        roundIndex: activeGame.currentRoundIndex,
        distribution: { ...activeGame.distribution },
        updatedAt: new Date().toISOString()
      });
    }

    if (!activeGame) {
      return res.status(400).json({
        error: "no active game. ask admin to create one with adminKey"
      });
    }

    if (requestedGameId && requestedGameId !== activeGame.id) {
      return res.status(400).json({ error: "requested room is not active" });
    }

    const existingPlayer = Array.from(activeGame.players.values()).find(
      (player) => player.nickname.toLowerCase() === nickname.toLowerCase()
    );

    const player =
      existingPlayer || {
        id: randomUUID(),
        nickname,
        currentRoundIndex: 0,
        cumulativeProfit: 0,
        history: []
      };

    activeGame.players.set(player.id, player);

    emitGameEvent(activeGame, "player_joined", {
      playerId: player.id,
      nickname: player.nickname
    });

    return res.json({
      gameId: activeGame.id,
      adminToken: requestedAdminKey ? activeGame.adminToken : undefined,
      playerId: player.id,
      nickname: player.nickname,
      currentRound: getRoundForGame(activeGame),
      roundPhase: activeGame.roundPhase,
      distribution: activeGame.distribution,
      totalRounds: rounds.length,
      roundsPlayed: player.history.length,
      cumulativeProfit: player.cumulativeProfit
    });
  });

  app.post("/set-distribution", (req, res) => {
    const { gameId, adminToken, min, max } = req.body || {};

    if (!activeGame || gameId !== activeGame.id) {
      return res.status(400).json({ error: "invalid or inactive game id" });
    }

    if (!adminToken || adminToken !== activeGame.adminToken) {
      return res.status(403).json({ error: "admin authorization required" });
    }

    if (activeGame.roundPhase === "active") {
      return res.status(400).json({ error: "cannot change distribution during active round" });
    }

    const parsedMin = Number(min);
    const parsedMax = Number(max);

    if (!Number.isFinite(parsedMin) || !Number.isFinite(parsedMax)) {
      return res.status(400).json({ error: "min and max must be numbers" });
    }

    if (parsedMin >= parsedMax) {
      return res.status(400).json({ error: "min must be less than max" });
    }

    activeGame.distribution = {
      type: "uniform",
      min: Math.round(parsedMin),
      max: Math.round(parsedMax)
    };

    activeGame.distributionHistory.push({
      roundIndex: activeGame.currentRoundIndex,
      distribution: { ...activeGame.distribution },
      updatedAt: new Date().toISOString()
    });

    emitGameEvent(activeGame, "distribution_updated");

    return res.json({
      gameId: activeGame.id,
      distribution: activeGame.distribution,
      distributionHistory: activeGame.distributionHistory
    });
  });

  app.post("/start-round", (req, res) => {
    const { gameId, adminToken } = req.body || {};

    if (!activeGame || gameId !== activeGame.id) {
      return res.status(400).json({ error: "invalid or inactive game id" });
    }

    if (!adminToken || adminToken !== activeGame.adminToken) {
      return res.status(403).json({ error: "admin authorization required" });
    }

    const currentRound = getRoundForGame(activeGame);
    if (!currentRound) {
      return res.status(400).json({ error: "game already completed" });
    }

    if (activeGame.roundPhase === "active") {
      return res.status(400).json({ error: "round already active" });
    }

    activeGame.roundPhase = "active";
    emitGameEvent(activeGame, "round_started");

    return res.json({
      gameId: activeGame.id,
      roundPhase: activeGame.roundPhase,
      currentRound,
      totalRounds: rounds.length
    });
  });

  app.post("/submit-order", (req, res) => {
    const { gameId, playerId, orderQuantity } = req.body || {};

    if (!activeGame || gameId !== activeGame.id) {
      return res.status(400).json({ error: "invalid or inactive game id" });
    }

    const player = activeGame.players.get(playerId);
    if (!player) {
      return res.status(404).json({ error: "player not found" });
    }

    if (activeGame.roundPhase !== "active") {
      return res.status(400).json({ error: "round is not active" });
    }

    const parsedQty = Number(orderQuantity);
    if (!Number.isInteger(parsedQty) || parsedQty <= 0) {
      return res.status(400).json({ error: "orderQuantity must be positive integer" });
    }

    const round = getRoundForGame(activeGame);
    if (!round) {
      return res.status(400).json({ error: "game already completed" });
    }

    const alreadySubmittedThisRound = player.history.some(
      (entry) => entry.round === round.id
    );

    if (alreadySubmittedThisRound) {
      return res.status(400).json({ error: "player already submitted this round" });
    }

    const realizedDemand = sampleDemand(activeGame.distribution);
    const details = calculateProfit(parsedQty, realizedDemand);

    const roundResult = {
      round: round.id,
      title: round.title,
      distribution: { ...activeGame.distribution },
      orderQuantity: parsedQty,
      realizedDemand,
      ...details,
      createdAt: new Date().toISOString()
    };

    player.history.push(roundResult);
    player.cumulativeProfit += roundResult.profit;

    emitGameEvent(activeGame, "order_submitted", {
      playerId: player.id,
      nickname: player.nickname,
      roundsPlayed: player.history.length
    });

    return res.json({
      roundResult,
      cumulativeProfit: player.cumulativeProfit,
      roundsPlayed: player.history.length,
      totalRounds: rounds.length,
      currentRound: round,
      roundPhase: activeGame.roundPhase
    });
  });

  app.post("/end-round", (req, res) => {
    const { gameId, adminToken } = req.body || {};

    if (!activeGame || gameId !== activeGame.id) {
      return res.status(400).json({ error: "invalid or inactive game id" });
    }

    if (!adminToken || adminToken !== activeGame.adminToken) {
      return res.status(403).json({ error: "admin authorization required" });
    }

    if (activeGame.roundPhase !== "active") {
      return res.status(400).json({ error: "round is not active" });
    }

    activeGame.roundPhase = "pending";
    activeGame.currentRoundIndex += 1;

    const nextRound = getRoundForGame(activeGame);
    const finished = nextRound === null;
    emitGameEvent(activeGame, "round_ended", { finished });

    return res.json({
      gameId: activeGame.id,
      finished,
      nextRound,
      roundPhase: activeGame.roundPhase,
      distribution: activeGame.distribution,
      leaderboard: buildLeaderboard(activeGame)
    });
  });

  app.get("/game-state", (req, res) => {
    const gameId = req.query.gameId;
    const playerId = req.query.playerId;

    if (!activeGame || gameId !== activeGame.id) {
      return res.status(400).json({ error: "invalid or inactive game id" });
    }

    const player = playerId ? activeGame.players.get(playerId) : null;
    if (playerId && !player) {
      return res.status(404).json({ error: "player not found" });
    }

    const currentRound = getRoundForGame(activeGame);

    return res.json({
      gameId: activeGame.id,
      roundPhase: activeGame.roundPhase,
      currentRound,
      totalRounds: rounds.length,
      distribution: activeGame.distribution,
      finished: currentRound === null,
      player: player
        ? {
            id: player.id,
            nickname: player.nickname,
            roundsPlayed: player.history.length,
            cumulativeProfit: player.cumulativeProfit
          }
        : undefined
    });
  });

  app.get("/leaderboard", (req, res) => {
    const gameId = req.query.gameId;

    if (!activeGame || gameId !== activeGame.id) {
      return res.status(400).json({ error: "invalid or inactive game id" });
    }

    return res.json({
      gameId: activeGame.id,
      createdAt: activeGame.createdAt,
      leaderboard: buildLeaderboard(activeGame)
    });
  });

  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const clients = new Set();

  const server = http.createServer(
    createApp({
      onGameEvent: (eventPayload) => {
        const message = JSON.stringify({ type: "game_event", payload: eventPayload });

        for (const ws of clients) {
          if (ws.readyState !== 1) {
            continue;
          }

          if (!ws.subscription || ws.subscription.gameId !== eventPayload.gameId) {
            continue;
          }

          ws.send(message);
        }
      }
    })
  );

  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (ws) => {
    ws.subscription = null;
    clients.add(ws);

    ws.on("message", (raw) => {
      try {
        const incoming = JSON.parse(String(raw));

        if (incoming?.type === "subscribe" && typeof incoming?.gameId === "string") {
          ws.subscription = {
            gameId: incoming.gameId,
            playerId: typeof incoming.playerId === "string" ? incoming.playerId : null
          };

          ws.send(JSON.stringify({ type: "subscribed", gameId: ws.subscription.gameId }));
        }
      } catch (_error) {
        ws.send(JSON.stringify({ type: "error", message: "invalid websocket payload" }));
      }
    });

    ws.on("close", () => {
      clients.delete(ws);
    });
  });

  server.on("upgrade", (request, socket, head) => {
    if (!request.url || !request.url.startsWith("/ws")) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`WebSocket available on ws://localhost:${PORT}/ws`);
  });
}
