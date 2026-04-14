"use strict";
require("dotenv").config();
const { MongoClient } = require("mongodb");
const config = require("../src/config");

const JOB_ITEM_ID = "job_rogue_v1";

const OFFHAND_WEAPON_TYPES = ["offhand_dagger"];

const JOB_ITEM = {
  id: JOB_ITEM_ID,
  name: "盜賊",
  description: "以匕首速攻與敏捷迴避為主的職業徽章。",
  itemType: "equipment",
  imageUrl: null,
  imageThumbnailUrl: null,
  effect: { type: "none", value: 0 },
  useEffects: [],
  equipSlot: "job_eq",
  equipStats: { str: 2, agi: 4, luk: 2 },
  weaponType: null,
  isTwoHanded: false,
  atkStat: null,
  tier: "A",
  passiveEffects: [
    // 主武器為匕首時：武器倍率結算後再乘 1.2
    {
      key: "atk_multiplier_up",
      trigger: "passive",
      target: "self",
      chance: 100,
      stacks: 1,
      stackMode: "replace",
      duration: { mode: "battle", value: 1 },
      params: { value: 1.2 },
      condition: { weaponType: "dagger" },
      notes: "主手為匕首時武器倍率 x1.2"
    },
    // 主武為匕首且裝盾：格擋 +10%
    {
      key: "block_chance_up",
      trigger: "passive",
      target: "self",
      chance: 100,
      stacks: 1,
      stackMode: "replace",
      duration: { mode: "battle", value: 1 },
      params: { value: 10 },
      condition: { all: [ { weaponType: "dagger" }, { equippedSlot: "shield" } ] },
      notes: "主武匕首 + 盾：格擋 +10%"
    },
    // 主匕首 + 副手武器：連擊率 +5%
    {
      key: "combo_up",
      trigger: "passive",
      target: "self",
      chance: 100,
      stacks: 1,
      stackMode: "replace",
      duration: { mode: "battle", value: 1 },
      params: { value: 5 },
      condition: { all: [ { weaponType: "dagger" }, { any: OFFHAND_WEAPON_TYPES.map((weaponType) => ({ weaponType })) } ] },
      notes: "主武匕首 + 副手武器：連擊率 +5%"
    }
  ],
  procEffects: [
    // 主武為匕首：命中時機率造成中毒
    {
      key: "proc_poison",
      trigger: "on_hit",
      target: "enemy",
      chance: 20,
      stacks: 1,
      stackMode: "replace",
      duration: { mode: "turns", value: 3 },
      params: { value: 0.5, mode: "pct", stackAdd: 0.5, maxPct: 2 },
      condition: { weaponType: "dagger" },
      notes: "主武匕首：命中時 20% 機率造成中毒（每回合 0.5% HP，持續 3 回合，每次觸發增加 0.5% 並刷新，最高疊至 2%）"
    }
  ],
  combatEffects: [
    // 主匕首 + 副手武器 且 玩家血量 >80% 時：爆擊率 +15%
    {
      key: "crit_rate_up",
      trigger: "on_high_hp",
      target: "self",
      chance: 100,
      stacks: 1,
      stackMode: "replace",
      duration: { mode: "battle", value: 1 },
      params: { value: 15, thresholdPct: 80 },
      condition: { all: [ { weaponType: "dagger" }, { any: OFFHAND_WEAPON_TYPES.map((weaponType) => ({ weaponType })) } ] },
      notes: "主匕首 + 副手武器且血量 >80% 時爆擊率 +15%"
    }
  ],
  enhanceLevel: 0
};

async function main() {
  const client = new MongoClient(config.storage.mongoUri);
  await client.connect();
  const db = client.db(config.storage.mongoDbName);
  const items = db.collection("items");

  const now = new Date().toISOString();
  const existing = await items.findOne({ id: JOB_ITEM_ID });
  const payload = existing
    ? { ...existing, ...JOB_ITEM, updatedAt: now }
    : { ...JOB_ITEM, createdAt: now, updatedAt: now };

  await items.updateOne({ id: JOB_ITEM_ID }, { $set: payload }, { upsert: true });
  console.log(`[ok] upserted job item: ${JOB_ITEM_ID} (${JOB_ITEM.name})`);

  await client.close();
}

main().catch((error) => {
  console.error("[error] upsert job rogue failed:", error);
  process.exitCode = 1;
});
