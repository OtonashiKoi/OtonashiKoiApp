const { AppError, ERROR_CODES } = require("../../shared/errors");
const { CURRENCY_SOURCES, EXP_SOURCES } = require("../../shared/sources");
const { applyEffectInstances } = require("../../shared/effectEngine");
const crypto = require("crypto");

// 各 tier 裝備販售價格
const TIER_SELL_PRICE = { D: 10, C: 50, B: 100, A: 150 };

const VALID_EFFECT_TYPES = ["none", "grant_gold", "grant_diamond", "grant_exp", "grant_status_points", "checkin_multiplier", "reroll_attributes"];

class ShopService {
  constructor(shopRepository, playerService, rewardService, progressRepository, progressService, itemRepository, playerTierService) {
    this.shopRepository = shopRepository;
    this.playerService = playerService;
    this.rewardService = rewardService;
    this.progressRepository = progressRepository;
    this.progressService = progressService;
    this.itemRepository = itemRepository;
    this.playerTierService = playerTierService;
  }

  _normalizeEffect(effect) {
    if (!effect || !VALID_EFFECT_TYPES.includes(effect.type)) return { type: "none", value: 0 };
    return { type: effect.type, value: Math.max(0, Number(effect.value) || 0) };
  }

  async listItems({ includeDisabled = false } = {}) {
    const items = await this.shopRepository.findAll();
    return includeDisabled ? items : items.filter((i) => i.enabled);
  }

