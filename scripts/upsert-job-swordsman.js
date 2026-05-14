"use strict";
require("dotenv").config();
const { MongoClient } = require("mongodb");
const config = require("../src/config");

const JOB_ITEM_ID = "job_swordsman_v1";

const OFFHAND_WEAPON_TYPES = ["offhand_sword", "offhand_dagger", "offhand_mace"];

const JOB_ITEM = {
  id: JOB_ITEM_ID,
  name: "劍士徽章",
  description: "專精單手劍與雙手劍的前線職業。",
  itemType: "job_badge",
  imageUrl: null,
  imageThumbnailUrl: null,
  effect: { type: "none", value: 0 },
  useEffects: [],
  equipSlot: "job_eq",
  equipStats: { str: 2, vit: 3, dex: 2 },
  weaponType: null,
  isTwoHanded: false,
  atkStat: null,
  tier: null,
  passiveEffects: [
    // 主武器單手劍：武器倍率結算後再乘 1.2
    {
      key: "atk_multiplier_up",
      trigger: "passive",
      target: "self",
      chance: 100,
      stacks: 1,
      stackMode: "replace",
      duration: { mode: "battle", value: 1 },
      params: { value: 1.2 },
      condition: { weaponType: "sword_1h" },
      notes: "主武器為單手劍時，ATK x1.2"
    },
    // 主武器單手劍 + 副手盾牌：格擋 +15%
    {
      key: "block_chance_up",
      trigger: "passive",
      target: "self",
      chance: 100,
      stacks: 1,
      stackMode: "replace",
      duration: { mode: "battle", value: 1 },
      params: { value: 15 },
      condition: {
        all: [
          { weaponType: "sword_1h" },
          { equippedSlot: "shield" },
          { notWeaponType: OFFHAND_WEAPON_TYPES }
        ]
      },
      notes: "單手劍 + 盾牌，格擋 +15%"
    },
    // 主武器單手劍 + 副手武器：連擊傷害 +10%
    {
      key: "combo_damage_up",
      trigger: "passive",
      target: "self",
      chance: 100,
      stacks: 1,
      stackMode: "replace",
      duration: { mode: "battle", value: 1 },
      params: { value: 1.1 },
      condition: {
        all: [
          { weaponType: "sword_1h" },
          {
            any: OFFHAND_WEAPON_TYPES.map((weaponType) => ({ weaponType }))
          }
        ]
      },
      notes: "單手劍 + 副手武器，連擊傷害 +10%"
    },
    // 主武器雙手劍：武器倍率結算後再乘 1.2
    {
      key: "atk_multiplier_up",
      trigger: "passive",
      target: "self",
      chance: 100,
      stacks: 1,
      stackMode: "replace",
      duration: { mode: "battle", value: 1 },
      params: { value: 1.2 },
      condition: { weaponType: "sword_2h" },
      notes: "主武器為雙手劍時，ATK x1.2"
    },
    // 主武器雙手劍：格擋 +20%
    {
      key: "block_chance_up",
      trigger: "passive",
      target: "self",
      chance: 100,
      stacks: 1,
      stackMode: "replace",
      duration: { mode: "battle", value: 1 },
      params: { value: 20 },
      condition: { weaponType: "sword_2h" },
      notes: "雙手劍時，格擋 +20%"
    },
  ],
  procEffects: [],
  combatEffects: [],
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
  console.error("[error] upsert job swordsman failed:", error);
  process.exitCode = 1;
});
