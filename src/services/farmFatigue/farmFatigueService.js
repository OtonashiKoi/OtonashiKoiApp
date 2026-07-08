"use strict";
/**
 * 耕作疲勞（anti-farm）：一般區域「主動打怪」連續獲得經驗/金幣滿 6 小時 → 之後每場經驗＆金幣 ×0.2（減 80%）。
 * 只要 30 分鐘沒在一般區域打怪獲得（＝沒有再呼叫本模組）→ 連續起點重置，回正常。
 *
 * 只作用於一般討伐的擊殺發獎（handleMonsterKill 非世界王路徑）。世界王、掛機都不呼叫本模組，
 * 因此不累積疲勞、也不被扣、也不會讓 30 分鐘重置計時「續命」。
 *
 * 狀態存 collection farmFatigue：{ discordId, start(連續起點 ms), last(最後獲得 ms) }。
 */
const { getMongoDb } = require("../../adapters/mongo/createMongoClient");

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const RESET_GAP_MS = 30 * 60 * 1000;
const PENALTY_MULT = 0.2; // 滿 6h 後拿 20%（減 80%）

/**
 * 記錄一次「一般區域打怪獲得」，並回傳這次該套用的經驗/金幣倍率（1 或 0.2）。
 * 失敗一律回 1（疲勞系統故障不影響正常發獎）。
 * @param {string} discordId
 * @param {number} [nowMs] 現在時間（毫秒）；預設 Date.now()
 * @returns {Promise<number>} 1（正常）或 0.2（疲勞）
 */
async function applyAndGetMultiplier(discordId, nowMs) {
  if (!discordId) return 1;
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  try {
    const db = await getMongoDb();
    const col = db.collection("farmFatigue");
    const doc = await col.findOne({ discordId });
    const last = Number(doc?.last) || 0;
    // 斷了 30 分鐘沒打 → 連續起點重新從現在算（回正常）
    let start = Number(doc?.start) || 0;
    if (!start || !last || (now - last) >= RESET_GAP_MS) start = now;
    const streakMs = now - start;
    await col.updateOne({ discordId }, { $set: { discordId, start, last: now } }, { upsert: true });
    return streakMs >= SIX_HOURS_MS ? PENALTY_MULT : 1;
  } catch (e) {
    console.warn("[farmFatigue] 疲勞查詢失敗，本場照常發獎:", e?.message || e);
    return 1;
  }
}

/** 供顯示/除錯：查目前連續耕作時長(ms)與是否疲勞，不寫入。 */
async function peek(discordId, nowMs) {
  if (!discordId) return { streakMs: 0, penalized: false };
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  try {
    const db = await getMongoDb();
    const doc = await db.collection("farmFatigue").findOne({ discordId });
    const last = Number(doc?.last) || 0;
    let start = Number(doc?.start) || 0;
    if (!start || !last || (now - last) >= RESET_GAP_MS) return { streakMs: 0, penalized: false };
    const streakMs = now - start;
    return { streakMs, penalized: streakMs >= SIX_HOURS_MS };
  } catch (_) {
    return { streakMs: 0, penalized: false };
  }
}

module.exports = { applyAndGetMultiplier, peek, SIX_HOURS_MS, RESET_GAP_MS, PENALTY_MULT };
