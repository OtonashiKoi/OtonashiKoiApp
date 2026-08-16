"use strict";

const { getMongoDb } = require("../../adapters/mongo/createMongoClient");

const DONATION_PHASE2_START = "2026-08-09T12:00:00.000Z"; // 台北 2026-08-09 20:00
const DONATION_TIME_ZONE = "Asia/Taipei";

function classifyDonationSource(platform) {
  const key = String(platform || "").trim().toLowerCase();
  if (key === "youtube" || key === "yt") return "youtube";
  if (key === "ecpay") return "ecpay";
  return "other";
}

function currentTaipeiMonthKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: DONATION_TIME_ZONE,
    year: "numeric",
    month: "2-digit"
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return `${year}-${month}`;
}

function taipeiMonthRange(requestedMonth, now = new Date()) {
  const fallback = currentTaipeiMonthKey(now);
  const match = /^(\d{4})-(\d{2})$/.exec(String(requestedMonth || ""));
  const key = match && Number(match[2]) >= 1 && Number(match[2]) <= 12 ? String(requestedMonth) : fallback;
  const [year, month] = key.split("-").map(Number);
  const taipeiOffsetMs = 8 * 60 * 60 * 1000;
  const start = new Date(Date.UTC(year, month - 1, 1) - taipeiOffsetMs);
  const end = new Date(Date.UTC(year, month, 1) - taipeiOffsetMs);
  return { key, timeZone: DONATION_TIME_ZONE, start, end };
}

function emptyDonationTotals() {
  return { totalEvents: 0, boundEvents: 0, totalTwd: 0, totalDiamonds: 0 };
}

function emptyDonationScope() {
  return {
    ...emptyDonationTotals(),
    bySource: {
      youtube: emptyDonationTotals(),
      ecpay: emptyDonationTotals(),
      other: emptyDonationTotals()
    }
  };
}

function addDonationGroup(scope, source, row) {
  const totals = {
    totalEvents: Number(row.totalEvents) || 0,
    boundEvents: Number(row.boundEvents) || 0,
    totalTwd: Number(row.totalTwd) || 0,
    totalDiamonds: Number(row.totalDiamonds) || 0
  };
  for (const key of Object.keys(totals)) {
    scope[key] += totals[key];
    scope.bySource[source][key] += totals[key];
  }
}

function foldDonationGroups(rows, monthRange) {
  const all = emptyDonationScope();
  const old = emptyDonationScope();
  const newer = emptyDonationScope();
  const month = emptyDonationScope();
  for (const row of rows || []) {
    const source = classifyDonationSource(row?._id?.platform);
    addDonationGroup(all, source, row);
    addDonationGroup(row?._id?.phase === "old" ? old : newer, source, row);
    if (row?._id?.inMonth === true) addDonationGroup(month, source, row);
  }
  return {
    ...all,
    phases: { cutoff: DONATION_PHASE2_START, old, new: newer },
    month: {
      key: monthRange.key,
      timeZone: monthRange.timeZone,
      start: monthRange.start.toISOString(),
      end: monthRange.end.toISOString(),
      ...month
    }
  };
}

async function getDonationSummary({ month = "" } = {}) {
  const monthRange = taipeiMonthRange(month);
  const db = await getMongoDb().catch(() => null);
  if (!db) return foldDonationGroups([], monthRange);
  const rows = await db.collection("donationEvents").aggregate([
    {
      $set: {
        _eventAt: {
          $convert: { input: { $ifNull: ["$createdAtDate", "$createdAt"] }, to: "date", onError: null, onNull: null }
        },
        _platform: { $toLower: { $ifNull: ["$platform", ""] } },
        _twdAmount: { $convert: { input: "$twdAmount", to: "double", onError: 0, onNull: 0 } },
        _diamondsGranted: { $convert: { input: "$diamondsGranted", to: "double", onError: 0, onNull: 0 } }
      }
    },
    {
      $project: {
        platform: "$_platform",
        phase: { $cond: [{ $lt: ["$_eventAt", new Date(DONATION_PHASE2_START)] }, "old", "new"] },
        inMonth: {
          $and: [
            { $gte: ["$_eventAt", monthRange.start] },
            { $lt: ["$_eventAt", monthRange.end] }
          ]
        },
        bound: { $cond: ["$bound", 1, 0] },
        twdAmount: "$_twdAmount",
        diamondsGranted: "$_diamondsGranted"
      }
    },
    {
      $group: {
        _id: { platform: "$platform", phase: "$phase", inMonth: "$inMonth" },
        totalEvents: { $sum: 1 },
        boundEvents: { $sum: "$bound" },
        totalTwd: { $sum: "$twdAmount" },
        totalDiamonds: { $sum: "$diamondsGranted" }
      }
    }
  ]).toArray();
  return foldDonationGroups(rows, monthRange);
}

module.exports = {
  DONATION_PHASE2_START,
  getDonationSummary,
  _test: { classifyDonationSource, currentTaipeiMonthKey, taipeiMonthRange, foldDonationGroups }
};
