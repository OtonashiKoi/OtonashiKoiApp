const { AppError, ERROR_CODES } = require("../../shared/errors");
const { isBoundItemId } = require("../../shared/boundItems");
const { CURRENCY_SOURCES, EXP_SOURCES } = require("../../shared/sources");
const { applyEffectInstances } = require("../../shared/effectEngine");
const { MAX_ENHANCE_LEVEL } = require("../../shared/enhanceConfig");
const { withPlayerProgressLock } = require("../progress/progressLocks");
const crypto = require("crypto");

// 各 tier 裝備販售價格
const TIER_SELL_PRICE = { D: 200, C: 500, B: 1000, A: 10000, S: 15000 };
// 強化寶石售價（獨立低價，定位「清庫存」而非收入；不套用一般裝備的 TIER_SELL_PRICE）
const GEM_SELL_PRICE = { D: 50, C: 150, B: 400, A: 1200, S: 3000 };

// 分解：強化寶石 itemId（依階級）
const GEM_ID_BY_TIER = {
  D: "72fde92d-e33f-42fb-8d86-2e811d03f84d",
  C: "556db9e1-b084-4b22-bab5-a66c2b586184",
  B: "8fdfa7d9-f0fa-4e6a-a291-703b1e354072",
  A: "a6ae293d-52fc-4af5-8770-891ddf842e35",
  S: "gem-s-tier",
};
// 強化寶石本身不可分解（分解只吃裝備；寶石送進來會無產物卻照樣被移除＝白白消失）
const GEM_ID_SET = new Set(Object.values(GEM_ID_BY_TIER));

