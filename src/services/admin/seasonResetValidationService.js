"use strict";

const { getMongoDb } = require("../../adapters/mongo/createMongoClient");
const { isTitle, isCollectible, isSeasonPersistentItem } = require("./seasonResetPolicy");
const { loadPersistentItemIds } = require("./seasonResetService");

async function validateSeasonReset({ seasonKey, keepLedger = false }) {
  const db = await getMongoDb();
  const key = String(seasonKey || "");
  const persistentIds = await loadPersistentItemIds(db);
  const progressRows = await db.collection("progress").find({}, {
    projection: { playerId: 1, seasonKey: 1, level: 1, exp: 1, job: 1, inventory: 1, pets: 1, activePetUuid: 1, equipment: 1, characterSlots: 1, activeCharacterSlot: 1, jobExp: 1, accountWorldBossClears: 1, accountSoloBoss: 1 }
  }).toArray();
  const failures = [];
  const seen = new Set();

  for (const row of progressRows) {
    const id = String(row.playerId || "");
    if (!id || seen.has(id)) failures.push({ check: "progress-player-id", playerId: id || null });
    seen.add(id);
    if (row.seasonKey !== key || Number(row.level) !== 1 || Number(row.exp) !== 0 || row.job !== "Novice") {
      failures.push({ check: "progress-reset", playerId: id, seasonKey: row.seasonKey, level: row.level, exp: row.exp, job: row.job });
    }
    for (const [slot, character] of Object.entries(row.characterSlots || {})) {
      if (Number(character.level) !== 1 || Number(character.exp) !== 0 || character.job !== "Novice" || Number(character.jobExp) !== 0) {
        failures.push({ check: "character-reset", playerId: id, slot });
      }
      if (character.equipment?.job_eq || Object.keys(character.equipPresets || {}).length || (character.activeEffects || []).length) {
        failures.push({ check: "character-equipment-reset", playerId: id, slot });
      }
    }
    if (row.accountWorldBossClears) failures.push({ check: "account-world-boss-clears-reset", playerId: id });
    if (row.accountSoloBoss) failures.push({ check: "account-solo-boss-reset", playerId: id });
    if ((row.pets || []).length || row.activePetUuid) failures.push({ check: "pets-reset", playerId: id });
    const invalid = (row.inventory || []).find((item) => !isTitle(item) && !isCollectible(item) && !isSeasonPersistentItem(item, persistentIds));
    if (invalid) failures.push({ check: "inventory-reset", playerId: id, itemId: invalid.itemId || invalid.id || null });
    if (failures.length >= 100) break;
  }

  const [wallets, quests, checkins, auctions, idle, fatigue, kda, worldBoss, pkArena, towerSessions, oldPass, activeBuffs, eventConfig] = await Promise.all([
    db.collection("wallets").countDocuments({ $or: [{ gold: { $ne: 0 } }, { seasonBackpackSlots: { $ne: 0 } }] }),
    db.collection("weeklyQuestProgress").countDocuments({}),
    db.collection("checkins").countDocuments({}),
    db.collection("auctions").countDocuments({ status: { $in: ["active", "expired"] } }),
    db.collection("idlePlayerStates").countDocuments({}),
    db.collection("farmFatigue").countDocuments({}),
    db.collection("kdaSeasonStats").countDocuments({}),
    db.collection("worldBossState").countDocuments({}),
    db.collection("pkArenaState").countDocuments({}),
    db.collection("towerSessions").countDocuments({}),
    db.collection("passState").countDocuments({ seasonKey: { $ne: key } }),
    db.collection("serverBuffs").countDocuments({ endsAt: { $gt: new Date().toISOString() } }),
    db.collection("serverEventConfig").findOne({ _id: "default" }, { projection: { passSeasonKey: 1 } }),
  ]);
  const counts = {
    players: progressRows.length,
    invalidWallets: wallets,
    activeQuests: quests,
    activeCheckins: checkins,
    activeAuctions: auctions,
    idleStates: idle,
    fatigueStates: fatigue,
    kdaRows: kda,
    worldBossStates: worldBoss,
    pkArenaStates: pkArena,
    towerSessions,
    oldPassStates: oldPass,
    activeStreamBuffs: activeBuffs,
  };
  if (String(eventConfig?.passSeasonKey || "") !== key) {
    failures.push({ check: "passSeasonKey", actual: eventConfig?.passSeasonKey || null, expected: key });
  }

  const definitions = await db.collection("monsters")
    .find({ seq: { $exists: true }, enabled: true }, { projection: { zone: 1, seq: 1, maxHp: 1, calc: 1 } })
    .toArray();
  const firstByZone = new Map();
  for (const monster of definitions) {
    const current = firstByZone.get(monster.zone);
    if (!current || monster.seq < current.seq) firstByZone.set(monster.zone, monster);
  }
  const stateRows = await db.collection("monsterState").find({}).toArray();
  const states = new Map(stateRows.map((row) => [String(row._id), row.value || row]));
  for (const [zone, first] of firstByZone) {
    const state = states.get(String(zone));
    const maxHp = Number(first.calc?.maxHp ?? first.maxHp) || 1;
    if (!state || Number(state.activeMonsterSeq) !== Number(first.seq) || Number(state.currentHp) !== maxHp) {
      failures.push({ check: "monsterState", zone, expectedSeq: first.seq, expectedHp: maxHp, actual: state || null });
    }
  }
  for (const [check, count] of Object.entries(counts)) {
    if (check === "players") continue;
    if (keepLedger && ["activeQuests", "activeCheckins"].includes(check)) continue;
    if (count > 0) failures.push({ check, count });
  }
  return { ok: failures.length === 0, seasonKey: key, counts, failures: failures.slice(0, 100), validatedAt: new Date().toISOString() };
}

module.exports = { validateSeasonReset };
