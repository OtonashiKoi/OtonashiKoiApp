"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { slimInventoryEntry } = require("../../src/shared/inventoryStorage");
const { isTitle, isCollectible, isSeasonPersistentItem } = require("../../src/services/admin/seasonResetPolicy");
const { loadPersistentItemIds } = require("../../src/services/admin/seasonResetService");
const MUTABLE_COLLECTIONS = new Set([
  "progress", "wallets", "weeklyQuestProgress", "weeklyQuestProgressHistory", "checkins", "checkinHistory",
  "auctions", "idlePlayerStates", "farmFatigue", "uniqueItemGrants", "passState", "kdaSeasonStats",
  "worldBossState", "pkArenaState", "towerSessions", "serverBuffs", "scAccumulator", "memberEventsState",
  "viewerState", "scBarHistory", "serverEventConfig", "monsterState", "monsters", "maintenanceState", "gameSeasonState",
  "seasonResetRuns", "seasonResetRunPlayers", "seasonResetLocks", "runtimeLeases", "authConfig",
]);
const PERMANENT_PROGRESS = ["playerId", "createdAt", "playerTier", "storyProgress", "petDex", "cardDex", "cardDexClaims", "donateCode", "compensationRefs", "idleRewardReversal", "isTestAccount", "excludeFromLeaderboards"];
function stable(value) {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
  return value;
}
function keptAssets(row, ids) {
  const equipped = [...Object.values(row.equipment || {})];
  const active = Number(row.activeCharacterSlot) || 1;
  for (const [slot, ch] of Object.entries(row.characterSlots || {})) {
    if (Number(slot) !== active) equipped.push(...Object.values(ch?.equipment || {}));
  }
  return [...(row.inventory || []), ...equipped].filter(item => item && (isTitle(item) || isCollectible(item) || isSeasonPersistentItem(item, ids)))
    .map(item => JSON.stringify(stable(slimInventoryEntry(item)))).sort();
}
async function digest(db, name) {
  const h = crypto.createHash("sha256");let count = 0;
  for await (const doc of db.collection(name).find({}).sort({ _id: 1 })) { h.update(JSON.stringify(stable(doc)));count++; }
  return { count, hash: h.digest("hex") };
}
async function capture(db) {
  const ids = await loadPersistentItemIds(db);
  const rows = await db.collection("progress").find({}).toArray();
  const players = Object.fromEntries(rows.map(row => [String(row.playerId), {
    fields: Object.fromEntries(PERMANENT_PROGRESS.map(k => [k, stable(row[k])])), assets: keptAssets(row, ids),
    slots: Object.keys(row.characterSlots || {}).sort(),
  }]));
  const wallets = Object.fromEntries((await db.collection("wallets").find({}).toArray()).map(row => {
    const { gold, seasonBackpackSlots, seasonKey, updatedAt, ...keep } = row;return [String(row.playerId), stable(keep)];
  }));
  const unaffected = {};
  for (const { name } of await db.listCollections({}, { nameOnly: true }).toArray()) {
    if (!MUTABLE_COLLECTIONS.has(name)) unaffected[name] = await digest(db, name);
  }
  return { players, wallets, unaffected };
}
async function verify(db, before) {
  const after = await capture(db);
  after.unaffected = Object.fromEntries(Object.keys(before.unaffected).map(name => [name, after.unaffected[name]]));
  // Assertions deliberately omit player document values from failure output.
  for (const key of ["players", "wallets", "unaffected"]) {
    assert.equal(JSON.stringify(stable(after[key])) === JSON.stringify(stable(before[key])), true, `Preservation mismatch: ${key}${key === "unaffected" ? " (" + Object.keys(before.unaffected).filter(name => JSON.stringify(before.unaffected[name]) !== JSON.stringify(after.unaffected[name])).join(",") + ")" : ""}`);
  }
  return { ok: true, players: Object.keys(before.players).length, wallets: Object.keys(before.wallets).length, unchangedCollections: Object.keys(before.unaffected).length,
    retainedItemInstances: Object.values(before.players).reduce((n, p) => n + p.assets.length, 0) };
}
module.exports = { capture, verify };
