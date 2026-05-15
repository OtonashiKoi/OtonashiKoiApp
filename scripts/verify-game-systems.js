"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");
const { calcPlayerStats } = require("../src/shared/combatStats");
const { runCombatLoop } = require("../src/shared/combatLoop");
const { WeeklyQuestService, resolvePeriodKey } = require("../src/services/weeklyQuest/weeklyQuestService");
const { getEquipmentTierSetBonuses } = require("../src/shared/equipmentTierSetBonuses");
const {
  PK_RATING_DEFAULT,
  PK_RATING_MIN,
  calcRatingChange,
  getBossBoostPct,
  getDropBoostPct,
} = require("../src/shared/pkArenaConfig");
const { createPkArenaPanelMessage } = require("../src/bot/pkArenaView");

const JOB_IDS = [
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

const results = [];

function ok(name, detail = "") {
  results.push({ level: "PASS", name, detail });
}

function fail(name, error) {
  results.push({ level: "FAIL", name, detail: error?.stack || String(error) });
}

async function step(name, fn) {
  try {
    await fn();
  } catch (error) {
    fail(name, error);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeMonsterCalc(monster) {
  return {
    maxHp: Number(monster.maxHp || 100),
    atk: Math.round(Number(monster.str || 1) * 3),
    def: Number(monster.def || 0),
    dodge: Math.min(50, Number(monster.agi || 1) * 0.5),
    hit: Math.min(100, 80 + Number(monster.dex || 1)),
    crit: Math.min(100, Number(monster.luk || 0) * 0.3),
    comboChance: Math.min(80, 3 + Number(monster.agi || 1) * 0.5),
  };
}

function makeAttrsForQuest(quest, good = true) {
  const attrs = { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 };
  if (!good) return attrs;
  const unlockAttrs = Array.isArray(quest.unlockAttributes) ? quest.unlockAttributes : [];
  const min = Number(quest.unlockAttributeMin || 0);
  if (unlockAttrs.length > 0) attrs[unlockAttrs[0]] = min + 1;
  return attrs;
}

class MemoryQuestRepository {
  constructor(quests) {
    this.quests = quests.map(clone);
    this.progress = new Map();
  }

  async listQuests() {
    return this.quests.map(clone);
  }

  async findQuestById(id) {
    return clone(this.quests.find((quest) => quest.id === id) || null);
  }

  async saveQuest(quest) {
    const index = this.quests.findIndex((row) => row.id === quest.id);
    if (index >= 0) this.quests[index] = clone(quest);
    else this.quests.push(clone(quest));
    return clone(quest);
  }

  async deleteQuest(id) {
    this.quests = this.quests.filter((quest) => quest.id !== id);
  }

  _key(discordId, periodKey, cadence) {
    return `${discordId}:${cadence}:${periodKey}`;
  }

  async getPlayerProgress(discordId, periodKey, cadence) {
    return clone(this.progress.get(this._key(discordId, periodKey, cadence)) || {});
  }

  async savePlayerProgress(discordId, periodKey, progress, cadence) {
    this.progress.set(this._key(discordId, periodKey, cadence), clone(progress));
  }

  async getAllProgressByPeriod(periodKey, cadence) {
    const suffix = `:${cadence}:${periodKey}`;
    const out = {};
    for (const [key, value] of this.progress.entries()) {
      if (!key.endsWith(suffix)) continue;
      const discordId = key.slice(0, -suffix.length);
      out[discordId] = clone(value);
    }
    return out;
  }
}

class MemoryPlayerService {
  constructor() {
    this.profile = null;
  }

  setProfile(profile) {
    this.profile = clone(profile);
  }

  async getProfile() {
    return clone(this.profile);
  }
}

async function loadDb() {
  assert(process.env.MONGODB_URI, "MONGODB_URI is missing");
  assert(process.env.MONGODB_DB_NAME, "MONGODB_DB_NAME is missing");
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  return { client, db: client.db(process.env.MONGODB_DB_NAME) };
}

async function verifyAllJobsCanFightNormalMonster(db) {
  const normalMonster = await db.collection("monsters").findOne({
    enabled: { $ne: false },
    zone: "normal",
    isBoss: { $ne: true },
  });
  assert(normalMonster, "找不到啟用中的一般怪物");

  const quests = await db.collection("weeklyQuests").find({
    cadence: "job",
    enabled: { $ne: false },
    rewardItemId: { $in: JOB_IDS },
  }).toArray();
  const questByJobId = new Map(quests.map((quest) => [quest.rewardItemId, quest]));
  const jobItems = await db.collection("items").find({ id: { $in: JOB_IDS } }).toArray();
  const jobsById = new Map(jobItems.map((item) => [item.id, item]));

  const monsterCalc = makeMonsterCalc(normalMonster);
  const details = [];

  for (const jobId of JOB_IDS) {
    const job = jobsById.get(jobId);
    const quest = questByJobId.get(jobId);
    assert(job, `${jobId} 職業徽章不存在`);
    assert(quest, `${jobId} 找不到職業任務`);

    const weaponTypes = Array.isArray(quest.unlockWeaponTypes) ? quest.unlockWeaponTypes : [];
    const weapon = await db.collection("items").findOne({
      equipSlot: "weapon",
      weaponType: { $in: weaponTypes },
    });
    assert(weapon, `${job.name || jobId} 找不到可用武器: ${weaponTypes.join(",")}`);

    const attrs = { str: 20, agi: 20, vit: 20, int: 20, dex: 20, luk: 20 };
    const equipped = { weapon, job_eq: job };
    const stats = calcPlayerStats(attrs, equipped, [], [], { pkRating: PK_RATING_DEFAULT });
    const result = runCombatLoop(
      stats,
      monsterCalc,
      normalMonster.name,
      Number(normalMonster.maxHp || 100),
      8,
      { equipped, inventory: [], monsterIsBoss: false },
    );

    assert(["win", "lose", "timeout"].includes(result.outcome), `${job.name} outcome 異常`);
    assert(Array.isArray(result.roundLogs) && result.roundLogs.length > 0, `${job.name} 沒有戰鬥 log`);
    assert(Number.isFinite(Number(result.totalDamage)), `${job.name} totalDamage 異常`);
    details.push(`${job.name}:${result.outcome}/${Math.round(result.totalDamage || 0)}`);
  }

  ok("所有職業可打一般怪物區", details.join(" | "));
}

async function verifyJobQuestVisibilityAndProgress(db) {
  const questRows = await db.collection("weeklyQuests").find({
    cadence: "job",
    enabled: { $ne: false },
    rewardItemId: { $in: JOB_IDS },
  }).toArray();
  assert(questRows.length === JOB_IDS.length, `職業任務數量異常: ${questRows.length}`);

  const playerService = new MemoryPlayerService();
  const discordId = "verify-job-quest-player";
  const periodKey = resolvePeriodKey("job");

  for (const quest of questRows) {
    const goodRepo = new MemoryQuestRepository(questRows);
    const goodService = new WeeklyQuestService(goodRepo, playerService);
    const weaponType = quest.unlockWeaponTypes?.[0];
    assert(weaponType, `${quest.title} 沒有 unlockWeaponTypes`);

    playerService.setProfile({
      progress: {
        level: Number(quest.unlockLevel || 10),
        attributes: makeAttrsForQuest(quest, true),
        equipment: { weapon: { itemId: "test-weapon", weaponType } },
        inventory: [],
      },
    });

    const visible = await goodService.getPlayerProgress(discordId, "job");
    assert(visible.some((row) => row.quest.id === quest.id), `${quest.title} 符合條件但沒有出現`);

    await goodService.recordProgress(discordId, quest.type, 1);
    let progress = await goodRepo.getPlayerProgress(discordId, periodKey, "job");
    assert((progress[quest.id]?.current || 0) >= 1, `${quest.title} 符合條件但沒有累積進度`);

    const wrongRepo = new MemoryQuestRepository(questRows);
    const wrongService = new WeeklyQuestService(wrongRepo, playerService);
    playerService.setProfile({
      progress: {
        level: Number(quest.unlockLevel || 10),
        attributes: makeAttrsForQuest(quest, true),
        equipment: { weapon: { itemId: "wrong-weapon", weaponType: "wrong_type" } },
        inventory: [],
      },
    });
    await wrongService.recordProgress(discordId, quest.type, 1);
    progress = await wrongRepo.getPlayerProgress(discordId, periodKey, "job");
    assert(!progress[quest.id], `${quest.title} 錯武器卻累積了進度`);

    const lowRepo = new MemoryQuestRepository(questRows);
    const lowService = new WeeklyQuestService(lowRepo, playerService);
    playerService.setProfile({
      progress: {
        level: Math.max(1, Number(quest.unlockLevel || 10) - 1),
        attributes: makeAttrsForQuest(quest, true),
        equipment: { weapon: { itemId: "test-weapon", weaponType } },
        inventory: [],
      },
    });
    const lowVisible = await lowService.getPlayerProgress(discordId, "job");
    assert(!lowVisible.some((row) => row.quest.id === quest.id), `${quest.title} 等級不足卻出現`);
    await lowService.recordProgress(discordId, quest.type, 1);
    progress = await lowRepo.getPlayerProgress(discordId, periodKey, "job");
    assert(!progress[quest.id], `${quest.title} 等級不足卻累積進度`);

    const attrRepo = new MemoryQuestRepository(questRows);
    const attrService = new WeeklyQuestService(attrRepo, playerService);
    playerService.setProfile({
      progress: {
        level: Number(quest.unlockLevel || 10),
        attributes: makeAttrsForQuest(quest, false),
        equipment: { weapon: { itemId: "test-weapon", weaponType } },
        inventory: [],
      },
    });
    await attrService.recordProgress(discordId, quest.type, 1);
    progress = await attrRepo.getPlayerProgress(discordId, periodKey, "job");
    assert(!progress[quest.id], `${quest.title} 屬性不足卻累積進度`);
  }

  ok("職業任務出現條件與進度累積", `${questRows.length} 個職業任務通過`);
}

function verifyTierSetBonusesAndCombat() {
  const fakeTier = (tier, slot) => ({
    id: `${tier}-${slot}`,
    name: `${tier} ${slot}`,
    itemType: "equipment",
    equipSlot: slot,
    tier,
    weaponType: slot === "weapon" ? "sword_1h" : null,
    equipStats: {},
  });
  const baseAttrs = { str: 30, agi: 10, vit: 10, int: 10, dex: 50, luk: 1 };
  const baseMonster = { atk: 0, def: 20, dodge: 0, hit: 0 };

  const d3 = {
    weapon: fakeTier("D", "weapon"),
    armor: fakeTier("D", "armor"),
    shoes: fakeTier("D", "shoes"),
  };
  const b3 = {
    weapon: fakeTier("B", "weapon"),
    armor: fakeTier("B", "armor"),
    shoes: fakeTier("B", "shoes"),
  };
  const a5 = {
    weapon: fakeTier("A", "weapon"),
    armor: fakeTier("A", "armor"),
    shoes: fakeTier("A", "shoes"),
    garment: fakeTier("A", "garment"),
    head_top: fakeTier("A", "head_top"),
  };

  const dBonus = getEquipmentTierSetBonuses(d3);
  const bBonus = getEquipmentTierSetBonuses(b3);
  const aBonus = getEquipmentTierSetBonuses(a5);
  assert(dBonus.stats.str === 3 && dBonus.stats.int === 3 && dBonus.stats.dex === 3, "D 3 件屬性加成異常");
  assert(bBonus.damagePct === 10, "B 3 件傷害加成異常");
  assert(aBonus.finalDamagePct === 5 && aBonus.bossDamagePct === 10, "A 5 件 Boss/最終傷害加成異常");

  const noSetStats = calcPlayerStats(baseAttrs, { weapon: fakeTier("", "weapon") }, [], []);
  const bSetStats = calcPlayerStats(baseAttrs, b3, [], []);
  noSetStats.dmgMin = noSetStats.dmgMax = 1;
  bSetStats.dmgMin = bSetStats.dmgMax = 1;
  noSetStats.crit = bSetStats.crit = 0;
  noSetStats.hit = bSetStats.hit = 100;
  noSetStats.combo = bSetStats.combo = 0;

  const noSet = runCombatLoop(noSetStats, baseMonster, "dummy", 999999, 1, {
    equipped: { weapon: fakeTier("", "weapon") },
    inventory: [],
  });
  const bSet = runCombatLoop(bSetStats, baseMonster, "dummy", 999999, 1, {
    equipped: b3,
    inventory: [],
  });
  assert(bSet.totalDamage > noSet.totalDamage, "B 套裝傷害沒有套用到戰鬥");

  const playerPanelPath = path.join(process.cwd(), "src/bot/playerPanel.js");
  const playerPanelSource = fs.readFileSync(playerPanelPath, "utf8");
  assert(playerPanelSource.includes("calcPlayerStats(attrs, equipped"), "個人資料沒有使用 calcPlayerStats");
  assert(playerPanelSource.includes("tierSetBonuses"), "個人資料沒有顯示套裝加成來源");

  ok("套裝效果套用到戰鬥與個人資料", `B套傷害 ${noSet.totalDamage}->${bSet.totalDamage}`);
}

function applyPkRatingPreview(challRating, defRating, winner, challFirst = true) {
  if (!winner) return {
    challRating,
    defRating,
    challWins: 0,
    challLosses: 0,
    defWins: 0,
    defLosses: 0,
  };
  const challWon = (winner === "A" && challFirst) || (winner === "B" && !challFirst);
  const challDelta = calcRatingChange(challRating, defRating, challWon);
  const defDelta = calcRatingChange(defRating, challRating, !challWon);
  return {
    challRating: Math.max(PK_RATING_MIN, challRating + challDelta),
    defRating: Math.max(PK_RATING_MIN, defRating + defDelta),
    challWins: challWon ? 1 : 0,
    challLosses: challWon ? 0 : 1,
    defWins: challWon ? 0 : 1,
    defLosses: challWon ? 1 : 0,
  };
}

function verifyPkRankRatingAndBossBoost() {
  assert(calcRatingChange(1500, 1500, true) === 16, "同分勝利應 +16");
  assert(calcRatingChange(1500, 1500, false) === -16, "同分敗北應 -16");
  const preview = applyPkRatingPreview(1500, 1500, "A", true);
  assert(preview.challRating === 1516 && preview.defRating === 1484, "PK 勝敗加扣分異常");
  const drawPreview = applyPkRatingPreview(1500, 1500, null, true);
  assert(drawPreview.challRating === 1500 && drawPreview.defRating === 1500, "PK 平局不應加扣分");

  assert(getBossBoostPct(1399) === 0, "1399 boss boost should be 0");
  assert(getBossBoostPct(1400) === 3, "1400 boss boost should be 3");
  assert(getBossBoostPct(1600) === 5, "1600 boss boost should be 5");
  assert(getBossBoostPct(1800) === 7, "1800 boss boost should be 7");
  assert(getDropBoostPct(1800) === 5, "1800 drop boost should be 5");

  const ranked = createPkArenaPanelMessage([], [
    { displayName: "RankTester", pkRating: 1800, pkWins: 7, pkLosses: 2 },
  ]);
  const fields = ranked.embeds[0].data.fields || [];
  const rankingValue = fields.find((field) => String(field.name).includes("Rating"))?.value || "";
  assert(rankingValue.includes("RankTester"), "PK Rank 沒顯示玩家名稱");
  assert(rankingValue.includes("1800分"), "PK Rank 沒顯示分數");
  assert(rankingValue.includes("7勝2敗"), "PK Rank 沒顯示勝敗");
  assert(rankingValue.includes("+7%"), "PK Rank 沒顯示 Boss 加成");
  assert(rankingValue.includes("+5%"), "PK Rank 沒顯示掉落加成");

  const pkHandlerSource = fs.readFileSync(path.join(process.cwd(), "src/bot/handlers/pkArenaHandlers.js"), "utf8");
  assert(pkHandlerSource.includes("!result.winner"), "PK rating 更新尚未排除 null 平局");

  const noBoss = calcPlayerStats(baseStatsForPk(), { weapon: fakePkWeapon() }, [], [], { pkRating: 1500 });
  const bossBoost = calcPlayerStats(baseStatsForPk(), { weapon: fakePkWeapon() }, [], [], { pkRating: 1800 });
  assert(bossBoost.tierBossDamageMultiplier > noBoss.tierBossDamageMultiplier, "PK rating Boss 傷害加成沒有進入戰鬥數值");

  ok("PK Rank、勝敗加扣分、Boss 加成", "Rank顯示、Elo、平局保護、Boss/drop boost 通過");
}

function baseStatsForPk() {
  return { str: 20, agi: 10, vit: 10, int: 10, dex: 10, luk: 10 };
}

function fakePkWeapon() {
  return {
    id: "pk-test-sword",
    name: "PK Test Sword",
    itemType: "equipment",
    equipSlot: "weapon",
    weaponType: "sword_1h",
    equipStats: {},
  };
}

async function main() {
  const { client, db } = await loadDb();
  try {
    await step("所有職業可打一般怪物區", () => verifyAllJobsCanFightNormalMonster(db));
    await step("職業任務出現條件與進度累積", () => verifyJobQuestVisibilityAndProgress(db));
    await step("套裝效果套用到戰鬥與個人資料", verifyTierSetBonusesAndCombat);
    await step("PK Rank、勝敗加扣分、Boss 加成", verifyPkRankRatingAndBossBoost);
  } finally {
    await client.close();
  }

  for (const row of results) {
    console.log(`[${row.level}] ${row.name}${row.detail ? ` - ${row.detail}` : ""}`);
  }
  const failures = results.filter((row) => row.level === "FAIL");
  console.log(`Summary: ${failures.length} fail, ${results.length - failures.length} pass`);
  if (failures.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
