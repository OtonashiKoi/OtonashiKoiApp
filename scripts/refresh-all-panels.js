"use strict";
require("dotenv").config();
const { MongoClient } = require("mongodb");
const config = require("../src/config");

const ZONES = ["beginner", "normal", "mid", "hard", "elite"];

async function main() {
  const client = new MongoClient(config.storage.mongoUri);
  await client.connect();
  const db = client.db(config.storage.mongoDbName);
  
  const monstersCol = db.collection("monsters");
  const monsterStateCol = db.collection("monsterState");
  
  console.log("🔄 初始化並發布所有區域面板...\n");
  
  for (const zoneKey of ZONES) {
    try {
      // 嘗試從 monsters collection 讀取
      let state = await monstersCol.findOne({ _id: `monsterState:${zoneKey}` });
      if (state && state.value) {
        state = state.value;
      } else {
        // 降級到 monsterState collection
        const legacyState = await monsterStateCol.findOne({ _id: zoneKey });
        state = legacyState?.value || null;
      }
      
      if (!state) {
        console.log(`⚠️  ${zoneKey}: 無狀態紀錄，初始化空狀態...`);
        state = {
          zoneKey,
          currentHp: 0,
          activeMonsterSeq: null,
          participants: [],
          damageMap: {},
          killCount: {},
          killClaimedSeq: null,
          activeHealerAura: null,
          activeEvent: null
        };
      }
      
      // 更新 lastHitAt 時間戳，觸發面板重新渲染
      const now = new Date().toISOString();
      state.lastHitAt = now;
      state.updatedAt = now;
      
      // 寫入 monsters collection
      await monstersCol.updateOne(
        { _id: `monsterState:${zoneKey}` },
        { $set: { value: state, updatedAt: now } },
        { upsert: true }
      );
      
      // 也寫入 legacy collection 以保持兼容性
      await monsterStateCol.updateOne(
        { _id: zoneKey },
        { $set: { value: state, updatedAt: now } },
        { upsert: true }
      );
      
      console.log(`✅ ${zoneKey}: 已刷新（currentHp: ${state.currentHp || 0}）`);
    } catch (e) {
      console.error(`❌ ${zoneKey}: ${e.message}`);
    }
  }
  
  await client.close();
  console.log("\n✨ 所有區域已初始化並刷新完成！");
  console.log("💡 提示：現在需要重啟 PM2 使面板生效");
}

main().catch((error) => {
  console.error("[error] refresh failed:", error);
  process.exitCode = 1;
});
