const { assertEquipmentAvailable } = require("../../shared/equipmentAvailability");
"use strict";

const crypto = require("crypto");
const { withPlayerProgressLock } = require("../progress/progressLocks");
const { AppError, ERROR_CODES } = require("../../shared/errors");
const { notifyPlayer } = require("../realtime/playerNotifyService");
const { auctionRepository } = require("./auctionRepository");
const { createTransactionLog } = require("../../domain/transaction/createTransactionLog");
const { CURRENCY_SOURCES } = require("../../shared/sources");
const { isBoundItemId } = require("../../shared/boundItems");
const { MAX_PETS } = require("../pet/petService");

// 強化寶石 itemId 集合
const ENHANCE_GEM_IDS = new Set([
  '72fde92d-e33f-42fb-8d86-2e811d03f84d', // D
  '556db9e1-b084-4b22-bab5-a66c2b586184', // C
  '8fdfa7d9-f0fa-4e6a-a291-703b1e354072', // B
  'a6ae293d-52fc-4af5-8770-891ddf842e35'  // A
]);
// 屬性石 itemId 集合（scripts/seed-element-stones.js 建立的固定 id）
// 併入 isGem 判定：可堆疊、可上架，走跟強化寶石同一套「疊加歸還」邏輯（見 isGem 相關程式碼），
// 不另外寫一套——玩家角度屬性石本來就是寶石分類的一種。
const ELEMENT_STONE_IDS = new Set([
  "element-stone-water", "element-stone-fire", "element-stone-wood",
  "element-stone-earth", "element-stone-metal", "element-stone-sun", "element-stone-moon"
]);

const ALLOWED_HOURS = [1, 6, 12, 24];
const AUCTION_TAX_RATE = 0.10; // 拍賣手續費：金幣交易抽 10%（鑽石不抽）
const GOLD_MIN = 5000;
const GOLD_MAX = 10_000_000;
const DIAMOND_MIN = 1;
const DIAMOND_MAX = 200_000;
const TIER_RANKS = ["E", "D", "C", "B", "A", "S", "SS"];
const MAX_LISTINGS_BY_TIER = { E: 0, D: 0, C: 5, B: 7, A: 10, S: 10, SS: 10 };
const DEFAULT_MAX_LISTINGS = 5;
const FORBIDDEN_EQUIP_SLOTS = new Set(["job_eq", "title_eq"]);
const FORBIDDEN_ITEM_TYPES = new Set(["job_badge", "title"]);

// 狼系寵物戰鬥加成 → 中文摘要（上架時算好給買家看；與 petService._combatSummary 同義）
function summarizePetCombat(combatPassives) {
  if (!Array.isArray(combatPassives) || !combatPassives.length) return null;
  const LABEL = {
    atk_up: "攻擊", final_damage_up: "最終傷害", crit_rate_up: "爆擊率", combo_up: "連擊率",
    dodge_up: "迴避", physical_damage_reduction: "物理減傷", magic_damage_reduction: "魔法減傷",
  };
  const parts = [];
  for (const e of combatPassives) {
    if (e.key === "echo_strike") parts.push(`${e.params?.chance || 0}% 咬擊追打（${e.params?.value || 0}%）`);
    else if (LABEL[e.key]) parts.push(`${LABEL[e.key]} +${e.params?.value || 0}${/reduction|final_damage|atk_up/.test(e.key) ? "%" : ""}`);
  }
  return parts.length ? parts.join("、") : null;
}

class AuctionService {
  constructor(progressRepository, walletRepository, playerTierService, transactionRepository) {
    this.progressRepository = progressRepository;
    this.walletRepository = walletRepository;
    this.playerTierService = playerTierService;
    this.transactionRepository = transactionRepository;
  }

  // ─────────────────────────────────────────────
  //  設定
  // ─────────────────────────────────────────────
  async getSettings() {
    return auctionRepository.getSettings();
  }

  async saveSettings(settings) {
    return auctionRepository.saveSettings(settings);
  }

