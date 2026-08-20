"use strict";

const assert = require("assert");
const { isPetGatherableEquipment } = require("../src/services/pet/petService");

const ordinary = {
  id: "ordinary-a-gear",
  itemType: "equipment",
  tier: "A",
  equipSlot: "armor",
};

assert.strictEqual(isPetGatherableEquipment(ordinary), true, "一般已開放裝備應可進入寵物採集池");

for (const [label, patch] of [
  ["停用裝備", { enabled: false }],
  ["私測裝備", { previewOnly: true }],
  ["明確禁止寵物採集", { noPetGather: true }],
  ["限定活動裝備", { limitedEvent: true }],
  ["怪物卡", { monsterCardOf: "monster-id", equipSlot: "special" }],
  ["職業徽章", { equipSlot: "job_eq" }],
  ["稱號", { equipSlot: "title_eq" }],
  ["錨點", { equipSlot: "anchor" }],
]) {
  assert.strictEqual(
    isPetGatherableEquipment({ ...ordinary, ...patch }),
    false,
    `${label}不得進入寵物採集池`
  );
}

assert.strictEqual(
  isPetGatherableEquipment({ ...ordinary, itemType: "consumable" }),
  false,
  "非裝備不得進入隨機裝備池"
);

console.log("✅ 寵物採集資格：未開放、限定與專屬裝備皆已排除");
