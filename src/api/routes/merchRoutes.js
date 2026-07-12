"use strict";
/**
 * 周邊（實體商品）API。
 *   玩家：瀏覽品項、鑽石下單、綠界現金下單(回結帳參數)、查自己的訂單。
 *   綠界 webhook：POST /api/pay/ecpay/merch-notify（公開，靠 CheckMacValue 驗簽）。
 *   後台：品項 CRUD、訂單列表/出貨/匯出 CSV（Bearer adminPassword）。
 */
const { Router } = require("express");
const express = require("express");
const multer = require("multer");
const os = require("os");
const { ok, fail } = require("../../shared/response");
const { requireAuth } = require("./requireAuth");
const config = require("../../config");
const { verifyAioCallback } = require("../../services/payment/ecpayCheckout");
const { uploadImage } = require("../../shared/cloudinaryUpload");

const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (!file.mimetype.startsWith("image/")) return cb(new Error("Only image files are allowed."));
    cb(null, true);
  }
});

function createMerchRoutes(serviceContext) {
  const router = Router();
  const merch = serviceContext.merchService;

  function baseUrl() {
    return (config.api.publicBaseUrl || "https://otonashikoi.org").replace(/\/+$/, "");
  }
  function requireAdmin(req, res, next) {
    const token = (req.header("Authorization") || "").replace("Bearer ", "");
    if (token !== config.api.adminPassword) return res.status(401).json(fail("ADMIN_UNAUTHORIZED", "Invalid admin password."));
    next();
  }

  // ─────────────── 玩家端 ───────────────
  // 品項清單（只回開放中）
  router.get("/api/merch/items", async (_req, res, next) => {
    try {
      const items = await merch.listItems({ includeDisabled: false });
      // 不外洩 note（後台備註）
      res.json(ok({ items: items.map(({ note, ...rest }) => rest) }));
    } catch (e) { next(e); }
  });

  // 我的訂單
  router.get("/api/me/merch/orders", requireAuth, async (req, res, next) => {
    try {
      res.json(ok({ orders: await merch.listMyOrders(req.playerRecord.discordId) }));
    } catch (e) { next(e); }
  });

  // 鑽石下單（立即成立）
  router.post("/api/merch/order/diamond", requireAuth, async (req, res, next) => {
    try {
      const { discordId, displayName } = req.playerRecord;
      const { itemId, qty, shipping } = req.body || {};
      const order = await merch.createDiamondOrder(discordId, displayName, itemId, qty, shipping);
      res.json(ok({ order }, "下單成功"));
    } catch (e) { next(e); }
  });

  // 綠界現金下單（回結帳表單參數，前端建隱藏表單 POST 去綠界）
  router.post("/api/merch/order/ecpay", requireAuth, async (req, res, next) => {
    try {
      if (!config.ecpay?.enabled) return res.status(400).json(fail("ECPAY_DISABLED", "現金付款目前未開放"));
      const { discordId, displayName } = req.playerRecord;
      const { itemId, qty, shipping } = req.body || {};
      const returnUrl = `${baseUrl()}/api/pay/ecpay/merch-notify`;
      const clientBackUrl = `${baseUrl()}/merch?ecpayReturn=1`;
      const { order, checkout } = await merch.createEcpayOrder(
        discordId, displayName, itemId, qty, shipping,
        { returnUrl, clientBackUrl }, config.ecpay
      );
      res.json(ok({ orderNo: order.orderNo, checkout }, "前往綠界付款"));
    } catch (e) { next(e); }
  });

  // ─────────────── 訪客商城（免登入，只收現金）───────────────
  // 獨立公開頁面
  router.get("/store", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.sendFile(require("path").resolve(__dirname, "../../web/public/store.html"));
  });

  // 訪客現金下單（回綠界結帳參數）
  router.post("/api/merch/guest/order/ecpay", async (req, res, next) => {
    try {
      if (!config.ecpay?.enabled) return res.status(400).json(fail("ECPAY_DISABLED", "現金付款目前未開放"));
      const { itemId, qty, shipping } = req.body || {};
      const returnUrl = `${baseUrl()}/api/pay/ecpay/merch-notify`;
      const clientBackUrl = `${baseUrl()}/store?ecpayReturn=1`;
      const { order, checkout } = await merch.createGuestEcpayOrder(itemId, qty, shipping, { returnUrl, clientBackUrl }, config.ecpay);
      res.json(ok({ orderNo: order.orderNo, checkout }, "前往綠界付款"));
    } catch (e) { next(e); }
  });

  // 訪客查訂單（訂單編號 + Email）
  router.get("/api/merch/guest/order", async (req, res, next) => {
    try {
      const info = await merch.lookupGuestOrder(req.query.orderNo, req.query.email);
      res.json(ok({ order: info }));
    } catch (e) { next(e); }
  });

  // ─────────────── 綠界 webhook（ReturnURL）───────────────
  router.post(
    "/api/pay/ecpay/merch-notify",
    express.urlencoded({ extended: false, limit: "1mb" }),
    express.json({ limit: "1mb" }),
    async (req, res) => {
      let ack = "1|OK";
      try {
        const body = req.body || {};
        const { ok: macOk } = verifyAioCallback(body, config.ecpay);
        if (!macOk) {
          console.warn("[merch/ecpay] CheckMacValue 驗簽失敗", body?.MerchantTradeNo);
          ack = "0|CheckMacValue Error";
        } else {
          await merch.confirmEcpayPayment({
            merchantTradeNo: String(body.MerchantTradeNo || ""),
            tradeNo: String(body.TradeNo || ""),
            rtnCode: body.RtnCode,
            raw: body
          });
        }
      } catch (err) {
        console.error("[merch/ecpay] webhook 未預期錯誤：", err?.stack || err?.message || err);
      }
      res.type("text/plain").send(ack);
    }
  );

  // ─────────────── 後台 ───────────────
  router.get("/admin/merch/items", requireAdmin, async (_req, res, next) => {
    try { res.json(ok({ items: await merch.listItems({ includeDisabled: true }) })); } catch (e) { next(e); }
  });
  router.post("/admin/merch/items", requireAdmin, async (req, res, next) => {
    try { res.json(ok({ item: await merch.createItem(req.body || {}) }, "已新增")); } catch (e) { next(e); }
  });
  router.put("/admin/merch/items/:id", requireAdmin, async (req, res, next) => {
    try { res.json(ok({ item: await merch.updateItem(req.params.id, req.body || {}) }, "已更新")); } catch (e) { next(e); }
  });
  router.delete("/admin/merch/items/:id", requireAdmin, async (req, res, next) => {
    try { res.json(ok(await merch.deleteItem(req.params.id), "已刪除")); } catch (e) { next(e); }
  });

  // 圖片上傳（通用，不綁品項；回傳 Cloudinary 網址讓前端填進 imageUrl 欄）
  router.post("/admin/merch/upload-image", requireAdmin, upload.single("image"), async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json(fail("NO_FILE", "請選擇圖片檔"));
      const { imageUrl, imageThumbnailUrl } = await uploadImage(req.file.path, "merch_items");
      res.json(ok({ imageUrl, imageThumbnailUrl }, "圖片已上傳"));
    } catch (e) { next(e); }
  });

  router.get("/admin/merch/orders", requireAdmin, async (req, res, next) => {
    try { res.json(ok({ orders: await merch.listOrders({ status: req.query.status || null }) })); } catch (e) { next(e); }
  });
  router.patch("/admin/merch/orders/:orderNo", requireAdmin, async (req, res, next) => {
    try {
      const { status, trackingNo, adminNote } = req.body || {};
      res.json(ok({ order: await merch.updateOrderStatus(req.params.orderNo, { status, trackingNo, adminNote }) }, "已更新"));
    } catch (e) { next(e); }
  });

  // 收件清單 CSV 匯出（給你自己貼單寄貨）
  router.get("/admin/merch/orders.csv", requireAdmin, async (req, res, next) => {
    try {
      const orders = await merch.listOrders({ status: req.query.status || null });
      const cols = ["orderNo", "status", "payMethod", "itemName", "qty", "amount", "currency", "name", "phone", "email", "zip", "address", "note", "trackingNo", "createdAt"];
      const esc = (v) => {
        const s = String(v == null ? "" : v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const tpe = (iso) => {
        if (!iso) return "";
        try {
          return new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)).replace(/\//g, "-");
        } catch (_) { return String(iso); }
      };
      const rows = orders.map((o) => [
        o.orderNo, o.status, o.payMethod, o.itemName, o.qty, o.amount, o.currency,
        o.shipping?.name, o.shipping?.phone, o.shipping?.email, o.shipping?.zip, o.shipping?.address, o.shipping?.note,
        o.trackingNo, tpe(o.createdAt)
      ].map(esc).join(","));
      const csv = "﻿" + [cols.join(","), ...rows].join("\n"); // BOM 讓 Excel 正確顯示中文
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="merch-orders-${Date.now()}.csv"`);
      res.send(csv);
    } catch (e) { next(e); }
  });

  return router;
}

module.exports = { createMerchRoutes };
