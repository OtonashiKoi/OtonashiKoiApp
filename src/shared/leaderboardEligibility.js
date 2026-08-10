"use strict";

const { getMongoDb } = require("../adapters/mongo/createMongoClient");

const LEADERBOARD_EXCLUSION_QUERY = {
  $or: [
    { excludeFromLeaderboards: true },
    { isTestAccount: true },
  ],
};
const CACHE_TTL_MS = 5_000;
let cachedIds = null;
let cachedAt = 0;

function isLeaderboardExcluded(progress) {
  return Boolean(progress?.excludeFromLeaderboards || progress?.isTestAccount);
}

async function getLeaderboardExcludedPlayerIds() {
  if (cachedIds && Date.now() - cachedAt < CACHE_TTL_MS) return new Set(cachedIds);
  const db = await getMongoDb();
  const rows = await db.collection("progress")
    .find(LEADERBOARD_EXCLUSION_QUERY, { projection: { _id: 0, playerId: 1 } })
    .toArray();
  cachedIds = new Set(rows.map((row) => String(row.playerId || "")).filter(Boolean));
  cachedAt = Date.now();
  return new Set(cachedIds);
}

function invalidateLeaderboardExclusionCache() {
  cachedIds = null;
  cachedAt = 0;
}

function filterDamageMapForLeaderboard(damageMap, excludedIds) {
  if (!damageMap || typeof damageMap !== "object") return {};
  if (!(excludedIds instanceof Set) || excludedIds.size === 0) return damageMap;
  return Object.fromEntries(
    Object.entries(damageMap).filter(([playerId]) => !excludedIds.has(String(playerId)))
  );
}

module.exports = {
  LEADERBOARD_EXCLUSION_QUERY,
  isLeaderboardExcluded,
  getLeaderboardExcludedPlayerIds,
  invalidateLeaderboardExclusionCache,
  filterDamageMapForLeaderboard,
};
