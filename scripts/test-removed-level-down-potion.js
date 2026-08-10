"use strict";

const assert = require("node:assert/strict");
const { ShopService } = require("../src/services/shop/shopService");

const REMOVED_ITEM_ID = "9b8ad195-9ec1-401b-9b7f-2c1033628cba";

async function main() {
  const playerId = "test-removed-level-down-potion";
  const progress = {
    playerId,
    level: 25,
    exp: 1234,
    attributes: { str: 20, agi: 10, vit: 10, int: 10, dex: 10, luk: 10 },
    inventory: [{
      uuid: "removed-potion-entry",
      itemId: REMOVED_ITEM_ID,
      itemName: "【 我命由我不由天 】藥水",
      itemType: "consumable",
      itemEffect: { type: "level_down_random_attributes", value: 1 },
      stackCount: 2,
    }],
    updatedAt: "2026-08-10T00:00:00.000Z",
  };
  let saveCalls = 0;
  const progressRepository = {
    findByPlayerId: async () => progress,
    save: async () => { saveCalls += 1; },
    saveIfUnchanged: async () => { saveCalls += 1; return true; },
  };
  const service = new ShopService(null, null, null, progressRepository, null, null, null);

  await assert.rejects(
    service.useItem(playerId, "removed-potion-entry", "測試玩家"),
    (error) => error?.status === 400 && /降等藥水已移除/.test(error?.message || "")
  );
  await assert.rejects(
    service.useConsumableBulk(playerId, ["removed-potion-entry"], "測試玩家"),
    (error) => error?.status === 400 && /降等藥水已移除/.test(error?.message || "")
  );

  assert.equal(saveCalls, 0, "被移除的藥水不得寫入玩家進度");
  assert.equal(progress.level, 25);
  assert.equal(progress.exp, 1234);
  assert.equal(progress.inventory[0].stackCount, 2);
  console.log("✅ removed level-down potion is blocked before consumption and progress writes");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
