const { AppError, ERROR_CODES } = require("../../shared/errors");
const { CURRENCY_SOURCES, EXP_SOURCES } = require("../../shared/sources");
const { applyEffectInstances } = require("../../shared/effectEngine");
const { MAX_ENHANCE_LEVEL } = require("../../shared/enhanceConfig");
const { withPlayerProgressLock } = require("../progress/progressLocks");
const crypto = require("crypto");

// 各 tier 裝備販售價格
const TIER_SELL_PRICE = { D: 200, C: 500, B: 1000, A: 10000 };

// 分解：強化寶石 itemId（依階級）
const GEM_ID_BY_TIER = {
  D: "72fde92d-e33f-42fb-8d86-2e811d03f84d",
  C: "556db9e1-b084-4b22-bab5-a66c2b586184",
  B: "8fdfa7d9-f0fa-4e6a-a291-703b1e354072",
  A: "a6ae293d-52fc-4af5-8770-891ddf842e35",
};
// 分解產物：裝備階級 → 降一階寶石 × 數量（D 為最低，給 1 顆 D 寶石保底）
const DISMANTLE_YIELD = {
  A: { tier: "B", count: 2 },
  B: { tier: "C", count: 2 },
  C: { tier: "D", count: 2 },
  D: { tier: "D", count: 1 },
};
const TAIPEI_TIME_ZONE = "Asia/Taipei";
const ARMOR_RANDOM_ENHANCE_BONUS = { D: 1, C: 1, B: 2, A: 3 };
const STAT_LABEL_ZH = {
  str: "力量 STR",
  agi: "敏捷 AGI",
  vit: "體質 VIT",
  int: "智力 INT",
  dex: "靈巧 DEX",
  luk: "幸運 LUK"
};

const VALID_EFFECT_TYPES = ["none", "grant_gold", "grant_diamond", "grant_exp", "grant_status_points", "checkin_multiplier", "reroll_attributes", "level_down_random_attributes"];
const TWO_HANDED_WEAPON_TYPES = new Set(["sword_2h", "axe_2h", "mace_2h", "staff_2h", "bow"]);
const VALID_CLAIM_LIMITS = new Set(["none", "once_per_player"]);

