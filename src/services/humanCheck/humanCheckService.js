"use strict";
/**
 * 續航偵測 + 人機驗證（anti auto-clicker）
 * ------------------------------------------------
 * 為什麼看「續航」不看「節奏」：戰鬥有固定演出時間，出手間隔是被遊戲節奏決定的，
 * 連點器和真人的間隔變異都很大 → 節奏規律度分不出來。真正分得出來的是「人會休息、程式不會」：
 * 2026-08 掃描實測有帳號連續 9.3 小時、2775 場，中間連 10 分鐘的中斷都沒有。
 *
 * 規則：
 *   ・連續遊玩（中間沒有 10 分鐘以上的空檔）滿 BASE_CHECK_MS → 出戰時跳一題人機驗證
 *   ・答對 → 續航計時從現在重算，繼續玩（真人只要點一下，成本極低）
 *   ・答錯／逾時 → 暫時擋住出戰，且**累犯會升級**：驗證來得更快、擋得更久
 *   ・停手 10 分鐘 → 連續段自然重置（正常玩家幾乎不會遇到驗證）
 *
 * 狀態存 collection humanChecks，_id = discordId。
 */
const crypto = require("crypto");
const { getMongoDb } = require("../../adapters/mongo/createMongoClient");

const COL = "humanChecks";
const IDLE_RESET_MS = 10 * 60_000;        // 停手多久算「休息過」→ 連續段重置
const BASE_CHECK_MS = 3 * 60 * 60_000;    // 連續玩多久觸發第一次驗證（正常玩家最長連續段實測 1.6~3.1h）
const MIN_CHECK_MS = 20 * 60_000;         // 累犯加嚴後的下限
const ANSWER_TTL_MS = 3 * 60_000;         // 驗證題有效時間
const BASE_BLOCK_MS = 15 * 60_000;        // 答錯的基礎封鎖時間
const MAX_BLOCK_MS = 2 * 60 * 60_000;     // 封鎖上限
const FAIL_WINDOW_MS = 6 * 60 * 60_000;   // 多久內的失敗算「累犯」
const OPTION_COUNT = 5;

let _indexReady = false;
async function col() {
  const db = await getMongoDb();
  const c = db.collection(COL);
  if (!_indexReady) {
    _indexReady = true;
    c.createIndex({ last: -1 }).catch(() => {});
    c.createIndex({ "stats.fails": -1 }).catch(() => {});
  }
  return c;
}

function recentFailCount(doc, now) {
  const fails = Array.isArray(doc?.stats?.failAt) ? doc.stats.failAt : [];
  return fails.filter((t) => now - Number(t) < FAIL_WINDOW_MS).length;
}

// 累犯加嚴：驗證間隔隨近期失敗次數縮短，封鎖時間隨之加倍
function checkIntervalMs(failCount) {
  return Math.max(MIN_CHECK_MS, Math.round(BASE_CHECK_MS / (1 + failCount)));
}
function blockMs(failCount) {
  return Math.min(MAX_BLOCK_MS, BASE_BLOCK_MS * Math.pow(2, Math.min(failCount, 3)));
}

function buildChallenge() {
  const pool = new Set();
  while (pool.size < OPTION_COUNT) pool.add(2 + Math.floor(Math.random() * 96));
  const options = [...pool];
  const answerIdx = Math.floor(Math.random() * options.length);
  return {
    token: crypto.randomUUID().slice(0, 8),
    answer: answerIdx,
    options,
    prompt: `請點選數字 **${options[answerIdx]}**`,
  };
}

/**
 * 出戰前呼叫。同時記錄活動、判斷是否要驗證。
 * @returns {Promise<{ok:true}|{ok:false,kind:"blocked",untilMs:number,failCount:number}
 *   |{ok:false,kind:"challenge",token:string,prompt:string,options:number[]}>}
 */
