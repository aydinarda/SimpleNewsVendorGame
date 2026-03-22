import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const hasSupabaseConfig = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

const supabase = hasSupabaseConfig
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })
  : null;

async function runQuery(label, queryFactory) {
  if (!supabase) {
    return;
  }

  try {
    const { error } = await queryFactory();

    if (error) {
      console.error(`[db] ${label} failed:`, error.message);
    }
  } catch (error) {
    console.error(`[db] ${label} threw:`, error.message);
  }
}

export function isDbEnabled() {
  return Boolean(supabase);
}

export async function recordGameCreated({ gameId, adminPlayerId, createdAt }) {
  await runQuery("recordGameCreated", () =>
    supabase.from("games").upsert(
      {
        game_id: gameId,
        admin_player_id: adminPlayerId,
        created_at: createdAt
      },
      { onConflict: "game_id" }
    )
  );
}

export async function recordPlayerJoined({ gameId, playerId, nickname, isAdmin, joinedAt }) {
  await runQuery("recordPlayerJoined", () =>
    supabase.from("players").upsert(
      {
        game_id: gameId,
        player_id: playerId,
        nickname,
        is_admin: isAdmin,
        joined_at: joinedAt
      },
      { onConflict: "game_id,player_id" }
    )
  );
}

export async function recordDistributionUpdated({ gameId, roundNo, distribution, updatedAt }) {
  await runQuery("recordDistributionUpdated", () =>
    supabase.from("session_events").insert({
      game_id: gameId,
      event_type: "distribution_updated",
      payload_json: {
        roundNo,
        distribution,
        updatedAt
      },
      created_at: updatedAt
    })
  );
}

export async function recordRoundStarted({
  gameId,
  roundId,
  roundNo,
  distribution,
  realizedDemand,
  startedAt
}) {
  await runQuery("recordRoundStarted", () =>
    supabase.from("rounds").upsert(
      {
        game_id: gameId,
        round_id: String(roundId),
        round_no: roundNo,
        dist_min: distribution.min,
        dist_max: distribution.max,
        realized_demand: realizedDemand,
        started_at: startedAt
      },
      { onConflict: "game_id,round_id" }
    )
  );
}

export async function recordOrderSubmitted({
  gameId,
  roundId,
  playerId,
  nickname,
  orderQuantity,
  submittedAt
}) {
  await runQuery("recordOrderSubmitted", () =>
    supabase.from("orders").insert({
      game_id: gameId,
      round_id: String(roundId),
      player_id: playerId,
      nickname,
      order_qty: orderQuantity,
      submitted_at: submittedAt
    })
  );
}

export async function recordRoundEnded({ gameId, roundId, realizedDemand, endedAt, results }) {
  await runQuery("recordRoundEnded.round", () =>
    supabase
      .from("rounds")
      .update({
        realized_demand: realizedDemand,
        ended_at: endedAt
      })
      .eq("game_id", gameId)
      .eq("round_id", String(roundId))
  );

  for (const result of results) {
    await runQuery("recordRoundEnded.order", () =>
      supabase
        .from("orders")
        .update({
          sold: result.sold,
          leftover: result.leftover,
          stockout: result.stockout,
          profit: result.profit
        })
        .eq("game_id", gameId)
        .eq("round_id", String(roundId))
        .eq("player_id", result.playerId)
    );
  }

  await runQuery("recordRoundEnded.event", () =>
    supabase.from("session_events").insert({
      game_id: gameId,
      event_type: "round_ended",
      payload_json: {
        roundId,
        realizedDemand,
        playerCount: results.length
      },
      created_at: endedAt
    })
  );
}