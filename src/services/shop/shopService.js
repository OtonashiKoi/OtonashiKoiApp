const { AppError, ERROR_CODES } = require("../../shared/errors");
const { CURRENCY_SOURCES, EXP_SOURCES } = require("../../shared/sources");
const { applyEffectInstances } = require("../../shared/effectEngine");
const { MAX_ENHANCE_LEVEL } = require("../../shared/enhanceConfig");
const crypto = require("crypto");

// 各 tier 裝備販售價格
const TIER_SELL_PRICE = { D: 10, C: 50, B: 100, A: 150 };

const VALID_EFFECT_TYPES = ["none", "grant_gold", "grant_diamond", "grant_exp", "grant_status_points", "checkin_multiplier", "reroll_attributes", "level_down_random_attributes"];
const TWO_HANDED_WEAPON_TYPES = new Set(["sword_2h", "axe_2h", "mace_2h", "staff_2h", "bow"]);

class ShopService {
  constructor(shopRepository, playerService, rewardService, progressRepository, progressService, itemRepository, playerTierService, questService = null) {
    this.shopRepository = shopRepository;
    this.playerService = playerService;
    this.rewardService = rewardService;
    this.progressRepository = progressRepository;
    this.progressService = progressService;
    this.itemRepository = itemRepository;
    this.playerTierService = playerTierService;
    this.questService = questService;
  }

  _normalizeEffect(effect) {
    if (!effect || !VALID_EFFECT_TYPES.includes(effect.type)) return { type: "none", value: 0 };
    return { type: effect.type, value: Math.max(0, Number(effect.value) || 0) };
  }

  _rollRandomAttributeDrops(attributes, amount = 2) {
    const ATTR_KEYS = ["str", "agi", "vit", "int", "dex", "luk"];
    const next = { ...(attributes || {}) };
    for (const key of ATTR_KEYS) {
      next[key] = Math.max(1, Number(next[key]) || 1);
    }

    const dropped = [];
    for (let i = 0; i < amount; i++) {
      const available = ATTR_KEYS.filter((key) => next[key] > 1);
      if (!available.length) break;
      const key = available[Math.floor(Math.random() * available.length)];
      next[key] -= 1;
      const existing = dropped.find((entry) => entry.key === key);
      if (existing) existing.amount += 1;
      else dropped.push({ key, amount: 1 });
    }

    return { nextAttributes: next, dropped };
  }

  _resolveIsTwoHanded({ weaponType = null, isTwoHanded = false } = {}) {
    if (weaponType && TWO_HANDED_WEAPON_TYPES.has(String(weaponType))) return true;
    return Boolean(isTwoHanded);
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
      equipSlot: (libraryItem.itemType === "equipment" || libraryItem.itemType === "job_badge") ? (libraryItem.equipSlot || null) : null,
      equipStats: (libraryItem.itemType === "equipment" || libraryItem.itemType === "job_badge") ? (libraryItem.equipStats || null) : null,
      weaponType: libraryItem.itemType === "equipment" ? (libraryItem.weaponType || null) : null,
      isTwoHanded: libraryItem.itemType === "equipment"
        ? this._resolveIsTwoHanded({ weaponType: libraryItem.weaponType, isTwoHanded: libraryItem.isTwoHanded })
        : false,
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
      updated.equipSlot = (libraryItem.itemType === "equipment" || libraryItem.itemType === "job_badge") ? (libraryItem.equipSlot || null) : null;
      updated.equipStats = (libraryItem.itemType === "equipment" || libraryItem.itemType === "job_badge") ? (libraryItem.equipStats || null) : null;
      updated.weaponType = libraryItem.itemType === "equipment" ? (libraryItem.weaponType || null) : null;
      updated.isTwoHanded = libraryItem.itemType === "equipment"
        ? this._resolveIsTwoHanded({ weaponType: libraryItem.weaponType, isTwoHanded: libraryItem.isTwoHanded })
        : false;
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
    if (fields.isTwoHanded !== undefined || fields.weaponType !== undefined) {
      updated.isTwoHanded = this._resolveIsTwoHanded({
        weaponType: updated.weaponType,
        isTwoHanded: fields.isTwoHanded !== undefined ? fields.isTwoHanded : updated.isTwoHanded
      });
    }
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
      // 原則：玩家身上只存「玩家自有資料」（uuid、itemId、購買時間等）。
      // passiveEffects/combatEffects 等設計欄位永遠從 items DB 讀取（mergeEquippedFromLibrary），
      // 這裡雖然也存一份，但戰鬥時會被 DB 最新值覆蓋，不需要手動同步。
      progress.inventory.push({
        uuid: crypto.randomUUID(),
        itemId: item.itemLibraryId || item.id,
        itemName: item.name,
        itemEffect: item.effect || { type: "none", value: 0 },
        useEffects: libraryItem?.useEffects || item.useEffects || [],
        passiveEffects: libraryItem?.passiveEffects || item.passiveEffects || [],
        procEffects: libraryItem?.procEffects || item.procEffects || [],
        combatEffects: libraryItem?.combatEffects || item.combatEffects || [],
        itemType: item.itemType || "consumable",
        imageUrl: item.imageUrl || null,
        imageThumbnailUrl: item.imageThumbnailUrl || null,
        equipSlot: item.equipSlot || null,
        equipStats: libraryItem?.equipStats || item.equipStats || null,
        weaponType: item.weaponType || null,
        isTwoHanded: this._resolveIsTwoHanded({ weaponType: item.weaponType, isTwoHanded: item.isTwoHanded }),
        tier: effectiveTier,
        purchasedAt: new Date().toISOString()
      });
      progress.updatedAt = new Date().toISOString();
      await this.progressRepository.save(progress);
    }

