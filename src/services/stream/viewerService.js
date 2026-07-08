// 直播即時觀看人數（第四線基礎層）
// ------------------------------------------------
// 資料來源：OneComme WebSocket 的 meta 事件（commentFetcher onMeta）。
// 職責：維護「目前各直播枠觀看數 / 加總 / 本季尖峰」，供顯示與（後續）觀看數里程碑 buff 使用。
// 純記錄＋讀取；不主動發 buff（buff 由之後的 viewerEventsService 依此數值判斷）。
const { getMongoDb } = require("../../adapters/mongo/createMongoClient");

const DOC_ID = "default";
const STALE_MS = 90_000; // 某直播枠超過 90 秒沒更新 → 視為已結束，不計入目前人數

// 各直播枠即時狀態：service → { viewer, likes, updatedAt(ms) }
const byService = new Map();
let peak = 0;          // 本季尖峰（記憶體）
let peakAt = null;
let _dbLoaded = false;

async function _loadPeakOnce() {
  if (_dbLoaded) return;
  _dbLoaded = true;
  try {
    const db = await getMongoDb();
    const doc = await db.collection("viewerState").findOne({ _id: DOC_ID });
    if (doc) {
      peak = Math.max(peak, Number(doc.peak) || 0);
      peakAt = peakAt || doc.peakAt || null;
    }
  } catch (_) { /* noop */ }
}

async function _persistPeak(nowIso) {
  try {
    const db = await getMongoDb();
    await db.collection("viewerState").updateOne(
      { _id: DOC_ID },
      { $set: { peak, peakAt: nowIso }, $setOnInsert: { startedAt: nowIso } },
      { upsert: true }
    );
  } catch (_) { /* noop */ }
}

// 目前總觀看數（只加總「未過期」的直播枠）
function _currentTotal(nowMs) {
  let total = 0;
  for (const s of byService.values()) {
    if (nowMs - s.updatedAt <= STALE_MS) total += Number(s.viewer) || 0;
  }
  return total;
}

/**
 * 收到 OneComme meta → 更新某直播枠觀看數。
 * @param {{ service?: string, id?: string, viewer: number, likes?: number }} info
 */
async function update(info) {
  await _loadPeakOnce();
  const nowMs = Date.now();
  const key = String(info.service || info.id || "default");
  byService.set(key, { viewer: Number(info.viewer) || 0, likes: Number(info.likes) || 0, updatedAt: nowMs });

  const total = _currentTotal(nowMs);
  if (total > peak) {
    peak = total;
    peakAt = new Date().toISOString();
    await _persistPeak(peakAt); // 破紀錄才寫 DB
  }
  return { current: total, peak };
}

/** 顯示用：目前總人數 + 本季尖峰 + 各枠明細 */
async function getPublicState() {
  await _loadPeakOnce();
  const nowMs = Date.now();
  const services = [...byService.entries()].map(([service, s]) => ({
    service,
    viewer: Number(s.viewer) || 0,
    likes: Number(s.likes) || 0,
    stale: nowMs - s.updatedAt > STALE_MS,
    updatedAt: new Date(s.updatedAt).toISOString(),
  }));
  const current = _currentTotal(nowMs);
  return {
    current,
    peak: Math.max(peak, current),
    peakAt,
    live: services.some((x) => !x.stale && x.viewer > 0),
    services,
  };
}

/** 換季重置：清尖峰（目前即時人數由 OneComme 自然更新，不需清） */
async function resetSeason() {
  peak = 0;
  peakAt = null;
  try {
    const db = await getMongoDb();
    const iso = new Date().toISOString();
    await db.collection("viewerState").updateOne(
      { _id: DOC_ID },
      { $set: { peak: 0, peakAt: null, startedAt: iso, updatedAt: iso } },
      { upsert: true }
    );
  } catch (_) { /* noop */ }
  return { reset: true };
}

module.exports = { update, getPublicState, resetSeason };
