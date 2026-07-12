"use strict";
/**
 * 綠界「直播主收款」ReturnURL 收單處理。
 * 流程：驗 TransCode → 解密 Data → 驗 CheckMacValue → 判 RtnCode/付款狀態
 *       → 由留言斗內碼對應玩家 → 走與 YouTube SC 相同的發鑽/累積/Buff/SC條 管線。
 *
 * 安全與不遺失原則：
 *   - 發鑽只在「驗簽通過 + 對應到玩家 + autoGrant 開」時執行。
 *   - 任一條件不滿足都仍完整落地(ecpayDonations)，可事後於後台人工指派/補發。
 *   - 冪等：TradeNo 唯一；grantCurrency 以 sourceRef 冪等；donationLedger 以 processedRefs 冪等。
 */
const config = require("../../config");
const { getMongoDb } = require("../../adapters/mongo/createMongoClient");
const { decryptData, verifyCheckMac } = require("./ecpayCrypto");
const { matchPlayerFromNote } = require("./donateCodeService");
const { recordDonationEvent } = require("../stream/streamRecordsService");
const { CURRENCY_SOURCES } = require("../../shared/sources");

const ACK = "1|OK"; // 綠界要求的成功回應字串
const SANDBOX_HASH_KEY = "pwFHCqoQZGmho4w6"; // 綠界公開沙盒金鑰(文件上公開，不可用於正式發鑽)

function num(v) { return Number(v) || 0; }

// 是否允許自動發鑽：設定要開，且「正式環境不得使用公開沙盒金鑰發鑽」(否則可被偽造簽章刷鑽)。
function autoGrantAllowed() {
  if (!config.ecpay.autoGrant) return false;
  const isProd = process.env.NODE_ENV === "production";
  if (isProd && config.ecpay.hashKey === SANDBOX_HASH_KEY) {
    console.warn("[ECPay] 正式環境仍使用公開沙盒金鑰 → 拒絕自動發鑽，請在 .env 換成正式特店金鑰。");
    return false;
  }
  return true;
}

/**
 * 共用結算：對「已知 discordId」的一筆斗內累積台帳、湊滿門檻發鑽，並觸發全服事件。
 * 與 streamHandlers.handleDonation 同口徑，共用 donationLedger（綠界與 SC 累積合一）。
 */
async function settleForPlayer({ discordId, displayName, twdAmount, sourceRef }, serviceContext) {
  const db = await getMongoDb().catch(() => null);
  if (!db) throw new Error("no-db");
  const twdPerDiamond = Math.max(1, num(config.ecpay.twdPerDiamond) || 100);

  const ledger = await db.collection("donationLedger").findOne({ discordId })
    || { pendingTwd: 0, totalTwd: 0, processedRefs: [] };
  const processedRefs = Array.isArray(ledger.processedRefs) ? ledger.processedRefs : [];
  if (sourceRef && processedRefs.includes(sourceRef)) {
    return { duplicated: true, diamonds: 0 };
  }

  // 全服事件（best-effort，不影響發鑽）
  if (config.ecpay.triggerStreamEvents) {
    const donation = { twdAmount, sourceRef, platform: "ecpay", platformUserId: null, displayName };
    try {
      await require("../stream/donationBuffTrigger").maybeTriggerDonationBuff(donation, { discordId, displayName }, serviceContext);
    } catch (_) { /* noop */ }
    try {
      await require("../stream/scBarService").addDonation(twdAmount, { discordId, displayName }, serviceContext);
    } catch (_) { /* noop */ }
  }

  const newPendingRaw = num(ledger.pendingTwd) + twdAmount;
  const diamondsToGrant = Math.floor(newPendingRaw / twdPerDiamond);
  const newPending = newPendingRaw % twdPerDiamond;
  const newTotal = num(ledger.totalTwd) + twdAmount;
  const now = new Date().toISOString();
  const nextRefs = sourceRef ? [...processedRefs, sourceRef].slice(-200) : processedRefs;

  const persistLedger = () => db.collection("donationLedger").updateOne(
    { discordId },
    { $set: { discordId, pendingTwd: newPending, totalTwd: newTotal, processedRefs: nextRefs, updatedAt: now } },
    { upsert: true }
  );

  if (diamondsToGrant <= 0) {
    await persistLedger();
    await recordDonationEvent({
      sourceRef, platform: "ecpay", platformUserId: null, displayName,
      twdAmount, currency: "TWD", discordId, bound: true,
      diamondsGranted: 0, pendingAfter: newPending, note: "ecpay:accumulate"
    }).catch(() => {});
    return { duplicated: false, diamonds: 0, pendingAfter: newPending };
  }

  // 發鑽成功（以 sourceRef 冪等）後才寫台帳
  const result = await serviceContext.rewardService.grantCurrency({
    discordId, displayName, currencyType: "diamond", amount: diamondsToGrant,
    source: CURRENCY_SOURCES.DONATION_REWARD, sourceRef, operator: "ecpay:donation"
  });
  await persistLedger();
  await recordDonationEvent({
    sourceRef, platform: "ecpay", platformUserId: null, displayName,
    twdAmount, currency: "TWD", discordId, bound: true,
    diamondsGranted: diamondsToGrant, pendingAfter: newPending, note: "ecpay:granted"
  }).catch(() => {});

  return { duplicated: Boolean(result.duplicated), diamonds: diamondsToGrant, pendingAfter: newPending };
}

/**
 * 處理一筆綠界 ReturnURL 通知。
 * @param {object} body 綠界 POST 的 JSON（含 MerchantID / TransCode / Data / CheckMacValue …）
 * @returns {Promise<{ack:string, handled:boolean, reason?:string, granted?:number}>}
 */
