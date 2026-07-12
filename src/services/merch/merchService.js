"use strict";
/**
 * 周邊（實體商品）服務。
 *   - 品項：與虛擬商店分離（merchItems collection），雙價(現金 TWD / 鑽石)、實體庫存。
 *   - 訂單：merchOrders，含收件資訊(PII) + 付款/出貨狀態。
 *   - 付款兩條路：
 *       diamond → 立即扣鑽、訂單 status=paid。
 *       ecpay   → 建 pending_payment 訂單 + 產 MerchantTradeNo，導去綠界 AioCheckOut；
 *                 綠界付款完成 webhook → confirmEcpayPayment → status=paid。
 */
const crypto = require("crypto");
const { AppError, ERROR_CODES } = require("../../shared/errors");
const { CURRENCY_SOURCES } = require("../../shared/sources");
const { withPlayerProgressLock } = require("../progress/progressLocks");

const ORDER_STATUSES = ["pending_payment", "paid", "shipped", "done", "cancelled"];

function genId() { return crypto.randomUUID(); }
function genOrderNo() {
  // M + 時戳(base36) + 3 碼亂數，人類可讀且唯一
  return `M${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
}
function genMerchantTradeNo() {
  // 綠界 MerchantTradeNo：英數 ≤20 碼、需唯一
  return `OK${Date.now().toString(36)}${crypto.randomBytes(3).toString("hex")}`.slice(0, 20);
}

function normStr(v, max = 200) { return String(v == null ? "" : v).trim().slice(0, max); }

class MerchService {
  constructor(merchItemRepository, merchOrderRepository, walletService, rewardService, playerService) {
    this.merchItemRepository = merchItemRepository;
    this.merchOrderRepository = merchOrderRepository;
    this.walletService = walletService;
    this.rewardService = rewardService;
    this.playerService = playerService;
  }

  // ───────── 品項（後台管理 / 玩家瀏覽）─────────
  async listItems({ includeDisabled = false } = {}) {
    const all = await this.merchItemRepository.findAll();
    return includeDisabled ? all : all.filter((i) => i.enabled !== false);
  }

  async getItem(id) {
    const item = await this.merchItemRepository.findById(id);
    if (!item) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到此周邊商品", 404);
    return item;
  }

  _sanitizeItemFields(f) {
    return {
      name: normStr(f.name, 80) || "未命名周邊",
      description: normStr(f.description, 2000),
      imageUrl: f.imageUrl ? normStr(f.imageUrl, 1000) : null,
      priceTwd: Math.max(0, Math.floor(Number(f.priceTwd) || 0)),          // 0 = 不開放現金
      priceDiamond: Math.max(0, Math.floor(Number(f.priceDiamond) || 0)),  // 0 = 不開放鑽石
      stock: Number(f.stock) === -1 ? -1 : Math.max(0, Math.floor(Number(f.stock) || 0)),
      maxPerOrder: Math.max(1, Math.floor(Number(f.maxPerOrder) || 1)),
      sortOrder: Math.floor(Number(f.sortOrder) || 0),
      enabled: Boolean(f.enabled),
      note: normStr(f.note, 500)
    };
  }

  async createItem(fields) {
    const now = new Date().toISOString();
    const item = { id: genId(), ...this._sanitizeItemFields(fields), createdAt: now, updatedAt: now };
    if (item.priceTwd <= 0 && item.priceDiamond <= 0) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "至少要設定一種價格（現金或鑽石）", 400);
    }
    return this.merchItemRepository.save(item);
  }

  async updateItem(id, fields) {
    const item = await this.getItem(id);
    const merged = { ...item, ...this._sanitizeItemFields({ ...item, ...fields }), id: item.id, createdAt: item.createdAt, updatedAt: new Date().toISOString() };
    if (merged.priceTwd <= 0 && merged.priceDiamond <= 0) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "至少要設定一種價格（現金或鑽石）", 400);
    }
    return this.merchItemRepository.save(merged);
  }

  async deleteItem(id) {
    await this.getItem(id);
    await this.merchItemRepository.delete(id);
    return { deleted: true };
  }

  // ───────── 收件資訊驗證 ─────────
  _validateShipping(shipping) {
    const s = shipping || {};
    const out = {
      name: normStr(s.name, 60),
      phone: normStr(s.phone, 30),
      email: normStr(s.email, 120),
      zip: normStr(s.zip, 10),
      address: normStr(s.address, 300),
      note: normStr(s.note, 300)
    };
    const missing = [];
    if (!out.name) missing.push("姓名");
    if (!out.phone) missing.push("手機");
    if (!out.email) missing.push("Email");
    if (!out.address) missing.push("地址");
    if (missing.length) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, `收件資訊缺少：${missing.join("、")}`, 400);
    if (!/^09\d{8}$/.test(out.phone.replace(/[\s-]/g, "")) && !/^\+?\d{8,15}$/.test(out.phone.replace(/[\s-]/g, ""))) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "手機號碼格式看起來不正確", 400);
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(out.email)) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "Email 格式看起來不正確", 400);
    }
    return out;
  }

  _assertStock(item, qty) {
    if (item.stock !== -1 && item.stock < qty) {
      throw new AppError(ERROR_CODES.ITEM_OUT_OF_STOCK, `庫存不足，目前僅剩 ${item.stock} 件`, 400);
    }
  }

  _baseOrder(discordId, displayName, item, qty, shipping, payMethod, amount, currency) {
    const now = new Date().toISOString();
    return {
      orderNo: genOrderNo(),
      discordId, displayName: normStr(displayName, 80),
      itemId: item.id, itemName: item.name, qty,
      payMethod, amount, currency,
      shipping,
      isGuest: !discordId,
      status: payMethod === "diamond" ? "paid" : "pending_payment",
      ecpay: null, trackingNo: "", adminNote: "",
      createdAt: now, updatedAt: now
    };
  }

  // ───────── 鑽石下單（立即成立）─────────
  async createDiamondOrder(discordId, displayName, itemId, qty, shipping) {
    qty = Math.max(1, Math.min(99, Math.floor(Number(qty) || 1)));
    const item = await this.getItem(itemId);
    if (item.enabled === false) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "此商品目前未開放", 400);
    if (!(item.priceDiamond > 0)) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "此商品未開放鑽石購買", 400);
    if (qty > (item.maxPerOrder || 1)) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, `此商品每筆最多購買 ${item.maxPerOrder} 件`, 400);
    const ship = this._validateShipping(shipping);
    const totalDiamond = item.priceDiamond * qty;

    return withPlayerProgressLock(discordId, async () => {
      // 鎖內重讀庫存 + 餘額，避免併發超賣/超扣
      const fresh = await this.merchItemRepository.findById(itemId);
      if (!fresh) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到此周邊商品", 404);
      this._assertStock(fresh, qty);
      const wallet = await this.walletService.getWalletByDiscordId(discordId, displayName).catch(() => null);
      const owned = Math.max(0, Number(wallet?.wallet?.diamond ?? wallet?.diamond) || 0);
      if (owned < totalDiamond) throw new AppError(ERROR_CODES.INSUFFICIENT_BALANCE, `鑽石不足，需要 ${totalDiamond} 顆，你目前有 ${owned} 顆`, 400);

      const order = this._baseOrder(discordId, displayName, fresh, qty, ship, "diamond", totalDiamond, "diamond");
      // 先扣鑽（原子；不足會擲錯），再扣庫存、存單
      await this.rewardService.grantCurrency({
        discordId, displayName, currencyType: "diamond", amount: -totalDiamond,
        source: CURRENCY_SOURCES.MERCH_PURCHASE, sourceRef: order.orderNo, operator: "merch:diamond"
      });
      if (fresh.stock !== -1) await this.merchItemRepository.save({ ...fresh, stock: Math.max(0, fresh.stock - qty), updatedAt: new Date().toISOString() });
      await this.merchOrderRepository.save(order);
      return order;
    });
  }

  // ───────── 綠界現金下單（建 pending，回結帳參數）─────────
  async createEcpayOrder(discordId, displayName, itemId, qty, shipping, { returnUrl, clientBackUrl, orderResultURL } = {}, ecpayCfg) {
    qty = Math.max(1, Math.min(99, Math.floor(Number(qty) || 1)));
    const item = await this.getItem(itemId);
    if (item.enabled === false) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "此商品目前未開放", 400);
    if (!(item.priceTwd > 0)) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "此商品未開放現金購買", 400);
    if (qty > (item.maxPerOrder || 1)) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, `此商品每筆最多購買 ${item.maxPerOrder} 件`, 400);
    this._assertStock(item, qty);
    const ship = this._validateShipping(shipping);
    const totalTwd = item.priceTwd * qty;

    const order = this._baseOrder(discordId, displayName, item, qty, ship, "ecpay", totalTwd, "twd");
    const merchantTradeNo = genMerchantTradeNo();
    order.ecpay = { merchantTradeNo, tradeNo: null, paidAt: null };
    await this.merchOrderRepository.save(order);

    const { buildAioCheckout } = require("../payment/ecpayCheckout");
    const checkout = buildAioCheckout({
      merchantTradeNo,
      totalAmount: totalTwd,
      itemName: `${item.name} x${qty}`,
      tradeDesc: "otonashikoi merch",
      returnUrl, clientBackUrl, orderResultURL
    }, ecpayCfg);

    return { order, checkout };
  }

  // ───────── 訪客現金下單（免登入，只收現金）─────────
  async createGuestEcpayOrder(itemId, qty, shipping, { returnUrl, clientBackUrl } = {}, ecpayCfg) {
    qty = Math.max(1, Math.min(99, Math.floor(Number(qty) || 1)));
    const item = await this.getItem(itemId);
    if (item.enabled === false) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "此商品目前未開放", 400);
    if (!(item.priceTwd > 0)) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "此商品未開放現金購買", 400);
    if (qty > (item.maxPerOrder || 1)) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, `此商品每筆最多購買 ${item.maxPerOrder} 件`, 400);
    this._assertStock(item, qty);
    const ship = this._validateShipping(shipping);
    const totalTwd = item.priceTwd * qty;

    // discordId 傳 null → isGuest:true、displayName 用收件人姓名
    const order = this._baseOrder(null, ship.name, item, qty, ship, "ecpay", totalTwd, "twd");
    const merchantTradeNo = genMerchantTradeNo();
    order.ecpay = { merchantTradeNo, tradeNo: null, paidAt: null };
    await this.merchOrderRepository.save(order);

    const { buildAioCheckout } = require("../payment/ecpayCheckout");
    const checkout = buildAioCheckout({
      merchantTradeNo,
      totalAmount: totalTwd,
      itemName: `${item.name} x${qty}`,
      tradeDesc: "otonashikoi merch",
      returnUrl,
      clientBackUrl: `${clientBackUrl}${clientBackUrl.includes("?") ? "&" : "?"}orderNo=${order.orderNo}`
    }, ecpayCfg);

    return { order, checkout };
  }

  // 訪客查訂單：需訂單編號 + Email 相符（避免任意查別人訂單）
  async lookupGuestOrder(orderNo, email) {
    const order = await this.merchOrderRepository.findByOrderNo(String(orderNo || "").trim());
    if (!order) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到此訂單編號", 404);
    const emailMatch = String(order.shipping?.email || "").toLowerCase() === String(email || "").trim().toLowerCase();
    if (!emailMatch) throw new AppError(ERROR_CODES.FORBIDDEN, "訂單編號與 Email 不符", 403);
    return {
      orderNo: order.orderNo, itemName: order.itemName, qty: order.qty,
      amount: order.amount, currency: order.currency, status: order.status,
      trackingNo: order.trackingNo || "", createdAt: order.createdAt,
      shippingName: order.shipping?.name || ""
    };
  }

  // ───────── 綠界付款完成對帳（webhook 呼叫）─────────
  async confirmEcpayPayment({ merchantTradeNo, tradeNo, rtnCode, raw }) {
    const order = await this.merchOrderRepository.findByMerchantTradeNo(merchantTradeNo);
    if (!order) return { handled: false, reason: "order_not_found" };
    if (order.status !== "pending_payment") {
      // 已處理過（綠界會重送）→ 冪等回 OK
      return { handled: true, already: true, order };
    }
    if (String(rtnCode) !== "1") {
      return { handled: false, reason: `rtnCode_${rtnCode}` };
    }
    // 扣庫存（付款成功才扣，避免占庫存）
    const item = await this.merchItemRepository.findById(order.itemId);
    if (item && item.stock !== -1) {
      await this.merchItemRepository.save({ ...item, stock: Math.max(0, item.stock - order.qty), updatedAt: new Date().toISOString() });
    }
    order.status = "paid";
    order.ecpay = { ...(order.ecpay || {}), merchantTradeNo, tradeNo: tradeNo || null, paidAt: new Date().toISOString(), raw: raw || null };
    order.updatedAt = new Date().toISOString();
    await this.merchOrderRepository.save(order);
    return { handled: true, order };
  }

  // ───────── 訂單查詢 / 出貨 ─────────
  async listMyOrders(discordId) {
    return this.merchOrderRepository.listByDiscordId(discordId, 50);
  }

  async listOrders({ status = null } = {}) {
    return this.merchOrderRepository.listAll({ status, limit: 1000 });
  }

  async updateOrderStatus(orderNo, { status, trackingNo, adminNote }) {
    const order = await this.merchOrderRepository.findByOrderNo(orderNo);
    if (!order) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到訂單", 404);
    if (status !== undefined) {
      if (!ORDER_STATUSES.includes(status)) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "訂單狀態無效", 400);
      order.status = status;
    }
    if (trackingNo !== undefined) order.trackingNo = normStr(trackingNo, 100);
    if (adminNote !== undefined) order.adminNote = normStr(adminNote, 500);
    order.updatedAt = new Date().toISOString();
    await this.merchOrderRepository.save(order);
    return order;
  }
}

module.exports = { MerchService, ORDER_STATUSES };
