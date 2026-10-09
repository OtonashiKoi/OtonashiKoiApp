"use strict";

const TWO_HANDED_WEAPON_TYPES = new Set(["sword_2h", "axe_2h", "mace_2h", "staff_2h", "bow", "dice"]);

// 雙手主武器佔用主副手兩個位置，在具名與階級套裝都計作兩件。
// 舊裝備快照可能缺少 isTwoHanded，因此也依武器種類辨識。
function equipmentSetPieceWeight(item, slot) {
  if (!item || slot !== "weapon") return 1;
  return item.isTwoHanded === true || TWO_HANDED_WEAPON_TYPES.has(String(item.weaponType || "")) ? 2 : 1;
}

module.exports = { equipmentSetPieceWeight };