class ShopService {
  constructor(shopRepository, playerService, rewardService, progressRepository, progressService, itemRepository, playerTierService, questService = null, shopClaimRepository = null, streamAccountBindingRepository = null) {
    this.shopRepository = shopRepository;
    this.playerService = playerService;
    this.rewardService = rewardService;
    this.progressRepository = progressRepository;
    this.progressService = progressService;
    this.itemRepository = itemRepository;
    this.playerTierService = playerTierService;
    this.questService = questService;
    this.shopClaimRepository = shopClaimRepository;
    this.streamAccountBindingRepository = streamAccountBindingRepository;
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

  _autoUnequipJobBadgeIfNeeded(progress) {
    if (!progress || typeof progress !== "object") return null;
    const playerLevel = Math.max(1, Number(progress.level) || 1);
    if (playerLevel >= 10) return null;
    if (!progress.equipment || typeof progress.equipment !== "object") return null;

    const jobEq = progress.equipment.job_eq;
    if (!jobEq) return null;

    if (!Array.isArray(progress.inventory)) progress.inventory = [];
    progress.inventory.push(jobEq);
    progress.equipment.job_eq = null;
    return jobEq;
  }

  async _saveProgressWithFallback(progress, prevUpdatedAt) {
    if (typeof this.progressRepository?.saveIfUnchanged === "function") {
      return this.progressRepository.saveIfUnchanged(progress, prevUpdatedAt);
    }

    if (typeof this.progressRepository?.save === "function") {
      console.warn("[ShopService] progressRepository.saveIfUnchanged missing, falling back to save()");
      await this.progressRepository.save(progress);
      return true;
    }

    throw new AppError(ERROR_CODES.INTERNAL_ERROR, "progressRepository does not support save/saveIfUnchanged", 500);
  }

  _resolveIsTwoHanded({ weaponType = null, isTwoHanded = false } = {}) {
    if (weaponType && TWO_HANDED_WEAPON_TYPES.has(String(weaponType))) return true;
    return Boolean(isTwoHanded);
  }

  _normalizeClaimLimit(value) {
    if (!value) return "none";
    const normalized = String(value).trim();
    return VALID_CLAIM_LIMITS.has(normalized) ? normalized : "none";
  }

  _normalizeItemRefText(value) {
    return String(value || "").replace(/\s*\+\d+$/, "").trim();
  }

  _buildInventoryEntryRef(entry) {
    if (!entry || typeof entry !== "object") return "";
    if (entry.uuid) return `uuid:${entry.uuid}`;
    const base = this._normalizeItemRefText(entry.itemName || entry.name || entry.itemId || "");
    const slot = String(entry.equipSlot || "").trim();
    const tier = String(entry.tier || "").trim();
    const enh = String(Number(entry.enhanceLevel || 0));
    return `key:${[base, slot, tier, enh].join("|")}`;
  }

  _stableObjectSignature(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return "";
    const keys = Object.keys(value).sort();
    return keys
      .map((key) => `${key}:${Number.isFinite(Number(value[key])) ? Number(value[key]) : String(value[key] ?? "")}`)
      .join(",");
  }

  _getBulkSellSignature(entry) {
    if (!entry || typeof entry !== "object") return "";
    return [
      String(entry.itemId || this._normalizeItemRefText(entry.itemName || entry.name || "")),
      String(entry.itemType || ""),
      String(entry.equipSlot || ""),
      String(entry.tier || ""),
      String(entry.weaponType || ""),
      entry.isTwoHanded ? "2h" : "1h",
      String(Number(entry.enhanceLevel || 0)),
      this._stableObjectSignature(entry.equipStats || {})
    ].join("|");
  }

  _findBulkSellMatches(inventory, refEntry, entryUuid) {
    const refSignature = this._getBulkSellSignature(refEntry);
    const matches = (Array.isArray(inventory) ? inventory : [])
      .filter((entry) => this._getBulkSellSignature(entry) === refSignature);
    return matches.sort((a, b) => {
      const aIsRef = this._matchesInventoryEntryRef(a, entryUuid) ? 0 : 1;
      const bIsRef = this._matchesInventoryEntryRef(b, entryUuid) ? 0 : 1;
      return aIsRef - bIsRef;
    });
  }

  _matchesInventoryEntryRef(entry, ref) {
    if (!entry || !ref) return false;
    const raw = String(ref || "");
    if (String(entry.uuid || "") === raw) return true;
    const normalizedRaw = raw.startsWith("uuid:") ? raw.slice(5) : raw.startsWith("key:") ? raw.slice(4) : raw;
    if (!normalizedRaw) return false;
    if (String(entry.uuid || "") === normalizedRaw) return true;
    const [keyBase = "", keySlot = "", keyTier = "", keyEnh = ""] = normalizedRaw.split("|");
    const entryBase = this._normalizeItemRefText(entry.itemName || entry.name || entry.itemId || "");
    const entrySlot = String(entry.equipSlot || "").trim();
    const entryTier = String(entry.tier || "").trim();
    const entryEnh = String(Number(entry.enhanceLevel || 0));
    if (entry.itemId && String(entry.itemId) === keyBase) {
      if (keySlot && entrySlot !== keySlot) return false;
      if (keyTier && entryTier !== keyTier) return false;
      if (keyEnh && entryEnh !== keyEnh) return false;
      return true;
    }
    return entryBase === this._normalizeItemRefText(keyBase)
      && (!keySlot || entrySlot === keySlot)
      && (!keyTier || entryTier === keyTier)
      && (!keyEnh || entryEnh === keyEnh);
  }

  _findInventoryEntryByRef(progress, ref, { includeEquipment = false } = {}) {
    const inventory = Array.isArray(progress?.inventory) ? progress.inventory : [];
    const inventoryHit = inventory.find((entry) => this._matchesInventoryEntryRef(entry, ref));
    if (inventoryHit || !includeEquipment) return inventoryHit || null;
    const equipment = progress?.equipment && typeof progress.equipment === "object" ? Object.values(progress.equipment) : [];
    return equipment.find((entry) => this._matchesInventoryEntryRef(entry, ref)) || null;
  }

  _normalizeUuidRef(ref) {
    const raw = String(ref || "").trim();
    const normalized = raw.startsWith("uuid:") ? raw.slice(5) : raw;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(normalized)
      ? normalized
      : null;
  }

  _findInventoryIndexForAction(progress, ref) {
    const inventory = Array.isArray(progress?.inventory) ? progress.inventory : [];
    const uuid = this._normalizeUuidRef(ref);
    if (uuid) return inventory.findIndex((entry) => String(entry?.uuid || "") === uuid);
    return inventory.findIndex((entry) => this._matchesInventoryEntryRef(entry, ref));
  }

  _findInventoryEntryForAction(progress, ref) {
    const idx = this._findInventoryIndexForAction(progress, ref);
    return idx >= 0 ? progress.inventory[idx] : null;
  }

  async _getStreamBindings(player, discordId) {
    const bindings = [];
    if (this.streamAccountBindingRepository?.listByDiscordId && discordId) {
      const rows = await this.streamAccountBindingRepository.listByDiscordId(discordId).catch(() => []);
      for (const row of Array.isArray(rows) ? rows : []) {
        if (row?.platform && row?.platformUserId) bindings.push(row);
      }
    }
    if (bindings.length > 0) return bindings;

    const externalIds = player?.externalIds || {};
    for (const [platform, platformUserId] of Object.entries(externalIds)) {
      if (platform && platformUserId) {
        bindings.push({
          platform,
          platformUserId,
          discordId: discordId || player?.discordId || "",
          displayName: player?.displayName || "",
          linkedAt: player?.externalIdLinkedAt || null
        });
      }
    }
    return bindings;
  }

  async _hasLinkedStreamAccount(player, discordId) {
    const bindings = await this._getStreamBindings(player, discordId);
    return bindings.some((binding) => {
      const platform = String(binding?.platform || "").trim().toLowerCase();
      const platformUserId = String(binding?.platformUserId || "").trim();
      return (platform === "youtube" || platform === "twitch") && Boolean(platformUserId);
    });
  }

  _normalizeBadgeLabels(binding) {
    if (!binding) return [];
    const labels = binding.linkedSupportBadgeLabelsAtLink;
    if (Array.isArray(labels)) return labels.map((label) => String(label).trim()).filter(Boolean);
    if (typeof labels === "string" && labels.trim()) {
      return labels.split("|").map((label) => String(label).trim()).filter(Boolean);
    }
    return [];
  }

  _hasVerifiedSupportSnapshot(binding) {
    if (!binding) return false;
    const platform = String(binding.platform || "").trim().toLowerCase();
    const supportKind = String(binding.linkedSupportKindAtLink || binding.supportKindAtLink || "").trim().toLowerCase();
    const linkedSupportAtLink = binding.linkedSupportAtLink;
    const badgeText = this._normalizeBadgeLabels(binding).join("|");

    if (platform === "youtube") {
      return linkedSupportAtLink === true || supportKind === "member" || /會員/.test(badgeText);
    }

    if (platform === "twitch") {
      return linkedSupportAtLink === true || supportKind === "subscriber" || /訂閱者|subscriber/i.test(badgeText);
    }

    return false;
  }

  async _hasVerifiedSupportForPlayer(player, discordId) {
    const bindings = await this._getStreamBindings(player, discordId);
    return bindings.some((binding) => this._hasVerifiedSupportSnapshot(binding));
  }

  async assertLinkedStreamAccount(player, discordId) {
    const hasLinked = await this._hasLinkedStreamAccount(player, discordId);
    if (!hasLinked) {
      throw new AppError(ERROR_CODES.FORBIDDEN, "使用音無樂園商店前，請先綁定 YouTube 或 Twitch 帳號", 403);
    }
    return true;
  }

  async _buildClaimIdentityKeys(player, discordId) {
    const keys = new Set();
    if (discordId) keys.add(`discord:${discordId}`);
    const bindings = await this._getStreamBindings(player, discordId);
    for (const binding of bindings) {
      if (binding?.platform && binding?.platformUserId) {
        keys.add(`${binding.platform}:${binding.platformUserId}`);
      }
    }
    return [...keys];
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

  async createItem({ itemLibraryId, price, currency, stock, enabled, isSale, allowedTiers, maxPerMonth, claimLimit }) {
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
      claimLimit: this._normalizeClaimLimit(claimLimit),
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
    if (fields.claimLimit !== undefined) updated.claimLimit = this._normalizeClaimLimit(fields.claimLimit);
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
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: TAIPEI_TIME_ZONE,
      year: "numeric",
      month: "2-digit"
    }).formatToParts(new Date());
    const year = parts.find((part) => part.type === "year")?.value || "0000";
    const month = parts.find((part) => part.type === "month")?.value || "00";
    return `${year}-${month}`;
  }

