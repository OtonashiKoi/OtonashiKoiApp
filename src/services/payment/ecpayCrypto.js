"use strict";
/**
 * 綠界「直播主收款」加解密 / 檢查碼工具。
 * 依官方文件：
 *   - ReturnURL 的 Data 欄位：AES-128-CBC / PKCS7，Key=HashKey、IV=HashIV，密文 Base64；
 *     解密後再做一次 URL Decode 才得到明文 JSON。
 *   - CheckMacValue = SHA256( URLEncode( HashKey + Data明文 + HashIV ) ) → 轉小寫再雜湊 → 轉大寫。
 *   - 2026-09-01 前的正式回呼採 .NET HttpUtility.UrlEncode；新版採 Uri.EscapeDataString。
 *     過渡期驗簽同時接受兩者，但加密 Data 與 AioCheckOut 仍維持各自既有規格。
 *
 * 官方解密範例向量（decryptData 測試用）：
 *   Key=pwFHCqoQZGmho4w6 IV=EkRm7iFT261dpevs
 *   Data(Base64)=o4TJSHkQBM1bogbn5BNFRofCVTfsQjoqv/TX8DKn757fe5AoYzoalYmrMsGXTiwxGpI8NsE2vu4tScAwISx8kw==
 *   → 明文 {"Name":"Test","ID":"A123456789"}
 */
const crypto = require("crypto");

// .NET HttpUtility.UrlEncode 風格。lower=true 時整串轉小寫（僅供 CheckMacValue 雜湊，
// 切勿用於 Data 本體編碼，否則會把 JSON 大小寫弄壞）。
// ⚠️ 保留字對齊 .NET：`! * ( )` 不編碼、`'`→%27、`~`→%7e。
//   舊版把 !()* 也編碼 → 只要斗內留言帶驚嘆號等符號 CheckMacValue 必炸
//   （2026-08-09 真實案例：留言「聖人 啟動!」→ mac_failed 沒發鑽）。
function urlEncodeDotNet(str, lower) {
  const s = encodeURIComponent(String(str))
    .replace(/%20/g, "+")
    .replace(/'/g, "%27")
    .replace(/~/g, "%7e");
  return lower ? s.toLowerCase() : s;
}

// .NET Uri.EscapeDataString / RFC 3986 風格（PHP 對應 rawurlencode）：
// 空白→%20、`!'()*` 必須 percent-encode、`~` 保留。
// encodeURIComponent 原生會保留 `!'()*`，因此需補齊這五個字元。
function urlEncodeEscapeDataString(str, lower) {
  const s = encodeURIComponent(String(str)).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return lower ? s.toLowerCase() : s;
}

const CHECK_MAC_VARIANTS = Object.freeze({
  ESCAPE_DATA_STRING: "escape_data_string",
  LEGACY_HTTP_UTILITY: "legacy_http_utility"
});

function sha256Upper(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex").toUpperCase();
}

function macEquals(receivedMac, expectedMac) {
  const received = String(receivedMac || "").trim().toUpperCase();
  if (!/^[0-9A-F]{64}$/.test(received) || expectedMac.length !== 64) return false;
  return crypto.timingSafeEqual(Buffer.from(received, "ascii"), Buffer.from(expectedMac, "ascii"));
}

/**
 * 解密綠界 Data 欄位 → 明文字串（通常是 JSON）。
 * 注意：.NET UrlEncode 會把空白編為 '+'，decodeURIComponent 不會還原，故先把 '+' 換回 '%20'。
 */
function decryptData(dataB64, hashKey, hashIV) {
  const decipher = crypto.createDecipheriv(
    "aes-128-cbc",
    Buffer.from(hashKey, "utf8"),
    Buffer.from(hashIV, "utf8")
  );
  decipher.setAutoPadding(true); // PKCS7
  let dec = decipher.update(String(dataB64), "base64", "utf8");
  dec += decipher.final("utf8");
  return decodeURIComponent(dec.replace(/\+/g, "%20"));
}

/**
 * 加密（產生測試用回呼 / 若日後需送出加密參數）：URLEncode(明文) → AES-128-CBC → Base64。
 * 保留大小寫，不可轉小寫。
 */
function encryptData(plaintext, hashKey, hashIV) {
  const encoded = urlEncodeDotNet(plaintext, false);
  const cipher = crypto.createCipheriv(
    "aes-128-cbc",
    Buffer.from(hashKey, "utf8"),
    Buffer.from(hashIV, "utf8")
  );
  cipher.setAutoPadding(true);
  let enc = cipher.update(encoded, "utf8", "base64");
  enc += cipher.final("base64");
  return enc;
}

/** 舊正式環境：由「Data 明文字串」依 HttpUtility.UrlEncode 算 CheckMacValue。 */
function makeCheckMacLegacy(plaintext, hashKey, hashIV) {
  const raw = `${hashKey}${plaintext}${hashIV}`;
  const encoded = urlEncodeDotNet(raw, true);
  return sha256Upper(encoded);
}

/** 新測試／正式環境：依 Uri.EscapeDataString 算 CheckMacValue。 */
function makeCheckMacEscapeDataString(plaintext, hashKey, hashIV) {
  const raw = `${hashKey}${plaintext}${hashIV}`;
  const encoded = urlEncodeEscapeDataString(raw, true);
  return sha256Upper(encoded);
}

// 保留舊匯出名稱，避免 AioCheckOut 或既有維運腳本被無意切換規格。
const makeCheckMac = makeCheckMacLegacy;

/**
 * 驗證直播主收款 ReturnURL：新規則優先，舊規則備援。
 * 回傳 variant 供 MongoDB 留存與 9/1 切換監控；兩種都不符才拒絕發獎。
 */
function verifyCheckMac(plaintext, receivedMac, hashKey, hashIV) {
  const expectedEscapeDataString = makeCheckMacEscapeDataString(plaintext, hashKey, hashIV);
  const expectedLegacy = makeCheckMacLegacy(plaintext, hashKey, hashIV);
  let variant = null;
  if (macEquals(receivedMac, expectedEscapeDataString)) {
    variant = CHECK_MAC_VARIANTS.ESCAPE_DATA_STRING;
  } else if (macEquals(receivedMac, expectedLegacy)) {
    variant = CHECK_MAC_VARIANTS.LEGACY_HTTP_UTILITY;
  }
  return {
    ok: Boolean(variant),
    variant,
    // expected 指向官方新版；兩個候選值另列，方便管理端診斷但不得寫入公開回應。
    expected: expectedEscapeDataString,
    expectedEscapeDataString,
    expectedLegacy
  };
}

module.exports = {
  CHECK_MAC_VARIANTS,
  urlEncodeDotNet,
  urlEncodeEscapeDataString,
  decryptData,
  encryptData,
  makeCheckMac,
  makeCheckMacLegacy,
  makeCheckMacEscapeDataString,
  verifyCheckMac
};
