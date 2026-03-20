const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  let payload;
  try {
    payload = await response.json();
  } catch (parseError) {
    const text = await response.text();
    throw new Error(`Server error: ${response.status} ${response.statusText}. ${text.substring(0, 100)}`);
  }

  if (!response.ok) {
    throw new Error(payload.error || `Request failed with status ${response.status}`);
  }

  return payload;
}

export function startGame({ nickname, adminKey }) {
  return request("/start-game", {
    method: "POST",
    body: JSON.stringify({ nickname, adminKey })
  });
}

export function submitOrder({ gameId, playerId, orderQuantity }) {
  return request("/submit-order", {
    method: "POST",
    body: JSON.stringify({ gameId, playerId, orderQuantity })
  });
}

export function fetchLeaderboard({ gameId }) {
  const query = new URLSearchParams({ gameId });
  return request(`/leaderboard?${query.toString()}`);
}

export function fetchGameState({ gameId, playerId }) {
  const query = new URLSearchParams({ gameId, playerId });
  return request(`/game-state?${query.toString()}`);
}

export function startRound({ gameId, adminToken }) {
  return request("/start-round", {
    method: "POST",
    body: JSON.stringify({ gameId, adminToken })
  });
}

export function endRound({ gameId, adminToken }) {
  return request("/end-round", {
    method: "POST",
    body: JSON.stringify({ gameId, adminToken })
  });
}

export function setDistribution({ gameId, adminToken, min, max }) {
  return request("/set-distribution", {
    method: "POST",
    body: JSON.stringify({ gameId, adminToken, min, max })
  });
}