  // ─────────────────────────────────────────────
  //  上架
  // ─────────────────────────────────────────────
  /**
   * 確認玩家是否有上架資格（從後台設定讀取允許的 Tier）
   * @param {string[]} memberRoleIds  Discord member 的 roleIds
   */
  async checkSellerEligibility(memberRoleIds) {
    const settings = await auctionRepository.getSettings();
    const allowedTiers = Array.isArray(settings.sellerTiers) && settings.sellerTiers.length > 0
      ? settings.sellerTiers
      : ["C", "B", "A", "S", "SS"];

    const highestTier = await this.playerTierService.resolveHighestTier(memberRoleIds);
    if (!highestTier) return false;
    return allowedTiers.includes(highestTier);
  }

  /**
   * 確認拍賣場是否開啟
   */
  async isEnabled() {
    const settings = await auctionRepository.getSettings();
    return settings.enabled !== false;
  }

  /**
   * 取得賣家目前的上架件數
   */
  async getActiveListingCount(sellerId) {
    const { getMongoDb } = require("../../adapters/mongo/createMongoClient");
    const db = await getMongoDb();
    return db.collection("auctions").countDocuments({ sellerId, status: { $in: ["active", "escrowing"] } });
  }

  /**
   * 上架物品
   * @param {object} opts
   * @param {string} opts.sellerId
   * @param {string} opts.itemUuid   背包中的 uuid
   * @param {string} opts.currency   "gold" | "diamond"
   * @param {number} opts.price
   * @param {number} opts.hours      1 | 6 | 12 | 24
   */
  async getMaxListings(memberRoleIds = []) {
    const highestTier = await this.playerTierService.resolveHighestTier(memberRoleIds);
    return MAX_LISTINGS_BY_TIER[highestTier] ?? DEFAULT_MAX_LISTINGS;
  }

