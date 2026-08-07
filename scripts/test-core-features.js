"use strict";

require("dotenv").config();

const { MongoClient } = require("mongodb");
const { calcPlayerStats } = require("../src/shared/combatStats");
const { runCombatLoop } = require("../src/shared/combatLoop");
const { runPkCombat } = require("../src/shared/pkCombat");
const {
  TOWER_MIN_LEVEL,
  TOWER_TOTAL_FLOORS,
  calcTowerReward,
} = require("../src/shared/towerConfig");
const { TOWER_ENABLED } = require("../src/bot/handlers/towerHandlers");

const REQUIRED_MONSTER_FEATURES = [
  "monster_zone_beginner",
  "monster_zone",
  "monster_zone_mid",
  "monster_zone_hard",
  "monster_zone_elite",
];

const REQUIRED_TOWER_BOSSES = [
  "大野兔(B)",
  "米拉桑(B)",
  "古城將軍(B)",
  "城堡魔像(B)",
  "大史王",
];

const REQUIRED_JOB_IDS = [
  "job_swordsman_v1",
  "job_warrior_v1",
  "job_dwarf_warrior_v1",
  "job_rogue_v1",
  "job_mage_v1",
  "job_healer_v1",
  "job_archer_v1",
  "job_tactician_v1",
  "job_bard_v1",
  "job_barrier_mage_v1",
];

const JOB_WEAPON_TYPES = {
  job_swordsman_v1: "sword_1h",
  job_warrior_v1: "axe_2h",
  job_dwarf_warrior_v1: "mace_2h",
  job_rogue_v1: "dagger",
  job_mage_v1: "staff_2h",
  job_healer_v1: "staff_1h",
  job_archer_v1: "bow",
  job_tactician_v1: "sword_1h",
  job_bard_v1: "bow",
  job_barrier_mage_v1: "staff_1h",
};

const results = [];

function pass(name, detail = "") {
  results.push({ level: "PASS", name, detail });
}

function warn(name, detail = "") {
  results.push({ level: "WARN", name, detail });
}

function fail(name, error) {
  results.push({
    level: "FAIL",
    name,
    detail: error && error.stack ? error.stack : String(error),
  });
}

