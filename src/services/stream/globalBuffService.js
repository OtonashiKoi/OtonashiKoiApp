// 全服活動狀態核心 Global Buff
// ------------------------------------------------
// 直播連動事件第二階段的地基：一個「全服生效中的加成」狀態。
// 戰鬥結算時讀 getActiveModifiers() 疊上去，所有玩家自動吃到。
//
// 讀取極高頻（每場戰鬥），故用記憶體快取：
//   - 啟動載入一次；apply/clear 後立即刷新；另每 5 分鐘安全重載
//   - getActiveModifiers() 純記憶體 + 依 endsAt 即時過濾，不打 DB
// 寫入低頻（斗內觸發 / 後台手動），才碰 DB。

const { getMongoDb } = require("../../adapters/mongo/createMongoClient");

const COLLECTION = "serverBuffs";
const REFRESH_MS = 5 * 60 * 1000;

let cache = [];            // 目前 DB 裡「尚未過期」的 buff 快照
let refreshTimer = null;
let loaded = false;

function now() { return Date.now(); }

function isActive(buff) {
  const ends = buff?.endsAt ? Date.parse(buff.endsAt) : 0;
  return ends > now();
}

async function refresh() {
  const db = await getMongoDb().catch(() => null);
  if (!db) return;
  try {
    const nowIso = new Date().toISOString();
    cache = await db.collection(COLLECTION)
      .find({ endsAt: { $gt: nowIso } })
      .sort({ endsAt: 1 })
      .toArray();
    loaded = true;
  } catch (err) {
    console.warn("[GlobalBuff] refresh 失敗：", err?.message || err);
  }
}

/** 啟動時呼叫一次；設定安全重載 timer */
async function init() {
  await refresh();
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => { refresh().catch(() => {}); }, REFRESH_MS);
  refreshTimer.unref?.();
  console.log(`[GlobalBuff] 初始化完成，生效中 ${cache.filter(isActive).length} 個 buff`);
}

/**
 * 目前全服生效加成（把所有未過期 buff 的 % 相加）。純記憶體、同步。
 * @returns {{ dropPct:number, goldPct:number, expPct:number, buffs:Array }}
 */
function getActiveModifiers() {
  let dropPct = 0, goldPct = 0, expPct = 0;
  const active = [];
  for (const b of cache) {
    if (!isActive(b)) continue;
    dropPct += Number(b.dropPct) || 0;
    goldPct += Number(b.goldPct) || 0;
    expPct += Number(b.expPct) || 0;
    active.push(b);
  }
  return { dropPct, goldPct, expPct, buffs: active };
}

/**
 * 套用一個全服 buff。
 * @param {object} p
 * @param {string} p.label 顯示名稱
 * @param {string} p.source 來源標記（donation / manual / milestone…）
 * @param {string} [p.sourceRef] 冪等鍵（同 ref 已存在生效中則不重複套用）
 * @param {number} [p.dropPct]
 * @param {number} [p.goldPct]
 * @param {number} [p.expPct]
 * @param {number} p.durationMs 持續毫秒
 * @param {string} [p.createdBy]
 * @returns {Promise<{applied:boolean, buff?:object, reason?:string}>}
 */
async function applyBuff(p) {
  const db = await getMongoDb().catch(() => null);
  if (!db) return { applied: false, reason: "no-db" };
  const durationMs = Number(p.durationMs) || 0;
  if (durationMs <= 0) return { applied: false, reason: "bad-duration" };
  const drop = Number(p.dropPct) || 0, gold = Number(p.goldPct) || 0, exp = Number(p.expPct) || 0;
  if (drop <= 0 && gold <= 0 && exp <= 0) return { applied: false, reason: "no-effect" };

  const nowMs = now();
  const nowIso = new Date(nowMs).toISOString();
  const endsAt = new Date(nowMs + durationMs).toISOString();

  // 冪等：同 sourceRef 且仍生效中 → 不重複套用（斗內事件重觸發保護）
  if (p.sourceRef) {
    const dup = await db.collection(COLLECTION).findOne({ sourceRef: p.sourceRef, endsAt: { $gt: nowIso } });
    if (dup) return { applied: false, reason: "duplicate", buff: dup };
  }

  const buff = {
    id: `buff_${nowMs}_${Math.floor((nowMs % 100000))}`,
    label: String(p.label || "全服加成"),
    source: String(p.source || "manual"),
    sourceRef: p.sourceRef || null,
    dropPct: drop, goldPct: gold, expPct: exp,
    startedAt: nowIso,
    endsAt,
    createdBy: p.createdBy || null
  };
  try {
    await db.collection(COLLECTION).insertOne(buff);
  } catch (err) {
    console.warn("[GlobalBuff] applyBuff 寫入失敗：", err?.message || err);
    return { applied: false, reason: "write-failed" };
  }
  await refresh();
  console.log(`[GlobalBuff] 套用 ${buff.label}（掉寶+${drop}/金幣+${gold}/經驗+${exp}%，${Math.round(durationMs / 60000)}分）source=${buff.source}`);
  return { applied: true, buff };
}

/** 列出目前生效中（給後台/前端顯示） */
function listActive() {
  return getActiveModifiers().buffs.map((b) => ({ ...b }));
}

/** 列出最近的 buff（含已過期，給後台稽核） */
async function listRecent({ limit = 50 } = {}) {
  const db = await getMongoDb().catch(() => null);
  if (!db) return [];
  return db.collection(COLLECTION).find({}).sort({ startedAt: -1 }).limit(Math.min(Number(limit) || 50, 200)).toArray();
}

/** 提前結束某個 buff（設 endsAt=now） */
async function clearBuff(id) {
  const db = await getMongoDb().catch(() => null);
  if (!db) return { cleared: false };
  await db.collection(COLLECTION).updateOne({ id }, { $set: { endsAt: new Date().toISOString() } });
  await refresh();
  return { cleared: true };
}

/** 清掉所有生效中 buff */
async function clearAll() {
  const db = await getMongoDb().catch(() => null);
  if (!db) return { cleared: 0 };
  const nowIso = new Date().toISOString();
  const r = await db.collection(COLLECTION).updateMany({ endsAt: { $gt: nowIso } }, { $set: { endsAt: nowIso } });
  await refresh();
  return { cleared: r.modifiedCount || 0 };
}

module.exports = {
  init,
  refresh,
  getActiveModifiers,
  applyBuff,
  listActive,
  listRecent,
  clearBuff,
  clearAll
};
