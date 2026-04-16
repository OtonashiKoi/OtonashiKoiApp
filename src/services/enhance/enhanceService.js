"use strict";

const { AppError, ERROR_CODES } = require("../../shared/errors");
const { getGemsRequired, getSuccessRate, validateEnhance, ENHANCE_GEMS, MAX_ENHANCE_LEVEL } = require("../../shared/enhanceConfig");

class EnhanceService {
  constructor(progressRepository, itemRepository) {
    this.progressRepository = progressRepository;
    this.itemRepository = itemRepository;
  }

  /**
   * 強化裝備
   * @param {string} discordId 玩家 ID
   * @param {string} inventoryUuid 背包中的裝備 UUID（用於識別具體是哪一件）
   * @returns {object} { success: boolean, newLevel: number, message: string }
   */
  async enhanceEquipment(discordId, inventoryUuid) {
    // 取得玩家進度
    const progress = await this.progressRepository.findByPlayerId(discordId);
    if (!progress) throw new AppError(ERROR_CODES.PLAYER_NOT_FOUND, "玩家未找到", 404);

    // 找到要強化的裝備（可能在背包或身上）
    const inventory = Array.isArray(progress.inventory) ? progress.inventory : [];
    let equipment = null;
    let equipmentIndex = -1;

    // 先查詢背包
    equipmentIndex = inventory.findIndex(item => item.uuid === inventoryUuid);
    if (equipmentIndex !== -1) {
      equipment = inventory[equipmentIndex];
    } else {
      // 再查詢身上的裝備
      for (const [slotKey, slotItem] of Object.entries(progress.equipment || {})) {
        if (slotItem && slotItem.uuid === inventoryUuid) {
          equipment = slotItem;
          break;
        }
      }
    }

    if (!equipment) {
      throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "未找到該裝備", 404);
    }

    // 驗證該物品是否為可強化的裝備（武器或防具）
    const tier = String(equipment.tier || "").toUpperCase();
    if (!["D", "C", "B", "A"].includes(tier)) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "該道具無法強化", 400);
    }

    const itemType = String(equipment.itemType || "").toLowerCase();
    const equipSlot = String(equipment.equipSlot || "");

    // 檢查是否為特殊裝備
    if (equipSlot === "special") {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "特殊裝備無法強化", 400);
    }

    const isWeaponOrArmor = (itemType === "equipment");
    if (!isWeaponOrArmor) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "只有武器和防具可以強化", 400);
    }

    const currentLevel = Math.max(0, Number(equipment.enhanceLevel) || 0);

    // 驗證是否可強化
    const gemItemId = ENHANCE_GEMS[tier];
    if (!gemItemId) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, `無效的品階: ${tier}`, 400);
    }

    // 計算背包中的寶石數量
    const gemsOwned = this._countGemsInInventory(inventory, gemItemId);
    const validation = validateEnhance(tier, currentLevel, gemsOwned);
    if (!validation.canEnhance) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, validation.reason, 400);
    }

    const gemsRequired = getGemsRequired(tier, currentLevel);
    const successRate = getSuccessRate(tier, currentLevel);
    const nextLevel = currentLevel + 1;

    // 消耗寶石
    this._consumeGemsFromInventory(inventory, gemItemId, gemsRequired);

    // 計算是否強化成功
    const isSuccess = Math.random() * 100 < successRate;

    // 更新裝備狀態
    if (isSuccess) {
      equipment.enhanceLevel = nextLevel;
      const mainStat = this._getMainStat(equipment.equipStats);
      if (mainStat) {
        equipment.equipStats[mainStat] = (equipment.equipStats[mainStat] || 0) + 1;
        // 更新顯示名稱
        equipment.itemName = `${equipment.itemName.split(" +")[0]} +${nextLevel}`;
      }
    }

    // 保存進度
    progress.updatedAt = new Date().toISOString();
    await this.progressRepository.save(progress);

    return {
      success: isSuccess,
      newLevel: isSuccess ? nextLevel : currentLevel,
      tier,
      gemsUsed: gemsRequired,
      successRate,
      message: isSuccess
        ? `✅ 強化成功！裝備升級至 +${nextLevel}`
        : `❌ 強化失敗，消耗了 ${gemsRequired} 顆 ${tier} 階寶石`
    };
  }

  /**
   * 統計背包中特定寶石的數量
   */
  _countGemsInInventory(inventory, gemItemId) {
    return inventory.filter(item => item.itemId === gemItemId).length;
  }

  /**
   * 從背包中移除特定數量的寶石
   */
  _consumeGemsFromInventory(inventory, gemItemId, count) {
    let removed = 0;
    for (let i = 0; i < inventory.length && removed < count; i++) {
      if (inventory[i].itemId === gemItemId) {
        inventory.splice(i, 1);
        removed++;
        i--; // 因為刪除了元素，需要回退索引
      }
    }
  }

  /**
   * 取得裝備的主屬性
   */
  _getMainStat(equipStats) {
    if (!equipStats || typeof equipStats !== "object") return null;
    const entries = Object.entries(equipStats);
    if (entries.length === 0) return null;
    // 回傳數值最大的屬性
    return entries.sort((a, b) => b[1] - a[1])[0][0];
  }

  /**
   * 取得某個玩家的強化進度信息（用於 UI 顯示）
   */
  async getEnhanceInfo(discordId, inventoryUuid) {
    const progress = await this.progressRepository.findByPlayerId(discordId);
    if (!progress) throw new AppError(ERROR_CODES.PLAYER_NOT_FOUND, "玩家未找到", 404);

    const inventory = Array.isArray(progress.inventory) ? progress.inventory : [];
    // 支援傳入已裝備的 uuid：先在背包找，找不到再從 progress.equipment 裡查
    let equipment = inventory.find(item => item.uuid === inventoryUuid);
    if (!equipment) {
      for (const v of Object.values(progress.equipment || {})) {
        if (v && v.uuid === inventoryUuid) { equipment = v; break; }
      }
    }
    if (!equipment) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到該裝備（請檢查是否在背包或已裝備）", 404);

    const tier = String(equipment.tier || "").toUpperCase();
    const currentLevel = Math.max(0, Number(equipment.enhanceLevel) || 0);

    if (!["D", "C", "B", "A"].includes(tier)) {
      return null; // 無法強化的道具
    }

    const gemItemId = ENHANCE_GEMS[tier];
    const gemsOwned = this._countGemsInInventory(inventory, gemItemId);

    const isMaxed = currentLevel >= MAX_ENHANCE_LEVEL;
    const gemsRequired = isMaxed ? -1 : getGemsRequired(tier, currentLevel);
    const successRate = isMaxed ? -1 : getSuccessRate(tier, currentLevel);

    return {
      itemName: equipment.itemName,
      tier,
      currentLevel,
      isMaxed,
      gemsRequired: gemsRequired > 0 ? gemsRequired : null,
      gemsOwned,
      successRate: successRate > 0 ? successRate : null,
      nextLevel: isMaxed ? null : currentLevel + 1
    };
  }
}

module.exports = { EnhanceService };
