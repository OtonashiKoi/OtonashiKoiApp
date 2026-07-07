"use strict";
/**
 * 經濟/節奏重調（V0.4）：
 *   1) 金幣通膨過高 → 全部「非 BOSS」怪 goldReward ×0.4（世界王/區域王保留，稀有獎勵時刻）。
 *   2) 火焰經驗異常（HP 已降為入門 A 但 exp 還停在終局 41636）→ hellfire 非 BOSS 怪 expReward ×0.5，
 *      拉齊龍族(~19300)。其餘區 exp 不動（節奏交給新經驗曲線 progression.js 處理）。
 * 保留原值到 _econBackup 供還原。可重跑（有 _econBackup 就不覆寫備份）。 dry-run 支援。
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const NOW = new Date().toISOString();

const GOLD_FACTOR = 0.2;      // 金幣 ×0.2 of 原始（目標一趟練完累積 ~5-6M）
const HELLFIRE_EXP_FACTOR = 0.5;

async function main() {
  const dry = process.argv.includes("--dry-run");
  const db = await getMongoDb();
  const ms = await db.collection("monsters").find({ enabled: true }).sort({ zone: 1, seq: 1 }).toArray();
  let goldN = 0, expN = 0;
  console.log(`經濟重調（dryRun=${dry}）：金幣×${GOLD_FACTOR}(非BOSS) / 火焰經驗×${HELLFIRE_EXP_FACTOR}(非BOSS)`);
  console.log("-".repeat(92));
  for (const m of ms) {
    const isBoss = Boolean(m.isBoss);
    const set = { updatedAt: NOW };
    const back = m._econBackup || { goldReward: m.goldReward, expReward: m.expReward };
    let changed = false, note = [];
    if (!isBoss) {
      // 一律以「原始備份值」為基準計算，冪等（重跑不會疊乘）
      const g = Math.max(1, Math.round((Number(back.goldReward) || 0) * GOLD_FACTOR));
      if (g !== m.goldReward) { set.goldReward = g; note.push(`金幣 ${m.goldReward}→${g}`); goldN++; changed = true; }
      if (m.zone === "hellfire") {
        const e = Math.max(1, Math.round((Number(back.expReward) || 0) * HELLFIRE_EXP_FACTOR));
        if (e !== m.expReward) { set.expReward = e; note.push(`經驗 ${m.expReward}→${e}`); expN++; changed = true; }
      }
    }
    if (changed) {
      if (!m._econBackup) set._econBackup = back;
      console.log(`  [${(m.zone || "?").padEnd(18)}] ${(m.name || "").padEnd(12)} ${note.join(" / ")}`);
      if (!dry) await db.collection("monsters").updateOne({ _id: m._id }, { $set: set });
    }
  }
  console.log("-".repeat(92));
  console.log(`${dry ? "[DRY-RUN] " : ""}完成：金幣調整 ${goldN} 隻、火焰經驗調整 ${expN} 隻。世界王/區域王未動。`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
