// Debug test to check backend duplicate username behavior

async function test() {
  // Create admin
  console.log("1. Creating admin...");
  const admin = await fetch("http://localhost:4000/start-game", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nickname: "DebugAdmin",
      adminKey: "admin123"
    })
  });

  const adminData = await admin.json();
  console.log("Admin response:", adminData);
  const gameId = adminData.gameId;

  // Try duplicate
  console.log("\n2. Trying duplicate with same gameId...");
  const dup = await fetch("http://localhost:4000/start-game", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nickname: "DebugAdmin",
      gameId: gameId
    })
  });

  console.log("Status:", dup.status);
  const dupData = await dup.json();
  console.log("Duplicate response:", dupData);

  // Try without gameId (new game)
  console.log("\n3. Trying without gameId (should create new game)...");
  const noGameId = await fetch("http://localhost:4000/start-game", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nickname: "DebugAdmin",
      adminKey: "admin123"
    })
  });

  console.log("Status:", noGameId.status);
  const noGameIdData = await noGameId.json();
  console.log("Response:", noGameIdData);
}

test().catch(console.error);
