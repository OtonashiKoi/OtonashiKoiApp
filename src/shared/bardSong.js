"use strict";
/**
 * 演奏判定（吟遊詩人・詩人二轉）——全遊戲第一個動作輸入玩法。
 *
 * 流程（使用者定案 2026-07-23）：
 *   - 吟遊詩人出戰 → 伺服器隨機出題：5 個方向（↑↓←→），跟戰鬥回應下發（帶一次性 token）
 *   - 前端戰鬥播放開始 3 秒內輸入（鍵盤方向鍵／手機滑動）；完成 → 自動排隊下一場
 *   - 下一場出戰請求帶 { token, inputs } → 伺服器比對（答案在伺服器手上，抄不了；token 用過即銷毀）
 *   - 計分作用於「下一場」：每對 +6%、每錯 -6%；完美(5/5) → 連奏 +1，每層再 +10%（上限 5 層）
 *     → 滿檔 +80%、下限 -30%；完美另觸發「完美和弦」開場追擊 ×(150% + 連奏×20%)
 *   - 沒輸入/超時＝±0 但連奏斷；非完美連奏歸零
 *   - 連奏跨場保存（同區、10 分鐘沒打歸零、換區歸零）；DC 無演奏（±0、不斷連奏）
 *
 * 存放：progress.bardScore  = { token, seq, issuedAt }（當前待解的題）
 *       progress.bardStreak = { zone, streak, updatedAt }
 */

const crypto = require("crypto");

const DIRS = ["up", "down", "left", "right"];
const SEQ_LEN = 5;               // （舊常數保留給說明文字；實際長度依難度階梯）
const TIME_LIMIT_MS = 3000;      // 前端倒數（伺服器不強制卡毫秒，答案比對才是防線）
const PER_HIT_PCT = 6;
const STREAK_PCT = 10;           // 每層連奏 +10%
const STREAK_MAX = 5;            // 連奏上限（+50%）
const CHORD_BASE_PCT = 150;
const CHORD_PER_STREAK_PCT = 20; // 每層連奏 +20%
const IDLE_MS = 10 * 60 * 1000;
const DMG_MULT_CAP = 2.0;        // 傷害倍率上限 ×2.0
const DMG_MULT_FLOOR = 0.7;      // 下限 ×0.7

/**
 * 難度階梯（2026-07-23 使用者追加）：連奏越高 → 題目越長、單鍵與和弦倍率越高。
 * 出題時依「當下連奏」決定難度並蓋章在題目上（計分照題目上的參數走）。
 */
const TIERS = [
  { minStreak: 4, name: "困難", len: 6, perHitPct: 7, chordBasePct: 250 },
  { minStreak: 2, name: "普通", len: 5, perHitPct: 6, chordBasePct: 200 },
  { minStreak: 0, name: "簡單", len: 4, perHitPct: 5, chordBasePct: 150 },
];
/**
 * 難度階層（使用者定案 2026-07-23）：獨立於連奏的升降梯，跟連奏同一份區域狀態。
 *   - 完美 → 連奏爬升，難度照 minStreak 門檻往上升（升了就站住）
 *   - 沒全對（連奏斷）→ 只降「一級」：困難→普通→簡單，不會直接摔回底
 *   - 陣亡／換區／閒置 10 分鐘 → 直接回簡單
 */
const LEVELS = [...TIERS].reverse(); // index 0=簡單 1=普通 2=困難

function tierAt(level) {
  const lv = Math.max(0, Math.min(LEVELS.length - 1, Number(level) || 0));
  return LEVELS[lv];
}
function levelFromStreak(streak) {
  const s = Math.max(0, Number(streak) || 0);
  return LEVELS.reduce((lv, t, i) => (s >= t.minStreak ? i : lv), 0);
}
function tierFor(streak) { return tierAt(levelFromStreak(streak)); }

const SONG_BADGE_IDS = new Set(["job_minstrel_t2_v1"]); // 吟遊詩人

function hasSong(jobEq) {
  if (!jobEq) return false;
  return SONG_BADGE_IDS.has(String(jobEq.itemId || jobEq.id || ""));
}

/** 出一題（難度＝當下難度階層 0/1/2；參數蓋章在題目上，計分照章走） */
function newChallenge(level = 0, now = Date.now()) {
  const tier = tierAt(level);
  const seq = Array.from({ length: tier.len }, () => DIRS[Math.floor(Math.random() * DIRS.length)]);
  return {
    token: crypto.randomUUID(), seq, issuedAt: now,
    tier: tier.name, perHitPct: tier.perHitPct, chordBasePct: tier.chordBasePct,
  };
}

/** 讀連奏（換區/逾時歸零） */
function readStreak(progress, zone, now = Date.now()) {
  const s = progress?.bardStreak;
  if (!s || typeof s !== "object") return 0;
  if (String(s.zone || "") !== String(zone || "")) return 0;
  if (now - Number(s.updatedAt || 0) > IDLE_MS) return 0;
  return Math.max(0, Math.min(STREAK_MAX, Number(s.streak) || 0));
}

