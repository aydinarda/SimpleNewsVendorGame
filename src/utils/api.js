const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Request failed");
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
