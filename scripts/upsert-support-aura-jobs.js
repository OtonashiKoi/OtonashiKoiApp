"use strict";
require("dotenv").config();
const { randomUUID } = require("crypto");
const { MongoClient } = require("mongodb");
const config = require("../src/config");

function effect(key, target, value, notes, condition = null) {
  return {
    key,
    trigger: "passive",
    target,
    chance: 100,
    stacks: 1,
    stackMode: "replace",
    duration: { mode: "battle", value: 1 },
    params: { value, mode: "pct" },
    ...(condition ? { condition } : {}),
    notes
  };
}

const STAFF_CONDITION = { any: [{ weaponType: "staff_1h" }, { weaponType: "staff_2h" }] };

const JOB_ITEMS = [
  {
    id: "job_tactician_v1",
    name: "軍師徽章",
    description: "以單手劍指揮戰線的共鬥光環職業，提升隊伍對 Boss 的輸出並削弱怪物防禦。",
    itemType: "job_badge",
    equipSlot: "job_eq",
    equipStats: { agi: 4, int: 2, dex: 2 },
    passiveEffects: [
      effect("party_boss_damage_up", "party", 5, "裝備單手劍時：隊伍對 Boss 傷害 +5%", { weaponType: "sword_1h" }),
      effect("party_monster_def_down", "party", 5, "裝備單手劍時：隊伍攻擊視為怪物防禦降低 5%", { weaponType: "sword_1h" })
    ],
    combatEffects: [],
    procEffects: [],
    useEffects: [],
    enhanceLevel: 0
  },
  {
    id: "job_bard_v1",
    name: "詩人徽章",
    description: "以弓與戰歌鼓舞隊友的共鬥光環職業，提升隊伍經驗與金幣收益。",
    itemType: "job_badge",
    equipSlot: "job_eq",
    equipStats: { dex: 4, agi: 2, luk: 2 },
    passiveEffects: [
      effect("party_exp_gain_up", "party", 5, "裝備弓時：隊伍 EXP +5%", { weaponType: "bow" }),
      effect("party_gold_gain_up", "party", 5, "裝備弓時：隊伍金幣 +5%", { weaponType: "bow" })
    ],
    combatEffects: [],
    procEffects: [],
    useEffects: [],
    enhanceLevel: 0
  },
  {
    id: "job_barrier_mage_v1",
    name: "結界師徽章",
    description: "以法杖展開防護結界的共鬥光環職業，降低隊伍承受傷害與被暴擊傷害。",
    itemType: "job_badge",
    equipSlot: "job_eq",
    equipStats: { int: 3, vit: 3, dex: 2 },
    passiveEffects: [
      effect("def_up", "self", 5, "裝備法杖時：自身 DEF +5", STAFF_CONDITION),
      effect("party_damage_reduction", "party", 5, "裝備法杖時：隊伍受到傷害 -5%", STAFF_CONDITION),
      effect("party_crit_damage_reduction", "party", 10, "裝備法杖時：隊伍被暴擊傷害 -10%", STAFF_CONDITION)
    ],
    combatEffects: [],
    procEffects: [],
    useEffects: [],
    enhanceLevel: 0
  }
];

const QUESTS = [
  {
    cadence: "job",
    title: "軍師試煉",
    description: "出現條件：Lv.10，基礎 AGI > 10。進度武器：單手劍；使用指定武器出戰 10 次才會累積。獎勵：500 金幣與軍師徽章。",
    type: "battle_with_sword",
    target: 10,
    rewardGold: 500,
    rewardExp: 0,
    rewardDiamond: 0,
    rewardItemId: "job_tactician_v1",
    sortOrder: 80,
    groupKey: "job_seed_v1",
    unlockLevel: 10,
    unlockWeaponTypes: ["sword_1h"],
    unlockAttribute: "agi",
    unlockAttributeMin: 10,
    hideIfRewardOwned: true,
    resetPolicy: "once",
    enabled: true
  },
  {
    cadence: "job",
    title: "詩人試煉",
    description: "出現條件：Lv.10，基礎 DEX > 10。進度武器：弓；使用指定武器出戰 10 次才會累積。獎勵：500 金幣與詩人徽章。",
    type: "battle_with_bow",
    target: 10,
    rewardGold: 500,
    rewardExp: 0,
    rewardDiamond: 0,
    rewardItemId: "job_bard_v1",
    sortOrder: 90,
    groupKey: "job_seed_v1",
    unlockLevel: 10,
    unlockWeaponTypes: ["bow"],
    unlockAttribute: "dex",
    unlockAttributeMin: 10,
    hideIfRewardOwned: true,
    resetPolicy: "once",
    enabled: true
  },
  {
    cadence: "job",
    title: "結界師試煉",
    description: "出現條件：Lv.10，基礎 INT > 10。進度武器：單手法杖或雙手法杖；使用指定武器出戰 10 次才會累積。獎勵：500 金幣與結界師徽章。",
    type: "battle_with_staff",
    target: 10,
    rewardGold: 500,
    rewardExp: 0,
    rewardDiamond: 0,
    rewardItemId: "job_barrier_mage_v1",
    sortOrder: 100,
    groupKey: "job_seed_v1",
    unlockLevel: 10,
    unlockWeaponTypes: ["staff_1h", "staff_2h"],
    unlockAttribute: "int",
    unlockAttributeMin: 10,
    hideIfRewardOwned: true,
    resetPolicy: "once",
    enabled: true
  }
];

async function main() {
  const client = new MongoClient(config.storage.mongoUri);
  await client.connect();
  try {
    const db = client.db(config.storage.mongoDbName);
    const now = new Date().toISOString();
    const items = db.collection("items");
    const quests = db.collection("weeklyQuests");

    for (const job of JOB_ITEMS) {
      const existing = await items.findOne({ id: job.id });
      const payload = existing
        ? { ...existing, ...job, updatedAt: now }
        : { ...job, createdAt: now, updatedAt: now };
      await items.updateOne({ id: job.id }, { $set: payload }, { upsert: true });
      console.log(`[ok] upserted job item: ${job.id} (${job.name})`);
    }

    for (const quest of QUESTS) {
      const existing = await quests.findOne({ cadence: "job", rewardItemId: quest.rewardItemId });
      const payload = existing
        ? { ...existing, ...quest, updatedAt: now }
        : { id: randomUUID(), ...quest, createdAt: now, updatedAt: now };
      await quests.updateOne(
        { cadence: "job", rewardItemId: quest.rewardItemId },
        { $set: payload },
        { upsert: true }
      );
      console.log(`[ok] upserted job quest: ${quest.rewardItemId} (${quest.title})`);
    }
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error("[error] upsert support aura jobs failed:", error);
  process.exitCode = 1;
});
