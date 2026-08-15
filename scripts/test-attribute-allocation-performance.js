#!/usr/bin/env node
"use strict";

const assert = require("assert");
const { MongoMemoryServer } = require("mongodb-memory-server");
const { ProgressService } = require("../src/services/progress/progressService");
const { calculateWebBattleCooldownMs } = require("../src/shared/battleTiming");

async function main() {
  let atomicCalls = 0;
  const service = new ProgressService(null, {
    async allocateAttributePoints(playerId, attribute, amount) {
      atomicCalls += 1;
      assert.strictEqual(playerId, "player-1");
      assert.strictEqual(attribute, "str");
      assert.strictEqual(amount, 1);
      return {
        ok: true,
        progress: {
          playerId,
          statusPoints: 4,
          attributes: { str: 12, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 },
          allocatedAttrs: { str: 1 },
        },
      };
    },
    async findByPlayerId() {
      throw new Error("原子快路徑不應讀取整份 progress");
    },
    async saveIfUnchanged() {
      throw new Error("原子快路徑不應回寫整份 progress");
    },
  });

  const allocated = await service.allocateAttribute({ discordId: "player-1", attribute: "str", amount: 1 });
  assert.strictEqual(atomicCalls, 1, "自主加點應只呼叫一次原子儲存方法");
  assert.strictEqual(allocated.statusPoints, 4);
  assert.strictEqual(allocated.attributes.str, 12);
  assert.strictEqual(allocated.allocatedAttrs.str, 1);

  const insufficientService = new ProgressService(null, {
    allocateAttributePoints: async () => ({ ok: false, reason: "insufficient", statusPoints: 0 }),
  });
  await assert.rejects(
    () => insufficientService.allocateAttribute({ discordId: "player-2", attribute: "agi", amount: 1 }),
    (error) => error?.code === "PRECONDITION_FAILED",
    "點數不足應維持既有 PRECONDITION_FAILED 回應",
  );

  assert.strictEqual(
    calculateWebBattleCooldownMs({ roundCount: 15, perRoundMs: 500 }),
    8000,
    "15 回合戰鬥應為 7.5 秒動畫加 0.5 秒交接，不可再固定多等 2 秒",
  );
  assert.strictEqual(
    calculateWebBattleCooldownMs({ roundCount: 15, perRoundMs: 500, lost: true }),
    38000,
    "15 回合死亡應先保留 8 秒戰鬥播放，再從死亡畫面起算完整 30 秒",
  );
  assert.strictEqual(
    calculateWebBattleCooldownMs({ roundCount: 1, perRoundMs: 1500, lost: true }),
    32000,
    "1 回合死亡應先保留 2 秒戰鬥播放，再從死亡畫面起算完整 30 秒",
  );

  // 以隔離的記憶體 Mongo 驗證正式 repository 的 update pipeline 與回傳投影。
  const mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri();
  process.env.MONGODB_DB_NAME = "attribute_allocation_test";
  const { getMongoDb, closeMongoClient } = require("../src/adapters/mongo/createMongoClient");
  const { createMongoRepositories } = require("../src/adapters/mongo/createMongoRepositories");
  try {
    const db = await getMongoDb();
    await db.collection("progress").insertOne({
      playerId: "mongo-player",
      seasonKey: "legacy",
      statusPoints: 3,
      attributes: { str: 5 },
      allocatedAttrs: {},
      inventory: Array.from({ length: 500 }, (_, index) => ({ uuid: `item-${index}`, itemId: "test-item" })),
    });
    const repo = createMongoRepositories().progressRepository;
    const result = await repo.allocateAttributePoints("mongo-player", "str", 2);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.progress.statusPoints, 1);
    assert.strictEqual(result.progress.attributes.str, 7);
    assert.strictEqual(result.progress.allocatedAttrs.str, 2);
    assert.strictEqual(result.progress.inventory, undefined, "原子加點回應不可載入大型背包");
    const stored = await db.collection("progress").findOne({ playerId: "mongo-player" });
    assert.strictEqual(stored.inventory.length, 500, "原子加點不可改寫背包");
  } finally {
    await closeMongoClient();
    await mongo.stop();
  }

  console.log("✅ 自主加點原子快路徑與戰鬥排隊交接時間測試通過");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
