"use strict";
require("dotenv").config();
const { MongoClient } = require("mongodb");
const config = require("../src/config");

const JOB_ITEM_ID = "job_mage_v1";

const OFFHAND_WEAPON_TYPES = ["offhand_staff"];

const JOB_ITEM = {
  id: JOB_ITEM_ID,
  name: "法師",
  description: "操控元素的施法者，杖術與元素效果為核心。",
  itemType: "job_badge",
  imageUrl: null,
  imageThumbnailUrl: null,
  effect: { type: "none", value: 0 },
  useEffects: [],
  equipSlot: "job_eq",
  equipStats: { int: 5, vit: 1, luk: 2 },
  weaponType: null,
  isTwoHanded: false,
  atkStat: null,
  tier: "A",
  passiveEffects: [
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
      notes: "主手為單手杖時武器倍率 x1.2"
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
      notes: "單手杖 + 盾：格擋 +20%"
    }
  ],
  procEffects: [],
  combatEffects: [
    // 雙手杖：武器倍率 x1.2
    {
      key: "atk_multiplier_up",
      trigger: "passive",
      target: "self",
      chance: 100,
      stacks: 1,
      stackMode: "replace",
      duration: { mode: "battle", value: 1 },
      params: { value: 1.2 },
      condition: { weaponType: "staff_2h" },
      notes: "雙手杖時武器倍率 x1.2"
    },
    // 雙手杖：命中時機率麻痺/燒傷/冰凍
    {
      key: "hit_down",
      trigger: "on_hit",
      target: "enemy",
      chance: 15,
      stacks: 1,
      stackMode: "refresh",
      duration: { mode: "turns", value: 3 },
      params: { value: 15 },
      condition: { weaponType: "staff_2h" },
      notes: "雙手杖：命中時 15% 機率麻痺（命中率 -15%，持續 3 回合，刷新）"
    },
    {
      key: "burn",
      trigger: "on_hit",
      target: "enemy",
      chance: 15,
      stacks: 1,
      stackMode: "refresh",
      duration: { mode: "turns", value: 3 },
      params: { value: 0.8, mode: "pct" },
      condition: { weaponType: "staff_2h" },
      notes: "雙手杖：命中時 15% 機率燒傷（每回合 0.8% HP，持續 3 回合，刷新）"
    },
    {
      key: "freeze",
      trigger: "on_hit",
      target: "enemy",
      chance: 15,
      stacks: 1,
      stackMode: "replace",
      duration: { mode: "turns", value: 1 },
      params: { bossImmune: true },
      condition: { weaponType: "staff_2h" },
      notes: "雙手杖：命中時 15% 機率冰凍（該回合無法行動，BOSS 無效）"
    },
    // 雙手杖 + 高血量 (>75%)：傷害再上升 15%
    {
      key: "final_damage_up",
      trigger: "on_high_hp",
      target: "self",
      chance: 100,
      stacks: 1,
      stackMode: "replace",
      duration: { mode: "battle", value: 1 },
      params: { value: 1.15, thresholdPct: 75 },
      condition: { weaponType: "staff_2h" },
      notes: "雙手杖且血量 >75% 時傷害 +15%"
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
  console.error("[error] upsert job mage failed:", error);
  process.exitCode = 1;
});
