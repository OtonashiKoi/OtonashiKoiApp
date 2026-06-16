"use strict";

const { AppError, ERROR_CODES } = require("../../shared/errors");
const { getEnhanceCost, ENHANCE_GEMS, MAX_ENHANCE_LEVEL } = require("../../shared/enhanceConfig");
const { CURRENCY_SOURCES } = require("../../shared/sources");
const { withPlayerProgressLock } = require("../progress/progressLocks");

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
  mace_2h: "str"
};

const WEAPON_ENHANCE_BONUS_BY_TIER = {
  D: 1,
  C: 1.5,
  B: 2,
  A: 2,
  S: 3
};

const ARMOR_ENHANCE_VIT_BY_TIER = {
  D: 1,
  C: 2,
  B: 3,
  A: 3,
  S: 4
};

const ARMOR_RANDOM_ENHANCE_BONUS_BY_TIER = {
  D: 1,
  C: 1,
  B: 2,
  A: 3,
  S: 4
};

const STAT_LABEL_ZH = {
  str: "力量 STR",
  agi: "敏捷 AGI",
  vit: "體質 VIT",
  int: "智力 INT",
  dex: "靈巧 DEX",
  luk: "幸運 LUK"
};

const ENHANCE_MODES = {
  NORMAL: "normal",
  GAMBLE: "gamble"
};
const GAMBLE_MIN_ENHANCE_LEVEL = 1;

function normalizeEnhanceMode(mode) {
  return String(mode || ENHANCE_MODES.NORMAL).toLowerCase() === ENHANCE_MODES.GAMBLE
    ? ENHANCE_MODES.GAMBLE
    : ENHANCE_MODES.NORMAL;
}

class EnhanceService {
  constructor(progressRepository, itemRepository, walletRepository = null, rewardService = null, questService = null) {
    this.progressRepository = progressRepository;
    this.itemRepository = itemRepository;
    this.walletRepository = walletRepository;
    this.rewardService = rewardService;
    this.questService = questService;
  }

  /**
   * 強化裝備
   * @param {string} discordId 玩家 ID
   * @param {string} inventoryUuid 背包中的裝備 UUID（用於識別具體是哪一件）
   * @returns {object} { success: boolean, newLevel: number, message: string }
   */
  async enhanceEquipment(discordId, inventoryUuid, options = {}) {
    // 上鎖序列化：避免並發強化同一裝備造成寶石只扣一次卻多次強化/狀態交錯。
    return withPlayerProgressLock(discordId, () => this._enhanceEquipmentImpl(discordId, inventoryUuid, options));
  }

  async _enhanceEquipmentImpl(discordId, inventoryUuid, options = {}) {
    const mode = normalizeEnhanceMode(options?.mode);
    const isGamble = mode === ENHANCE_MODES.GAMBLE;
    const costMultiplier = isGamble ? 0.5 : 1;

    // 取得玩家進度
    const progress = await this.progressRepository.findByPlayerId(discordId);
    if (!progress) throw new AppError(ERROR_CODES.PLAYER_NOT_FOUND, "玩家未找到", 404);

    // 找到要強化的裝備（可能在背包或身上）
    const inventory = Array.isArray(progress.inventory) ? progress.inventory : [];
    let equipment = null;
    let equipmentSlotKey = null;

    // 先查詢背包
    const equipmentIndex = inventory.findIndex(item => item.uuid === inventoryUuid);
    if (equipmentIndex !== -1) {
      equipment = inventory[equipmentIndex];
    } else {
      // 再查詢身上的裝備
      for (const [slotKey, slotItem] of Object.entries(progress.equipment || {})) {
        if (slotItem && slotItem.uuid === inventoryUuid) {
          equipment = slotItem;
          equipmentSlotKey = slotKey;
          break;
        }
      }
    }

    if (!equipment) {
      throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "未找到該裝備", 404);
    }

