"use strict";

/**
 * 聊天室 overlay 即時留言中繼（純記憶體 SSE）。
 * 伺服器已連著 OneComme（commentFetcher），把每則留言廣播給訂閱的 overlay 客戶端，
 * 讓 chat.html 不必直連本機 OneComme，任何電腦帶正確密碼即可從 otonashikoi.org 讀取。
 */

const subscribers = new Set();
const recentComments = [];
const RECENT_COMMENT_LIMIT = 30;

function serializeComment(comment) {
  return `data: ${JSON.stringify({ data: comment.raw || comment })}\n\n`;
}

function addSubscriber(res) {
  subscribers.add(res);
  // 新開 OBS/browser source 時補送本次程序已收到的近期留言。
  // 前端以留言 id 去重，因此重新整理不會重複顯示既有 localStorage 紀錄。
  recentComments.forEach((comment) => {
    try {
      res.write(serializeComment(comment));
    } catch (_) {
      subscribers.delete(res);
    }
  });
}

function removeSubscriber(res) {
  subscribers.delete(res);
}

/** 廣播一則 OneComme 留言給所有 overlay 訂閱者 */
function broadcastComment(comment) {
  if (!comment) return;
  // OneComme 重連時會送 connected 歷史包；overlay 只需要即時與本次程序的近期留言。
  if (comment.raw?._onecommeHistory === true) return;
  recentComments.push(comment);
  if (recentComments.length > RECENT_COMMENT_LIMIT) recentComments.shift();
  // chat.html 期望 { data: <OneComme d> }；comment.raw 即原始 OneComme data。
  const payload = serializeComment(comment);
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
