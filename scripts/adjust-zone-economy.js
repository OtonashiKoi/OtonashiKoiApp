"use strict";
require("dotenv").config();
const { MongoClient } = require("mongodb");
const config = require("../src/config");

async function main() {
  const client = new MongoClient(config.storage.mongoUri);
  await client.connect();
  const db = client.db(config.storage.mongoDbName);
  
  const monstersCol = db.collection("monsters");
  
  console.log("🔧 調整中高級區經濟數據\n");

  // 中級區調整：目標平均入場費200，平均奖励2200
  console.log("━━━━━ 中級區 (MID) ━━━━━");
  console.log("目標：入場費 200 → 奖励 2200 → 淨利 2000\n");
  
  const midMonsters = await monstersCol.find({ zone: "mid", enabled: true }).toArray();
  console.log(`找到 ${midMonsters.length} 隻怪物\n`);
  
  let midCount = 0;
  for (const monster of midMonsters) {
    const oldEntry = monster.entryFee || 0;
    const oldReward = monster.goldReward || 0;
    
    // 保持比例調整
    const newEntry = Math.round(200 / midMonsters.length);
    const newReward = Math.round(2200 / midMonsters.length);
    
    await monstersCol.updateOne(
      { _id: monster._id },
      { 
        $set: { 
          entryFee: newEntry,
          goldReward: newReward,
          updatedAt: new Date().toISOString()
        }
      }
    );
    
    console.log(`${monster.name}: 入場費 ${oldEntry}→${newEntry}, 獎勵 ${oldReward}→${newReward}`);
    midCount++;
  }

  console.log(`\n✅ 中級區已調整 ${midCount} 隻怪物\n`);

  // 高級區調整：目標平均入場費350，平均奖励2350
  console.log("━━━━━ 高級區 (HARD) ━━━━━");
  console.log("目標：入場費 350 → 奖励 2350 → 淨利 2000\n");
  
  const hardMonsters = await monstersCol.find({ zone: "hard", enabled: true }).toArray();
  console.log(`找到 ${hardMonsters.length} 隻怪物\n`);
  
  let hardCount = 0;
  for (const monster of hardMonsters) {
    const oldEntry = monster.entryFee || 0;
    const oldReward = monster.goldReward || 0;
    
    // 保持比例調整
    const newEntry = Math.round(350 / hardMonsters.length);
    const newReward = Math.round(2350 / hardMonsters.length);
    
    await monstersCol.updateOne(
      { _id: monster._id },
      { 
        $set: { 
          entryFee: newEntry,
          goldReward: newReward,
          updatedAt: new Date().toISOString()
        }
      }
    );
    
    console.log(`${monster.name}: 入場費 ${oldEntry}→${newEntry}, 獎勵 ${oldReward}→${newReward}`);
    hardCount++;
  }

  console.log(`\n✅ 高級區已調整 ${hardCount} 隻怪物\n`);

  // 驗證調整結果
  console.log("━━━━━ 驗證調整結果 ━━━━━\n");
  
  const midVerify = await monstersCol.find({ zone: "mid", enabled: true }).toArray();
  const midEntrySum = midVerify.reduce((sum, m) => sum + (m.entryFee || 0), 0);
  const midRewardSum = midVerify.reduce((sum, m) => sum + (m.goldReward || 0), 0);
  const midAvgEntry = Math.round(midEntrySum / midVerify.length);
  const midAvgReward = Math.round(midRewardSum / midVerify.length);
  const midNetProfit = midAvgReward - midAvgEntry;
  
  console.log(`中級區 - 平均入場費: ${midAvgEntry}, 平均獎勵: ${midAvgReward}, 淨利: ${midNetProfit}`);
  
  const hardVerify = await monstersCol.find({ zone: "hard", enabled: true }).toArray();
  const hardEntrySum = hardVerify.reduce((sum, m) => sum + (m.entryFee || 0), 0);
  const hardRewardSum = hardVerify.reduce((sum, m) => sum + (m.goldReward || 0), 0);
  const hardAvgEntry = Math.round(hardEntrySum / hardVerify.length);
  const hardAvgReward = Math.round(hardRewardSum / hardVerify.length);
  const hardNetProfit = hardAvgReward - hardAvgEntry;
  
  console.log(`高級區 - 平均入場費: ${hardAvgEntry}, 平均獎勵: ${hardAvgReward}, 淨利: ${hardNetProfit}`);
  
  console.log(`\n進場費差異: ${hardAvgEntry - midAvgEntry} (高級貴 ${hardAvgEntry - midAvgEntry})\n`);

  await client.close();
  console.log("✨ 調整完成！重啟 PM2 後生效");
}

main().catch((error) => {
  console.error("[error] adjustment failed:", error);
  process.exitCode = 1;
});
