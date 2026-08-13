"use strict";

const assert = require("assert");
const { ShopService } = require("../src/services/shop/shopService");

function item(uuid, itemId, itemName, equipSlot, weaponType = null, equipStats = {}) {
  return { uuid, itemId, itemName, itemType: "equipment", equipSlot, weaponType, equipStats };
}

async function run() {
  let saved = null;
  const progress = {
    playerId: "auto-equip-test",
    level: 50,
    attributes: { str: 10, agi: 1, vit: 1, int: 1, dex: 30, luk: 1 },
    inventory: [
      item("sword", "sword", "測試單手劍", "weapon", "sword_1h"),
      item("bow", "bow", "測試長弓", "weapon", "bow"),
      item("str-armor", "str-armor", "力量鎧甲", "armor", null, { str: 10 }),
      item("dex-armor", "dex-armor", "靈巧鎧甲", "armor", null, { dex: 20 }),
      item("shield", "shield", "測試盾牌", "shield", null, { str: 1 }),
    ],
    equipment: {
      job_eq: { uuid: "job", itemId: "job_swordsman_v1", itemName: "劍士徽章", itemType: "job_badge", equipSlot: "job_eq" },
      special_1: { uuid: "card", itemId: "card", itemName: "測試卡片", itemType: "equipment", equipSlot: "special" },
      anchor: { uuid: "anchor", itemId: "anchor", itemName: "測試錨點", itemType: "equipment", equipSlot: "anchor" },
    },
  };
  const repo = {
    findByPlayerId: async () => structuredClone(progress),
    save: async (next) => { saved = structuredClone(next); },
  };
  const itemRepo = { findById: async () => null };
  const service = new ShopService(null, null, null, repo, null, itemRepo, null);
  const result = await service.autoEquipMaxAtk(progress.playerId);

  assert.equal(result.weaponType, "sword_1h", "有劍士徽章時只能選劍系武器");
  assert.equal(saved.equipment.armor.uuid, "str-armor", "應依武器主屬性選擇 ATK 較高防具");
  assert.equal(saved.equipment.job_eq.uuid, "job", "職業徽章必須保留");
  assert.equal(saved.equipment.special_1.uuid, "card", "卡片必須保留");
  assert.equal(saved.equipment.anchor.uuid, "anchor", "錨點必須保留");
  assert(saved.inventory.some((entry) => entry.uuid === "bow"), "未選武器必須回到背包");
  console.log("✅ auto equip: job restriction, ATK choice and protected slots passed");
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
