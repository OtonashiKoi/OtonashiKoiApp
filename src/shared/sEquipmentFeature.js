"use strict";

// S 主手與胡桃三件 S 副手開放；其餘 S 穿戴裝備暫停取得、使用與效果。
const S_NON_WEAPON_ENABLED = false;
const S_DISABLED_MESSAGE = "S 防具、飾品與其他 S 副手暫未開放；胡桃的雙風脇差、羽切短刃、四喜雀盾已開放。";
const ENABLED_S_OFFHAND_IDS = new Set(["hutao-wind-offhand-sword", "hutao-wind-offhand-dagger", "hutao-wind-shield"]);
const NON_WEAPON_SLOTS = new Set(["shield", "offhand", "head_top", "head_mid", "head_low", "armor", "garment", "shoes", "accessory", "accessory_l", "accessory_r"]);
function isDisabledSEquipment(item, slot = null) {
  if (item && ENABLED_S_OFFHAND_IDS.has(String(item.itemId || item.itemLibraryId || item.id || ""))
    && ["shield", "offhand"].includes(String(item.equipSlot || slot || ""))) return false;
  return !S_NON_WEAPON_ENABLED && item && typeof item === "object"
    && String(item.tier || "").toUpperCase() === "S"
    && (NON_WEAPON_SLOTS.has(String(item.equipSlot || "")) || NON_WEAPON_SLOTS.has(String(slot || "")));
}
module.exports = { S_NON_WEAPON_ENABLED, S_DISABLED_MESSAGE, isDisabledSEquipment };
