"use strict";
/**
 * Lv.<10 怪物微調：
 *   1. flatDef 全部設 0（讓低 ATK 玩家有打得進去的感覺）
 *   2. 依名稱主題調整 HP（史萊姆/兔子偏低、石頭/哥布/狼偏高、BOSS 拉差距）
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

// 依名稱主題定 HP（key = name）
const TARGETS = {
  // beginner ─ 史/兔/菇系列（最弱）
  "小史(小)":   300,   // 最弱史萊姆
  "野兔":       400,   // 兔子稍多
  "蘑菇怪":     700,   // 菇類有點韌
  "小史(中)":   900,   // 中型史萊姆
  "大野兔(B)": 3000,   // beginner BOSS

  // normal ─ 史/狼/哥/精系列
  "小史":       500,   // normal 史萊姆
  "哥布":       700,   // 哥布林是戰鬥族，較肥
  "小狼":       600,   // 幼狼
  "石頭":      1200,   // 石頭/岩怪本來該肉（沒 flatDef 補償）
  "青草地精":   600,   // 草精脆
  "綠野狼":     900,   // 成年狼
  "小金(稀)":  1200,   // 稀有金屬史，肉
  "大史(B)":   3500,   // normal BOSS（壓軸）
};

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const db = await getMongoDb();
  // 用 level 過濾 < 10
  const ms = (await db.collection("monsters").find({ level: { $lt: 10 } }).toArray())
    .filter(m => !String(m._id || "").startsWith("monsterState:"));

  console.log(`掃描 ${ms.length} 隻 Lv.<10 怪物（dryRun=${dryRun}）`);
  console.log("─".repeat(100));
  console.log(["zone".padEnd(10), "name".padEnd(15), "Lv".padEnd(3), "HP舊→新".padEnd(16), "flatDef舊→新"].join("  "));
  console.log("─".repeat(100));

  let touched = 0, miss = 0;
  for (const m of ms) {
    const newHp = TARGETS[m.name];
    if (newHp == null) {
      console.log(`UNMATCHED  ${m.zone.padEnd(10)} ${m.name.padEnd(15)} Lv.${m.level}（不在表內）`);
      miss++;
      continue;
    }
    const oldHp = Number(m.maxHp) || 0;
    const oldFlat = m.flatDef ?? "auto";
    const updates = {};
    if (oldHp !== newHp) updates.maxHp = newHp;
    if (oldFlat !== 0) updates.flatDef = 0;

    if (!Object.keys(updates).length) {
      console.log(`UNCHANGED  ${m.zone.padEnd(10)} ${m.name.padEnd(15)} Lv.${m.level}  HP=${oldHp}  flatDef=${oldFlat}`);
      continue;
    }
    const hpCol = updates.maxHp != null ? `${oldHp}→${newHp}` : `${oldHp}`;
    const fdCol = `${oldFlat}→0`;
    console.log(`UPDATE     ${m.zone.padEnd(10)} ${m.name.padEnd(15)} Lv.${m.level}  ${hpCol.padEnd(14)}  ${fdCol}`);
    if (!dryRun) {
      await db.collection("monsters").updateOne({ _id: m._id }, { $set: updates });
    }
    touched++;
  }
  console.log("─".repeat(100));
  console.log(`完成：updated=${touched}, unmatched=${miss}${dryRun ? "（dry-run）" : ""}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
