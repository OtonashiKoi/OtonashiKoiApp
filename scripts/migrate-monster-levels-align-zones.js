"use strict";
/**
 * 一次性遷移：把所有怪物的等級重新對齊到各區進入門檻
 * - 不改 HP/屬性
 * - 只動 monsters.level
 *
 * 區帶：
 *   beginner          → Lv.1-3
 *   normal            → Lv.4-9
 *   mid               → Lv.10-19
 *   ancient_city      → Lv.20-24
 *   ancient_city_deep → Lv.25-35
 *   elite             → 維持原樣
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const TARGETS = {
  beginner: {
    "小史(小)":      1,
    "野兔":          1,
    "蘑菇怪":        2,
    "小史(中)":      3,
    "大野兔(B)":     3,
  },
  normal: {
    "小史":          4,
    "哥布":          5,
    "小狼":          5,
    "石頭":          6,
    "青草地精":      6,
    "綠野狼":        7,
    "小金(稀)":      8,
    "大史(B)":       9,
  },
  mid: {
    "暗夜獵豹":      10,
    "林地妖靈(樹樹)": 11,
    "森林古樹":      12,
    "森林盜賊":      12,
    "牙牙狼":        13,
    "森林巫師":      13,
    "甲蟹":          14,
    "森林之獸":      15,
    "巨巨":          16,
    "黑暗弓手":      16,
    "中金(稀)":      18,
    "米拉桑(B)":     19,
  },
  ancient_city: {
    "廢墟蠍兵":      20,
    "毒霧蜘蛛":      20,
    "古城弓手":      21,
    "古城法師":      21,
    "古城刺客":      22,
    "石像鬼":        22,
    "詛咒祭司":      23,
    "城堡魔像(B)":   24,
  },
  ancient_city_deep: {
    "黑焰巫師":      25,
    "城牆衛兵":      27,
    "古城狂戰士":    29,
    "鐵甲衛將":      30,
    "冰封騎士":      31,
    "古城將軍(B)":   33,
    "廢都魔王(B)":   35,
  },
};

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const db = await getMongoDb();
  const ms = (await db.collection("monsters").find({}).toArray())
    .filter(m => !String(m._id || "").startsWith("monsterState:"));

  console.log(`掃描 ${ms.length} 隻怪物（dryRun=${dryRun}）`);
  console.log("─".repeat(80));

  let touched = 0, unmatched = 0;
  for (const m of ms) {
    const zone = m.zone;
    if (!TARGETS[zone]) {
      console.log(`SKIP(${zone}) ${m.name} Lv.${m.level}`);
      continue;
    }
    const targetLv = TARGETS[zone][m.name];
    if (targetLv == null) {
      console.log(`UNMATCHED ${zone}/${m.name} Lv.${m.level}（不在表內，跳過）`);
      unmatched++;
      continue;
    }
    if (m.level === targetLv) {
      console.log(`UNCHANGED ${zone.padEnd(20)} ${m.name.padEnd(16)} Lv.${m.level}`);
      continue;
    }
    console.log(`UPDATE    ${zone.padEnd(20)} ${m.name.padEnd(16)} Lv.${m.level} → Lv.${targetLv}`);
    if (!dryRun) {
      await db.collection("monsters").updateOne({ _id: m._id }, { $set: { level: targetLv } });
    }
    touched++;
  }
  console.log("─".repeat(80));
  console.log(`完成：updated=${touched}, unmatched=${unmatched}${dryRun ? "（dry-run，未寫入）" : ""}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
