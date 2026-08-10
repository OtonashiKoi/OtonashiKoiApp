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
const FAR_FUTURE = "2099-12-31T00:00:00.000Z"; // 賽季永久 buff 的 endsAt（實質不過期，換季才由 resetSeason 清）

let cache = [];            // 目前 DB 裡「尚未過期」的 buff 快照
let refreshTimer = null;
let loaded = false;
let shortTermCapPct = 30;  // 短期 buff 每類型加成上限（config 可調，init/saveConfig 時經 setShortTermCapPct 注入）

function now() { return Date.now(); }

/** 設定短期 buff 每類型上限（斗內即時尖峰用；賽季永久底盤不受此限） */
function setShortTermCapPct(n) {
  const v = Number(n);
  if (Number.isFinite(v) && v > 0) shortTermCapPct = v;
}

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
  // 三層相加：賽季永久底盤(不封頂) + 斗內/手動短期尖峰(自己一桶,每類型封頂) + 觀看熱度(自己一桶,獨立封頂)。
  // 觀看熱度與斗內拆成兩個獨立封頂桶 → 兩者可疊加(斗內封頂 30% 後,觀看再加上去不會被砍掉)。
  let pDrop = 0, pGold = 0, pExp = 0;   // 永久底盤
  let sDrop = 0, sGold = 0, sExp = 0;   // 斗內 + 手動活動 + 里程碑等短期
  let vDrop = 0, vGold = 0, vExp = 0;   // 觀看熱度(viewer-session)
  const active = [];
  for (const b of cache) {
    if (!isActive(b)) continue;
    active.push(b);
    if (b.seasonPermanent) {
      pDrop += Number(b.dropPct) || 0; pGold += Number(b.goldPct) || 0; pExp += Number(b.expPct) || 0;
    } else if (b.source === VIEWER_SESSION_SOURCE) {
      vDrop += Number(b.dropPct) || 0; vGold += Number(b.goldPct) || 0; vExp += Number(b.expPct) || 0;
    } else {
      sDrop += Number(b.dropPct) || 0; sGold += Number(b.goldPct) || 0; sExp += Number(b.expPct) || 0;
    }
  }
  // 斗內/手動短期尖峰封頂（各類型）
  sDrop = Math.min(sDrop, shortTermCapPct);
  sGold = Math.min(sGold, shortTermCapPct);
  sExp = Math.min(sExp, shortTermCapPct);
  // 觀看熱度獨立封頂（各類型；tier 設定本身就低,這裡只是防呆上限）
  vDrop = Math.min(vDrop, shortTermCapPct);
  vGold = Math.min(vGold, shortTermCapPct);
  vExp = Math.min(vExp, shortTermCapPct);
  // 斗內/手動短期 buff 最晚結束時間（給前端斗內倒數；觀看熱度另計,不污染斗內倒數）
  let shortTermEndsAt = null;
  for (const b of active) {
    if (b.seasonPermanent || b.source === VIEWER_SESSION_SOURCE) continue;
    if (!shortTermEndsAt || b.endsAt > shortTermEndsAt) shortTermEndsAt = b.endsAt;
  }
  return {
    dropPct: pDrop + sDrop + vDrop, goldPct: pGold + sGold + vGold, expPct: pExp + sExp + vExp,
    permanent: { dropPct: pDrop, goldPct: pGold, expPct: pExp },
    shortTerm: { dropPct: sDrop, goldPct: sGold, expPct: sExp, endsAt: shortTermEndsAt },
    viewer: { dropPct: vDrop, goldPct: vGold, expPct: vExp },
    capPct: shortTermCapPct,
    buffs: active,
  };
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
  const isPerm = p.seasonPermanent === true;   // 賽季永久底盤：不計時，換季才清
  const durationMs = Number(p.durationMs) || 0;
  if (!isPerm && durationMs <= 0) return { applied: false, reason: "bad-duration" };
  const drop = Number(p.dropPct) || 0, gold = Number(p.goldPct) || 0, exp = Number(p.expPct) || 0;
  if (drop <= 0 && gold <= 0 && exp <= 0) return { applied: false, reason: "no-effect" };

  const nowMs = now();
  const nowIso = new Date(nowMs).toISOString();
  const endsAt = isPerm ? FAR_FUTURE : new Date(nowMs + durationMs).toISOString();

  // 冪等：同 sourceRef 且仍生效中 → 不重複套用（斗內事件重觸發／里程碑重複達成保護）
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
    seasonPermanent: isPerm,
    seasonKey: p.seasonKey || null,
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

