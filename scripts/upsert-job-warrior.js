"use strict";
require("dotenv").config();
const { MongoClient } = require("mongodb");
const config = require("../src/config");

const JOB_ITEM_ID = "job_warrior_v1";

const OFFHAND_WEAPON_TYPES = ["offhand_axe", "offhand_mace"];

const JOB_ITEM = {
  id: JOB_ITEM_ID,
  name: "戰士",
  description: "專精斧類武器的前線職業。",
  itemType: "job_badge",
  imageUrl: null,
  imageThumbnailUrl: null,
  effect: { type: "none", value: 0 },
  useEffects: [],
  equipSlot: "job_eq",
  equipStats: { str: 4, vit: 1, luk: 2 },
  weaponType: null,
  isTwoHanded: false,
  atkStat: null,
  tier: "A",
  passiveEffects: [
    // 主武器為單手斧：武器倍率結算後再乘 1.2
    {
      key: "atk_multiplier_up",
      trigger: "passive",
      target: "self",
      chance: 100,
      stacks: 1,
      stackMode: "replace",
      duration: { mode: "battle", value: 1 },
      params: { value: 1.2 },
      condition: { weaponType: "axe_1h" },
      notes: "主手為單手斧時武器倍率 x1.2"
    },
    // 主武器單手斧 + 盾牌：格擋 +15%
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
          { weaponType: "axe_1h" },
          { equippedSlot: "shield" },
          { notWeaponType: OFFHAND_WEAPON_TYPES }
        ]
      },
      notes: "單手斧 + 盾牌：格擋 +15%"
    },
    // 主武器單手斧 + 副手武器：連擊傷害 +10%
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
          { weaponType: "axe_1h" },
          { any: OFFHAND_WEAPON_TYPES.map((weaponType) => ({ weaponType })) }
        ]
      },
      notes: "單手斧 + 副手武器：連擊傷害 +10%"
    },
    // 主武器雙手斧：武器倍率結算後再乘 1.2
    {
      key: "atk_multiplier_up",
      trigger: "passive",
      target: "self",
      chance: 100,
      stacks: 1,
      stackMode: "replace",
      duration: { mode: "battle", value: 1 },
      params: { value: 1.2 },
      condition: { weaponType: "axe_2h" },
      notes: "雙手斧時，武器倍率 x1.2"
    },
    // 主武器雙手斧：暴擊率 +5%
    {
      key: "crit_rate_up",
      trigger: "passive",
      target: "self",
      chance: 100,
      stacks: 1,
      stackMode: "replace",
      duration: { mode: "battle", value: 1 },
      params: { value: 5 },
      condition: { weaponType: "axe_2h" },
      notes: "雙手斧時，暴擊率 +5%"
    }
  ],
  procEffects: [],
  combatEffects: [
    // 主武器雙手斧時：自身生命低於35% 時傷害提升 15%
    {
      key: "final_damage_up",
      trigger: "on_low_hp",
      target: "self",
      chance: 100,
      stacks: 1,
      stackMode: "replace",
      duration: { mode: "battle", value: 1 },
      params: { value: 1.15 },
      condition: { weaponType: "axe_2h" },
      notes: "雙手斧：低血 (<35%) 時傷害 +15%（需由戰鬥事件觸發）"
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
  console.error("[error] upsert job warrior failed:", error);
  process.exitCode = 1;
});
