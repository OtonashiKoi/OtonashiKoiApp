"use strict";

const notificationState = require("./streamNotificationState");

const GO_LIVE_CHANNEL_ID = String(
  process.env.STREAM_GO_LIVE_CHANNEL_ID || "1292448104905441331"
).trim();
const DEFAULT_POLL_MS = 2 * 60 * 1000;
const MIN_POLL_MS = 60 * 1000;
let pollTimer = null;
let lastWarningAt = 0;
let lastWarningMessage = "";

function extractYoutubeVideoId(url) {
  const value = String(url || "").trim();
  if (!value) return "";
  try {
    const parsed = new URL(value);
    if (parsed.hostname === "youtu.be") return parsed.pathname.split("/").filter(Boolean)[0] || "";
    if (parsed.hostname.endsWith("youtube.com")) {
      if (parsed.searchParams.get("v")) return parsed.searchParams.get("v");
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (["live", "embed", "shorts"].includes(parts[0])) return parts[1] || "";
    }
  } catch (_) { /* 非有效網址 */ }
  return "";
}

function normalizeApiBroadcast(item) {
  const id = String(item?.id || "").trim();
  const privacy = String(item?.status?.privacyStatus || "").toLowerCase();
  const scheduledStartTime = String(item?.snippet?.scheduledStartTime || "").trim();
  if (!id || !scheduledStartTime || !["public", "unlisted"].includes(privacy)) return null;
  const startMs = Date.parse(scheduledStartTime);
  if (!Number.isFinite(startMs)) return null;
  return {
    broadcastId: id,
    title: String(item?.snippet?.title || "YouTube 直播").trim(),
    scheduledStartTime,
    url: `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`,
  };
}

function normalizeViewerUpcoming(service) {
  const platform = String(service?.platform || service?.service || "").toLowerCase();
  if (platform !== "youtube" || !service?.upcoming || service?.stale || service?.board) return null;
  const url = String(service?.url || "").trim();
  const broadcastId = extractYoutubeVideoId(url) || String(service?.id || "").trim();
  const startMs = Number(service?.startTime) || 0;
  if (!broadcastId || !url || startMs <= Date.now()) return null;
  return {
    broadcastId,
    title: String(service?.title || "YouTube 直播").trim(),
    scheduledStartTime: new Date(startMs).toISOString(),
    url,
  };
}

function buildUpcomingMessage(broadcast) {
  const title = String(broadcast?.title || "YouTube 直播").replace(/[*_~`]/g, "").slice(0, 180);
  const startMs = Date.parse(broadcast?.scheduledStartTime || "");
  const schedule = Number.isFinite(startMs)
    ? `\n🕒 預定開播：<t:${Math.floor(startMs / 1000)}:F>（<t:${Math.floor(startMs / 1000)}:R>）`
    : "";
  return `📅 **直播預告**\n**${title}**${schedule}\n${broadcast.url}`;
}

async function announceBroadcast(broadcast, runtime = {}) {
  if (!broadcast?.broadcastId || !broadcast?.url) return { sent: false, reason: "invalid" };
  const state = runtime.notificationState || notificationState;
  const claimed = await state.claimUpcomingAnnouncement({
    ...broadcast,
    channelId: GO_LIVE_CHANNEL_ID,
  });
  if (!claimed) return { sent: false, reason: "already-announced" };

  try {
    const getClient = runtime.getBotClient || require("../../bot/runtimeContext").getBotClient;
    const client = getClient();
    if (!client?.isReady?.()) throw new Error("Discord bot 尚未就緒");
    const channel = await client.channels.fetch(GO_LIVE_CHANNEL_ID);
    if (!channel?.isTextBased?.() || typeof channel.send !== "function") {
      throw new Error(`頻道 ${GO_LIVE_CHANNEL_ID} 不是可發送的文字頻道`);
    }
    await channel.send({
      content: buildUpcomingMessage(broadcast),
      allowedMentions: { parse: [] },
    });
    await state.completeUpcomingAnnouncement(broadcast.broadcastId, true);
    console.log(`[YouTubeUpcoming] 已發送直播預告 channel=${GO_LIVE_CHANNEL_ID} id=${broadcast.broadcastId}`);
    return { sent: true, broadcastId: broadcast.broadcastId };
  } catch (err) {
    await state.completeUpcomingAnnouncement(broadcast.broadcastId, false, err?.message || String(err));
    warnThrottled(`Discord 預告發送失敗：${err?.message || err}`);
    return { sent: false, reason: "send-failed" };
  }
}

async function announceFromViewerState(state, runtime = {}) {
  const broadcasts = (Array.isArray(state?.services) ? state.services : [])
    .map(normalizeViewerUpcoming)
    .filter(Boolean);
  return Promise.all(broadcasts.map((broadcast) => announceBroadcast(broadcast, runtime)));
}

function warnThrottled(message) {
  const now = Date.now();
  if (message === lastWarningMessage && now - lastWarningAt < 60 * 60 * 1000) return;
  lastWarningAt = now;
  lastWarningMessage = message;
  console.warn(`[YouTubeUpcoming] ${message}`);
}

async function pollYoutubeUpcoming(serviceContext, runtime = {}) {
  if (!serviceContext?.creatorTokenService) return { polled: false, reason: "missing-token-service" };
  try {
    const token = await serviceContext.creatorTokenService.getValidToken("youtube");
    const fetchFn = runtime.fetch || global.fetch;
    const url = new URL("https://www.googleapis.com/youtube/v3/liveBroadcasts");
    url.search = new URLSearchParams({
      part: "id,snippet,status",
      broadcastStatus: "upcoming",
      broadcastType: "event",
      maxResults: "10",
    }).toString();
    const response = await fetchFn(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error?.message || `YouTube API HTTP ${response.status}`);
    const broadcasts = (Array.isArray(data?.items) ? data.items : [])
      .map(normalizeApiBroadcast)
      .filter(Boolean)
      .sort((a, b) => Date.parse(a.scheduledStartTime) - Date.parse(b.scheduledStartTime));
    const results = [];
    for (const broadcast of broadcasts) results.push(await announceBroadcast(broadcast, runtime));
    return { polled: true, found: broadcasts.length, sent: results.filter((x) => x.sent).length };
  } catch (err) {
    warnThrottled(`YouTube 待機室查詢失敗：${err?.message || err}`);
    return { polled: false, reason: "query-failed" };
  }
}

function startYoutubeUpcomingPoller(serviceContext) {
  if (pollTimer) return pollTimer;
  const configured = Number(process.env.YOUTUBE_UPCOMING_POLL_MS) || DEFAULT_POLL_MS;
  const intervalMs = Math.max(MIN_POLL_MS, configured);
  pollYoutubeUpcoming(serviceContext).catch(() => {});
  pollTimer = setInterval(() => pollYoutubeUpcoming(serviceContext).catch(() => {}), intervalMs);
  pollTimer.unref?.();
  console.log(`[YouTubeUpcoming] 待機室輪詢已啟動（每 ${Math.round(intervalMs / 1000)} 秒）`);
  return pollTimer;
}

module.exports = {
  extractYoutubeVideoId,
  normalizeApiBroadcast,
  normalizeViewerUpcoming,
  buildUpcomingMessage,
  announceBroadcast,
  announceFromViewerState,
  pollYoutubeUpcoming,
  startYoutubeUpcomingPoller,
};
