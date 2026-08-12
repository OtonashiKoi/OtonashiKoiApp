#!/usr/bin/env node
"use strict";

const assert = require("assert");
const { CraftingService } = require("../src/services/crafting/craftingService");
const { OWNER_TESTER_ID } = require("../src/shared/craftingAccess");
const { requireCraftingTester } = require("../src/api/routes/playerCraftingRoutes");
const { recipes: ownerRecipes } = require("./seed-crafting-test-recipes");
const { ENHANCE_GEMS } = require("../src/shared/enhanceConfig");

const WATER = "element-stone-water";
const FIRE = "element-stone-fire";
const GEM_D = "72fde92d-e33f-42fb-8d86-2e811d03f84d";

function entry(itemId, stackCount, extra = {}) {
  return { uuid: `${itemId}-${Math.random()}`, itemId, itemName: itemId, itemType: "consumable", stackCount, ...extra };
}

async function main() {
  const recipeMap = new Map(ownerRecipes.map((item) => [item.id, item]));
  const expectFiveToOne = (id, inputId, outputId) => {
    const item = recipeMap.get(id);
    assert.ok(item, `缺少配方 ${id}`);
    assert.deepStrictEqual(item.inputs, [{ itemId: inputId, quantity: 5 }]);
    assert.deepStrictEqual(item.outputs, [{ itemId: outputId, quantity: 1 }]);
    assert.strictEqual(item.goldCost, 0);
    assert.strictEqual(item.accessMode, "owner_test");
  };
  assert.strictEqual(ownerRecipes.length, 10, "正式封閉測試表應有 10 張配方");
  expectFiveToOne("craft-gem-d-to-c", ENHANCE_GEMS.D, ENHANCE_GEMS.C);
  expectFiveToOne("craft-gem-c-to-b", ENHANCE_GEMS.C, ENHANCE_GEMS.B);
  expectFiveToOne("craft-gem-b-to-a", ENHANCE_GEMS.B, ENHANCE_GEMS.A);
  expectFiveToOne("craft-element-wood-to-fire", "element-stone-wood", "element-stone-fire");
  expectFiveToOne("craft-element-fire-to-earth", "element-stone-fire", "element-stone-earth");
  expectFiveToOne("craft-element-earth-to-metal", "element-stone-earth", "element-stone-metal");
  expectFiveToOne("craft-element-metal-to-water", "element-stone-metal", "element-stone-water");
  expectFiveToOne("craft-element-water-to-wood", "element-stone-water", "element-stone-wood");
  expectFiveToOne("craft-element-sun-to-moon", "element-stone-sun", "element-stone-moon");
  expectFiveToOne("craft-element-moon-to-sun", "element-stone-moon", "element-stone-sun");

  const recipe = {
    id: "test-recipe",
    name: "測試配方",
    enabled: true,
    accessMode: "owner_test",
    testerIds: [OWNER_TESTER_ID],
    inputs: [{ itemId: WATER, quantity: 3 }, { itemId: FIRE, quantity: 2 }],
    outputs: [{ itemId: GEM_D, quantity: 1 }],
    goldCost: 100,
    maxBatch: 10,
    testOnly: true
  };
  const defs = new Map([
    [WATER, { id: WATER, name: "水屬性石", itemType: "consumable" }],
    [FIRE, { id: FIRE, name: "火屬性石", itemType: "consumable" }],
    [GEM_D, { id: GEM_D, name: "D階寶石", itemType: "consumable", tier: "D" }]
  ]);
  let progress = {
    playerId: OWNER_TESTER_ID,
    seasonKey: "test-season",
    updatedAt: "v1",
    inventory: [entry(WATER, 10), entry(WATER, 100, { locked: true }), entry(FIRE, 10), entry(GEM_D, 2)]
  };
  let wallet = { playerId: OWNER_TESTER_ID, gold: 1000, diamond: 0 };
  const logs = [];

  const craftingRepository = {
    async listAccessible() { return [recipe]; },
    async findRecipeById(id) { return id === recipe.id ? recipe : null; },
    async executeCraftAtomic(payload) {
      assert.strictEqual(payload.expectedUpdatedAt, progress.updatedAt);
      progress = { ...progress, inventory: payload.nextInventory, updatedAt: `v${logs.length + 2}` };
      wallet = { ...wallet, gold: wallet.gold - payload.goldCost };
      logs.push(payload.transaction);
      return { ok: true, wallet };
    }
  };
  const service = new CraftingService({
    craftingRepository,
    progressRepository: { async findByPlayerId() { return structuredClone(progress); } },
    walletRepository: { async findByPlayerId() { return { ...wallet }; } },
    itemRepository: { async findById(id) { return defs.get(id) || null; } }
  });

  await assert.rejects(
    () => service.getPlayerState("not-owner"),
    (error) => error?.code === "CRAFTING_TEST_ONLY" && error?.status === 403
  );

  const before = await service.getPlayerState(OWNER_TESTER_ID);
  assert.strictEqual(before.recipes[0].maxCraftable, 3, "鎖定的 100 顆水石不可算入可用素材");
  assert.strictEqual(before.recipes[0].canCraft, true);

  const result = await service.craft(OWNER_TESTER_ID, recipe.id, 2);
  assert.strictEqual(result.goldSpent, 200);
  assert.strictEqual(wallet.gold, 800);
  assert.strictEqual(logs.length, 1);
  const count = (id, locked = false) => progress.inventory
    .filter((item) => item.itemId === id && Boolean(item.locked) === locked)
    .reduce((sum, item) => sum + Math.max(1, Number(item.stackCount) || 1), 0);
  assert.strictEqual(count(WATER), 4, "應扣除 6 顆未鎖定水石");
  assert.strictEqual(count(WATER, true), 100, "鎖定素材不可被合成消耗");
  assert.strictEqual(count(FIRE), 6, "應扣除 4 顆火石");
  assert.strictEqual(count(GEM_D), 4, "既有成品堆疊應從 2 增加到 4");

  await assert.rejects(
    () => service.craft(OWNER_TESTER_ID, recipe.id, 2),
    (error) => error?.code === "INSUFFICIENT_MATERIALS"
  );

  let nextCalled = false;
  requireCraftingTester(
    { playerRecord: { discordId: OWNER_TESTER_ID } },
    {},
    () => { nextCalled = true; }
  );
  assert.strictEqual(nextCalled, true, "音無恋應通過 route 權限");

  let deniedStatus = 0;
  let deniedPayload = null;
  requireCraftingTester(
    { playerRecord: { discordId: "other-player" } },
    { status(code) { deniedStatus = code; return this; }, json(payload) { deniedPayload = payload; return payload; } },
    () => { throw new Error("非測試者不應通過"); }
  );
  assert.strictEqual(deniedStatus, 403);
  assert.strictEqual(deniedPayload.code, "CRAFTING_TEST_ONLY");

  console.log("crafting system tests: passed (system + 10 recipe rules)");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
