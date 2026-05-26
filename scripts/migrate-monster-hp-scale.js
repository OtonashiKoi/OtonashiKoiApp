"use strict";
/**
 * 一次性遷移：依區帶縮放怪物 maxHp
 * - 不動屬性、不動 level
 * - 縮放後四捨五入到最接近 100；BOSS 取整到 500
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const SCALES = {
  beginner:          0.5,
  normal:            0.10,
  mid:               0.15,
  ancient_city:      0.20,
  ancient_city_deep: 0.30,
};

function roundTo(v, step) { return Math.max(step, Math.round(v / step) * step); }

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const db = await getMongoDb();
  const ms = (await db.collection("monsters").find({}).toArray())
    .filter(m => !String(m._id || "").startsWith("monsterState:"));

  console.log(`掃描 ${ms.length} 隻怪物（dryRun=${dryRun}）`);
  console.log("─".repeat(95));
  console.log(["zone".padEnd(20), "name".padEnd(18), "Lv".padEnd(4), "舊HP".padEnd(8), "→ 新HP", "倍率"].join("  "));
  console.log("─".repeat(95));

  let touched = 0, skipped = 0;
  for (const m of ms) {
    const zone = m.zone;
    const scale = SCALES[zone];
    if (!scale) {
      console.log(`SKIP zone=${zone}  ${m.name}  Lv.${m.level}  HP=${m.maxHp}`);
      skipped++;
      continue;
    }
    const oldHp = Number(m.maxHp) || 0;
    if (!oldHp) {
      console.log(`SKIP no-hp  ${m.name}`);
      skipped++;
      continue;
    }
    const step = m.isBoss ? 500 : 100;
    const newHp = roundTo(oldHp * scale, step);
    if (newHp === oldHp) {
      console.log(`UNCHANGED ${zone.padEnd(20)} ${m.name.padEnd(18)} Lv.${String(m.level).padEnd(3)} ${String(oldHp).padEnd(8)} (×${scale})`);
      continue;
    }
    console.log(`UPDATE    ${zone.padEnd(20)} ${m.name.padEnd(18)} Lv.${String(m.level).padEnd(3)} ${String(oldHp).padEnd(8)} → ${newHp}  (×${scale})`);
    if (!dryRun) {
      await db.collection("monsters").updateOne({ _id: m._id }, { $set: { maxHp: newHp } });
    }
    touched++;
  }
  console.log("─".repeat(95));
  console.log(`完成：updated=${touched}, skipped=${skipped}${dryRun ? "（dry-run，未寫入）" : ""}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