async function guard(discordId) {
  if (!discordId) return { ok: true };
  try {
    const c = await col();
    const now = Date.now();
    const doc = await c.findOne({ _id: discordId });
    const failCount = recentFailCount(doc, now);

    // ── 封鎖中 ──
    const blockedUntil = Number(doc?.blockedUntil) || 0;
    if (blockedUntil > now) {
      return { ok: false, kind: "blocked", untilMs: blockedUntil, failCount };
    }

    // ── 已有未答的題目 ──
    const pending = doc?.pending || null;
    if (pending?.token) {
      if (now - Number(pending.issuedAt || 0) > ANSWER_TTL_MS) {
        // 逾時未答＝視同失敗（連點器不會回答）
        const until = now + blockMs(failCount);
        await c.updateOne({ _id: discordId }, {
          $set: { pending: null, blockedUntil: until },
          $push: { "stats.failAt": now },
          $inc: { "stats.fails": 1 },
        });
        console.log(`[humanCheck] ⛔ ${discordId} 驗證逾時未答，封鎖至 ${new Date(until).toISOString()}`);
        return { ok: false, kind: "blocked", untilMs: until, failCount: failCount + 1 };
      }
      return { ok: false, kind: "challenge", token: pending.token, prompt: pending.prompt, options: pending.options };
    }

    // ── 續航計時 ──
    const last = Number(doc?.last) || 0;
    let start = Number(doc?.start) || 0;
    if (!start || !last || (now - last) >= IDLE_RESET_MS) start = now; // 休息過 → 重新算
    const anchor = Math.max(start, Number(doc?.lastPassAt) || 0);
    const streakMs = now - anchor;

    if (streakMs >= checkIntervalMs(failCount)) {
      const ch = buildChallenge();
      await c.updateOne({ _id: discordId }, {
        $set: {
          start, last: now,
          pending: { token: ch.token, answer: ch.answer, options: ch.options, prompt: ch.prompt, issuedAt: now },
        },
        $inc: { "stats.challenges": 1 },
      }, { upsert: true });
      console.log(`[humanCheck] 🧩 ${discordId} 連續遊玩 ${(streakMs / 3600_000).toFixed(1)}h → 發出驗證（近期失敗 ${failCount} 次）`);
      return { ok: false, kind: "challenge", token: ch.token, prompt: ch.prompt, options: ch.options };
    }

    await c.updateOne({ _id: discordId }, { $set: { start, last: now } }, { upsert: true });
    return { ok: true };
  } catch (e) {
    // 偵測系統故障絕不擋正常玩家
    console.warn("[humanCheck] guard 失敗，放行：", e?.message || e);
    return { ok: true };
  }
}

/**
 * 玩家作答。
 * @returns {Promise<{ok:true}|{ok:false,kind:"none"|"expired"|"wrong",untilMs?:number}>}
 */
async function verify(discordId, token, choiceIdx) {
  try {
    const c = await col();
    const now = Date.now();
    const doc = await c.findOne({ _id: discordId });
    const pending = doc?.pending || null;
    if (!pending?.token || pending.token !== String(token)) return { ok: false, kind: "none" };

    const failCount = recentFailCount(doc, now);
    if (now - Number(pending.issuedAt || 0) > ANSWER_TTL_MS) {
      const until = now + blockMs(failCount);
      await c.updateOne({ _id: discordId }, {
        $set: { pending: null, blockedUntil: until },
        $push: { "stats.failAt": now }, $inc: { "stats.fails": 1 },
      });
      return { ok: false, kind: "expired", untilMs: until };
    }

    if (Number(choiceIdx) !== Number(pending.answer)) {
      const until = now + blockMs(failCount);
      await c.updateOne({ _id: discordId }, {
        $set: { pending: null, blockedUntil: until },
        $push: { "stats.failAt": now }, $inc: { "stats.fails": 1 },
      });
      console.log(`[humanCheck] ❌ ${discordId} 驗證答錯，封鎖 ${Math.round(blockMs(failCount) / 60000)} 分鐘`);
      return { ok: false, kind: "wrong", untilMs: until };
    }

    // 答對：續航計時從現在重算
    await c.updateOne({ _id: discordId }, {
      $set: { pending: null, blockedUntil: 0, lastPassAt: now, start: now, last: now },
      $inc: { "stats.passes": 1 },
    });
    console.log(`[humanCheck] ✅ ${discordId} 驗證通過`);
    return { ok: true };
  } catch (e) {
    console.warn("[humanCheck] verify 失敗，放行：", e?.message || e);
    return { ok: true };
  }
}

/** 唯讀：給後台/腳本看狀態，不寫入 */
async function peek(discordId) {
  try {
    const doc = await (await col()).findOne({ _id: discordId });
    if (!doc) return null;
    const now = Date.now();
    return {
      streakMs: Math.max(0, now - Math.max(Number(doc.start) || now, Number(doc.lastPassAt) || 0)),
      blockedUntil: Number(doc.blockedUntil) || 0,
      pending: !!doc.pending,
      recentFails: recentFailCount(doc, now),
      stats: doc.stats || {},
    };
  } catch (_) { return null; }
}

/**
 * 把 guard() 的擋下結果轉成網頁 API 回應（DC 端不用這個，另有按鈕 UI）。
 * 兩種 code：human_check_required 帶題目、human_check_blocked 只帶解除時間。
 */
function webPayload(gate) {
  if (gate.kind === "blocked") {
    const mins = Math.max(1, Math.ceil((Number(gate.untilMs) - Date.now()) / 60000));
    return {
      status: "error",
      code: "human_check_blocked",
      message: `人機驗證未通過，請 ${mins} 分鐘後再出戰。`,
      untilMs: Number(gate.untilMs) || 0,
    };
  }
  return {
    status: "error",
    code: "human_check_required",
    message: "你已經連續遊玩很長一段時間了，請完成一次確認再繼續。",
    challenge: { token: gate.token, prompt: gate.prompt, options: gate.options },
  };
}

module.exports = {
  guard, verify, peek, webPayload,
  IDLE_RESET_MS, BASE_CHECK_MS, ANSWER_TTL_MS,
};
