#!/usr/bin/env node
"use strict";

const assert = require("assert");
const { WeeklyQuestService } = require("../src/services/weeklyQuest/weeklyQuestService");

async function main() {
  const definitions = [
    { id: "onboarding-battle", cadence: "onboarding", type: "battle_count", target: 100, enabled: true },
    { id: "job-sword", cadence: "job", type: "battle_with_sword", target: 100, enabled: true },
    { id: "daily-damage", cadence: "daily", type: "damage_total", target: 1000, enabled: true },
    { id: "weekly-battle", cadence: "weekly", type: "battle_count", target: 100, enabled: true },
    { id: "season-combo", cadence: "season", type: "combo_count", target: 100, enabled: true },
  ];
  const savedByCadence = new Map();
  const calls = { list: 0, get: 0, save: 0, profile: 0, activityGate: 0, t2Eligibility: 0 };
  const repo = {
    async listQuests() {
      calls.list += 1;
      return definitions;
    },
    async getPlayerProgress(_discordId, _periodKey, cadence) {
      calls.get += 1;
      return structuredClone(savedByCadence.get(cadence) || {});
    },
    async savePlayerProgress(_discordId, _periodKey, progress, cadence) {
      calls.save += 1;
      savedByCadence.set(cadence, structuredClone(progress));
    },
  };
  const playerService = {
    async getProfile() {
      calls.profile += 1;
      return {
        progress: {
          level: 50,
          attributes: { str: 50, agi: 50, vit: 50, int: 50, dex: 50, luk: 50 },
          equipment: { weapon: { itemId: "test-sword", weaponType: "sword_1h" } },
          inventory: [],
        },
      };
    },
  };
  const service = new WeeklyQuestService(repo, playerService, {
    streamAccountBindingRepository: {
      async listByDiscordId() { calls.activityGate += 1; return []; },
    },
    checkinRepository: {
      async findLastByDiscordId() { calls.activityGate += 1; return null; },
      async listRecentByDiscordId() { calls.activityGate += 1; return []; },
    },
    jobBadgeService: {
      async checkTransferEligibility() { calls.t2Eligibility += 1; return null; },
    },
  });

  await service.recordProgressBatch("batch-player", [
    { type: "battle_count", amount: 1 },
    { type: "battle_count", amount: 2 },
    { type: "battle_with_sword", amount: 1 },
    { type: "damage_total", amount: 250 },
    { type: "combo_count", amount: 4 },
  ]);

  assert.strictEqual(calls.profile, 1, "同一批戰鬥指標只能讀一次玩家資料");
  assert.strictEqual(calls.list, 1, "同一批戰鬥指標只能讀一次任務定義");
  assert.strictEqual(calls.get, 5, "每個有符合任務的週期最多讀一次進度");
  assert.strictEqual(calls.save, 5, "每個有變更的週期最多寫一次進度");
  assert.strictEqual(calls.activityGate, 0, "戰鬥進度不可重查只供任務頁顯示的活動 gate");
  assert.strictEqual(calls.t2Eligibility, 0, "戰鬥進度不可逐徽章重算轉職資格");
  assert.strictEqual(savedByCadence.get("onboarding")["onboarding-battle"].current, 3);
  assert.strictEqual(savedByCadence.get("weekly")["weekly-battle"].current, 3);
  assert.strictEqual(savedByCadence.get("daily")["daily-damage"].current, 250);
  assert.strictEqual(savedByCadence.get("job")["job-sword"].current, 1);
  assert.strictEqual(savedByCadence.get("season")["season-combo"].current, 4);

  await service.recordProgress("batch-player", "battle_count", 2);
  assert.strictEqual(calls.profile, 2, "單一指標相容方法仍只讀一次玩家資料");
  assert.strictEqual(calls.list, 2, "單一指標相容方法仍只讀一次任務定義");
  assert.strictEqual(calls.get, 7, "第二次只有兩個符合週期，不可讀其餘週期");
  assert.strictEqual(calls.save, 7, "第二次只有兩個符合週期，不可寫其餘週期");
  assert.strictEqual(savedByCadence.get("onboarding")["onboarding-battle"].current, 5);
  assert.strictEqual(savedByCadence.get("weekly")["weekly-battle"].current, 5);

  console.log("✅ 任務進度批次測試通過：單場只讀一次，共用週期各寫一次");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
