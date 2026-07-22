"use strict";
/**
 * 世界王暈眩條（矮人戰士長・巨神震擊）。
 *
 * 規則（使用者定案）：
 *   - **只有二轉「矮人戰士長」**能敲；一轉矮人戰士與其他所有職業都敲不動
 *   - 敲擊量＝該場戰鬥中「實際有攻擊到的回合數」（不論武器）
 *     → 15 回合的戰鬥最多敲 15，30 回合最多 30
 *   - 每隻王可各自設定門檻，現有世界王一律 **300**
 *   - **全王共用一條**（不分部位）——暈眩是整隻王倒下，不是某部位麻掉
 *   - 敲滿 → 世界王暈眩 **20 秒**：這段期間**任何人**按下出戰，
 *     那一場怪物整場不出手（＝全程免傷）
 *   - 暈眩結束後 **2 分鐘免疫**，免疫結束才重新出現暈眩條（歸零重敲）
 *   - 單人世界王也有（每人自己一條）——單人王＝世界王的簡化版
 *
 * 為什麼另開一個 collection 而不是塞進 monsterState：
 *   monsterState 是「整份文件 $set」寫回的，多人同時敲會互相覆蓋。
 *   這裡全部走原子 $inc / CAS，多個矮人一起敲不會掉數字、也不會重複觸發暈眩。
 */

const COLLECTION = "worldBossStunGauge";

/** 暈眩持續時間：窗口內按下出戰就整場免傷 */
const STUN_WINDOW_MS = 20 * 1000;

/** 暈眩結束後的免疫時間，之後暈眩條才重新出現 */
const IMMUNE_MS = 2 * 60 * 1000;

/** 預設門檻；各王要單獨調整就加進 THRESHOLD_BY_ZONE */
const DEFAULT_THRESHOLD = 300;

/** 各世界王的暈眩門檻（zoneKey → 值）。目前全部先用預設 300，日後個別調整寫在這裡。 */
const THRESHOLD_BY_ZONE = {
  // elite: 300,               // 大史王
  // dragon_king_lair: 300,    // 古龍王
  // hellfire_depths: 300,     // 地獄狼牙王
};

/** 只有這些二轉徽章能敲暈眩條 */
const KNOCKER_BADGE_IDS = new Set(["job_dwarflord_t2_v1"]); // 矮人戰士長

/** 這個職業徽章能不能敲暈眩條 */
function canKnock(jobEq) {
  if (!jobEq) return false;
  return KNOCKER_BADGE_IDS.has(String(jobEq.itemId || jobEq.id || ""));
}

/** 該王的門檻 */
function thresholdFor(zoneKey) {
  return Math.max(1, Number(THRESHOLD_BY_ZONE[String(zoneKey || "")]) || DEFAULT_THRESHOLD);
}

/**
 * 暈眩條的 key：
 *   共鬥世界王 → zoneKey（全服同一條）
 *   單人世界王 → `solo:<discordId>:<bossKey>`（每人自己一條）
 */
function gaugeKeyForZone(zoneKey) {
  return String(zoneKey || "");
}
function gaugeKeyForSolo(discordId, bossKey) {
  return `solo:${discordId}:${bossKey}`;
}

async function coll() {
  const { getMongoDb } = require("../adapters/mongo/createMongoClient");
  return (await getMongoDb()).collection(COLLECTION);
}

/** 現在處於哪個階段：charging（可敲）/ stunned（暈眩中）/ immune（免疫中） */
function phaseOf(doc, now = Date.now()) {
  const stunnedUntil = Number(doc?.stunnedUntil) || 0;
  const immuneUntil = Number(doc?.immuneUntil) || 0;
  if (now < stunnedUntil) return "stunned";
  if (now < immuneUntil) return "immune";
  return "charging";
}

/**
 * 讀目前狀態（給面板/前端顯示，也給出戰時判定免傷）。
 * @returns {{ gauge, threshold, phase, stunnedRemainMs, immuneRemainMs, stunned }}
 */
async function read(gaugeKey, zoneKey, now = Date.now()) {
  const threshold = thresholdFor(zoneKey);
  let doc = null;
  try {
    doc = await (await coll()).findOne({ _id: String(gaugeKey) });
  } catch (_) { doc = null; }
  const phase = phaseOf(doc, now);
  return {
    gauge: phase === "charging" ? Math.max(0, Math.min(threshold, Number(doc?.gauge) || 0)) : 0,
    threshold,
    phase,
    stunned: phase === "stunned",
    stunnedRemainMs: phase === "stunned" ? Math.max(0, Number(doc.stunnedUntil) - now) : 0,
    immuneRemainMs: phase === "immune" ? Math.max(0, Number(doc.immuneUntil) - now) : 0,
    lastTriggerBy: doc?.lastTriggerBy || null,
  };
}

/**
 * 敲條。只有 charging 階段才會累積（暈眩中／免疫中敲不動）。
 * 全部原子操作：$inc 累加，滿條用條件式 CAS 翻成暈眩 → 多人同時敲只會有一個人觸發成功。
 *
 * @param {string} gaugeKey
 * @param {string} zoneKey     決定門檻
 * @param {number} amount      這場敲掉多少（＝實際有攻擊到的回合數）
 * @param {string} byName      觸發者顯示名（給公告用）
 * @returns {{ knocked:number, gauge:number, threshold:number, triggered:boolean, stunnedUntil:number|null }}
 */