  async purchase(discordId, displayName, itemId, memberRoleIds = [], quantity = 1) {
    // 驗證數量
    quantity = Math.max(1, Math.min(999, parseInt(quantity) || 1));

    const item = await this.getItemById(itemId);
    const { player } = await this.playerService.ensurePlayer(discordId, displayName);
    await this.assertLinkedStreamAccount(player, discordId);
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

    const allowedTiers = item.allowedTiers || [];
    if (allowedTiers.length > 0 && this.playerTierService) {
      const playerHighestTier = await this.playerTierService.resolveHighestTier(memberRoleIds);
      const canBuy = allowedTiers.includes(playerHighestTier ?? "");
      if (!canBuy) throw new AppError(ERROR_CODES.FORBIDDEN, "你目前的等級無法購買此商品", 403);

      const hasVerifiedSupport = await this._hasVerifiedSupportForPlayer(player, discordId);
      if (playerHighestTier && !hasVerifiedSupport) {
        throw new AppError(
          ERROR_CODES.FORBIDDEN,
          "你的綁定來源目前未偵測到會員 / 訂閱者身分，無法購買此位階限定商品",
          403
        );
      }
    }

    const claimLimit = this._normalizeClaimLimit(item.claimLimit);
    if (claimLimit === "once_per_player") {
      if (quantity !== 1) {
        throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "此會員獎勵每位玩家只能領取 1 次", 400);
      }
      const identityKeys = await this._buildClaimIdentityKeys(player, discordId);
      if (this.shopClaimRepository?.findByDiscordOrIdentityAndItem) {
        const existingClaim = await this.shopClaimRepository.findByDiscordOrIdentityAndItem({ discordId, identityKeys, itemId: item.id });
        if (existingClaim) {
          throw new AppError(ERROR_CODES.FORBIDDEN, "這個會員獎勵你已經領取過了", 403);
        }
      }
    }

