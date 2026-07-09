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

/**
 * 解析玩家的「Discord 名稱」（伺服器暱稱 → 全域名 → 使用者名），供公告顯示用。
 * 抓不到就退回「玩家#末四碼」，絕不回傳生 Discord ID。
 */
async function resolveDiscordName(discordId) {
  const id = String(discordId || "");
  try {
    const { getBotClient } = require("../bot/runtimeContext");
    const config = require("../config");
    const client = getBotClient && getBotClient();
    if (client?.isReady?.() && config.discord?.guildId) {
      const guild = client.guilds.cache.get(config.discord.guildId)
        || await client.guilds.fetch(config.discord.guildId).catch(() => null);
      if (guild) {
        const member = await guild.members.fetch(id).catch(() => null);
        if (member) return member.displayName || member.user?.globalName || member.user?.username;
      }
      const user = await client.users.fetch(id).catch(() => null);
      if (user) return user.globalName || user.username;
    }
  } catch (_) { /* fallthrough */ }
  return id ? `玩家#${id.slice(-4)}` : "某位勇者";
}

module.exports = { announceTownChat, resolveDiscordName };
