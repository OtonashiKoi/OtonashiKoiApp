"use strict";
const assert = require("node:assert/strict");
const { ObjectId } = require("mongodb");
const { ShopService } = require("../src/services/shop/shopService");
const { CharacterService } = require("../src/services/character/characterService");
const { GEAR_SLOTS, getEquipmentRequiredLevel, isEquipmentLevelAllowed } = require("../src/shared/equipmentLevel");
const { restoreUnderLevelEquipment } = require("./migrate-equipment-level");
function gear(id, tier, slot = "weapon", str = 1) {
  return { uuid: id, itemId: id, itemName: id, tier, itemType: "equipment", equipSlot: slot, weaponType: slot === "weapon" ? "sword_1h" : null, equipStats: { str }, enhanceLevel: 4, enchantments: [{ key: "str", value: 4.8 }] };
}
function harness(level, inventory, equipment = {}, library = []) {
  let state = { playerId: "equip-level-test", level, attributes: { str: 10, vit: 10, agi: 10, int: 10, dex: 10, luk: 10 }, inventory, equipment, equipPresets: {} }, saves = 0;
  const repo = { findByPlayerId: async () => structuredClone(state), save: async p => { state = structuredClone(p); saves++; } };
  const items = new Map(library.map(i => [i.itemId, { ...i, id: i.itemId }]));
  const service = new ShopService(null, null, null, repo, null, { findById: async id => items.get(id) || null }, null);
  return { service, state: () => state, saves: () => saves, preset: p => { state.equipPresets.B = p; } };
}
async function run() {
  let cases = 0;
  for (const slot of GEAR_SLOTS) for (const tier of ["D", "C", "B", "A", "S"]) {
    const item = gear("test", tier, slot), rare = ["A", "S"].includes(tier);
    assert.equal(getEquipmentRequiredLevel(item), rare ? 30 : 0);
    assert.equal(isEquipmentLevelAllowed(item, 29), !rare);
    assert.equal(isEquipmentLevelAllowed(item, 30), true); cases++;
  }
  for (const slot of ["special", "special_1", "job_eq", "title_eq", "anchor"]) assert.equal(getEquipmentRequiredLevel(gear("x", "S", slot)), 0);
  for (const tier of ["A", "S"]) for (const level of [29, 30]) {
    const item = gear("rare", tier), h = harness(level, [item]); const before = structuredClone(h.state());
    if (level < 30) { await assert.rejects(() => h.service.equipItem("test", "rare"), { code: "EQUIPMENT_LEVEL_REQUIRED" }); assert.deepEqual(h.state(), before); assert.equal(h.saves(), 0); }
    else { await h.service.equipItem("test", "rare"); assert.equal(h.state().equipment.weapon.uuid, "rare"); assert.equal(h.state().inventory.length, 0); } cases++;
  }
  const stale = harness(29, [gear("stale", "B")], {}, [gear("stale", "A")]);
  await assert.rejects(() => stale.service.equipItem("test", "stale"), { code: "EQUIPMENT_LEVEL_REQUIRED" }); assert.equal(stale.saves(), 0); cases++;
  for (const mode of ["manual", "auto", "preset"]) {
    const h = harness(29, [gear("offline", "B")]); h.preset({ weapon: { uuid: "offline" } });
    h.service.itemRepository = { findById: async () => { throw new Error("catalog unavailable"); } };
    const action = mode === "manual" ? () => h.service.equipItem("test", "offline") : mode === "auto" ? () => h.service.autoEquipMaxAtk("test") : () => h.service.switchEquipPreset("test", "B");
    await assert.rejects(action, /catalog unavailable/); assert.equal(h.saves(), 0); cases++;
  }
  const unavailable = harness(30, [gear("closed", "A", "armor")], {}, [gear("closed", "S", "armor")]);
  await assert.rejects(() => unavailable.service.equipItem("test", "closed"), { code: "FEATURE_DISABLED" }); cases++;
  const twoHand = { ...gear("two", "A"), weaponType: "sword_2h", isTwoHanded: true };
  const shield = gear("shield", "B", "shield"), blocked = harness(29, [twoHand], { shield });
  await assert.rejects(() => blocked.service.equipItem("test", "two"), { code: "EQUIPMENT_LEVEL_REQUIRED" }); assert.deepEqual(blocked.state().equipment.shield, shield); assert.equal(blocked.saves(), 0); cases++;
  for (const level of [29, 30]) {
    const ordinary = gear("ordinary", "B"), rare = gear("rare", "B", "weapon", 99), armor = gear("armor", "A", "armor", 50);
    const h = harness(level, [ordinary, rare, armor], {}, [gear("rare", "A", "weapon", 99)]);
    await h.service.autoEquipMaxAtk("test");
    assert.equal(h.state().equipment.weapon.uuid, level < 30 ? "ordinary" : "rare");
    assert.equal(Boolean(h.state().equipment.armor), level >= 30);
    assert.deepEqual([...h.state().inventory, ...Object.values(h.state().equipment)].filter(Boolean).map(i => i.uuid).sort(), ["armor", "ordinary", "rare"]); cases++;
  }
  const mismatched = harness(29, [gear("bow", "B")], { weapon: { ...gear("old-rare", "A"), weaponType: "staff_1h" }, job_eq: { itemId: "job_archer_v1", itemType: "job_badge", equipSlot: "job_eq" } });
  await assert.rejects(() => mismatched.service.autoEquipMaxAtk("test"), { code: "ITEM_NOT_FOUND" }); assert.equal(mismatched.saves(), 0); cases++;
  for (const tier of ["A", "S"]) for (const level of [29, 30]) {
    const h = harness(level, [gear("rare", "B")], { weapon: gear("old", "B") }, [gear("rare", tier)]);
    h.preset({ weapon: { uuid: "rare", itemId: "rare", equipSlot: "weapon" } });
    await h.service.switchEquipPreset("test", "B");
    assert.equal(h.state().equipment.weapon?.uuid || null, level < 30 ? null : "rare");
    assert.deepEqual([...h.state().inventory, ...Object.values(h.state().equipment)].filter(Boolean).map(i => i.uuid).sort(), ["old", "rare"]); cases++;
  }
  const retained = gear("retain", "A", "garment"); retained._id = new ObjectId();
  const progress = { _id: new ObjectId(), level: 29, exp: 123, inventory: [gear("normal", "B")], equipment: { garment: retained } };
  const restored = restoreUnderLevelEquipment(progress, new Map());
  assert.equal(restored.moved.length, 1); assert.equal(restored.next.equipment.garment, null);
  assert.deepEqual(restored.next.inventory[1], retained); assert.deepEqual(restored.next._id, progress._id); assert.equal(restored.next.exp, 123);
  assert.equal(restoreUnderLevelEquipment(restored.next, new Map()).moved.length, 0);
  assert.equal(restoreUnderLevelEquipment({ ...progress, level: 30 }, new Map()).moved.length, 0);
  assert.throws(() => restoreUnderLevelEquipment({ ...progress, inventory: [retained] }, new Map()), { code: "EQUIPMENT_INSTANCE_CONFLICT" }); cases++;
  const alt = gear("alt-rare", "A", "garment");
  const multi = { ...progress, activeCharacterSlot: 1, characterSlots: { "1": { level: 29, equipment: { garment: retained } }, "2": { level: 23, equipment: { garment: alt } } } };
  const multiRestored = restoreUnderLevelEquipment(multi, new Map());
  assert.equal(multiRestored.moved.length, 2); assert.equal(multiRestored.next.inventory.length, 3);
  assert.equal(multiRestored.next.characterSlots["1"].equipment.garment, null);
  assert.equal(multiRestored.next.characterSlots["2"].equipment.garment, null);
  assert.deepEqual(multiRestored.next.inventory[2], alt);
  assert.equal(restoreUnderLevelEquipment(multiRestored.next, new Map()).moved.length, 0);
  assert.equal(restoreUnderLevelEquipment({ ...multi, level: 30 }, new Map()).moved.length, 1); cases++;
  for (const tier of ["A", "S"]) for (const level of [29, 30]) {
    const target = { ...gear("target", "B"), _id: undefined }, title = gear("title", "S", "title_eq");
    let state = { playerId: "character-level-test", playerTier: "SS", activeCharacterSlot: 1, level: 40, inventory: [gear("bag", "B")], equipment: { weapon: gear("main", "A") }, characterSlots: { "2": { level, equipment: { weapon: target, title_eq: title } } } };
    const service = new CharacterService({ progressRepository: { findByPlayerId: async () => structuredClone(state), save: async next => { state = structuredClone(next); } }, itemRepository: { findById: async id => id === "target" ? { ...target, tier } : null } });
    await service.switchCharacter("character-level-test", 2);
    assert.equal(state.equipment.weapon?.uuid || null, level < 30 ? null : "target");
    assert.equal(state.equipment.title_eq.uuid, "title");
    assert.equal(state.inventory.filter(i => i.uuid === "target").length, level < 30 ? 1 : 0);
    if (level < 30) assert.deepEqual(JSON.parse(JSON.stringify(state.inventory.find(i => i.uuid === "target"))), JSON.parse(JSON.stringify(target)));
    await service.switchCharacter("character-level-test", 1); await service.switchCharacter("character-level-test", 2);
    assert.equal(state.inventory.filter(i => i.uuid === "target").length, level < 30 ? 1 : 0); cases++;
  }
  console.log(JSON.stringify({ passed: true, cases, checks: ["29/30 boundaries across ten gear slots", "D/C/B and protected slots unchanged", "manual rejection has zero writes", "catalog tier overrides stale snapshots", "existing S non-mainhand gate preserved", "two-handed rejection preserves shield", "auto equip skips rare gear and fallback", "presets keep blocked items in inventory", "restoration preserves UUID, enhancement, enchantment and BSON IDs", "restoration idempotency and duplicate guard"] }));
}
run().catch(e => { console.error(e); process.exitCode = 1; });
