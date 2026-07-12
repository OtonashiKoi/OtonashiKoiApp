"use strict";
/**
 * 斗內碼：每位玩家一組專屬短碼，綠界抖內時填在「留言(PatronNote)」或「姓名/暱稱(PatronName)」皆可，
 * 回傳通知時把兩格併起來一起解析 → 對應到遊戲帳號發鑽（代碼是唯一鍵，填哪格都收得到）。
 * 儲存在 progress.donateCode。
 */
const { getMongoDb } = require("../../adapters/mongo/createMongoClient");

// 去除易混淆字元(0/O/1/I/L)，長度 6
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LEN = 6;
const CODE_RE = new RegExp(`[${ALPHABET}]{${CODE_LEN}}`, "g");

function genCode() {
  let s = "";
  for (let i = 0; i < CODE_LEN; i++) {
    s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return s;
}

/** 取得（或首次產生並存檔）某玩家的斗內碼。 */
async function getOrCreateCode(discordId, serviceContext) {
  const repo = serviceContext.progressRepository;
  const progress = await repo.findByPlayerId(discordId);
  if (!progress) return null;
  if (progress.donateCode && String(progress.donateCode).length === CODE_LEN) {
    return progress.donateCode;
  }
  const db = await getMongoDb().catch(() => null);
  // 產生一組不與他人衝突的碼
  let code = genCode();
  if (db) {
    for (let tries = 0; tries < 8; tries++) {
      const clash = await db.collection("progress").findOne({ donateCode: code }, { projection: { _id: 1 } }).catch(() => null);
      if (!clash) break;
      code = genCode();
    }
  }
  progress.donateCode = code;
  progress.updatedAt = new Date().toISOString();
  await repo.save(progress);
  return code;
}

/** 由斗內碼反查 discordId（找不到回 null）。 */
async function resolveByCode(code) {
  const c = String(code || "").toUpperCase().trim();
  if (!c || c.length !== CODE_LEN) return null;
  const db = await getMongoDb().catch(() => null);
  if (!db) return null;
  const p = await db.collection("progress").findOne(
    { donateCode: c },
    { projection: { playerId: 1, discordId: 1, displayName: 1, donateCode: 1 } }
  ).catch(() => null);
  // progress 以 playerId 為主鍵，其值即 Discord 使用者 ID（發鑽用）。
  const did = p ? (p.discordId || p.playerId) : null;
  return did ? { discordId: String(did), displayName: p.displayName || null } : null;
}

/**
 * 從留言抽出所有可能的斗內碼（大寫、去重）。
 * 玩家可以正常留言、把碼夾在句子裡任何位置；這裡掃出所有「連續合法字元」區段，
 * 再用滑動視窗取出其中每一段 6 碼子字串當候選（碼黏在其他字裡也抓得到）。
 */
function extractCodes(note) {
  const up = String(note || "").toUpperCase();
  const runs = up.match(new RegExp(`[${ALPHABET}]{${CODE_LEN},}`, "g")) || [];
  const cands = new Set();
  for (const run of runs) {
    for (let i = 0; i + CODE_LEN <= run.length && cands.size < 60; i++) {
      cands.add(run.slice(i, i + CODE_LEN));
    }
  }
  return [...cands];
}

/**
 * 從留言解析並比對到唯一玩家。
 * @returns {Promise<{discordId:string,displayName:string|null,code:string}|null>}
 */
async function matchPlayerFromNote(note) {
  const codes = extractCodes(note);
  for (const code of codes) {
    const hit = await resolveByCode(code);
    if (hit) return { ...hit, code };
  }
  return null;
}

module.exports = { getOrCreateCode, resolveByCode, extractCodes, matchPlayerFromNote, CODE_LEN };