// 分解：屬性石 itemId（依屬性）。由 scripts/seed-element-stones.js 建立，id 是固定字串不是 UUID。
const ELEMENT_STONE_ID_BY_ELEMENT = {
  water: "element-stone-water", fire: "element-stone-fire", wood: "element-stone-wood",
  earth: "element-stone-earth", metal: "element-stone-metal",
  sun: "element-stone-sun", moon: "element-stone-moon",
};
// 分解帶屬性的裝備時，**獨立於強化寶石**再擲一次（兩者可同時獲得，也可能都槓龜）。
// 顆數＝屬性濃度：水1 給 1 顆、水4 給 4 顆，讓高濃度裝備拆起來才划算。
//
// 機率依「裝備階級」分級（2026-08-01，原本不分階級一律 50%）：
//   低階拆一堆也出不了幾顆、高階才是主要產出口 → 逼玩家拆好裝而不是拿垃圾裝洗石。
//   總量相對舊制略減並向高階集中；配合鑲嵌成本（0→1 要 2 顆、疊到 3 級累計 15 顆）不會太快通膨。
const ELEMENT_STONE_RATE_BY_TIER = {
  D: 0.25, C: 0.35, B: 0.50, A: 0.65, S: 0.85,
};
/** 該階級裝備分解出屬性石的機率（0~1）；未知階級一律 0（分解流程本來就只吃 D~S）。 */
function getElementStoneRate(tier) {
  return ELEMENT_STONE_RATE_BY_TIER[String(tier || "").toUpperCase()] || 0;
}
function isGemEntry(entry) {
  return !!entry && (GEM_ID_SET.has(entry.itemId) || entry.itemType === "gem");
}
// 屬性石：不可分解（走上面 canDismantle 的 itemType==="equipment" 判斷已天然擋掉）、
// 不可販售給系統（見 getSellQuote），但可以上架拍賣（見 auctionService.ELEMENT_STONE_IDS）。
function isElementStoneEntry(entry) {
  return !!entry && Object.values(ELEMENT_STONE_ID_BY_ELEMENT).includes(entry.itemId);
}
// 特殊/收藏槽位不可分解：錨點(唯一傳說)、稱號、職業徽章。
// （special 卡由 _isMonsterCardEntry 另外擋）這些是 itemType==="equipment" 但珍貴/功能性，
// 原本會被當一般裝分解掉（錨點 S 階 → 變 A 寶石、稱號 → 直接消失）。
function isProtectedSlotEntry(entry) {
  const slot = String(entry?.equipSlot || "");
  return slot === "anchor" || slot === "title_eq" || slot === "job_eq";
}
// 分解產物：裝備階級 → 同階強化寶石 × 1（D→D、C→C、B→B、A→A、S→S；玩家預告 playerPanel 由此表動態產生）
const DISMANTLE_YIELD = {
  S: { tier: "S", count: 1 },
  A: { tier: "A", count: 1 },
  B: { tier: "B", count: 1 },
  C: { tier: "C", count: 1 },
  D: { tier: "D", count: 1 },
};
// 分解成功率單一來源(前端顯示改用回傳的 successRatePct，不再各自硬編碼 50%)
const DISMANTLE_SUCCESS_RATE = 0.5;
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
const TWO_HANDED_WEAPON_TYPES = new Set(["sword_2h", "axe_2h", "mace_2h", "staff_2h", "bow", "dice"]);
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

  _rollRandomAttributeDrops(attributes, amount = 2, allocatedFloor = {}) {
    const ATTR_KEYS = ["str", "agi", "vit", "int", "dex", "luk"];
    const next = { ...(attributes || {}) };
    for (const key of ATTR_KEYS) {
      next[key] = Math.max(1, Number(next[key]) || 1);
    }

    // 2+1 制：隨機扣點的地板 = 基礎 1 + 玩家已自主分配量（隨機收回不吃自選的點）
    const floorOf = (key) => 1 + Math.max(0, Number(allocatedFloor?.[key]) || 0);
    const dropped = [];
    for (let i = 0; i < amount; i++) {
      const available = ATTR_KEYS.filter((key) => next[key] > floorOf(key));
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
      .filter((entry) => !entry?.locked && this._getBulkSellSignature(entry) === refSignature);
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

  async createItem({ itemLibraryId, price, currency, stock, enabled, isSale, allowedTiers, maxPerMonth, maxPerDay, claimLimit }) {
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
      maxPerDay: Math.max(0, Number(maxPerDay) || 0),
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
    if (fields.maxPerDay !== undefined) updated.maxPerDay = Math.max(0, Number(fields.maxPerDay) || 0);
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

  // 台北時區今日日期鍵（YYYY-MM-DD），供「每日限購」(maxPerDay) 計數用
  _currentTaipeiDate() {
    // en-CA 格式即 YYYY-MM-DD
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: TAIPEI_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date());
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

    // 以玩家序列鎖包住「讀進度→驗月購/持有上限→扣款→扣庫存→入背包→存檔」，避免併發購買造成超買或覆寫遺失
    return withPlayerProgressLock(discordId, async () => {
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

    // 每日限購（maxPerDay）：以台北日期為界，隔日重置
    const maxPerDay = item.maxPerDay || 0;
    if (maxPerDay > 0) {
      const dk = this._currentTaipeiDate();
      const dcounts = (progress?.shopDailyCount || {});
      const usedToday = (dcounts[itemId] || {})[dk] || 0;
      if (usedToday + quantity > maxPerDay) {
        throw new AppError(ERROR_CODES.FORBIDDEN, `此商品今日購買已達上限（今日已購 ${usedToday}/${maxPerDay}，明日重置）`, 403);
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
      if ((item.maxPerDay || 0) > 0) {
        if (!progress.shopDailyCount) progress.shopDailyCount = {};
        const dk = this._currentTaipeiDate();
        if (!progress.shopDailyCount[itemId]) progress.shopDailyCount[itemId] = {};
        progress.shopDailyCount[itemId][dk] = ((progress.shopDailyCount[itemId][dk] || 0) + quantity);
      }
      // 添加 quantity 個物品到背包
      const _itemId = item.itemLibraryId || item.id;
      // 神祕蛋可堆疊：合併到既有同 itemId 的蛋堆，避免每顆各佔一格
      if ((item.itemType || "") === "pet_egg") {
        const existingEgg = progress.inventory.find((x) => x && x.itemType === "pet_egg" && x.itemId === _itemId);
        if (existingEgg) {
          existingEgg.stackCount = (Number(existingEgg.stackCount) || 1) + quantity;
        } else {
          progress.inventory.push({
            uuid: crypto.randomUUID(),
            itemId: _itemId,
            itemName: item.name,
            itemEffect: item.effect || { type: "none", value: 0 },
            useEffects: libraryItem?.useEffects || item.useEffects || [],
            passiveEffects: libraryItem?.passiveEffects || item.passiveEffects || [],
            procEffects: libraryItem?.procEffects || item.procEffects || [],
            combatEffects: libraryItem?.combatEffects || item.combatEffects || [],
            itemType: "pet_egg",
            imageUrl: item.imageUrl || null,
            imageThumbnailUrl: item.imageThumbnailUrl || null,
            tier: effectiveTier,
            stackCount: quantity,
            purchasedAt: new Date().toISOString()
          });
        }
      } else {
        for (let i = 0; i < quantity; i++) {
          const boughtEntry = {
            uuid: crypto.randomUUID(),
            itemId: _itemId,
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
          };
          // 獲得瞬間骰附魔（僅裝備、且尚未有附魔時）
          try { require("../enchant/enchantService").rollForEntry(boughtEntry); } catch (_) { /* noop */ }
          progress.inventory.push(boughtEntry);
        }
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
    });
  }

  async useItem(discordId, entryUuid, displayName) {
    const ATTR_KEYS = ["str", "agi", "vit", "int", "dex", "luk"];
    const ENHANCE_GEM_IDS = new Set([
      '72fde92d-e33f-42fb-8d86-2e811d03f84d', // D
      '556db9e1-b084-4b22-bab5-a66c2b586184', // C
      '8fdfa7d9-f0fa-4e6a-a291-703b1e354072', // B
      'a6ae293d-52fc-4af5-8770-891ddf842e35', // A
      'gem-s-tier'                            // S
    ]);
    const CAS_MAX_RETRIES = 8;

    let savedEntry = null;
    let savedEffect = null;
    let savedUseEffects = [];
    let savedEffectDesc = "";
    let savedChestReward = null;
    let savedStatChange = null; // 屬性重製 / 等級下降 → 供網頁彈窗顯示數值變化
    let casSuccess = false;

    // CAS 重試：避免與 grantExp、其他 progress 寫入衝突
    await withPlayerProgressLock(discordId, async () => {
      // 世界王寶箱：抽中的獎勵只擲一次，CAS 重試時沿用同一結果（避免重試重抽不公平）
      let chestRolledEntry = undefined;
      let chestRewardInfo = null;
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
      // 附魔重骰藥水不能直接使用(其效果需指定裝備目標；直接用會被當無效果消耗＝浪費)。請在「裝備」上重骰。
      if (entry.itemId === "enchant_reroll_potion" || String(entry.itemEffect?.type || "") === "reroll_enchant") {
        throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "附魔重骰藥水請在「裝備」上使用（裝備詳情 → 重骰附魔），不能直接使用", 400);
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
        allocatedAttrs: { ...(progress.allocatedAttrs || {}) }, // 2+1 制：自主分配紀錄（藥水要用）
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
        // 2+1 制改版（2026-08-07）：只重骰「隨機成長」的部分——
        // 玩家自主分配的點（allocatedAttrs）原位保留、尚未分配的自主點（statusPoints）不動。
        const alloc = next.allocatedAttrs || {};
        const allocSum = ATTR_KEYS.reduce((s, k) => s + (Number(alloc[k]) || 0), 0);
        const currentAttrTotal = ATTR_KEYS.reduce((sum, k) => sum + (Number(next.attributes?.[k]) || 0), 0);
        const pointsToDistribute = Math.max(0, currentAttrTotal - 6 - allocSum);
        const newAttrs = { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 };
        for (const k of ATTR_KEYS) newAttrs[k] += Math.max(0, Number(alloc[k]) || 0);
        for (let i = 0; i < pointsToDistribute; i++) {
          const key = ATTR_KEYS[Math.floor(Math.random() * ATTR_KEYS.length)];
          newAttrs[key]++;
        }
        next.attributes = newAttrs;
        const attrLine = ATTR_KEYS.map(k => `${k.toUpperCase()}:${newAttrs[k]}`).join(" ");
        effectDesc = `🔮 隨機屬性已重製（自主配點保留）！新屬性：${attrLine}`;
      } else if (effect.type === "level_down_random_attributes") {
        const currentLevel = Math.max(1, Number(next.level) || 1);
        // 2+1 制改版（2026-08-07）：降 1 級＝收回該級所發的「隨機 2 點＋自主 1 點」。
        // 隨機扣點地板 = 1 + 已自主分配量（隨機扣不吃玩家自選的點）
        const alloc = next.allocatedAttrs || {};
        const { nextAttributes, dropped } = this._rollRandomAttributeDrops(next.attributes, 2, alloc);
        next.level = currentLevel - 1;
        next.exp = 0;
        next.attributes = nextAttributes;
        let freeNote = "";
        if ((next.statusPoints || 0) > 0) {
          next.statusPoints -= 1;
          freeNote = "、自主點 -1";
        } else {
          // 自主點已花光 → 隨機收回一點「已分配」的屬性（同步扣 allocatedAttrs 紀錄）
          const spent = ATTR_KEYS.filter((k) => (Number(alloc[k]) || 0) > 0 && (Number(next.attributes[k]) || 1) > 1);
          if (spent.length) {
            const k = spent[Math.floor(Math.random() * spent.length)];
            next.attributes[k] -= 1;
            next.allocatedAttrs = { ...alloc, [k]: (Number(alloc[k]) || 0) - 1 };
            freeNote = `、${k.toUpperCase()}-1（自主配點）`;
          }
        }
        const droppedText = dropped.length
          ? dropped.map(({ key, amount }) => `${key.toUpperCase()}-${amount}`).join("、")
          : "沒有可再下降的屬性";
        effectDesc = `☯️ 等級下降至 Lv.${next.level}，並隨機失去 ${droppedText}${freeNote}。`;
      } else if (effect.type === "open_world_boss_chest") {
        // 世界王寶箱：依該世界王掉落率比重，隨機獲得一份掉落物（與該王即時掉落表同步）
        if (chestRolledEntry === undefined) {
          // 大史王寶箱限定：3% 唯一傳說錨點（先機/後勢），擁有過就不再開出
          const legendary = effect.monsterId === "elite-daishi-king"
            ? await this._tryRollDaishiLegendaryChest(discordId, displayName).catch(() => null)
            : null;
          if (legendary) {
            chestRolledEntry = legendary.entry;
            chestRewardInfo = {
              chestName: entry.itemName,
              rewardItemName: legendary.entry.itemName,
              rewardItemId: legendary.entry.itemId || null,
              rewardImage: legendary.entry.imageUrl || legendary.entry.imageThumbnailUrl || null,
              rewardTier: legendary.entry.tier || "S",
              bossName: effect.bossName || "大史王",
              legendary: true,
            };
          } else {
            const rolled = await this._rollWorldBossChest(effect.monsterId);
            if (!rolled) {
              throw new AppError(ERROR_CODES.INTERNAL_ERROR, "寶箱掉落表讀取失敗，請稍後再試。", 500);
            }
            chestRolledEntry = rolled.entry;
            chestRewardInfo = {
              chestName: entry.itemName,
              rewardItemName: rolled.entry.itemName,
              rewardItemId: rolled.entry.itemId || null,
              rewardImage: rolled.entry.imageUrl || rolled.entry.imageThumbnailUrl || null,
              rewardTier: rolled.entry.tier || null,
              bossName: effect.bossName || "世界王",
            };
          }
        }
        const chestEntryToAdd = { ...chestRolledEntry };
        // 獲得瞬間骰附魔（僅裝備、且尚未有附魔時）
        try { require("../enchant/enchantService").rollForEntry(chestEntryToAdd); } catch (_) { /* noop */ }
        next.inventory.push(chestEntryToAdd);
        effectDesc = `🎁 開啟 **${entry.itemName}**，獲得 **${chestRewardInfo.rewardItemName}**！`;
      } else if (effect.type === "open_random_weapon") {
        // 武器抽選箱：從指定階級的所有武器中等機率隨機開出一把（沿用寶箱開箱動畫）
        if (chestRolledEntry === undefined) {
          const rolled = await this._rollRandomWeapon(effect.tier || "A");
          if (!rolled) {
            throw new AppError(ERROR_CODES.INTERNAL_ERROR, "武器抽選箱獎池讀取失敗，請稍後再試。", 500);
          }
          chestRolledEntry = rolled.entry;
          chestRewardInfo = {
            chestName: entry.itemName,
            rewardItemName: rolled.entry.itemName,
            rewardItemId: rolled.entry.itemId || null,
            rewardImage: rolled.entry.imageUrl || rolled.entry.imageThumbnailUrl || null,
            rewardTier: rolled.entry.tier || null,
            // 不設 bossName → 前端顯示「📦 開啟寶箱」，但沿用同一套開箱特效
          };
        }
        const chestEntryToAdd = { ...chestRolledEntry };
        try { require("../enchant/enchantService").rollForEntry(chestEntryToAdd); } catch (_) { /* noop */ }
        next.inventory.push(chestEntryToAdd);
        effectDesc = `🎁 開啟 **${entry.itemName}**，獲得 **${chestRewardInfo.rewardItemName}**！`;
      } else if (effect.type === "open_anchor_pack") {
        // 記憶錨定卡包：加權抽 1 份 — 主線 NPC 卡(A 特別稀有)混入 C/D 階裝備（沿用寶箱開箱動畫）
        if (chestRolledEntry === undefined) {
          const rolled = await this._rollAnchorPack();
          if (!rolled) {
            throw new AppError(ERROR_CODES.INTERNAL_ERROR, "卡包獎池讀取失敗，請稍後再試。", 500);
          }
          chestRolledEntry = rolled.entry;
          chestRewardInfo = {
            chestName: entry.itemName,
            rewardItemName: rolled.entry.itemName,
            rewardItemId: rolled.entry.itemId || null,
            rewardImage: rolled.entry.imageUrl || rolled.entry.imageThumbnailUrl || null,
            rewardTier: rolled.entry.tier || null,
            isCard: !!rolled.isCard,
          };
        }
        const chestEntryToAdd = { ...chestRolledEntry };
        // 卡片(special 槽)不骰附魔；只有一般裝備才骰
        if (!chestEntryToAdd.isNpcCard) {
          try { require("../enchant/enchantService").rollForEntry(chestEntryToAdd); } catch (_) { /* noop */ }
        }
        next.inventory.push(chestEntryToAdd);
        effectDesc = `🎁 開啟 **${entry.itemName}**，獲得 **${chestRewardInfo.rewardItemName}**！`;
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
        savedChestReward = chestRewardInfo;
        // 屬性重製 / 等級下降 → 記錄前後快照,稍後推播給網頁彈窗
        if (effect.type === "reroll_attributes" || effect.type === "level_down_random_attributes") {
          savedStatChange = {
            kind: effect.type,
            prevLevel: Math.max(1, Number(progress.level) || 1),
            newLevel: Math.max(1, Number(next.level) || 1),
            prevAttributes: { ...(progress.attributes || {}) },
            newAttributes: { ...(next.attributes || {}) }
          };
        }
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

    // 開箱/開包 → 個人小鈴鐺通知（進通知中心；每次開箱都有，不論階級）
    if (savedChestReward && savedChestReward.rewardItemName) {
      try {
        const tierLabel = savedChestReward.rewardTier ? `${String(savedChestReward.rewardTier).toUpperCase()} 階` : "";
        require("../realtime/playerNotifyService").notifyPlayer(discordId, {
          type: "chest_open",
          title: "🎁 開箱獲得",
          message: `開啟「${savedChestReward.chestName || "寶箱"}」，獲得${tierLabel ? ` ${tierLabel}` : ""}【${savedChestReward.rewardItemName}】！`,
          meta: {
            itemId: savedChestReward.rewardItemId || null,
            tier: savedChestReward.rewardTier || null,
            image: savedChestReward.rewardImage || null,
            isCard: !!savedChestReward.isCard,
          },
        });
      } catch (_) { /* 通知失敗不影響開箱結果 */ }
    }

    // 記憶錨定卡包：抽到「卡片」且 B 級以上(S/A/B) → 全服廣播；C/D 卡與 C/D 裝備只留個人獲得紀錄，不廣播。
    if (savedChestReward && savedChestReward.isCard
      && ["S", "A", "B"].includes(String(savedChestReward.rewardTier || "").toUpperCase())) {
      try {
        const tc = require("../../shared/announceTownChat");
        const who = await tc.resolveDiscordName(discordId).catch(() => (displayName || "某位勇者"));
        tc.announceTownChat(
          `🎴✨ **${who}** 開啟記憶錨定卡包，抽中 **${String(savedChestReward.rewardTier).toUpperCase()} 階**【**${savedChestReward.rewardItemName}**】！`
        ).catch(() => {});
      } catch (_) { /* 廣播失敗不影響開包結果 */ }
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
    } else if (savedEffect.type === "add_backpack_slots") {
      const slots = Math.max(1, Number(savedEffect.value) || 20);
      try {
        const r = await require("../backpack/backpackService").grantSlots(discordId, slots);
        savedEffectDesc = r.added > 0
          ? `🎒 本季背包 +${r.added} 格（目前上限 ${r.capacity}，換季歸零）`
          : `🎒 背包已達上限 ${r.maxCapacity} 格，無法再擴充`;
      } catch (e) {
        savedEffectDesc = "🎒 背包擴充失敗，請稍後再試";
      }
    }

    if (savedUseEffects.length > 0) {
      const statusLine = `附加狀態 ${savedUseEffects.map((u) => u.definitionName || u.key).join("、")}`;
      savedEffectDesc = savedEffectDesc ? `${savedEffectDesc} / ${statusLine}` : statusLine;
    }

    // 屬性重製 / 等級下降 → 推播給網頁,彈出「數值變化」視窗(與升級視窗同款)
    if (savedStatChange) {
      try {
        const { playerEventBus } = require("../realtime/playerEventBus");
        const ATTR_KEYS = ["str", "agi", "vit", "int", "dex", "luk"];
        const ATTR_LABEL_ZH = {
          str: "力量 STR", agi: "敏捷 AGI", vit: "體質 VIT",
          int: "智力 INT", dex: "靈巧 DEX", luk: "幸運 LUK"
        };
        const sc = savedStatChange;
        const attributesZh = ATTR_KEYS.map((key) => {
          const prev = Number(sc.prevAttributes[key]) || 0;
          const value = Number(sc.newAttributes[key]) || 0;
          return { key, label: ATTR_LABEL_ZH[key] || key.toUpperCase(), prev, value, delta: value - prev };
        });
        const isReroll = sc.kind === "reroll_attributes";
        playerEventBus.emit(String(discordId), {
          type: "stat_change",
          data: {
            kind: sc.kind,
            title: isReroll ? "屬性重製" : "等級下降",
            icon: isReroll ? "🔮" : "☯️",
            itemName: savedEntry.itemName,
            prevLevel: sc.prevLevel,
            newLevel: sc.newLevel,
            attributesZh,
            ts: new Date().toISOString()
          }
        });
      } catch (_) { /* 推播失敗不影響使用結果 */ }
    }

    return { itemName: savedEntry.itemName, effectDesc: savedEffectDesc, chestReward: savedChestReward };
  }

  /**
   * 一鍵批量使用同一種「純發放型」消耗品：一次消耗多個、效果加總、只發放一次。
   * 支援 grant_gold / grant_diamond / grant_exp（全用）與 add_backpack_slots（依剩餘空間只用得到的量、不浪費）。
   * 寶箱/卡包(開箱揭曉)、藥水/屬性重製等需逐一結算的道具不走批量。
   */
  async useConsumableBulk(discordId, uuids, displayName) {
    const CURRENCY_EFFECTS = new Set(["grant_gold", "grant_diamond", "grant_exp"]);
    const BULK_SAFE = new Set([...CURRENCY_EFFECTS, "add_backpack_slots"]);
    const uuidList = [...new Set((Array.isArray(uuids) ? uuids : []).map((s) => String(s).trim()).filter(Boolean))];
    if (uuidList.length === 0) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "沒有指定要使用的物品", 400);

    const CAS_MAX_RETRIES = 8;
    let out = null;
    let casSuccess = false;
    await withPlayerProgressLock(discordId, async () => {
      for (let attempt = 0; attempt < CAS_MAX_RETRIES; attempt++) {
        const progress = await this.progressRepository.findByPlayerId(discordId);
        if (!progress) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到背包資料", 404);
        const inv = Array.isArray(progress.inventory) ? progress.inventory : [];
        const isMatch = (e) => uuidList.some((u) => this._matchesInventoryEntryRef(e, u));
        const matched = inv.filter(isMatch);
        if (matched.length === 0) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "背包中找不到這些物品", 404);
        const first = matched[0];
        const effType = String(first.itemEffect?.type || "");
        const LEVEL_DOWN = "level_down_random_attributes"; // 我命由我：批量＝連續降 N 級(逐次套用)
        if ((first.itemType || "consumable") !== "consumable" || !(BULK_SAFE.has(effType) || effType === LEVEL_DOWN)) {
          throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "此物品不支援一鍵批量使用", 400);
        }
        if (!matched.every((e) => e.itemId === first.itemId && String(e.itemEffect?.type || "") === effType)) {
          throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "一次只能批量使用同一種物品", 400);
        }
        const perValue = Number(first.itemEffect?.value) || 0;
        let availCount = 0;
        for (const e of matched) availCount += Math.max(1, Number(e.stackCount) || 1);

        // 決定實際要消耗幾個：純發放型全用；背包擴充依「剩餘空間」只用得到的量(不浪費)
        let useCount = availCount;
        if (effType === "add_backpack_slots") {
          const bp = require("../backpack/backpackService");
          const eff = await bp.resolveEffectiveCapacity(discordId).catch(() => null);
          const room = eff ? Math.max(0, bp.MAX_CAPACITY - eff.cap) : 0;
          const per = perValue > 0 ? perValue : (bp.SLOTS_PER_PURCHASE || 20);
          useCount = Math.max(0, Math.min(availCount, Math.ceil(room / per)));
          if (useCount <= 0) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, `背包已達上限 ${bp.MAX_CAPACITY} 格，無法再擴充`, 400);
        }
        // 我命由我(降級)：最多只能降到 Lv.1，故消耗量 = min(持有, 目前等級-1)；逐次套用累計掉屬性
        let levelDownFields = null, levelDownInfo = null;
        if (effType === LEVEL_DOWN) {
          const curLv = Math.max(1, Number(progress.level) || 1);
          useCount = Math.min(availCount, curLv - 1);
          if (useCount <= 0) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "等級已是 1，無法再降低。", 400);
          let attrs = { ...(progress.attributes || { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 }) };
          const totalDropped = {};
          for (let i = 0; i < useCount; i++) {
            const rolled = this._rollRandomAttributeDrops(attrs, 2);
            attrs = rolled.nextAttributes;
            for (const d of (rolled.dropped || [])) totalDropped[d.key] = (totalDropped[d.key] || 0) + d.amount;
          }
          levelDownFields = { level: Math.max(1, curLv - useCount), exp: 0, attributes: attrs };
          levelDownInfo = { newLevel: levelDownFields.level, dropped: totalDropped };
        }

        // 依 useCount 從 matched 逐件累加 stackCount，選出要移除/部分扣減的 entry
        const toRemove = new Set();
        let partialUuid = null, partialKeep = 0, acc = 0;
        for (const e of matched) {
          if (acc >= useCount) break;
          const sc = Math.max(1, Number(e.stackCount) || 1);
          const need = useCount - acc;
          if (sc <= need) { toRemove.add(String(e.uuid)); acc += sc; }
          else { partialUuid = String(e.uuid); partialKeep = sc - need; acc += need; }
        }
        const nextInv = [];
        for (const e of inv) {
          const u = String(e.uuid);
          if (toRemove.has(u)) continue;
          if (u === partialUuid) { nextInv.push({ ...e, stackCount: partialKeep }); continue; }
          nextInv.push({ ...e });
        }
        const next = { ...progress, ...(levelDownFields || {}), inventory: nextInv, updatedAt: new Date().toISOString() };
        const saved = await this._saveProgressWithFallback(next, progress.updatedAt);
        if (saved) {
          out = { itemId: first.itemId, itemName: first.itemName || first.name || "道具", effType, useCount, perValue, levelDown: levelDownInfo };
          casSuccess = true;
          break;
        }
        if (attempt < CAS_MAX_RETRIES - 1) await new Promise((r) => setTimeout(r, 10 * (attempt + 1)));
      }
    });
    if (!casSuccess || !out) throw new AppError(ERROR_CODES.INTERNAL_ERROR, "批量使用失敗，請稍後再試", 500);

    const dn = displayName || "";
    const totalValue = out.perValue * out.useCount;
    let effectDesc = "";
    if (out.effType === "grant_gold") {
      await this.rewardService.grantCurrency({ discordId, displayName: dn, currencyType: "gold", amount: totalValue, source: CURRENCY_SOURCES.ITEM_USE, operator: "shop:use-item-bulk" });
      effectDesc = `💰 +${totalValue} 金幣`;
    } else if (out.effType === "grant_diamond") {
      await this.rewardService.grantCurrency({ discordId, displayName: dn, currencyType: "diamond", amount: totalValue, source: CURRENCY_SOURCES.ITEM_USE, operator: "shop:use-item-bulk" });
      effectDesc = `💎 +${totalValue} 鑽石`;
    } else if (out.effType === "grant_exp" && this.progressService) {
      await this.progressService.grantExp({ discordId, displayName: dn, amount: totalValue, source: EXP_SOURCES.ITEM_USE_EXP });
      effectDesc = `✨ +${totalValue} 經驗值`;
    } else if (out.effType === "add_backpack_slots") {
      const bp = require("../backpack/backpackService");
      const r = await bp.grantSlots(discordId, totalValue).catch(() => null);
      effectDesc = r ? `🎒 本季背包 +${r.added} 格（目前上限 ${r.capacity}）` : "🎒 背包擴充";
    } else if (out.effType === "level_down_random_attributes") {
      const dropText = (out.levelDown?.dropped && Object.keys(out.levelDown.dropped).length)
        ? Object.entries(out.levelDown.dropped).map(([k, v]) => `${k.toUpperCase()}-${v}`).join("、")
        : "無";
      effectDesc = `☯️ 連續下降 ${out.useCount} 級 → Lv.${out.levelDown?.newLevel}，隨機失去 ${dropText}`;
    }
    return { itemName: out.itemName, count: out.useCount, totalValue, effectType: out.effType, effectDesc };
  }

  // 世界王寶箱抽獎：讀該世界王怪物的即時掉落表，依 chance 權重抽一份，建成背包 entry
  /**
   * 大史王寶箱限定：先機/後勢各 3% 唯一傳說錨點。抽中一件即回傳其背包 entry；否則 null（走一般掉落）。
   * 已擁有過的（uniqueGrant）不會再開出。每次開箱最多一件傳說。
   */
  async _tryRollDaishiLegendaryChest(discordId, displayName = null) {
    const uniqueGrant = require("../uniqueGrant/uniqueGrantService");
    const candidates = ["s-legend-burst", "s-legend-linger"];
    for (const itemId of candidates) {
      if (Math.random() >= 0.03) continue;                 // 各 3%
      const first = await uniqueGrant.claim(discordId, itemId, "boss_chest:daishi").catch(() => false);
      if (!first) continue;                                // 已擁有過 → 跳過（不再開出）
      const item = await this.itemRepository.findById(itemId).catch(() => null);
      if (!item) { await uniqueGrant.release(discordId, itemId).catch(() => {}); continue; }
      const entry = {
        uuid: crypto.randomUUID(),
        itemId: item.id, itemName: item.name,
        itemEffect: item.effect || { type: "none", value: 0 },
        useEffects: item.useEffects || [], passiveEffects: item.passiveEffects || [],
        procEffects: item.procEffects || [], combatEffects: item.combatEffects || [],
        itemType: item.itemType || "equipment",
        imageUrl: item.imageUrl || null, imageThumbnailUrl: item.imageThumbnailUrl || null,
        equipSlot: item.equipSlot || "anchor", equipStats: item.equipStats || null,
        weaponType: item.weaponType || null, isTwoHanded: item.isTwoHanded || false,
        tier: item.tier || "S",
        source: "boss_chest:daishi", obtainedAt: new Date().toISOString(),
      };
      console.log(`[shop] 🎉 大史王寶箱開出唯一傳說錨點 ${item.name} → ${discordId}`);
      const tc = require("../../shared/announceTownChat");
      const who = await tc.resolveDiscordName(discordId).catch(() => "某位勇者");
      tc.announceTownChat(
        `📦✨ **${who}** 開啟大史王寶箱，獲得傳說錨點【**${item.name}**】！得來不易！`
      ).catch(() => {});
      return { entry };
    }
    return null;
  }

  async _rollWorldBossChest(monsterId) {
    const { getMongoDb } = require("../../adapters/mongo/createMongoClient");
    const db = await getMongoDb();
    const mon = await db.collection("monsters").findOne({ id: monsterId });
    // 寶箱獎池排除 S 階強化寶石（S 寶石只走世界王實戰掉落，維持稀有，不從寶箱大量產出）
    const CHEST_EXCLUDE_IDS = new Set(["gem-s-tier"]);
    const drops = Array.isArray(mon?.drops)
      ? mon.drops.filter((d) => d && d.itemId && (Number(d.chance) > 0) && !CHEST_EXCLUDE_IDS.has(d.itemId))
      : [];
    if (!drops.length) return null;

    const total = drops.reduce((s, d) => s + (Number(d.chance) || 0), 0);
    let r = Math.random() * total;
    let picked = drops[drops.length - 1];
    for (const d of drops) {
      r -= (Number(d.chance) || 0);
      if (r <= 0) { picked = d; break; }
    }

    const item = await this.itemRepository.findById(picked.itemId).catch(() => null);
    const equipStats = item?.equipStats ? { ...item.equipStats } : {};
    const entry = {
      uuid: crypto.randomUUID(),
      itemId: item?.id || picked.itemId,
      itemName: item?.name || picked.itemName || "神秘道具",
      itemEffect: item?.effect || { type: "none", value: 0 },
      useEffects: item?.useEffects || [],
      passiveEffects: item?.passiveEffects || [],
      procEffects: item?.procEffects || [],
      combatEffects: item?.combatEffects || [],
      itemType: item?.itemType || "consumable",
      imageUrl: item?.imageUrl || null,
      imageThumbnailUrl: item?.imageThumbnailUrl || null,
      equipSlot: item?.equipSlot || null,
      equipStats,
      weaponType: item?.weaponType || null,
      isTwoHanded: item?.isTwoHanded || false,
      atkStat: item?.atkStat || null,
      tier: item?.tier || null,
      monsterCardSkill: item?.monsterCardSkill || null,
      enhanceLevel: 0,
      source: "world_boss_chest",
      sourceRef: monsterId,
      purchasedAt: new Date().toISOString(),
    };
    // 活動限定裝：道具自帶 elementDrop → 從寶箱開出來也要帶屬性（否則限定裝的賣點在寶箱這條路上會失效）
    try {
      if (item?.elementDrop) {
        require("../../shared/elementDropRoll").rollElementForEntry(entry, { override: item.elementDrop });
      }
    } catch (_) { /* noop */ }
    return { entry, itemName: entry.itemName };
  }

  // 武器抽選箱：從指定階級的所有武器等機率抽一把，建成背包 entry
  async _rollRandomWeapon(tier = "A") {
    const { getMongoDb } = require("../../adapters/mongo/createMongoClient");
    const db = await getMongoDb();
    const weapons = await db.collection("items")
      .find({ itemType: "equipment", tier, weaponType: { $ne: null } })
      .toArray();
    if (!weapons.length) return null;
    const item = weapons[Math.floor(Math.random() * weapons.length)];
    const equipStats = item?.equipStats ? { ...item.equipStats } : {};
    const entry = {
      uuid: crypto.randomUUID(),
      itemId: item.id,
      itemName: item.name || "神秘武器",
      itemEffect: item?.effect || { type: "none", value: 0 },
      useEffects: item?.useEffects || [],
      passiveEffects: item?.passiveEffects || [],
      procEffects: item?.procEffects || [],
      combatEffects: item?.combatEffects || [],
      itemType: "equipment",
      imageUrl: item?.imageUrl || null,
      imageThumbnailUrl: item?.imageThumbnailUrl || null,
      equipSlot: item?.equipSlot || null,
      equipStats,
      weaponType: item?.weaponType || null,
      isTwoHanded: item?.isTwoHanded || false,
      atkStat: item?.atkStat || null,
      tier: item?.tier || tier,
      setKey: item?.setKey || null,
      setKeys: Array.isArray(item?.setKeys) ? item.setKeys : (item?.setKey ? [item.setKey] : []),
      monsterCardSkill: null,
      enhanceLevel: 0,
      source: "weapon_chest",
      sourceRef: `chest:${tier}:weapon`,
      purchasedAt: new Date().toISOString(),
    };
    return { entry, itemName: entry.itemName };
  }

  // 把一份 item 文件轉成背包 entry（保留卡片技能/被動等所有欄位）
  _buildEntryFromItem(item, source, sourceRef) {
    return {
      uuid: crypto.randomUUID(),
      itemId: item.id,
      itemName: item.name || "神秘物品",
      itemEffect: item?.effect || { type: "none", value: 0 },
      useEffects: item?.useEffects || [],
      passiveEffects: item?.passiveEffects || [],
      procEffects: item?.procEffects || [],
      combatEffects: item?.combatEffects || [],
      itemType: item?.itemType || "equipment",
      imageUrl: item?.imageUrl || null,
      imageThumbnailUrl: item?.imageThumbnailUrl || null,
      equipSlot: item?.equipSlot || null,
      equipStats: item?.equipStats ? { ...item.equipStats } : {},
      weaponType: item?.weaponType || null,
      isTwoHanded: item?.isTwoHanded || false,
      atkStat: item?.atkStat || null,
      tier: item?.tier || null,
      setKey: item?.setKey || null,
      setKeys: Array.isArray(item?.setKeys) ? item.setKeys : (item?.setKey ? [item.setKey] : []),
      monsterCardSkill: item?.monsterCardSkill || null,
      isNpcCard: item?.isNpcCard || false,
      npcCardOf: item?.npcCardOf || null,
      enhanceLevel: 0,
      source,
      sourceRef,
      purchasedAt: new Date().toISOString(),
    };
  }

  // 記憶錨定卡包抽獎：加權表(總權重 1000)
  //   NPC 卡 530‰(A 僅 10‰=1%)，其餘 470‰ 為 C/D 階一般裝備。
  async _rollAnchorPack() {
    const { getMongoDb } = require("../../adapters/mongo/createMongoClient");
    const db = await getMongoDb();
    const TABLE = [
      { kind: "card", id: "npc-card-npc-ch1-examiner",   w: 10 },  // A 1.0%
      { kind: "card", id: "npc-card-npc-player-sister",  w: 40 },  // B 4.0%
      { kind: "card", id: "npc-card-npc-ikea-koi",       w: 40 },  // B 4.0%
      { kind: "card", id: "npc-card-npc-ch1-registrar",  w: 80 },  // C 8.0%
      { kind: "card", id: "npc-card-npc-ch1-student",    w: 90 },  // D 9.0%
      { kind: "card", id: "npc-card-npc-ch1-passerby-a", w: 90 },  // D 9.0%
      { kind: "card", id: "npc-card-npc-ch1-passerby-b", w: 90 },  // D 9.0%
      { kind: "card", id: "npc-card-npc-ch1-staff",      w: 90 },  // D 9.0%
      { kind: "equip", tier: "C", w: 170 },                        // C 階裝備 17.0%
      { kind: "equip", tier: "D", w: 300 },                        // D 階裝備 30.0%
    ];
    const total = TABLE.reduce((a, b) => a + b.w, 0);
    let r = Math.random() * total;
    let pick = TABLE[TABLE.length - 1];
    for (const row of TABLE) { if ((r -= row.w) < 0) { pick = row; break; } }

    if (pick.kind === "card") {
      const item = await db.collection("items").findOne({ id: pick.id });
      if (!item) return null;
      return { entry: this._buildEntryFromItem(item, "anchor_pack", `pack:card:${pick.id}`), itemName: item.name, isCard: true };
    }
    // 一般裝備：該階可掉的裝備(排除卡片/職業徽章/不可掉落)，等機率抽一件
    const pool = await db.collection("items").find({
      itemType: "equipment",
      tier: pick.tier,
      equipSlot: { $nin: ["special", "job_eq"] },
      isNpcCard: { $ne: true },
      monsterCardOf: { $exists: false },
    }).toArray();
    if (!pool.length) {
      // 保底：該階無裝備時退回抽一張 D 卡，避免整包失敗
      const fallback = await db.collection("items").findOne({ id: "npc-card-npc-ch1-staff" });
      if (!fallback) return null;
      return { entry: this._buildEntryFromItem(fallback, "anchor_pack", "pack:fallback"), itemName: fallback.name, isCard: true };
    }
    const item = pool[Math.floor(Math.random() * pool.length)];
    return { entry: this._buildEntryFromItem(item, "anchor_pack", `pack:equip:${pick.tier}`), itemName: item.name, isCard: false };
  }

  async sellItem(discordId, entryUuid) {
    const quote = await this.getSellQuote(discordId, entryUuid, 1);
    // 上鎖序列化:並發出售同一 uuid 時,第二個請求會在鎖內重讀背包、找不到物品而被擋,
    // 避免「物品只扣一件卻領兩份金幣」的複製漏洞。
    return withPlayerProgressLock(discordId, async () => {
      const progress = await this.progressRepository.findByPlayerId(discordId);
      if (!progress) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到背包資料", 404);
      const idx = this._findInventoryIndexForAction(progress, entryUuid);
      if (idx === -1) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "背包中找不到此物品", 404);
      const entry = progress.inventory[idx];
      if (entry.locked) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "此裝備已鎖定，請先解鎖再出售", 400);
      // 堆疊型（強化石等消耗品）：賣 1 顆只扣 stackCount，不可整疊刪除
      const stackCount = Number(entry.stackCount || 1);
      if (stackCount > 1) {
        progress.inventory[idx] = { ...entry, stackCount: stackCount - 1 };
      } else {
        progress.inventory.splice(idx, 1);
      }
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
    });
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
    // 屬性石不可販售給系統（想換錢請上拍賣行，賣給玩家而不是變相把屬性石消耗掉換金幣）
    if (isElementStoneEntry(refEntry)) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "屬性石無法販售，可以上架拍賣行交易", 400);
    }
    const isGem = isGemEntry(refEntry);
    // 一般裝備一律走分解、不可販售（怪物卡、強化寶石可賣）
    const isMonsterCard = refEntry.itemType === "monster_card" || refEntry.monsterCardOf || /^special/.test(String(refEntry.equipSlot || ""));
    if (refEntry.itemType === "equipment" && !isMonsterCard) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "裝備不可販售，請改用「分解」取得強化寶石", 400);
    }

    // tier 查詢 + 自訂售價(sellPrice)查詢：同 sellItem，entry 沒有就查 library
    // 藥水等無 tier 的消耗品可用 item.sellPrice 直接定價(不套 TIER_SELL_PRICE)
    let tier = refEntry.tier ? String(refEntry.tier).toUpperCase() : null;
    let customSell = (refEntry.sellPrice != null && Number.isFinite(Number(refEntry.sellPrice))) ? Number(refEntry.sellPrice) : null;
    if ((!tier || customSell === null) && this.itemRepository && refEntry.itemId) {
      const libItem = await this.itemRepository.findById(refEntry.itemId).catch(() => null);
      if (!tier) tier = libItem?.tier ? String(libItem.tier).toUpperCase() : null;
      if (customSell === null && libItem?.sellPrice != null && Number.isFinite(Number(libItem.sellPrice))) customSell = Number(libItem.sellPrice);
    }
    const price = customSell !== null ? Math.max(0, Math.round(customSell))
      : (isGem ? (GEM_SELL_PRICE[tier] ?? null) : (TIER_SELL_PRICE[tier] ?? null));
    if (price === null) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "此物品沒有設定售價，無法販售", 400);

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
    // 上鎖序列化(同 sellItem)：鎖內重算可賣數量並重讀背包，避免並發批量出售複製金幣。
    return withPlayerProgressLock(discordId, async () => {
      const quote = await this.getSellQuote(discordId, entryUuid, qty);
      const progress = await this.progressRepository.findByPlayerId(discordId);
      if (!progress) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到背包資料", 404);

      const refEntry = this._findInventoryEntryForAction(progress, entryUuid);
      if (!refEntry) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "背包中找不到此物品", 404);
      if (refEntry.locked) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "此裝備已鎖定，請先解鎖再出售", 400);

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
    });
  }

  // 分解裝備：移除該裝備，50% 機率產出同階強化寶石（取代舊「丟棄」）
  // 怪物卡不可分解；分解失敗時裝備照樣消失但無產物
  // opts.mode："dismantle"＝分解（只准裝備，消耗品擋下）；預設/"discard"＝丟棄（允許刪消耗品，玩家主動丟東西是合法的）
  async discardItem(discordId, entryUuid, opts = {}) {
    const mode = opts.mode === "dismantle" ? "dismantle" : "discard";
    // 上鎖序列化：避免並發分解同一裝備，造成「裝備只扣一件卻產出兩份寶石」的複製。
    return withPlayerProgressLock(discordId, async () => {
      const progress = await this.progressRepository.findByPlayerId(discordId);
      if (!progress) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到背包資料", 404);
      const idx = (progress.inventory || []).findIndex((e) => this._matchesInventoryEntryRef(e, entryUuid));
      if (idx === -1) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "背包中找不到此物品", 404);
      const entry = progress.inventory[idx];

      // 分解模式：只有裝備能分解。消耗品（金幣袋／藥水等 itemType=consumable）走到分解會被「無產物刪除」＝白白消失，
      // 這裡明確擋下（批量分解時此件被略過、不刪）。玩家真的要丟消耗品請走「丟棄」（mode=discard 不受此限）。
      if (mode === "dismantle" && entry.itemType !== "equipment") {
        throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "只有裝備可以分解，消耗品／其他道具請改用「丟棄」", 400);
      }

      // 已鎖定的裝備不可分解/丟棄（玩家保留用；先解鎖才能處理）
      if (entry.locked) {
        throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "此裝備已鎖定，請先解鎖再分解／丟棄", 400);
      }
      // 怪物卡不可分解（背包中卡片可能 itemType=equipment，但帶 monsterCardOf 或 special 槽）
      if (this._isMonsterCardEntry(entry)) {
        throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "怪物卡無法分解", 400);
      }
      // 靈魂綁定道具不可丟棄/分解（例：繫・初鳴之晶）
      if (isBoundItemId(entry.itemId)) {
        throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "此物品為靈魂綁定，無法分解丟棄", 400);
      }
      // 強化寶石不可分解
      if (isGemEntry(entry)) {
        throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "強化寶石無法分解", 400);
      }
      // 錨點/稱號/職業徽章不可分解（珍貴收藏‧功能裝）
      if (isProtectedSlotEntry(entry)) {
        throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "錨點／稱號／職業徽章無法分解", 400);
      }

      const tier = String(entry.tier || "").toUpperCase();
      const isEquipmentLike = entry.itemType === "equipment";
      const canDismantle = isEquipmentLike && !!DISMANTLE_YIELD[tier];

      // 50% 機率成功分解出產物；失敗則無產物（裝備仍消耗）
      let gemsGranted = null;
      let dismantled = false;
      if (canDismantle) {
        dismantled = true;
        if (Math.random() < DISMANTLE_SUCCESS_RATE) {
          const y = DISMANTLE_YIELD[tier];
          gemsGranted = { tier: y.tier, count: y.count };
        }
      }

      // 先移除被分解的裝備
      progress.inventory.splice(idx, 1);

      // 產出寶石（堆疊進背包）
      if (gemsGranted) {
        await this._grantGems(progress, gemsGranted.tier, gemsGranted.count);
      }

      // 屬性石：帶屬性的裝備才有，機率獨立於上面的強化寶石
      let stonesGranted = null;
      if (canDismantle && entry.element && ELEMENT_STONE_ID_BY_ELEMENT[entry.element]) {
        if (Math.random() < getElementStoneRate(tier)) {
          const count = Math.max(1, Number(entry.elementLevel) || 1);
          stonesGranted = { element: entry.element, count };
          await this._grantElementStones(progress, entry.element, count);
        }
      }

      progress.updatedAt = new Date().toISOString();
      await this.progressRepository.save(progress);
      return {
        itemName: entry.itemName, gems: gemsGranted, dismantled,
        elementStones: stonesGranted,
        successRatePct: Math.round(DISMANTLE_SUCCESS_RATE * 100),
        // 屬性石機率依階級而異（帶屬性的裝備才用得到；前端顯示改讀這個值不要硬編碼）
        elementStoneRatePct: Math.round(getElementStoneRate(tier) * 100)
      };
    });
  }

  /**
   * 切換背包裝備的「鎖定」狀態（鎖定後不可分解/丟棄/出售，避免誤刪保留的好附魔件）。
   * @returns {Promise<{ uuid:string, itemName:string, locked:boolean }>}
   */
  async toggleItemLock(discordId, entryUuid, want = null) {
    return withPlayerProgressLock(discordId, async () => {
      const progress = await this.progressRepository.findByPlayerId(discordId);
      if (!progress) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到背包資料", 404);

      // 先找背包，找不到再找「身上已裝備」(equipment[slot])——已裝備的也要能直接鎖，不用先卸下
      const idx = (progress.inventory || []).findIndex((e) => this._matchesInventoryEntryRef(e, entryUuid));
      let entry = idx !== -1 ? progress.inventory[idx] : null;
      let equippedSlot = null;
      if (!entry) {
        const eq = progress.equipment || {};
        for (const [slot, e] of Object.entries(eq)) {
          if (e && String(e.uuid || "") === String(entryUuid)) { entry = e; equippedSlot = slot; break; }
        }
      }
      if (!entry) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "背包中找不到此物品", 404);
      if (entry.itemType !== "equipment") {
        throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "只有裝備可以鎖定", 400);
      }
      const next = (want === null || want === undefined) ? !entry.locked : Boolean(want);
      if (equippedSlot) progress.equipment[equippedSlot] = { ...entry, locked: next };
      else progress.inventory[idx] = { ...entry, locked: next };
      progress.updatedAt = new Date().toISOString();
      await this.progressRepository.save(progress);
      return { uuid: entry.uuid, itemName: entry.itemName, locked: next };
    });
  }

  // 批量分解：把「同款、未強化(enhanceLevel 0)、非怪物卡」的同 itemId 裝備一起分解。
  // 每件獨立判定 50% 機率產出同階寶石，一次讀寫存檔。
  async discardItemBulk(discordId, entryUuid, qty = 0) {
    // 上鎖序列化：避免並發批量分解複製寶石。
    return withPlayerProgressLock(discordId, async () => {
    const progress = await this.progressRepository.findByPlayerId(discordId);
    if (!progress) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到背包資料", 404);
    const inv = Array.isArray(progress.inventory) ? progress.inventory : [];
    const ref = inv.find((e) => this._matchesInventoryEntryRef(e, entryUuid));
    if (!ref) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "背包中找不到此物品", 404);
    if (ref.locked) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "此裝備已鎖定，請先解鎖再分解", 400);
    if (this._isMonsterCardEntry(ref)) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "怪物卡無法分解", 400);
    if (isBoundItemId(ref.itemId)) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "此物品為靈魂綁定，無法分解丟棄", 400);
    if (isGemEntry(ref)) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "強化寶石無法分解", 400);
    if (isProtectedSlotEntry(ref)) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "錨點／稱號／職業徽章無法分解", 400);

    // 收集同款、未強化、非怪物卡的裝備索引
    const refItemId = ref.itemId;
    const matchIdx = [];
    inv.forEach((e, i) => {
      if (!e || e.itemType !== "equipment") return;
      if (this._isMonsterCardEntry(e)) return;
      if (e.itemId !== refItemId) return;
      if (Number(e.enhanceLevel || 0) !== 0) return;
      if (e.locked) return;                                 // 鎖定件不批量分解（保留）
      matchIdx.push(i);
    });
    if (matchIdx.length === 0) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "沒有可分解的同款未強化裝備（鎖定件已排除）", 400);

    const take = qty > 0 ? Math.min(qty, matchIdx.length) : matchIdx.length;
    const tier = String(ref.tier || "").toUpperCase();
    const canDismantle = !!DISMANTLE_YIELD[tier];

    // 每件獨立擲 50%
    const takenIdx = matchIdx.slice(0, take);
    // 屬性是「掉落瞬間附在該件實例上」的，所以同款 itemId 底下每件的 element/elementLevel 可能都不同
    //（例：3 把秘銀劍裡只有 1 把是水1）→ 屬性石必須逐件看實例，不能像強化寶石那樣用 ref 的 tier 一次算。
    const takenEntries = takenIdx.map((i) => inv[i]);
    let successCount = 0;
    let totalGems = 0;
    let gemTier = null;
    const stoneTotals = {};                                   // element → count
    for (const e of takenEntries) {
      if (canDismantle && Math.random() < DISMANTLE_SUCCESS_RATE) {
        const y = DISMANTLE_YIELD[tier];
        gemTier = y.tier;
        totalGems += y.count;
        successCount += 1;
      }
      if (canDismantle && e?.element && ELEMENT_STONE_ID_BY_ELEMENT[e.element] && Math.random() < getElementStoneRate(tier)) {
        stoneTotals[e.element] = (stoneTotals[e.element] || 0) + Math.max(1, Number(e.elementLevel) || 1);
      }
    }

    // 由大到小移除索引，避免位移錯亂
    takenIdx.slice().sort((a, b) => b - a).forEach((i) => progress.inventory.splice(i, 1));
    if (totalGems > 0 && gemTier) {
      await this._grantGems(progress, gemTier, totalGems);
    }
    for (const [el, count] of Object.entries(stoneTotals)) {
      await this._grantElementStones(progress, el, count);
    }
    progress.updatedAt = new Date().toISOString();
    await this.progressRepository.save(progress);
    return {
      itemName: ref.itemName,
      dismantledCount: take,
      successCount,
      gems: totalGems > 0 ? { tier: gemTier, count: totalGems } : null,
      elementStones: Object.keys(stoneTotals).length > 0 ? stoneTotals : null,
      successRatePct: Math.round(DISMANTLE_SUCCESS_RATE * 100),
      elementStoneRatePct: Math.round(getElementStoneRate(tier) * 100)
    };
    });
  }

  // 批次處理背包（網頁「🧹 整理」多選出售/丟棄/分解）：
  // 一次讀存檔 → 整批在記憶體處理 → 一次寫回 + 一筆金幣發放。
  // 取代前端逐件打單件端點（1200 件＝1200 次網路往返、每件都全量讀寫存檔）。
  // 守門規則與單件端點一致：sell 同 getSellQuote/sellItem；discard/dismantle 同 discardItem。
  // 單件不合規只略過該件（回報原因），不中斷整批。
  async processInventoryBatch(discordId, action, uuids) {
    if (!["sell", "discard", "dismantle"].includes(action)) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "不支援的批次動作", 400);
    }
    const list = [...new Set((Array.isArray(uuids) ? uuids : []).map((u) => String(u || "").trim()).filter(Boolean))];
    if (!list.length) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "請提供要處理的物品清單", 400);

    return withPlayerProgressLock(discordId, async () => {
      const progress = await this.progressRepository.findByPlayerId(discordId);
      if (!progress) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到背包資料", 404);
      const inv = Array.isArray(progress.inventory) ? progress.inventory : (progress.inventory = []);

      // uuid → index 建表一次（逐件 findIndex 在千件背包會是 N²）
      const idxByUuid = new Map();
      inv.forEach((e, i) => { if (e?.uuid) idxByUuid.set(String(e.uuid), i); });
      const findIdx = (ref) => {
        const hit = idxByUuid.get(ref);
        if (hit !== undefined) return hit;
        return inv.findIndex((e) => this._matchesInventoryEntryRef(e, ref)); // key: 格式後備
      };

      // sell 需要查道具庫補 tier/售價的，先批次撈齊，迴圈內不打 DB
      const libByItemId = new Map();
      if (action === "sell") {
        const needIds = new Set();
        for (const u of list) {
          const i = findIdx(u);
          const e = i >= 0 ? inv[i] : null;
          if (e?.itemId && (!e.tier || e.sellPrice == null)) needIds.add(e.itemId);
        }
        await Promise.all([...needIds].map(async (id) => {
          const it = await this.itemRepository?.findById(id).catch(() => null);
          if (it) libByItemId.set(id, it);
        }));
      }

      const removeIdx = new Set();
      const failReasons = {};            // 原因 → 件數（給前端彙總顯示）
      let okCount = 0;
      let sellGold = 0;
      let dismSuccess = 0;               // 有出強化寶石的件數
      const gemTotals = {};              // 寶石 tier → 顆數
      const stoneTotals = {};            // 屬性 element → 顆數
      const failItem = (reason) => { failReasons[reason] = (failReasons[reason] || 0) + 1; };

      for (const u of list) {
        const i = findIdx(u);
        if (i < 0 || removeIdx.has(i)) { failItem("背包中找不到此物品"); continue; }
        const entry = inv[i];
        if (entry.locked) { failItem("已鎖定"); continue; }

        if (action === "sell") {
          // ── 同 getSellQuote 守門與定價 ──
          if (entry.itemType === "job_badge" || entry.equipSlot === "job_eq") { failItem("職業徽章不可販售"); continue; }
          if (isElementStoneEntry(entry)) { failItem("屬性石無法販售"); continue; }
          const isGem = isGemEntry(entry);
          const isMonsterCard = entry.itemType === "monster_card" || entry.monsterCardOf || /^special/.test(String(entry.equipSlot || ""));
          if (entry.itemType === "equipment" && !isMonsterCard) { failItem("裝備不可販售（請改用分解）"); continue; }
          const lib = entry.itemId ? libByItemId.get(entry.itemId) : null;
          const tier = entry.tier ? String(entry.tier).toUpperCase()
            : (lib?.tier ? String(lib.tier).toUpperCase() : null);
          const customSell = (entry.sellPrice != null && Number.isFinite(Number(entry.sellPrice))) ? Number(entry.sellPrice)
            : (lib?.sellPrice != null && Number.isFinite(Number(lib.sellPrice))) ? Number(lib.sellPrice) : null;
          const price = customSell !== null ? Math.max(0, Math.round(customSell))
            : (isGem ? (GEM_SELL_PRICE[tier] ?? null) : (TIER_SELL_PRICE[tier] ?? null));
          if (price === null) { failItem("此物品沒有設定售價"); continue; }
          // 堆疊型每個 uuid 只賣 1 顆（同單件 sellItem 行為）
          const stackCount = Number(entry.stackCount || 1);
          if (stackCount > 1) inv[i] = { ...entry, stackCount: stackCount - 1 };
          else removeIdx.add(i);
          sellGold += price;
          okCount++;
        } else {
          // ── discard / dismantle：同 discardItem 守門 ──
          if (action === "dismantle" && entry.itemType !== "equipment") { failItem("只有裝備可以分解"); continue; }
          if (this._isMonsterCardEntry(entry)) { failItem("怪物卡無法分解／丟棄"); continue; }
          if (isBoundItemId(entry.itemId)) { failItem("靈魂綁定物品無法分解丟棄"); continue; }
          if (isGemEntry(entry)) { failItem("強化寶石無法分解／丟棄"); continue; }
          if (isProtectedSlotEntry(entry)) { failItem("錨點／稱號／職業徽章無法分解"); continue; }
          if (action === "dismantle") {
            const tier = String(entry.tier || "").toUpperCase();
            const canDismantle = entry.itemType === "equipment" && !!DISMANTLE_YIELD[tier];
            if (canDismantle && Math.random() < DISMANTLE_SUCCESS_RATE) {
              const y = DISMANTLE_YIELD[tier];
              gemTotals[y.tier] = (gemTotals[y.tier] || 0) + y.count;
              dismSuccess++;
            }
            // 屬性石獨立判定（屬性是逐件實例的，逐件看 element/elementLevel）
            if (canDismantle && entry.element && ELEMENT_STONE_ID_BY_ELEMENT[entry.element] && Math.random() < getElementStoneRate(tier)) {
              stoneTotals[entry.element] = (stoneTotals[entry.element] || 0) + Math.max(1, Number(entry.elementLevel) || 1);
            }
          }
          removeIdx.add(i);
          okCount++;
        }
      }

      // 一次移除（索引由大到小，避免位移錯亂）
      [...removeIdx].sort((a, b) => b - a).forEach((i) => progress.inventory.splice(i, 1));
      for (const [tier, count] of Object.entries(gemTotals)) {
        await this._grantGems(progress, tier, count);
      }
      for (const [el, count] of Object.entries(stoneTotals)) {
        await this._grantElementStones(progress, el, count);
      }
      progress.updatedAt = new Date().toISOString();
      await this.progressRepository.save(progress);

      if (sellGold > 0) {
        await this.rewardService.grantCurrency({
          discordId,
          displayName: discordId,
          currencyType: "gold",
          amount: sellGold,
          source: CURRENCY_SOURCES.ITEM_SELL,
          operator: `shop:batch-${action}`
        });
      }

      const failCount = list.length - okCount;
      return {
        action,
        requested: list.length,
        okCount,
        failCount,
        failReasons: failCount > 0 ? failReasons : null,
        sellGold,
        dismantleSuccessCount: dismSuccess,
        gemTotals: Object.keys(gemTotals).length ? gemTotals : null,
        stoneTotals: Object.keys(stoneTotals).length ? stoneTotals : null,
        successRatePct: Math.round(DISMANTLE_SUCCESS_RATE * 100)
      };
    });
  }

  // 判斷背包項是否為怪物卡（不可分解）
  _isMonsterCardEntry(entry) {
    if (!entry) return false;
    if (entry.itemType === "monster_card") return true;
    if (entry.monsterCardOf) return true;
    if (/^special/.test(String(entry.equipSlot || ""))) return true;
    return false;
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

  // 把屬性石加進背包（同 itemId 堆疊）。結構比照 _grantGems，差別是多帶 element 給前端徽章用。
  async _grantElementStones(progress, element, count) {
    if (!count || count <= 0) return;
    const stoneId = ELEMENT_STONE_ID_BY_ELEMENT[element];
    if (!stoneId) return;
    if (!Array.isArray(progress.inventory)) progress.inventory = [];
    const existing = progress.inventory.find((e) => e && e.itemId === stoneId);
    if (existing) {
      existing.stackCount = (existing.stackCount || 1) + count;
      return;
    }
    let stoneItem = null;
    try { stoneItem = await this.itemRepository.findById(stoneId); } catch (_) {}
    const name = stoneItem?.name || `${element}屬性石`;
    progress.inventory.push({
      uuid: crypto.randomUUID(),
      itemId: stoneId,
      itemName: name,
      itemEffect: stoneItem?.effect || { type: "none", value: 0 },
      useEffects: [], passiveEffects: [], procEffects: [], combatEffects: [],
      itemType: "consumable",
      imageUrl: stoneItem?.imageUrl || null,
      imageThumbnailUrl: stoneItem?.imageThumbnailUrl || null,
      equipSlot: null, equipStats: null, weaponType: null, isTwoHanded: false, atkStat: null,
      tier: null, enhanceLevel: 0, stackCount: count,
      element,                                   // 讓背包直接顯示屬性徽章
      sellPrice: stoneItem?.sellPrice ?? 500,    // 帶著走，避免售價回退去查 tier
      source: "dismantle", grantedAt: new Date().toISOString(),
      name,
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

    const _nowTs = new Date().toISOString();
    const current = progress.equipment[slot] || null;
    if (current) current.unequippedAt = _nowTs;   // 被換下的裝備：記脫下時間（換裝排序用）
    freshEntry.equippedAt = _nowTs;                // 換上的裝備：記穿上時間
    progress.inventory.splice(idx, 1);
    if (current) progress.inventory.push(current);
    progress.equipment[slot] = freshEntry;
    progress.updatedAt = new Date().toISOString();
    await this.progressRepository.save(progress);
    if (this.questService) {
      // await:確保「裝備任一裝備」任務進度先寫入,新手引導刷新時才會立刻看到完成
      try { await this.questService.recordProgress(discordId, "equip_count", 1); } catch (e) {}
    }
    return {
      itemName: entry.itemName,
      slot,
      equipment: progress.equipment,
      inventory: progress.inventory
    };
  }

  async unequipItem(discordId, slot) {
    const VALID_SLOTS = ["head_top","head_mid","head_low","armor","weapon","shield","garment","shoes","accessory_l","accessory_r","title_eq","job_eq","special_1","special_2","special_3","anchor"];
    if (!VALID_SLOTS.includes(slot)) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "無效槽位", 400);
    const progress = await this.progressRepository.findByPlayerId(discordId);
    if (!progress) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到資料", 404);
    const equipped = progress.equipment?.[slot];
    if (!equipped) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "此槽位沒有裝備", 404);
    if (!Array.isArray(progress.inventory)) progress.inventory = [];
    equipped.unequippedAt = new Date().toISOString();   // 記脫下時間（換裝排序用）
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
    const ALL_SLOTS = ["head_top","head_mid","head_low","armor","weapon","shield","garment","shoes","accessory_l","accessory_r","title_eq","job_eq","special_1","special_2","special_3","anchor"];

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

  // 把目前身上的裝備存成指定分頁（不換裝、不動 inventory），純快照
  async saveEquipPreset(discordId, targetPreset) {
    const VALID_PRESETS = ["A", "B", "C"];
    if (!VALID_PRESETS.includes(targetPreset)) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "無效分頁，請選擇 A / B / C", 400);
    }
    const progress = await this.progressRepository.findByPlayerId(discordId);
    if (!progress) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到資料", 404);
    if (!progress.equipPresets) progress.equipPresets = {};
    progress.equipPresets[targetPreset] = this._snapshotEquipment(progress.equipment || {});
    progress.updatedAt = new Date().toISOString();
    await this.progressRepository.save(progress);
    return { preset: targetPreset, snapshot: progress.equipPresets[targetPreset] };
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
    if (target.equipSlot === "special" || target.equipSlot === "job_eq" || target.equipSlot === "title_eq" || target.equipSlot === "anchor") throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "此槽位裝備無法強化", 400);
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
      // A 裝(材料強化)成功到 +5 → 記錄賽季任務「千錘百鍊」進度
      if (tier === "A" && newLevel === 5) {
        this.questService.recordProgress(discordId, "enhance_a5_count", 1).catch(() => {});
      }
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

module.exports = {
  ShopService, isGemEntry, DISMANTLE_YIELD, DISMANTLE_SUCCESS_RATE,
  ELEMENT_STONE_RATE_BY_TIER, getElementStoneRate,
};
