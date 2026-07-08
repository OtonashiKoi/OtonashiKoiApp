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
// 從 OneComme 一個「直播枠(service/meta)」物件抽出觀看數
function extractViewerInfo(o) {
  if (!o || typeof o !== "object") return null;
  const meta = o.meta || o.data || o;
  const viewer = pickNumber(meta.viewer, meta.viewers, meta.viewCount, meta.watching, o.viewer, o.viewers);
  const likes = pickNumber(meta.likes, meta.like, o.likes);
  const service = o.service || o.platform || meta.service || null;
  const id = o.id || meta.id || null;
  if (viewer == null && likes == null) return null;
  return { service, id, viewer, likes };
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

module.exports = { startFetcher };
