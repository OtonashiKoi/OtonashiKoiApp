"use strict";

const assert = require("node:assert/strict");
const { JobBadgeService } = require("../src/services/job/jobBadgeService");
const { RewardService } = require("../src/services/reward/rewardService");
const { CURRENCY_SOURCES, isValidCurrencySource } = require("../src/shared/sources");
const { assertSameOperation } = require("../src/adapters/mongo/currencySettlement");
const announcements = require("../src/shared/announceTownChat");
announcements.announceTownChat = async () => {};
announcements.resolveDiscordName = async () => "測試玩家";

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
    // Test double for the atomic repository contract; fault/concurrency behavior
    // is covered by the standalone and replica-set integration suites.
    async grantCurrencyAtomic(input) {
      const existing = transactions.find(t => t.source === input.source && t.sourceRef === input.sourceRef);
      if (existing) {
        assertSameOperation(existing, input);
        return { wallet, transaction: existing, duplicated: true };
      }
      const next = await walletRepository.incBalance(input.playerId, input.currencyType, input.amount);
      if (!next) throw new Error("Insufficient balance");
      const transaction = { ...input, balanceAfter: next[input.currencyType] };
      transactions.push(transaction);
      return { wallet: next, transaction, duplicated: false };
    },
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
  assert.equal(transactions[0].sourceRef, `${discordId}:season:legacy:quest:shadowdancer-test`);

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
  await testSeasonAndRecovery();
  console.log("✅ job transfer source and idempotency tests passed");
}

async function testSeasonAndRecovery() {
  const id = "returning-player", key = "quest:sage", target = "job_sage_t2_v1";
  const fresh = (season = "s20261001") => ({
    playerId: id, seasonKey: season, activeCharacterSlot: 1, inventory: [],
    equipment: { job_eq: {
      uuid: `badge-${season}`, itemId: "job_tactician_v1", itemName: "軍師徽章",
      itemType: "job_badge", equipSlot: "job_eq", jobExp: 228,
      obtainedAt: "2026-10-04T15:40:02.789Z",
    } },
  });
  function harness({ progress = fresh(), gold = 250000, logs = [], failSave = false } = {}) {
    let stored = structuredClone(progress), wallet = { playerId: id, gold }, saves = 0;
    const repo = {
      findByPlayerId: async () => structuredClone(stored),
      save: async next => {
        if (failSave && saves++ === 0) throw new Error("interrupted progress save");
        stored = structuredClone(next);
      },
    };
    const wr = { findByPlayerId: async () => structuredClone(wallet) };
    const tr = {
      findBySourceAndRef: async (source, ref) => logs.find(t => t.source === source && t.sourceRef === ref),
      grantCurrencyAtomic: async input => {
        const old = logs.find(t => t.source === input.source && t.sourceRef === input.sourceRef);
        if (old) { assertSameOperation(old, input); return { wallet, transaction: old, duplicated: true }; }
        assert.ok(wallet.gold >= -input.amount);
        wallet.gold += input.amount;
        const transaction = { ...input, createdAt: new Date().toISOString() };
        logs.push(transaction);
        return { wallet, transaction, duplicated: false };
      },
    };
    const reward = new RewardService({ ensurePlayer: async () => ({ player: { discordId: id } }) }, wr, tr);
    const service = new JobBadgeService(repo, { findById: async badgeId => ({
      id: badgeId, name: "兵聖徽章", itemType: "job_badge", equipSlot: "job_eq",
    }) }, wr, reward);
    return { service, logs, get progress() { return stored; }, get gold() { return wallet.gold; },
      reset: (next, nextGold) => { stored = structuredClone(next); wallet.gold = nextGold; } };
  }
  const previous = amount => ({ playerId: id, currencyType: "gold", amount,
    source: CURRENCY_SOURCES.JOB_TRANSFER, sourceRef: `${id}:${key}`, createdAt: "2026-08-10T08:27:55.360Z" });

  // 上季同一任務的費用不論不同或相同，都不能擋住本季或讓本季免費轉職。
  for (const oldAmount of [-1000000, -250000]) {
    const h = harness({ logs: [previous(oldAmount)] });
    const result = await h.service.transferJob(id, target, { idempotencyKey: key });
    assert.equal(result.cost, 250000); assert.equal(result.goldLeft, 0); assert.equal(h.gold, 0);
    assert.equal(h.logs.length, 2); assert.equal(h.progress.equipment.job_eq.itemId, target);
    assert.equal(h.logs[1].sourceRef, `${id}:season:s20261001:${key}`);
    const retry = await h.service.transferJob(id, target, { idempotencyKey: key });
    assert.equal(retry.alreadyDone, true); assert.equal(h.logs.length, 2);
    h.reset(fresh("s20270101"), 250000);
    await h.service.transferJob(id, target, { idempotencyKey: key });
    assert.equal(h.logs.length, 3); assert.equal(h.gold, 0);
  }

  // 扣款成功後保存中斷：一轉徽章仍在，餘額即使不足原費用也必須可恢復、只扣一次。
  const interrupted = harness({ failSave: true });
  await assert.rejects(interrupted.service.transferJob(id, target, { idempotencyKey: key }), /interrupted/);
  assert.equal(interrupted.gold, 0); assert.equal(interrupted.progress.equipment.job_eq.itemId, "job_tactician_v1");
  const recovered = await interrupted.service.transferJob(id, target, { idempotencyKey: key });
  assert.equal(recovered.transferred, true); assert.equal(recovered.goldLeft, 0);
  assert.equal(interrupted.logs.length, 1); assert.equal(interrupted.progress.equipment.job_eq.itemId, target);

  // 相容本季舊編號的未完成扣款，且用原已付費用恢復。
  const legacyPaid = previous(-250000); legacyPaid.createdAt = "2026-10-05T01:00:00Z";
  const legacy = harness({ gold: 0, logs: [legacyPaid] });
  await legacy.service.transferJob(id, target, { idempotencyKey: key });
  assert.equal(legacy.logs.length, 1); assert.equal(legacy.gold, 0);

  const concurrent = harness();
  const results = await Promise.all([1, 2].map(() => concurrent.service.transferJob(id, target, { idempotencyKey: key })));
  assert.equal(results.filter(r => r.transferred).length, 1);
  assert.equal(concurrent.logs.length, 1); assert.equal(concurrent.gold, 0);

  const poor = harness({ gold: 249999 });
  await assert.rejects(poor.service.transferJob(id, target, { idempotencyKey: key }), /金幣不足/);
  assert.equal(poor.gold, 249999); assert.equal(poor.logs.length, 0);
  assert.equal(poor.progress.equipment.job_eq.itemId, "job_tactician_v1");
  const untrained = fresh(); untrained.equipment.job_eq.jobExp = 227;
  const training = harness({ progress: untrained });
  await assert.rejects(training.service.transferJob(id, target, { idempotencyKey: key }), /熟練度不足/);
  assert.equal(training.gold, 250000); assert.equal(training.logs.length, 0);
  console.log("✅ cross-season fees, interrupted save recovery, legacy paid retry, concurrent retry and spending guards passed");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
