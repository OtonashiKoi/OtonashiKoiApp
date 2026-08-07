"use strict";

const crypto = require("crypto");
const { CURRENCY_SOURCES } = require("../../shared/sources");
const { isEffectConditionMet, applyEffectInstances } = require("../../shared/effectEngine");
const { withPlayerProgressLock } = require("../../services/progress/progressLocks");

const SUPPORTED_TYPES = new Set([
  "take_item",
  "grant_currency",
  "grant_item",
  "grant_equipment",
  "grant_buff",
]);

class NpcOptionEffectError extends Error {
  constructor(message) {
    super(message);
    this.name = "NpcOptionEffectError";
    this.userMessage = message;
  }
}

function itemMatches(entry, itemId, enhanceLevel) {
  return String(entry?.itemId || entry?.id || "") === String(itemId || "")
    && Number(entry?.enhanceLevel || entry?.enhance || 0) >= enhanceLevel;
}

function consumeInventory(inventory, itemId, enhanceLevel, count) {
  let remaining = count;
  for (let i = inventory.length - 1; i >= 0 && remaining > 0; i -= 1) {
    const entry = inventory[i];
    if (!itemMatches(entry, itemId, enhanceLevel)) continue;
    const stackCount = Math.max(1, Number(entry.stackCount || 1));
    const consumed = Math.min(stackCount, remaining);
    remaining -= consumed;
    if (consumed === stackCount) inventory.splice(i, 1);
    else inventory[i] = { ...entry, stackCount: stackCount - consumed };
  }
  return remaining === 0;
}

function createInventoryEntry(item, enhanceLevel = 0) {
  return {
    uuid: crypto.randomUUID(),
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
    enhanceLevel: Number(enhanceLevel || 0),
    purchasedAt: new Date().toISOString(),
  };
}

