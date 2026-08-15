#!/usr/bin/env node
"use strict";

const assert = require("assert");
const { CasinoService } = require("../src/services/casino/casinoService");
const { WeeklyQuestService } = require("../src/services/weeklyQuest/weeklyQuestService");
const { ANCHOR_ACQUISITION_HINTS } = require("../src/shared/anchorAcquisition");
const { ANCHOR_QUEST_RULES, SUPPORT_BADGE_IDS } = require("../src/shared/anchorQuestRules");

async function testDiceGrant() {
  const saved = [];
  const service = new CasinoService({
    casinoRepository: {}, walletRepository: {}, rewardService: {}, playerService: {},
    itemRepository: { findById: async (id) => ({ id, name: "骰・命運之輪", itemType: "equipment", equipSlot: "anchor", tier: "S" }) },
    progressRepository: {
      findByPlayerId: async () => ({ playerId: "p1", inventory: [] }),
      save: async (progress) => saved.push(progress),
    },
    uniqueGrantService: { claim: async () => true, release: async () => true },
    townChatAnnouncer: { resolveDiscordName: async () => "測試玩家", announceTownChat: async () => {} },
  });
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    const result = await service._tryGrantDiceJackpot("p1");
    assert.strictEqual(result?.itemName, "骰・命運之輪");
    assert.strictEqual(saved.length, 1);
    assert.strictEqual(saved[0].inventory[0].itemId, "s-legend-dice");
    assert.strictEqual(saved[0].inventory[0].source, "casino_jackpot");
  } finally {
    Math.random = originalRandom;
  }
}

function testQuestGates() {
  const service = new WeeklyQuestService({}, {});
  const rules = Object.fromEntries(ANCHOR_QUEST_RULES.map((rule) => [rule.rewardItemId, rule.fields]));
  const bond = service._normalizeDefinition({ enabled: true, ...rules["s-legend-bond"] });
  const missingBadgeContext = { level: 50, inventoryItemIds: new Set(SUPPORT_BADGE_IDS.slice(0, 3)), equippedItemIds: new Set() };
  const allBadgeContext = { level: 50, inventoryItemIds: new Set(SUPPORT_BADGE_IDS), equippedItemIds: new Set() };
  assert.strictEqual(service._isQuestVisibleForPlayer(bond, missingBadgeContext), false);
  assert.strictEqual(service._isQuestVisibleForPlayer(bond, allBadgeContext), true);
  assert.strictEqual(service._isQuestUnlocked(bond, 0, allBadgeContext), true, "集齊四徽章後須立即顯示，不能等 1500 場才顯示");

  const endure = service._normalizeDefinition({ enabled: true, ...rules["s-legend-endure"] });
  assert.strictEqual(service._isQuestUnlocked(endure, 49999, { level: 50 }), false);
  assert.strictEqual(service._isQuestUnlocked(endure, 50000, { level: 50 }), true);

  const timelord = service._normalizeDefinition({ enabled: true, ...rules["s-legend-timelord"] });
  assert.strictEqual(service._isQuestUnlocked(timelord, 3, { level: 50, checkinStreak: 2 }), false);
  assert.strictEqual(service._isQuestUnlocked(timelord, 3, { level: 50, checkinStreak: 3 }), true);

  const saint = service._normalizeDefinition({ enabled: true, ...rules["s-legend-saint"] });
  assert.strictEqual(Object.hasOwn(saint, "unlockRequireSeasonDonation"), false, "聖人試煉不得再包含抖內門檻");
  assert.strictEqual(service._isQuestUnlocked(saint, 0, { level: 1 }), true);
}

async function main() {
  assert.strictEqual(Object.keys(ANCHOR_ACQUISITION_HINTS).length, 9, "九件錨點都必須有取得方式");
  assert(Object.values(ANCHOR_ACQUISITION_HINTS).every((hint) => String(hint).trim().length > 0));
  testQuestGates();
  await testDiceGrant();
  console.log("✅ 錨點取得測試通過：九件線索、任務門檻、聖人無抖內限制、命運之輪發放");
}

main().catch((error) => { console.error(error); process.exit(1); });
