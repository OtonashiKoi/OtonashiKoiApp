// 直播即時觀看人數（第四線基礎層）
// ------------------------------------------------
// 資料來源：OneComme WebSocket 的 meta 事件（commentFetcher onMeta）。
// 職責：維護「目前各直播枠觀看數 / 加總 / 本季尖峰」，供顯示與（後續）觀看數里程碑 buff 使用。
// 純記錄＋讀取；不主動發 buff（buff 由之後的 viewerEventsService 依此數值判斷）。
const { getMongoDb } = require("../../adapters/mongo/createMongoClient");

const DOC_ID = "default";
const STALE_MS = 90_000; // 某直播枠超過 90 秒沒更新 → 視為已結束，不計入目前人數
// 「永久看板/打卡枠」辨識：這種枠(如 YouTube @頻道 24hr 打卡看板)即使 isLive=true 也不算真的在直播，
// 否則 live 永遠 true → 觀看 Buff 永不過期。用直播標題判斷(開真節目時標題會變、不含這些字)。
const BOARD_TITLE_RE = /看板|打卡專用|打卡聊天|待機中?|standby/i;
function _isBoard(s) {
  return !!s && BOARD_TITLE_RE.test(String(s.title || ""));
}

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

// 目前總觀看數（只加總「未過期」「正在直播(isLive)」且「非看板/打卡枠」的直播枠）
function _currentTotal(nowMs) {
  let total = 0;
  for (const s of byService.values()) {
    if (s.isLive && !_isBoard(s) && nowMs - s.updatedAt <= STALE_MS) total += Number(s.viewer) || 0;
  }
  return total;
}

/**
 * 收到 OneComme meta → 更新某直播枠觀看數。
 * @param {{ service?: string, platform?: string, id?: string, viewer: number, likes?: number, isLive?: boolean }} info
 */
async function update(info) {
  await _loadPeakOnce();
  const nowMs = Date.now();
  const key = String(info.id || info.service || "default"); // id 穩定，優先當 key
  byService.set(key, {
    service: info.service || key,
    platform: info.platform || null,
    title: info.title || "",
    viewer: Number(info.viewer) || 0,
    likes: Number(info.likes) || 0,
    isLive: info.isLive === true,
    updatedAt: nowMs,
  });

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
  const services = [...byService.entries()].map(([key, s]) => ({
    service: s.service || key,
    platform: s.platform || null,
    title: s.title || "",
    board: _isBoard(s), // 永久看板/打卡枠 → 不算真的在直播、不計入人數
    viewer: Number(s.viewer) || 0,
    likes: Number(s.likes) || 0,
    isLive: s.isLive === true,
    stale: nowMs - s.updatedAt > STALE_MS,
    updatedAt: new Date(s.updatedAt).toISOString(),
  }));
  const current = _currentTotal(nowMs);
  return {
    current,
    peak: Math.max(peak, current),
    peakAt,
    // 真的在直播 = 有非看板枠正在 live（看板枠 isLive 永遠 true，排除掉才不會誤判）
    live: services.some((x) => x.isLive && !x.stale && !x.board),
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