async function knock(gaugeKey, zoneKey, amount, byName = "", now = Date.now()) {
  const threshold = thresholdFor(zoneKey);
  const add = Math.max(0, Math.floor(Number(amount) || 0));
  const id = String(gaugeKey);
  const c = await coll();

  // 暈眩中／免疫中 → 不累積（免疫結束後暈眩條才重新出現）
  const cur = await c.findOne({ _id: id });
  const phase = phaseOf(cur, now);
  if (phase !== "charging") {
    return { knocked: 0, gauge: 0, threshold, triggered: false, stunnedUntil: null, phase };
  }
  // 免疫剛結束的第一次敲擊 → 順手把上一輪的殘值歸零
  if (cur && Number(cur.immuneUntil) > 0 && now >= Number(cur.immuneUntil)) {
    await c.updateOne({ _id: id, immuneUntil: cur.immuneUntil }, { $set: { gauge: 0, immuneUntil: 0, stunnedUntil: 0 } });
  }
  if (add <= 0) {
    const after = await read(id, zoneKey, now);
    return { knocked: 0, gauge: after.gauge, threshold, triggered: false, stunnedUntil: null, phase: "charging" };
  }

  const inc = await c.findOneAndUpdate(
    { _id: id },
    { $inc: { gauge: add }, $set: { updatedAt: new Date().toISOString() } },
    { upsert: true, returnDocument: "after" }
  );
  const doc = inc && (inc.value !== undefined ? inc.value : inc);
  const gauge = Math.max(0, Number(doc?.gauge) || 0);

  if (gauge < threshold) {
    return { knocked: add, gauge, threshold, triggered: false, stunnedUntil: null, phase: "charging" };
  }

  // 滿條 → CAS 觸發暈眩（條件帶「還沒進暈眩/免疫」，確保只有一個請求成功）
  const stunnedUntil = now + STUN_WINDOW_MS;
  const res = await c.updateOne(
    {
      _id: id,
      gauge: { $gte: threshold },
      $or: [{ stunnedUntil: { $lt: now } }, { stunnedUntil: { $exists: false } }, { stunnedUntil: null }],
    },
    {
      $set: {
        gauge: 0,
        stunnedUntil,
        immuneUntil: stunnedUntil + IMMUNE_MS,
        lastTriggerBy: String(byName || ""),
        lastTriggerAt: new Date(now).toISOString(),
        updatedAt: new Date().toISOString(),
      },
    }
  );
  const triggered = res.modifiedCount > 0;
  return {
    knocked: add,
    gauge: triggered ? 0 : gauge,
    threshold,
    triggered,
    stunnedUntil: triggered ? stunnedUntil : null,
    phase: triggered ? "stunned" : "charging",
  };
}

/** 給前端／面板的顯示物件；沒有暈眩條的區域回 null */
function view(state) {
  if (!state) return null;
  return {
    gauge: state.gauge,
    threshold: state.threshold,
    phase: state.phase,
    stunned: state.stunned,
    stunnedRemainMs: state.stunnedRemainMs,
    immuneRemainMs: state.immuneRemainMs,
    windowMs: STUN_WINDOW_MS,
    immuneMs: IMMUNE_MS,
    lastTriggerBy: state.lastTriggerBy || null,
  };
}

/**
 * 敲滿觸發時的全服廣播：網頁走 SSE 即時彈、DC 走城鎮頻道公告。
 * 用 lazy require 避免循環依賴；任何一路失敗都不影響戰鬥流程。
 * 單人王不廣播（只有自己看得到，發全服公告只是洗頻）。
 */
function announceStun({ byName = "", monsterName = "世界王", solo = false } = {}) {
  const who = String(byName || "某位矮人戰士長");
  const secs = Math.round(STUN_WINDOW_MS / 1000);
  if (solo) return;
  const text = `⛰️💥 **${who}** 的【巨神震擊】命中要害——**${monsterName}** 轟然倒地！\n**接下來 ${secs} 秒內出戰的人全程免傷，全軍突擊！**`;
  try {
    require("./announceTownChat").announceTownChat(text).catch(() => {});
  } catch (_) { /* DC 公告失敗不影響戰鬥 */ }
  try {
    const { playerEventBus } = require("../services/realtime/playerEventBus");
    const webPresence = require("../services/realtime/webPresence");
    const data = {
      type: "system",
      title: "⛰️ 巨神震擊！",
      message: `${monsterName} 被 ${who} 震暈，${secs} 秒內出戰全程免傷！`,
      kind: "success",
      ts: Date.now(),
    };
    for (const p of webPresence.list()) {
      try { playerEventBus.emit(p.discordId, { type: "notify", data }); } catch (_) { /* 單人失敗略過 */ }
      try { playerEventBus.invalidateProfile(p.discordId, "boss_stunned"); } catch (_) { /* noop */ }
    }
  } catch (_) { /* SSE 廣播失敗不影響戰鬥 */ }
}

module.exports = {
  announceStun,
  COLLECTION,
  STUN_WINDOW_MS,
  IMMUNE_MS,
  DEFAULT_THRESHOLD,
  THRESHOLD_BY_ZONE,
  KNOCKER_BADGE_IDS,
  canKnock,
  thresholdFor,
  gaugeKeyForZone,
  gaugeKeyForSolo,
  read,
  knock,
  view,
};
