"use strict";
const assert = require("node:assert/strict");
const { WeeklyQuestService } = require("../src/services/weeklyQuest/weeklyQuestService");

async function main() {
  const badge = "job_holyblade_t2_v1";
  const quest = {
    id: "test-holyblade-transfer", cadence: "job", enabled: true,
    type: "t2_transfer", target: 1, isT2Trial: true, rewardItemId: badge,
    unlockRequireItemIds: ["job_swordsman_v1"], unlockLevel: 35,
  };
  const service = new WeeklyQuestService({ getPlayerProgress: async () => ({}) }, {});
  for (const [owned, cost] of [[0, 250000], [1, 1000000], [2, 3000000], [3, 3000000]]) {
    const context = {
      level: 50, ownedT2Count: owned, ownedT2BaseKeys: new Set(),
      inventoryItemIds: new Set(["job_swordsman_v1"]), equippedItemIds: new Set(),
      t2Eligibility: { [badge]: { eligible: true } },
    };
    const rows = await service._getProgressByCadence("test-player", "job", { definitions: [quest], context });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].transferCost, cost);
    assert.equal(rows[0].transferBadgeName, "劍士徽章");
    assert.equal(rows[0].done, true);
  }
  console.log("✅ 二轉任務消耗顯示與後端逐次費用一致");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
