"use strict";

/**
 * 聊天室 overlay 即時留言中繼（純記憶體 SSE）。
 * 伺服器已連著 OneComme（commentFetcher），把每則留言廣播給訂閱的 overlay 客戶端，
 * 讓 chat.html 不必直連本機 OneComme，任何電腦帶正確密碼即可從 otonashikoi.org 讀取。
 */

const subscribers = new Set();

function addSubscriber(res) {
  subscribers.add(res);
}

function removeSubscriber(res) {
  subscribers.delete(res);
}

/** 廣播一則 OneComme 留言給所有 overlay 訂閱者 */
function broadcastComment(comment) {
  if (!comment) return;
  // chat.html 期望 { data: <OneComme d> }；comment.raw 即原始 OneComme data。
  const out = { data: comment.raw || comment };
  const payload = `data: ${JSON.stringify(out)}\n\n`;
  subscribers.forEach((res) => {
    try {
      res.write(payload);
    } catch (_) {
      subscribers.delete(res);
    }
  });
}

function subscriberCount() {
  return subscribers.size;
}

module.exports = { addSubscriber, removeSubscriber, broadcastComment, subscriberCount };
