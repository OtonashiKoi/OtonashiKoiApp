"use strict";
/**
 * 區域冰凍值（元素師・凍霜姿態）。
 *
 * 規則（使用者定案 2026-07-23）：
 *   - **只有二轉「元素師」用凍霜姿態出戰**能累積冰凍值；其他職業/姿態都不行
 *   - 累積量＝該場戰鬥的「回合數」（**不論是否命中**——法師命中率低，用命中回合會被雙重懲罰）
 *   - **任何區域都適用**（一般區、世界王、單人王）；每區各自一條
 *   - 凍滿（預設 300）→ 區域冰封 **20 秒**：這段期間**任何人**按下出戰，
 *     那一場怪物整場無法造成傷害（＝全程免傷，與巨神震擊同通道、不同文案）
 *   - 冰封結束後 **2 分鐘免疫**，免疫結束冰凍值歸零重新累積
 *   - **與矮人暈眩條完全分開**（獨立 collection、獨立條）——矮人在場也互不干擾
 *   - **不做全服廣播**（使用者定案；只有戰報與區域顯示）
 *
 * 儲存與原子性同 dwarfStunGauge：獨立 collection、$inc 累加、滿條 CAS 翻冰封，
 * 多個元素師同時打不會掉數字、也不會重複觸發。
 */

const COLLECTION = "zoneFreezeGauge";

/** 冰封持續時間：窗口內按下出戰就整場免傷 */
const FREEZE_WINDOW_MS = 20 * 1000;

/** 冰封結束後的免疫時間，之後冰凍值才重新累積 */
const IMMUNE_MS = 2 * 60 * 1000;

/** 預設門檻；個別區域要調整就加進 THRESHOLD_BY_ZONE
 *  300→150（2026-07-23 校準：法師命中回合少，300 要 141 場才凍滿形同不存在；
 *  同時累積量改「戰鬥回合數（不論命中）」，見各呼叫端） */
const DEFAULT_THRESHOLD = 150;
const THRESHOLD_BY_ZONE = {};

/** 只有這些二轉徽章能累積冰凍值（還需要凍霜姿態，姿態判定在呼叫端） */
const KNOCKER_BADGE_IDS = new Set(["job_elementalist_t2_v1"]); // 元素師

function canKnock(jobEq) {
  if (!jobEq) return false;
  return KNOCKER_BADGE_IDS.has(String(jobEq.itemId || jobEq.id || ""));
}

function thresholdFor(zoneKey) {
  return Math.max(1, Number(THRESHOLD_BY_ZONE[String(zoneKey || "")]) || DEFAULT_THRESHOLD);
}

/**
 * 冰凍值的 key：
 *   一般區／共鬥世界王 → zoneKey（全服同一條）
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

/** 現在處於哪個階段：charging（可累積）/ frozen（冰封中）/ immune（免疫中） */
function phaseOf(doc, now = Date.now()) {
  const frozenUntil = Number(doc?.frozenUntil) || 0;
  const immuneUntil = Number(doc?.immuneUntil) || 0;
  if (now < frozenUntil) return "frozen";
  if (now < immuneUntil) return "immune";
  return "charging";
}

/** 讀目前狀態（顯示＋出戰時判定免傷） */
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
    frozen: phase === "frozen",
    frozenRemainMs: phase === "frozen" ? Math.max(0, Number(doc.frozenUntil) - now) : 0,
    immuneRemainMs: phase === "immune" ? Math.max(0, Number(doc.immuneUntil) - now) : 0,
    lastTriggerBy: doc?.lastTriggerBy || null,
  };
}

/**
 * 累積冰凍值。只有 charging 階段會累積；滿條 CAS 翻冰封（多人同時只有一個觸發成功）。
 * @returns {{ knocked, gauge, threshold, triggered, frozenUntil, phase }}
 */
async function knock(gaugeKey, zoneKey, amount, byName = "", now = Date.now()) {
  const threshold = thresholdFor(zoneKey);
  const add = Math.max(0, Math.floor(Number(amount) || 0));
  const id = String(gaugeKey);
  const c = await coll();

  const cur = await c.findOne({ _id: id });
  const phase = phaseOf(cur, now);
  if (phase !== "charging") {
    return { knocked: 0, gauge: 0, threshold, triggered: false, frozenUntil: null, phase };
  }
  if (cur && Number(cur.immuneUntil) > 0 && now >= Number(cur.immuneUntil)) {
    await c.updateOne({ _id: id, immuneUntil: cur.immuneUntil }, { $set: { gauge: 0, immuneUntil: 0, frozenUntil: 0 } });
  }
  if (add <= 0) {
    const after = await read(id, zoneKey, now);
    return { knocked: 0, gauge: after.gauge, threshold, triggered: false, frozenUntil: null, phase: "charging" };
  }

  const inc = await c.findOneAndUpdate(
    { _id: id },
    { $inc: { gauge: add }, $set: { updatedAt: new Date().toISOString() } },
    { upsert: true, returnDocument: "after" }
  );
  const doc = inc && (inc.value !== undefined ? inc.value : inc);
  const gauge = Math.max(0, Number(doc?.gauge) || 0);

  if (gauge < threshold) {
    return { knocked: add, gauge, threshold, triggered: false, frozenUntil: null, phase: "charging" };
  }

  const frozenUntil = now + FREEZE_WINDOW_MS;
  const res = await c.updateOne(
    {
      _id: id,
      gauge: { $gte: threshold },
      $or: [{ frozenUntil: { $lt: now } }, { frozenUntil: { $exists: false } }, { frozenUntil: null }],
    },
    {
      $set: {
        gauge: 0,
        frozenUntil,
        immuneUntil: frozenUntil + IMMUNE_MS,
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
    frozenUntil: triggered ? frozenUntil : null,
    phase: triggered ? "frozen" : "charging",
  };
}

/** 給前端／面板的顯示物件 */
function view(state) {
  if (!state) return null;
  return {
    gauge: state.gauge,
    threshold: state.threshold,
    phase: state.phase,
    frozen: state.frozen,
    frozenRemainMs: state.frozenRemainMs,
    immuneRemainMs: state.immuneRemainMs,
    windowMs: FREEZE_WINDOW_MS,
    immuneMs: IMMUNE_MS,
    lastTriggerBy: state.lastTriggerBy || null,
  };
}

module.exports = {
  COLLECTION,
  FREEZE_WINDOW_MS,
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
