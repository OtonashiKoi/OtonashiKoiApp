"use strict";
const assert = require("node:assert/strict");
const { VERSION, NEW_CURVE, OLD_CURVE, consumed, convert, planProgress } = require("./lib/proportional-exp-migration");
const at = "2026-10-05T10:00:00.000Z";
const attrs = { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 };
function character(level, exp = 0) { return { level, exp, attributes: { ...attrs }, statusPoints: 2, job: "mage", equipment: { weapon: { uuid: "keep" } }, levelUpHistory: [] }; }
assert.equal(NEW_CURVE.reduce((s, v) => s + v, 0), 41425282);
const top = convert(character(41, 2433201), "top", 1, at);
assert.equal(top.patch.level, 45);
assert.equal(top.patch.exp, 1426646);
assert.equal(top.patch.statusPoints, 6);
assert.equal(Object.values(top.patch.attributes).reduce((s, v) => s + v, 0), 10);
assert.equal(top.patch.levelUpHistory.length, 4);
assert.ok(top.patch.levelUpHistory.every(r => r.elapsedMs === null && r.timingBasis === "curve_rebalance"));
for (let level = 1; level <= 50; level++) {
  for (const exp of [0, level < 50 ? OLD_CURVE[level - 1] - 1 : 0]) {
    const r = convert(character(level, exp), "boundary", 1, at);
    assert.ok(r.patch.level >= level);
    assert.equal(consumed(NEW_CURVE, r.patch.level) + r.patch.exp + r.record.cappedExp,
      consumed(OLD_CURVE, level) + exp + r.record.topUp);
    if (r.patch.level < 50) assert.ok(r.patch.exp < NEW_CURVE[r.patch.level - 1]);
    if (r.record.gained) {
      assert.equal(r.patch.statusPoints - 2, r.record.gained);
      assert.equal(Object.values(r.patch.attributes).reduce((s, v) => s + v, 0) - 6, r.record.gained);
    }
  }
}
const doc = { playerId: "three-slots", ...character(29, 116798), activeCharacterSlot: 2,
  inventory: [{ uuid: "shared" }], characterSlots: { "1": character(27, 468550), "2": character(1), "3": character(2) } };
const original = structuredClone(doc), plan = planProgress(doc, at);
assert.deepEqual(doc, original, "planner must not mutate source");
assert.equal(plan.set.level, 31);
assert.equal(plan.set.characterSlots["1"].level, 30);
assert.equal(plan.set.characterSlots["2"].level, 31, "active top-level overrides stale stored slot");
assert.equal(plan.set.characterSlots["3"].level, 2, "no early-level downgrade");
assert.ok(plan.records.find(r => r.slot === 3).topUp > 0);
const saved = { ...doc, ...plan.set };
assert.equal(planProgress(saved, at), null);
assert.deepEqual(saved.inventory, original.inventory);
assert.deepEqual(saved.equipment, original.equipment);
assert.equal(saved.job, original.job);
assert.equal(saved.expCurveMigrations[VERSION].characters.length, 3);
assert.throws(() => convert(character(0), "bad", 1, at));
assert.throws(() => convert(character(1, -1), "bad", 1, at));
console.log("PASS: anchor Lv45/50%, all level boundaries, EXP conservation/top-ups, earned levels, 1+1 points, three slots, stale active mirror, idempotency, assets preserved");
