"use strict";
/**
 * goldReward 全怪物 ×2.4，目標滿等累計約 200 萬
 * participantGoldReward 同倍率
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const SCALE = 2.4;

function round10(v) { return Math.max(1, Math.round(v / 10) * 10); }

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const db = await getMongoDb();
  const ms = (await db.collection("monsters").find({}).toArray())
    .filter(m => !String(m._id || "").startsWith("monsterState:"));

  console.log(`掃描 ${ms.length} 隻怪物，scale=×${SCALE}（dryRun=${dryRun}）`);
  console.log("─".repeat(95));

  let touched = 0;
  for (const m of ms) {
    const oldGold = Number(m.goldReward) || 0;
    const oldPart = Number(m.participantGoldReward) || 0;
    const newGold = round10(oldGold * SCALE);
    const newPart = oldPart > 0 ? round10(oldPart * SCALE) : 0;
    if (newGold === oldGold && newPart === oldPart) {
      console.log(`UNCHANGED ${(m.zone||'?').padEnd(20)} Lv.${String(m.level).padEnd(3)}${(m.name||'').padEnd(15)} gold=${oldGold}`);
      continue;
    }
    console.log(`UPDATE    ${(m.zone||'?').padEnd(20)} Lv.${String(m.level).padEnd(3)}${(m.name||'').padEnd(15)} gold ${oldGold}→${newGold}  partG ${oldPart}→${newPart}`);
    if (!dryRun) {
      const upd = { goldReward: newGold };
      if (oldPart > 0) upd.participantGoldReward = newPart;
      await db.collection("monsters").updateOne({ _id: m._id }, { $set: upd });
    }
    touched++;
  }
  console.log("─".repeat(95));
  console.log(`完成：updated=${touched}${dryRun ? "（dry-run）" : ""}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
