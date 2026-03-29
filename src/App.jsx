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
  setPrices,
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
  const [distributionType, setDistributionType] = useState("uniform");
  const [distributionMin, setDistributionMin] = useState("80");
  const [distributionMax, setDistributionMax] = useState("120");
  const [distributionMean, setDistributionMean] = useState("100");
  const [distributionStdDev, setDistributionStdDev] = useState("10");
  const [hasUnsavedDistributionChanges, setHasUnsavedDistributionChanges] = useState(false);
  const [wholesaleCost, setWholesaleCost] = useState("10");
  const [retailPrice, setRetailPrice] = useState("40");
  const [salvagePrice, setSalvagePrice] = useState("5");
  const [hasUnsavedPriceChanges, setHasUnsavedPriceChanges] = useState(false);
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
            setDistributionType(data.distribution?.type ?? "uniform");
            setDistributionMin(String(data.distribution?.min ?? 80));
            setDistributionMax(String(data.distribution?.max ?? 120));
            setDistributionMean(String(data.distribution?.mean ?? 100));
            setDistributionStdDev(String(data.distribution?.stdDev ?? 10));
            setHasUnsavedDistributionChanges(false);
            setWholesaleCost(String(data.prices?.wholesaleCost ?? 10));
            setRetailPrice(String(data.prices?.retailPrice ?? 40));
            setSalvagePrice(String(data.prices?.salvagePrice ?? 5));
            setHasUnsavedPriceChanges(false);
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
        setDistributionType(data.distribution.type ?? "uniform");
        setDistributionMin(String(data.distribution.min));
        setDistributionMax(String(data.distribution.max));
        setDistributionMean(String(data.distribution.mean ?? 100));
        setDistributionStdDev(String(data.distribution?.stdDev ?? 10));
        setHasUnsavedDistributionChanges(false);
      }
    }

    if (data.prices) {
      const shouldPreservePriceDraft =
        isAdmin &&
        hasUnsavedPriceChanges &&
        (data.roundPhase || "pending") === "pending";

      if (!shouldPreservePriceDraft) {
        setWholesaleCost(String(data.prices.wholesaleCost));
        setRetailPrice(String(data.prices.retailPrice));
        setSalvagePrice(String(data.prices.salvagePrice));
        setHasUnsavedPriceChanges(false);
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
    hasUnsavedDistributionChanges,
    hasUnsavedPriceChanges
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
      setDistributionType(data.distribution?.type ?? "uniform");
      setDistributionMin(String(data.distribution?.min ?? 80));
      setDistributionMax(String(data.distribution?.max ?? 120));
      setDistributionMean(String(data.distribution?.mean ?? 100));
      setDistributionStdDev(String(data.distribution?.stdDev ?? 10));
      setHasUnsavedDistributionChanges(false);
      setWholesaleCost(String(data.prices?.wholesaleCost ?? 10));
      setRetailPrice(String(data.prices?.retailPrice ?? 40));
      setSalvagePrice(String(data.prices?.salvagePrice ?? 5));
      setHasUnsavedPriceChanges(false);
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
        setDistributionType(data.distribution.type ?? "uniform");
        setDistributionMin(String(data.distribution.min));
        setDistributionMax(String(data.distribution.max));
        setDistributionMean(String(data.distribution.mean ?? 100));
        setDistributionStdDev(String(data.distribution?.stdDev ?? 10));
        setHasUnsavedDistributionChanges(false);
      }
      if (data.prices) {
        setWholesaleCost(String(data.prices.wholesaleCost));
        setRetailPrice(String(data.prices.retailPrice));
        setSalvagePrice(String(data.prices.salvagePrice));
        setHasUnsavedPriceChanges(false);
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

  const handleParametersSave = async () => {
    try {
      setErrorMessage("");

      // --- Distribution validation ---
      let distPayload = { gameId, adminToken, type: distributionType };

      if (distributionType === "normal") {
        const parsedMean = Number(distributionMean);
        const parsedStdDev = Number(distributionStdDev);

        if (!Number.isFinite(parsedMean) || !Number.isFinite(parsedStdDev)) {
          setErrorMessage("Mean and std. deviation must be valid numbers.");
          return;
        }

        if (parsedMean <= 0) {
          setErrorMessage("Mean must be greater than 0.");
          return;
        }

        if (parsedStdDev < 0) {
          setErrorMessage("Std. deviation cannot be negative.");
          return;
        }

        distPayload = { ...distPayload, mean: parsedMean, stdDev: parsedStdDev };
      } else {
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

        distPayload = { ...distPayload, min: parsedMin, max: parsedMax };
      }

      // --- Prices validation ---
      const parsedWholesale = Number(wholesaleCost);
      const parsedRetail = Number(retailPrice);
      const parsedSalvage = Number(salvagePrice);

      if (!Number.isFinite(parsedWholesale) || !Number.isFinite(parsedRetail) || !Number.isFinite(parsedSalvage)) {
        setErrorMessage("All prices must be valid numbers.");
        return;
      }

      if (parsedWholesale <= 0 || parsedRetail <= 0) {
        setErrorMessage("Wholesale cost and retail price must be greater than 0.");
        return;
      }

      if (parsedSalvage < 0) {
        setErrorMessage("Salvage price cannot be negative.");
        return;
      }

      if (parsedSalvage >= parsedWholesale) {
        setErrorMessage("Salvage price must be less than wholesale cost.");
        return;
      }

      if (parsedWholesale >= parsedRetail) {
        setErrorMessage("Wholesale cost must be less than retail price.");
        return;
      }

      // --- Save both ---
      const distData = await setDistribution(distPayload);
      const pricesData = await setPrices({
        gameId,
        adminToken,
        wholesaleCost: parsedWholesale,
        retailPrice: parsedRetail,
        salvagePrice: parsedSalvage
      });

      setDistributionType(distData.distribution.type ?? "uniform");
      setDistributionMin(String(distData.distribution.min));
      setDistributionMax(String(distData.distribution.max));
      setDistributionMean(String(distData.distribution.mean ?? 100));
      setDistributionStdDev(String(distData.distribution?.stdDev ?? 10));
      setHasUnsavedDistributionChanges(false);
      setCurrentRound((prev) => {
        if (!prev) return prev;
        return { ...prev, distribution: distData.distribution };
      });

      setWholesaleCost(String(pricesData.prices.wholesaleCost));
      setRetailPrice(String(pricesData.prices.retailPrice));
      setSalvagePrice(String(pricesData.prices.salvagePrice));
      setHasUnsavedPriceChanges(false);

      const distDesc =
        distData.distribution.type === "normal"
          ? `Normal (μ=${distData.distribution.mean}, σ=${distData.distribution.stdDev})`
          : `Uniform [${distData.distribution.min}, ${distData.distribution.max}]`;

      setStatusMessage(
        `Parameters updated — Distribution: ${distDesc} | Retail $${pricesData.prices.retailPrice}, Wholesale $${pricesData.prices.wholesaleCost}, Salvage $${pricesData.prices.salvagePrice}.`
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
    const intervalId = setInterval(syncStateSafely, 150000);

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
            <label htmlFor="dist-type">Distribution type</label>
            <select
              id="dist-type"
              value={distributionType}
              onChange={(event) => {
                setDistributionType(event.target.value);
                setHasUnsavedDistributionChanges(true);
              }}
              disabled={roundPhase === "active"}
            >
              <option value="uniform">Uniform</option>
              <option value="normal">Normal</option>
            </select>

            {distributionType === "uniform" ? (
              <>
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
              </>
            ) : (
              <>
                <label htmlFor="dist-mean">Mean</label>
                <input
                  id="dist-mean"
                  type="number"
                  value={distributionMean}
                  onChange={(event) => {
                    setDistributionMean(event.target.value);
                    setHasUnsavedDistributionChanges(true);
                  }}
                  disabled={roundPhase === "active"}
                />
                <label htmlFor="dist-stddev">Std. Deviation</label>
                <input
                  id="dist-stddev"
                  type="number"
                  value={distributionStdDev}
                  onChange={(event) => {
                    setDistributionStdDev(event.target.value);
                    setHasUnsavedDistributionChanges(true);
                  }}
                  disabled={roundPhase === "active"}
                />
              </>
            )}

          </div>
          <div className="price-controls">
            <label htmlFor="price-wholesale">Wholesale Cost</label>
            <input
              id="price-wholesale"
              type="number"
              value={wholesaleCost}
              onChange={(event) => {
                setWholesaleCost(event.target.value);
                setHasUnsavedPriceChanges(true);
              }}
              disabled={roundPhase === "active"}
            />
            <label htmlFor="price-retail">Retail Price</label>
            <input
              id="price-retail"
              type="number"
              value={retailPrice}
              onChange={(event) => {
                setRetailPrice(event.target.value);
                setHasUnsavedPriceChanges(true);
              }}
              disabled={roundPhase === "active"}
            />
            <label htmlFor="price-salvage">Salvage Price</label>
            <input
              id="price-salvage"
              type="number"
              value={salvagePrice}
              onChange={(event) => {
                setSalvagePrice(event.target.value);
                setHasUnsavedPriceChanges(true);
              }}
              disabled={roundPhase === "active"}
            />
          </div>
          <button
            type="button"
            onClick={handleParametersSave}
            disabled={roundPhase === "active"}
          >
            Set Parameters
          </button>
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
          <RoundInfo
            round={currentRound}
            totalRounds={totalRounds}
            prices={{
              wholesaleCost: Number(wholesaleCost),
              retailPrice: Number(retailPrice),
              salvagePrice: Number(salvagePrice)
            }}
          />
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