  async getItemById(id) {
    const item = await this.shopRepository.findById(id);
    if (!item) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, `商品不存在: ${id}`, 404);
    return item;
  }

  async createItem({ itemLibraryId, price, currency, stock, enabled, isSale, allowedTiers, maxPerMonth }) {
    if (!itemLibraryId) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "請從道具庫選擇道具", 400);
    if (!this.itemRepository) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "itemRepository 未初始化", 500);
    const libraryItem = await this.itemRepository.findById(itemLibraryId);
    if (!libraryItem) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, `道具庫中找不到此道具: ${itemLibraryId}`, 404);
    const item = {
      id: crypto.randomUUID(),
      itemLibraryId,
      name: libraryItem.name,
      description: libraryItem.description,
      price: Math.max(0, Number(price) || 0),
      currency: ["gold", "diamond"].includes(currency) ? currency : "gold",
      stock: Number(stock) === -1 ? -1 : Math.max(0, Number(stock) || 0),
      enabled: Boolean(enabled),
      isSale: Boolean(isSale),
      allowedTiers: Array.isArray(allowedTiers) ? allowedTiers.map(String).filter(Boolean) : [],
      maxPerMonth: Math.max(0, Number(maxPerMonth) || 0),
      itemType: libraryItem.itemType || "consumable",
      effect: libraryItem.effect || { type: "none", value: 0 },
      useEffects: libraryItem.useEffects || [],
      passiveEffects: libraryItem.passiveEffects || [],
      procEffects: libraryItem.procEffects || [],
      combatEffects: libraryItem.combatEffects || [],
      imageUrl: libraryItem.imageUrl || null,
      imageThumbnailUrl: libraryItem.imageThumbnailUrl || null,
      equipSlot: libraryItem.itemType === "equipment" ? (libraryItem.equipSlot || null) : null,
      equipStats: libraryItem.itemType === "equipment" ? (libraryItem.equipStats || null) : null,
      weaponType: libraryItem.itemType === "equipment" ? (libraryItem.weaponType || null) : null,
      isTwoHanded: libraryItem.itemType === "equipment" ? (libraryItem.isTwoHanded || false) : false,
      tier: libraryItem.tier || null,
      createdAt: new Date().toISOString()
    };
    return this.shopRepository.save(item);
  }

  async updateItem(id, fields) {
    const item = await this.getItemById(id);
    const updated = { ...item };
    if (fields.itemLibraryId !== undefined && this.itemRepository) {
      const libraryItem = await this.itemRepository.findById(fields.itemLibraryId);
      if (!libraryItem) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, `道具庫中找不到此道具: ${fields.itemLibraryId}`, 404);
      updated.itemLibraryId = fields.itemLibraryId;
      updated.name = libraryItem.name;
      updated.description = libraryItem.description;
      updated.effect = libraryItem.effect || { type: "none", value: 0 };
      updated.itemType = libraryItem.itemType || "consumable";
      updated.useEffects = libraryItem.useEffects || [];
      updated.passiveEffects = libraryItem.passiveEffects || [];
      updated.procEffects = libraryItem.procEffects || [];
      updated.combatEffects = libraryItem.combatEffects || [];
      updated.imageUrl = libraryItem.imageUrl || null;
      updated.imageThumbnailUrl = libraryItem.imageThumbnailUrl || null;
      updated.equipSlot = libraryItem.itemType === "equipment" ? (libraryItem.equipSlot || null) : null;
      updated.equipStats = libraryItem.itemType === "equipment" ? (libraryItem.equipStats || null) : null;
      updated.weaponType = libraryItem.itemType === "equipment" ? (libraryItem.weaponType || null) : null;
      updated.isTwoHanded = libraryItem.itemType === "equipment" ? (libraryItem.isTwoHanded || false) : false;
      updated.tier = libraryItem.tier || null;
    }
    if (fields.price !== undefined) updated.price = Math.max(0, Number(fields.price) || 0);
    if (fields.currency !== undefined && ["gold", "diamond"].includes(fields.currency)) updated.currency = fields.currency;
    if (fields.stock !== undefined) updated.stock = Number(fields.stock) === -1 ? -1 : Math.max(0, Number(fields.stock) || 0);
    if (fields.enabled !== undefined) updated.enabled = Boolean(fields.enabled);
    if (fields.isSale !== undefined) updated.isSale = Boolean(fields.isSale);
    if (fields.allowedTiers !== undefined) updated.allowedTiers = Array.isArray(fields.allowedTiers) ? fields.allowedTiers.map(String).filter(Boolean) : [];
    if (fields.maxPerMonth !== undefined) updated.maxPerMonth = Math.max(0, Number(fields.maxPerMonth) || 0);
    if (fields.imageUrl !== undefined) updated.imageUrl = fields.imageUrl || null;
    if (fields.imageThumbnailUrl !== undefined) updated.imageThumbnailUrl = fields.imageThumbnailUrl || null;
    if (fields.weaponType !== undefined) updated.weaponType = fields.weaponType || null;
    if (fields.isTwoHanded !== undefined) updated.isTwoHanded = Boolean(fields.isTwoHanded);
    return this.shopRepository.save(updated);
  }

  async deleteItem(id) {
    await this.getItemById(id);
    await this.shopRepository.delete(id);
  }

  async updatePlayerTier(discordId, memberRoleIds) {
    if (!this.playerTierService) return;
    try {
      const highestTier = await this.playerTierService.resolveHighestTier(memberRoleIds);
      const progress = await this.progressRepository.findByPlayerId(discordId);
      if (progress && progress.playerTier !== highestTier) {
        progress.playerTier = highestTier;
        progress.updatedAt = new Date().toISOString();
        await this.progressRepository.save(progress);
      }
    } catch { /* ignored */ }
  }

  _currentYearMonth() {
    return new Date().toISOString().slice(0, 7);
  }

  async purchase(discordId, displayName, itemId, memberRoleIds = []) {
    const item = await this.getItemById(itemId);
    let libraryItem = null;
    let effectiveTier = item.tier || null;
    if (!effectiveTier && item.itemLibraryId && this.itemRepository) {
      libraryItem = await this.itemRepository.findById(item.itemLibraryId).catch(() => null);
      effectiveTier = libraryItem?.tier || null;
      if (effectiveTier) {
        await this.shopRepository.save({ ...item, tier: effectiveTier });
        item.tier = effectiveTier;
      }
    }
    if (!libraryItem && item.itemLibraryId && this.itemRepository) {
      libraryItem = await this.itemRepository.findById(item.itemLibraryId).catch(() => null);
    }
    if (!item.enabled) throw new AppError(ERROR_CODES.SHOP_ITEM_DISABLED, "此商品目前已下架", 400);
    if (item.stock === 0) throw new AppError(ERROR_CODES.ITEM_OUT_OF_STOCK, "此商品已售完", 400);

    const allowedTiers = item.allowedTiers || [];
    if (allowedTiers.length > 0 && this.playerTierService) {
      const playerHighestTier = await this.playerTierService.resolveHighestTier(memberRoleIds);
      const canBuy = allowedTiers.includes(playerHighestTier ?? "");
      if (!canBuy) throw new AppError(ERROR_CODES.FORBIDDEN, "你目前的等級無法購買此商品", 403);
    }

    const maxPerMonth = item.maxPerMonth || 0;
    const progress = await this.progressRepository.findByPlayerId(discordId);
    if (maxPerMonth > 0) {
      const ym = this._currentYearMonth();
      const counts = (progress?.shopMonthlyCount || {});
      const used = (counts[itemId] || {})[ym] || 0;
      if (used >= maxPerMonth) {
        throw new AppError(ERROR_CODES.FORBIDDEN, `此商品本月已達領取上限（${maxPerMonth} 次）`, 403);
      }
    }

    if (item.price > 0) {
        await this.rewardService.grantCurrency({
        discordId,
        displayName,
        currencyType: item.currency,
        amount: -item.price,
        source: CURRENCY_SOURCES.SHOP_PURCHASE,
        operator: "shop"
      });
    }

    if (item.stock > 0) {
      await this.shopRepository.save({ ...item, stock: item.stock - 1 });
    }

    if (progress) {
      if (!Array.isArray(progress.inventory)) progress.inventory = [];
      if ((item.maxPerMonth || 0) > 0) {
        if (!progress.shopMonthlyCount) progress.shopMonthlyCount = {};
        const ym = this._currentYearMonth();
        if (!progress.shopMonthlyCount[itemId]) progress.shopMonthlyCount[itemId] = {};
        progress.shopMonthlyCount[itemId][ym] = ((progress.shopMonthlyCount[itemId][ym] || 0) + 1);
      }
      progress.inventory.push({
        uuid: crypto.randomUUID(),
        itemId: item.itemLibraryId || item.id,
        itemName: item.name,
        itemEffect: item.effect || { type: "none", value: 0 },
        useEffects: item.useEffects || libraryItem?.useEffects || [],
        passiveEffects: item.passiveEffects || libraryItem?.passiveEffects || [],
        procEffects: item.procEffects || libraryItem?.procEffects || [],
        combatEffects: item.combatEffects || libraryItem?.combatEffects || [],
        itemType: item.itemType || "consumable",
        imageUrl: item.imageUrl || null,
        imageThumbnailUrl: item.imageThumbnailUrl || null,
        equipSlot: item.equipSlot || null,
        equipStats: item.equipStats || null,
        weaponType: item.weaponType || null,
        isTwoHanded: item.isTwoHanded || false,
        tier: effectiveTier,
        purchasedAt: new Date().toISOString()
      });
      progress.updatedAt = new Date().toISOString();
      await this.progressRepository.save(progress);
    }

    return { item };
  }

  async useItem(discordId, entryUuid, displayName) {
    const progress = await this.progressRepository.findByPlayerId(discordId);
    if (!progress) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到背包資料", 404);
    const idx = (progress.inventory || []).findIndex((e) => e.uuid === entryUuid);
    if (idx === -1) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "背包中找不到此物品", 404);
    const entry = progress.inventory[idx];
    const itemType = entry.itemType || "consumable";
    if (itemType === "consumable") {
      progress.inventory.splice(idx, 1);
    }
    const effect = entry.itemEffect || { type: "none", value: 0 };
    const useEffects = Array.isArray(entry.useEffects) ? entry.useEffects : [];
    let effectDesc = "";

    if (effect.type === "grant_status_points") {
      progress.statusPoints = (progress.statusPoints || 0) + (effect.value || 0);
      effectDesc = `📊 +${effect.value} 屬性點`;
    } else if (effect.type === "checkin_multiplier") {
      progress.flags = progress.flags || {};
      progress.flags.checkinMultiplier = effect.value || 2;
      effectDesc = `🎯 下次打卡 ×${effect.value} 倍`;
    } else if (effect.type === "reroll_attributes") {
      const ATTR_KEYS = ["str", "agi", "vit", "int", "dex", "luk"];
      const level = progress.level || 1;
      const levelUpPoints = (level - 1) * 2;
      const newAttrs = { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 };
      for (let i = 0; i < levelUpPoints; i++) {
        const key = ATTR_KEYS[Math.floor(Math.random() * ATTR_KEYS.length)];
        newAttrs[key]++;
      }
      progress.attributes = newAttrs;
      const attrLine = ATTR_KEYS.map(k => `${k.toUpperCase()}:${newAttrs[k]}`).join(" ");
      effectDesc = `🔮 屬性已重製！新屬性：${attrLine}`;
    }
    progress.updatedAt = new Date().toISOString();
    await this.progressRepository.save(progress);

    const dn = displayName || "";
    if (effect.type === "grant_gold") {
      await this.rewardService.grantCurrency({ discordId, displayName: dn, currencyType: "gold", amount: effect.value, source: CURRENCY_SOURCES.ITEM_USE, operator: "shop:use-item" });
      effectDesc = `💰 +${effect.value} 金幣`;
    } else if (effect.type === "grant_diamond") {
      await this.rewardService.grantCurrency({ discordId, displayName: dn, currencyType: "diamond", amount: effect.value, source: CURRENCY_SOURCES.ITEM_USE, operator: "shop:use-item" });
      effectDesc = `💎 +${effect.value} 鑽石`;
    } else if (effect.type === "grant_exp" && this.progressService) {
      await this.progressService.grantExp({ discordId, displayName: dn, amount: effect.value, source: EXP_SOURCES.ITEM_USE_EXP });
      effectDesc = `✨ +${effect.value} 經驗值`;
    }

    if (useEffects.length > 0) {
      progress.activeEffects = applyEffectInstances(progress.activeEffects, useEffects, {
        sourceType: "item",
        sourceId: entry.itemId || entry.uuid
      });
      progress.updatedAt = new Date().toISOString();
      await this.progressRepository.save(progress);
      const statusLine = `附加狀態 ${useEffects.map((useEffect) => useEffect.definitionName || useEffect.key).join("、")}`;
      effectDesc = effectDesc ? `${effectDesc} / ${statusLine}` : statusLine;
    }

    return { itemName: entry.itemName, effectDesc };
  }

  async sellItem(discordId, entryUuid) {
    const progress = await this.progressRepository.findByPlayerId(discordId);
    if (!progress) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到背包資料", 404);
    const idx = (progress.inventory || []).findIndex((e) => e.uuid === entryUuid);
    if (idx === -1) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "背包中找不到此物品", 404);
    const entry = progress.inventory[idx];
    let tier = entry.tier || null;
    if (!tier && this.itemRepository && entry.itemId) {
      const libItem = await this.itemRepository.findById(entry.itemId).catch(() => null);
      tier = libItem?.tier || null;
    }
    const price = TIER_SELL_PRICE[tier] ?? null;
    if (price === null) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "此物品沒有設定階級，無法販售", 400);
    progress.inventory.splice(idx, 1);
    progress.updatedAt = new Date().toISOString();
    await this.progressRepository.save(progress);
    await this.rewardService.grantCurrency({
      discordId,
      displayName: discordId,
      currencyType: "gold",
      amount: price,
      source: CURRENCY_SOURCES.ITEM_SELL,
      operator: "shop:sell-item"
    });
    return { itemName: entry.itemName, tier, price };
  }

  async discardItem(discordId, entryUuid) {
    const progress = await this.progressRepository.findByPlayerId(discordId);
    if (!progress) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到背包資料", 404);
    const idx = (progress.inventory || []).findIndex((e) => e.uuid === entryUuid);
    if (idx === -1) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "背包中找不到此物品", 404);
    const entry = progress.inventory[idx];
    progress.inventory.splice(idx, 1);
    progress.updatedAt = new Date().toISOString();
    await this.progressRepository.save(progress);
    return { itemName: entry.itemName };
  }

  async equipItem(discordId, entryUuid, targetSlot = null) {
    const progress = await this.progressRepository.findByPlayerId(discordId);
    if (!progress) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到資料", 404);
    const idx = (progress.inventory || []).findIndex((e) => e.uuid === entryUuid);
    if (idx === -1) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "背包中找不到此裝備", 404);
    const entry = progress.inventory[idx];
    if (entry.itemType !== "equipment" && entry.itemType !== "job_badge") throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "此物品不是裝備", 400);

    let slot = entry.equipSlot;
    if (!slot) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "此裝備未指定槽位", 400);

    // 特殊卡片：允許指定目標槽位 (special_1, special_2, special_3)
    if (slot === "special" && targetSlot) {
      const SPECIAL_SLOTS = ["special_1", "special_2", "special_3"];
      if (!SPECIAL_SLOTS.includes(targetSlot)) {
        throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "無效的特殊槽位", 400);
      }
      slot = targetSlot;
    } else if (slot === "special" && !targetSlot) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "特殊卡片需指定目標槽位 (special_1/2/3)", 400);
    }

    if (!progress.equipment) progress.equipment = {};

    if (slot === "weapon" && entry.isTwoHanded) {
      const shieldItem = progress.equipment["shield"] || null;
      if (shieldItem) {
        if (!Array.isArray(progress.inventory)) progress.inventory = [];
        progress.inventory.push(shieldItem);
        progress.equipment["shield"] = null;
      }
    }
    if (slot === "shield") {
      const mainWeapon = progress.equipment["weapon"] || null;
      if (mainWeapon?.isTwoHanded) {
        throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "主手裝備了雙手武器，無法使用副手槽！", 400);
      }
    }

    const current = progress.equipment[slot] || null;
    progress.inventory.splice(idx, 1);
    if (current) progress.inventory.push(current);
    progress.equipment[slot] = entry;
    progress.updatedAt = new Date().toISOString();
    await this.progressRepository.save(progress);
    return { itemName: entry.itemName, slot };
  }

  async unequipItem(discordId, slot) {
    const VALID_SLOTS = ["head_top","head_mid","head_low","armor","weapon","shield","garment","shoes","accessory_l","accessory_r","title_eq","job_eq","special_1","special_2","special_3"];
    if (!VALID_SLOTS.includes(slot)) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "無效槽位", 400);
    const progress = await this.progressRepository.findByPlayerId(discordId);
    if (!progress) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到資料", 404);
    const equipped = progress.equipment?.[slot];
    if (!equipped) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "此槽位沒有裝備", 404);
    if (!Array.isArray(progress.inventory)) progress.inventory = [];
    progress.inventory.push(equipped);
    progress.equipment[slot] = null;
    progress.updatedAt = new Date().toISOString();
    await this.progressRepository.save(progress);
    return { itemName: equipped.itemName, slot };
  }

  async enhanceItem(discordId, targetUuid, materialUuid) {
    const ENHANCE_MAX = 3;
    const progress = await this.progressRepository.findByPlayerId(discordId);
    if (!progress) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到背包資料", 404);
    const inv = progress.inventory || [];
    let target = inv.find(e => e.uuid === targetUuid);
    let targetSlotKey = null;
    if (!target) {
      for (const [k, v] of Object.entries(progress.equipment || {})) {
        if (v && v.uuid === targetUuid) { target = v; targetSlotKey = k; break; }
      }
    }
    if (!target) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到目標裝備", 404);
    if (target.itemType !== "equipment" && target.itemType !== "job_badge") throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "目標不是裝備", 400);
    if (target.equipSlot === "special" || target.equipSlot === "job_eq" || target.equipSlot === "title_eq") throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "此槽位裝備無法強化", 400);
    const currentLevel = target.enhanceLevel || 0;
    if (currentLevel >= ENHANCE_MAX) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, `${target.itemName} 已達強化上限（+${ENHANCE_MAX}）`, 400);
    }

    const requiredUnits = Math.pow(2, currentLevel);
    const unitValue = (entry) => {
      const level = Number(entry?.enhanceLevel || 0);
      if (level >= 3) return 0;
      return Math.pow(2, Math.max(0, level));
    };
    const baseName = String(target.itemName || "").replace(/\s*\+\d+$/, "").trim();
    const hasItemId = !!target.itemId;
    const isSameBase = (entry) => {
      if (!entry || entry.itemType !== "equipment") return false;
      if (entry.uuid === target.uuid || entry.uuid === targetUuid) return false;
      if (hasItemId && entry.itemId) return entry.itemId === target.itemId;
      const n = String(entry.itemName || "").replace(/\s*\+\d+$/, "").trim();
      return n === baseName;
    };
    const maxMaterialLevel = Math.min(2, Math.max(0, Number(currentLevel || 0)));
    const candidates = inv
      .filter(isSameBase)
      .filter((entry) => Number(entry?.enhanceLevel || 0) <= maxMaterialLevel);
    const availableUnits = candidates.reduce((sum, entry) => sum + unitValue(entry), 0);
    if (availableUnits < requiredUnits) {
      throw new AppError(
        ERROR_CODES.INVALID_ARGUMENT,
        `材料不足：強化 ${baseName} +${currentLevel} → +${currentLevel + 1} 需要等價 ${requiredUnits} 把同裝備（+1=2、+2=4；+3 不可當材料），背包目前只有等價 ${availableUnits} 把。`,
        400
      );
    }

    function pickMaterials(cands, needUnits) {
      const items = cands.map((entry) => ({ uuid: entry.uuid, units: unitValue(entry) }));
      const limit = needUnits + 8;
      const dp = new Map();
      dp.set(0, { uuids: [], sum: 0, count: 0 });

      for (const it of items) {
        const cur = new Map(dp);
        for (const [sum, state] of dp.entries()) {
          const nsum = Math.min(limit, sum + it.units);
          const cand = { uuids: [...state.uuids, it.uuid], sum: nsum, count: state.count + 1 };
          const prev = cur.get(nsum);
          if (!prev || cand.count < prev.count) cur.set(nsum, cand);
        }
        dp.clear();
        for (const [k, v] of cur.entries()) dp.set(k, v);
      }

      let best = null;
      for (const [sum, state] of dp.entries()) {
        if (sum < needUnits) continue;
        const waste = sum - needUnits;
        if (!best) best = { ...state, waste };
        else if (waste < best.waste) best = { ...state, waste };
        else if (waste === best.waste && state.count < best.count) best = { ...state, waste };
      }
      return best ? best.uuids : [];
    }

    let chosen = [];
    if (materialUuid) {
      const preferred = inv.find((entry) => entry && (entry.uuid === materialUuid || entry.itemId === materialUuid || entry.itemName === materialUuid));
      if (preferred && isSameBase(preferred) && Number(preferred.enhanceLevel || 0) <= maxMaterialLevel) {
        chosen = [preferred.uuid];
      }
    }

    const chosenSet = new Set(chosen);
    const remainingNeed = requiredUnits - chosen.reduce((sum, uuid) => {
      const found = candidates.find((entry) => entry.uuid === uuid);
      return sum + (found ? unitValue(found) : 0);
    }, 0);
    if (remainingNeed > 0) {
      const rest = candidates.filter((entry) => !chosenSet.has(entry.uuid));
      const picked = pickMaterials(rest, remainingNeed);
      chosen = [...chosen, ...picked];
    }
    const chosenUnits = chosen.reduce((sum, uuid) => {
      const found = candidates.find((entry) => entry.uuid === uuid);
      return sum + (found ? unitValue(found) : 0);
    }, 0);
    if (chosenUnits < requiredUnits) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "材料不足（請確認材料在背包中且同裝備）", 400);
    }

    const stats = target.equipStats || {};
    const mainStat = Object.entries(stats).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!mainStat) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "此裝備沒有可強化的屬性", 400);
    const oldStatValue = Number(stats[mainStat] || 0);
    const newStats = { ...stats, [mainStat]: (stats[mainStat] || 0) + 1 };
    const newLevel = currentLevel + 1;
    const newName = `${baseName} +${newLevel}`;
    const updatedTarget = { ...target, equipStats: newStats, enhanceLevel: newLevel, itemName: newName };

    const idxs = [];
    for (let i = 0; i < progress.inventory.length; i += 1) {
      const entry = progress.inventory[i];
      if (entry && chosen.includes(entry.uuid)) idxs.push(i);
    }
    idxs.sort((a, b) => b - a);
    for (const i of idxs) progress.inventory.splice(i, 1);

    if (targetSlotKey) {
      progress.equipment[targetSlotKey] = updatedTarget;
    } else {
      const targetIdx = progress.inventory.findIndex(e => e.uuid === target.uuid);
      if (targetIdx !== -1) progress.inventory[targetIdx] = updatedTarget;
    }
    progress.updatedAt = new Date().toISOString();
    await this.progressRepository.save(progress);
    return {
      itemName: newName,
      enhanceLevel: newLevel,
      statBoosted: mainStat,
      oldStatValue,
      newStatValue: newStats[mainStat],
      materialsConsumed: requiredUnits,
      materialsConsumedUnits: chosenUnits,
      materialsConsumedItems: chosen.length,
      message: `成功將 ${baseName} 強化至 +${newLevel}！`
    };
  }

  async enhanceItemAuto(discordId, targetUuid) {
    return this.enhanceItem(discordId, targetUuid, null);
  }
}

module.exports = { ShopService };
