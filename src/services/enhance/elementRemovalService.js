"use strict";

const { AppError, ERROR_CODES } = require("../../shared/errors");
const {
  normalizeElement, getElementLabel, getElementSocketCapacity,
  resolveElementsMap, ELEMENT_SOCKET_SLOTS,
} = require("../../shared/elementSystem");
const { getElementRemovalCost, MAX_ELEMENT_REMOVALS_PER_ITEM } = require("../../shared/enhanceConfig");
const { withPlayerProgressLock } = require("../progress/progressLocks");

async function removeElementSocket(service, discordId, inventoryUuid, element) {
  return withPlayerProgressLock(discordId, async () => {
    const el = normalizeElement(element);
    if (!el) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "無效的屬性", 400);
    const elLabel = getElementLabel(el);
    const progress = await service.progressRepository.findByPlayerId(discordId);
    if (!progress) throw new AppError(ERROR_CODES.PLAYER_NOT_FOUND, "玩家未找到", 404);

    const inventory = Array.isArray(progress.inventory) ? progress.inventory : [];
    let equipment = inventory.find((item) => item?.uuid === inventoryUuid) || null;
    if (!equipment) {
      for (const slotItem of Object.values(progress.equipment || {})) {
        if (slotItem?.uuid === inventoryUuid) { equipment = slotItem; break; }
      }
    }
    if (!equipment) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "未找到該裝備", 404);
    if (!ELEMENT_SOCKET_SLOTS.includes(String(equipment.equipSlot || ""))) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "此槽位不支援屬性拆除", 400);
    }

    const capacity = getElementSocketCapacity(equipment.tier);
    if (capacity <= 0) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "此裝備沒有屬性洞", 400);
    const removalsUsed = Math.max(0, Math.floor(Number(equipment.elementRemovalCount) || 0));
    if (removalsUsed >= MAX_ELEMENT_REMOVALS_PER_ITEM) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, `此裝備已用完屬性拆除次數（${removalsUsed}/${MAX_ELEMENT_REMOVALS_PER_ITEM}）`, 400);
    }

    const elementsMap = resolveElementsMap(equipment);
    const totalFilled = Object.values(elementsMap).reduce((sum, count) => sum + count, 0);
    const existingCount = Math.max(0, Number(elementsMap[el]) || 0);
    if (existingCount <= 0) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, `此裝備沒有${elLabel}屬性石可拆除`, 400);
    const cost = getElementRemovalCost(totalFilled, existingCount);
    if (!cost) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "無法計算屬性拆除費用", 400);

    const wallet = service.walletRepository
      ? await service.walletRepository.findByPlayerId(discordId).catch(() => null)
      : null;
    const goldOwned = Math.max(0, Number(wallet?.gold) || 0);
    if (goldOwned < cost.gold) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, `金幣不足，需要 ${cost.gold} 金幣，目前擁有 ${goldOwned} 金幣`, 400);
    }
    const displayName = progress.displayName || progress.playerName || discordId;
    if (cost.gold > 0) await service._consumeGold(discordId, displayName, cost.gold, "enhance:element-removal");

    const isSuccess = Math.random() * 100 < cost.success;
    let newLevel = existingCount;
    let nextRemovalsUsed = removalsUsed;
    if (isSuccess) {
      newLevel -= 1;
      if (newLevel > 0) elementsMap[el] = newLevel;
      else delete elementsMap[el];
      equipment.elements = elementsMap;
      delete equipment.element;
      delete equipment.elementLevel;
      equipment.elementRemovalCount = nextRemovalsUsed = removalsUsed + 1;
      progress.updatedAt = new Date().toISOString();
      await service.progressRepository.save(progress);
    }

    return {
      success: isSuccess,
      element: el,
      previousLevel: existingCount,
      newLevel,
      goldUsed: cost.gold,
      successRate: cost.success,
      socketsFilled: totalFilled - (isSuccess ? 1 : 0),
      socketsTotal: capacity,
      removalsUsed: nextRemovalsUsed,
      removalsMax: MAX_ELEMENT_REMOVALS_PER_ITEM,
      itemName: equipment.itemName,
      message: isSuccess
        ? `✅ 拆除成功！${elLabel}屬性 -1，屬性石已破壞且不返還；消耗 ${cost.gold} 金幣（拆除次數 ${nextRemovalsUsed}/${MAX_ELEMENT_REMOVALS_PER_ITEM}）`
        : `❌ 拆除失敗，屬性石仍留在裝備上；消耗 ${cost.gold} 金幣。成功率不會因失敗提高。`,
    };
  });
}

module.exports = { removeElementSocket };
