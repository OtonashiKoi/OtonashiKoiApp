const { randomUUID } = require("crypto");
const { ENHANCE_GEMS } = require("./enhanceConfig");

const ENHANCE_GEM_IDS = new Set(Object.values(ENHANCE_GEMS));

function isEnhanceGemItemId(itemId) {
  return ENHANCE_GEM_IDS.has(String(itemId || ""));
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
  const gemByItemId = new Map();

  for (const entry of inventory) {
    if (!entry || typeof entry !== "object" || !isEnhanceGemItemId(entry.itemId)) {
      merged.push(entry);
      continue;
    }

    const itemId = String(entry.itemId);
    const count = Math.max(1, Math.trunc(Number(entry.stackCount) || 1));
    const existing = gemByItemId.get(itemId);
    if (existing) {
      existing.stackCount = Math.max(1, Number(existing.stackCount) || 1) + count;
      continue;
    }

    const normalized = {
      ...entry,
      stackCount: count
    };
    gemByItemId.set(itemId, normalized);
    merged.push(normalized);
  }

  return merged;
}

module.exports = {
  ENHANCE_GEM_IDS,
  isEnhanceGemItemId,
  buildEnhanceGemEntry,
  syncEnhanceGemEntry,
  addEnhanceGemToInventory,
  normalizeEnhanceGemStacks
};