  async listItem(input) { return withPlayerProgressLock(input.sellerId, () => this._listItem(input)); }
  async _listItem({ sellerId, itemUuid, currency, price, hours, quantity = 1, memberRoleIds = [] }) {
    // 檢查拍賣場是否開啟
    if (!await this.isEnabled()) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "拍賣場目前已關閉", 400);
    }

    // 驗證貨幣
    if (!["gold", "diamond"].includes(currency)) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "貨幣類型無效", 400);
    }

    // 價格正規化:必須是有限正整數。擋 NaN / 小數 / 字串,
    // 否則 `Number("abc")=NaN` 會繞過下面的範圍比較(NaN 比較恆為 false),
    // 上架 NaN 價後買家扣款會把錢包寫成 NaN、污染餘額。
    price = Number(price);
    if (!Number.isSafeInteger(price) || price <= 0) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "定價必須是正整數", 400);
    }

    // 驗證價格範圍
    if (currency === "gold") {
      if (price < GOLD_MIN || price > GOLD_MAX) {
        throw new AppError(ERROR_CODES.INVALID_ARGUMENT, `金幣定價範圍：${GOLD_MIN.toLocaleString()} ～ ${GOLD_MAX.toLocaleString()}`, 400);
      }
    } else {
      if (price < DIAMOND_MIN || price > DIAMOND_MAX) {
        throw new AppError(ERROR_CODES.INVALID_ARGUMENT, `鑽石定價範圍：${DIAMOND_MIN} ～ ${DIAMOND_MAX.toLocaleString()}`, 400);
      }
    }

    // 驗證時間
    if (!ALLOWED_HOURS.includes(hours)) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "上架時間只能選 1、6、12、24 小時", 400);
    }

    // 已有上架中的商品
    const activeCount = await this.getActiveListingCount(sellerId);
    const maxListings = await this.getMaxListings(memberRoleIds);
    if (activeCount >= maxListings) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, `你目前已有上架中的商品，最多同時上架 ${maxListings} 件`, 400);
    }

    // 從背包取出物品
    const progress = await this.progressRepository.findByPlayerId(sellerId);
    if (!progress) throw new AppError(ERROR_CODES.PLAYER_NOT_FOUND, "玩家資料不存在", 404);

    const inventory = Array.isArray(progress.inventory) ? progress.inventory : [];
    const itemIdx = inventory.findIndex(i => i.uuid === itemUuid);
    if (itemIdx === -1) {
      throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到該物品", 404);
    }

    const item = inventory[itemIdx];
    if (item.locked) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "此裝備已鎖定，請先解鎖再上架", 400);
    assertEquipmentAvailable(item);

    // 只允許上架裝備 / 卡片 / 強化寶石 / 屬性石 / 寵物蛋，且禁止職業徽章/稱號
    const isGem = ENHANCE_GEM_IDS.has(item.itemId) || ELEMENT_STONE_IDS.has(item.itemId);
    const isPetEgg = item.itemType === "pet_egg";
    const isStackable = isGem || isPetEgg; // 可堆疊上架的類型
    if (FORBIDDEN_ITEM_TYPES.has(item.itemType) || FORBIDDEN_EQUIP_SLOTS.has(item.equipSlot)) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "職業徽章與稱號不可上架", 400);
    }
    if (isBoundItemId(item.itemId)) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "此物品為靈魂綁定，無法上架交易", 400);
    }
    if (item.itemType !== "equipment" && item.itemType !== "monster_card" && !isGem && !isPetEgg) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "只有裝備、卡片、強化寶石與寵物蛋可以上架", 400);
    }

    const safeQuantity = Number(quantity);
    if (!Number.isSafeInteger(safeQuantity) || safeQuantity <= 0) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "上架數量必須是正整數", 400);
    }

    // 可堆疊（寶石 / 寵物蛋）：從 stackCount 扣指定數量；其他裝備固定 1 件
    let stackSnap = null;
    if (isStackable) {
      const curStack = Math.max(1, item.stackCount || 1);
      if (safeQuantity > curStack) {
        throw new AppError(ERROR_CODES.INVALID_ARGUMENT, `可上架數量不足（目前持有 ${curStack}）`, 400);
      }
      stackSnap = safeQuantity;
      if (curStack > safeQuantity) {
        item.stackCount = curStack - safeQuantity;
      } else {
        inventory.splice(itemIdx, 1);
      }
    } else {
      if (safeQuantity !== 1) {
        throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "裝備每次只能上架 1 件", 400);
      }
      inventory.splice(itemIdx, 1);
    }

    // 儲存背包變更
    progress.inventory = inventory;

    // 建立拍賣
    const now = new Date();
    const expiresAt = new Date(now.getTime() + hours * 3600 * 1000).toISOString();

    const auction = {
      id: crypto.randomUUID(),
      sellerId,
      item: {
        ...item,
        isGem,
        stackCount: stackSnap ?? (item.stackCount ?? undefined)
      },
      currency,
      price,
      hours,
      status: "escrowing",   // 先留託管收據，背包CAS完成才上架
      createdAt: now.toISOString(),
      expiresAt,
      updatedAt: now.toISOString()
    };

    await auctionRepository.create(auction);
    await this._finishEscrow(auction);
    return { ...auction, status: "active" };
  }

  // 把拍賣快照的寵物還原到某玩家的 pets[]（買家成交 / 賣家領回 / 下架共用）
  _restorePetToInventory(progress, petSnap, source) {
    if (!Array.isArray(progress.pets)) progress.pets = [];
    const clone = { ...petSnap };
    delete clone.__pet; delete clone.isGem; delete clone.itemName;
    clone.uuid = crypto.randomUUID();
    clone.tradeSource = source;
    progress.pets.push(clone);
  }

  // ─────────────────────────────────────────────
  //  上架「已孵化的寵物」（從 progress.pets[] 託管；蛋仍走 listItem 背包路線）
  // ─────────────────────────────────────────────
  async listPet(input) { return withPlayerProgressLock(input.sellerId, () => this._listPet(input)); }
  async _listPet({ sellerId, petUuid, currency, price, hours, memberRoleIds = [] }) {
    if (!await this.isEnabled()) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "拍賣場目前已關閉", 400);
    if (!["gold", "diamond"].includes(currency)) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "貨幣類型無效", 400);
    price = Number(price);
    if (!Number.isSafeInteger(price) || price <= 0) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "定價必須是正整數", 400);
    if (currency === "gold" && (price < GOLD_MIN || price > GOLD_MAX)) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, `金幣定價範圍：${GOLD_MIN.toLocaleString()} ～ ${GOLD_MAX.toLocaleString()}`, 400);
    if (currency === "diamond" && (price < DIAMOND_MIN || price > DIAMOND_MAX)) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, `鑽石定價範圍：${DIAMOND_MIN} ～ ${DIAMOND_MAX.toLocaleString()}`, 400);
    if (!ALLOWED_HOURS.includes(hours)) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "上架時間只能選 1、6、12、24 小時", 400);

    const activeCount = await this.getActiveListingCount(sellerId);
    const maxListings = await this.getMaxListings(memberRoleIds);
    if (activeCount >= maxListings) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, `你目前已有上架中的商品，最多同時上架 ${maxListings} 件`, 400);

    const progress = await this.progressRepository.findByPlayerId(sellerId);
    if (!progress) throw new AppError(ERROR_CODES.PLAYER_NOT_FOUND, "玩家資料不存在", 404);
    const pets = Array.isArray(progress.pets) ? progress.pets : [];
    const pIdx = pets.findIndex((p) => p && p.uuid === petUuid);
    if (pIdx === -1) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到該寵物", 404);
    const pet = pets[pIdx];
    if (pet.stage !== "grown") throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "蛋還沒孵化，不能上架（未孵化的蛋可從背包上架）", 400);
    // 出戰中的寵物上架：自動取消出戰（託管即離場），玩家不必先手動切換。
    if (progress.activePetUuid === petUuid) progress.activePetUuid = null;

    // 託管：從 pets[] 移除
    pets.splice(pIdx, 1);
    progress.pets = pets;

    const petName = pet.nickname || pet.speciesName || "寵物";
    const now = new Date();
    const auction = {
      id: crypto.randomUUID(),
      sellerId,
      item: {
        ...pet,
        __pet: true,
        itemType: "pet",
        itemName: petName,
        tier: pet.rarity || null,
        eggType: pet.eggType || "dragon",
        combatBonus: summarizePetCombat(pet.combatPassives), // 買家看得到的戰鬥加成摘要
        imageUrl: pet.imageUrl || null,
        imageThumbnailUrl: pet.imageThumbnailUrl || null,
      },
      currency, price, hours,
      status: "escrowing",
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + hours * 3600 * 1000).toISOString(),
      updatedAt: now.toISOString(),
    };
    await auctionRepository.create(auction);
    await this._finishEscrow(auction);
    return { ...auction, status: "active" };
  }

  // ─────────────────────────────────────────────
  //  購買
  // ─────────────────────────────────────────────
  /**
   * 購買拍賣物品
   * @param {string} buyerId
   * @param {string} auctionId
   */
  async _finishEscrow(auction) {
    for (let retry = 0; retry < 8; retry++) {
      const p = await this.progressRepository.findByPlayerId(auction.sellerId);
      if (!p) throw new AppError(ERROR_CODES.PLAYER_NOT_FOUND, "找不到託管人物", 404);
      if ((p.auctionEscrowReceipts || []).includes(auction.id)) break;
      const next = structuredClone(p), pet = auction.item.__pet;
      const list = pet ? (next.pets || []) : (next.inventory || []);
      const index = list.findIndex(x => x.uuid === auction.item.uuid);
      if (index < 0) throw new Error("找不到待託管道具，保留收據等待原人物恢復");
      if (!pet && (auction.item.isGem || auction.item.itemType === "pet_egg")) {
        const amount = Number(auction.item.stackCount) || 1, owned = Number(list[index].stackCount) || 1;
        if (owned < amount) throw new Error("待託管數量不足");
        if (owned === amount) list.splice(index, 1); else list[index].stackCount = owned - amount;
      } else list.splice(index, 1);
      if (pet && next.activePetUuid === auction.item.uuid) next.activePetUuid = null;
      next.auctionEscrowReceipts = [...(p.auctionEscrowReceipts || []), auction.id];
      next.updatedAt = new Date(Math.max(Date.now(), (Date.parse(p.updatedAt) || 0) + 1)).toISOString();
      if (await this.progressRepository.saveIfUnchanged(next, p.updatedAt)) break;
      if (retry === 7) throw new Error("拍賣託管儲存忙碌，等待恢復");
    }
    await auctionRepository.updateStatus(auction.id, "active");
  }

  async buyItem(buyerId, auctionId) {
    // 同一商品序列化；持久收據負責跨重啟重試，錢包使用原子扣款。
    return withPlayerProgressLock(`auction:${auctionId}`, () => this._buyItem(buyerId, auctionId));
  }

  async _buyItem(buyerId, auctionId) {
    if (!await this.isEnabled()) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "拍賣場目前已關閉", 400);
    let auction = await auctionRepository.findById(auctionId);
    if (!auction) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到該拍賣商品", 404);
    assertEquipmentAvailable(auction.item);
    if (auction.sellerId === buyerId) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "不能購買自己的商品", 400);
    if (auction.status === "sold" && auction.buyerId === buyerId) return { auction, itemName: auction.item.itemName };
    const resuming = auction.status === "settling" && auction.buyerId === buyerId;
    if (auction.status !== "active" && !resuming) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "此商品已售出或到期", 400);
    if (!resuming && auction.expiresAt <= new Date().toISOString()) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "此商品已到期", 400);
    const buyerProgress = await this.progressRepository.findByPlayerId(buyerId);
    const sellerWallet = await this.walletRepository.findByPlayerId(auction.sellerId);
    const buyerWallet = await this.walletRepository.findByPlayerId(buyerId);
    if (!buyerProgress || !sellerWallet || !buyerWallet) throw new AppError(ERROR_CODES.PLAYER_NOT_FOUND, "交易人物或錢包不存在", 404);
    if (!resuming && auction.item.__pet && (buyerProgress.pets || []).length >= MAX_PETS) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "寵物欄位已滿", 400);
    if (!resuming && (buyerWallet[auction.currency] || 0) < auction.price) throw new AppError(ERROR_CODES.INSUFFICIENT_BALANCE, "餘額不足", 400);
    if (!this.transactionRepository?.grantCurrencyAtomic) throw new Error("拍賣需要原子貨幣結算服務");
    const tradeAttempt = resuming ? auction.tradeAttempt : crypto.randomUUID();
    if (!resuming && !await auctionRepository.claimIfActive(auctionId, "settling", { buyerId, tradeAttempt })) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "此商品已被買走", 400);
    const tax = auction.currency === "gold" ? Math.floor(auction.price * AUCTION_TAX_RATE) : 0;
    const sellerNet = auction.price - tax;
    // 發貨中斷時保持 settling，原買家可重試，不重新上架已扣款商品。
    try {
      await this.transactionRepository.grantCurrencyAtomic({ playerId: buyerId, currencyType: auction.currency, amount: -auction.price,
        source: CURRENCY_SOURCES.AUCTION_PURCHASE, sourceRef: `auction:${auctionId}:${tradeAttempt}:buyer`, operator: "system:auction" });
    } catch (error) {
      if (error.code === ERROR_CODES.INSUFFICIENT_BALANCE || error.code === "INSUFFICIENT_BALANCE") await auctionRepository.updateStatus(auctionId, "active", { buyerId: null });
      throw error;
    }
    await this.transactionRepository.grantCurrencyAtomic({ playerId: auction.sellerId, currencyType: auction.currency, amount: sellerNet,
      source: CURRENCY_SOURCES.AUCTION_SALE, sourceRef: `auction:${auctionId}:seller`, operator: "system:auction" });
    await withPlayerProgressLock(buyerId, async () => {
      for (let retry = 0; retry < 8; retry++) {
        const progress = await this.progressRepository.findByPlayerId(buyerId);
        if ((progress.auctionReceipts || []).includes(auctionId)) return;
        const next = structuredClone(progress);
        if (auction.item.__pet) this._restorePetToInventory(next, auction.item, "auction_buy");
        else {
          const entry = { ...auction.item, uuid: crypto.randomUUID(), source: "auction_buy" };
          next.inventory ||= [];
          const stackable = entry.isGem || entry.itemType === "pet_egg";
          const existing = stackable && next.inventory.find(x => x.itemId === entry.itemId);
          if (existing) existing.stackCount = (Number(existing.stackCount) || 1) + (Number(entry.stackCount) || 1);
          else { delete entry.isGem; if (!stackable) { try { require("../enchant/enchantService").rollForEntry(entry); } catch (_) {} } next.inventory.push(entry); }
        }
        next.auctionReceipts = [...(progress.auctionReceipts || []), auctionId];
        next.updatedAt = new Date(Math.max(Date.now(), (Date.parse(progress.updatedAt) || 0) + 1)).toISOString();
        if (await this.progressRepository.saveIfUnchanged(next, progress.updatedAt)) return;
      }
      throw new Error("交易背包儲存忙碌，請重試原商品");
    });
    await auctionRepository.updateStatus(auctionId, "sold", { buyerId, soldAt: new Date().toISOString() });
    notifyPlayer(auction.sellerId, { type: "auction_sold", title: "拍賣售出", message: `「${auction.item.itemName}」已售出，實得 ${sellerNet} ${auction.currency === "gold" ? "金幣" : "鑽石"}。`, meta: { auctionId, buyerId, tax, net: sellerNet } });
    auction = await auctionRepository.findById(auctionId);
    return { auction, itemName: auction.item.itemName };
  }

  // ─────────────────────────────────────────────
  //  到期處理（定時任務呼叫）
  // ─────────────────────────────────────────────
  async recoverPending() {
    return withPlayerProgressLock("auction:recovery", async () => {
      const { getMongoDb } = require("../../adapters/mongo/createMongoClient");
      const db = await getMongoDb();
      const pending = await db.collection("auctions").find({ status: { $in: ["escrowing", "settling", "returning"] } }).sort({ updatedAt: 1 }).limit(100).toArray();
      let recovered = 0;
      for (const listing of pending) {
        try {
          if (listing.status === "escrowing") await withPlayerProgressLock(listing.sellerId, () => this._finishEscrow(listing));
          else if (listing.status === "settling") await this.buyItem(listing.buyerId, listing.id);
          else await this._returnAuction(listing.sellerId, listing.id, listing.cancelledBySeller === true);
          recovered++;
        } catch (e) { console.warn(`[auction] pending ${listing.id}: ${e.message}`); }
      }
      return recovered;
    });
  }

  async processExpired() {
    await this.recoverPending();
    const expired = await auctionRepository.findExpiredActive();
    for (const auction of expired) {
      if (!await auctionRepository.claimIfActive(auction.id, "expired")) continue;
      // 通知賣家：拍賣到期未售出（物品需到拍賣行領回）
      notifyPlayer(auction.sellerId, {
        type: "auction_expired",
        title: "拍賣到期",
        message: `你的「${auction.item?.itemName || "商品"}」拍賣已到期未售出，請到拍賣行領回。`,
        meta: { auctionId: auction.id, itemName: auction.item?.itemName || null }
      });
    }
    return expired.length;
  }

  // ─────────────────────────────────────────────
  //  領回（賣家）
  // ─────────────────────────────────────────────
  /**
   * 賣家領回到期未售的物品
   */
  async reclaimItem(sellerId, auctionId) { return this._returnAuction(sellerId, auctionId, false); }
  async cancelListing(sellerId, auctionId) { return this._returnAuction(sellerId, auctionId, true); }
  async _returnAuction(sellerId, auctionId, cancel) {
    return withPlayerProgressLock(`auction:${auctionId}`, async () => {
      const { getMongoDb } = require("../../adapters/mongo/createMongoClient");
      const db = await getMongoDb(), col = db.collection("auctions");
      let auction = await auctionRepository.findById(auctionId);
      if (!auction || auction.sellerId !== sellerId) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "找不到自己的拍賣商品", 403);
      if (auction.status === "reclaimed") return { itemName: auction.item.itemName };
      const expected = cancel ? "active" : "expired";
      if (auction.status !== "returning") {
        const won = await col.updateOne({ id: auctionId, sellerId, status: expected }, { $set: { status: "returning", cancelledBySeller: cancel } });
        if (!won.modifiedCount) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "商品狀態已改變，不能領回", 400);
      }
      await withPlayerProgressLock(sellerId, async () => {
        const receipt = `return:${auctionId}`;
        for (let retry = 0; retry < 8; retry++) {
          const progress = await this.progressRepository.findByPlayerId(sellerId);
          if (!progress) throw new AppError(ERROR_CODES.PLAYER_NOT_FOUND, "找不到玩家", 404);
          if ((progress.auctionReceipts || []).includes(receipt)) return;
          const next = structuredClone(progress), entry = { ...auction.item, uuid: crypto.randomUUID(), source: "auction_return" };
          if (entry.__pet) this._restorePetToInventory(next, entry, "auction_return");
          else {
            next.inventory ||= [];
            const existing = (entry.isGem || entry.itemType === "pet_egg") && next.inventory.find(x => x.itemId === entry.itemId);
            if (existing) existing.stackCount = (Number(existing.stackCount) || 1) + (Number(entry.stackCount) || 1);
            else { delete entry.isGem; next.inventory.push(entry); }
          }
          next.auctionReceipts = [...(progress.auctionReceipts || []), receipt];
          next.updatedAt = new Date(Math.max(Date.now(), (Date.parse(progress.updatedAt) || 0) + 1)).toISOString();
          if (await this.progressRepository.saveIfUnchanged(next, progress.updatedAt)) return;
        }
        throw new Error("領回背包儲存忙碌，請重試");
      });
      await auctionRepository.updateStatus(auctionId, "reclaimed", { reclaimedAt: new Date().toISOString() });
      return { itemName: auction.item.itemName };
    });
  }

  // ─────────────────────────────────────────────
  //  查詢
  // ─────────────────────────────────────────────
  async getActiveListings(filters = {}) {
    await this.recoverPending();
    return auctionRepository.findActive(filters);
  }

  async getMyListings(sellerId) {
    await this.recoverPending();
    return auctionRepository.findBySeller(sellerId);
  }

  async getMyHistory(sellerId) {
    await this.recoverPending();
    return auctionRepository.findAllBySeller(sellerId);
  }

  // 向下相容
  async getChannelConfig() { return auctionRepository.getSettings(); }
  async saveChannelConfig(cfg) {
    const current = await auctionRepository.getSettings();
    return auctionRepository.saveSettings({
      ...current,
      ...(cfg || {})
    });
  }

  // 管理後台
  async adminGetAll(opts) {
    return auctionRepository.findAll(opts);
  }

  async adminForceRemove(auctionId, adminId) {
    const auction = await auctionRepository.findById(auctionId);
    if (!auction) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到該拍賣", 404);

    // 若還是 active，退回物品給賣家
    if (auction.status === "active" || auction.status === "expired") {
      await this.reclaimItemAsAdmin(auction);
    }
    await auctionRepository.updateStatus(auctionId, "removed", { removedBy: adminId });
    return auction;
  }

  async reclaimItemAsAdmin(auction) {
    try {
      const progress = await this.progressRepository.findByPlayerId(auction.sellerId);
      if (!progress) return;
      progress.inventory = progress.inventory || [];
      const itemToReturn = { ...auction.item, source: "auction_admin_remove" };
      if (itemToReturn.isGem && itemToReturn.itemId) {
        const listedCount = Math.max(1, itemToReturn.stackCount || 1);
        const existingGem = progress.inventory.find(i => i.itemId === itemToReturn.itemId);
        if (existingGem) {
          existingGem.stackCount = Math.max(1, existingGem.stackCount || 1) + listedCount;
        } else {
          itemToReturn.uuid = crypto.randomUUID();
          itemToReturn.stackCount = listedCount;
          delete itemToReturn.isGem;
          progress.inventory.push(itemToReturn);
        }
      } else {
        itemToReturn.uuid = crypto.randomUUID();
        delete itemToReturn.isGem;
        progress.inventory.push(itemToReturn);
      }
      await this.progressRepository.save(progress);
    } catch (_) {}
  }
}

module.exports = { AuctionService, ENHANCE_GEM_IDS, GOLD_MIN, GOLD_MAX, DIAMOND_MIN, DIAMOND_MAX, ALLOWED_HOURS };
