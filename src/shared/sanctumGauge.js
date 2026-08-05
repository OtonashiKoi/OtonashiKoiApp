"use strict";
/**
 * 區域聖域值（聖域師・結界師二轉）。
 *
 * 規則（使用者定案 2026-07-23）：
 *   - **只有二轉「聖域師」出戰**能累積聖域值（每場 +1）
 *   - 任何區域都適用（一般區、世界王、單人王）；每區各自一條
 *   - 累滿（4 格）→ 區域進入 **20 秒聖域**：這段期間**任何人**按下出戰，
 *     那一場受到傷害 **-50%**、每回合回復最大 HP 3%（含 DC 玩家；效果吃得到、DC 不發公告）
 *   - 聖域期間聖域師自己給隊伍的光環 ×2（route 層快照，與精靈在場/演奏加持同管線）
 *   - 聖域結束後 **2 分鐘免疫**，免疫結束聖域值歸零重新累積
 *   - 與矮人暈眩條／元素師冰凍值完全分開（獨立 collection、獨立條）
 *   - **不做任何廣播**（使用者定案：只顯示在網頁畫面）
 *
 * 儲存與原子性同 zoneFreezeGauge：獨立 collection、$inc 累加、滿條 CAS 翻聖域，
 * 多個聖域師同時打不會掉數字、也不會重複觸發。
 */

const COLLECTION = "zoneSanctumGauge";

/** 聖域持續時間：窗口內按下出戰就整場受傷減半＋回血 */
const SANCTUM_WINDOW_MS = 20 * 1000;

/** 聖域結束後的免疫時間，之後聖域值才重新累積 */
const IMMUNE_MS = 2 * 60 * 1000;

/** 預設門檻：4 格（每場 +1 → 4 場開一次聖域，再吃 2 分鐘免疫節流） */
const DEFAULT_THRESHOLD = 4;
const THRESHOLD_BY_ZONE = {};

/** 只有這些二轉徽章能累積聖域值 */
const KNOCKER_BADGE_IDS = new Set(["job_sanctum_t2_v1"]); // 聖域師

function canKnock(jobEq) {
  if (!jobEq) return false;
  return KNOCKER_BADGE_IDS.has(String(jobEq.itemId || jobEq.id || ""));
}

function thresholdFor(zoneKey) {
  return Math.max(1, Number(THRESHOLD_BY_ZONE[String(zoneKey || "")]) || DEFAULT_THRESHOLD);
}

/**
 * 聖域值的 key：
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

/** 現在處於哪個階段：charging（可累積）/ sanctum（聖域中）/ immune（免疫中） */
function phaseOf(doc, now = Date.now()) {
  const sanctumUntil = Number(doc?.sanctumUntil) || 0;
  const immuneUntil = Number(doc?.immuneUntil) || 0;
  if (now < sanctumUntil) return "sanctum";
  if (now < immuneUntil) return "immune";
  return "charging";
}

/** 讀目前狀態（顯示＋出戰時判定護佑） */
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
    sanctum: phase === "sanctum",
    sanctumRemainMs: phase === "sanctum" ? Math.max(0, Number(doc.sanctumUntil) - now) : 0,
    immuneRemainMs: phase === "immune" ? Math.max(0, Number(doc.immuneUntil) - now) : 0,
    lastTriggerBy: doc?.lastTriggerBy || null,
  };
}

/**
 * 累積聖域值。只有 charging 階段會累積；滿條 CAS 翻聖域（多人同時只有一個觸發成功）。
 * @returns {{ knocked, gauge, threshold, triggered, sanctumUntil, phase }}
 */
async function knock(gaugeKey, zoneKey, amount, byName = "", now = Date.now()) {
  const threshold = thresholdFor(zoneKey);
  const add = Math.max(0, Math.floor(Number(amount) || 0));
  const id = String(gaugeKey);
  const c = await coll();

  const cur = await c.findOne({ _id: id });
  const phase = phaseOf(cur, now);
  if (phase !== "charging") {
    return { knocked: 0, gauge: 0, threshold, triggered: false, sanctumUntil: null, phase };
  }
  if (cur && Number(cur.immuneUntil) > 0 && now >= Number(cur.immuneUntil)) {
    await c.updateOne({ _id: id, immuneUntil: cur.immuneUntil }, { $set: { gauge: 0, immuneUntil: 0, sanctumUntil: 0 } });
  }
  if (add <= 0) {
    const after = await read(id, zoneKey, now);
    return { knocked: 0, gauge: after.gauge, threshold, triggered: false, sanctumUntil: null, phase: "charging" };
  }

  const inc = await c.findOneAndUpdate(
    { _id: id },
    { $inc: { gauge: add }, $set: { updatedAt: new Date().toISOString() } },
    { upsert: true, returnDocument: "after" }
  );
  const doc = inc && (inc.value !== undefined ? inc.value : inc);
  const gauge = Math.max(0, Number(doc?.gauge) || 0);

  if (gauge < threshold) {
    return { knocked: add, gauge, threshold, triggered: false, sanctumUntil: null, phase: "charging" };
  }

  const sanctumUntil = now + SANCTUM_WINDOW_MS;
  const res = await c.updateOne(
    {
      _id: id,
      gauge: { $gte: threshold },
      $or: [{ sanctumUntil: { $lt: now } }, { sanctumUntil: { $exists: false } }, { sanctumUntil: null }],
    },
    {
      $set: {
        gauge: 0,
        sanctumUntil,
        immuneUntil: sanctumUntil + IMMUNE_MS,
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
    sanctumUntil: triggered ? sanctumUntil : null,
    phase: triggered ? "sanctum" : "charging",
  };
}

/** 給前端／面板的顯示物件 */
function view(state) {
  if (!state) return null;
  return {
    gauge: state.gauge,
    threshold: state.threshold,
    phase: state.phase,
    sanctum: state.sanctum,
    sanctumRemainMs: state.sanctumRemainMs,
    immuneRemainMs: state.immuneRemainMs,
    windowMs: SANCTUM_WINDOW_MS,
    immuneMs: IMMUNE_MS,
    lastTriggerBy: state.lastTriggerBy || null,
  };
}

module.exports = {
  COLLECTION,
  SANCTUM_WINDOW_MS,
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
