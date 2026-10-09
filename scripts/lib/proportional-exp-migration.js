"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { EXP_REQUIREMENTS: NEW_CURVE } = require("../../src/shared/progression");
const { CHARACTER_SLOTS, activeCharacterSlot, snapshotForSlot } = require("../../src/shared/characterLevelSummary");
const VERSION = "exp-curve-proportional-20261005-v1";
// The deployed predecessor, including the earlier 20–39 redistribution.
const OLD_CURVE = Object.freeze([1092, 2219, 3361, 4512, 5670, 6834, 8003, 9173, 10348, 32040, 33643, 46470, 62557, 82365, 106417, 135228, 169363, 209404, 255953, 225970, 270842, 321906, 379670, 444662, 517434, 598542, 688570, 788112, 897786, 897786, 965198, 1085948, 1217381, 1360075, 1514619, 1590352, 1755495, 1932686, 2122454, 4620982, 5051289, 5509830, 5997734, 6516100, 7066103, 7648892, 8265641, 8917560, 9605836]);
const ATTRS = ["str", "agi", "vit", "int", "dex", "luk"];
function consumed(curve, level) { return curve.slice(0, level - 1).reduce((s, v) => s + v, 0); }
function convert(snapshot, playerId, slot, at) {
  const level = Number(snapshot.level), exp = Number(snapshot.exp || 0);
  assert.ok(Number.isInteger(level) && level >= 1 && level <= 50, "invalid level");
  assert.ok(Number.isSafeInteger(exp) && exp >= 0, "invalid remaining EXP");
  const earned = consumed(OLD_CURVE, level) + exp;
  // Never revoke earned levels or attributes. Record the small early-level top-up.
  const topUp = Math.max(0, consumed(NEW_CURVE, level) - earned);
  const total = earned + topUp;
  let nextLevel = 1, remaining = total;
  while (nextLevel < 50 && remaining >= NEW_CURVE[nextLevel - 1]) {
    remaining -= NEW_CURVE[nextLevel - 1]; nextLevel++;
  }
  assert.ok(nextLevel >= level, "downgrade forbidden");
  const patch = { level: nextLevel, exp: nextLevel === 50 ? 0 : remaining };
  const gained = nextLevel - level;
  const history = Array.isArray(snapshot.levelUpHistory) ? [...snapshot.levelUpHistory] : [];
  if (gained) {
    patch.attributes = { ...(snapshot.attributes || {}) };
    patch.statusPoints = (snapshot.statusPoints || 0) + gained;
    for (let l = level + 1; l <= nextLevel; l++) {
      const hash = crypto.createHash("sha256").update(`${VERSION}:${playerId}:${slot}:${l}`).digest();
      const attr = ATTRS[hash.readUInt32LE(0) % ATTRS.length];
      patch.attributes[attr] = (patch.attributes[attr] || 0) + 1;
      history.push({ fromLevel: l - 1, toLevel: l, startedAt: null, reachedAt: at,
        elapsedMs: null, source: "curve_rebalance", timingBasis: "curve_rebalance", version: VERSION,
        attrs: [attr], freePoints: 1 });
    }
    patch.levelUpHistory = history;
    patch.levelReachedAt = at;
    patch.levelStartedAt = at;
  }
  return { patch, record: { slot, oldLevel: level, oldExp: exp, newLevel: nextLevel,
    newExp: patch.exp, oldTotal: earned, topUp, gained,
    // Already-maxed characters retain their level; no migration currency minting.
    cappedExp: nextLevel === 50 ? remaining : 0 } };
}
function planProgress(doc, at) {
  if (doc.expCurveMigrations?.[VERSION]) return null;
  const active = activeCharacterSlot(doc), slots = structuredClone(doc.characterSlots || {});
  const records = [], set = {};
  for (const slot of CHARACTER_SLOTS) {
    const snapshot = snapshotForSlot(doc, slot);
    if (!snapshot) continue;
    const result = convert(snapshot, doc.playerId, slot, at);
    records.push(result.record);
    if (slot === active) {
      Object.assign(set, result.patch);
      if (slots[String(slot)]) Object.assign(slots[String(slot)], result.patch);
    } else Object.assign(slots[String(slot)], result.patch);
  }
  if (doc.characterSlots) set.characterSlots = slots;
  set.updatedAt = at;
  set.expCurveMigrations = { ...(doc.expCurveMigrations || {}), [VERSION]: { at, characters: records } };
  return { set, records };
}
module.exports = { VERSION, OLD_CURVE, NEW_CURVE, consumed, convert, planProgress };