function nextStreak(streak, zone, level = 0, now = Date.now()) {
  return {
    zone: String(zone || ""),
    streak: Math.max(0, Math.min(STREAK_MAX, Number(streak) || 0)),
    tierLv: Math.max(0, Math.min(LEVELS.length - 1, Number(level) || 0)),
    updatedAt: now,
  };
}

/** 演奏加持光環倍率：每層連奏 +20%（滿 5 層＝×2）；斷奏/陣亡/換區歸零時自然回到 ×1 */
const AURA_PER_STREAK_PCT = 20;
function auraMult(streak) {
  const s = Math.max(0, Math.min(STREAK_MAX, Number(streak) || 0));
  return 1 + (AURA_PER_STREAK_PCT / 100) * s;
}

/** 讀難度階層：跟連奏同一份區域狀態——換區/閒置 10 分鐘自動回 0（簡單） */
function readLevel(progress, zone, now = Date.now()) {
  const s = progress?.bardStreak;
  if (!s || typeof s !== "object") return 0;
  if (String(s.zone || "") !== String(zone || "")) return 0;
  if (now - Number(s.updatedAt || 0) > IDLE_MS) return 0;
  return Math.max(0, Math.min(LEVELS.length - 1, Number(s.tierLv) || 0));
}

/**
 * 驗卷＋計分。
 * @param {object} stored   progress.bardScore（{token,seq}；null＝沒有待解題）
 * @param {object} submitted 玩家送來的 { token, inputs }（null＝這場沒演奏）
 * @param {number} streakBefore
 * @returns {{ played, correct, wrong, perfect, streak, dmgMult, chordPct, note }}
 */
function scorePerformance(stored, submitted, streakBefore = 0) {
  const noPlay = (breakStreak) => ({
    played: false, correct: 0, wrong: 0, perfect: false,
    streak: breakStreak ? 0 : Math.max(0, Math.min(STREAK_MAX, Number(streakBefore) || 0)),
    dmgMult: 1, chordPct: 0, note: null,
  });
  if (!submitted || !Array.isArray(submitted.inputs)) return noPlay(true); // 沒演奏 → ±0、連奏斷
  if (!stored || !stored.token || String(submitted.token || "") !== String(stored.token)) return noPlay(true); // token 不符＝作廢
  const seq = Array.isArray(stored.seq) ? stored.seq : [];
  const perHit = Number(stored.perHitPct) || PER_HIT_PCT;     // 難度蓋章在題目上
  const chordBase = Number(stored.chordBasePct) || CHORD_BASE_PCT;
  let correct = 0, wrong = 0;
  for (let i = 0; i < seq.length; i++) {
    const inp = String(submitted.inputs[i] || "");
    if (!inp) continue;              // 沒按到的不算錯（超時漏按），只是拿不到加成
    if (inp === seq[i]) correct++;
    else wrong++;
  }
  const perfect = correct === seq.length && seq.length > 0;
  const streak = perfect ? Math.min(STREAK_MAX, (Number(streakBefore) || 0) + 1) : 0;
  const pct = perHit * correct - perHit * wrong + (perfect ? STREAK_PCT * streak : 0);
  const dmgMult = Math.max(DMG_MULT_FLOOR, Math.min(DMG_MULT_CAP, 1 + pct / 100));
  const chordPct = perfect ? chordBase + CHORD_PER_STREAK_PCT * streak : 0;
  const tierTag = stored.tier ? `【${stored.tier}】` : "";
  const note = perfect
    ? `🎼 ${tierTag}完美演奏！傷害 ×${dmgMult.toFixed(2)}（完美連奏 ×${streak}）`
    : (correct + wrong > 0 ? `🎵 ${tierTag}演奏 ${correct} 對 ${wrong} 錯——傷害 ×${dmgMult.toFixed(2)}` : null);
  return { played: true, correct, wrong, perfect, streak, dmgMult, chordPct, note };
}

/** 給前端的題目物件 */
function viewChallenge(challenge) {
  if (!challenge) return null;
  return {
    token: challenge.token, seq: challenge.seq, timeLimitMs: TIME_LIMIT_MS,
    tier: challenge.tier || "簡單", perHitPct: challenge.perHitPct || PER_HIT_PCT,
  };
}

module.exports = {
  DIRS, SEQ_LEN, TIME_LIMIT_MS, PER_HIT_PCT, STREAK_PCT, STREAK_MAX,
  CHORD_BASE_PCT, CHORD_PER_STREAK_PCT, IDLE_MS, SONG_BADGE_IDS, TIERS, LEVELS, AURA_PER_STREAK_PCT,
  hasSong, tierFor, tierAt, levelFromStreak, newChallenge, readStreak, nextStreak, readLevel, auraMult, scorePerformance, viewChallenge,
};