async function processNpcOptionEffects({
  serviceContext,
  discordId,
  displayName,
  option,
  formatBuffMessage = (effect) => `獲得 Buff：${effect.key}`,
}) {
  const sc = serviceContext;
  const effects = Array.isArray(option?.effects) ? option.effects : [];
  if (effects.length === 0) return [];

  return withPlayerProgressLock(discordId, async () => {
    let progress = await sc.progressRepository.findByPlayerId(discordId).catch(() => null);
    const effectContext = {
      equipped: progress?.equipment || {},
      inventory: Array.isArray(progress?.inventory) ? progress.inventory : [],
    };

    if (option.condition && !isEffectConditionMet({ condition: option.condition }, effectContext)) {
      throw new NpcOptionEffectError("你不符合這個選項的條件。");
    }

    let goldCost = 0;
    let diamondCost = 0;
    const inventoryPreview = effectContext.inventory.map((entry) => ({ ...entry }));
    const itemDocuments = new Map();

    for (const effect of effects) {
      const type = String(effect?.type || "");
      if (!SUPPORTED_TYPES.has(type)) {
        throw new NpcOptionEffectError(`這個選項使用了尚未支援的效果：${type || "unknown"}`);
      }
      if (!isEffectConditionMet(effect, effectContext)) {
        throw new NpcOptionEffectError("你不符合這個選項的效果條件。");
      }

      if (type === "grant_currency") {
        const amount = Number(effect.payload?.amount || 0);
        const currency = effect.payload?.currencyType || "gold";
        if (!Number.isInteger(amount)) throw new NpcOptionEffectError("NPC 金額設定錯誤。");
        if (amount < 0 && currency === "gold") goldCost += -amount;
        if (amount < 0 && currency === "diamond") diamondCost += -amount;
      }

      if (type === "take_item") {
        const itemId = effect.payload?.itemId;
        const enhanceLevel = Math.max(0, Number(effect.payload?.enhanceLevel || 0));
        const count = Math.max(1, Number(effect.payload?.count ?? effect.payload?.qty ?? 1));
        if (!itemId || !Number.isInteger(count)) throw new NpcOptionEffectError("NPC 交換道具設定錯誤。");
        if (!consumeInventory(inventoryPreview, itemId, enhanceLevel, count)) {
          const item = await sc.itemService.getItemById(itemId).catch(() => null);
          throw new NpcOptionEffectError(`你沒有足夠的 ${item?.name || itemId}。`);
        }
      }

      if (type === "grant_item" || type === "grant_equipment") {
        const itemId = effect.payload?.itemId;
        const item = itemId ? await sc.itemService.getItemById(itemId).catch(() => null) : null;
        if (!item) throw new NpcOptionEffectError(`NPC 要發放的道具不存在：${itemId || "?"}`);
        itemDocuments.set(effect, item);
      }

      if (type === "grant_buff" && !effect.payload?.effect?.key) {
        throw new NpcOptionEffectError("NPC Buff 設定不完整。");
      }
    }

    const wallet = await sc.walletRepository.findByPlayerId(discordId).catch(() => ({ gold: 0, diamond: 0 }));
    if (Number(wallet?.gold || 0) < goldCost) throw new NpcOptionEffectError("金幣不足。");
    if (Number(wallet?.diamond || 0) < diamondCost) throw new NpcOptionEffectError("鑽石不足。");

    async function ensureProgress() {
      if (progress) return progress;
      await sc.playerService.ensurePlayer(discordId, displayName);
      progress = await sc.progressRepository.findByPlayerId(discordId);
      if (!progress) throw new NpcOptionEffectError("找不到玩家進度。");
      if (!Array.isArray(progress.inventory)) progress.inventory = [];
      return progress;
    }

    const payments = effects.filter((effect) => effect.type === "take_item"
      || (effect.type === "grant_currency" && Number(effect.payload?.amount || 0) < 0));
    const rewards = effects.filter((effect) => !payments.includes(effect));
    const results = [];

    for (const effect of [...payments, ...rewards]) {
      const type = effect.type;
      if (type === "grant_currency") {
        const amount = Number(effect.payload?.amount || 0);
        if (amount === 0) continue;
        const currencyType = effect.payload?.currencyType || "gold";
        await sc.rewardService.grantCurrency({
          discordId,
          displayName,
          currencyType,
          amount,
          source: CURRENCY_SOURCES.SHOP_PURCHASE,
          operator: "npc_dialog",
        });
        results.push(`${currencyType === "diamond" ? "💎" : "🪙"} ${amount > 0 ? "+" : ""}${amount}`);
        continue;
      }

      if (type === "take_item") {
        const current = await ensureProgress();
        const itemId = effect.payload.itemId;
        const enhanceLevel = Math.max(0, Number(effect.payload?.enhanceLevel || 0));
        const count = Math.max(1, Number(effect.payload?.count ?? effect.payload?.qty ?? 1));
        if (!consumeInventory(current.inventory, itemId, enhanceLevel, count)) {
          throw new NpcOptionEffectError("交換道具已發生變動，請重試。");
        }
        current.updatedAt = new Date().toISOString();
        await sc.progressRepository.save(current);
        results.push(`已交付道具 ×${count}`);
        continue;
      }

      if (type === "grant_item" || type === "grant_equipment") {
        const current = await ensureProgress();
        const item = itemDocuments.get(effect);
        current.inventory.push(createInventoryEntry(item, effect.payload?.enhanceLevel));
        current.updatedAt = new Date().toISOString();
        await sc.progressRepository.save(current);
        results.push(`獲得 ${item.name}`);
        continue;
      }

      if (type === "grant_buff") {
        const current = await ensureProgress();
        const buffEffect = effect.payload.effect;
        current.activeEffects = applyEffectInstances(
          current.activeEffects || [],
          [buffEffect],
          { sourceType: "npc_dialog", sourceId: String(option.id || "") },
          { equipped: current.equipment || {}, inventory: current.inventory || [] },
        );
        current.updatedAt = new Date().toISOString();
        await sc.progressRepository.save(current);
        results.push(formatBuffMessage(buffEffect));
      }
    }

    return results;
  });
}

module.exports = {
  NpcOptionEffectError,
  processNpcOptionEffects,
};
