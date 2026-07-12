// OneComme WebSocket 連線器
// 連接 OneComme 並將留言推播到外部 onComment 回呼
// ------------------------------------------------

const WebSocket = require("ws");

const ONECOMME_WS_URL = process.env.ONECOMME_WS_URL || "ws://127.0.0.1:11180/sub";
const RECONNECT_DELAY_MS = 5000;
const LOG_TEXT_LIMIT = 120;

function compactLogText(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= LOG_TEXT_LIMIT) return text;
  return `${text.slice(0, LOG_TEXT_LIMIT)}...`;
}

// OneComme meta 觀看數欄位名各平台/版本可能不同，容錯抓取
function pickNumber(...vals) {
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}
// 從 OneComme 一個「直播枠」物件抽出觀看數。
// 相容兩種來源：REST /api/services 的 service 物件(有 .meta)、WS meta 的 data({type, service})。
// 實測欄位：service.meta.viewer / service.meta.isLive / service.meta.upVote(讚) / service.name。
function extractViewerInfo(o) {
  if (!o || typeof o !== "object") return null;
  const svc = (o.service && typeof o.service === "object") ? o.service : o;
  const meta = svc.meta || o.meta || {};
  const viewer = pickNumber(meta.viewer, meta.viewers, meta.viewCount, svc.viewer, o.viewer);
  const likes = pickNumber(meta.upVote, meta.likes, meta.like);
  const isLive = meta.isLive === true;
  const service = o.type || svc.name || meta.service || null; // "twitch"/"youtube" 或 "#TWITCH"
  const id = svc.id || o.id || meta.id || null;
  // 平台判定：枠名(#TWITCH 等)不可靠，優先用直播枠 url 判 youtube / twitch
  const url = String(svc.url || meta.url || o.url || "").toLowerCase();
  let platform = null;
  if (/youtube\.com|youtu\.be/.test(url)) platform = "youtube";
  else if (/twitch\.tv/.test(url)) platform = "twitch";
  if (!platform) {
    const hint = String(o.type || svc.name || "").toLowerCase();
    if (hint.indexOf("youtube") >= 0 || hint.indexOf("yt") >= 0) platform = "youtube";
    else if (hint.indexOf("twitch") >= 0) platform = "twitch";
  }
  // 直播標題：辨識「永久看板/打卡枠」(標題含 看板/打卡專用)，這種枠 isLive 可能永遠 true，不算真的開台
  const title = String(meta.title || svc.title || o.title || "").slice(0, 200);
  // 有平台就保留(即使 Twitch 沒回同接數，也讓它帶 0 進來，overlay 才能常駐顯示)
  if (viewer == null && likes == null && !platform) return null;
  return { service, platform, id, viewer, likes, isLive, title };
}

// REST 輪詢：直接讀 OneComme /api/services（schema 已確認，比 WS meta 可靠）
const ONECOMME_API_BASE = process.env.ONECOMME_API_BASE || "http://127.0.0.1:11180";
async function pollServicesOnce(onMeta) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(`${ONECOMME_API_BASE}/api/services`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return;
    const services = await res.json();
    if (!Array.isArray(services)) return;
    for (const svc of services) {
      const info = extractViewerInfo(svc);
      // 有同接數、或至少判得出平台(Twitch 常無同接數)就更新，讓 overlay 能常駐顯示各平台
      if (info && (info.viewer != null || info.platform)) { try { onMeta(info); } catch (_) { /* noop */ } }
    }
  } catch (_) { /* OneComme 未開/沒開台，靜默略過 */ }
}
function startViewerPoller(onMeta, intervalMs = 20_000) {
  if (typeof onMeta !== "function") return null;
  pollServicesOnce(onMeta);
  const timer = setInterval(() => pollServicesOnce(onMeta), intervalMs);
  timer.unref?.();
  return timer;
}

let _metaRawLogged = false;

/**
 * 啟動 OneComme WebSocket 監聽
 * @param {(comment: {name: string, text: string, service: string, raw: object}) => void} onComment
 * @param {(meta: {service: string|null, id: string|null, viewer: number|null, likes: number|null, raw: object}) => void} [onMeta] 觀看數/直播枠資訊回呼
 */
function startFetcher(onComment, onMeta) {
  console.log("[OneComme] 嘗試連線至：", ONECOMME_WS_URL);
  const connectedAt = Date.now();

  const ws = new WebSocket(ONECOMME_WS_URL);

  ws.on("open", () => {
    console.log("[OneComme] 🟢 連線成功，開始監聽留言...");
  });

  ws.on("message", (rawData) => {
    try {
      const payload = JSON.parse(rawData);
      const comments = Array.isArray(payload.data?.comments) ? payload.data.comments : [];

      if (comments.length > 0) {
        let handledCount = 0;
        for (const c of comments) {
          const d = c.data;
          if (!d) continue;
          const ts = Date.parse(d.timestamp || d.createdAt || "");
          const isHistory = payload.type !== "comments" && Number.isFinite(ts) && ts < connectedAt - 30_000;

          const comment = {
            id: d.id || "",
            name: d.displayName || d.name || "未知用戶",
            userId: d.userId || "",
            text: d.comment || "",
            service: d.service || "unknown",
            raw: {
              ...d,
              _onecommeEventType: payload.type,
              _onecommeHistory: isHistory
            }
          };

          if (typeof onComment === "function") {
            onComment(comment);
            handledCount += 1;
          }

          if (payload.type === "comments") {
            const text = compactLogText(comment.text);
            console.log(`[OneComme] ${comment.service} ${comment.name}: ${text || "(空白留言)"}`);
          }
        }
        if (payload.type === "comments") {
          console.log(`[OneComme] 收到留言 ${handledCount} 則`);
        }
      }

      // ── 觀看數 / 直播枠資訊（meta）──
      // OneComme 會週期性推 meta（同時視聴者數、按讚數）。留言封包不帶，這裡另接。
      if (typeof onMeta === "function") {
        // 可能出現在：type=meta 的 data；或 connected/services 的清單裡
        const metaCandidates = [];
        if (payload.type === "meta" && payload.data) metaCandidates.push(payload.data);
        const svcList = payload.data?.services || payload.data?.meta || null;
        if (Array.isArray(svcList)) metaCandidates.push(...svcList);
        else if (svcList && typeof svcList === "object") metaCandidates.push(svcList);

        if ((payload.type === "meta" || (payload.type === "connected" && metaCandidates.length)) && !_metaRawLogged) {
          _metaRawLogged = true;
          console.log("[OneComme] 首次 meta 原始封包（供確認欄位）：", compactLogText(JSON.stringify(payload).slice(0, 600)));
        }
        for (const cand of metaCandidates) {
          const info = extractViewerInfo(cand);
          if (info && info.viewer != null) {
            try { onMeta({ ...info, raw: cand }); } catch (_) { /* noop */ }
          }
        }
      }
    } catch (_) {
      // 忽略心跳包或格式錯誤
    }
  });

  ws.on("error", (err) => {
    console.error("[OneComme] 🔴 連線錯誤：", err.message);
  });

  ws.on("close", () => {
    console.log(`[OneComme] 🟡 連線中斷，${RECONNECT_DELAY_MS / 1000} 秒後重連...`);
    setTimeout(() => startFetcher(onComment, onMeta), RECONNECT_DELAY_MS);
  });
}

module.exports = { startFetcher, startViewerPoller, pollServicesOnce };
