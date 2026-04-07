const { AppError, ERROR_CODES } = require("../../shared/errors");
const { CURRENCY_SOURCES, EXP_SOURCES } = require("../../shared/sources");

const VALID_EFFECT_TYPES = ["none", "grant_gold", "grant_diamond", "grant_exp", "grant_status_points", "checkin_multiplier"];

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
    if (!libraryItem) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, `道具庫中找不到孤道具: ${itemLibraryId}`, 404);
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
      imageUrl: libraryItem.imageUrl || null,
      imageThumbnailUrl: libraryItem.imageThumbnailUrl || null,
      equipSlot: libraryItem.itemType === "equipment" ? (libraryItem.equipSlot || null) : null,
      equipStats: libraryItem.itemType === "equipment" ? (libraryItem.equipStats || null) : null,
      weaponType: libraryItem.itemType === "equipment" ? (libraryItem.weaponType || null) : null,
      isTwoHanded: libraryItem.itemType === "equipment" ? (libraryItem.isTwoHanded || false) : false,
      createdAt: new Date().toISOString()
    };
    return this.shopRepository.save(item);
  }

  async updateItem(id, fields) {
    const item = await this.getItemById(id);
    const updated = { ...item };
    // 重新連結道具庫道具（同時更新 name/desc/effect/imageUrl）
    if (fields.itemLibraryId !== undefined && this.itemRepository) {
      const libraryItem = await this.itemRepository.findById(fields.itemLibraryId);
      if (!libraryItem) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, `道具庫中找不到此道具: ${fields.itemLibraryId}`, 404);
      updated.itemLibraryId = fields.itemLibraryId;
      updated.name = libraryItem.name;
      updated.description = libraryItem.description;
      updated.effect = libraryItem.effect || { type: "none", value: 0 };
      updated.itemType = libraryItem.itemType || "consumable";
      updated.imageUrl = libraryItem.imageUrl || null;
      updated.imageThumbnailUrl = libraryItem.imageThumbnailUrl || null;
      updated.equipSlot = libraryItem.itemType === "equipment" ? (libraryItem.equipSlot || null) : null;
      updated.equipStats = libraryItem.itemType === "equipment" ? (libraryItem.equipStats || null) : null;
      updated.weaponType = libraryItem.itemType === "equipment" ? (libraryItem.weaponType || null) : null;
      updated.isTwoHanded = libraryItem.itemType === "equipment" ? (libraryItem.isTwoHanded || false) : false;
    }
    if (fields.price !== undefined) updated.price = Math.max(0, Number(fields.price) || 0);
    if (fields.currency !== undefined && ["gold", "diamond"].includes(fields.currency)) updated.currency = fields.currency;
    if (fields.stock !== undefined) updated.stock = Number(fields.stock) === -1 ? -1 : Math.max(0, Number(fields.stock) || 0);
    if (fields.enabled !== undefined) updated.enabled = Boolean(fields.enabled);
    if (fields.isSale !== undefined) updated.isSale = Boolean(fields.isSale);
    if (fields.allowedTiers !== undefined) updated.allowedTiers = Array.isArray(fields.allowedTiers) ? fields.allowedTiers.map(String).filter(Boolean) : [];
    if (fields.maxPerMonth !== undefined) updated.maxPerMonth = Math.max(0, Number(fields.maxPerMonth) || 0);
    // 保留直接更新 imageUrl 的能力（圖片上傳路由用）
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

  /**
   * 解析玩家目前擁有的最高等級，並寫入 progress.playerTier。
   * fire-and-forget 用途，失敗不拋錯。
   */
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
    } catch { /* 非關鍵操作，靜默失敗 */ }
  }

  /** yearMonth: "YYYY-MM" */
  _currentYearMonth() {
    return new Date().toISOString().slice(0, 7);
  }

  async purchase(discordId, displayName, itemId, memberRoleIds = []) {
    const item = await this.getItemById(itemId);
    if (!item.enabled) throw new AppError(ERROR_CODES.SHOP_ITEM_DISABLED, "此商品目前已下架", 400);
    if (item.stock === 0) throw new AppError(ERROR_CODES.ITEM_OUT_OF_STOCK, "此商品已售完", 400);

    // 身分組限制：解析玩家最高等級，高等級可購買低等級商品
    const allowedTiers = item.allowedTiers || [];
    if (allowedTiers.length > 0 && this.playerTierService) {
      const playerHighestTier = await this.playerTierService.resolveHighestTier(memberRoleIds);
      const canBuy = allowedTiers.includes(playerHighestTier ?? "");
      if (!canBuy) throw new AppError(ERROR_CODES.FORBIDDEN, "你目前的等級無法購買此商品", 403);
    }

    // 每月次數限制
    const maxPerMonth = item.maxPerMonth || 0;
    if (maxPerMonth > 0) {
      const progress = await this.progressRepository.findByPlayerId(discordId);
      const ym = this._currentYearMonth();
      const counts = (progress?.shopMonthlyCount || {});
      const used = (counts[itemId] || {})[ym] || 0;
      if (used >= maxPerMonth) {
        throw new AppError(ERROR_CODES.FORBIDDEN, `此商品本月已達領取上限（${maxPerMonth} 次）`, 403);
      }
    }

    // 免費商品（price = 0）不扣款
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

    // 寫入背包 + 更新月次數
    const progress = await this.progressRepository.findByPlayerId(discordId);
    if (progress) {
      if (!Array.isArray(progress.inventory)) progress.inventory = [];
      // 記錄月次數
      if ((item.maxPerMonth || 0) > 0) {
        if (!progress.shopMonthlyCount) progress.shopMonthlyCount = {};
        const ym = this._currentYearMonth();
        if (!progress.shopMonthlyCount[itemId]) progress.shopMonthlyCount[itemId] = {};
        progress.shopMonthlyCount[itemId][ym] = ((progress.shopMonthlyCount[itemId][ym] || 0) + 1);
      }
      progress.inventory.push({
        uuid: crypto.randomUUID(),
        itemId: item.id,
        itemName: item.name,
        itemEffect: item.effect || { type: "none", value: 0 },
        itemType: item.itemType || "consumable",
        imageUrl: item.imageUrl || null,
        imageThumbnailUrl: item.imageThumbnailUrl || null,
        equipSlot: item.equipSlot || null,
        equipStats: item.equipStats || null,
        weaponType: item.weaponType || null,
        isTwoHanded: item.isTwoHanded || false,
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
    // 消耗品才從背包移除；圖片/裝備永久保留
    const itemType = entry.itemType || "consumable";
    if (itemType === "consumable") {
      progress.inventory.splice(idx, 1);
    }
    const effect = entry.itemEffect || { type: "none", value: 0 };
    let effectDesc = "";

    // 直接修改 progress 的效果先在 save 前處理
    if (effect.type === "grant_status_points") {
      progress.statusPoints = (progress.statusPoints || 0) + (effect.value || 0);
      effectDesc = `📊 +${effect.value} 屬性點`;
    } else if (effect.type === "checkin_multiplier") {
      progress.flags = progress.flags || {};
      progress.flags.checkinMultiplier = effect.value || 2;
      effectDesc = `🎯 下次打卡 ×${effect.value} 倍`;
    }
    progress.updatedAt = new Date().toISOString();
    await this.progressRepository.save(progress);

    // 需要呼叫外部 service 的效果
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

    return { itemName: entry.itemName, effectDesc };
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

  async equipItem(discordId, entryUuid) {
    const progress = await this.progressRepository.findByPlayerId(discordId);
    if (!progress) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到資料", 404);
    const idx = (progress.inventory || []).findIndex((e) => e.uuid === entryUuid);
    if (idx === -1) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "背包中找不到此裝備", 404);
    const entry = progress.inventory[idx];
    if (entry.itemType !== "equipment") throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "此物品不是裝備", 400);
    const slot = entry.equipSlot;
    if (!slot) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "此裝備未指定槽位", 400);
    if (!progress.equipment) progress.equipment = {};

    // 雙手武器限制
    if (slot === "weapon" && entry.isTwoHanded) {
      // 換上雙手武器：自動卸下副手
      const shieldItem = progress.equipment["shield"] || null;
      if (shieldItem) {
        if (!Array.isArray(progress.inventory)) progress.inventory = [];
        progress.inventory.push(shieldItem);
        progress.equipment["shield"] = null;
      }
    }
    if (slot === "shield") {
      // 嘗試裝副手：主手若是雙手武器則拒絕
      const mainWeapon = progress.equipment["weapon"] || null;
      if (mainWeapon?.isTwoHanded) {
        throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "主手裝備了雙手武器，無法使用副手槽！", 400);
      }
    }

    const current = progress.equipment[slot] || null;
    // 從背包移除
    progress.inventory.splice(idx, 1);
    // 從槽換下的裝回背包
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
}

module.exports = { ShopService };
