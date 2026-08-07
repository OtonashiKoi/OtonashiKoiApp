"use strict";

const assert = require("assert");
const { NpcOptionEffectError, processNpcOptionEffects } = require("../src/bot/handlers/npcOptionEffects");

function createContext({ gold = 100, inventory = [] } = {}) {
  const progress = { playerId: "p1", inventory: inventory.map((entry) => ({ ...entry })), equipment: {}, activeEffects: [] };
  const grants = [];
  return {
    progress,
    grants,
    serviceContext: {
      progressRepository: {
        findByPlayerId: async () => progress,
        save: async () => progress,
      },
      walletRepository: { findByPlayerId: async () => ({ gold, diamond: 0 }) },
      playerService: { ensurePlayer: async () => ({}) },
      itemService: {
        getItemById: async (id) => (id === "reward_sword"
          ? { id, name: "測試劍", itemType: "equipment", equipSlot: "weapon", weaponType: "sword_1h" }
          : id === "material" ? { id, name: "測試材料" } : null),
      },
      rewardService: {
        grantCurrency: async (input) => {
          grants.push(input);
          return {};
        },
      },
    },
  };
}

async function main() {
  const good = createContext({
    inventory: [{ uuid: "m1", itemId: "material", itemName: "測試材料", stackCount: 2 }],
  });
  const results = await processNpcOptionEffects({
    serviceContext: good.serviceContext,
    discordId: "p1",
    displayName: "Tester",
    option: {
      id: "trade",
      effects: [
        { type: "take_item", payload: { itemId: "material", count: 2 } },
        { type: "grant_currency", payload: { currencyType: "gold", amount: -50 } },
        { type: "grant_equipment", payload: { itemId: "reward_sword", enhanceLevel: 3 } },
        { type: "grant_buff", payload: { effect: { key: "final_damage_up", params: { value: 5 }, duration: { mode: "battle", value: 1 } } } },
      ],
    },
    formatBuffMessage: (effect) => `Buff:${effect.key}`,
  });

  assert(!good.progress.inventory.some((entry) => entry.itemId === "material"), "交換材料沒有扣除");
  assert(good.progress.inventory.some((entry) => entry.itemId === "reward_sword" && entry.enhanceLevel === 3), "交換獎勵沒有發放");
  assert(good.grants.length === 1 && good.grants[0].amount === -50, "交換金額沒有扣除");
  assert(good.progress.activeEffects.length === 1, "NPC Buff 沒有套用");
  assert(results.some((line) => line === "Buff:final_damage_up"), "NPC Buff 結果沒有回報");

  const invalid = createContext();
  await assert.rejects(
    () => processNpcOptionEffects({
      serviceContext: invalid.serviceContext,
      discordId: "p1",
      displayName: "Tester",
      option: { id: "bad", effects: [{ type: "future_effect", payload: {} }] },
    }),
    (error) => error instanceof NpcOptionEffectError,
    "未知效果應在寫入前被拒絕",
  );
  assert(invalid.grants.length === 0 && invalid.progress.inventory.length === 0, "未知效果不應產生部分寫入");

  const insufficient = createContext({ gold: 10 });
  await assert.rejects(
    () => processNpcOptionEffects({
      serviceContext: insufficient.serviceContext,
      discordId: "p1",
      displayName: "Tester",
      option: { id: "cost", effects: [{ type: "grant_currency", payload: { currencyType: "gold", amount: -50 } }] },
    }),
    (error) => error instanceof NpcOptionEffectError && error.userMessage === "金幣不足。",
    "餘額不足應在扣款前被拒絕",
  );
  assert(insufficient.grants.length === 0, "餘額不足不應扣款");

  console.log("✅ NPC 效果：交換扣料、扣款、發獎、Buff 與失敗前驗證皆通過");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
