"use strict";
const { AppError } = require("../../shared/errors");
const { REWARDS, WEAPON_SETS } = require("../../shared/partyTowerRewardRules");
const { isUnavailableEquipment } = require("../../shared/equipmentAvailability");
const { withPlayerProgressLock } = require("../progress/progressLocks");
const { slimInventoryEntry } = require("../../shared/inventoryStorage");
const boxes = new Map(Object.values(REWARDS).map(r => [r.boxId, r.tier]));
const invalid = message => new AppError("INVALID_ARGUMENT", message, 400);
function selectable(item, tier) {
  return item?.itemType === "equipment" && item.equipSlot === "weapon" && item.tier === tier && item.enabled !== false
    && Boolean(item.weaponType) && !isUnavailableEquipment(item)
    && [item.setKey, ...(item.setKeys || [])].some(key => WEAPON_SETS.includes(key));
}
function createWeaponChoiceService(shop, options = {}) {
  const capacity = options.capacity || (async id => (await require("../backpack/backpackService").resolveEffectiveCapacity(id)).cap);
  async function boxFor(p, uuid) {
    const entry = p?.inventory?.find(e => e.uuid === uuid);
    if (!entry || !boxes.has(entry.itemId)) throw invalid("背包中找不到此武器自選箱");
    if (entry.locked) throw invalid("自選箱已鎖定，請先解鎖");
    if (!Number.isSafeInteger(entry.stackCount ?? 1) || (entry.stackCount ?? 1) < 1) throw invalid("自選箱數量無效");
    const definition = await shop.itemRepository.findById(entry.itemId);
    if (definition?.effect?.type !== "open_weapon_choice" || definition.effect.tier !== boxes.get(entry.itemId)) throw invalid("武器自選箱資料無效");
    return { entry, tier: boxes.get(entry.itemId) };
  }
  return {
    async list(playerId, uuid) {
      const p = await shop.progressRepository.findByPlayerId(playerId);
      const { entry, tier } = await boxFor(p, uuid);
      const choices = (await shop.itemRepository.findAll()).filter(i => selectable(i, tier)).map(i => ({
        itemId: i.id, itemName: i.name, tier: i.tier, weaponType: i.weaponType, equipStats: i.equipStats,
        imageUrl: i.imageThumbnailUrl || i.imageUrl || null, description: i.description,
      })).sort((a, b) => a.weaponType.localeCompare(b.weaponType) || a.itemName.localeCompare(b.itemName, "zh-Hant"));
      return { boxName: entry.itemName, tier, choices };
    },
    async open(playerId, uuid, itemId, operationId) {
      if (typeof itemId !== "string" || !itemId || typeof uuid !== "string" || typeof operationId !== "string" || !/^[a-zA-Z0-9-]{16,80}$/.test(operationId)) throw invalid("請選擇武器並提供有效操作編號");
      return withPlayerProgressLock(playerId, async () => {
        let rewardEntry;
        for (let retry = 0; retry < 8; retry++) {
          const p = await shop.progressRepository.findByPlayerId(playerId);
          if (!p) throw invalid("找不到人物資料");
          const receipt = (p.weaponChoiceReceipts || []).find(r => r.operationId === operationId);
          if (receipt) {
            if (receipt.boxUuid !== uuid || receipt.itemId !== itemId || receipt.seasonKey !== p.seasonKey) throw invalid("操作編號已用於其他選擇");
            return receipt.result;
          }
          const { entry, tier } = await boxFor(p, uuid);
          const item = await shop.itemRepository.findById(itemId);
          if (!selectable(item, tier)) throw invalid("請選擇此箱可領取的同階主手武器");
          const bp = require("../backpack/backpackService");
          if ((p.inventory || []).filter(bp.countsTowardCapacity).length >= await capacity(playerId)) throw invalid("背包裝備格已滿，請先整理空間；自選箱尚未消耗");
          if (!rewardEntry) {
            rewardEntry = shop._buildEntryFromItem(item, "weapon_choice_chest", uuid);
            require("../enchant/enchantService").rollForEntry(rewardEntry);
            if (item.elementDrop) require("../../shared/elementDropRoll").rollElementForEntry(rewardEntry, { override: item.elementDrop });
          }
          const { _id, ...mutable } = p;
          const next = structuredClone(mutable), idx = next.inventory.findIndex(e => e.uuid === uuid);
          if ((next.inventory[idx].stackCount || 1) > 1) next.inventory[idx].stackCount -= 1;
          else next.inventory.splice(idx, 1);
          next.inventory.push(slimInventoryEntry(rewardEntry));
          const result = { itemName: rewardEntry.itemName, itemId, uuid: rewardEntry.uuid, tier, boxName: entry.itemName };
          next.weaponChoiceReceipts = [...(p.weaponChoiceReceipts || []), { operationId, boxUuid: uuid, itemId, seasonKey: p.seasonKey, result }];
          next.updatedAt = new Date(Math.max(Date.now(), (Date.parse(p.updatedAt) || 0) + 1)).toISOString();
          if (await shop.progressRepository.saveIfUnchanged(next, p.updatedAt)) {
            require("../realtime/playerEventBus").playerEventBus.invalidateInventory(playerId);
            return result;
          }
        }
        throw new AppError("CONFLICT", "背包儲存忙碌，請重試", 409);
      });
    },
  };
}
module.exports = { createWeaponChoiceService, selectable };