    if (item.stock === 0) throw new AppError(ERROR_CODES.ITEM_OUT_OF_STOCK, "此商品已售完", 400);

    // 檢查庫存是否足夠
    if (item.stock > 0 && quantity > item.stock) {
      throw new AppError(ERROR_CODES.ITEM_OUT_OF_STOCK, `庫存不足，目前僅剩 ${item.stock} 個`, 400);
    }

    const maxPerMonth = item.maxPerMonth || 0;
    const progress = await this.progressRepository.findByPlayerId(discordId);
    if (maxPerMonth > 0) {
      const ym = this._currentYearMonth();
      const counts = (progress?.shopMonthlyCount || {});
      const used = (counts[itemId] || {})[ym] || 0;
      if (used + quantity > maxPerMonth) {
        throw new AppError(ERROR_CODES.FORBIDDEN, `此商品本月購買已達上限（已購 ${used}/${maxPerMonth}，無法再購 ${quantity} 個）`, 403);
      }
    }

    // 背包持有上限（maxOwn）：限定類消耗品（如爬塔藥水）每種最多持有 N 罐
    const maxOwn = item.maxOwn || 0;
    if (maxOwn > 0 && progress) {
      const libId = item.itemLibraryId || item.id;
      const owned = (progress.inventory || []).filter((e) => e.itemId === libId).length;
      if (owned + quantity > maxOwn) {
        throw new AppError(ERROR_CODES.FORBIDDEN, `此商品最多持有 ${maxOwn} 個（目前背包已有 ${owned} 個）`, 403);
      }
    }

    // 扣除金幣（總額）
    if (item.price > 0) {
        await this.rewardService.grantCurrency({
        discordId,
        displayName,
        currencyType: item.currency,
        amount: -(item.price * quantity),
        source: CURRENCY_SOURCES.SHOP_PURCHASE,
        operator: "shop"
      });
    }

    // 扣除庫存
    if (item.stock > 0) {
      await this.shopRepository.save({ ...item, stock: Math.max(0, item.stock - quantity) });
    }

