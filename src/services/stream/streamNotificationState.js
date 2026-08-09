"use strict";

const { getMongoDb } = require("../../adapters/mongo/createMongoClient");

const DOC_ID = "default";
const SAME_STREAM_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const ANY_ANNOUNCE_COOLDOWN_MS = 10 * 60 * 1000;

async function ensureState(db, nowIso) {
  await db.collection("viewerState").updateOne(
    { _id: DOC_ID },
    { $setOnInsert: { startedAt: nowIso } },
    { upsert: true }
  );
}

async function claimGoLiveAnnouncement({ fingerprint, url, title, platform, channelId }) {
  const fp = String(fingerprint || "").trim();
  if (!fp) return false;
  try {
    const db = await getMongoDb();
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const sameCutoff = new Date(now - SAME_STREAM_COOLDOWN_MS).toISOString();
    const anyCutoff = new Date(now - ANY_ANNOUNCE_COOLDOWN_MS).toISOString();
    await ensureState(db, nowIso);
    const previous = await db.collection("viewerState").findOneAndUpdate(
      {
        _id: DOC_ID,
        $and: [
          {
            $or: [
              { "goLiveAnnouncement.fingerprint": { $ne: fp } },
              {
                $and: [
                  { "goLiveAnnouncement.active": { $ne: true } },
                  {
                    $or: [
                      { "goLiveAnnouncement.sentAt": { $exists: false } },
                      { "goLiveAnnouncement.sentAt": { $lt: sameCutoff } },
                    ],
                  },
                ],
              },
            ],
          },
          {
            $or: [
              { goLiveLastSentAt: { $exists: false } },
              { goLiveLastSentAt: { $lt: anyCutoff } },
            ],
          },
        ],
      },
      {
        $set: {
          goLiveAnnouncement: {
            active: true,
            fingerprint: fp,
            url: String(url || "").trim(),
            title: String(title || "").slice(0, 200),
            platform: String(platform || ""),
            channelId: String(channelId || ""),
            status: "claimed",
            detectedAt: nowIso,
          },
        },
      },
      { returnDocument: "before" }
    );
    return previous != null;
  } catch (err) {
    console.warn("[StreamNotificationState] 搶佔開台公告失敗：", err?.message || err);
    return false;
  }
}

async function completeGoLiveAnnouncement(fingerprint, sent, errorMessage = "") {
  const fp = String(fingerprint || "").trim();
  if (!fp) return;
  try {
    const nowIso = new Date().toISOString();
    const set = sent
      ? {
          "goLiveAnnouncement.status": "sent",
          "goLiveAnnouncement.sentAt": nowIso,
          "goLiveAnnouncement.error": "",
          goLiveLastSentAt: nowIso,
        }
      : {
          "goLiveAnnouncement.active": false,
          "goLiveAnnouncement.status": "failed",
          "goLiveAnnouncement.failedAt": nowIso,
          "goLiveAnnouncement.error": String(errorMessage || "").slice(0, 300),
        };
    await (await getMongoDb()).collection("viewerState").updateOne(
      { _id: DOC_ID, "goLiveAnnouncement.fingerprint": fp },
      { $set: set }
    );
  } catch (err) {
    console.warn("[StreamNotificationState] 更新開台公告結果失敗：", err?.message || err);
  }
}

async function claimUpcomingAnnouncement({ broadcastId, url, title, scheduledStartTime, channelId }) {
  const id = String(broadcastId || "").trim();
  if (!id) return false;
  try {
    const db = await getMongoDb();
    const nowIso = new Date().toISOString();
    await ensureState(db, nowIso);
    const previous = await db.collection("viewerState").findOneAndUpdate(
      {
        _id: DOC_ID,
        upcomingPreviewClaims: {
          $not: { $elemMatch: { broadcastId: id, status: { $in: ["claimed", "sent"] } } },
        },
      },
      {
        $push: {
          upcomingPreviewClaims: {
            $each: [{
              broadcastId: id,
              url: String(url || "").trim(),
              title: String(title || "").slice(0, 200),
              scheduledStartTime: String(scheduledStartTime || ""),
              channelId: String(channelId || ""),
              status: "claimed",
              claimedAt: nowIso,
            }],
            $slice: -200,
          },
        },
      },
      { returnDocument: "before" }
    );
    return previous != null;
  } catch (err) {
    console.warn("[StreamNotificationState] 搶佔待機室預告失敗：", err?.message || err);
    return false;
  }
}

