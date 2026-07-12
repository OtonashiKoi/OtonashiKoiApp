"use strict";
/**
 * 綠界 AioCheckOut（玩家主動結帳）— 與斗內的「直播主收款」是不同產品。
 * 這裡負責：
 *   1) buildAioCheckout：組出要 POST 去綠界付款頁的完整表單參數（含 CheckMacValue）。
 *   2) verifyAioCallback：驗證綠界付款完成後 ReturnURL 回傳的 CheckMacValue。
 *
 * CheckMacValue 演算法（AIO）：
 *   sort(參數) → `HashKey=xxx&k1=v1&...&HashIV=yyy` → .NET UrlEncode(轉小寫) → SHA256 → 轉大寫。
 *   字元編碼沿用 ecpayCrypto.urlEncodeDotNet（已在斗內驗簽實證正確）。
 */
const crypto = require("crypto");
const { urlEncodeDotNet } = require("./ecpayCrypto");

const AIO_ENDPOINT_PROD = "https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5";
const AIO_ENDPOINT_STAGE = "https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5";

// 是否為公開沙盒金鑰（沙盒特店 2000132 / 3002607 + 公開 HashKey）。沙盒導去 stage 付款頁。
function isSandbox(cfg) {
  const stageKeys = new Set(["pwFHCqoQZGmho4w6", "5294y06JbISpM5x9"]);
  return stageKeys.has(String(cfg.hashKey || "")) || String(cfg.merchantId) === "2000132" || String(cfg.merchantId) === "3002607";
}

function endpointFor(cfg) {
  return isSandbox(cfg) ? AIO_ENDPOINT_STAGE : AIO_ENDPOINT_PROD;
}

/** AIO CheckMacValue：sort 參數 → HashKey/HashIV 包夾 → urlEncode(lower) → SHA256 大寫。 */
function makeAioCheckMac(params, hashKey, hashIV) {
  const keys = Object.keys(params)
    .filter((k) => k !== "CheckMacValue" && params[k] !== undefined && params[k] !== null)
    .sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0));
  const query = keys.map((k) => `${k}=${params[k]}`).join("&");
  const raw = `HashKey=${hashKey}&${query}&HashIV=${hashIV}`;
  const encoded = urlEncodeDotNet(raw, true);
  return crypto.createHash("sha256").update(encoded, "utf8").digest("hex").toUpperCase();
}

// 綠界要求台北時間 yyyy/MM/dd HH:mm:ss
function taipeiTradeDate(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value || "00";
  let hh = get("hour"); if (hh === "24") hh = "00";
  return `${get("year")}/${get("month")}/${get("day")} ${hh}:${get("minute")}:${get("second")}`;
}

// 綠界 ItemName / TradeDesc 不可含特殊字元 & < > " '，先淨化
function sanitize(s, max = 200) {
  return String(s || "").replace(/[&<>"'#]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * 組 AioCheckOut 表單。回傳 { action, params }，前端據此建隱藏表單 POST 去綠界付款頁。
 * @param {object} o { merchantTradeNo, totalAmount, itemName, tradeDesc, returnUrl, clientBackUrl, orderResultURL? }
 * @param {object} cfg config.ecpay
 */
function buildAioCheckout(o, cfg) {
  const params = {
    MerchantID: String(cfg.merchantId),
    MerchantTradeNo: String(o.merchantTradeNo).slice(0, 20),
    MerchantTradeDate: taipeiTradeDate(),
    PaymentType: "aio",
    TotalAmount: String(Math.max(1, Math.round(Number(o.totalAmount) || 0))),
    TradeDesc: sanitize(o.tradeDesc || "otonashikoi merch", 200),
    ItemName: sanitize(o.itemName || "周邊商品", 400),
    ReturnURL: o.returnUrl,
    ChoosePayment: "ALL",
    ClientBackURL: o.clientBackUrl || "",
    EncryptType: "1"
  };
  if (o.orderResultURL) params.OrderResultURL = o.orderResultURL;
  params.CheckMacValue = makeAioCheckMac(params, cfg.hashKey, cfg.hashIV);
  return { action: endpointFor(cfg), params };
}

/** 驗證綠界回呼（ReturnURL / OrderResultURL）的 CheckMacValue。body 為 form 欄位物件。 */
function verifyAioCallback(body, cfg) {
  const received = String(body.CheckMacValue || "");
  const expected = makeAioCheckMac(body, cfg.hashKey, cfg.hashIV);
  return { ok: received.toUpperCase() === expected, expected, received };
}

module.exports = { buildAioCheckout, verifyAioCallback, makeAioCheckMac, endpointFor, isSandbox };
