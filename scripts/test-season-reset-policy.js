"use strict";

const assert = require("node:assert/strict");
const {
  SEASON_RESET_RULES,
  filterKeptInventory,
  buildProgressResetUpdate,
  removableUniqueGrantFilter,
} = require("../src/services/admin/seasonResetPolicy");

const title = { uuid: "title", itemId: "title-1", itemType: "title", equipSlot: "title_eq" };
const collectible = { uuid: "collect", itemId: "cg-1", itemType: "collection" };
const storyAnchor = { uuid: "story-anchor", itemId: "s-legend-resonance", itemType: "equipment", equipSlot: "anchor" };
const seasonAnchor = { uuid: "season-anchor", itemId: "s-seasonal", itemType: "equipment", equipSlot: "anchor" };
const egg = { uuid: "egg", itemId: "egg-1", itemType: "pet_egg" };
const sword = { uuid: "sword", itemId: "sword-1", itemType: "equipment", equipSlot: "weapon" };
const persistent = { uuid: "persistent", itemId: "event-keepsake", itemType: "equipment", equipSlot: "anchor", seasonPersistent: true };

const kept = filterKeptInventory([title, collectible, storyAnchor, seasonAnchor, egg, sword, persistent]);
assert.deepEqual(kept.map((item) => item.uuid), ["title", "collect", "story-anchor", "persistent"]);

const configuredKept = filterKeptInventory([seasonAnchor], new Set(["s-seasonal"]));
assert.deepEqual(configuredKept.map((item) => item.uuid), ["season-anchor"]);

const old = {
  playerId: "player-1",
  level: 50,
  storyProgress: { completed: { "chapter-1": true } },
  petDex: { wolf: true },
  cardDex: { card: true },
  playerTier: "gold",
  inventory: [title, collectible, storyAnchor, seasonAnchor, egg, sword],
  equipment: { title_eq: title, anchor: storyAnchor, weapon: sword },
};
const update = buildProgressResetUpdate(old, "2026-08-10T00:00:00.000Z");
assert.equal(update.$set.level, 1);
assert.equal(update.$set.job, "Novice");
assert.deepEqual(update.$set.allocatedAttrs, {});
assert.equal(update.$set.equipment.title_eq.uuid, "title");
assert.equal(update.$set.equipment.anchor.uuid, "story-anchor");
assert.notEqual(update.$set.equipment.weapon.itemId, "sword-1");
assert.equal(update.$unset.jobTransfers, "");
assert.equal(update.$unset.soloBoss, "");
const keyedUpdate = buildProgressResetUpdate(old, "2026-08-10T00:00:00.000Z", { seasonKey: "s-test" });
assert.equal(keyedUpdate.$set.seasonKey, "s-test");
for (const permanent of ["storyProgress", "petDex", "cardDex", "cardDexClaims", "playerTier", "idleRewardReversal"]) {
  assert.equal(Object.hasOwn(update.$set, permanent), false, `${permanent} must not be overwritten`);
  assert.equal(Object.hasOwn(update.$unset, permanent), false, `${permanent} must not be removed`);
}

const noStoryAnchor = buildProgressResetUpdate({ ...old, equipment: { anchor: seasonAnchor } });
assert.equal(noStoryAnchor.$set.equipment.anchor, null);

const grantFilter = removableUniqueGrantFilter("player-1");
assert.equal(grantFilter.discordId, "player-1");
assert.ok(grantFilter.itemId.$nin.includes("s-legend-resonance"));
assert.ok(SEASON_RESET_RULES.keep.includes("交易稽核紀錄"));
assert.ok(SEASON_RESET_RULES.reset.includes("賽季通行證"));

console.log("[SeasonResetPolicy] pass");
