/**
 * Frontend Integration Tests for Duplicate Username Validation
 * These tests verify that the frontend properly handles and displays
 * duplicate username errors returned by the backend.
 * 
 * Run with server: npm run server
 * Then in another terminal: node src/integration.test.js
 */

import assert from "node:assert/strict";

const LOCAL_API_URL = "http://localhost:4000";
let testGameId = null;
let testAdminToken = null;

/**
 * Helper: Initialize a new test game
 */
async function initializeTestGame(adminName) {
  const response = await fetch(`${LOCAL_API_URL}/start-game`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nickname: adminName,
      adminKey: "admin123"
    })
  });

  if (response.status !== 200) {
    throw new Error(`Failed to initialize game: ${response.status}`);
  }

  const data = await response.json();
  testGameId = data.gameId;
  testAdminToken = data.adminToken;
  return data;
}

/**
 * Test 1: Cannot join with duplicate username (admin duplicate)
 */
async function testAdminDuplicateRejection() {
  console.log("\n🧪 Test 1: Admin duplicate username rejected");

  try {
    await initializeTestGame("TestAdmin1");

    // Try to join with admin's name
    const duplicateResponse = await fetch(`${LOCAL_API_URL}/start-game`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nickname: "TestAdmin1",
        gameId: testGameId
      })
    });

    assert.equal(duplicateResponse.status, 409, "Should return 409 Conflict for duplicate name");
    const errorData = await duplicateResponse.json();
    assert.equal(errorData.error, "this username is taken", "Error message should indicate username is taken");

    console.log("✅ PASS: Duplicate admin username rejected with 409");
    return true;
  } catch (error) {
    console.error("❌ FAIL:", error.message);
    return false;
  }
}

/**
 * Test 2: Case-insensitive duplicate check
 */
async function testCaseInsensitiveDuplicate() {
  console.log("\n🧪 Test 2: Case-insensitive duplicate detection");

  try {
    // Fresh game for this test
    await initializeTestGame("MixedCaseAdmin");

    // Try lowercase
    const lowercaseResponse = await fetch(`${LOCAL_API_URL}/start-game`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nickname: "mixedcaseadmin",
        gameId: testGameId
      })
    });

    assert.equal(lowercaseResponse.status, 409, "Lowercase variant should be rejected");
    const lowercaseError = await lowercaseResponse.json();
    assert.equal(lowercaseError.error, "this username is taken");

    // Try uppercase
    const uppercaseResponse = await fetch(`${LOCAL_API_URL}/start-game`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nickname: "MIXEDCASEADMIN",
        gameId: testGameId
      })
    });

    assert.equal(uppercaseResponse.status, 409, "Uppercase variant should be rejected");
    const uppercaseError = await uppercaseResponse.json();
    assert.equal(uppercaseError.error, "this username is taken");

    console.log("✅ PASS: Case-insensitive duplicate detection works");
    return true;
  } catch (error) {
    console.error("❌ FAIL:", error.message);
    return false;
  }
}

/**
 * Test 3: Two users cannot share username
 */
async function testUserDuplicateRejection() {
  console.log("\n🧪 Test 3: Two users cannot have same username");

  try {
    // Fresh game
    await initializeTestGame("AdminForTest3");

    // First user joins
    const user1Response = await fetch(`${LOCAL_API_URL}/start-game`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nickname: "UniquePlayer",
        gameId: testGameId
      })
    });

    assert.equal(user1Response.status, 200, "First user should join");
    const user1Data = await user1Response.json();
    assert.equal(user1Data.nickname, "UniquePlayer");

    // Second user tries same name
    const user2Response = await fetch(`${LOCAL_API_URL}/start-game`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nickname: "UniquePlayer",
        gameId: testGameId
      })
    });

    assert.equal(user2Response.status, 409, "Second user with same name rejected");
    const errorData = await user2Response.json();
    assert.equal(errorData.error, "this username is taken");

    console.log("✅ PASS: Two users cannot share username");
    return true;
  } catch (error) {
    console.error("❌ FAIL:", error.message);
    return false;
  }
}

/**
 * Test 4: Multiple unique users succeed
 */
