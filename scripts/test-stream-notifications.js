"use strict";

const assert = require("node:assert/strict");
const upcoming = require("../src/services/stream/youtubeUpcomingService");
const viewerEvents = require("../src/services/stream/viewerEventsService");
const viewerService = require("../src/services/stream/viewerService");
const townChat = require("../src/shared/announceTownChat");
const { DEFAULTS } = require("../src/services/stream/streamEventConfig");

function futureIso(minutes = 30) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

async function testYoutubeApiPreview() {
  const sends = [];
  const completions = [];
  let requestedUrl = "";
  let authorization = "";
  const runtime = {
    fetch: async (url, options) => {
      requestedUrl = String(url);
      authorization = options?.headers?.Authorization;
      return {
        ok: true,
        status: 200,
        json: async () => ({ items: [{
          id: "waitingRoom123",
          snippet: { title: "今晚一起冒險", scheduledStartTime: futureIso(45) },
          status: { privacyStatus: "public" },
        }] }),
      };
    },
    notificationState: {
      claimUpcomingAnnouncement: async () => true,
      completeUpcomingAnnouncement: async (...args) => completions.push(args),
    },
    getBotClient: () => ({
      isReady: () => true,
      channels: { fetch: async () => ({
        isTextBased: () => true,
        send: async (payload) => sends.push(payload),
      }) },
    }),
  };
  const result = await upcoming.pollYoutubeUpcoming({
    creatorTokenService: { getValidToken: async () => "token-value" },
  }, runtime);

  assert.equal(result.polled, true);
  assert.equal(result.sent, 1);
  assert.match(requestedUrl, /liveBroadcasts/);
  assert.match(requestedUrl, /broadcastStatus=upcoming/);
  assert.equal(authorization, "Bearer token-value");
  assert.equal(sends.length, 1);
  assert.match(sends[0].content, /直播預告/);
  assert.match(sends[0].content, /今晚一起冒險/);
  assert.match(sends[0].content, /youtube\.com\/watch\?v=waitingRoom123/);
  assert.match(sends[0].content, /<t:\d+:F>/);
  assert.deepEqual(sends[0].allowedMentions, { parse: [] });
  assert.deepEqual(completions, [["waitingRoom123", true]]);
}

async function testDuplicateDoesNotSend() {
  let sends = 0;
  const result = await upcoming.announceBroadcast({
    broadcastId: "same-room",
    title: "同一個待機室",
    scheduledStartTime: futureIso(),
    url: "https://www.youtube.com/watch?v=same-room",
  }, {
    notificationState: {
      claimUpcomingAnnouncement: async () => false,
      completeUpcomingAnnouncement: async () => { throw new Error("不應完成未搶到的公告"); },
    },
    getBotClient: () => ({ channels: { fetch: async () => { sends += 1; } } }),
  });
  assert.equal(result.reason, "already-announced");
  assert.equal(sends, 0);
}

async function testOneCommeWaitingRoom() {
  const normalized = upcoming.normalizeViewerUpcoming({
    id: "fallback-id",
    platform: "youtube",
    upcoming: true,
    stale: false,
    board: false,
    startTime: Date.now() + 20 * 60_000,
    title: "OneComme 待機室",
    url: "https://youtu.be/oneComme123",
  });
  assert.equal(normalized.broadcastId, "oneComme123");
  assert.equal(upcoming.extractYoutubeVideoId("https://www.youtube.com/live/liveId987"), "liveId987");
}

async function testViewerAnnouncementRule() {
  const originalClaim = viewerService.claimViewerTierAnnouncement;
  const originalTownChat = townChat.announceTownChat;
  const claims = [];
  const messages = [];
  viewerService.claimViewerTierAnnouncement = async (input) => {
    claims.push(input);
    return { claimed: true, previousFingerprint: input.fingerprint, previousTier: 30 };
  };
  townChat.announceTownChat = async (message) => messages.push(message);
  try {
    const tierObj = { minViewers: 50, label: "觀看熱度 II", dropPct: 10, goldPct: 10, expPct: 10 };
    const result = await viewerEvents.maybeAnnounceViewerTier({
      state: {
        services: [{
          id: "live-id", platform: "youtube", isLive: true, stale: false,
          board: false, upcoming: false, url: "https://youtu.be/live-id", title: "直播中",
        }],
      },
      cfg: { announce: true, announceCooldownMinutes: 60, graceMinutes: 60, streamUrl: "" },
      cur: 55,
      tierObj,
      tiers: [{ minViewers: 30, label: "觀看熱度 I", dropPct: 5 }, tierObj],
      targetTier: 50,
    });
    assert.equal(result.sent, true);
    assert.equal(result.mode, "upgrade");
    assert.equal(claims[0].tierMin, 50);
    assert.equal(claims[0].cooldownMinutes, 60);
    assert.match(messages[0], /加成升級/);
    const below = await viewerEvents.maybeAnnounceViewerTier({
      state: { services: [] }, cfg: { announce: true }, cur: 45,
      tierObj, tiers: [tierObj], targetTier: 50,
    });
    assert.equal(below.reason, "tier-no-longer-reached");
    assert.equal(claims.length, 1);
  } finally {
    viewerService.claimViewerTierAnnouncement = originalClaim;
    townChat.announceTownChat = originalTownChat;
  }
}

async function main() {
  assert.equal(DEFAULTS.viewerTiers.announceCooldownMinutes, 60);
  await testYoutubeApiPreview();
  await testDuplicateDoesNotSend();
  await testOneCommeWaitingRoom();
  await testViewerAnnouncementRule();
  console.log("✅ stream notification tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
