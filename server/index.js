import express from "express";
import cors from "cors";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { rounds } from "./rounds.js";
import { sampleDemand } from "./utils/demand.js";
import { calculateProfit } from "./utils/profit.js";
import {
  isDbEnabled,
  recordDistributionUpdated,
  recordGameCreated,
  recordOrderSubmitted,
  recordPlayerJoined,
  recordPricesUpdated,
  recordRoundEnded,
  recordRoundStarted
} from "./dbLogger.js";

const PORT = Number(process.env.PORT || 4000);
const DEFAULT_ADMIN_KEY = process.env.ADMIN_KEY || "admin123";

function calculateLeaderboard(players) {
  return Array.from(players.values())
    .map((player) => {
      const cumulativeProfit = player.history.reduce((sum, entry) => sum + entry.profit, 0);

      return {
        nickname: player.nickname,
        cumulativeProfit,
        roundsPlayed: player.history.length
      };
    })
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

  if (isDbEnabled()) {
    console.log("Supabase persistence is enabled.");
  }

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
        prices: { wholesaleCost: 10, retailPrice: 40, salvagePrice: 5 },
        distributionHistory: [],
        leaderboard: [],
        activeRoundDemand: null,
        activeRoundOrders: new Map()
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

    if (existingPlayer) {
      return res.status(409).json({ error: "this username is taken" });
    }

    const player = {
      id: randomUUID(),
      nickname,
      currentRoundIndex: 0,
      cumulativeProfit: 0,
      history: []
    };

    activeGame.players.set(player.id, player);

    const joinedAt = new Date().toISOString();

    if (requestedAdminKey) {
      void recordGameCreated({
        gameId: activeGame.id,
        adminPlayerId: player.id,
        createdAt: activeGame.createdAt
      });

      void recordDistributionUpdated({
        gameId: activeGame.id,
        roundNo: activeGame.currentRoundIndex + 1,
        distribution: activeGame.distribution,
        updatedAt: joinedAt
      });
    }

    void recordPlayerJoined({
      gameId: activeGame.id,
      playerId: player.id,
      nickname: player.nickname,
      isAdmin: Boolean(requestedAdminKey),
      joinedAt
    });

    if (activeGame.roundPhase === "pending") {
      activeGame.leaderboard = calculateLeaderboard(activeGame.players);
    }

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
      prices: activeGame.prices,
      totalRounds: rounds.length,
      roundsPlayed: player.history.length,
      cumulativeProfit: player.cumulativeProfit
    });
  });

  app.post("/set-distribution", (req, res) => {
    const { gameId, adminToken, type, min, max, mean } = req.body || {};

    if (!activeGame || gameId !== activeGame.id) {
      return res.status(400).json({ error: "invalid or inactive game id" });
    }

    if (!adminToken || adminToken !== activeGame.adminToken) {
      return res.status(403).json({ error: "admin authorization required" });
    }

    if (activeGame.roundPhase === "active") {
      return res.status(400).json({ error: "cannot change distribution during active round" });
    }

    const distType = type === "normal" ? "normal" : "uniform";

    let newDistribution;

    if (distType === "normal") {
      const parsedMean = Number(mean);
      const parsedStdDev = Number(req.body?.stdDev);

      if (!Number.isFinite(parsedMean) || !Number.isFinite(parsedStdDev)) {
        return res.status(400).json({ error: "mean and stdDev must be numbers" });
      }

      if (parsedMean <= 0) {
        return res.status(400).json({ error: "mean must be greater than 0" });
      }

      if (parsedStdDev < 0) {
        return res.status(400).json({ error: "stdDev cannot be negative" });
      }

      const boundedMin = Math.max(0, Math.round(parsedMean - 3 * parsedStdDev));
      const boundedMax = Math.round(parsedMean + 3 * parsedStdDev);

      newDistribution = {
        type: "normal",
        mean: Math.round(parsedMean),
        stdDev: parsedStdDev,
        min: parsedStdDev === 0 ? Math.round(parsedMean) : boundedMin,
        max: parsedStdDev === 0 ? Math.round(parsedMean) : boundedMax
      };
    } else {
      const parsedMin = Number(min);
      const parsedMax = Number(max);

      if (!Number.isFinite(parsedMin) || !Number.isFinite(parsedMax)) {
        return res.status(400).json({ error: "min and max must be numbers" });
      }

      if (parsedMin < 0 || parsedMax < 0) {
        return res.status(400).json({ error: "none of the variables can be less than 0" });
      }

      if (parsedMin >= parsedMax) {
        return res.status(400).json({ error: "min cannot be higher than max" });
      }

      newDistribution = {
        type: "uniform",
        min: Math.round(parsedMin),
        max: Math.round(parsedMax)
      };
    }

    activeGame.distribution = newDistribution;

    activeGame.distributionHistory.push({
      roundIndex: activeGame.currentRoundIndex,
      distribution: { ...activeGame.distribution },
      updatedAt: new Date().toISOString()
    });

    void recordDistributionUpdated({
      gameId: activeGame.id,
      roundNo: activeGame.currentRoundIndex + 1,
      distribution: activeGame.distribution,
      updatedAt: new Date().toISOString()
    });

    emitGameEvent(activeGame, "distribution_updated");

    return res.json({
      gameId: activeGame.id,
      distribution: activeGame.distribution,
      distributionHistory: activeGame.distributionHistory
    });
  });

  app.post("/set-prices", (req, res) => {
    const { gameId, adminToken, wholesaleCost, retailPrice, salvagePrice } = req.body || {};

    if (!activeGame || gameId !== activeGame.id) {
      return res.status(400).json({ error: "invalid or inactive game id" });
    }

    if (!adminToken || adminToken !== activeGame.adminToken) {
      return res.status(403).json({ error: "admin authorization required" });
    }

    if (activeGame.roundPhase === "active") {
      return res.status(400).json({ error: "cannot change prices during active round" });
    }

    const parsedWholesale = Number(wholesaleCost);
    const parsedRetail = Number(retailPrice);
    const parsedSalvage = Number(salvagePrice);

    if (!Number.isFinite(parsedWholesale) || !Number.isFinite(parsedRetail) || !Number.isFinite(parsedSalvage)) {
      return res.status(400).json({ error: "all prices must be valid numbers" });
    }

    if (parsedWholesale <= 0 || parsedRetail <= 0) {
      return res.status(400).json({ error: "wholesaleCost and retailPrice must be greater than 0" });
    }

    if (parsedSalvage < 0) {
      return res.status(400).json({ error: "salvagePrice cannot be negative" });
    }

    if (parsedSalvage >= parsedWholesale) {
      return res.status(400).json({ error: "salvagePrice must be less than wholesaleCost" });
    }

    if (parsedWholesale >= parsedRetail) {
      return res.status(400).json({ error: "wholesaleCost must be less than retailPrice" });
    }

    activeGame.prices = {
      wholesaleCost: parsedWholesale,
      retailPrice: parsedRetail,
      salvagePrice: parsedSalvage
    };

    const updatedAt = new Date().toISOString();

    void recordPricesUpdated({
      gameId: activeGame.id,
      roundNo: activeGame.currentRoundIndex + 1,
      prices: activeGame.prices,
      updatedAt
    });

    emitGameEvent(activeGame, "prices_updated");

    return res.json({
      gameId: activeGame.id,
      prices: activeGame.prices
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

    activeGame.activeRoundDemand = sampleDemand(activeGame.distribution);
    activeGame.activeRoundOrders = new Map();
    activeGame.roundPhase = "active";
    const startedAt = new Date().toISOString();

    void recordRoundStarted({
      gameId: activeGame.id,
      roundId: currentRound.id,
      roundNo: activeGame.currentRoundIndex + 1,
      distribution: activeGame.distribution,
      prices: activeGame.prices,
      realizedDemand: activeGame.activeRoundDemand,
      startedAt
    });

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

    const alreadySubmittedThisRound = activeGame.activeRoundOrders.has(player.id);

    if (alreadySubmittedThisRound) {
      return res.status(400).json({ error: "player already submitted this round" });
    }

    activeGame.activeRoundOrders.set(player.id, {
      playerId: player.id,
      nickname: player.nickname,
      orderQuantity: parsedQty,
      submittedAt: new Date().toISOString()
    });

    void recordOrderSubmitted({
      gameId: activeGame.id,
      roundId: round.id,
      playerId: player.id,
      nickname: player.nickname,
      orderQuantity: parsedQty,
      submittedAt: new Date().toISOString()
    });

    emitGameEvent(activeGame, "order_submitted", {
      playerId: player.id,
      nickname: player.nickname,
      roundsPlayed: player.history.length
    });

    return res.json({
      accepted: true,
      roundId: round.id,
      orderQuantity: parsedQty,
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

    const endingRound = getRoundForGame(activeGame);
    const realizedDemand = activeGame.activeRoundDemand;
    const endedAt = new Date().toISOString();

    if (!endingRound || !Number.isFinite(realizedDemand)) {
      return res.status(400).json({ error: "round demand state is invalid" });
    }

    const dbRoundResults = [];

    for (const order of activeGame.activeRoundOrders.values()) {
      const player = activeGame.players.get(order.playerId);
      if (!player) {
        continue;
      }

      const details = calculateProfit(order.orderQuantity, realizedDemand, activeGame.prices);
      const roundResult = {
        round: endingRound.id,
        title: endingRound.title,
        distribution: { ...activeGame.distribution },
        orderQuantity: order.orderQuantity,
        realizedDemand,
        ...details,
        createdAt: new Date().toISOString()
      };

      player.history.push(roundResult);
      player.cumulativeProfit += roundResult.profit;

      dbRoundResults.push({
        playerId: player.id,
        sold: roundResult.soldUnits,
        leftover: roundResult.unsoldUnits,
        stockout: Math.max(0, realizedDemand - order.orderQuantity),
        profit: roundResult.profit
      });
    }

    void recordRoundEnded({
      gameId: activeGame.id,
      roundId: endingRound.id,
      realizedDemand,
      endedAt,
      results: dbRoundResults
    });

    activeGame.roundPhase = "pending";
    activeGame.currentRoundIndex += 1;
    activeGame.activeRoundDemand = null;
    activeGame.activeRoundOrders = new Map();
    activeGame.leaderboard = calculateLeaderboard(activeGame.players);

    const nextRound = getRoundForGame(activeGame);
    const finished = nextRound === null;
    emitGameEvent(activeGame, "round_ended", { finished });

    return res.json({
      gameId: activeGame.id,
      finished,
      nextRound,
      roundPhase: activeGame.roundPhase,
      distribution: activeGame.distribution,
      prices: activeGame.prices,
      leaderboard: activeGame.leaderboard
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
      prices: activeGame.prices,
      finished: currentRound === null,
      player: player
        ? {
            id: player.id,
            nickname: player.nickname,
            roundsPlayed: player.history.length,
            cumulativeProfit: player.cumulativeProfit,
            history: player.history,
            lastRoundResult: player.history[player.history.length - 1] || null,
            submittedThisRound:
              activeGame.roundPhase === "active" && activeGame.activeRoundOrders.has(player.id)
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
      leaderboard: activeGame.leaderboard
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
