"use strict";

const assert = require("node:assert/strict");
const { JobBadgeService } = require("../src/services/job/jobBadgeService");
const { RewardService } = require("../src/services/reward/rewardService");
const { CURRENCY_SOURCES, isValidCurrencySource } = require("../src/shared/sources");

async function main() {
  assert.equal(CURRENCY_SOURCES.JOB_TRANSFER, "job_transfer");
  assert.equal(isValidCurrencySource(CURRENCY_SOURCES.JOB_TRANSFER), true);

  const discordId = "test-job-transfer-player";
  const progress = {
    playerId: discordId,
    displayName: "測試玩家",
    inventory: [],
    equipment: {
      job_eq: {
        uuid: "rogue-badge",
        itemId: "job_rogue_v1",
        itemName: "盜賊徽章",
        itemType: "job_badge",
        equipSlot: "job_eq",
        jobExp: 228,
      },
    },
  };
  let wallet = { playerId: discordId, gold: 252_721, diamond: 0 };
  const transactions = [];
  const progressRepository = {
    findByPlayerId: async () => progress,
    save: async (next) => Object.assign(progress, next),
  };
  const walletRepository = {
    findByPlayerId: async () => wallet,
    incBalance: async (_id, currency, amount) => {
      const field = currency === "diamond" ? "diamond" : "gold";
      if (wallet[field] + amount < 0) return null;
      wallet = { ...wallet, [field]: wallet[field] + amount };
      return wallet;
    },
  };
  const transactionRepository = {
    findBySourceAndRef: async (source, ref) => transactions.find((t) => t.source === source && t.sourceRef === ref) || null,
    append: async (transaction) => transactions.push(transaction),
  };
  const playerService = {
    ensurePlayer: async () => ({ player: { discordId }, wallet }),
  };
  const itemRepository = {
    findById: async (id) => id === "job_shadowdancer_t2_v1" ? {
      id, name: "影舞者徽章", itemType: "job_badge", equipSlot: "job_eq",
      effect: { type: "none", value: 0 }, equipStats: { agi: 7, dex: 3, luk: 2 },
    } : null,
  };
  const rewardService = new RewardService(playerService, walletRepository, transactionRepository);
  const service = new JobBadgeService(progressRepository, itemRepository, walletRepository, rewardService);

  const result = await service.transferJob(discordId, "job_shadowdancer_t2_v1", {
    idempotencyKey: "quest:shadowdancer-test",
  });
  assert.equal(result.transferred, true);
  assert.equal(result.cost, 250_000);
  assert.equal(wallet.gold, 2_721);
  assert.equal(progress.equipment.job_eq.itemId, "job_shadowdancer_t2_v1");
  assert.equal(progress.equipment.job_eq.jobExp, 0);
  assert.equal(transactions.length, 1);
  assert.equal(transactions[0].source, CURRENCY_SOURCES.JOB_TRANSFER);
  assert.equal(transactions[0].sourceRef, `${discordId}:quest:shadowdancer-test`);

  const duplicate = await service.transferJob(discordId, "job_shadowdancer_t2_v1", {
    idempotencyKey: "quest:shadowdancer-test",
  });
  assert.equal(duplicate.alreadyDone, true);
  assert.equal(wallet.gold, 2_721);
  assert.equal(transactions.length, 1);

  // 從背包遞交對應的一轉徽章時，當前裝備中的其他職業徽章必須退回背包。
  // 過去會直接用二轉徽章覆蓋 job_eq，造成原徽章永久消失。
  const backpackTransferId = "test-job-transfer-from-backpack";
  const backpackProgress = {
    playerId: backpackTransferId,
    displayName: "背包轉職測試玩家",
    inventory: [{
      uuid: "gambler-badge",
      itemId: "job_gambler_v1",
      itemName: "賭徒徽章",
      itemType: "job_badge",
      equipSlot: "job_eq",
      jobExp: 228,
    }],
    equipment: {
      job_eq: {
        uuid: "warrior-badge",
        itemId: "job_warrior_v1",
        itemName: "戰士徽章",
        itemType: "job_badge",
        equipSlot: "job_eq",
        jobExp: 17,
      },
    },
  };
  let backpackWallet = { playerId: backpackTransferId, gold: 250_000, diamond: 0 };
  const backpackProgressRepository = {
    findByPlayerId: async () => backpackProgress,
    save: async (next) => Object.assign(backpackProgress, next),
  };
  const backpackWalletRepository = {
    findByPlayerId: async () => backpackWallet,
    save: async (next) => { backpackWallet = next; return next; },
  };
  const backpackItemRepository = {
    findById: async (id) => id === "job_dicegod_t2_v1" ? {
      id, name: "賭神徽章", itemType: "job_badge", equipSlot: "job_eq",
      effect: { type: "none", value: 0 }, equipStats: { luk: 8, dex: 2, agi: 2 },
    } : null,
  };
  const backpackService = new JobBadgeService(
    backpackProgressRepository,
    backpackItemRepository,
    backpackWalletRepository,
  );

  const backpackResult = await backpackService.transferJob(backpackTransferId, "job_dicegod_t2_v1");
  assert.equal(backpackResult.transferred, true);
  assert.equal(backpackProgress.equipment.job_eq.itemId, "job_dicegod_t2_v1");
  assert.equal(backpackProgress.inventory.some((entry) => entry.itemId === "job_gambler_v1"), false);
  const preservedWarrior = backpackProgress.inventory.find((entry) => entry.itemId === "job_warrior_v1");
  assert.ok(preservedWarrior);
  assert.equal(preservedWarrior.uuid, "warrior-badge");
  assert.equal(preservedWarrior.jobExp, 17);
  console.log("✅ job transfer source and idempotency tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
