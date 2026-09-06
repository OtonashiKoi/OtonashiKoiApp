"use strict";

const assert = require("node:assert/strict");
const {
  CHECK_MAC_VARIANTS,
  urlEncodeDotNet,
  urlEncodeEscapeDataString,
  decryptData,
  makeCheckMac,
  makeCheckMacLegacy,
  makeCheckMacEscapeDataString,
  verifyCheckMac
} = require("../src/services/payment/ecpayCrypto");
const { makeAioCheckMac } = require("../src/services/payment/ecpayCheckout");

const SANDBOX_KEY = "pwFHCqoQZGmho4w6";
const SANDBOX_IV = "EkRm7iFT261dpevs";

// 編碼差異必須固定：直播主收款新版不可再退回舊 HttpUtility 規則。
assert.equal(urlEncodeDotNet("A B!'()*~", false), "A+B!%27()*%7e");
assert.equal(urlEncodeEscapeDataString("A B!'()*~", false), "A%20B%21%27%28%29%2A~");

// 綠界直播主收款公開文件範例。
const officialPlain = '{"MerchantID":"3085676","MerchantTradeNo":"CX202202221540568521"}';
assert.equal(
  makeCheckMacEscapeDataString(officialPlain, "7b53896b742849d3", "37a0ad3c6ffa428b"),
  "CE67BBD259EE38BA1C7FB7CC88C3BD91D3F082B46EAEBd4E4E5F2184CB23349A".toUpperCase()
);

// 含空白、中文與特殊字元時，新舊規格必須產生不同結果，雙驗簽各自都能辨認來源。
const transitionPlain = '{"PatronName":"A B","PatronNote":"聖人 啟動!()*~"}';
const legacyMac = makeCheckMacLegacy(transitionPlain, SANDBOX_KEY, SANDBOX_IV);
const escapeMac = makeCheckMacEscapeDataString(transitionPlain, SANDBOX_KEY, SANDBOX_IV);
assert.equal(legacyMac, "FE05A770673E5C9B72F387F8446197495D104F8D64623A28E17CB7200A5EFB0B");
assert.equal(escapeMac, "205B50EE2053744A0DBB417A354852FFC887CF0372354C43BB06099C983F409E");
assert.notEqual(legacyMac, escapeMac);
assert.equal(makeCheckMac(transitionPlain, SANDBOX_KEY, SANDBOX_IV), legacyMac, "舊匯出名稱不可暗中改規格");
assert.deepEqual(
  { ok: verifyCheckMac(transitionPlain, escapeMac, SANDBOX_KEY, SANDBOX_IV).ok,
    variant: verifyCheckMac(transitionPlain, escapeMac, SANDBOX_KEY, SANDBOX_IV).variant },
  { ok: true, variant: CHECK_MAC_VARIANTS.ESCAPE_DATA_STRING }
);
assert.deepEqual(
  { ok: verifyCheckMac(transitionPlain, legacyMac, SANDBOX_KEY, SANDBOX_IV).ok,
    variant: verifyCheckMac(transitionPlain, legacyMac, SANDBOX_KEY, SANDBOX_IV).variant },
  { ok: true, variant: CHECK_MAC_VARIANTS.LEGACY_HTTP_UTILITY }
);
assert.equal(verifyCheckMac(transitionPlain, "0".repeat(64), SANDBOX_KEY, SANDBOX_IV).ok, false);

// 官方 AES 解密向量仍須通過；本次只調 CheckMacValue，不改 Data 解密。
assert.equal(
  decryptData(
    "o4TJSHkQBM1bogbn5BNFRofCVTfsQjoqv/TX8DKn757fe5AoYzoalYmrMsGXTiwxGpI8NsE2vu4tScAwISx8kw==",
    SANDBOX_KEY,
    SANDBOX_IV
  ),
  '{"Name":"Test","ID":"A123456789"}'
);

// 周邊商城 AioCheckOut 是另一套產品規格，雜湊快照必須完全不變。
assert.equal(makeAioCheckMac({
  MerchantID: "3002607",
  MerchantTradeNo: "TEST202608220001",
  MerchantTradeDate: "2026/08/22 12:00:00",
  PaymentType: "aio",
  TotalAmount: "100",
  TradeDesc: "otonashikoi merch",
  ItemName: "測試 商品",
  ReturnURL: "https://otonashikoi.org/api/pay/ecpay/merch-notify",
  ChoosePayment: "ALL",
  ClientBackURL: "https://otonashikoi.org/store",
  EncryptType: "1"
}, SANDBOX_KEY, SANDBOX_IV), "83053DED57EDBC3E9AB178F796B8744B9339FE560BEB7BABE2C7A3DE42A22A5F");

console.log("✅ 綠界 CheckMacValue：EscapeDataString/舊版雙驗簽、官方向量與 AioCheckOut 隔離通過");
