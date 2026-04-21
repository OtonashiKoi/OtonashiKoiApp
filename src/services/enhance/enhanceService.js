"use strict";

const { AppError, ERROR_CODES } = require("../../shared/errors");
const { getGemsRequired, getSuccessRate, validateEnhance, ENHANCE_GEMS, MAX_ENHANCE_LEVEL } = require("../../shared/enhanceConfig");

const WEAPON_MAIN_STAT_BY_TYPE = {
  staff_1h: "int",
  staff_2h: "int",
  bow: "dex",
  dagger: "agi",
  sword_1h: "str",
  sword_2h: "str",
  axe_1h: "str",
  axe_2h: "str",
  mace_1h: "str",
  mace_2h: "str",
  offhand_sword: "str",
  offhand_dagger: "agi",
  offhand_mace: "str",
  offhand_axe: "str",
  offhand_hammer: "str"
};

const WEAPON_ENHANCE_BONUS_BY_TIER = {
  D: 1,
  C: 1.5,
  B: 2,
  A: 2
};

const ARMOR_ENHANCE_VIT_BY_TIER = {
  D: 1,
  C: 2,
  B: 3,
  A: 3
};

class EnhanceService {
  constructor(progressRepository, itemRepository, questService = null) {
    this.progressRepository = progressRepository;
    this.itemRepository = itemRepository;
    this.questService = questService;
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

    // 強化完成後會自動同步，不需要在這裡手動從 DB 拉（itemService._syncItemToPlayers 負責）

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
      this._applyEnhanceStats(equipment, tier);
      // 更新顯示名稱
      equipment.itemName = `${equipment.itemName.split(" +")[0]} +${nextLevel}`;
      // 確保強化後保留原始道具的所有 effects
      if (!equipment.procEffects) equipment.procEffects = [];
      if (!equipment.passiveEffects) equipment.passiveEffects = [];
      if (!equipment.useEffects) equipment.useEffects = [];
      if (!equipment.combatEffects) equipment.combatEffects = [];
    }

    // 保存進度
    progress.updatedAt = new Date().toISOString();
    await this.progressRepository.save(progress);

    // 強化完成後，同步該道具的最新 effects（如果有 itemId）
    if (isSuccess && equipment.itemId && this.itemRepository) {
      const libItem = await this.itemRepository.findById(equipment.itemId).catch(() => null);
      if (libItem) {
        // 同步 procEffects、passiveEffects 等從 DB
        if (equipmentIndex !== -1) {
          // 在背包
          progress.inventory[equipmentIndex].procEffects = libItem.procEffects || [];
          progress.inventory[equipmentIndex].passiveEffects = libItem.passiveEffects || [];
          progress.inventory[equipmentIndex].useEffects = libItem.useEffects || [];
          progress.inventory[equipmentIndex].combatEffects = libItem.combatEffects || [];
        } else {
          // 在裝備槽
          for (const [slotKey, slotItem] of Object.entries(progress.equipment || {})) {
            if (slotItem && slotItem.uuid === inventoryUuid) {
              progress.equipment[slotKey].procEffects = libItem.procEffects || [];
              progress.equipment[slotKey].passiveEffects = libItem.passiveEffects || [];
              progress.equipment[slotKey].useEffects = libItem.useEffects || [];
              progress.equipment[slotKey].combatEffects = libItem.combatEffects || [];
              break;
            }
          }
        }
        await this.progressRepository.save(progress);
      }
    }
    if (isSuccess && this.questService) {
      this.questService.recordProgress(discordId, "enhance_count", 1).catch(() => {});
    }

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
   * 統計背包中特定寶石的數量（考慮堆疊）
   */
  _countGemsInInventory(inventory, gemItemId) {
    let total = 0;
    for (const item of inventory) {
      if (item?.itemId === gemItemId) {
        // 如果有 stackCount 就用堆疊數量，否則視為 1 顆
        total += Math.max(1, item.stackCount || 1);
      }
    }
    return total;
  }

  /**
   * 從背包中移除特定數量的寶石（支持堆疊）
   * 如果有 stackCount，優先減少堆疊數量；完全消耗後刪除項目
   */
  _consumeGemsFromInventory(inventory, gemItemId, count) {
    let removed = 0;
    for (let i = 0; i < inventory.length && removed < count; i++) {
      if (inventory[i].itemId === gemItemId) {
        const gem = inventory[i];
        const stackCount = Math.max(1, gem.stackCount || 1);

        if (stackCount > 1) {
          // 有堆疊：減少堆疊數量
          const toRemove = Math.min(count - removed, stackCount);
          gem.stackCount = stackCount - toRemove;
          removed += toRemove;

          // 如果堆疊數量用完，刪除該項目
          if (gem.stackCount <= 0) {
            inventory.splice(i, 1);
            i--;
          }
        } else {
          // 無堆疊或堆疊為 1：刪除整個項目
          inventory.splice(i, 1);
          removed++;
          i--;
        }
      }
    }
  }

  /**
   * 依裝備型態與階級套用強化數值
   */
  _applyEnhanceStats(equipment, tier) {
    if (!equipment || typeof equipment !== "object") return;
    if (!equipment.equipStats || typeof equipment.equipStats !== "object") {
      equipment.equipStats = {};
    }

    const normalizedTier = String(tier || "").toUpperCase();
    const equipSlot = String(equipment.equipSlot || "");
    const weaponType = String(equipment.weaponType || "");
    const isOffhandWeapon = equipSlot === "shield" && weaponType.startsWith("offhand_");
    const isMainWeapon = equipSlot === "weapon";

    if (isMainWeapon || isOffhandWeapon) {
      const delta = WEAPON_ENHANCE_BONUS_BY_TIER[normalizedTier] ?? 1;
      const mainStat = this._getWeaponMainStat(equipment);
      if (!mainStat) return;
      const currentValue = Number(equipment.equipStats[mainStat]) || 0;
      equipment.equipStats[mainStat] = Number((currentValue + delta).toFixed(2));
      return;
    }

    // 盾牌(非副手武器)與防具統一加 VIT
    const vitDelta = ARMOR_ENHANCE_VIT_BY_TIER[normalizedTier] ?? 1;
    const vitValue = Number(equipment.equipStats.vit) || 0;
    equipment.equipStats.vit = Number((vitValue + vitDelta).toFixed(2));
  }

  /**
   * 取得武器主屬性（優先看 weaponType；找不到再回退到最高值）
   */
  _getWeaponMainStat(equipment) {
    const weaponType = String(equipment?.weaponType || "");
    const byType = WEAPON_MAIN_STAT_BY_TYPE[weaponType];
    if (byType) return byType;

    const equipStats = equipment?.equipStats;
    if (!equipStats || typeof equipStats !== "object") return null;
    const entries = Object.entries(equipStats).filter(([, value]) => Number.isFinite(Number(value)));
    if (entries.length === 0) return null;
    return entries.sort((a, b) => Number(b[1]) - Number(a[1]))[0][0];
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
