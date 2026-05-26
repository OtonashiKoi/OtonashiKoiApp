"use strict";
/**
 * 全怪物 exp/gold 降幅遷移
 * 預設 ×0.5（可用 --scale=0.4 之類覆寫）
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const arg = process.argv.find(a => a.startsWith("--scale="));
const SCALE = arg ? Number(arg.split("=")[1]) : 0.5;
const dryRun = process.argv.includes("--dry-run");

function round10(v) { return Math.max(1, Math.round(v / 10) * 10); }

async function main() {
  const db = await getMongoDb();
  const ms = (await db.collection("monsters").find({}).toArray())
    .filter(m => !String(m._id || "").startsWith("monsterState:"));

  console.log(`掃描 ${ms.length} 隻怪物，scale=×${SCALE} (dryRun=${dryRun})`);
  console.log("─".repeat(110));
  console.log(["zone".padEnd(20), "Lv".padEnd(3), "name".padEnd(15), "exp 舊→新".padEnd(18), "gold 舊→新".padEnd(20), "partG"].join("  "));
  console.log("─".repeat(110));

  let touched = 0;
  for (const m of ms) {
    const oldExp = Number(m.expReward) || 0;
    const oldGold = Number(m.goldReward) || 0;
    const oldPart = Number(m.participantGoldReward) || 0;
    const newExp = round10(oldExp * SCALE);
    const newGold = round10(oldGold * SCALE);
    const newPart = oldPart > 0 ? round10(oldPart * SCALE) : 0;

    if (newExp === oldExp && newGold === oldGold && newPart === oldPart) {
      console.log(`UNCHANGED ${(m.zone||'?').padEnd(20)} Lv.${String(m.level).padEnd(3)}${(m.name||'').padEnd(15)}  exp=${oldExp} gold=${oldGold}`);
      continue;
    }
    console.log(`UPDATE    ${(m.zone||'?').padEnd(20)} Lv.${String(m.level).padEnd(3)}${(m.name||'').padEnd(15)}  ${`${oldExp}→${newExp}`.padEnd(16)}  ${`${oldGold}→${newGold}`.padEnd(18)}  ${oldPart}→${newPart}`);
    if (!dryRun) {
      const updates = { expReward: newExp, goldReward: newGold };
      if (oldPart > 0) updates.participantGoldReward = newPart;
      await db.collection("monsters").updateOne({ _id: m._id }, { $set: updates });
    }
    touched++;
  }
  console.log("─".repeat(110));
  console.log(`完成：updated=${touched}${dryRun ? "（dry-run）" : ""}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
