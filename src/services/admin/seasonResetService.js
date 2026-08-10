"use strict";

/**
 * 賽季重置唯一入口。
 * 後台、單人腳本、全體腳本都必須呼叫本 service，不得各自維護保留/清除清單。
 */
const { getMongoDb } = require("../../adapters/mongo/createMongoClient");
const {
  SEASON_RESET_RULES,
  isTitle,
  isCollectible,
  isSeasonPersistentItem,
  filterKeptInventory,
  buildProgressResetUpdate,
  removableUniqueGrantFilter,
  PERSISTENT_STORY_ITEM_IDS,
} = require("./seasonResetPolicy");

const playerRef = (id) => ({ $or: [{ discordId: id }, { playerId: id }] });

async function loadPersistentItemIds(db) {
  const rows = await db.collection("items")
    .find({ seasonPersistent: true }, { projection: { id: 1 } })
    .toArray();
  return new Set([...PERSISTENT_STORY_ITEM_IDS, ...rows.map((row) => String(row.id || "")).filter(Boolean)]);
}

function makeSeasonKey(now = new Date()) {
  return `s${now.toISOString().replace(/\D/g, "")}`;
}

async function currentPassSeasonKey(db) {
  const cfg = await db.collection("serverEventConfig").findOne({ _id: "default" });
  return String(cfg?.passSeasonKey || "s1");
}

async function buildSeasonResetBackup(discordId, { includeTransactions = true } = {}) {
  const id = String(discordId || "").trim();
  if (!id) throw new Error("discordId required");
  const db = await getMongoDb();
  const [progress, wallet, quests, checkins, auctions, transactions, idleState, farmFatigue, uniqueGrants, passState, kda] = await Promise.all([
    db.collection("progress").findOne({ playerId: id }),
    db.collection("wallets").findOne({ playerId: id }),
    db.collection("weeklyQuestProgress").find(playerRef(id)).toArray().catch(() => []),
    db.collection("checkins").find(playerRef(id)).toArray().catch(() => []),
    db.collection("auctions").find({ sellerId: id }).toArray().catch(() => []),
    includeTransactions ? db.collection("transactions").find({ playerId: id }).toArray().catch(() => []) : Promise.resolve(undefined),
    db.collection("idlePlayerStates").findOne({ playerId: id }).catch(() => null),
    db.collection("farmFatigue").find(playerRef(id)).toArray().catch(() => []),
    db.collection("uniqueItemGrants").find({ discordId: id }).toArray().catch(() => []),
    db.collection("passState").findOne({ _id: id }).catch(() => null),
    db.collection("kdaSeasonStats").findOne({ playerId: id }).catch(() => null),
  ]);
  return {
    kind: "season-reset-backup",
    discordId: id,
    at: new Date().toISOString(),
    progress, wallet, quests, checkins, auctions,
    ...(includeTransactions ? { transactions } : {}),
    idleState, farmFatigue, uniqueGrants, passState, kda,
  };
}

async function buildPlayerSummary(db, old, wallet, dryRun, persistentItemIds = PERSISTENT_STORY_ITEM_IDS) {
  const id = String(old.playerId);
  const inv = Array.isArray(old.inventory) ? old.inventory : [];
  const keptInv = filterKeptInventory(inv, persistentItemIds);
  const keptTitle = old.equipment?.title_eq && isTitle(old.equipment.title_eq) ? old.equipment.title_eq : null;
  const keptAnchor = old.equipment?.anchor && isSeasonPersistentItem(old.equipment.anchor, persistentItemIds) ? old.equipment.anchor : null;
  const [auctionCount, transactionCount, removableGrants] = await Promise.all([
    db.collection("auctions").countDocuments({ sellerId: id, status: { $in: ["active", "expired"] } }).catch(() => 0),
    db.collection("transactions").countDocuments({ playerId: id }).catch(() => 0),
    db.collection("uniqueItemGrants").countDocuments(removableUniqueGrantFilter(id, persistentItemIds)).catch(() => 0),
  ]);
  return {
    discordId: id,
    keptDiamond: Number(wallet?.diamond) || 0,
    keptPermanentBackpackSlots: Number(wallet?.bonusBackpackSlots) || 0,
    keptPlayerTier: old.playerTier || null,
    keptStoryProgress: Boolean(old.storyProgress),
    keptPetDexEntries: Object.keys(old.petDex || {}).length,
    keptCardDexEntries: Object.keys(old.cardDex || {}).length,
    keptTitlesInBag: keptInv.filter(isTitle).length,
    keptTitleEquipped: keptTitle ? 1 : 0,
    keptCollectibles: keptInv.filter(isCollectible).length,
    keptStoryAnchors: keptInv.filter((item) => isSeasonPersistentItem(item, persistentItemIds)).length + (keptAnchor ? 1 : 0),
    removedInventoryItems: inv.length - keptInv.length,
    removedAuctions: auctionCount,
    keptTransactions: transactionCount,
    removedUniqueGrants: removableGrants,
    goldBefore: Number(wallet?.gold) || 0,
    levelBefore: Number(old.level) || 1,
    dryRun,
  };
}

