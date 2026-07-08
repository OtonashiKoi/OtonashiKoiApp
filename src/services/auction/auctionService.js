"use strict";

const crypto = require("crypto");
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

const ALLOWED_HOURS = [1, 6, 12, 24];
const AUCTION_TAX_RATE = 0.10; // 拍賣手續費：金幣交易抽 10%（鑽石不抽）
const GOLD_MIN = 5000;
const GOLD_MAX = 10_000_000;
const DIAMOND_MIN = 1;
const DIAMOND_MAX = 200_000;
const TIER_RANKS = ["E", "D", "C", "B", "A", "S", "SS"];
const MAX_LISTINGS_BY_TIER = { E: 0, D: 0, C: 3, B: 5, A: 7, S: 7, SS: 7 };
const DEFAULT_MAX_LISTINGS = 3;
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
  async getMaxListings(memberRoleIds = []) {
    const highestTier = await this.playerTierService.resolveHighestTier(memberRoleIds);
    return MAX_LISTINGS_BY_TIER[highestTier] ?? DEFAULT_MAX_LISTINGS;
  }

  async listItem({ sellerId, itemUuid, currency, price, hours, quantity = 1, memberRoleIds = [] }) {
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
    price = Math.floor(Number(price));
    if (!Number.isFinite(price) || price <= 0) {
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

    // 只允許上架裝備 / 卡片 / 強化寶石 / 寵物蛋，且禁止職業徽章/稱號
    const isGem = ENHANCE_GEM_IDS.has(item.itemId);
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

    const safeQuantity = Number.isInteger(quantity) ? quantity : parseInt(quantity, 10);
    if (!Number.isFinite(safeQuantity) || safeQuantity <= 0) {
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
  async listPet({ sellerId, petUuid, currency, price, hours, memberRoleIds = [] }) {
    if (!await this.isEnabled()) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "拍賣場目前已關閉", 400);
    if (!["gold", "diamond"].includes(currency)) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "貨幣類型無效", 400);
    price = Math.floor(Number(price));
    if (!Number.isFinite(price) || price <= 0) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "定價必須是正整數", 400);
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
    await this.progressRepository.save(progress);

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
      status: "active",
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + hours * 3600 * 1000).toISOString(),
      updatedAt: now.toISOString(),
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

    // 寵物商品：扣款前先擋「買家寵物已滿」，避免付了錢卻收不到
    if (auction.item?.__pet) {
      const bp = await this.progressRepository.findByPlayerId(buyerId);
      if (bp && Array.isArray(bp.pets) && bp.pets.length >= MAX_PETS) {
        throw new AppError(ERROR_CODES.INVALID_ARGUMENT, `你的寵物已達上限 ${MAX_PETS} 隻，請先放生或上架一隻再購買`, 400);
      }
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

    // ── 原子搶單(防購買競態複製)：只有搶到「active→sold」的請求才能繼續扣款發貨 ──
    const claimed = await auctionRepository.claimIfActive(auctionId, "sold", {
      buyerId,
      soldAt: new Date().toISOString()
    });
    if (!claimed) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "手腳慢了，此商品剛剛已被買走", 400);
    }

    try {
    await this.walletRepository.save(buyerWallet);
    if (this.transactionRepository) {
      await this.transactionRepository.append(createTransactionLog({
        playerId: buyerId,
        currencyType: auction.currency,
        amount: auction.price,
        direction: "debit",
        source: CURRENCY_SOURCES.AUCTION_PURCHASE,
        sourceRef: auctionId,
        balanceAfter: auction.currency === "gold" ? (buyerWallet.gold || 0) : (buyerWallet.diamond || 0),
        operator: "system:auction"
      }));
    }

    // 賣家收款（抽稅：金幣交易抽 10% 手續費，鑽石不抽 → 回收金幣、抑制通膨）
    const tax = auction.currency === "gold" ? Math.floor(auction.price * AUCTION_TAX_RATE) : 0;
    const sellerNet = auction.price - tax;
    const sellerWallet = await this.walletRepository.findByPlayerId(auction.sellerId);
    if (sellerWallet) {
      if (auction.currency === "gold") {
        sellerWallet.gold = (sellerWallet.gold || 0) + sellerNet;
      } else {
        sellerWallet.diamond = (sellerWallet.diamond || 0) + sellerNet;
      }
      await this.walletRepository.save(sellerWallet);
      if (this.transactionRepository) {
        await this.transactionRepository.append(createTransactionLog({
          playerId: auction.sellerId,
          currencyType: auction.currency,
          amount: sellerNet,
          direction: "credit",
          source: CURRENCY_SOURCES.AUCTION_SALE,
          sourceRef: auctionId,
          balanceAfter: auction.currency === "gold" ? (sellerWallet.gold || 0) : (sellerWallet.diamond || 0),
          operator: "system:auction",
          note: tax > 0 ? `拍賣成交 ${auction.price}，扣手續費 ${tax}（${Math.round(AUCTION_TAX_RATE * 100)}%）` : undefined,
        }));
      }
    }

    // 物品進買家背包
    const buyerProgress = await this.progressRepository.findByPlayerId(buyerId);
    if (!buyerProgress) throw new AppError(ERROR_CODES.PLAYER_NOT_FOUND, "找不到買家進度", 404);

    const itemToGive = { ...auction.item };
    // 寵物：進買家 pets[]（非背包）
    if (auction.item.__pet) {
      this._restorePetToInventory(buyerProgress, auction.item, "auction_buy");
    } else
    // 寶石：嘗試堆疊
    if (itemToGive.isGem && itemToGive.itemId) {
      const listedCount = Math.max(1, itemToGive.stackCount || 1);
      const existingGem = (buyerProgress.inventory || []).find(i => i.itemId === itemToGive.itemId);
      if (existingGem) {
        existingGem.stackCount = Math.max(1, existingGem.stackCount || 1) + listedCount;
      } else {
        itemToGive.uuid = crypto.randomUUID();
        itemToGive.stackCount = listedCount;
        itemToGive.source = "auction_buy";
        buyerProgress.inventory = buyerProgress.inventory || [];
        buyerProgress.inventory.push(itemToGive);
      }
    } else {
      itemToGive.uuid = crypto.randomUUID();
      itemToGive.source = "auction_buy";
      delete itemToGive.isGem;
      // 交易補附魔：若是舊裝備尚無附魔，買家獲得瞬間補骰（已有附魔的保留賣家的）
      try { require("../enchant/enchantService").rollForEntry(itemToGive); } catch (_) { /* noop */ }
      buyerProgress.inventory = buyerProgress.inventory || [];
      buyerProgress.inventory.push(itemToGive);
    }
    await this.progressRepository.save(buyerProgress);
    } catch (err) {
      // 扣款/發貨中途失敗 → 還原成 active，避免「已標記售出卻沒成交」把商品鎖死
      await auctionRepository.updateStatus(auctionId, "active", { buyerId: null, soldAt: null }).catch(() => {});
      throw err;
    }

    // 通知賣家：物品售出（SSE + 輪詢佇列；DC 與網頁購買路徑都會經過這裡）
    const currencyLabel = auction.currency === "gold" ? "金幣" : "鑽石";
    const taxNote = tax > 0 ? `（成交 ${auction.price}，扣手續費 ${tax}）` : "";
    notifyPlayer(auction.sellerId, {
      type: "auction_sold",
      title: "拍賣售出",
      message: `你的「${auction.item.itemName}」已售出，實得 ${sellerNet} ${currencyLabel}${taxNote}。`,
      meta: {
        auctionId,
        itemName: auction.item.itemName,
        currency: auction.currency,
        price: auction.price,
        net: sellerNet,
        tax,
        buyerId
      }
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

    if (itemToReturn.__pet) {
      this._restorePetToInventory(progress, auction.item, "auction_reclaim"); // 寵物回 pets[]（放生上限外，本來就是他的）
    } else if (itemToReturn.isGem && itemToReturn.itemId) {
      const listedCount = Math.max(1, itemToReturn.stackCount || 1);
      const existingGem = progress.inventory.find(i => i.itemId === itemToReturn.itemId);
      if (existingGem) {
        existingGem.stackCount = Math.max(1, existingGem.stackCount || 1) + listedCount;
      } else {
        itemToReturn.uuid = crypto.randomUUID();
        itemToReturn.stackCount = listedCount;
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

  /**
   * 賣家主動下架 still-active 商品（立即退回背包）
   */
  async cancelListing(sellerId, auctionId) {
    const auction = await auctionRepository.findById(auctionId);
    if (!auction) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到該拍賣", 404);
    if (auction.sellerId !== sellerId) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "這不是你的拍賣", 403);
    if (auction.status !== "active") throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "只有上架中的商品可下架", 400);

    const progress = await this.progressRepository.findByPlayerId(sellerId);
    if (!progress) throw new AppError(ERROR_CODES.PLAYER_NOT_FOUND, "玩家資料不存在", 404);

    progress.inventory = progress.inventory || [];
    const itemToReturn = { ...auction.item };

    if (itemToReturn.__pet) {
      this._restorePetToInventory(progress, auction.item, "auction_cancel"); // 寵物回 pets[]
    } else if (itemToReturn.isGem && itemToReturn.itemId) {
      const listedCount = Math.max(1, itemToReturn.stackCount || 1);
      const existingGem = progress.inventory.find(i => i.itemId === itemToReturn.itemId);
      if (existingGem) {
        existingGem.stackCount = Math.max(1, existingGem.stackCount || 1) + listedCount;
      } else {
        itemToReturn.uuid = crypto.randomUUID();
        itemToReturn.stackCount = listedCount;
        itemToReturn.source = "auction_cancel";
        delete itemToReturn.isGem;
        progress.inventory.push(itemToReturn);
      }
    } else {
      itemToReturn.uuid = crypto.randomUUID();
      itemToReturn.source = "auction_cancel";
      delete itemToReturn.isGem;
      progress.inventory.push(itemToReturn);
    }

    await this.progressRepository.save(progress);
    await auctionRepository.updateStatus(auctionId, "reclaimed", {
      reclaimedAt: new Date().toISOString(),
      cancelledBySeller: true
    });

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

  async getMyHistory(sellerId) {
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
