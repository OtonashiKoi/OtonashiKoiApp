"use strict";
/**
 * 綠界「直播主收款」金流 API。
 *   POST /api/pay/ecpay/live-notify   綠界後端付款完成通知(ReturnURL)。公開端點，
 *                                     安全靠 AES 解密 + CheckMacValue 驗簽；務必回應純文字 "1|OK"。
 *   GET  /api/me/donate-code          (需登入) 取得本人斗內碼，填在綠界抖內留言用。
 */
const { Router } = require("express");
const express = require("express");
const { ok, fail } = require("../../shared/response");
const { requireAuth } = require("./requireAuth");
const config = require("../../config");
const { processLiveNotify } = require("../../services/payment/ecpayDonationService");
const { getOrCreateCode } = require("../../services/payment/donateCodeService");

function createEcpayRoutes(serviceContext) {
  const router = Router();

  // 綠界可能以 json 或 x-www-form-urlencoded 送；兩種都吃，避免 body 空掉。
  router.post(
    "/api/pay/ecpay/live-notify",
    express.json({ limit: "1mb" }),
    express.urlencoded({ extended: false, limit: "1mb" }),
    async (req, res) => {
      let ack = "1|OK";
      try {
        const result = await processLiveNotify(req.body || {}, serviceContext);
        ack = result?.ack || ack;
      } catch (err) {
        // 已盡量在 service 內落地；此處不讓例外外洩，仍回 ACK 避免綠界重試風暴。
        console.error("[ECPay] live-notify 未預期錯誤：", err?.stack || err?.message || err);
      }
      res.type("text/plain").send(ack);
    }
  );

  // 取得本人斗內碼（第一次呼叫會產生並存檔）
  router.get("/api/me/donate-code", requireAuth, async (req, res, next) => {
    try {
      const { discordId } = req.playerRecord;
      const code = await getOrCreateCode(discordId, serviceContext);
      if (!code) return res.status(404).json(fail("PLAYER_NOT_FOUND", "找不到玩家進度"));
      res.json(ok({
        code,
        donateUrl: config.ecpay.donateUrl || "",
        twdPerDiamond: config.ecpay.twdPerDiamond || 100
      }, "donate code"));
    } catch (error) { next(error); }
  });

  return router;
}

module.exports = { createEcpayRoutes };