async function resetPlayerPass(db, id, nowIso) {
  const seasonKey = await currentPassSeasonKey(db);
  const r = await db.collection("passState").updateOne(
    { _id: id },
    { $set: { seasonKey, points: 0, unlocked: false, claimedFree: [], claimedPaid: [], updatedAt: nowIso } }
  );
  return r.matchedCount || 0;
}

async function archivePlayerSeasonHistory(db, id, { runId, seasonKey, nowIso }) {
  const specs = [
    ["weeklyQuestProgress", "weeklyQuestProgressHistory"],
    ["checkins", "checkinHistory"],
  ];
  const counts = {};
  for (const [sourceName, historyName] of specs) {
    const docs = await db.collection(sourceName).find(playerRef(id)).toArray();
    if (docs.length) {
      const ops = docs.map((doc) => {
        const originalId = String(doc._id);
        const { _id: _ignored, ...snapshot } = doc;
        return {
          updateOne: {
            filter: { archiveKey: `${runId}:${sourceName}:${originalId}` },
            update: { $setOnInsert: { archiveKey: `${runId}:${sourceName}:${originalId}`, originalId, runId, seasonKey, archivedAt: nowIso, snapshot } },
            upsert: true,
          },
        };
      });
      await db.collection(historyName).bulkWrite(ops, { ordered: false });
    }
    const removed = await db.collection(sourceName).deleteMany(playerRef(id));
    counts[sourceName] = { archived: docs.length, removed: removed.deletedCount || 0 };
  }
  return counts;
}

async function archivePlayerAuctions(db, id, { runId, seasonKey, nowIso }) {
  // 現行拍賣是固定價即買，沒有買家出價金 escrow；賣家的物品快照已在 auction.item。
  // 換季時保留整筆紀錄並封存該快照，不退回新季背包，避免舊季裝備穿越換季。
  const result = await db.collection("auctions").updateMany(
    { sellerId: id, status: { $in: ["active", "expired"] } },
    { $set: { status: "season_cancelled", seasonCancelledAt: nowIso, seasonCancelledByRunId: runId, archivedSeasonKey: seasonKey } }
  );
  return result.modifiedCount || 0;
}

async function seasonResetPlayer(discordId, {
  dryRun = false,
  keepLedger = false,
  resetPass = true,
  seasonKey = null,
  runId = null,
  persistentItemIds = null,
} = {}) {
  const id = String(discordId || "").trim();
  if (!id) throw new Error("discordId required");
  const db = await getMongoDb();
  const old = await db.collection("progress").findOne({ playerId: id });
  if (!old) throw new Error("找不到該玩家的進度資料");
  const wallet = await db.collection("wallets").findOne({ playerId: id });
  const persistentIds = persistentItemIds || await loadPersistentItemIds(db);
  const summary = await buildPlayerSummary(db, old, wallet, dryRun, persistentIds);
  if (dryRun) return { ...summary, rules: SEASON_RESET_RULES };

  const nowIso = new Date().toISOString();
  const key = String(seasonKey || old.seasonKey || "legacy");
  const executionId = String(runId || `single-${id}-${Date.now()}`);
  await db.collection("progress").updateOne({ _id: old._id }, buildProgressResetUpdate(old, nowIso, { seasonKey: key, persistentItemIds: persistentIds }));
  await db.collection("wallets").updateOne(
    { playerId: id },
    { $set: { gold: 0, seasonBackpackSlots: 0, seasonKey: key, updatedAt: nowIso } }
  );
  if (!keepLedger) {
    await archivePlayerSeasonHistory(db, id, { runId: executionId, seasonKey: key, nowIso });
  }
  const archivedAuctions = await archivePlayerAuctions(db, id, { runId: executionId, seasonKey: key, nowIso });
  await Promise.all([
    db.collection("idlePlayerStates").deleteMany({ playerId: id }),
    db.collection("farmFatigue").deleteMany(playerRef(id)),
    db.collection("uniqueItemGrants").deleteMany(removableUniqueGrantFilter(id, persistentIds)),
    db.collection("kdaSeasonStats").deleteMany({ playerId: id }),
    resetPass ? resetPlayerPass(db, id, nowIso) : Promise.resolve(0),
  ]);
  return { ...summary, archivedAuctions, dryRun: false, keptLedger: keepLedger, seasonKey: key, rules: SEASON_RESET_RULES };
}