    return { item };
  }

  async useItem(discordId, entryUuid, displayName) {
    const ATTR_KEYS = ["str", "agi", "vit", "int", "dex", "luk"];
    const ENHANCE_GEM_IDS = new Set([
      '72fde92d-e33f-42fb-8d86-2e811d03f84d', // D
      '556db9e1-b084-4b22-bab5-a66c2b586184', // C
      '8fdfa7d9-f0fa-4e6a-a291-703b1e354072', // B
      'a6ae293d-52fc-4af5-8770-891ddf842e35'  // A
    ]);
    const CAS_MAX_RETRIES = 8;

    let savedEntry = null;
    let savedEffect = null;
    let savedUseEffects = [];
    let savedEffectDesc = "";
    let casSuccess = false;

    // CAS 重試：避免與 grantExp、其他 progress 寫入衝突
    for (let attempt = 0; attempt < CAS_MAX_RETRIES; attempt++) {
      const progress = await this.progressRepository.findByPlayerId(discordId);
      if (!progress) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到背包資料", 404);

      const idx = (progress.inventory || []).findIndex((e) => e.uuid === entryUuid);
      if (idx === -1) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "背包中找不到此物品", 404);

      const entry = progress.inventory[idx];
      const itemType = entry.itemType || "consumable";

      if (ENHANCE_GEM_IDS.has(entry.itemId)) {
        throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "強化寶石只能用於強化裝備，無法直接使用", 400);
      }

      const effect = entry.itemEffect || { type: "none", value: 0 };
      const useEffects = Array.isArray(entry.useEffects) ? entry.useEffects : [];

      // 預先驗證（不依賴狀態）
      if (effect.type === "level_down_random_attributes") {
        const currentLevel = Math.max(1, Number(progress.level) || 1);
        if (currentLevel <= 1) {
          throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "等級已是 1，無法再降低。", 400);
        }
      }

      // 深拷貝避免污染 request cache（同 grantExp 的修法）
      const next = {
        ...progress,
        attributes: { ...(progress.attributes || { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 }) },
        inventory: (progress.inventory || []).map(e => ({ ...e })),
        flags: { ...(progress.flags || {}) },
        activeEffects: [...(progress.activeEffects || [])]
      };

      // 消耗物品
      if (itemType === "consumable") {
        const nextEntry = next.inventory[idx];
        if (nextEntry.stackCount && nextEntry.stackCount > 1) {
          nextEntry.stackCount -= 1;
        } else {
          next.inventory.splice(idx, 1);
        }
      }

      let effectDesc = "";

      if (effect.type === "grant_status_points") {
        next.statusPoints = (next.statusPoints || 0) + (effect.value || 0);
        effectDesc = `📊 +${effect.value} 屬性點`;
      } else if (effect.type === "checkin_multiplier") {
        next.flags.checkinMultiplier = effect.value || 2;
        effectDesc = `🎯 下次打卡 ×${effect.value} 倍`;
      } else if (effect.type === "reroll_attributes") {
        // 用「目前實際持有的總點數」當預算，保留藥水等額外獲得的點數
        const currentAttrTotal = ATTR_KEYS.reduce((sum, k) => sum + (Number(next.attributes?.[k]) || 0), 0);
        const currentStatusPoints = next.statusPoints || 0;
        const totalPoints = currentAttrTotal + currentStatusPoints;
        const pointsToDistribute = Math.max(0, totalPoints - 6);
        const newAttrs = { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 };
        for (let i = 0; i < pointsToDistribute; i++) {
          const key = ATTR_KEYS[Math.floor(Math.random() * ATTR_KEYS.length)];
          newAttrs[key]++;
        }
        next.attributes = newAttrs;
        next.statusPoints = 0;
        const attrLine = ATTR_KEYS.map(k => `${k.toUpperCase()}:${newAttrs[k]}`).join(" ");
        effectDesc = `🔮 屬性已重製！新屬性：${attrLine}`;
      } else if (effect.type === "level_down_random_attributes") {
        const currentLevel = Math.max(1, Number(next.level) || 1);
        const { nextAttributes, dropped } = this._rollRandomAttributeDrops(next.attributes, 2);
        next.level = currentLevel - 1;
        next.exp = 0;
        next.attributes = nextAttributes;
        const droppedText = dropped.length
          ? dropped.map(({ key, amount }) => `${key.toUpperCase()}-${amount}`).join("、")
          : "沒有可再下降的屬性";
        effectDesc = `☯️ 等級下降至 Lv.${next.level}，並隨機失去 ${droppedText}。`;
      }

      // useEffects 同個 CAS 一起寫入，避免分兩次寫入造成另一輪競態
      if (useEffects.length > 0) {
        next.activeEffects = applyEffectInstances(next.activeEffects, useEffects, {
          sourceType: "item",
          sourceId: entry.itemId || entry.uuid
        });
      }

      next.updatedAt = new Date().toISOString();

      const saved = await this.progressRepository.saveIfUnchanged(next, progress.updatedAt);
      if (saved) {
        savedEntry = entry;
        savedEffect = effect;
        savedUseEffects = useEffects;
        savedEffectDesc = effectDesc;
        casSuccess = true;
        break;
      }

      if (attempt < CAS_MAX_RETRIES - 1) {
        await new Promise(r => setTimeout(r, 10 * (attempt + 1)));
        console.warn(`[useItem] CAS retry ${attempt + 1} for ${discordId}`);
      }
    }

    if (!casSuccess) {
      throw new AppError(ERROR_CODES.INTERNAL_ERROR, `useItem CAS failed after ${CAS_MAX_RETRIES} retries for ${discordId}`, 500);
    }

    // 獨立的 side-effects（wallet / 另一支 progress CAS 自己處理併發）
    const dn = displayName || "";
    if (savedEffect.type === "grant_gold") {
      await this.rewardService.grantCurrency({ discordId, displayName: dn, currencyType: "gold", amount: savedEffect.value, source: CURRENCY_SOURCES.ITEM_USE, operator: "shop:use-item" });
      savedEffectDesc = `💰 +${savedEffect.value} 金幣`;
    } else if (savedEffect.type === "grant_diamond") {
      await this.rewardService.grantCurrency({ discordId, displayName: dn, currencyType: "diamond", amount: savedEffect.value, source: CURRENCY_SOURCES.ITEM_USE, operator: "shop:use-item" });
      savedEffectDesc = `💎 +${savedEffect.value} 鑽石`;
    } else if (savedEffect.type === "grant_exp" && this.progressService) {
      await this.progressService.grantExp({ discordId, displayName: dn, amount: savedEffect.value, source: EXP_SOURCES.ITEM_USE_EXP });
      savedEffectDesc = `✨ +${savedEffect.value} 經驗值`;
    }

    if (savedUseEffects.length > 0) {
      const statusLine = `附加狀態 ${savedUseEffects.map((u) => u.definitionName || u.key).join("、")}`;
      savedEffectDesc = savedEffectDesc ? `${savedEffectDesc} / ${statusLine}` : statusLine;
    }

    return { itemName: savedEntry.itemName, effectDesc: savedEffectDesc };
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
    let entry = progress.inventory[idx];
    if (entry.itemType !== "equipment" && entry.itemType !== "job_badge" && entry.itemType !== "monster_card") {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "此物品不是裝備", 400);
    }

    let slot = entry.equipSlot;
    if (entry.itemType === "monster_card" && !slot) {
      slot = "special";
      entry = {
        ...entry,
        itemType: "equipment",
        equipSlot: "special"
      };
      progress.inventory[idx] = entry;
    }
    if (!slot) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "此裝備未指定槽位", 400);

    // 職業徽章等級限制：10 等以下禁止穿戴
    if (slot === "job_eq") {
      const playerLevel = progress.level || 1;
      if (playerLevel < 10) {
        throw new AppError(ERROR_CODES.INVALID_ARGUMENT, `職業徽章需要 Lv.10 以上才能穿戴（目前 Lv.${playerLevel}）`, 400);
      }
    }

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

    // 同張卡片不能同時裝備在多個 special 槽
    if (slot.startsWith("special_")) {
      const SPECIAL_SLOTS = ["special_1", "special_2", "special_3"];
      const cardItemId = entry.itemId;
      for (const s of SPECIAL_SLOTS) {
        if (s === slot) continue;
        const equipped = progress.equipment[s];
        if (equipped && equipped.itemId === cardItemId) {
          throw new AppError(ERROR_CODES.INVALID_ARGUMENT, `同一張卡片（${entry.itemName}）不能同時裝備在多個槽位`, 400);
        }
      }
    }

    const entryIsTwoHanded = this._resolveIsTwoHanded({ weaponType: entry.weaponType, isTwoHanded: entry.isTwoHanded });

    if (slot === "weapon" && entryIsTwoHanded) {
      const shieldItem = progress.equipment["shield"] || null;
      if (shieldItem) {
        if (!Array.isArray(progress.inventory)) progress.inventory = [];
        progress.inventory.push(shieldItem);
        progress.equipment["shield"] = null;
      }
    }
    if (slot === "shield") {
      const mainWeapon = progress.equipment["weapon"] || null;
      const mainWeaponIsTwoHanded = this._resolveIsTwoHanded({
        weaponType: mainWeapon?.weaponType,
        isTwoHanded: mainWeapon?.isTwoHanded
      });
      if (mainWeaponIsTwoHanded) {
        throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "主手裝備了雙手武器，無法使用副手槽！", 400);
      }
    }

    // 裝備時從道具庫同步最新 effects（確保修正後的 effects 立即生效）
    let freshEntry = entry;
    if (entry.itemId && this.itemRepository) {
      const libItem = await this.itemRepository.findById(entry.itemId).catch(() => null);
      if (libItem) {
        freshEntry = {
          ...entry,
          itemType: (libItem.itemType === "monster_card" ? "equipment" : (libItem.itemType || entry.itemType || "equipment")),
          equipSlot: libItem.equipSlot || slot || entry.equipSlot || "special",
          weaponType: libItem.weaponType || entry.weaponType || null,
          isTwoHanded: this._resolveIsTwoHanded({
            weaponType: libItem.weaponType || entry.weaponType || null,
            isTwoHanded: libItem.isTwoHanded ?? entry.isTwoHanded
          }),
          passiveEffects: libItem.passiveEffects || entry.passiveEffects || [],
          combatEffects: libItem.combatEffects || entry.combatEffects || [],
          procEffects: libItem.procEffects || entry.procEffects || [],
          useEffects: libItem.useEffects || entry.useEffects || [],
          // 不覆蓋 equipStats，保留強化後的數值
        };
        // 背包裡的 snapshot 也同步更新
        progress.inventory[idx] = freshEntry;
      }
    }

    const current = progress.equipment[slot] || null;
    progress.inventory.splice(idx, 1);
    if (current) progress.inventory.push(current);
    progress.equipment[slot] = freshEntry;
    progress.updatedAt = new Date().toISOString();
    await this.progressRepository.save(progress);
    if (this.questService) {
      this.questService.recordProgress(discordId, "equip_count", 1).catch(() => {});
    }
    return {
      itemName: entry.itemName,
      slot,
      equipment: progress.equipment,
      inventory: progress.inventory
    };
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
    return {
      itemName: equipped.itemName,
      slot,
      equipment: progress.equipment,
      inventory: progress.inventory
    };
  }

  async enhanceItem(discordId, targetUuid, materialUuid) {
    const ENHANCE_MAX = MAX_ENHANCE_LEVEL;
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
      if (level >= ENHANCE_MAX) return 0;
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
    const maxMaterialLevel = Math.min(ENHANCE_MAX - 1, Math.max(0, Number(currentLevel || 0)));
    const candidates = inv
      .filter(isSameBase)
      .filter((entry) => Number(entry?.enhanceLevel || 0) <= maxMaterialLevel);
    const availableUnits = candidates.reduce((sum, entry) => sum + unitValue(entry), 0);
    if (availableUnits < requiredUnits) {
      throw new AppError(
        ERROR_CODES.INVALID_ARGUMENT,
        `材料不足：強化 ${baseName} +${currentLevel} → +${currentLevel + 1} 需要等價 ${requiredUnits} 把同裝備（+1=2、+2=4、+3=8、+4=16；+${ENHANCE_MAX} 不可當材料），背包目前只有等價 ${availableUnits} 把。`,
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

    // 根据品阶計算正确的強化增值（與 enhanceService.enhanceEquipment() 一致）
    const WEAPON_ENHANCE_BONUS = { D: 1, C: 1.5, B: 2, A: 2 };
    const ARMOR_ENHANCE_VIT = { D: 1, C: 2, B: 3, A: 3 };
    const tier = String(target.tier || "").toUpperCase();
    const isWeapon = target.equipSlot === "weapon" || target.equipSlot === "shield";
    let delta = 1; // 預設值
    if (isWeapon) {
      delta = WEAPON_ENHANCE_BONUS[tier] ?? 1;
    } else {
      delta = ARMOR_ENHANCE_VIT[tier] ?? 1;
    }

    const oldStatValue = Number(stats[mainStat] || 0);
    const newStats = { ...stats, [mainStat]: Number(((stats[mainStat] || 0) + delta).toFixed(2)) };
    const newLevel = currentLevel + 1;
    const newName = `${baseName} +${newLevel}`;
    const updatedTarget = {
      ...target,
      equipStats: newStats,
      enhanceLevel: newLevel,
      itemName: newName,
      // 確保強化後保留原始道具的所有 effects
      procEffects: target.procEffects || [],
      passiveEffects: target.passiveEffects || [],
      useEffects: target.useEffects || [],
      combatEffects: target.combatEffects || []
    };

    const idxs = [];
    for (let i = 0; i < progress.inventory.length; i += 1) {
      const entry = progress.inventory[i];
      if (entry && chosen.includes(entry.uuid)) idxs.push(i);
    }
    idxs.sort((a, b) => b - a);
    for (const i of idxs) progress.inventory.splice(i, 1);

    let savedTargetIndex = -1;
    if (targetSlotKey) {
      progress.equipment[targetSlotKey] = updatedTarget;
    } else {
      savedTargetIndex = progress.inventory.findIndex(e => e.uuid === target.uuid);
      if (savedTargetIndex !== -1) progress.inventory[savedTargetIndex] = updatedTarget;
    }
    progress.updatedAt = new Date().toISOString();
    await this.progressRepository.save(progress);

    if (this.questService) {
      this.questService.recordProgress(discordId, "enhance_count", 1).catch(() => {});
    }

    // 強化完成後，同步該道具的最新 effects（如果有 itemId）
    if (updatedTarget.itemId && this.itemRepository) {
      const libItem = await this.itemRepository.findById(updatedTarget.itemId).catch(() => null);
      if (libItem) {
        let updated = false;
        // 同步 procEffects、passiveEffects 等從 DB
        const slot = targetSlotKey;
        if (slot && progress.equipment[slot]) {
          progress.equipment[slot].procEffects = libItem.procEffects || [];
          progress.equipment[slot].passiveEffects = libItem.passiveEffects || [];
          progress.equipment[slot].useEffects = libItem.useEffects || [];
          progress.equipment[slot].combatEffects = libItem.combatEffects || [];
          updated = true;
        } else {
          const refreshedIndex = savedTargetIndex !== -1
            ? savedTargetIndex
            : progress.inventory.findIndex((entry) => entry?.uuid === updatedTarget.uuid);
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
