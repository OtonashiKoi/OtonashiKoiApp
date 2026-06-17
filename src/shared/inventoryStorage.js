"use strict";
/**
 * 背包(inventory)儲存瘦身。
 *
 * 背景:每個 inventory 實例原本存了一份「可從道具庫(itemId)還原」的肥欄位
 * (圖片網址、各種特效陣列、說明)。玩家大量囤裝備時,progress 文件會撐爆
 * MongoDB 單一文件 16MB 上限,導致戰鬥結算 save 失敗。
 *
 * 這些欄位在讀取時都會即時還原:
 *   - 網頁 /api/me/profile?inventory:依 itemId 從庫補 imageUrl/縮圖/說明/effectLines
 *   - 已裝備的裝備:mergeEquippedFromLibrary 依 itemId 從庫補回 passive/proc/combat 特效
 *   - 戰鬥引擎(effectEngine)對「背包」道具只看 itemId(集合判定),不讀其特效陣列
 * 因此儲存時可安全去除,大幅縮小文件;每個實例只保留「實例專屬」資料
 * (uuid/itemId/名稱/類型/槽位/階級/強化值/equipStats/堆疊數/武器型態等)。
 */

// 可從道具庫還原、或戰鬥不依賴背包實例的重欄位 → 儲存時移除
const REDUNDANT_INVENTORY_FIELDS = [
  "imageUrl",
  "imageThumbnailUrl",
  "description",
  "effectLines",
  "useEffects",
  "passiveEffects",
  "procEffects",
  "combatEffects"
];

function slimInventoryEntry(entry) {
  if (!entry || typeof entry !== "object") return entry;
  let touched = false;
  const out = { ...entry };
  for (const k of REDUNDANT_INVENTORY_FIELDS) {
    if (k in out) { delete out[k]; touched = true; }
  }
  return touched ? out : entry;
}

/** 回傳 inventory 陣列的瘦身版本(淺拷貝,不改原陣列) */
function slimInventoryArray(inventory) {
  if (!Array.isArray(inventory)) return inventory;
  return inventory.map(slimInventoryEntry);
}

/** 回傳 progress 文件的瘦身版本(只動 inventory,equipment 不動) */
function slimProgressForStorage(progress) {
  if (!progress || typeof progress !== "object" || !Array.isArray(progress.inventory)) return progress;
  return { ...progress, inventory: slimInventoryArray(progress.inventory) };
}

module.exports = {
  REDUNDANT_INVENTORY_FIELDS,
  slimInventoryEntry,
  slimInventoryArray,
  slimProgressForStorage
};
