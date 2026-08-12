"use strict";

const assert = require("node:assert/strict");
const { EnhanceService } = require("../src/services/enhance/enhanceService");
const {
  getElementRemovalCost,
  MAX_ELEMENT_REMOVALS_PER_ITEM,
} = require("../src/shared/enhanceConfig");

assert.deepEqual(getElementRemovalCost(1, 1), { gold: 9000, success: 50 });
assert.deepEqual(getElementRemovalCost(2, 1), { gold: 9000, success: 40 });
assert.deepEqual(getElementRemovalCost(3, 2), { gold: 24000, success: 30 });
assert.deepEqual(getElementRemovalCost(4, 3), { gold: 60000, success: 20 });
assert.deepEqual(getElementRemovalCost(5, 5), { gold: 150000, success: 10 });

const equipment = {
  uuid: "equipment-1",
  itemId: "test-equipment",
  itemName: "測試水火劍",
  itemType: "equipment",
  equipSlot: "weapon",
  tier: "S",
  elements: { water: 3, fire: 2 },
};
const progress = {
  playerId: "player-1",
  displayName: "測試玩家",
  inventory: [equipment],
  equipment: {},
};
const wallet = { playerId: "player-1", gold: 1_000_000 };
let saves = 0;
const charges = [];

const service = new EnhanceService(
  {
    async findByPlayerId() { return progress; },
    async save() { saves += 1; return progress; },
  },
  null,
  { async findByPlayerId() { return wallet; } },
  {
    async grantCurrency({ amount, operator }) {
      wallet.gold += amount;
      charges.push({ amount, operator });
      return { wallet };
    },
  }
);

(async () => {
  const before = await service.getElementSocketInfo("player-1", equipment.uuid);
  assert.equal(before.socketsFilled, 5);
  assert.equal(before.removalsUsed, 0);
  assert.equal(before.removalsMax, MAX_ELEMENT_REMOVALS_PER_ITEM);
  assert.deepEqual(before.perElement.find((row) => row.element === "water").removalCost, { gold: 60000, success: 10 });

  const originalRandom = Math.random;
  try {
    Math.random = () => 0;
    const success = await service.removeElementSocket("player-1", equipment.uuid, "water");
    assert.equal(success.success, true);
    assert.equal(success.previousLevel, 3);
    assert.equal(success.newLevel, 2);
    assert.equal(success.removalsUsed, 1);
    assert.deepEqual({ ...equipment.elements }, { water: 2, fire: 2 });
    assert.equal(equipment.elementRemovalCount, 1);
    assert.equal(wallet.gold, 940000);
    assert.equal(saves, 1);
    assert.deepEqual(charges[0], { amount: -60000, operator: "enhance:element-removal" });

    Math.random = () => 0.9999;
    const failure = await service.removeElementSocket("player-1", equipment.uuid, "fire");
    assert.equal(failure.success, false);
    assert.equal(failure.successRate, 20);
    assert.equal(failure.goldUsed, 24000);
    assert.equal(failure.removalsUsed, 1);
    assert.deepEqual({ ...equipment.elements }, { water: 2, fire: 2 });
    assert.equal(equipment.elementRemovalCount, 1);
    assert.equal(wallet.gold, 916000);
    assert.equal(saves, 1, "失敗只扣金幣，不應改寫裝備");

    equipment.elementRemovalCount = MAX_ELEMENT_REMOVALS_PER_ITEM;
    const goldBeforeRejected = wallet.gold;
    await assert.rejects(
      () => service.removeElementSocket("player-1", equipment.uuid, "water"),
      /已用完屬性拆除次數/
    );
    assert.equal(wallet.gold, goldBeforeRejected, "次數用完時不得扣款");
  } finally {
    Math.random = originalRandom;
  }

  console.log("✅ 屬性拆除費用與 50/40/30/20/10% 成功率正確");
  console.log("✅ 成功破壞石頭並永久計次；失敗只扣金幣且不增加次數");
})();
