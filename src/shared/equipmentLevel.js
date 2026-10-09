"use strict";

const RARE_EQUIPMENT_MIN_LEVEL = 30;
const GEAR_SLOTS = new Set([
  "weapon", "shield", "head_top", "head_mid", "head_low",
  "armor", "garment", "shoes", "accessory_l", "accessory_r",
]);

function getEquipmentRequiredLevel(item, slot = null) {
  if (!item || !GEAR_SLOTS.has(String(slot || item.equipSlot || ""))) return 0;
  return ["A", "S"].includes(String(item.tier || "").toUpperCase()) ? RARE_EQUIPMENT_MIN_LEVEL : 0;
}
function isEquipmentLevelAllowed(item, level, slot = null) {
  const numericLevel = Number(level);
  return (Number.isFinite(numericLevel) ? Math.floor(numericLevel) : 1) >= getEquipmentRequiredLevel(item, slot);
}
function assertEquipmentLevel(item, level, slot = null) {
  if (isEquipmentLevelAllowed(item, level, slot)) return;
  const { AppError } = require("./errors");
  const currentLevel = Number.isFinite(Number(level)) ? Math.floor(Number(level)) : 1;
  throw new AppError("EQUIPMENT_LEVEL_REQUIRED", `${item.tier} 階裝備需要 Lv.${getEquipmentRequiredLevel(item, slot)} 以上才能穿戴（目前 Lv.${currentLevel}）`, 403);
}
function equipmentLevelView(item, level, slot = null) {
  return { equipRequiredLevel: getEquipmentRequiredLevel(item, slot), equipLevelAllowed: isEquipmentLevelAllowed(item, level, slot) };
}
function restoreEquipmentForLevel(character, inventory, libraryById = new Map()) {
  const moved = [];
  for (const [slot, item] of Object.entries(character.equipment || {})) {
    if (!item || !GEAR_SLOTS.has(slot)) continue;
    const lib = libraryById.get(item.itemId);
    const rules = lib ? { ...item, tier: lib.tier ?? item.tier } : item;
    if (isEquipmentLevelAllowed(rules, character.level, slot)) continue;
    if (!item.uuid || inventory.some(i => i.uuid === item.uuid)) {
      const { AppError } = require("./errors");
      throw new AppError("EQUIPMENT_INSTANCE_CONFLICT", "裝備實例重複或缺少識別碼，請聯絡管理員。", 409);
    }
    inventory.push(item);
    character.equipment[slot] = null;
    moved.push({ slot, uuid: item.uuid, itemId: item.itemId, itemName: item.itemName });
  }
  return moved;
}
module.exports = { RARE_EQUIPMENT_MIN_LEVEL, GEAR_SLOTS, getEquipmentRequiredLevel, isEquipmentLevelAllowed, assertEquipmentLevel, equipmentLevelView, restoreEquipmentForLevel };
