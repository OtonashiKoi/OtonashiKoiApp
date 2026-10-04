"use strict";

// S 主手武器開放；其他 S 穿戴裝備保留收藏，暫停取得、使用與效果。
const S_NON_WEAPON_ENABLED = false;
const S_DISABLED_MESSAGE = "S 防具、飾品與副手暫未開放；既有物品保留，屬性與效果不生效。";
const NON_WEAPON_SLOTS = new Set(["shield", "offhand", "head_top", "head_mid", "head_low", "armor", "garment", "shoes", "accessory", "accessory_l", "accessory_r"]);
function isDisabledSEquipment(item, slot = null) {
  return !S_NON_WEAPON_ENABLED && item && typeof item === "object"
    && String(item.tier || "").toUpperCase() === "S"
    && (NON_WEAPON_SLOTS.has(String(item.equipSlot || "")) || NON_WEAPON_SLOTS.has(String(slot || "")));
}
module.exports = { S_NON_WEAPON_ENABLED, S_DISABLED_MESSAGE, isDisabledSEquipment };
