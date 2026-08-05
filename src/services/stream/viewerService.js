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
// 「預約枠/待機室」辨識：開始時間還在未來的枠(尚未正式開播)，OneComme 的 isLive 會忽真忽假。
// 2026-08-02 事故：明天才開的預約枠被判成開台，鎖被反覆釋放 → 開台通知連發 57 次。
// 容差 2 分鐘：真的開播後 OneComme 會回實際開始時間(過去)，只有「提早開台」會延後公告幾分鐘。
const UPCOMING_TOLERANCE_MS = 2 * 60 * 1000;
function _isUpcoming(s, nowMs) {
  const startTime = Number(s?.startTime) || 0;
  return startTime > 0 && (startTime - nowMs) > UPCOMING_TOLERANCE_MS;
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

// 目前總觀看數（只加總「未過期」「正在直播(isLive)」且「非看板/打卡枠」「非預約枠」的直播枠）
function _currentTotal(nowMs) {
  let total = 0;
  for (const s of byService.values()) {
    if (s.isLive && !_isBoard(s) && !_isUpcoming(s, nowMs) && nowMs - s.updatedAt <= STALE_MS) {
      total += Number(s.viewer) || 0;
    }
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
    url: String(info.url || "").trim(),
    title: info.title || "",
    startTime: Number(info.startTime) || 0,
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
    id: key,
    service: s.service || key,
    platform: s.platform || null,
    url: s.url || "",
    title: s.title || "",
    startTime: Number(s.startTime) || 0,
    board: _isBoard(s), // 永久看板/打卡枠 → 不算真的在直播、不計入人數
    upcoming: _isUpcoming(s, nowMs), // 預約枠/待機室（開始時間在未來）→ 還沒正式開播
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
    // 真的在直播 = 有「非看板、非預約」枠正在 live
    //（看板枠 isLive 永遠 true、預約枠 isLive 會忽真忽假，兩種都排除才不會誤判開台）
    live: services.some((x) => x.isLive && !x.stale && !x.board && !x.upcoming),
    services,
  };
}

// 同一場直播（同 fingerprint）重發公告的冷卻：即使因抖動被誤判成關台，6 小時內也不再公告一次。
const SAME_STREAM_COOLDOWN_MS = 6 * 60 * 60 * 1000;
// 任意兩則開台公告之間的硬性最小間隔：多枠交替搶主枠時的最後一道防洗版保險。
const ANY_ANNOUNCE_COOLDOWN_MS = 10 * 60 * 1000;

/**
 * 原子搶佔一場直播的 Discord 開台公告。
 * viewerState 已存在且以 _id:"default" 管理；擴充同一文件可避免新增 collection / index。
 * 搶佔成功的條件（三者同時成立）：
 *   1) 這場直播不是「正在公告中」的同一場
 *   2) 同一場距離上次公告已超過 SAME_STREAM_COOLDOWN_MS
 *   3) 距離上一則任何開台公告已超過 ANY_ANNOUNCE_COOLDOWN_MS
 */
async function claimGoLiveAnnouncement({ fingerprint, url, title, platform, channelId }) {
  const fp = String(fingerprint || "").trim();
  if (!fp) return false;
  try {
    const db = await getMongoDb();
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const sameCutoff = new Date(now - SAME_STREAM_COOLDOWN_MS).toISOString();
    const anyCutoff = new Date(now - ANY_ANNOUNCE_COOLDOWN_MS).toISOString();
    await db.collection("viewerState").updateOne(
      { _id: DOC_ID },
      { $setOnInsert: { startedAt: nowIso } },
      { upsert: true }
    );
    const previous = await db.collection("viewerState").findOneAndUpdate(
      {
        _id: DOC_ID,
        $and: [
          {
            $or: [
              // 換一場直播才允許再公告；同一場要「已非進行中」且過了冷卻
              { "goLiveAnnouncement.fingerprint": { $ne: fp } },
              {
                $and: [
                  { "goLiveAnnouncement.active": { $ne: true } },
                  {
                    $or: [
                      { "goLiveAnnouncement.sentAt": { $exists: false } },
                      { "goLiveAnnouncement.sentAt": { $lt: sameCutoff } },
                    ],
                  },
                ],
              },
            ],
          },
          {
            $or: [
              { goLiveLastSentAt: { $exists: false } },
              { goLiveLastSentAt: { $lt: anyCutoff } },
            ],
          },
        ],
      },
      {
        $set: {
          goLiveAnnouncement: {
            active: true,
            fingerprint: fp,
            url: String(url || "").trim(),
            title: String(title || "").slice(0, 200),
            platform: String(platform || ""),
            channelId: String(channelId || ""),
            status: "claimed",
            detectedAt: nowIso,
          },
        },
      },
      { returnDocument: "before" }
    );
    return previous != null;
  } catch (err) {
    console.warn("[viewerService] 搶佔開台公告失敗：", err?.message || err);
    return false;
  }
}

async function completeGoLiveAnnouncement(fingerprint, sent, errorMessage = "") {
  const fp = String(fingerprint || "").trim();
  if (!fp) return;
  try {
    const nowIso = new Date().toISOString();
    const set = sent
      ? {
          "goLiveAnnouncement.status": "sent",
          "goLiveAnnouncement.sentAt": nowIso,
          "goLiveAnnouncement.error": "",
          goLiveLastSentAt: nowIso, // 全域最小間隔用（不分場次）
        }
      : {
          // 發送失敗就釋放 active，下一輪（20 秒後）可以重試。
          "goLiveAnnouncement.active": false,
          "goLiveAnnouncement.status": "failed",
          "goLiveAnnouncement.failedAt": nowIso,
          "goLiveAnnouncement.error": String(errorMessage || "").slice(0, 300),
        };
    await (await getMongoDb()).collection("viewerState").updateOne(
      { _id: DOC_ID, "goLiveAnnouncement.fingerprint": fp },
      { $set: set }
    );
  } catch (err) {
    console.warn("[viewerService] 更新開台公告結果失敗：", err?.message || err);
  }
}

async function markLiveOffline() {
  try {
    await (await getMongoDb()).collection("viewerState").updateOne(
      { _id: DOC_ID, "goLiveAnnouncement.active": true },
      {
        $set: {
          "goLiveAnnouncement.active": false,
          "goLiveAnnouncement.offlineAt": new Date().toISOString(),
        },
      }
    );
  } catch (err) {
    console.warn("[viewerService] 標記直播結束失敗：", err?.message || err);
  }
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

module.exports = {
  update,
  getPublicState,
  resetSeason,
  claimGoLiveAnnouncement,
  completeGoLiveAnnouncement,
  markLiveOffline,
};
