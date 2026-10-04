"use strict";
const assert = require("node:assert/strict");
const { ANCHORS_ENABLED, isDisabledAnchor, activeEquipment, assertAnchorAvailable } = require("../src/shared/anchorFeature");
const { calcPlayerStats } = require("../src/shared/combatStats");
const { collectEquipmentEffects, collectEffectRefsFromEntry, mergeEquippedFromLibrary } = require("../src/shared/effectEngine");
const { ShopService } = require("../src/services/shop/shopService");
const { CasinoService } = require("../src/services/casino/casinoService");
const { WeeklyQuestService } = require("../src/services/weeklyQuest/weeklyQuestService");
const { StoryService } = require("../src/services/story/storyService");
const { buildProgressResetUpdate } = require("../src/services/admin/seasonResetPolicy");

async function main() {
  assert.equal(ANCHORS_ENABLED, false);
  const anchor = { uuid: "kept-anchor", itemId: "s-legend-saint", itemType: "equipment", equipSlot: "anchor", equipStats: { str: 999, vit: 999 }, passiveEffects: [{ key: "atk_multiplier_up", trigger: "passive", params: { value: 50 } }] };
  const card = { itemId: "ordinary-card", equipSlot: "special_1", passiveEffects: [{ key: "str_up", trigger: "passive", params: { value: 3 } }] };
  const equipment = { anchor, special_1: card };
  const original = structuredClone(equipment);
  assert.deepEqual(calcPlayerStats({}, equipment), calcPlayerStats({}, { special_1: card }));
  assert.deepEqual(collectEffectRefsFromEntry(anchor), []);
  assert.equal(collectEquipmentEffects(equipment).length, 1);
  assert.equal(activeEquipment(equipment).anchor, null);
  assert.deepEqual(equipment, original, "Runtime filtering must not mutate assets");
  const merged = await mergeEquippedFromLibrary(equipment, { findById: async () => null });
  assert.equal(merged.anchor.uuid, anchor.uuid, "Repository hydration must preserve owned anchors");
  assert.equal(isDisabledAnchor("s-legend-resonance"), true);
  assert.equal(isDisabledAnchor("chest-anchor-pack"), false, "The normal card pack stays available");
  assert.throws(() => assertAnchorAvailable(anchor), { code: "FEATURE_DISABLED" });

  let saves = 0;
  const progress = { playerId: "test", inventory: [anchor], equipment: {} };
  const shop = Object.create(ShopService.prototype);
  shop.progressRepository = { findByPlayerId: async () => progress, save: async () => { saves++; } };
  await assert.rejects(() => shop.equipItem("test", anchor.uuid), { code: "FEATURE_DISABLED" });
  await assert.rejects(() => shop.useItem("test", anchor.uuid, "test"), { code: "FEATURE_DISABLED" });
  assert.equal(saves, 0);
  assert.equal(await shop._tryRollDaishiLegendaryChest("test"), null);
  assert.equal(await CasinoService.prototype._tryGrantDiceJackpot.call({}, "test"), null, "No unique grant consumed");

  const quests = new WeeklyQuestService({ listQuests: async () => [
    { id: "anchor-quest", cadence: "season", rewardItemId: anchor.itemId, enabled: true },
    { id: "cards", cadence: "daily", rewardItemId: "chest-anchor-pack", enabled: true },
  ] }, {});
  const defs = await quests.listDefinitions();
  assert.deepEqual(defs.map(q => q.id), ["cards"]);
  await assert.rejects(() => quests.claimReward("test", "anchor-quest"), /任務不存在/);

  const story = Object.create(StoryService.prototype);
  story._enabledChapters = async () => [{ id: "chapter", nodes: [{ grantItemId: anchor.itemId }] }];
  story._chapterStatus = () => "available";
  story._completedMap = () => ({});
  story.progressRepository = shop.progressRepository;
  story.itemRepository = { findById: async () => anchor };
  assert.deepEqual(await story.grantNodeItem("test", "chapter", 0), { granted: false, reason: "feature_disabled" });
  assert.equal(saves, 0, "Story remains completable without consuming permanent claim");

  const persistent = { ...anchor, itemId: "s-legend-resonance", uuid: "permanent" };
  const title = { uuid: "title", itemId: "title", itemType: "title", equipSlot: "title_eq" };
  const old = { playerId: "test", level: 50, playerTier: "C", jobExp: 900, accountSoloBoss: { kills: 5 }, activeCharacterSlot: 2,
    equipment: { anchor: persistent }, inventory: [], characterSlots: {
      1: { level: 49, job: "Knight", equipment: { title_eq: title, weapon: { uuid: "old", itemId: "old" } }, equipPresets: { A: { weapon: { uuid: "old" } } } },
      2: { level: 50, equipment: { weapon: { uuid: "stale", itemId: "old" } } },
      3: { level: 45, equipment: { armor: { uuid: "keepsake", itemId: "keep", seasonPersistent: true } } },
    } };
  const update = buildProgressResetUpdate(old, undefined, { seasonKey: "next" });
  assert.equal(update.$set.activeCharacterSlot, 2);
  assert.equal(update.$set.jobExp, 0);
  assert.equal(update.$unset.accountSoloBoss, "");
  for (const ch of Object.values(update.$set.characterSlots)) {
    assert.equal(ch.level, 1); assert.equal(ch.job, "Novice"); assert.equal(ch.jobExp, 0);
    assert.deepEqual(ch.equipPresets, {});
    assert.notEqual(ch.equipment.weapon?.itemId, "old");
  }
  assert.equal(update.$set.characterSlots[1].equipment.title_eq.uuid, "title");
  assert.equal(update.$set.characterSlots[2].equipment.anchor.uuid, "permanent");
  assert.deepEqual(update.$set.inventory.map(x => x.uuid), ["keepsake"]);
  assert.equal(old.characterSlots[1].level, 49, "Reset builder must not mutate input");
  console.log("PASS: anchor stats/effects, inventory preservation, equipment/consumable guards, quest/story/chest/casino gates, normal card pack, all character resets and permanent assets");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
