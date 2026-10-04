"use strict";

// 暫停開放；保留物品、任務設計及收藏紀錄。重新開放只改此閘門並重新驗收。
const { isDisabledSEquipment } = require("./sEquipmentFeature");
const ANCHORS_ENABLED = false;
const ANCHOR_DISABLED_MESSAGE = "錨點本季暫停開放，既有收藏保留，屬性與效果不生效。";
const { ANCHOR_ACQUISITION_HINTS } = require("./anchorAcquisition");
const ANCHOR_IDS = new Set(Object.keys(ANCHOR_ACQUISITION_HINTS));

function isAnchorItem(item) {
  if (!item) return false;
  if (typeof item === "string") return ANCHOR_IDS.has(item);
  return item.equipSlot === "anchor" || ANCHOR_IDS.has(String(item.itemId || item.itemLibraryId || item.id || ""));
}
function isDisabledAnchor(item) {
  return !ANCHORS_ENABLED && isAnchorItem(item);
}
function assertAnchorAvailable(item) {
  if (!isDisabledAnchor(item)) return;
  const { AppError } = require("./errors");
  throw new AppError("FEATURE_DISABLED", ANCHOR_DISABLED_MESSAGE, 403);
}
function activeEquipment(equipped = {}) {
  return Object.fromEntries(Object.entries(equipped || {}).map(([slot, item]) =>
    [slot, (!ANCHORS_ENABLED && slot === "anchor") || isDisabledAnchor(item) || isDisabledSEquipment(item, slot) ? null : item]));
}
module.exports = { ANCHORS_ENABLED, ANCHOR_DISABLED_MESSAGE, isAnchorItem, isDisabledAnchor, assertAnchorAvailable, activeEquipment };
