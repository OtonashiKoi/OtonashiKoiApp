"use strict";
/**
 * 第二輪縮放：beginner / normal 再降，讓 Lv.<10 玩家更輕鬆
 *   beginner ×0.5（再砍一半）
 *   normal   ×0.4
 * 其他區不動。
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const SCALES = { beginner: 0.5, normal: 0.4 };

function roundTo(v, step) { return Math.max(step, Math.round(v / step) * step); }

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const db = await getMongoDb();
  const ms = (await db.collection("monsters").find({ zone: { $in: Object.keys(SCALES) } }).toArray())
    .filter(m => !String(m._id || "").startsWith("monsterState:"));

  console.log(`掃描 ${ms.length} 隻 beginner/normal 怪物（dryRun=${dryRun}）`);
  console.log("─".repeat(80));

  let touched = 0;
  for (const m of ms) {
    const scale = SCALES[m.zone];
    const step = m.isBoss ? 500 : 100;
    const oldHp = Number(m.maxHp) || 0;
    const newHp = roundTo(oldHp * scale, step);
    if (newHp === oldHp) {
      console.log(`UNCHANGED ${m.zone.padEnd(10)} ${m.name.padEnd(18)} Lv.${String(m.level).padEnd(3)} HP=${oldHp}`);
      continue;
    }
    console.log(`UPDATE    ${m.zone.padEnd(10)} ${m.name.padEnd(18)} Lv.${String(m.level).padEnd(3)} ${oldHp} → ${newHp}  (×${scale})`);
    if (!dryRun) {
      await db.collection("monsters").updateOne({ _id: m._id }, { $set: { maxHp: newHp } });
    }
    touched++;
  }
  console.log("─".repeat(80));
  console.log(`完成：updated=${touched}${dryRun ? "（dry-run）" : ""}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