async function listAllPlayerIds() {
  const db = await getMongoDb();
  const rows = await db.collection("progress").find({}, { projection: { playerId: 1 } }).toArray();
  return rows.map((row) => String(row.playerId || "").trim()).filter(Boolean);
}

async function resetAllZoneMonsters(monsterService = null) {
  const db = await getMongoDb();
  const monsters = monsterService?.listMonsters
    ? await monsterService.listMonsters({ includeDisabled: false })
    : await db.collection("monsters").find({ seq: { $exists: true }, enabled: true }).toArray();
  const firstByZone = {};
  for (const monster of monsters) {
    if (!monster.zone || typeof monster.seq !== "number") continue;
    if (!firstByZone[monster.zone] || monster.seq < firstByZone[monster.zone].seq) firstByZone[monster.zone] = monster;
  }
  const nowIso = new Date().toISOString();
  const zones = [];
  for (const [zone, first] of Object.entries(firstByZone)) {
    const maxHp = first.calc?.maxHp ?? first.maxHp;
    const clean = { activeMonsterSeq: first.seq, currentHp: Number(maxHp) > 0 ? Number(maxHp) : 1, killCount: {} };
    // 全服換季在 strict write lock 內執行，刻意直寫 DB；一般 monsterRepository
    // 會拒絕所有玩家戰鬥的 saveState，避免舊戰鬥覆蓋這個乾淨狀態。
    await db.collection("monsters").updateOne(
      { _id: `monsterState:${zone}` }, { $set: { value: clean, updatedAt: nowIso } }, { upsert: true }
    );
    await db.collection("monsterState").updateOne(
      { _id: zone }, { $set: { value: clean, updatedAt: nowIso } }, { upsert: true }
    );
    zones.push(zone);
  }
  return { zonesReset: zones.length, zones };
}

async function buildSeasonGlobalsBackup() {
  const db = await getMongoDb();
  const [serverBuffs, scAccumulator, memberEventsState, viewerState, eventConfig, worldBossState, monsterState, embeddedMonsterState, pkArenaState, towerSessions] = await Promise.all([
    db.collection("serverBuffs").find({}).toArray(),
    db.collection("scAccumulator").findOne({ _id: "current" }),
    db.collection("memberEventsState").findOne({ _id: "default" }),
    db.collection("viewerState").findOne({ _id: "default" }),
    db.collection("serverEventConfig").findOne({ _id: "default" }),
    db.collection("worldBossState").find({}).toArray(),
    db.collection("monsterState").find({}).toArray(),
    db.collection("monsters").find({ _id: /^monsterState:/ }).toArray(),
    db.collection("pkArenaState").find({}).toArray(),
    db.collection("towerSessions").find({}).toArray(),
  ]);
  return { serverBuffs, scAccumulator, memberEventsState, viewerState, eventConfig, worldBossState, monsterState, embeddedMonsterState, pkArenaState, towerSessions };
}

async function writeFullSeasonBackup(writer, playerIds = null) {
  if (!writer) throw new Error("backup writer required");
  const db = await getMongoDb();
  const ids = playerIds || await listAllPlayerIds();
  await writer.begin();
  try {
    for (const id of ids) {
      await writer.writePlayer(await buildSeasonResetBackup(id, { includeTransactions: false }));
      const cursor = db.collection("transactions").find({ playerId: id });
      for await (const transaction of cursor) await writer.writeTransaction(id, transaction);
    }
    await writer.writeGlobals(await buildSeasonGlobalsBackup());
    return await writer.finish();
  } catch (error) {
    await writer.abort(error);
    throw error;
  }
}

async function resetStreamSeasonState({ clearShortTermBuffs = true } = {}) {
  const globalBuff = require("../stream/globalBuffService");
  const scBar = require("../stream/scBarService");
  const memberEvents = require("../stream/memberEventsService");
  const viewer = require("../stream/viewerService");
  const results = {};
  // 換季預設清除所有仍生效的短期直播加成，避免上一季的直播 session 延續到新季。
  results.globalBuffs = await globalBuff.resetSeason({ clearShortTerm: clearShortTermBuffs });
  results.scBar = await scBar.reset({ archive: true });
  results.memberEvents = await memberEvents.resetSeason();
  results.viewer = await viewer.resetSeason();
  return results;
}

