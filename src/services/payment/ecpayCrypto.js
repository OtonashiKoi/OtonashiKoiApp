"use strict";
/**
 * 綠界「直播主收款」加解密 / 檢查碼工具。
 * 依官方文件：
 *   - ReturnURL 的 Data 欄位：AES-128-CBC / PKCS7，Key=HashKey、IV=HashIV，密文 Base64；
 *     解密後再做一次 URL Decode 才得到明文 JSON。
 *   - CheckMacValue = SHA256( URLEncode( HashKey + Data明文 + HashIV ) ) → 轉小寫再雜湊 → 轉大寫。
 *   - URLEncode 採 .NET(HttpUtility.UrlEncode) 風格：空白→'+'、部分保留字元差異。
 *
 * 官方解密範例向量（decryptData 測試用）：
 *   Key=pwFHCqoQZGmho4w6 IV=EkRm7iFT261dpevs
 *   Data(Base64)=o4TJSHkQBM1bogbn5BNFRofCVTfsQjoqv/TX8DKn757fe5AoYzoalYmrMsGXTiwxGpI8NsE2vu4tScAwISx8kw==
 *   → 明文 {"Name":"Test","ID":"A123456789"}
 */
const crypto = require("crypto");

// .NET HttpUtility.UrlEncode 風格。lower=true 時整串轉小寫（僅供 CheckMacValue 雜湊，
// 切勿用於 Data 本體編碼，否則會把 JSON 大小寫弄壞）。
function urlEncodeDotNet(str, lower) {
  const s = encodeURIComponent(String(str))
    .replace(/%20/g, "+")
    .replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16));
  return lower ? s.toLowerCase() : s;
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

/** 由「Data 明文字串」算 CheckMacValue（大寫）。 */
function makeCheckMac(plaintext, hashKey, hashIV) {
  const raw = `${hashKey}${plaintext}${hashIV}`;
  const encoded = urlEncodeDotNet(raw, true);
  return crypto.createHash("sha256").update(encoded, "utf8").digest("hex").toUpperCase();
}

/** 驗證回傳的 CheckMacValue（以解密後明文重算比對）。 */
function verifyCheckMac(plaintext, receivedMac, hashKey, hashIV) {
  const expected = makeCheckMac(plaintext, hashKey, hashIV);
  const ok = typeof receivedMac === "string" && receivedMac.toUpperCase() === expected;
  return { ok, expected };
}

module.exports = { urlEncodeDotNet, decryptData, encryptData, makeCheckMac, verifyCheckMac };
