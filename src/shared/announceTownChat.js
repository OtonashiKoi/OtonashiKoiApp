"use strict";
/**
 * 對「聊天大廳」發一則系統公告（SSE 網頁聊天 + Discord town_chat 頻道）。
 * 底層是 serviceContext._announceTownChat（在 playerAppRoutes 掛上）。
 * 惰性 require 避免與 runtimeContext 形成循環相依；任何失敗都靜默（廣播不影響主流程）。
 */
async function announceTownChat(message) {
  if (!message) return;
  try {
    const { serviceContext } = require("../bot/runtimeContext");
    if (typeof serviceContext?._announceTownChat === "function") {
      await serviceContext._announceTownChat(message);
    }
  } catch (_) { /* 廣播失敗不影響發放 */ }
}

module.exports = { announceTownChat };
