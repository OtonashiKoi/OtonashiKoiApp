"use strict";

const crypto = require("crypto");
const { AppError, ERROR_CODES } = require("../../shared/errors");
const { auctionRepository } = require("./auctionRepository");

// 強化寶石 itemId 集合
const ENHANCE_GEM_IDS = new Set([
  '72fde92d-e33f-42fb-8d86-2e811d03f84d', // D
  '556db9e1-b084-4b22-bab5-a66c2b586184', // C
  '8fdfa7d9-f0fa-4e6a-a291-703b1e354072', // B
  'a6ae293d-52fc-4af5-8770-891ddf842e35'  // A
]);

const ALLOWED_HOURS = [1, 6, 12, 24];
const GOLD_MIN = 5000;
const GOLD_MAX = 10_000_000;
const DIAMOND_MIN = 1;
const DIAMOND_MAX = 200_000;
const TIER_RANKS = ["E", "D", "C", "B", "A", "S", "SS"];

class AuctionService {
  constructor(progressRepository, walletRepository, playerTierService) {
    this.progressRepository = progressRepository;
    this.walletRepository = walletRepository;
    this.playerTierService = playerTierService;
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
    const listings = await auctionRepository.findBySeller(sellerId);
    return listings.filter(l => l.status === "active").length;
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
  async listItem({ sellerId, itemUuid, currency, price, hours }) {
    // 檢查拍賣場是否開啟
    if (!await this.isEnabled()) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "拍賣場目前已關閉", 400);
    }

