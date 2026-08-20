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

// 世界王的區域光環可在提供者離開單場戰鬥後短暫支援隊友，但不能跨王輪空領貢獻。
// participantIds 未提供時維持舊資料相容；明確提供陣列時，只保留本輪實際進過場的玩家。
function filterDamageMapForParticipants(damageMap, participantIds) {
  if (!damageMap || typeof damageMap !== "object") return {};
  if (!Array.isArray(participantIds)) return damageMap;
  const participants = new Set(participantIds.map((id) => String(id || "")).filter(Boolean));
  return Object.fromEntries(
    Object.entries(damageMap).filter(([playerId]) => participants.has(String(playerId)))
  );
}

module.exports = {
  LEADERBOARD_EXCLUSION_QUERY,
  isLeaderboardExcluded,
  getLeaderboardExcludedPlayerIds,
  invalidateLeaderboardExclusionCache,
  filterDamageMapForLeaderboard,
  filterDamageMapForParticipants,
};
