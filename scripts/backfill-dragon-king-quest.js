"use strict";
/**
 * 回補：屠龍者の試煉(kill_dragon_king, season)——舊碼只記補刀者,把已知參與者補到 target。
 * 只動「目前已有進度」的玩家,把 current 補到 10(target),不改 claimed。
 */
require("dotenv").config();

const QID = "2178301c-818e-43be-9d3d-71b2d5bb26ce";
const TARGET = 10;

(async () => {
  const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
  const db = await getMongoDb();
  const col = db.collection("weeklyQuestProgress");
  const rows = await col.find({ cadence: "season" }).toArray();

  const report = [];
  for (const r of rows) {
    const p = r.progress && r.progress[QID];
    if (!p) continue; // 只補已有進度者
    const before = Number(p.current) || 0;
    if (before >= TARGET) { report.push(`${r.discordId}: 已 ${before}/${TARGET}(略過)`); continue; }
    await col.updateOne(
      { _id: r._id },
      { $set: { [`progress.${QID}.current`]: TARGET, updatedAt: new Date().toISOString() } }
    );
    report.push(`${r.discordId}: ${before} → ${TARGET}/${TARGET}${p.claimed ? "(已領)" : "(可領稱號)"}`);
  }

  console.log(`屠龍者の試煉 回補(target=${TARGET}):`);
  for (const line of report) console.log("  " + line);
  console.log(`  共處理 ${report.length} 位。`);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
