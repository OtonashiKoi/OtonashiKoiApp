"use strict";
/**
 * 移除「到 52 樓」的爬塔紀錄（名人堂 + 玩家 towerRecord 樓層歸零），先備份。
 *   - towerHallOfFame: 刪除 floor >= 52 的條目
 *   - progress.towerRecord.bestFloor >= 52 的玩家：樓層相關欄位歸零（保留 totalRuns / recentRuns）
 * 備份寫到 backups/tower-52-records-backup-<ts>.json，可據此還原。
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");

(async () => {
  const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
  const db = await getMongoDb();
  const ts = new Date().toISOString().replace(/[:.]/g, "-");

  // 1) 蒐集要動的資料 + 備份
  const hof = await db.collection("towerHallOfFame").find({ floor: { $gte: 52 } }).toArray();
  const players = await db.collection("progress")
    .find({ "towerRecord.bestFloor": { $gte: 52 } })
    .project({ playerId: 1, towerRecord: 1 }).toArray();

  const backupDir = path.join(__dirname, "..", "backups");
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `tower-52-records-backup-${ts}.json`);
  fs.writeFileSync(backupPath, JSON.stringify({ hallOfFame: hof, players }, null, 2));
  console.log(`已備份 → ${backupPath}`);
  console.log(`名人堂條目: ${hof.length} 筆 | 受影響玩家: ${players.length} 人`);

  // 2) 刪除名人堂 52 樓條目
  const delRes = await db.collection("towerHallOfFame").deleteMany({ floor: { $gte: 52 } });
  console.log(`已刪除名人堂條目: ${delRes.deletedCount}`);

  // 3) 玩家 towerRecord 樓層歸零（保留 totalRuns / recentRuns / bestAt-lastAt 時間戳）
  const zero = {
    "towerRecord.bestFloor": 0,
    "towerRecord.bestProgressFloor": 0,
    "towerRecord.bestProgressDamage": 0,
    "towerRecord.bestProgressDamagePct": 0,
    "towerRecord.bestProgressRemainingHp": 0,
    "towerRecord.bestProgressMaxHp": 0,
    "towerRecord.bestProgressMonsterName": null,
    "towerRecord.bestParty": [],
    "towerRecord.lastFloor": 0,
    "towerRecord.lastProgressFloor": 0,
    "towerRecord.lastProgressDamage": 0,
    "towerRecord.lastProgressDamagePct": 0,
  };
  let updated = 0;
  for (const p of players) {
    const r = await db.collection("progress").updateOne(
      { playerId: p.playerId },
      { $set: { ...zero, updatedAt: new Date().toISOString() } }
    );
    if (r.modifiedCount) updated++;
    console.log(`  歸零 ${p.playerId}（原 best=${p.towerRecord?.bestFloor}）`);
  }
  console.log(`\n完成。已歸零 ${updated} 人;名人堂 52 樓紀錄已移除。`);

  // 驗證
  const left = await db.collection("progress").countDocuments({ "towerRecord.bestFloor": { $gte: 52 } });
  const hofLeft = await db.collection("towerHallOfFame").countDocuments({ floor: { $gte: 52 } });
  console.log(`驗證:殘留 best>=52 玩家=${left} | 名人堂 52 條目=${hofLeft}`);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