/** 清掉某來源的賽季永久底盤（階梯取代用：升階前先清舊底盤，再套新的最高階）。 */
async function clearBySource(source) {
  const db = await getMongoDb().catch(() => null);
  if (!db) return { cleared: 0 };
  const r = await db.collection(COLLECTION).deleteMany({ source: String(source), seasonPermanent: true });
  await refresh();
  return { cleared: r.deletedCount || 0 };
}

/** 換季重置：預設連仍生效的短期直播加成都結束，讓新季從乾淨狀態開始。 */
async function resetSeason({ clearShortTerm = true } = {}) {
  const db = await getMongoDb().catch(() => null);
  if (!db) return { cleared: 0 };
  const nowIso = new Date().toISOString();
  const permanent = await db.collection(COLLECTION).deleteMany({ seasonPermanent: true });
  const shortTerm = clearShortTerm
    ? await db.collection(COLLECTION).updateMany(
      { seasonPermanent: { $ne: true }, endsAt: { $gt: nowIso } },
      { $set: { endsAt: nowIso, endedReason: "season_reset" } }
    )
    : { modifiedCount: 0 };
  await refresh();
  console.log(`[GlobalBuff] 換季重置：清除 ${permanent.deletedCount || 0} 個賽季永久底盤，結束 ${shortTerm.modifiedCount || 0} 個短期加成`);
  return { clearedPermanent: permanent.deletedCount || 0, endedShortTerm: shortTerm.modifiedCount || 0 };
}

// ── 斗內累積 session buff（單一、覆寫式；不走 applyBuff 的疊加）──
const DONATION_SESSION_SOURCE = "donation-session";

/** 目前生效中的斗內累積 session（單一 buff），無則 null。 */
function getDonationSession() {
  const nowMs = now();
  return cache.find((b) => b.source === DONATION_SESSION_SOURCE && Date.parse(b.endsAt) > nowMs) || null;
}

/** 斗內全服 buff 是否生效中。 */
function isDonationBuffActive() {
  return !!getDonationSession();
}

/**
 * 是否有「任何短期全服 buff」生效中（疲勞系統用來暫停懲罰）。
 * 涵蓋斗內 session、手動全服活動、會員短期慶祝等；不含賽季永久底盤
 * （永久底盤一直在，若也算就會讓防肝疲勞系統永遠失效）。
 */
function isShortTermBuffActive() {
  const nowMs = now();
  return cache.some((b) =>
    b && !b.seasonPermanent && Date.parse(b.endsAt) > nowMs &&
    ((Number(b.dropPct) || 0) > 0 || (Number(b.goldPct) || 0) > 0 || (Number(b.expPct) || 0) > 0)
  );
}

/**
 * 覆寫式設定斗內累積 session buff（取代舊的，各類型同 pct）。
 * @param {{ pct:number, endsAtMs:number, cumTwd:number, label?:string, processedRefs?:string[] }} p
 */
async function setDonationSessionBuff(p) {
  const db = await getMongoDb().catch(() => null);
  if (!db) return { applied: false, reason: "no-db" };
  const pct = Math.max(0, Math.round(Number(p.pct) || 0));
  if (pct <= 0 || !(Number(p.endsAtMs) > now())) return { applied: false, reason: "no-effect" };
  const nowMs = now();
  const buff = {
    id: `donsess_${nowMs}`,
    label: String(p.label || "斗內全服加成"),
    source: DONATION_SESSION_SOURCE,
    sourceRef: DONATION_SESSION_SOURCE,
    dropPct: pct, goldPct: pct, expPct: pct,
    seasonPermanent: false,
    startedAt: new Date(nowMs).toISOString(),
    endsAt: new Date(Number(p.endsAtMs)).toISOString(),
    cumTwd: Math.max(0, Math.round(Number(p.cumTwd) || 0)),
    processedRefs: Array.isArray(p.processedRefs) ? p.processedRefs.slice(-50) : [],
    createdBy: "stream:donation-session",
  };
  try {
    await db.collection(COLLECTION).deleteMany({ source: DONATION_SESSION_SOURCE });
    await db.collection(COLLECTION).insertOne(buff);
  } catch (err) {
    console.warn("[GlobalBuff] setDonationSessionBuff 失敗：", err?.message || err);
    return { applied: false, reason: "write-failed" };
  }
  await refresh();
  return { applied: true, buff };
}