async function completeUpcomingAnnouncement(broadcastId, sent, errorMessage = "") {
  const id = String(broadcastId || "").trim();
  if (!id) return;
  try {
    const nowIso = new Date().toISOString();
    const collection = (await getMongoDb()).collection("viewerState");
    if (sent) {
      await collection.updateOne(
        { _id: DOC_ID },
        { $set: {
          "upcomingPreviewClaims.$[claim].status": "sent",
          "upcomingPreviewClaims.$[claim].sentAt": nowIso,
          "upcomingPreviewClaims.$[claim].error": "",
        } },
        { arrayFilters: [{ "claim.broadcastId": id, "claim.status": "claimed" }] }
      );
    } else {
      await collection.updateOne(
        { _id: DOC_ID },
        {
          $pull: { upcomingPreviewClaims: { broadcastId: id, status: "claimed" } },
          $set: { upcomingPreviewLastFailure: {
            broadcastId: id, failedAt: nowIso,
            error: String(errorMessage || "").slice(0, 300),
          } },
        }
      );
    }
  } catch (err) {
    console.warn("[StreamNotificationState] 更新待機室預告結果失敗：", err?.message || err);
  }
}

async function claimViewerTierAnnouncement({ fingerprint, tierMin, cooldownMinutes }) {
  const fp = String(fingerprint || "").trim();
  const tier = Math.max(1, Math.round(Number(tierMin) || 0));
  if (!fp || tier <= 0) return { claimed: false };
  try {
    const db = await getMongoDb();
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const cutoff = new Date(now - Math.max(5, Number(cooldownMinutes) || 60) * 60_000).toISOString();
    await ensureState(db, nowIso);
    const previous = await db.collection("viewerState").findOneAndUpdate(
      {
        _id: DOC_ID,
        $and: [
          {
            $or: [
              { "viewerTierAnnouncement.fingerprint": { $ne: fp } },
              { "viewerTierAnnouncement.highestTier": { $lt: tier } },
            ],
          },
          {
            $or: [
              { "viewerTierAnnouncement.sentAt": { $exists: false } },
              { "viewerTierAnnouncement.sentAt": { $lt: cutoff } },
            ],
          },
        ],
      },
      {
        $set: {
          viewerTierAnnouncement: { active: true, fingerprint: fp, highestTier: tier, sentAt: nowIso },
        },
      },
      { returnDocument: "before" }
    );
    if (previous == null) return { claimed: false };
    const prior = previous?.value || previous;
    return {
      claimed: true,
      previousFingerprint: String(prior?.viewerTierAnnouncement?.fingerprint || ""),
      previousTier: Number(prior?.viewerTierAnnouncement?.highestTier) || 0,
    };
  } catch (err) {
    console.warn("[StreamNotificationState] 搶佔觀看人數公告失敗：", err?.message || err);
    return { claimed: false };
  }
}

async function markLiveOffline() {
  try {
    await (await getMongoDb()).collection("viewerState").updateOne(
      { _id: DOC_ID },
      {
        $set: {
          "goLiveAnnouncement.active": false,
          "goLiveAnnouncement.offlineAt": new Date().toISOString(),
          "viewerTierAnnouncement.active": false,
        },
      }
    );
  } catch (err) {
    console.warn("[StreamNotificationState] 標記直播結束失敗：", err?.message || err);
  }
}

module.exports = {
  claimGoLiveAnnouncement,
  completeGoLiveAnnouncement,
  claimUpcomingAnnouncement,
  completeUpcomingAnnouncement,
  claimViewerTierAnnouncement,
  markLiveOffline,
};
