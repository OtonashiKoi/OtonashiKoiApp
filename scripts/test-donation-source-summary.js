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

const summary = _test.foldDonationGroups([
  { _id: { platform: "youtube", phase: "old", inMonth: true }, totalEvents: 2, boundEvents: 1, totalTwd: 300, totalDiamonds: 3 },
  { _id: { platform: "ecpay", phase: "new", inMonth: true }, totalEvents: 1, boundEvents: 1, totalTwd: 500, totalDiamonds: 5 },
  { _id: { platform: "manual", phase: "old", inMonth: false }, totalEvents: 1, boundEvents: 0, totalTwd: 200, totalDiamonds: 0 }
], range);

assert.strictEqual(summary.totalTwd, 1000);
assert.strictEqual(summary.bySource.youtube.totalTwd, 300);
assert.strictEqual(summary.bySource.ecpay.totalTwd, 500);
assert.strictEqual(summary.bySource.other.totalTwd, 200);
assert.strictEqual(summary.phases.old.totalTwd, 500);
assert.strictEqual(summary.phases.new.totalTwd, 500);
assert.strictEqual(summary.month.totalTwd, 800);
assert.strictEqual(summary.month.bySource.youtube.totalEvents, 2);
assert.strictEqual(summary.month.bySource.ecpay.totalEvents, 1);
assert.strictEqual(summary.month.bySource.other.totalEvents, 0);

console.log("✅ 抖內營收分流測試通過：YouTube／綠界／其他、台北月份與全部合計皆正確");