// ── 觀看人數 session buff（單一、覆寫式；只保留當前最高階觀看熱度 buff，不疊加）──
const VIEWER_SESSION_SOURCE = "viewer-session";

/** 目前生效中的觀看熱度 session（單一 buff），無則 null。 */
function getViewerSession() {
  const nowMs = now();
  return cache.find((b) => b.source === VIEWER_SESSION_SOURCE && Date.parse(b.endsAt) > nowMs) || null;
}

/**
 * 清掉觀看熱度 session buff。
 * 開機時呼叫：觀看 buff 只該在直播當下存在，重啟後沒有直播上下文，殘留的 session 會卡在最高階
 * （不降階 + 每輪續命 → 永不過期、且擋掉之後的「開啟加成」廣播）。開機清掉，讓 evaluate() 依當下人數重新觸發。
 */
async function clearViewerSession() {
  const db = await getMongoDb().catch(() => null);
  if (!db) return { cleared: 0 };
  const r = await db.collection(COLLECTION).deleteMany({ source: VIEWER_SESSION_SOURCE });
  await refresh();
  if (r.deletedCount) console.log(`[GlobalBuff] 開機清除殘留觀看熱度 session ${r.deletedCount} 筆`);
  return { cleared: r.deletedCount || 0 };
}

/**
 * 覆寫式設定觀看熱度 session buff（取代舊的，升級/重新計時用）。
 * @param {{ dropPct:number, goldPct:number, expPct:number, endsAtMs:number, tierMin:number, label?:string }} p
 */
async function setViewerSessionBuff(p) {
  const db = await getMongoDb().catch(() => null);
  if (!db) return { applied: false, reason: "no-db" };
  const drop = Math.max(0, Math.round(Number(p.dropPct) || 0));
  const gold = Math.max(0, Math.round(Number(p.goldPct) || 0));
  const exp = Math.max(0, Math.round(Number(p.expPct) || 0));
  if (drop <= 0 && gold <= 0 && exp <= 0) return { applied: false, reason: "no-effect" };
  if (!(Number(p.endsAtMs) > now())) return { applied: false, reason: "bad-duration" };
  const nowMs = now();
  const buff = {
    id: `viewsess_${nowMs}`,
    label: String(p.label || "觀看熱度加成"),
    source: VIEWER_SESSION_SOURCE,
    sourceRef: VIEWER_SESSION_SOURCE,
    dropPct: drop, goldPct: gold, expPct: exp,
    seasonPermanent: false,
    startedAt: new Date(nowMs).toISOString(),
    endsAt: new Date(Number(p.endsAtMs)).toISOString(),
    tierMin: Math.max(0, Math.round(Number(p.tierMin) || 0)),
    createdBy: "stream:viewer-session",
  };
  try {
    await db.collection(COLLECTION).deleteMany({ source: VIEWER_SESSION_SOURCE });
    await db.collection(COLLECTION).insertOne(buff);
  } catch (err) {
    console.warn("[GlobalBuff] setViewerSessionBuff 失敗：", err?.message || err);
    return { applied: false, reason: "write-failed" };
  }
  await refresh();
  console.log(`[GlobalBuff] 觀看熱度 ${buff.label}（掉寶+${drop}/金幣+${gold}/經驗+${exp}%，${Math.round(Number(p.endsAtMs) - nowMs) / 60000 | 0}分）`);
  return { applied: true, buff };
}

module.exports = {
  init,
  refresh,
  getActiveModifiers,
  applyBuff,
  getViewerSession,
  clearViewerSession,
  setViewerSessionBuff,
  setShortTermCapPct,
  clearBySource,
  resetSeason,
  listActive,
  listRecent,
  clearBuff,
  clearAll,
  getDonationSession,
  isDonationBuffActive,
  isShortTermBuffActive,
  setDonationSessionBuff
};