    if (progress) {
      if (!Array.isArray(progress.inventory)) progress.inventory = [];
      if ((item.maxPerMonth || 0) > 0) {
        if (!progress.shopMonthlyCount) progress.shopMonthlyCount = {};
        const ym = this._currentYearMonth();
        if (!progress.shopMonthlyCount[itemId]) progress.shopMonthlyCount[itemId] = {};
        progress.shopMonthlyCount[itemId][ym] = ((progress.shopMonthlyCount[itemId][ym] || 0) + quantity);
      }
      // 添加 quantity 個物品到背包
      for (let i = 0; i < quantity; i++) {
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
      }

      if (claimLimit === "once_per_player" && this.shopClaimRepository?.saveClaim) {
        const identityKeys = await this._buildClaimIdentityKeys(player, discordId);
        const claimedAt = new Date().toISOString();
        await this.shopClaimRepository.saveClaim({
          id: crypto.randomUUID(),
          playerId: discordId,
          discordId,
          identityKeys,
          itemId: item.id,
          itemLibraryId: item.itemLibraryId || null,
          itemName: item.name,
          itemTier: effectiveTier,
          claimLimit,
          quantity,
          source: "official_shop",
          claimedAt
        });
      }
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
    await withPlayerProgressLock(discordId, async () => {
      for (let attempt = 0; attempt < CAS_MAX_RETRIES; attempt++) {
      const progress = await this.progressRepository.findByPlayerId(discordId);
      if (!progress) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到背包資料", 404);

      const idx = (progress.inventory || []).findIndex((e) => this._matchesInventoryEntryRef(e, entryUuid));
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

      const autoRemovedJobBadge = this._autoUnequipJobBadgeIfNeeded(next);
      if (autoRemovedJobBadge) {
        const badgeName = autoRemovedJobBadge.itemName || autoRemovedJobBadge.name || "職業徽章";
        effectDesc = effectDesc
          ? `${effectDesc} / 因等級低於 Lv.10，自動卸下 **${badgeName}**`
          : `因等級低於 Lv.10，自動卸下 **${badgeName}**`;
      }

      // useEffects 同個 CAS 一起寫入，避免分兩次寫入造成另一輪競態
      if (useEffects.length > 0) {
        next.activeEffects = applyEffectInstances(next.activeEffects, useEffects, {
          sourceType: "item",
          sourceId: entry.itemId || entry.uuid
        });
      }

      next.updatedAt = new Date().toISOString();

      const saved = await this._saveProgressWithFallback(next, progress.updatedAt);
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
    });

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
    const quote = await this.getSellQuote(discordId, entryUuid, 1);
    const progress = await this.progressRepository.findByPlayerId(discordId);
    if (!progress) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到背包資料", 404);
    const idx = this._findInventoryIndexForAction(progress, entryUuid);
    if (idx === -1) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "背包中找不到此物品", 404);
    const entry = progress.inventory[idx];
    progress.inventory.splice(idx, 1);
    progress.updatedAt = new Date().toISOString();
    const savedProgress = await this.progressRepository.save(progress);
    await this.rewardService.grantCurrency({
      discordId,
      displayName: discordId,
      currencyType: "gold",
      amount: quote.totalGold,
      source: CURRENCY_SOURCES.ITEM_SELL,
      operator: "shop:sell-item"
    });
    return {
      itemName: entry.itemName,
      tier: quote.tier,
      price: quote.priceEach,
      inventory: Array.isArray(savedProgress?.inventory) ? savedProgress.inventory : progress.inventory
    };
  }

