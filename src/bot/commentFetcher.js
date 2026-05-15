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

/**
 * 啟動 OneComme WebSocket 監聽
 * @param {(comment: {name: string, text: string, service: string, raw: object}) => void} onComment
 */
function startFetcher(onComment) {
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
    } catch (_) {
      // 忽略心跳包或格式錯誤
    }
  });

  ws.on("error", (err) => {
    console.error("[OneComme] 🔴 連線錯誤：", err.message);
  });

  ws.on("close", () => {
    console.log(`[OneComme] 🟡 連線中斷，${RECONNECT_DELAY_MS / 1000} 秒後重連...`);
    setTimeout(() => startFetcher(onComment), RECONNECT_DELAY_MS);
  });
}

module.exports = { startFetcher };
