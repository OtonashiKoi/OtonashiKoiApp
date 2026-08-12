"use strict";

const { AppError, ERROR_CODES } = require("../../shared/errors");
const {
  ELEMENTS, getElementSocketCapacity, resolveElementsMap, ELEMENT_SOCKET_SLOTS,
} = require("../../shared/elementSystem");
const {
  getElementSocketCost, getElementRemovalCost, MAX_ELEMENT_REMOVALS_PER_ITEM,
} = require("../../shared/enhanceConfig");

async function getElementSocketInfo(service, discordId, inventoryUuid) {
  const progress = await service.progressRepository.findByPlayerId(discordId);
  if (!progress) throw new AppError(ERROR_CODES.PLAYER_NOT_FOUND, "玩家未找到", 404);
  const inventory = Array.isArray(progress.inventory) ? progress.inventory : [];
  let equipment = inventory.find((item) => item.uuid === inventoryUuid);
  if (!equipment) {
    for (const slotItem of Object.values(progress.equipment || {})) {
      if (slotItem?.uuid === inventoryUuid) { equipment = slotItem; break; }
    }
  }
  if (!equipment || !ELEMENT_SOCKET_SLOTS.includes(String(equipment.equipSlot || ""))) return null;

  const tier = String(equipment.tier || "").toUpperCase();
  const capacity = getElementSocketCapacity(tier);
  if (capacity <= 0) return null;
  const elements = resolveElementsMap(equipment);
  const socketsFilled = Object.values(elements).reduce((sum, count) => sum + count, 0);
  const removalsUsed = Math.max(0, Math.min(
    MAX_ELEMENT_REMOVALS_PER_ITEM,
    Math.floor(Number(equipment.elementRemovalCount) || 0)
  ));
  const wallet = service.walletRepository
    ? await service.walletRepository.findByPlayerId(discordId).catch(() => null)
    : null;
  const goldOwned = Math.max(0, Number(wallet?.gold) || 0);
  const perElement = ELEMENTS.map((element) => {
    const existingCount = elements[element] || 0;
    return {
      element,
      existingCount,
      owned: service._countGemsInInventory(inventory, `element-stone-${element}`),
      nextCost: socketsFilled >= capacity ? null : getElementSocketCost(existingCount),
      removalCost: removalsUsed >= MAX_ELEMENT_REMOVALS_PER_ITEM
        ? null
        : getElementRemovalCost(socketsFilled, existingCount),
    };
  });
  return {
    itemName: equipment.itemName,
    tier,
    capacity,
    socketsFilled,
    elements,
    goldOwned,
    removalsUsed,
    removalsMax: MAX_ELEMENT_REMOVALS_PER_ITEM,
    perElement,
  };
}

module.exports = { getElementSocketInfo };
