"use strict";
require("dotenv").config();
const { MongoClient } = require("mongodb");
const config = require("../src/config");

const JOB_ITEM_ID = "job_healer_v1";

const JOB_ITEM = {
  id: JOB_ITEM_ID,
  name: "治療師徽章",
  description: "提供隊伍治療光環的徽章，被動使同場玩家獲得每回合回復。",
  itemType: "job_badge",
  equipSlot: "job_eq",
  equipStats: { int: 4, vit: 2, dex: 2 },
  passiveEffects: [
    {
      key: "heal_over_time",
      trigger: "passive",
      target: "party",
      chance: 100,
      stacks: 1,
      stackMode: "replace",
      duration: { mode: "battle", value: 1 },
      params: { value: 3, mode: "pct" },
      notes: "每回合回復隊伍成員 3% 最大 HP（需要治療師在場才生效）"
    }
  ],
  combatEffects: [
    // 單手杖：武器倍率 x1.2
    {
      key: "atk_multiplier_up",
      trigger: "passive",
      target: "self",
      chance: 100,
      stacks: 1,
      stackMode: "replace",
      duration: { mode: "battle", value: 1 },
      params: { value: 1.2 },
      condition: { weaponType: "staff_1h" },
      notes: "主武為單手杖時武器倍率 x1.2（在武器倍率結算後）"
    },
    // 單手杖 + 盾：格擋 +20%
    {
      key: "block_chance_up",
      trigger: "passive",
      target: "self",
      chance: 100,
      stacks: 1,
      stackMode: "replace",
      duration: { mode: "battle", value: 1 },
      params: { value: 20 },
      condition: { all: [ { weaponType: "staff_1h" }, { equippedSlot: "shield" } ] },
      notes: "主武為單手杖且副武為盾牌時：格擋 +20%"
    },
    // 雙手杖：武器倍率 x1.4
    {
      key: "atk_multiplier_up",
      trigger: "passive",
      target: "self",
      chance: 100,
      stacks: 1,
      stackMode: "replace",
      duration: { mode: "battle", value: 1 },
      params: { value: 1.4 },
      condition: { weaponType: "staff_2h" },
      notes: "主武為雙手杖時武器倍率 x1.4（在武器倍率結算後）"
    },
    // 共鬥：隊伍每回合傷害增加 5%
    {
      key: "party_damage_up",
      trigger: "passive",
      target: "party",
      chance: 100,
      stacks: 1,
      stackMode: "replace",
      duration: { mode: "battle", value: 1 },
      params: { value: 5, mode: "pct" },
      notes: "參與戰鬥人員每回合總傷害增加 5%（需要治療師在場才生效）"
    }
  ],
  procEffects: [],
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
  console.error("[error] upsert job healer failed:", error);
  process.exitCode = 1;
});
