"use strict";
/**
 * 古城 → Lv.20-30、深處 → Lv.30-40
 * 重新分配兩區怪物等級（HP/屬性不動）
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const TARGETS = {
  // ancient_city Lv.20-30
  "廢墟蠍兵":   20,
  "毒霧蜘蛛":   21,
  "古城弓手":   22,
  "古城法師":   23,
  "古城刺客":   25,
  "石像鬼":     26,
  "詛咒祭司":   28,
  "城堡魔像(B)": 30,
  // ancient_city_deep Lv.30-40
  "黑焰巫師":     30,
  "城牆衛兵":     32,
  "古城狂戰士":   34,
  "鐵甲衛將":     36,
  "冰封騎士":     38,
  "古城將軍(B)":  39,
  "廢都魔王(B)":  40,
};

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const db = await getMongoDb();
  const ms = (await db.collection("monsters").find({ zone: { $in: ["ancient_city", "ancient_city_deep"] } }).toArray())
    .filter(m => !String(m._id || "").startsWith("monsterState:"));

  console.log(`掃描 ${ms.length} 隻古城/深處怪物（dryRun=${dryRun}）`);
  console.log("─".repeat(80));

  let touched = 0;
  for (const m of ms) {
    const target = TARGETS[m.name];
    if (target == null) {
      console.log(`UNMATCHED ${m.zone} ${m.name} Lv.${m.level}`);
      continue;
    }
    if (m.level === target) {
      console.log(`UNCHANGED ${m.zone.padEnd(20)} ${m.name.padEnd(15)} Lv.${m.level}`);
      continue;
    }
    console.log(`UPDATE    ${m.zone.padEnd(20)} ${m.name.padEnd(15)} Lv.${m.level} → Lv.${target}`);
    if (!dryRun) {
      await db.collection("monsters").updateOne({ _id: m._id }, { $set: { level: target } });
    }
    touched++;
  }
  console.log("─".repeat(80));
  console.log(`完成：updated=${touched}${dryRun ? "（dry-run）" : ""}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