async function resetSeasonGlobals({ passService = null, seasonKey = null, resetStreams = true, clearShortTermBuffs = true } = {}) {
  const db = await getMongoDb();
  const key = String(seasonKey || makeSeasonKey());
  let pass;
  if (passService?.resetSeason) {
    pass = await passService.resetSeason(key);
  } else {
    await db.collection("serverEventConfig").updateOne(
      { _id: "default" }, { $set: { passSeasonKey: key } }, { upsert: true }
    );
    const r = await db.collection("passState").updateMany({}, {
      $set: { seasonKey: key, points: 0, unlocked: false, claimedFree: [], claimedPaid: [], updatedAt: new Date().toISOString() }
    });
    pass = { seasonKey: key, resetPlayers: r.modifiedCount || 0 };
  }
  const [kda, worldBoss, pkArena, towerSessions] = await Promise.all([
    db.collection("kdaSeasonStats").deleteMany({}),
    db.collection("worldBossState").deleteMany({}),
    db.collection("pkArenaState").deleteMany({}),
    db.collection("towerSessions").deleteMany({}),
  ]);
  const streams = resetStreams ? await resetStreamSeasonState({ clearShortTermBuffs }) : null;
  return {
    pass,
    kdaRowsCleared: kda.deletedCount || 0,
    worldBossStatesCleared: worldBoss.deletedCount || 0,
    pkArenaStatesCleared: pkArena.deletedCount || 0,
    towerSessionsCleared: towerSessions.deletedCount || 0,
    streams,
  };
}

async function seasonResetAllPlayers({
  onBackup = null,
  backupWriter = null,
  dryRun = false,
  keepLedger = false,
  monsterService = null,
  passService = null,
  seasonKey = null,
  runId = null,
  resumeCompletedIds = null,
  onPlayerComplete = null,
} = {}) {
  const ids = await listAllPlayerIds();
  if (dryRun) return { total: ids.length, dryRun: true, keepLedger, rules: SEASON_RESET_RULES };

  if (backupWriter) {
    await writeFullSeasonBackup(backupWriter, ids);
  } else if (typeof onBackup === "function") {
    const backups = [];
    for (const id of ids) backups.push(await buildSeasonResetBackup(id));
    await onBackup(backups, await buildSeasonGlobalsBackup());
  }

  const agg = {
    total: ids.length, succeeded: 0, failed: 0,
    removedAuctions: 0, removedInventoryItems: 0, keptTransactions: 0,
    removedUniqueGrants: 0, errors: [], rules: SEASON_RESET_RULES,
  };
  const completedIds = resumeCompletedIds instanceof Set ? resumeCompletedIds : new Set(resumeCompletedIds || []);
  const db = await getMongoDb();
  const persistentItemIds = await loadPersistentItemIds(db);
  const effectiveKey = String(seasonKey || makeSeasonKey());
  for (const id of ids) {
    if (completedIds.has(id)) {
      agg.succeeded += 1;
      continue;
    }
    try {
      const summary = await seasonResetPlayer(id, {
        dryRun: false, keepLedger, resetPass: false,
        seasonKey: effectiveKey, runId, persistentItemIds,
      });
      agg.succeeded += 1;
      agg.removedAuctions += Number(summary.removedAuctions) || 0;
      agg.removedInventoryItems += Number(summary.removedInventoryItems) || 0;
      agg.keptTransactions += Number(summary.keptTransactions) || 0;
      agg.removedUniqueGrants += Number(summary.removedUniqueGrants) || 0;
      if (typeof onPlayerComplete === "function") await onPlayerComplete(id, summary);
    } catch (error) {
      agg.failed += 1;
      if (agg.errors.length < 20) agg.errors.push({ id, message: error.message });
    }
  }
  if (agg.failed > 0) {
    agg.completed = false;
    agg.finalizationSkipped = "有玩家重置失敗；怪物與全服狀態未切季，修正後可安全重跑";
    return agg;
  }
  try {
    Object.assign(agg, await resetAllZoneMonsters(monsterService));
  } catch (error) {
    agg.zonesResetError = error.message;
    agg.completed = false;
    agg.finalizationSkipped = "怪物歸位失敗；全服狀態未切季，修正後可安全重跑";
    return agg;
  }
  try {
    agg.globalReset = await resetSeasonGlobals({ passService, seasonKey: effectiveKey, resetStreams: true, clearShortTermBuffs: true });
  } catch (error) {
    agg.globalResetError = error.message;
  }
  agg.completed = !agg.globalResetError;
  return agg;
}

module.exports = {
  PERSISTENT_STORY_ITEM_IDS,
  SEASON_RESET_RULES,
  makeSeasonKey,
  seasonResetPlayer,
  buildSeasonResetBackup,
  buildSeasonGlobalsBackup,
  writeFullSeasonBackup,
  loadPersistentItemIds,
  listAllPlayerIds,
  seasonResetAllPlayers,
  resetAllZoneMonsters,
  resetStreamSeasonState,
  resetSeasonGlobals,
};
