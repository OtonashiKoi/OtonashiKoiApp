"use strict";
require("dotenv").config();
const { MongoClient } = require("mongodb");
const config = require("../src/config");

const JOB_ITEM_ID = "job_dwarf_warrior_v1";

const OFFHAND_WEAPON_TYPES = ["offhand_mace", "offhand_hammer"];

const JOB_ITEM = {
  id: JOB_ITEM_ID,
  name: "矮人戰士",
  description: "專精槌類武器的矮人工匠戰士。",
  itemType: "job_badge",
  imageUrl: null,
  imageThumbnailUrl: null,
  effect: { type: "none", value: 0 },
  useEffects: [],
  equipSlot: "job_eq",
  equipStats: { str: 1, vit: 5, dex: 2 },
  weaponType: null,
  isTwoHanded: false,
  atkStat: null,
  tier: "A",
  passiveEffects: [
    // 主武器單手槌：武器倍率結算後再乘 1.2
    {
      key: "atk_multiplier_up",
      trigger: "passive",
      target: "self",
      chance: 100,
      stacks: 1,
      stackMode: "replace",
      duration: { mode: "battle", value: 1 },
      params: { value: 1.2 },
      condition: { weaponType: "mace_1h" },
      notes: "主手為單手槌時武器倍率 x1.2"
    },
    // 主武器單手槌 + 盾牌：格擋 +20%
    {
      key: "block_chance_up",
      trigger: "passive",
      target: "self",
      chance: 100,
      stacks: 1,
      stackMode: "replace",
      duration: { mode: "battle", value: 1 },
      params: { value: 20 },
      condition: {
        all: [
          { weaponType: "mace_1h" },
          { equippedSlot: "shield" },
          { notWeaponType: OFFHAND_WEAPON_TYPES }
        ]
      },
      notes: "單手槌 + 盾牌：格擋 +20%"
    },
    // 主武器單手槌 + 副手武器：連擊傷害 +10%
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
          { weaponType: "mace_1h" },
          { any: OFFHAND_WEAPON_TYPES.map((weaponType) => ({ weaponType })) }
        ]
      },
      notes: "單手槌 + 副手武器：連擊傷害 +10%"
    },
    // 主武器雙手槌：武器倍率結算後再乘 1.2
    {
      key: "atk_multiplier_up",
      trigger: "passive",
      target: "self",
      chance: 100,
      stacks: 1,
      stackMode: "replace",
      duration: { mode: "battle", value: 1 },
      params: { value: 1.2 },
      condition: { weaponType: "mace_2h" },
      notes: "雙手槌時，武器倍率 x1.2"
    }
  ],
  procEffects: [
    // 主武器雙手槌：額外 10% 機率暈眩（on_hit/upcoming triggers）
    {
      key: "proc_stun",
      trigger: "on_hit",
      target: "enemy",
      chance: 5,
      stacks: 1,
      stackMode: "replace",
      duration: { mode: "turns", value: 1 },
      params: {},
      condition: { weaponType: "mace_2h" },
      notes: "雙手槌：5% 機率暈眩"
    }
  ],
  combatEffects: [
    // 主武器雙手槌時：玩家血量高於75% 時暈眩機率增加 10%
    {
      key: "stun_chance_up",
      trigger: "on_high_hp",
      target: "self",
      chance: 100,
      stacks: 1,
      stackMode: "replace",
      duration: { mode: "battle", value: 1 },
      params: { value: 5 },
      condition: { weaponType: "mace_2h" },
      notes: "雙手槌：高血 (>90%) 時暈眩機率 +5%"
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
  console.error("[error] upsert job dwarf warrior failed:", error);
  process.exitCode = 1;
});
