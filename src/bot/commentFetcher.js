// OneComme WebSocket 連線器
// 連接 OneComme 並將留言推播到外部 onComment 回呼
// ------------------------------------------------

const WebSocket = require("ws");

const ONECOMME_WS_URL = "ws://127.0.0.1:11180/sub";
const RECONNECT_DELAY_MS = 5000;

/**
 * 啟動 OneComme WebSocket 監聽
 * @param {(comment: {name: string, text: string, service: string, raw: object}) => void} onComment
 */
function startFetcher(onComment) {
  console.log("[OneComme] 嘗試連線至：", ONECOMME_WS_URL);

  const ws = new WebSocket(ONECOMME_WS_URL);

  ws.on("open", () => {
    console.log("[OneComme] 🟢 連線成功，開始監聽留言...");
  });

  ws.on("message", (rawData) => {
    try {
      const payload = JSON.parse(rawData);

      if (payload.type === "comments" && Array.isArray(payload.data?.comments)) {
        for (const c of payload.data.comments) {
          const d = c.data;
          if (!d) continue;

          const comment = {
            id: d.id || "",
            name: d.displayName || d.name || "未知用戶",
            userId: d.userId || "",
            text: d.comment || "",
            service: d.service || "unknown",
            raw: d
          };

          if (typeof onComment === "function") {
            onComment(comment);
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
    setTimeout(() => startFetcher(onComment), RECONNECT_DELAY_MS);
  });
}

module.exports = { startFetcher };