async function processLiveNotify(body, serviceContext) {
  const cfg = config.ecpay;
  const db = await getMongoDb().catch(() => null);

  // 落地原始通知（即使後面驗簽/解密失敗也留存，供追查）
  const rawDoc = {
    receivedAt: new Date().toISOString(),
    merchantId: body?.MerchantID || null,
    transCode: body?.TransCode ?? null,
    transMsg: body?.TransMsg || null,
    checkMacValue: body?.CheckMacValue || null,
    rawData: body?.Data || null // 保留密文供解密除錯（正式穩定後可移除）
  };

  if (!cfg.enabled) {
    if (db) await db.collection("ecpayDonations").insertOne({ ...rawDoc, status: "disabled" }).catch(() => {});
    return { ack: ACK, handled: false, reason: "disabled" };
  }

  // 1) 解密 Data
  let payload = null;
  let macOk = false;
  try {
    const plaintext = decryptData(body.Data, cfg.hashKey, cfg.hashIV);
    macOk = verifyCheckMac(plaintext, body.CheckMacValue, cfg.hashKey, cfg.hashIV).ok;
    payload = JSON.parse(plaintext);
  } catch (err) {
    if (db) await db.collection("ecpayDonations").insertOne({ ...rawDoc, status: "decrypt_failed", error: String(err?.message || err) }).catch(() => {});
    console.warn("[ECPay] Data 解密/解析失敗：", err?.message || err);
    // 仍回 ACK 避免綠界無效重試（我們已留存原始通知）
    return { ack: ACK, handled: false, reason: "decrypt_failed" };
  }

  // 交易明細在 OrderInfo 內（實際回呼格式）；相容舊文件的平鋪格式 → fallback 到 payload
  const oi = (payload.OrderInfo && typeof payload.OrderInfo === "object") ? payload.OrderInfo : payload;
  const tradeNo = String(oi.TradeNo || "");
  const merchantTradeNo = String(oi.MerchantTradeNo || "");
  const twdAmount = num(oi.TradeAmt);
  const rtnOk = num(payload.RtnCode) === 1;
  const paid = String(oi.TradeStatus) === "1";
  const simulate = num(payload.SimulatePaid) === 1;
  const patronName = payload.PatronName || null;
  const patronNote = payload.PatronNote || "";

  const baseRecord = {
    ...rawDoc,
    tradeNo, merchantTradeNo, twdAmount,
    rtnCode: num(payload.RtnCode), rtnMsg: payload.RtnMsg || null,
    tradeStatus: oi.TradeStatus ?? null,
    paymentType: oi.PaymentType || null,
    paymentDate: oi.PaymentDate || null,
    tradeDate: oi.TradeDate || null,
    chargeFee: num(oi.ChargeFee),
    patronName, patronNote,
    donateUrl: payload.DonateURL || null,
    livestreamUrl: payload.LivestreamURL || null,
    simulate, macOk
  };

  // 冪等：同 TradeNo 已成功處理過 → 直接 ACK
  if (db && tradeNo) {
    const prev = await db.collection("ecpayDonations").findOne({ tradeNo, status: "granted" }).catch(() => null);
    if (prev) return { ack: ACK, handled: true, reason: "duplicate", granted: 0 };
  }

  // 未付款成功 → 只記錄
  if (!rtnOk || !paid) {
    if (db) await db.collection("ecpayDonations").updateOne(
      { tradeNo: tradeNo || null }, { $set: { ...baseRecord, status: "not_paid" } }, { upsert: true }
    ).catch(() => {});
    return { ack: ACK, handled: false, reason: "not_paid" };
  }

  // 對應玩家：代碼不管玩家填在「留言」還是「姓名/暱稱(ID欄)」都能收到 → 兩格併起來一起掃代碼。
  const player = await matchPlayerFromNote(
    [patronNote, patronName].filter(Boolean).join(" ")
  ).catch(() => null);

  // 驗簽未過、或找不到玩家、或關閉自動發鑽 → 記錄待處理，不發鑽
  let status = "granted";
  let granted = 0;
  let reason = null;
  if (!player) {
    status = "unbound"; reason = "no-code-match";
  } else if (!macOk) {
    status = "mac_failed"; reason = "checkmac-mismatch";
  } else if (!autoGrantAllowed()) {
    status = "hold"; reason = "auto-grant-off";
  } else {
    try {
      const r = await settleForPlayer({
        discordId: player.discordId,
        displayName: player.displayName || patronName || "斗內者",
        twdAmount,
        sourceRef: `ecpay:${tradeNo}`
      }, serviceContext);
      granted = r.diamonds || 0;
      reason = r.duplicated ? "duplicated" : "ok";
    } catch (err) {
      status = "grant_error"; reason = String(err?.message || err);
      console.error("[ECPay] 發鑽失敗：", err?.message || err);
    }
  }

  if (db) await db.collection("ecpayDonations").updateOne(
    { tradeNo: tradeNo || null },
    { $set: { ...baseRecord, status, reason, matchedDiscordId: player?.discordId || null, matchedCode: player?.code || null, diamondsGranted: granted, processedAt: new Date().toISOString() } },
    { upsert: true }
  ).catch(() => {});

  console.log(`[ECPay] 收單 TradeNo=${tradeNo} NT$${twdAmount} status=${status} reason=${reason} 玩家=${player?.discordId || "-"} 發鑽=${granted}${simulate ? " (模擬)" : ""}`);

  // DM 通知玩家（best-effort）
  if (status === "granted" && player?.discordId && serviceContext.notifyPlayer) {
    try { await serviceContext.notifyPlayer(player.discordId, granted, twdAmount); } catch (_) { /* noop */ }
  }

  return { ack: ACK, handled: status === "granted", reason, granted };
}

module.exports = { processLiveNotify, settleForPlayer };
