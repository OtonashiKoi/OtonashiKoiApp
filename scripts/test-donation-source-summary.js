"use strict";

const assert = require("assert");
const { _test } = require("../src/services/stream/donationSummary");

assert.strictEqual(_test.classifyDonationSource("youtube"), "youtube");
assert.strictEqual(_test.classifyDonationSource("YT"), "youtube");
assert.strictEqual(_test.classifyDonationSource("ECPAY"), "ecpay");
assert.strictEqual(_test.classifyDonationSource("manual"), "other");

const range = _test.taipeiMonthRange("2026-08");
assert.strictEqual(range.key, "2026-08");
assert.strictEqual(range.start.toISOString(), "2026-07-31T16:00:00.000Z");
assert.strictEqual(range.end.toISOString(), "2026-08-31T16:00:00.000Z");

const seasonRange = _test.configuredSeasonRange({
  openAt: "2026-08-09T12:00:00.000Z",
  activateAt: "2026-11-09T12:00:00.000Z"
});
assert.strictEqual(seasonRange.configured, true);
assert.strictEqual(seasonRange.start.toISOString(), "2026-08-09T12:00:00.000Z");
assert.strictEqual(seasonRange.end.toISOString(), "2026-11-09T12:00:00.000Z");
const openEndedSeason = _test.configuredSeasonRange({
  openAt: "2026-08-09T12:00:00.000Z",
  activateAt: null
});
assert.strictEqual(openEndedSeason.configured, true);
assert.strictEqual(openEndedSeason.end, null);

const summary = _test.foldDonationGroups([
  { _id: { platform: "youtube", inSeason: true, beforeSeason: false, inMonth: true }, totalEvents: 2, boundEvents: 1, totalTwd: 300, totalDiamonds: 3 },
  { _id: { platform: "ecpay", inSeason: true, beforeSeason: false, inMonth: true }, totalEvents: 1, boundEvents: 1, totalTwd: 500, totalDiamonds: 5 },
  { _id: { platform: "manual", inSeason: false, beforeSeason: true, inMonth: false }, totalEvents: 1, boundEvents: 0, totalTwd: 200, totalDiamonds: 0 }
], range, seasonRange);

assert.strictEqual(summary.totalTwd, 1000);
assert.strictEqual(summary.bySource.youtube.totalTwd, 300);
assert.strictEqual(summary.bySource.ecpay.totalTwd, 500);
assert.strictEqual(summary.bySource.other.totalTwd, 200);
assert.strictEqual(summary.season.totalTwd, 800);
assert.strictEqual(summary.season.bySource.youtube.totalTwd, 300);
assert.strictEqual(summary.season.bySource.ecpay.totalTwd, 500);
assert.strictEqual(summary.beforeSeason.totalTwd, 200);
assert.strictEqual(summary.month.totalTwd, 800);
assert.strictEqual(summary.month.bySource.youtube.totalEvents, 2);
assert.strictEqual(summary.month.bySource.ecpay.totalEvents, 1);
assert.strictEqual(summary.month.bySource.other.totalEvents, 0);

console.log("✅ 斗內營收分流測試通過：設定季度為主、月份輔助、YouTube／綠界／其他與全部合計皆正確");
