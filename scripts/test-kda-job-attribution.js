#!/usr/bin/env node
"use strict";

require("dotenv").config();
const assert = require("assert");
const { getMongoDb, closeMongoClient } = require("../src/adapters/mongo/createMongoClient");
const { recordBattle } = require("../src/services/kda/kdaService");

const IDS = {
  self: "__kda_job_test_self__",
  sniper: "__kda_job_test_sniper__",
  sage: "__kda_job_test_sage__",
};

async function main() {
  const db = await getMongoDb();
  const collection = db.collection("kdaSeasonStats");
  const playerIds = Object.values(IDS);
  await collection.deleteMany({ playerId: { $in: playerIds } });
  try {
    await recordBattle({
      discordId: IDS.self,
      displayName: "KDA 測試出戰者",
      damage: 400,
      died: false,
      battleJobId: "job_spiritmaster_t2_v1",
      battleJobName: "聖靈師",
      damageBySource: {
        [IDS.sniper]: {
          amount: 100,
          jobId: "job_sniper_t2_v1",
          jobName: "神射手",
          displayName: "KDA 測試神射手",
        },
      },
      assistBySource: { [IDS.sage]: 50 },
      assistBySourceJob: {
        [IDS.sage]: {
          job_sage_t2_v1: { amount: 50, jobName: "兵聖" },
        },
      },
    });

    const rows = await collection.find({ playerId: { $in: playerIds } }).toArray();
    const byId = Object.fromEntries(rows.map((row) => [row.playerId, row]));
    assert.strictEqual(byId[IDS.self].k, 400, "出戰者只能得到扣除隊友直傷後的 K");
    assert.strictEqual(byId[IDS.self].wbBattles, 1, "出戰者應增加一場世界王場次");
    assert.strictEqual(byId[IDS.self].jobStats.job_spiritmaster_t2_v1.k, 400, "出戰 K 必須歸入當場職業");

    assert.strictEqual(byId[IDS.sniper].k, 100, "神射手掩護箭必須算給提供者的 K");
    assert.strictEqual(Number(byId[IDS.sniper].wbBattles) || 0, 0, "遠端掩護不可替神射手增加出戰場次");
    assert.strictEqual(byId[IDS.sniper].jobStats.job_sniper_t2_v1.k, 100, "掩護箭 K 必須歸入出箭職業");

    assert.strictEqual(byId[IDS.sage].a, 50, "兵聖外部能力必須算給提供者的 A");
    assert.strictEqual(byId[IDS.sage].jobStats.job_sage_t2_v1.a, 50, "助攻 A 必須歸入提供能力時的職業");
    console.log("✅ KDA 職業歸戶測試通過：出戰 K、神射手直傷 K、兵聖 A 與場次分離正確");
  } finally {
    await collection.deleteMany({ playerId: { $in: playerIds } });
    await closeMongoClient();
  }
}

main().catch(async (error) => {
  console.error(`❌ KDA 職業歸戶測試失敗：${error.stack || error.message}`);
  await closeMongoClient().catch(() => {});
  process.exitCode = 1;
});