async function testMultipleUniqueUsers() {
  console.log("\n🧪 Test 4: Multiple users with unique names join successfully");

  try {
    // Fresh game
    await initializeTestGame("AdminTest4");

    const userNames = ["Player1", "Player2", "Player3"];

    for (const name of userNames) {
      const response = await fetch(`${LOCAL_API_URL}/start-game`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nickname: name,
          gameId: testGameId
        })
      });

      assert.equal(response.status, 200, `${name} should join successfully`);
      const data = await response.json();
      assert.equal(data.nickname, name);
    }

    // Verify leaderboard has all players
    const leaderboardResponse = await fetch(`${LOCAL_API_URL}/leaderboard?gameId=${testGameId}`);
    assert.equal(leaderboardResponse.status, 200);
    const leaderboard = await leaderboardResponse.json();
    assert.ok(Array.isArray(leaderboard.leaderboard));
    assert.equal(leaderboard.leaderboard.length, 4); // admin + 3 users

    const nicknames = leaderboard.leaderboard.map(p => p.nickname);
    assert.ok(nicknames.includes("AdminTest4"));
    assert.ok(nicknames.includes("Player1"));
    assert.ok(nicknames.includes("Player2"));
    assert.ok(nicknames.includes("Player3"));

    console.log("✅ PASS: Multiple unique users joined successfully");
    return true;
  } catch (error) {
    console.error("❌ FAIL:", error.message);
    return false;
  }
}

/**
 * Test 5: Duplicate rejected during active round
 */
async function testDuplicateDuringActiveRound() {
  console.log("\n🧪 Test 5: Duplicate rejected during active round");

  try {
    // Fresh game
    const adminData = await initializeTestGame("AdminRoundTest");

    // Add a regular user
    const userResponse = await fetch(`${LOCAL_API_URL}/start-game`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nickname: "UserDuringRound",
        gameId: testGameId
      })
    });

    assert.equal(userResponse.status, 200);

    // Start round
    const startRoundResponse = await fetch(`${LOCAL_API_URL}/start-round`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        gameId: testGameId,
        adminToken: testAdminToken
      })
    });

    assert.equal(startRoundResponse.status, 200, "Round should start");
    const roundData = await startRoundResponse.json();
    assert.equal(roundData.roundPhase, "active");

    // Try to join with duplicate during active round
    const duplicateResponse = await fetch(`${LOCAL_API_URL}/start-game`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nickname: "UserDuringRound",
        gameId: testGameId
      })
    });

    assert.equal(duplicateResponse.status, 409, "Duplicate should be rejected during active round");
    const errorData = await duplicateResponse.json();
    assert.equal(errorData.error, "this username is taken");

    console.log("✅ PASS: Duplicate rejected during active round");
    return true;
  } catch (error) {
    console.error("❌ FAIL:", error.message);
    return false;
  }
}

/**
 * Test 6: Admin and user same name prevented
 */
async function testAdminUserSameName() {
  console.log("\n🧪 Test 6: Admin and user cannot share username");

  try {
    const sharedName = "SharedName";
    await initializeTestGame(sharedName);

    // User tries to use admin's name
    const userResponse = await fetch(`${LOCAL_API_URL}/start-game`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nickname: sharedName,
        gameId: testGameId
      })
    });

    assert.equal(userResponse.status, 409, "User cannot use admin's name");
    const errorData = await userResponse.json();
    assert.equal(errorData.error, "this username is taken");

    console.log("✅ PASS: Admin and user cannot share username");
    return true;
  } catch (error) {
    console.error("❌ FAIL:", error.message);
    return false;
  }
}

/**
 * Main test runner
 */
async function runAllTests() {
  console.log("=".repeat(70));
  console.log("🚀 FRONTEND INTEGRATION TESTS: Duplicate Username Validation");
  console.log("=".repeat(70));

  // Check server connectivity
  try {
    const healthResponse = await fetch(`${LOCAL_API_URL}/health`);
    if (healthResponse.status !== 200) {
      throw new Error("Health check failed");
    }
  } catch (error) {
    console.error("\n❌ Cannot connect to server on port 4000");
    console.error("   Make sure to run: npm run server");
    process.exit(1);
  }

  const results = [];

  results.push(await testAdminDuplicateRejection());
  results.push(await testCaseInsensitiveDuplicate());
  results.push(await testUserDuplicateRejection());
  results.push(await testMultipleUniqueUsers());
  results.push(await testDuplicateDuringActiveRound());
  results.push(await testAdminUserSameName());

  console.log("\n" + "=".repeat(70));
  const passed = results.filter(r => r).length;
  const total = results.length;
  const emoji = passed === total ? "✅" : "⚠️";
  console.log(`${emoji} Results: ${passed}/${total} tests passed`);
  console.log("=".repeat(70));

  return passed === total;
}

// Run tests
runAllTests().then(success => {
  process.exit(success ? 0 : 1);
});
