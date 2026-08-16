"use strict";

const { getMongoDb } = require("../../adapters/mongo/createMongoClient");

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

function configuredSeasonRange(raw = {}) {
  const parsedStart = raw.openAt ? new Date(raw.openAt) : null;
  const parsedEnd = raw.activateAt ? new Date(raw.activateAt) : null;
  const start = parsedStart && Number.isFinite(parsedStart.getTime()) ? parsedStart : null;
  const endCandidate = parsedEnd && Number.isFinite(parsedEnd.getTime()) ? parsedEnd : null;
  const end = endCandidate && (!start || endCandidate > start) ? endCandidate : null;
  return {
    configured: Boolean(start),
    timeZone: DONATION_TIME_ZONE,
    start,
    end
  };
}

async function loadConfiguredSeasonRange() {
  const maintenanceStore = require("../access/maintenanceStore");
  await maintenanceStore.ensureLoaded();
  return configuredSeasonRange(maintenanceStore.getRawState());
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

function foldDonationGroups(rows, monthRange, seasonRange) {
  const all = emptyDonationScope();
  const season = emptyDonationScope();
  const beforeSeason = emptyDonationScope();
  const month = emptyDonationScope();
  for (const row of rows || []) {
    const source = classifyDonationSource(row?._id?.platform);
    addDonationGroup(all, source, row);
    if (row?._id?.inSeason === true) addDonationGroup(season, source, row);
    if (row?._id?.beforeSeason === true) addDonationGroup(beforeSeason, source, row);
    if (row?._id?.inMonth === true) addDonationGroup(month, source, row);
  }
  return {
    ...all,
    season: {
      configured: seasonRange.configured,
      timeZone: seasonRange.timeZone,
      start: seasonRange.start?.toISOString() || null,
      end: seasonRange.end?.toISOString() || null,
      ...season
    },
    beforeSeason,
    month: {
      key: monthRange.key,
      timeZone: monthRange.timeZone,
      start: monthRange.start.toISOString(),
      end: monthRange.end.toISOString(),
      ...month
    }
  };
}

function buildSeasonCondition(eventExpression, seasonRange) {
  const conditions = [];
  if (seasonRange.start) conditions.push({ $gte: [eventExpression, seasonRange.start] });
  if (seasonRange.end) conditions.push({ $lt: [eventExpression, seasonRange.end] });
  return conditions.length > 0 ? { $and: conditions } : { $literal: true };
}

async function getDonationSummary({ month = "", seasonRange = null } = {}) {
  const monthRange = taipeiMonthRange(month);
  const effectiveSeasonRange = seasonRange
    ? configuredSeasonRange({ openAt: seasonRange.start || seasonRange.openAt, activateAt: seasonRange.end || seasonRange.activateAt })
    : await loadConfiguredSeasonRange();
  const db = await getMongoDb().catch(() => null);
  if (!db) return foldDonationGroups([], monthRange, effectiveSeasonRange);
  const eventExpression = "$_eventAt";
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
        inSeason: buildSeasonCondition(eventExpression, effectiveSeasonRange),
        beforeSeason: effectiveSeasonRange.start
          ? { $lt: [eventExpression, effectiveSeasonRange.start] }
          : { $literal: false },
        inMonth: {
          $and: [
            { $gte: [eventExpression, monthRange.start] },
            { $lt: [eventExpression, monthRange.end] }
          ]
        },
        bound: { $cond: ["$bound", 1, 0] },
        twdAmount: "$_twdAmount",
        diamondsGranted: "$_diamondsGranted"
      }
    },
    {
      $group: {
        _id: { platform: "$platform", inSeason: "$inSeason", beforeSeason: "$beforeSeason", inMonth: "$inMonth" },
        totalEvents: { $sum: 1 },
        boundEvents: { $sum: "$bound" },
        totalTwd: { $sum: "$twdAmount" },
        totalDiamonds: { $sum: "$diamondsGranted" }
      }
    }
  ]).toArray();
  return foldDonationGroups(rows, monthRange, effectiveSeasonRange);
}

module.exports = {
  getDonationSummary,
  loadConfiguredSeasonRange,
  _test: { classifyDonationSource, currentTaipeiMonthKey, taipeiMonthRange, configuredSeasonRange, foldDonationGroups }
};
