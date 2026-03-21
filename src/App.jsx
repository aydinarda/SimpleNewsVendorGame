import { useCallback, useEffect, useMemo, useState } from "react";
import RoundInfo from "./components/RoundInfo";
import OrderForm from "./components/OrderForm";
import RoundResult from "./components/RoundResult";
import Leaderboard from "./components/Leaderboard";
import ProgressBar from "./components/ProgressBar";
import {
  endRound,
  fetchGameState,
  fetchLeaderboard,
  setDistribution,
  startGame,
  startRound,
  submitOrder
} from "./utils/api";
import {
  saveGameSession,
  loadGameSession,
  clearGameSession,
  updateUrlWithSession,
  getSessionFromUrl
} from "./utils/sessionStorage";
function App() {
  const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";
  const WS_BASE_URL = import.meta.env.VITE_WS_BASE_URL || API_BASE_URL.replace(/^http/, "ws");

  const [nicknameInput, setNicknameInput] = useState("");
  const [nickname, setNickname] = useState("");
  const [adminMode, setAdminMode] = useState(false);
  const [adminKey, setAdminKey] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminToken, setAdminToken] = useState("");
  const [gameId, setGameId] = useState("");
  const [playerId, setPlayerId] = useState("");
  const [totalRounds, setTotalRounds] = useState(5);
  const [currentRound, setCurrentRound] = useState(null);
  const [roundPhase, setRoundPhase] = useState("pending");
  const [distributionMin, setDistributionMin] = useState("80");
  const [distributionMax, setDistributionMax] = useState("120");
  const [hasUnsavedDistributionChanges, setHasUnsavedDistributionChanges] = useState(false);
  const [lastRoundResult, setLastRoundResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [leaderboardRows, setLeaderboardRows] = useState([]);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [isRoundSubmitted, setIsRoundSubmitted] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const cumulativeProfit = useMemo(
    () => history.reduce((sum, row) => sum + row.profit, 0),
    [history]
  );

    // Restore session on page load from URL params or localStorage
    useEffect(() => {
      const urlSession = getSessionFromUrl();
      const storedSession = loadGameSession();
      const sessionToRestore = urlSession || storedSession;

      if (sessionToRestore?.gameId && sessionToRestore?.playerId) {
        // Resume session
        const restoreAsync = async () => {
          try {
            // Fetch fresh game state from server
            const data = await fetchGameState({
              gameId: sessionToRestore.gameId,
              playerId: sessionToRestore.playerId
            });

            // Restore all state from fresh data
            setGameId(sessionToRestore.gameId);
            setPlayerId(sessionToRestore.playerId);
            setNickname(storedSession?.nickname || "Player");
            setIsAdmin(storedSession?.isAdmin || false);
            setAdminToken(storedSession?.adminToken || "");
            setCurrentRound(data.currentRound);
            setRoundPhase(data.roundPhase || "pending");
            setDistributionMin(String(data.distribution?.min ?? 80));
            setDistributionMax(String(data.distribution?.max ?? 120));
            setHasUnsavedDistributionChanges(false);
            setTotalRounds(data.totalRounds || 5);
          
            setStatusMessage("📍 Session restored from previous session");
          } catch (error) {
            console.error("Failed to restore session:", error);
            // Clear invalid session
            clearGameSession();
            setErrorMessage("Failed to restore session. Please start a new game.");
          }
        };

        restoreAsync();
      }
    }, []);
  const isGameFinished = Boolean(nickname) && currentRound === null;

  const refreshLeaderboard = async (nextGameId) => {
    const data = await fetchLeaderboard({ gameId: nextGameId || gameId });
    setLeaderboardRows(data.leaderboard || []);
  };

  const syncGameState = useCallback(async () => {
    if (!gameId || !playerId) {
      return;
    }

    const data = await fetchGameState({ gameId, playerId });

    setCurrentRound(data.currentRound);
    setRoundPhase(data.roundPhase || "pending");
    setTotalRounds(data.totalRounds || 5);

    if (data.distribution) {
      const shouldPreserveAdminDraft =
        isAdmin &&
        hasUnsavedDistributionChanges &&
        (data.roundPhase || "pending") === "pending";

      if (!shouldPreserveAdminDraft) {
        setDistributionMin(String(data.distribution.min));
        setDistributionMax(String(data.distribution.max));
        setHasUnsavedDistributionChanges(false);
      }
    }

    if (data.player) {
      setNickname(data.player.nickname || nickname);
      setHistory(data.player.history || []);
      setLastRoundResult(data.player.lastRoundResult || null);
      setIsRoundSubmitted(Boolean(data.player.submittedThisRound));
    }

    if (showLeaderboard) {
      const leaderboardData = await fetchLeaderboard({ gameId });
      setLeaderboardRows(leaderboardData.leaderboard || []);
    }
  }, [
    gameId,
    playerId,
    showLeaderboard,
    nickname,
    isAdmin,
    hasUnsavedDistributionChanges
  ]);

  const handleNicknameSubmit = async (event) => {
    event.preventDefault();
    setErrorMessage("");

    if (!nicknameInput.trim()) {
      return;
    }

    try {
      const data = await startGame({
        nickname: nicknameInput.trim(),
        adminKey: adminMode ? adminKey.trim() : undefined
      });

      setNickname(data.nickname);
      setGameId(data.gameId);
      setPlayerId(data.playerId);
      setIsAdmin(Boolean(data.adminToken));
      setAdminToken(data.adminToken || "");
      setCurrentRound(data.currentRound);
      setRoundPhase(data.roundPhase || "pending");
      setDistributionMin(String(data.distribution?.min ?? 80));
      setDistributionMax(String(data.distribution?.max ?? 120));
      setHasUnsavedDistributionChanges(false);
      setTotalRounds(data.totalRounds);
      setHistory([]);
      setLastRoundResult(null);
      setIsRoundSubmitted(false);
      
        // Save session to localStorage and URL
        saveGameSession({
          gameId: data.gameId,
          playerId: data.playerId,
          nickname: data.nickname,
          isAdmin: Boolean(data.adminToken),
          adminToken: data.adminToken || "",
          roundPhase: data.roundPhase || "pending"
        });
        updateUrlWithSession(data.gameId, data.playerId);

      setStatusMessage(
        adminMode ? "Active game created and player joined." : "Joined active game."
      );

      await refreshLeaderboard(data.gameId);
    } catch (error) {
      setErrorMessage(error.message);
    }
  };

  const handleOrderSubmit = async (orderQuantity) => {
    if (!currentRound || !gameId || !playerId) {
      return;
    }

    try {
      setErrorMessage("");
      const data = await submitOrder({ gameId, playerId, orderQuantity });

      setRoundPhase(data.roundPhase || roundPhase);
      setIsRoundSubmitted(true);
      setStatusMessage("Order submitted. Waiting for round end.");
    } catch (error) {
      setErrorMessage(error.message);
    }
  };

  const handleNextRound = () => {
    setIsRoundSubmitted(false);
    setLastRoundResult(null);
    setStatusMessage("");
  };

  const handleStartRound = async () => {
    try {
      setErrorMessage("");
      const data = await startRound({ gameId, adminToken });
      setCurrentRound(data.currentRound);
      setRoundPhase(data.roundPhase);
      setHasUnsavedDistributionChanges(false);
      setStatusMessage(`Round ${data.currentRound.id} started.`);
      setIsRoundSubmitted(false);
      setLastRoundResult(null);
    } catch (error) {
      setErrorMessage(error.message);
    }
  };

  const handleEndRound = async () => {
    try {
      setErrorMessage("");
      const data = await endRound({ gameId, adminToken });
      setCurrentRound(data.nextRound);
      setRoundPhase(data.roundPhase);
      if (data.distribution) {
        setDistributionMin(String(data.distribution.min));
        setDistributionMax(String(data.distribution.max));
        setHasUnsavedDistributionChanges(false);
      }
      setLeaderboardRows(data.leaderboard || []);
      setStatusMessage(
        data.finished
          ? "Final round ended. Leaderboard is ready."
          : `Round ended. Next round is ${data.nextRound?.id}.`
      );
      setIsRoundSubmitted(false);
      await syncGameState();
    } catch (error) {
      setErrorMessage(error.message);
    }
  };

  const handleDistributionSave = async () => {
    try {
      setErrorMessage("");

      const parsedMin = Number(distributionMin);
      const parsedMax = Number(distributionMax);

      if (!Number.isFinite(parsedMin) || !Number.isFinite(parsedMax)) {
        setErrorMessage("Uniform min and max must be valid numbers.");
        return;
      }

      if (parsedMin < 0 || parsedMax < 0) {
        setErrorMessage("none of the variables can be less than 0");
        return;
      }

      if (parsedMin >= parsedMax) {
        setErrorMessage("min cannot be higher than max");
        return;
      }

      const data = await setDistribution({
        gameId,
        adminToken,
        min: parsedMin,
        max: parsedMax
      });

      setDistributionMin(String(data.distribution.min));
      setDistributionMax(String(data.distribution.max));
      setHasUnsavedDistributionChanges(false);
      setCurrentRound((prev) => {
        if (!prev) {
          return prev;
        }

        return {
          ...prev,
          distribution: data.distribution
        };
      });
      setStatusMessage(
        `Uniform distribution updated to [${data.distribution.min}, ${data.distribution.max}].`
      );
    } catch (error) {
      setErrorMessage(error.message);
    }
  };

  const handleLeaderboardToggle = async () => {
    const nextVisible = !showLeaderboard;
    setShowLeaderboard(nextVisible);

    if (nextVisible) {
      try {
        setErrorMessage("");
        await refreshLeaderboard(gameId);
      } catch (error) {
        setErrorMessage(error.message);
      }
    }
  };

  useEffect(() => {
    if (!gameId || !playerId) {
      return undefined;
    }

    const syncStateSafely = async () => {
      try {
        await syncGameState();
      } catch (_error) {
        // Polling fallback stays quiet on transient issues.
      }
    };

    syncStateSafely();
    const intervalId = setInterval(syncStateSafely, 5000);

    return () => {
      clearInterval(intervalId);
    };
  }, [gameId, playerId, syncGameState]);

  useEffect(() => {
    if (!gameId || !playerId) {
      return undefined;
    }

    const ws = new WebSocket(`${WS_BASE_URL}/ws`);

    ws.addEventListener("open", () => {
      ws.send(
        JSON.stringify({
          type: "subscribe",
          gameId,
          playerId
        })
      );
    });

    ws.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(event.data);

        if (message?.type === "game_event") {
          syncGameState().catch(() => {
            // Polling will recover eventual consistency.
          });
        }
      } catch (_error) {
        // Ignore malformed websocket messages.
      }
    });

    return () => {
      ws.close();
    };
  }, [WS_BASE_URL, gameId, playerId, syncGameState]);

  if (!nickname) {
    return (
      <main className="page auth-page">
        <section className="card auth-card">
          <p className="eyebrow">EverChic Fashions</p>
          <h1>Hawaiian Shirt Newsvendor Game</h1>
          <p className="muted">
            Enter a nickname to join an active game. Use admin mode to create one.
          </p>
          <form onSubmit={handleNicknameSubmit} className="order-form">
            <label htmlFor="nickname">Nickname</label>
            <input
              id="nickname"
              type="text"
              value={nicknameInput}
              onChange={(event) => setNicknameInput(event.target.value)}
              placeholder="ex: ops_master"
              maxLength={20}
            />

            <label className="checkbox-line" htmlFor="adminMode">
              <input
                id="adminMode"
                type="checkbox"
                checked={adminMode}
                onChange={(event) => setAdminMode(event.target.checked)}
              />
              Create active game as admin
            </label>

            {adminMode ? (
              <>
                <label htmlFor="adminKey">Admin key</label>
                <input
                  id="adminKey"
                  type="password"
                  value={adminKey}
                  onChange={(event) => setAdminKey(event.target.value)}
                  placeholder="admin key"
                />
              </>
            ) : null}

            {errorMessage ? <p className="error-text">{errorMessage}</p> : null}
            <button type="submit">Start Game</button>
          </form>
        </section>
      </main>
    );
  }

  if (isGameFinished) {
    return (
      <main className="page">
        <header className="hero">
          <p className="eyebrow">Final Result</p>
          <h1>{nickname}, season is complete.</h1>
          <p className="total-profit">Total Profit: ${cumulativeProfit.toLocaleString("en-US")}</p>
        </header>

        <button type="button" onClick={handleLeaderboardToggle}>
          {showLeaderboard ? "Hide Leaderboard" : "Show Leaderboard"}
        </button>

        {showLeaderboard ? <Leaderboard rows={leaderboardRows} title="Leaderboard" /> : null}

        <section className="card history-card">
          <h3>Round Summary</h3>
          <table className="leaderboard-table">
            <thead>
              <tr>
                <th>Round</th>
                <th>Order</th>
                <th>Demand</th>
                <th>Profit</th>
              </tr>
            </thead>
            <tbody>
              {history.map((row) => (
                <tr key={row.round}>
                  <td>{row.round}</td>
                  <td>{row.orderQuantity}</td>
                  <td>{row.realizedDemand}</td>
                  <td>${row.profit.toLocaleString("en-US")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </main>
    );
  }

  return (
    <main className="page">
      <header className="hero">
        <p className="eyebrow">EverChic Fashions</p>
        <h1>Welcome, {nickname}</h1>
        <p className="muted">
          Decide order quantities and submit. Server computes demand and profit.
        </p>
      </header>

      {isAdmin ? (
        <section className="card admin-controls">
          <h3>Admin Controls</h3>
          <p className="muted">Round phase: {roundPhase}</p>
          <div className="distribution-controls">
            <label htmlFor="dist-min">Uniform min</label>
            <input
              id="dist-min"
              type="number"
              value={distributionMin}
              onChange={(event) => {
                setDistributionMin(event.target.value);
                setHasUnsavedDistributionChanges(true);
              }}
              disabled={roundPhase === "active"}
            />
            <label htmlFor="dist-max">Uniform max</label>
            <input
              id="dist-max"
              type="number"
              value={distributionMax}
              onChange={(event) => {
                setDistributionMax(event.target.value);
                setHasUnsavedDistributionChanges(true);
              }}
              disabled={roundPhase === "active"}
            />
            <button
              type="button"
              onClick={handleDistributionSave}
              disabled={roundPhase === "active"}
            >
              Save Distribution
            </button>
          </div>
          <div className="admin-buttons">
            <button
              type="button"
              onClick={handleStartRound}
              disabled={!currentRound || roundPhase === "active"}
            >
              Start Round
            </button>
            <button
              type="button"
              onClick={handleEndRound}
              disabled={!currentRound || roundPhase !== "active"}
            >
              End Round
            </button>
          </div>
        </section>
      ) : null}

      {currentRound ? (
        <>
          <ProgressBar currentRound={currentRound.id} totalRounds={totalRounds} />
          <RoundInfo round={currentRound} totalRounds={totalRounds} />
          <OrderForm
            onSubmit={handleOrderSubmit}
            disabled={isRoundSubmitted || roundPhase !== "active"}
          />
        </>
      ) : null}

      {isRoundSubmitted && roundPhase === "active" ? (
        <section className="card">
          <p className="status-line">Order submitted. Waiting for round to end...</p>
        </section>
      ) : null}

      {roundPhase === "pending" ? <RoundResult result={lastRoundResult} /> : null}

      {statusMessage ? <p className="status-line">{statusMessage}</p> : null}
      {errorMessage ? <p className="error-text">{errorMessage}</p> : null}

      {lastRoundResult && roundPhase === "pending" ? (
        <button type="button" className="next-round-button" onClick={handleNextRound}>
          Continue
        </button>
      ) : null}

      <button type="button" onClick={handleLeaderboardToggle}>
        {showLeaderboard ? "Hide Leaderboard" : "Show Leaderboard"}
      </button>

      {showLeaderboard ? <Leaderboard rows={leaderboardRows} title="Leaderboard" /> : null}

      <section className="card sticky-score">
        <p>Current cumulative profit</p>
        <strong>${cumulativeProfit.toLocaleString("en-US")}</strong>
      </section>
    </main>
  );
}

export default App;
