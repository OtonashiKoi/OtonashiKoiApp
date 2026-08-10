"use strict";

const { createGameProgress } = require("../../domain/progress/createGameProgress");
const { slimInventoryArray } = require("../../shared/inventoryStorage");

// 第一章劇情錨點跟著 storyProgress 跨季保留；不要泛用「綁定道具」判定，避免未來把賽季綁定物也留下。
const PERSISTENT_STORY_ITEM_IDS = new Set(["s-legend-resonance"]);

const RESET_UNSET_FIELDS = [
  "pkRating", "towerRecord", "bestiary", "jobTransfers", "levelReachedAt", "soloBoss", "zoneCombo",
  "bardScore", "bardStreak", "berserkGauge", "diceGauge", "diceLuck", "oniGauge", "sageGauge",
  "shadowGauge", "sniperGauge", "sunSpirit",
];

const SEASON_RESET_RULES = Object.freeze({
  keep: [
    "玩家身分與建立時間", "鑽石", "付費背包格", "會員階級", "稱號", "收藏品",
    "劇情進度", "跨季保留道具", "寵物圖鑑", "卡片圖鑑與已領收藏獎勵",
    "交易稽核紀錄", "舊季任務/簽到封存", "舊季拍賣紀錄",
  ],
  reset: [
    "等級/經驗/職業/配點", "戰鬥裝備與一般背包", "金幣與賽季背包格", "實際寵物",
    "怪物圖鑑", "PK/爬塔/單人王/KDA", "任務/簽到/掛機/疲勞", "一般賽季錨點",
    "拍賣上架", "怪物與世界王狀態", "直播賽季/短期加成與里程碑", "賽季通行證",
  ],
});

function itemTypeOf(item) {
  return String(item?.itemType || "").toLowerCase();
}

function isTitle(item) {
  return String(item?.equipSlot || "") === "title_eq" || itemTypeOf(item) === "title";
}

function isCollectible(item) {
  return ["collectible", "collection"].includes(itemTypeOf(item));
}

function isPersistentStoryItem(item) {
  return isSeasonPersistentItem(item);
}

function isSeasonPersistentItem(item, persistentItemIds = PERSISTENT_STORY_ITEM_IDS) {
  if (item?.seasonPersistent === true) return true;
  return persistentItemIds.has(String(item?.itemId || item?.id || ""));
}

function filterKeptInventory(inventory, persistentItemIds = PERSISTENT_STORY_ITEM_IDS) {
  const entries = Array.isArray(inventory) ? inventory : [];
  return slimInventoryArray(entries.filter((item) => {
    if (!item || itemTypeOf(item) === "pet_egg") return false;
    return isTitle(item) || isCollectible(item) || isSeasonPersistentItem(item, persistentItemIds);
  }));
}

function keepEquipped(item, predicate) {
  return item && predicate(item) ? item : null;
}

function buildProgressResetUpdate(oldProgress, nowIso = new Date().toISOString(), {
  seasonKey = null,
  persistentItemIds = PERSISTENT_STORY_ITEM_IDS,
} = {}) {
  const old = oldProgress || {};
  const fresh = createGameProgress(String(old.playerId || ""));
  fresh.equipment.title_eq = keepEquipped(old.equipment?.title_eq, isTitle);
  fresh.equipment.anchor = keepEquipped(old.equipment?.anchor, (item) => isSeasonPersistentItem(item, persistentItemIds));

  const set = {
    level: 1,
    exp: 0,
    job: "Novice",
    jobLevel: 1,
    statusPoints: 0,
    allocatedPoints: 0,
    allocatedAttrs: {},
    attributes: { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 },
    equipment: fresh.equipment,
    inventory: filterKeptInventory(old.inventory, persistentItemIds),
    equipPresets: {},
    activePreset: "A",
    activeEffects: [],
    pets: [],
    activePetUuid: null,
    pkWins: 0,
    pkLosses: 0,
    flags: {},
    updatedAt: nowIso,
  };
  if (seasonKey) set.seasonKey = String(seasonKey);
  const unset = Object.fromEntries(RESET_UNSET_FIELDS.map((field) => [field, ""]));
  return { $set: set, $unset: unset };
}

function removableUniqueGrantFilter(discordId, persistentItemIds = PERSISTENT_STORY_ITEM_IDS) {
  return {
    discordId: String(discordId),
    itemId: { $nin: [...persistentItemIds] },
  };
}

module.exports = {
  PERSISTENT_STORY_ITEM_IDS,
  RESET_UNSET_FIELDS,
  SEASON_RESET_RULES,
  isTitle,
  isCollectible,
  isPersistentStoryItem,
  isSeasonPersistentItem,
  filterKeptInventory,
  buildProgressResetUpdate,
  removableUniqueGrantFilter,
};
