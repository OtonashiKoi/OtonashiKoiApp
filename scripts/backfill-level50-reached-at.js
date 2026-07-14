#!/usr/bin/env node
"use strict";
// 滿等(50)玩家的「等級排行榜達成時間」回填：
//   來源＝該玩家最早一筆 `level:exp-overflow` 交易時間(剛滿等開始把溢出經驗轉金幣的時刻)。
//   只填「目前 levelReachedAt 為空」的滿等玩家，不覆蓋已有值。可重跑(idempotent)。
require("dotenv").config();
const { MongoClient } = require("mongodb");

const OVERFLOW_SOURCE = "level:exp-overflow";
const MAX_LEVEL = 50;
const APPLY = process.argv.includes("--apply"); // 沒帶 --apply＝只預覽不寫入

(async () => {
  const client = new MongoClient(process.env.MONGO_URL || "mongodb://127.0.0.1:27017");
  await client.connect();
  const db = client.db(process.env.MONGO_DB || "equipmentGame");
  const txCol = db.collection("transactions");
  const progressCol = db.collection("progress");
  const playersCol = db.collection("players");

  // 每位玩家最早一筆 exp-overflow 時間
  const earliest = await txCol.aggregate([
    { $match: { source: OVERFLOW_SOURCE } },
    { $group: { _id: "$playerId", firstAt: { $min: "$createdAt" } } }
  ]).toArray();

  let filled = 0, skippedHasValue = 0, skippedNotMax = 0;
  const report = [];
  for (const row of earliest) {
    const playerId = row._id;
    const firstAt = row.firstAt;
    const prog = await progressCol.findOne({ playerId });
    const player = await playersCol.findOne({ discordId: playerId });
    const name = player?.displayName || playerId;
    const level = prog?.level ?? null;
    if (level == null || level < MAX_LEVEL) { skippedNotMax++; report.push(`skip(非滿等 Lv${level}) ${name}`); continue; }
    if (prog?.levelReachedAt) { skippedHasValue++; report.push(`skip(已有值 ${prog.levelReachedAt}) ${name}`); continue; }
    report.push(`${APPLY ? "FILL" : "would-fill"} ${name} (${playerId}) Lv${level} → ${firstAt}`);
    if (APPLY) {
      await progressCol.updateOne(
        { playerId },
        { $set: { levelReachedAt: firstAt } }
      );
      filled++;
    }
  }

  report.sort();
  console.log(report.join("\n"));
  console.log(`\n[${APPLY ? "APPLIED" : "DRY-RUN"}] 滿等玩家 ${earliest.length} 位｜${APPLY ? "已回填" : "可回填"} ${APPLY ? filled : report.filter((r) => r.startsWith("would-fill")).length}｜已有值略過 ${skippedHasValue}｜非滿等略過 ${skippedNotMax}`);
  if (!APPLY) console.log("（預覽模式。確認無誤後加 --apply 實際寫入）");

  await client.close();
})().catch((e) => { console.error(e); process.exit(1); });