    // 驗證該物品是否為可強化的裝備（武器或防具）
    const tier = String(equipment.tier || "").toUpperCase();
    if (!["D", "C", "B", "A", "S"].includes(tier)) {
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
    if (isGamble && currentLevel < GAMBLE_MIN_ENHANCE_LEVEL) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "賭鬼強化需裝備至少 +1 才能使用", 400);
    }
    const preview = this._buildEnhancePreview(equipment, tier, currentLevel);
    if (!preview) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "此裝備沒有可強化的屬性", 400);
    }
    const beforeEquipStats = equipment.equipStats && typeof equipment.equipStats === "object"
      ? JSON.parse(JSON.stringify(equipment.equipStats))
      : null;
    const wallet = this.walletRepository ? await this.walletRepository.findByPlayerId(discordId).catch(() => null) : null;
    const goldOwned = Math.max(0, Number(wallet?.gold) || 0);

    // 驗證是否可強化
    const gemItemId = ENHANCE_GEMS[tier];
    if (!gemItemId) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, `無效的品階: ${tier}`, 400);
    }

    // 計算背包中的寶石數量
    const gemsOwned = this._countGemsInInventory(inventory, gemItemId);
    const baseCost = getEnhanceCost(tier, currentLevel);
    const { gemsRequired: baseGemsRequired, goldRequired: baseGoldRequired, successRate } = baseCost;
    const gemsRequired = Math.max(1, Math.ceil(Number(baseGemsRequired || 0) * costMultiplier));
    const goldRequired = Math.max(0, Math.ceil(Number(baseGoldRequired || 0) * costMultiplier));
    if (!Number.isFinite(Number(baseGemsRequired)) || !Number.isFinite(Number(baseGoldRequired)) || !Number.isFinite(Number(successRate))) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "此裝備無法強化", 400);
    }
    if (gemsOwned < gemsRequired) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, `寶石不足，需要 ${gemsRequired} 顆，目前擁有 ${gemsOwned} 顆`, 400);
    }
    if (goldOwned < goldRequired) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, `金幣不足，需要 ${goldRequired} 金幣，目前擁有 ${goldOwned} 金幣`, 400);
    }

    const nextLevel = currentLevel + 1;
    const displayName = progress.displayName || progress.playerName || discordId;
    const goldText = goldRequired > 0 ? `${goldRequired} 金幣` : "免費";

    // 消耗寶石
    this._consumeGemsFromInventory(inventory, gemItemId, gemsRequired);
    if (goldRequired > 0) {
      await this._consumeGold(discordId, displayName, goldRequired);
    }

    // 計算強化成功率加成（enhance_success_up）
    let enhanceBonusPct = 0;
    try {
      const equippedAll = progress?.equipment || {};
      const allEffectRefs = [];
      for (const entry of Object.values(equippedAll)) {
        if (!entry || typeof entry !== "object") continue;
        if (Array.isArray(entry.passiveEffects)) allEffectRefs.push(...entry.passiveEffects);
        if (Array.isArray(entry.combatEffects)) allEffectRefs.push(...entry.combatEffects);
      }
      if (Array.isArray(progress?.activeEffects)) allEffectRefs.push(...progress.activeEffects);
      for (const eff of allEffectRefs) {
        if (eff?.key === 'enhance_success_up') {
          const v = Number(eff.params?.value ?? eff.value ?? 0);
          if (Number.isFinite(v)) enhanceBonusPct += Math.abs(v);
        }
      }
    } catch (e) {}

    // 計算是否強化成功
    const effectiveSuccessRate = Math.min(100, successRate + enhanceBonusPct);
    const isSuccess = Math.random() * 100 < effectiveSuccessRate;
    const isExploded = !isSuccess && isGamble && Math.random() < 0.5;

    // 更新裝備狀態
    let enhanceResult = null;
    if (isSuccess) {
      equipment.enhanceLevel = nextLevel;
      enhanceResult = this._applyEnhanceStats(equipment, tier);
      // 更新顯示名稱
      equipment.itemName = `${equipment.itemName.split(" +")[0]} +${nextLevel}`;
      // 確保強化後保留原始道具的所有 effects
      if (!equipment.procEffects) equipment.procEffects = [];
      if (!equipment.passiveEffects) equipment.passiveEffects = [];
      if (!equipment.useEffects) equipment.useEffects = [];
      if (!equipment.combatEffects) equipment.combatEffects = [];
    } else if (isExploded) {
      this._destroyEquipment(progress, inventoryUuid, equipmentSlotKey);
    }

    // 保存進度
    progress.updatedAt = new Date().toISOString();
    await this.progressRepository.save(progress);

    if (isSuccess && this.questService) {
      this.questService.recordProgress(discordId, "enhance_count", 1).catch(() => {});
    }

    // 強化完成後，同步該道具的最新 effects（如果有 itemId）
    if (isSuccess && equipment.itemId && this.itemRepository) {
      const libItem = await this.itemRepository.findById(equipment.itemId).catch(() => null);
      if (libItem) {
        let updated = false;
        // 同步 procEffects、passiveEffects 等從 DB
        if (equipmentSlotKey && progress.equipment?.[equipmentSlotKey]?.uuid === inventoryUuid) {
          progress.equipment[equipmentSlotKey].procEffects = libItem.procEffects || [];
          progress.equipment[equipmentSlotKey].passiveEffects = libItem.passiveEffects || [];
          progress.equipment[equipmentSlotKey].useEffects = libItem.useEffects || [];
          progress.equipment[equipmentSlotKey].combatEffects = libItem.combatEffects || [];
          updated = true;
        } else {
          const refreshedIndex = (progress.inventory || []).findIndex((item) => item?.uuid === inventoryUuid);
          if (refreshedIndex !== -1) {
            progress.inventory[refreshedIndex].procEffects = libItem.procEffects || [];
            progress.inventory[refreshedIndex].passiveEffects = libItem.passiveEffects || [];
            progress.inventory[refreshedIndex].useEffects = libItem.useEffects || [];
            progress.inventory[refreshedIndex].combatEffects = libItem.combatEffects || [];
            updated = true;
          }
        }

        if (updated) {
          await this.progressRepository.save(progress);
        }
      }
    }

    return {
      success: isSuccess,
      exploded: isExploded,
      mode,
      isGamble,
      currentLevel,
      newLevel: isSuccess ? nextLevel : currentLevel,
      tier,
      itemName: equipment.itemName,
      beforeEquipStats,
      currentEquipStats: equipment.equipStats || null,
      gemsUsed: gemsRequired,
      goldUsed: goldRequired,
      successRate,
      explodeRate: isGamble ? 50 : 0,
      statBoosted: isSuccess ? (enhanceResult?.statBoosted || preview.statBoosted) : preview.statBoosted,
      statBoostedZh: isSuccess ? (enhanceResult?.statBoostedZh || preview.statBoostedZh) : preview.statBoostedZh,
      oldStatValue: isSuccess ? (enhanceResult?.oldStatValue ?? preview.oldStatValue) : preview.oldStatValue,
      newStatValue: isSuccess ? (enhanceResult?.newStatValue ?? preview.newStatValue) : preview.newStatValue,
      statDelta: isSuccess ? (enhanceResult?.statDelta ?? preview.statDelta) : preview.statDelta,
      targetStatSummary: preview.targetStatSummary,
      message: isSuccess
        ? `✅ 強化成功！裝備升級至 +${nextLevel}，消耗 ${gemsRequired} 顆 ${tier} 階寶石、${goldText}`
        : isExploded
          ? `💥 強化失敗，裝備爆掉了！消耗了 ${gemsRequired} 顆 ${tier} 階寶石、${goldText}`
          : `❌ 強化失敗，消耗了 ${gemsRequired} 顆 ${tier} 階寶石、${goldText}`
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

  _destroyEquipment(progress, inventoryUuid, equipmentSlotKey = null) {
    if (!progress || !inventoryUuid) return false;

    if (equipmentSlotKey && progress.equipment?.[equipmentSlotKey]?.uuid === inventoryUuid) {
      progress.equipment[equipmentSlotKey] = null;
      return true;
    }

    const inventory = Array.isArray(progress.inventory) ? progress.inventory : [];
    const index = inventory.findIndex((item) => item?.uuid === inventoryUuid);
    if (index !== -1) {
      inventory.splice(index, 1);
      return true;
    }

    return false;
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
    const isMainWeapon = equipSlot === "weapon";

    if (isMainWeapon) {
      const delta = WEAPON_ENHANCE_BONUS_BY_TIER[normalizedTier] ?? 1;
      const mainStat = this._getWeaponMainStat(equipment);
      if (!mainStat) return;
      const currentValue = Number(equipment.equipStats[mainStat]) || 0;
      const nextValue = Number((currentValue + delta).toFixed(2));
      equipment.equipStats[mainStat] = nextValue;
      return {
        statBoosted: mainStat,
        statBoostedZh: STAT_LABEL_ZH[mainStat] || String(mainStat).toUpperCase(),
        oldStatValue: currentValue,
        newStatValue: nextValue,
        statDelta: Number(delta),
        targetStatSummary: mainStat
      };
    }

    // 副手 / 盾牌 / 防具：依階級隨機加到原本已有的屬性
    const candidateStats = Object.entries(equipment.equipStats)
      .filter(([key, value]) => key && Number.isFinite(Number(value)) && Number(value) !== 0)
      .map(([key]) => key);
    if (!candidateStats.length) return null;

    const delta = ARMOR_RANDOM_ENHANCE_BONUS_BY_TIER[normalizedTier] ?? 1;
    const appliedStats = {};
    for (let i = 0; i < delta; i++) {
      const chosenStat = candidateStats[Math.floor(Math.random() * candidateStats.length)];
      equipment.equipStats[chosenStat] = Number((Number(equipment.equipStats[chosenStat]) || 0) + 1);
      appliedStats[chosenStat] = (appliedStats[chosenStat] || 0) + 1;
    }
    const summary = Object.entries(appliedStats)
      .map(([key, amount]) => `${STAT_LABEL_ZH[key] || String(key).toUpperCase()}+${amount}`)
      .join(" / ");
    return {
      statBoosted: "random",
      statBoostedZh: "隨機屬性",
      oldStatValue: null,
      newStatValue: null,
      statDelta: Number(delta),
      targetStatSummary: candidateStats.map((stat) => STAT_LABEL_ZH[stat] || String(stat).toUpperCase()).join(" / "),
      appliedStats: summary || null
    };
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

  _buildEnhancePreview(equipment, tier, currentLevel) {
    const normalizedTier = String(tier || "").toUpperCase();
    const equipSlot = String(equipment?.equipSlot || "");
    const isMainWeapon = equipSlot === "weapon";
    let statBoosted = null;
    let delta = 0;
    let targetStatSummary = "";

    if (isMainWeapon) {
      statBoosted = this._getWeaponMainStat(equipment);
      delta = WEAPON_ENHANCE_BONUS_BY_TIER[normalizedTier] ?? 1;
      targetStatSummary = statBoosted ? (STAT_LABEL_ZH[statBoosted] || String(statBoosted).toUpperCase()) : "";
    } else {
      const candidateStats = Object.entries(equipment?.equipStats || {})
        .filter(([key, value]) => key && Number.isFinite(Number(value)) && Number(value) !== 0)
        .map(([key]) => key);
      if (!candidateStats.length) return null;
      delta = ARMOR_RANDOM_ENHANCE_BONUS_BY_TIER[normalizedTier] ?? 1;
      targetStatSummary = candidateStats.map((stat) => STAT_LABEL_ZH[stat] || String(stat).toUpperCase()).join(" / ");
    }

    const equipStats = equipment?.equipStats || {};
    const currentValue = statBoosted && statBoosted !== "random" ? (Number(equipStats?.[statBoosted]) || 0) : null;
    const nextValue = statBoosted && statBoosted !== "random" ? Number((currentValue + delta).toFixed(2)) : null;

    return {
      statBoosted,
      statBoostedZh: statBoosted ? (STAT_LABEL_ZH[statBoosted] || String(statBoosted).toUpperCase()) : (targetStatSummary ? "隨機屬性" : null),
      oldStatValue: currentValue,
      newStatValue: nextValue,
      statDelta: Number(delta),
      targetStatSummary,
      appliedStats: null
    };
  }

  async _consumeGold(discordId, displayName, amount) {
    if (!Number.isFinite(amount) || amount <= 0) return;

    if (this.rewardService?.grantCurrency) {
      await this.rewardService.grantCurrency({
        discordId,
        displayName,
        currencyType: "gold",
        amount: -Math.abs(Math.trunc(amount)),
        source: CURRENCY_SOURCES.ENHANCE,
        operator: "enhance:equipment"
      });
      return;
    }

    if (!this.walletRepository) {
      throw new AppError(ERROR_CODES.INTERNAL_ERROR, "缺少金幣扣款服務", 500);
    }

    const wallet = await this.walletRepository.findByPlayerId(discordId);
    if (!wallet) {
      throw new AppError(ERROR_CODES.PLAYER_NOT_FOUND, "玩家錢包未找到", 404);
    }
    if ((wallet.gold || 0) < amount) {
      throw new AppError(ERROR_CODES.INSUFFICIENT_BALANCE, "金幣不足", 400);
    }
    wallet.gold = (wallet.gold || 0) - amount;
    wallet.updatedAt = new Date().toISOString();
    await this.walletRepository.save(wallet);
  }

  /**
   * 取得某個玩家的強化進度信息（用於 UI 顯示）
   */
  async getEnhanceInfo(discordId, inventoryUuid, options = {}) {
    const mode = normalizeEnhanceMode(options?.mode);
    const isGamble = mode === ENHANCE_MODES.GAMBLE;
    const costMultiplier = isGamble ? 0.5 : 1;
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
    if (isGamble && currentLevel < GAMBLE_MIN_ENHANCE_LEVEL) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "賭鬼強化需裝備至少 +1 才能使用", 400);
    }
    const preview = this._buildEnhancePreview(equipment, tier, currentLevel);

    if (!["D", "C", "B", "A", "S"].includes(tier)) {
      return null; // 無法強化的道具
    }

    const gemItemId = ENHANCE_GEMS[tier];
    const gemsOwned = this._countGemsInInventory(inventory, gemItemId);
    const wallet = this.walletRepository ? await this.walletRepository.findByPlayerId(discordId).catch(() => null) : null;
    const goldOwned = Math.max(0, Number(wallet?.gold) || 0);

    const isMaxed = currentLevel >= MAX_ENHANCE_LEVEL;
    const { gemsRequired, goldRequired, successRate } = isMaxed
      ? { gemsRequired: -1, goldRequired: -1, successRate: -1 }
      : getEnhanceCost(tier, currentLevel);
    const adjustedGemsRequired = gemsRequired > 0 ? Math.max(1, Math.ceil(gemsRequired * costMultiplier)) : gemsRequired;
    const adjustedGoldRequired = goldRequired >= 0 ? Math.max(0, Math.ceil(goldRequired * costMultiplier)) : goldRequired;

    return {
      mode,
      isGamble,
      explodeRate: isGamble ? 50 : 0,
      itemName: equipment.itemName,
      tier,
      currentLevel,
      isMaxed,
      currentEquipStats: equipment.equipStats || null,
      gemsRequired: adjustedGemsRequired > 0 ? adjustedGemsRequired : null,
      goldRequired: adjustedGoldRequired >= 0 ? adjustedGoldRequired : null,
      gemsOwned,
      goldOwned,
      successRate: successRate > 0 ? successRate : null,
      nextLevel: isMaxed ? null : currentLevel + 1,
      statBoosted: preview.statBoosted,
      statBoostedZh: preview.statBoostedZh,
      oldStatValue: preview.oldStatValue,
      newStatValue: preview.newStatValue,
      statDelta: preview.statDelta,
      targetStatSummary: preview.targetStatSummary,
      appliedStats: preview.appliedStats || null
    };
  }
}

module.exports = { EnhanceService };