async function run(name, fn) {
  try {
    await fn();
  } catch (error) {
    fail(name, error);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertNumber(value, label) {
  assert(Number.isFinite(Number(value)), `${label} is not a finite number`);
}

async function count(collection, filter = {}) {
  return collection.countDocuments(filter);
}

async function getActiveDb() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB_NAME;
  assert(uri, "MONGODB_URI is missing");
  assert(dbName, "MONGODB_DB_NAME is missing");
  const client = new MongoClient(uri);
  await client.connect();
  return { client, db: client.db(dbName) };
}

async function testServerHealth() {
  try {
    const response = await fetch("http://127.0.0.1:5566/health");
    const body = await response.json();
    assert(response.ok, `health returned HTTP ${response.status}`);
    assert(body.status === "ok", `health status is ${body.status}`);
    pass("server health", "http://127.0.0.1:5566/health OK");
  } catch (error) {
    warn("server health", `server not reachable in this shell: ${error.message}`);
  }
}

async function testCoreData(db) {
  const players = db.collection("players");
  const progress = db.collection("progress");
  const wallets = db.collection("wallets");
  const items = db.collection("items");
  const monsters = db.collection("monsters");
  const quests = db.collection("weeklyQuests");

  const counts = {
    players: await count(players),
    progress: await count(progress),
    wallets: await count(wallets),
    items: await count(items),
    monsters: await count(monsters),
    quests: await count(quests),
  };

  assert(counts.players > 0, "players collection is empty");
  assert(counts.progress >= counts.players, "progress count is lower than players");
  assert(counts.wallets >= counts.players, "wallet count is lower than players");
  assert(counts.items >= 200, `items count too low: ${counts.items}`);
  assert(counts.monsters >= 40, `monsters count too low: ${counts.monsters}`);
  assert(counts.quests >= 30, `weeklyQuests count too low: ${counts.quests}`);

  pass(
    "core data counts",
    `players=${counts.players}, items=${counts.items}, monsters=${counts.monsters}`,
  );
}

async function testPlayerIntegrity(db) {
  const playersMissingProgress = await db.collection("players").aggregate([
    { $lookup: {
      from: "progress",
      localField: "discordId",
      foreignField: "playerId",
      as: "progressRows",
    } },
    { $match: { progressRows: { $size: 0 } } },
    { $count: "count" },
  ]).toArray();

  const playersMissingWallets = await db.collection("players").aggregate([
    { $lookup: {
      from: "wallets",
      localField: "discordId",
      foreignField: "playerId",
      as: "walletRows",
    } },
    { $match: { walletRows: { $size: 0 } } },
    { $count: "count" },
  ]).toArray();

  const equipmentMissing = await db.collection("progress").aggregate([
    { $project: {
      equipmentPairs: { $objectToArray: { $ifNull: ["$equipment", {}] } },
    } },
    { $unwind: "$equipmentPairs" },
    { $match: { "equipmentPairs.v": { $ne: null } } },
    { $project: {
      itemId: { $ifNull: ["$equipmentPairs.v.itemId", "$equipmentPairs.v.id"] },
    } },
    { $lookup: {
      from: "items",
      localField: "itemId",
      foreignField: "id",
      as: "itemRows",
    } },
    { $match: { itemRows: { $size: 0 } } },
    { $count: "count" },
  ]).toArray();

  const inventoryMissing = await db.collection("progress").aggregate([
    { $project: { inventory: { $ifNull: ["$inventory", []] } } },
    { $unwind: "$inventory" },
    { $project: { itemId: "$inventory.itemId" } },
    { $match: { itemId: { $exists: true, $ne: null, $ne: "" } } },
    { $lookup: {
      from: "items",
      localField: "itemId",
      foreignField: "id",
      as: "itemRows",
    } },
    { $match: { itemRows: { $size: 0 } } },
    { $count: "count" },
  ]).toArray();

  const missingProgress = playersMissingProgress[0]?.count || 0;
  const missingWallets = playersMissingWallets[0]?.count || 0;
  const missingEquipment = equipmentMissing[0]?.count || 0;
  const missingInventory = inventoryMissing[0]?.count || 0;

  assert(missingProgress === 0, `${missingProgress} players missing progress`);
  assert(missingWallets === 0, `${missingWallets} players missing wallets`);
  assert(missingEquipment === 0, `${missingEquipment} equipped items missing`);
  assert(missingInventory === 0, `${missingInventory} inventory items missing`);

  pass("player data integrity", "players have progress, wallets, and item refs");
}

async function testChannelBindings(db) {
  const layout = await db.collection("channelLayout").findOne({ _id: "default" });
  const bindings = layout?.value?.discord?.bindings || [];

  for (const featureKey of REQUIRED_MONSTER_FEATURES) {
    const binding = bindings.find((row) => row.featureKey === featureKey);
    assert(binding, `${featureKey} binding missing`);
    if (binding.enabled === false || !binding.channelId) {
      warn(`${featureKey} channel binding`, "目前停用或尚未指定頻道");
    }
  }

  const dailyQuest = bindings.find((row) => row.featureKey === "daily_quest");
  const weeklyQuest = bindings.find((row) => row.featureKey === "weekly_quest");
  if (!dailyQuest?.enabled || !dailyQuest.channelId) {
    warn("daily quest panel binding", "daily_quest is disabled or has no channelId");
  }

  if (!weeklyQuest?.enabled || !weeklyQuest.channelId) {
    warn("weekly quest panel binding", "weekly_quest is disabled or has no channelId");
  }

  pass("monster zone channel bindings", "binding definitions are present; disabled panels are reported as warnings");
}

async function testJobDefinitions(db) {
  const items = await db.collection("items").find({
    id: { $in: REQUIRED_JOB_IDS },
  }).toArray();
  const itemById = new Map(items.map((item) => [item.id, item]));

  const jobQuests = await db.collection("weeklyQuests").find({
    cadence: "job",
    enabled: { $ne: false },
  }).toArray();
  const questRewardIds = new Set(jobQuests.map((quest) => quest.rewardItemId));

  for (const jobId of REQUIRED_JOB_IDS) {
    const job = itemById.get(jobId);
    assert(job, `${jobId} item missing`);
    assert(job.itemType === "job_badge", `${jobId} is not job_badge`);
    assert(job.equipSlot === "job_eq", `${jobId} equipSlot is not job_eq`);
    assert(questRewardIds.has(jobId), `${jobId} has no enabled job quest`);
  }

  pass("job badges and job quests", `${REQUIRED_JOB_IDS.length} jobs available`);
}

async function testJobStatSmoke(db) {
  const itemRows = await db.collection("items").find({
    $or: [
      { id: { $in: REQUIRED_JOB_IDS } },
      { equipSlot: "weapon" },
    ],
  }).toArray();
  const itemById = new Map(itemRows.map((item) => [item.id, item]));

  for (const jobId of REQUIRED_JOB_IDS) {
    const weaponType = JOB_WEAPON_TYPES[jobId];
    const weapon = itemRows.find((item) => item.weaponType === weaponType);
    const job = itemById.get(jobId);
    assert(weapon, `no weapon found for ${weaponType}`);

    const stats = calcPlayerStats(
      { str: 20, agi: 20, vit: 20, int: 20, dex: 20, luk: 20 },
      { weapon, job_eq: job },
      [],
      [],
      { pkRating: 1500 },
    );

    assertNumber(stats.atk, `${jobId} atk`);
    assertNumber(stats.maxHp, `${jobId} maxHp`);
    assert(stats.atk > 0, `${jobId} atk is not positive`);
    assert(stats.maxHp > 0, `${jobId} maxHp is not positive`);
  }

  pass("job stat calculation", "all job + weapon builds produce valid stats");
}

async function testMonsterZoneCombat(db) {
  const monster = await db.collection("monsters").findOne({
    enabled: { $ne: false },
    zone: "normal",
  });
  const weapon = await db.collection("items").findOne({
    equipSlot: "weapon",
    weaponType: "sword_1h",
  });

  assert(monster, "no enabled normal monster");
  assert(weapon, "no sword_1h weapon item");

  const stats = calcPlayerStats(
    { str: 24, agi: 14, vit: 18, int: 8, dex: 18, luk: 8 },
    { weapon },
    [],
    [],
    { pkRating: 1500 },
  );
  const monsterCalc = {
    atk: Number(monster.str || 1) * 3,
    def: Number(monster.def || 0),
    dodge: Math.min(50, Number(monster.agi || 1) * 0.5),
    hit: Math.min(100, 80 + Number(monster.dex || 1)),
  };
  const result = runCombatLoop(
    stats,
    monsterCalc,
    monster.name || "Test Monster",
    Number(monster.maxHp || 100),
    10,
    { equipped: { weapon }, inventory: [] },
  );

  assert(["win", "lose", "timeout"].includes(result.outcome), "invalid outcome");
  assert(Array.isArray(result.roundLogs) && result.roundLogs.length > 0, "no logs");
  assertNumber(result.totalDamage, "monster combat totalDamage");

  pass("monster zone combat simulation", `outcome=${result.outcome}`);
}

async function testPkCombat() {
  const weaponA = { id: "test_sword", equipSlot: "weapon", weaponType: "sword_1h" };
  const weaponB = { id: "test_axe", equipSlot: "weapon", weaponType: "axe_2h" };
  const statsA = calcPlayerStats(
    { str: 22, agi: 15, vit: 18, int: 8, dex: 18, luk: 10 },
    { weapon: weaponA },
    [],
    [],
    { pkRating: 1500 },
  );
  const statsB = calcPlayerStats(
    { str: 24, agi: 10, vit: 20, int: 6, dex: 15, luk: 12 },
    { weapon: weaponB },
    [],
    [],
    { pkRating: 1500 },
  );

  const result = runPkCombat(
    statsA,
    { equipped: { weapon: weaponA }, inventory: [] },
    "Tester A",
    statsB,
    { equipped: { weapon: weaponB }, inventory: [] },
    "Tester B",
    8,
  );

  assert(["A", "B", null].includes(result.winner), "invalid PK winner");
  assert(Array.isArray(result.roundLogs) && result.roundLogs.length > 0, "no PK logs");
  assertNumber(result.finalHpA, "PK finalHpA");
  assertNumber(result.finalHpB, "PK finalHpB");

  pass("PK combat simulation", `winner=${result.winner || "draw"}`);
}

async function testTowerData(db) {
  assert(TOWER_MIN_LEVEL > 0, "TOWER_MIN_LEVEL should be positive");
  assert(TOWER_TOTAL_FLOORS >= 40, "tower should have at least 40 floors");

  const towerItems = await db.collection("items").countDocuments({
    itemType: "tower_consumable",
  });
  if (TOWER_ENABLED) {
    assert(towerItems >= 3, `tower consumables too low: ${towerItems}`);
  } else {
    warn("tower consumables", `爬塔目前關閉，暫不要求消耗品資料（目前 ${towerItems} 筆）`);
  }

  const enabledZones = await db.collection("monsters").aggregate([
    { $match: { enabled: { $ne: false }, isBoss: { $ne: true } } },
    { $group: { _id: "$zone", count: { $sum: 1 } } },
  ]).toArray();
  const zoneCounts = new Map(enabledZones.map((row) => [row._id || "normal", row.count]));
  for (const zone of ["beginner", "normal", "mid", "hard"]) {
    if ((zoneCounts.get(zone) || 0) > 0) continue;
    if (!TOWER_ENABLED) warn(`tower ${zone} zone pool`, "爬塔目前關閉，暫不要求怪物池");
    else assert(false, `tower zone pool empty: ${zone}`);
  }

  const bosses = await db.collection("monsters").find({
    name: { $in: REQUIRED_TOWER_BOSSES },
    enabled: { $ne: false },
  }).toArray();
  const bossNames = new Set(bosses.map((monster) => monster.name));
  for (const name of REQUIRED_TOWER_BOSSES) {
    assert(bossNames.has(name), `tower boss missing: ${name}`);
  }

  const reward = calcTowerReward(10, 3);
  assertNumber(reward.gold, "tower reward gold");
  assertNumber(reward.exp, "tower reward exp");

  pass("tower data and reward config", `items=${towerItems}, floors=${TOWER_TOTAL_FLOORS}`);
}

async function testQuestDefinitions(db) {
  const rows = await db.collection("weeklyQuests").aggregate([
    { $match: { enabled: { $ne: false } } },
    { $group: { _id: "$cadence", count: { $sum: 1 } } },
  ]).toArray();
  const counts = new Map(rows.map((row) => [row._id || "weekly", row.count]));

  assert((counts.get("onboarding") || 0) >= 10, "onboarding quests too low");
  assert((counts.get("job") || 0) >= 10, "job quests too low");
  assert((counts.get("daily") || 0) >= 1, "daily quests missing");
  assert((counts.get("weekly") || 0) >= 1, "weekly quests missing");

  pass(
    "quest definitions",
    `job=${counts.get("job") || 0}, daily=${counts.get("daily") || 0}`,
  );
}

async function main() {
  await testServerHealth();
  const { client, db } = await getActiveDb();
  try {
    await run("core data counts", () => testCoreData(db));
    await run("player data integrity", () => testPlayerIntegrity(db));
    await run("channel bindings", () => testChannelBindings(db));
    await run("job definitions", () => testJobDefinitions(db));
    await run("job stat smoke", () => testJobStatSmoke(db));
    await run("monster zone combat", () => testMonsterZoneCombat(db));
    await run("PK combat", testPkCombat);
    await run("tower data", () => testTowerData(db));
    await run("quest definitions", () => testQuestDefinitions(db));
  } finally {
    await client.close();
  }

  const order = { FAIL: 0, WARN: 1, PASS: 2 };
  results.sort((a, b) => order[a.level] - order[b.level]);

  for (const row of results) {
    const suffix = row.detail ? ` - ${row.detail}` : "";
    console.log(`[${row.level}] ${row.name}${suffix}`);
  }

  const failures = results.filter((row) => row.level === "FAIL");
  const warnings = results.filter((row) => row.level === "WARN");
  console.log("");
  console.log(`Summary: ${failures.length} fail, ${warnings.length} warn, `
    + `${results.length - failures.length - warnings.length} pass`);

  if (failures.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