    // 驗證貨幣
    if (!["gold", "diamond"].includes(currency)) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "貨幣類型無效", 400);
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
    if (activeCount >= 1) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "你目前已有上架中的商品，最多同時上架 1 件", 400);
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

    // 只允許上架裝備或強化寶石
    const isGem = ENHANCE_GEM_IDS.has(item.itemId);
    if (item.itemType !== "equipment" && !isGem) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "只有裝備和強化寶石可以上架", 400);
    }

    // 寶石堆疊：從 stackCount 扣 1
    let stackSnap = null;
    if (isGem) {
      const curStack = Math.max(1, item.stackCount || 1);
      stackSnap = 1; // 每次只上架 1 顆
      if (curStack > 1) {
        item.stackCount = curStack - 1;
      } else {
        inventory.splice(itemIdx, 1);
      }
    } else {
      inventory.splice(itemIdx, 1);
    }

    // 儲存背包變更
    progress.inventory = inventory;
    await this.progressRepository.save(progress);

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
      status: "active",   // active | sold | expired | reclaimed
      createdAt: now.toISOString(),
      expiresAt,
      updatedAt: now.toISOString()
    };

    await auctionRepository.create(auction);
    return auction;
  }

  // ─────────────────────────────────────────────
  //  購買
  // ─────────────────────────────────────────────
  /**
   * 購買拍賣物品
   * @param {string} buyerId
   * @param {string} auctionId
   */
  async buyItem(buyerId, auctionId) {
    if (!await this.isEnabled()) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "拍賣場目前已關閉", 400);
    }

    const auction = await auctionRepository.findById(auctionId);
    if (!auction) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到該拍賣商品", 404);
    if (auction.status !== "active") throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "此商品已售出或到期", 400);
    if (auction.expiresAt <= new Date().toISOString()) {
      // 到期了，順手更新
      await auctionRepository.updateStatus(auctionId, "expired");
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "此商品已到期", 400);
    }
    if (auction.sellerId === buyerId) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "不能購買自己上架的商品", 400);
    }

    // 扣款
    const buyerWallet = await this.walletRepository.findByPlayerId(buyerId);
    if (!buyerWallet) throw new AppError(ERROR_CODES.PLAYER_NOT_FOUND, "找不到買家錢包", 404);

    if (auction.currency === "gold") {
      if ((buyerWallet.gold || 0) < auction.price) {
        throw new AppError(ERROR_CODES.INSUFFICIENT_FUNDS, "金幣不足", 400);
      }
      buyerWallet.gold = (buyerWallet.gold || 0) - auction.price;
    } else {
      if ((buyerWallet.diamond || 0) < auction.price) {
        throw new AppError(ERROR_CODES.INSUFFICIENT_FUNDS, "鑽石不足", 400);
      }
      buyerWallet.diamond = (buyerWallet.diamond || 0) - auction.price;
    }
    await this.walletRepository.save(buyerWallet);

    // 賣家收款
    const sellerWallet = await this.walletRepository.findByPlayerId(auction.sellerId);
    if (sellerWallet) {
      if (auction.currency === "gold") {
        sellerWallet.gold = (sellerWallet.gold || 0) + auction.price;
      } else {
        sellerWallet.diamond = (sellerWallet.diamond || 0) + auction.price;
      }
      await this.walletRepository.save(sellerWallet);
    }

    // 物品進買家背包
    const buyerProgress = await this.progressRepository.findByPlayerId(buyerId);
    if (!buyerProgress) throw new AppError(ERROR_CODES.PLAYER_NOT_FOUND, "找不到買家進度", 404);

    const itemToGive = { ...auction.item };
    // 寶石：嘗試堆疊
    if (itemToGive.isGem && itemToGive.itemId) {
      const existingGem = (buyerProgress.inventory || []).find(i => i.itemId === itemToGive.itemId);
      if (existingGem) {
        existingGem.stackCount = Math.max(1, existingGem.stackCount || 1) + 1;
      } else {
        itemToGive.uuid = crypto.randomUUID();
        itemToGive.stackCount = 1;
        itemToGive.source = "auction_buy";
        buyerProgress.inventory = buyerProgress.inventory || [];
        buyerProgress.inventory.push(itemToGive);
      }
    } else {
      itemToGive.uuid = crypto.randomUUID();
      itemToGive.source = "auction_buy";
      delete itemToGive.isGem;
      buyerProgress.inventory = buyerProgress.inventory || [];
      buyerProgress.inventory.push(itemToGive);
    }
    await this.progressRepository.save(buyerProgress);

    // 更新拍賣狀態
    await auctionRepository.updateStatus(auctionId, "sold", {
      buyerId,
      soldAt: new Date().toISOString()
    });

    return { auction, itemName: auction.item.itemName };
  }

  // ─────────────────────────────────────────────
  //  到期處理（定時任務呼叫）
  // ─────────────────────────────────────────────
  async processExpired() {
    const expired = await auctionRepository.findExpiredActive();
    for (const auction of expired) {
      await auctionRepository.updateStatus(auction.id, "expired");
    }
    return expired.length;
  }

  // ─────────────────────────────────────────────
  //  領回（賣家）
  // ─────────────────────────────────────────────
  /**
   * 賣家領回到期未售的物品
   */
  async reclaimItem(sellerId, auctionId) {
    const auction = await auctionRepository.findById(auctionId);
    if (!auction) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到該拍賣", 404);
    if (auction.sellerId !== sellerId) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "這不是你的拍賣", 403);
    if (auction.status !== "expired") throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "只有到期未售的商品才能領回", 400);

    // 物品退回賣家背包
    const progress = await this.progressRepository.findByPlayerId(sellerId);
    if (!progress) throw new AppError(ERROR_CODES.PLAYER_NOT_FOUND, "玩家資料不存在", 404);

    progress.inventory = progress.inventory || [];
    const itemToReturn = { ...auction.item };

    if (itemToReturn.isGem && itemToReturn.itemId) {
      const existingGem = progress.inventory.find(i => i.itemId === itemToReturn.itemId);
      if (existingGem) {
        existingGem.stackCount = Math.max(1, existingGem.stackCount || 1) + 1;
      } else {
        itemToReturn.uuid = crypto.randomUUID();
        itemToReturn.stackCount = 1;
        itemToReturn.source = "auction_reclaim";
        delete itemToReturn.isGem;
        progress.inventory.push(itemToReturn);
      }
    } else {
      itemToReturn.uuid = crypto.randomUUID();
      itemToReturn.source = "auction_reclaim";
      delete itemToReturn.isGem;
      progress.inventory.push(itemToReturn);
    }

    await this.progressRepository.save(progress);
    await auctionRepository.updateStatus(auctionId, "reclaimed", { reclaimedAt: new Date().toISOString() });

    return { itemName: auction.item.itemName };
  }

  // ─────────────────────────────────────────────
  //  查詢
  // ─────────────────────────────────────────────
  async getActiveListings(filters = {}) {
    return auctionRepository.findActive(filters);
  }

  async getMyListings(sellerId) {
    return auctionRepository.findBySeller(sellerId);
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
      const itemToReturn = { ...auction.item, uuid: crypto.randomUUID(), source: "auction_admin_remove" };
      delete itemToReturn.isGem;
      progress.inventory.push(itemToReturn);
      await this.progressRepository.save(progress);
    } catch (_) {}
  }
}

module.exports = { AuctionService, ENHANCE_GEM_IDS, GOLD_MIN, GOLD_MAX, DIAMOND_MIN, DIAMOND_MAX, ALLOWED_HOURS };
