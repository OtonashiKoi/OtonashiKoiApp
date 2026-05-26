"use strict";
/**
 * 重新配 expReward，目標 15 天（每日 5 小時）練到 Lv.40
 * 前期加大倍率讓 Lv.1-15 快速通過
 * 只動 expReward，不動 goldReward。
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const SCALES = {
  beginner:          5.0,
  normal:            5.0,
  mid:               4.0,
  ancient_city:      3.0,
  ancient_city_deep: 3.0,
};

function round5(v) { return Math.max(1, Math.round(v / 5) * 5); }

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const db = await getMongoDb();
  const ms = (await db.collection("monsters").find({}).toArray())
    .filter(m => !String(m._id || "").startsWith("monsterState:"));

  console.log(`掃描 ${ms.length} 隻怪物（dryRun=${dryRun}）`);
  console.log("─".repeat(95));
  console.log(["zone".padEnd(20),"Lv".padEnd(3),"name".padEnd(16),"exp 舊→新".padEnd(20),"倍率"].join("  "));
  console.log("─".repeat(95));

  let touched = 0;
  for (const m of ms) {
    const scale = SCALES[m.zone];
    if (!scale) {
      console.log(`SKIP zone=${m.zone} ${m.name} Lv.${m.level}`);
      continue;
    }
    const oldExp = Number(m.expReward) || 0;
    const newExp = round5(oldExp * scale);
    if (newExp === oldExp) {
      console.log(`UNCHANGED ${m.zone.padEnd(20)}Lv.${String(m.level).padEnd(3)} ${m.name.padEnd(16)} exp=${oldExp}`);
      continue;
    }
    console.log(`UPDATE    ${m.zone.padEnd(20)}Lv.${String(m.level).padEnd(3)} ${m.name.padEnd(16)} ${`${oldExp}→${newExp}`.padEnd(18)}  ×${scale}`);
    if (!dryRun) {
      await db.collection("monsters").updateOne({ _id: m._id }, { $set: { expReward: newExp } });
    }
    touched++;
  }
  console.log("─".repeat(95));
  console.log(`完成：updated=${touched}${dryRun ? "（dry-run）" : ""}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
