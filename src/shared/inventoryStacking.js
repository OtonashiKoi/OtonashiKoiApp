const { randomUUID } = require("crypto");
const { ENHANCE_GEMS } = require("./enhanceConfig");

const ENHANCE_GEM_IDS = new Set(Object.values(ENHANCE_GEMS));

function isEnhanceGemItemId(itemId) {
  return ENHANCE_GEM_IDS.has(String(itemId || ""));
}

// 可疊加消耗品（藥水）：同款自動合併成一堆(stackCount)，省背包格。
// 藥水無 per-instance 狀態(不可強化/鎖定/裝備)，合併安全。新增藥水記得加進來。
const STACKABLE_CONSUMABLE_IDS = new Set([
  "87b281be-b175-40a0-8044-0accc88a0ee0", // 屬性重製藥水
  "f56aefd0-faa8-45b5-8451-fbbae5810c74", // 回復藥水（小）
  "97fbd546-e207-4130-b130-2fadd799703a", // 回復藥水（中）
  "3eb1d302-3d04-40a5-8335-1f9ed844dc27", // 回復藥水（大）
  "12bfb110-6489-4784-8537-f3f496759f8f", // 復活藥水（小）
  "c4794326-ced1-4efe-983d-17c14ee2f2f8", // 復活藥水（大）
  "enchant_reroll_potion",                // 附魔重骰藥水
]);
function isStackableConsumableId(itemId) {
  return STACKABLE_CONSUMABLE_IDS.has(String(itemId || ""));
}
// 可疊加(合併)判斷：強化寶石 + 藥水
function isStackMergeable(itemId) {
  return isEnhanceGemItemId(itemId) || isStackableConsumableId(itemId);
}

function buildEnhanceGemEntry(item, quantity = 1, extraFields = {}) {
  if (!item || !item.id) return null;
  const stackCount = Math.max(1, Math.trunc(Number(quantity) || 1));
  return {
    uuid: randomUUID(),
    itemId: item.id,
    itemName: item.name,
    itemEffect: item.effect || { type: "none", value: 0 },
    useEffects: item.useEffects || [],
    passiveEffects: item.passiveEffects || [],
    procEffects: item.procEffects || [],
    combatEffects: item.combatEffects || [],
    itemType: item.itemType || "consumable",
    imageUrl: item.imageUrl || null,
    imageThumbnailUrl: item.imageThumbnailUrl || null,
    equipSlot: item.equipSlot || null,
    equipStats: item.equipStats || null,
    weaponType: item.weaponType || null,
    isTwoHanded: item.isTwoHanded || false,
    atkStat: item.atkStat || null,
    tier: item.tier || null,
    monsterCardSkill: item.monsterCardSkill || null,
    enhanceLevel: 0,
    stackCount,
    purchasedAt: new Date().toISOString(),
    ...extraFields
  };
}

function syncEnhanceGemEntry(entry, item, quantity = 1, extraFields = {}) {
  if (!entry || !item?.id) return entry;
  const stackCount = Math.max(1, Math.trunc(Number(quantity) || 1));
  return {
    ...entry,
    itemId: item.id,
    itemName: item.name,
    itemEffect: item.effect || entry.itemEffect || { type: "none", value: 0 },
    useEffects: item.useEffects || entry.useEffects || [],
    passiveEffects: item.passiveEffects || entry.passiveEffects || [],
    procEffects: item.procEffects || entry.procEffects || [],
    combatEffects: item.combatEffects || entry.combatEffects || [],
    itemType: item.itemType || entry.itemType || "consumable",
    imageUrl: item.imageUrl || entry.imageUrl || null,
    imageThumbnailUrl: item.imageThumbnailUrl || entry.imageThumbnailUrl || null,
    equipSlot: item.equipSlot || entry.equipSlot || null,
    equipStats: item.equipStats || entry.equipStats || null,
    weaponType: item.weaponType || entry.weaponType || null,
    isTwoHanded: item.isTwoHanded ?? entry.isTwoHanded ?? false,
    atkStat: item.atkStat || entry.atkStat || null,
    tier: item.tier || entry.tier || null,
    monsterCardSkill: item.monsterCardSkill || entry.monsterCardSkill || null,
    stackCount: Math.max(1, Number(entry.stackCount) || 1) + stackCount - 1,
    ...extraFields
  };
}

function addEnhanceGemToInventory(inventory, item, quantity = 1, extraFields = {}) {
  if (!Array.isArray(inventory) || !item?.id || !isEnhanceGemItemId(item.id)) return false;
  const qty = Math.max(1, Math.trunc(Number(quantity) || 1));
  const existing = inventory.find((entry) => entry?.itemId === item.id);
  if (existing) {
    const synced = syncEnhanceGemEntry(existing, item, qty, extraFields);
    Object.assign(existing, synced);
    return true;
  }
  inventory.push(buildEnhanceGemEntry(item, qty, extraFields));
  return true;
}

function normalizeEnhanceGemStacks(inventory) {
  if (!Array.isArray(inventory) || inventory.length === 0) return Array.isArray(inventory) ? inventory : [];

  const merged = [];
  const byItemId = new Map();

  for (const entry of inventory) {
    // 強化寶石 + 藥水才合併；鎖定件保險起見不合併(藥水本不可鎖，防呆)
    if (!entry || typeof entry !== "object" || entry.locked || !isStackMergeable(entry.itemId)) {
      merged.push(entry);
      continue;
    }

    const itemId = String(entry.itemId);
    const count = Math.max(1, Math.trunc(Number(entry.stackCount) || 1));
    const existing = byItemId.get(itemId);
    if (existing) {
      existing.stackCount = Math.max(1, Number(existing.stackCount) || 1) + count;
      continue;
    }

    const normalized = {
      ...entry,
      stackCount: count
    };
    byItemId.set(itemId, normalized);
    merged.push(normalized);
  }

  return merged;
}

module.exports = {
  ENHANCE_GEM_IDS,
  isEnhanceGemItemId,
  STACKABLE_CONSUMABLE_IDS,
  isStackableConsumableId,
  isStackMergeable,
  buildEnhanceGemEntry,
  syncEnhanceGemEntry,
  addEnhanceGemToInventory,
  normalizeEnhanceGemStacks
};