  async getSellQuote(discordId, entryUuid, qty = 1) {
    qty = Math.max(1, Math.floor(Number(qty) || 1));
    const progress = await this.progressRepository.findByPlayerId(discordId);
    if (!progress) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到背包資料", 404);

    const refEntry = this._findInventoryEntryForAction(progress, entryUuid);
    if (!refEntry) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "背包中找不到此物品", 404);
    if (refEntry.itemType === "job_badge" || refEntry.equipSlot === "job_eq") {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "職業徽章不可販售", 400);
    }

    // tier 查詢：同 sellItem，entry 沒有就查 library
    let tier = refEntry.tier ? String(refEntry.tier).toUpperCase() : null;
    if (!tier && this.itemRepository && refEntry.itemId) {
      const libItem = await this.itemRepository.findById(refEntry.itemId).catch(() => null);
      tier = libItem?.tier ? String(libItem.tier).toUpperCase() : null;
    }
    const price = TIER_SELL_PRICE[tier] ?? null;
    if (price === null) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "此物品沒有設定階級，無法販售", 400);

    const stackCount = refEntry.stackCount || 1;
    let sellCount = 0;

    if (stackCount > 1) {
      sellCount = Math.min(qty, stackCount);
    } else {
      const matchingCount = this._findBulkSellMatches(progress.inventory || [], refEntry, entryUuid).length;
      sellCount = Math.min(qty, matchingCount);
    }

    if (sellCount === 0) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "背包中沒有可販售的此物品", 404);
    return {
      itemName: refEntry.itemName,
      tier,
      priceEach: price,
      sellCount,
      totalGold: price * sellCount
    };
  }

  async sellItemBulk(discordId, entryUuid, qty) {
    qty = Math.max(1, Math.floor(Number(qty) || 1));
    const quote = await this.getSellQuote(discordId, entryUuid, qty);
    const progress = await this.progressRepository.findByPlayerId(discordId);
    if (!progress) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到背包資料", 404);

    const refEntry = this._findInventoryEntryForAction(progress, entryUuid);
    if (!refEntry) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "背包中找不到此物品", 404);

    const stackCount = refEntry.stackCount || 1;
    const sellCount = quote.sellCount;

    if (stackCount > 1) {
      // ── 堆疊型（消耗品）：從 stackCount 扣除 ──
      const idx = this._findInventoryIndexForAction(progress, entryUuid);
      if (sellCount >= stackCount) {
        progress.inventory.splice(idx, 1);          // 全部賣完，移除紀錄
      } else {
        progress.inventory[idx].stackCount = stackCount - sellCount;  // 部分賣，扣數量
      }
    } else {
      // ── 非堆疊型（裝備/寶石）：只賣同模板、同強化、同素質簽名的項目 ──
      const matchingUuids = this._findBulkSellMatches(progress.inventory || [], refEntry, entryUuid)
        .map(e => this._buildInventoryEntryRef(e));

      const toRemove = new Set(matchingUuids.slice(0, sellCount));
      progress.inventory = progress.inventory.filter(e => !toRemove.has(this._buildInventoryEntryRef(e)));
    }

    progress.updatedAt = new Date().toISOString();
    const savedProgress = await this.progressRepository.save(progress);

    await this.rewardService.grantCurrency({
      discordId,
      displayName: discordId,
      currencyType: "gold",
      amount: quote.totalGold,
      source: CURRENCY_SOURCES.ITEM_SELL,
      operator: "shop:sell-item-bulk"
    });

    return {
      ...quote,
      inventory: Array.isArray(savedProgress?.inventory) ? savedProgress.inventory : progress.inventory
    };
  }

  // 分解裝備：移除該裝備，產出降階強化寶石（取代舊「丟棄」）
  async discardItem(discordId, entryUuid) {
    const progress = await this.progressRepository.findByPlayerId(discordId);
    if (!progress) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到背包資料", 404);
    const idx = (progress.inventory || []).findIndex((e) => this._matchesInventoryEntryRef(e, entryUuid));
    if (idx === -1) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "背包中找不到此物品", 404);
    const entry = progress.inventory[idx];

    // 只有「裝備」可分解（含怪物卡/徽章嗎？→ 僅純裝備與卡片可分解，徽章/稱號不分解）
    let gemsGranted = null;
    const tier = String(entry.tier || "").toUpperCase();
    const isEquipmentLike = entry.itemType === "equipment";
    if (isEquipmentLike && DISMANTLE_YIELD[tier]) {
      const y = DISMANTLE_YIELD[tier];
      gemsGranted = { tier: y.tier, count: y.count };
    }

    // 先移除被分解的裝備
    progress.inventory.splice(idx, 1);

    // 產出寶石（堆疊進背包）
    if (gemsGranted) {
      await this._grantGems(progress, gemsGranted.tier, gemsGranted.count);
    }

    progress.updatedAt = new Date().toISOString();
    await this.progressRepository.save(progress);
    return { itemName: entry.itemName, gems: gemsGranted };
  }

  // 把強化寶石加進背包（同 itemId 堆疊）
  async _grantGems(progress, tier, count) {
    if (!count || count <= 0) return;
    const gemId = GEM_ID_BY_TIER[tier];
    if (!gemId) return;
    if (!Array.isArray(progress.inventory)) progress.inventory = [];
    const existing = progress.inventory.find((e) => e && e.itemId === gemId);
    if (existing) {
      existing.stackCount = (existing.stackCount || 1) + count;
      return;
    }
    // 從道具庫撈寶石原型建立背包項
    let gemItem = null;
    try { gemItem = await this.itemRepository.findById(gemId); } catch (_) {}
    progress.inventory.push({
      uuid: crypto.randomUUID(),
      itemId: gemId,
      itemName: gemItem?.name || `${tier}階寶石`,
      itemEffect: gemItem?.effect || { type: "none", value: 0 },
      useEffects: [], passiveEffects: [], procEffects: [], combatEffects: [],
      itemType: "consumable",
      imageUrl: gemItem?.imageUrl || null,
      imageThumbnailUrl: gemItem?.imageThumbnailUrl || null,
      equipSlot: null, equipStats: null, weaponType: null, isTwoHanded: false, atkStat: null,
      tier, enhanceLevel: 0, stackCount: count,
      source: "dismantle", grantedAt: new Date().toISOString(),
      name: gemItem?.name || `${tier}階寶石`,
    });
  }

  async equipItem(discordId, entryUuid, targetSlot = null) {
    const progress = await this.progressRepository.findByPlayerId(discordId);
    if (!progress) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到資料", 404);
    const idx = (progress.inventory || []).findIndex((e) => this._matchesInventoryEntryRef(e, entryUuid));
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

  async switchEquipPreset(discordId, targetPreset) {
    const VALID_PRESETS = ["A", "B", "C"];
    if (!VALID_PRESETS.includes(targetPreset)) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "無效分頁，請選擇 A / B / C", 400);
    }
    const progress = await this.progressRepository.findByPlayerId(discordId);
    if (!progress) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到資料", 404);

    if (!progress.equipPresets) progress.equipPresets = {};
    const currentPreset = progress.activePreset || "A";
    if (currentPreset === targetPreset) return { activePreset: targetPreset, equipment: progress.equipment };

    // 把目前裝備存入離開的分頁（快照，不含 inventory 引用）
    progress.equipPresets[currentPreset] = this._snapshotEquipment(progress.equipment);

    // 套用目標分頁的裝備
    const inventory = progress.inventory || [];
    const savedPreset = progress.equipPresets[targetPreset] || {};
    const ALL_SLOTS = ["head_top","head_mid","head_low","armor","weapon","shield","garment","shoes","accessory_l","accessory_r","title_eq","job_eq","special_1","special_2","special_3"];

    // 先把目前全部裝備卸回背包
    for (const slot of ALL_SLOTS) {
      const cur = progress.equipment?.[slot];
      if (cur) {
        inventory.push(cur);
        progress.equipment[slot] = null;
      }
    }

    // 套上目標分頁中仍在背包的裝備
    for (const slot of ALL_SLOTS) {
      const saved = savedPreset[slot];
      if (!saved) continue;
      // 以 uuid 或 itemId 找背包
      const invIdx = inventory.findIndex(e =>
        (saved.uuid && e.uuid === saved.uuid) ||
        (!saved.uuid && e.itemId === saved.itemId && e.equipSlot === slot)
      );
      if (invIdx === -1) continue; // 背包中已不存在，跳過
      progress.equipment[slot] = inventory.splice(invIdx, 1)[0];
    }

    // 雙手武器帶了盾牌時清掉盾牌（一致性保護）
    const weaponIsTwoHanded = this._resolveIsTwoHanded({
      weaponType: progress.equipment?.weapon?.weaponType,
      isTwoHanded: progress.equipment?.weapon?.isTwoHanded
    });
    if (weaponIsTwoHanded && progress.equipment?.shield) {
      inventory.push(progress.equipment.shield);
      progress.equipment.shield = null;
    }

    progress.inventory = inventory;
    progress.activePreset = targetPreset;
    progress.updatedAt = new Date().toISOString();
    await this.progressRepository.save(progress);
    return { activePreset: targetPreset, equipment: progress.equipment };
  }

  _snapshotEquipment(equipment = {}) {
    const snap = {};
    for (const [slot, item] of Object.entries(equipment)) {
      if (!item) { snap[slot] = null; continue; }
      // 只存識別用欄位，不存整個大物件（節省空間）
      snap[slot] = { uuid: item.uuid || null, itemId: item.itemId, itemName: item.itemName || item.name || null, equipSlot: item.equipSlot || slot };
    }
    return snap;
  }

  async enhanceItem(discordId, targetUuid, materialUuid) {
    const ENHANCE_MAX = MAX_ENHANCE_LEVEL;
    const progress = await this.progressRepository.findByPlayerId(discordId);
    if (!progress) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到背包資料", 404);
    const inv = progress.inventory || [];
    let target = inv.find(e => this._matchesInventoryEntryRef(e, targetUuid));
    let targetSlotKey = null;
    if (!target) {
      for (const [k, v] of Object.entries(progress.equipment || {})) {
        if (v && this._matchesInventoryEntryRef(v, targetUuid)) { target = v; targetSlotKey = k; break; }
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
      if (this._matchesInventoryEntryRef(entry, target.uuid || targetUuid)) return false;
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

    const pickMaterials = (cands, needUnits) => {
      const items = cands.map((entry) => ({ ref: this._buildInventoryEntryRef(entry), units: unitValue(entry) }));
      const limit = needUnits + 8;
      const dp = new Map();
      dp.set(0, { refs: [], sum: 0, count: 0 });

      for (const it of items) {
        const cur = new Map(dp);
        for (const [sum, state] of dp.entries()) {
          const nsum = Math.min(limit, sum + it.units);
          const cand = { refs: [...state.refs, it.ref], sum: nsum, count: state.count + 1 };
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
      return best ? best.refs : [];
    };

    let chosen = [];
    if (materialUuid) {
      const preferred = inv.find((entry) => entry && (this._matchesInventoryEntryRef(entry, materialUuid) || entry.itemId === materialUuid || entry.itemName === materialUuid));
      if (preferred && isSameBase(preferred) && Number(preferred.enhanceLevel || 0) <= maxMaterialLevel) {
        chosen = [this._buildInventoryEntryRef(preferred)];
      }
    }

    const chosenSet = new Set(chosen);
    const remainingNeed = requiredUnits - chosen.reduce((sum, uuid) => {
      const found = candidates.find((entry) => this._matchesInventoryEntryRef(entry, uuid));
      return sum + (found ? unitValue(found) : 0);
    }, 0);
    if (remainingNeed > 0) {
      const rest = candidates.filter((entry) => !chosenSet.has(this._buildInventoryEntryRef(entry)));
      const picked = pickMaterials(rest, remainingNeed);
      chosen = [...chosen, ...picked];
    }
    const chosenUnits = chosen.reduce((sum, uuid) => {
      const found = candidates.find((entry) => this._matchesInventoryEntryRef(entry, uuid));
      return sum + (found ? unitValue(found) : 0);
    }, 0);
    if (chosenUnits < requiredUnits) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "材料不足（請確認材料在背包中且同裝備）", 400);
    }

    const stats = target.equipStats || {};
    const statEntries = Object.entries(stats).filter(([, value]) => Number.isFinite(Number(value)) && Number(value) !== 0);
    if (statEntries.length === 0) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "此裝備沒有可強化的屬性", 400);

    // 根据品阶計算正确的強化增值（與 enhanceService.enhanceEquipment() 一致）
    const WEAPON_ENHANCE_BONUS = { D: 1, C: 1.5, B: 2, A: 2 };
    const tier = String(target.tier || "").toUpperCase();
    const isWeapon = target.equipSlot === "weapon" || target.equipSlot === "shield";
    let mainStat = null;
    let delta = 1; // 預設值
    if (isWeapon) {
      mainStat = Object.entries(stats).sort((a, b) => b[1] - a[1])[0]?.[0];
      if (!mainStat) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "此裝備沒有可強化的屬性", 400);
      delta = WEAPON_ENHANCE_BONUS[tier] ?? 1;
    } else {
      const candidateStats = statEntries.map(([key]) => key);
      mainStat = candidateStats[Math.floor(Math.random() * candidateStats.length)];
      delta = ARMOR_RANDOM_ENHANCE_BONUS[tier] ?? 1;
    }

    const oldStatValue = Number(stats[mainStat] || 0);
    const newStats = { ...stats, [mainStat]: Number((oldStatValue + delta).toFixed(2)) };
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
      if (entry && chosen.includes(this._buildInventoryEntryRef(entry))) idxs.push(i);
    }
    idxs.sort((a, b) => b - a);
    for (const i of idxs) progress.inventory.splice(i, 1);

    let savedTargetIndex = -1;
    if (targetSlotKey) {
      progress.equipment[targetSlotKey] = updatedTarget;
    } else {
      savedTargetIndex = progress.inventory.findIndex(e => this._matchesInventoryEntryRef(e, target.uuid || targetUuid));
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
            : progress.inventory.findIndex((entry) => this._matchesInventoryEntryRef(entry, updatedTarget.uuid || targetUuid));
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
      currentEquipStats: newStats,
      statBoosted: mainStat,
      statBoostedZh: STAT_LABEL_ZH[mainStat] || String(mainStat).toUpperCase(),
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
