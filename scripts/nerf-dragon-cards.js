"use strict";
/**
 * 修正太強的龍族卡片數值（雷霆飛龍）
 * 並順手把幾張看不出效果的卡升強一點（黑曜、暗影、古龍王）
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const NOW = new Date().toISOString();

const ADJUSTMENTS = {
  // 雷霆飛龍：combo_damage_up 22 → 12，crit_rate_up 10 → 6
  "雷霆飛龍卡": {
    passive: [
      { key: "combo_damage_up", value: 12 },
      { key: "crit_rate_up", value: 6 },
    ],
    description: "[A階 / 連擊系] 連擊時傷害 +12%，爆擊率 +6",
  },
  // 古龍王：拉高 stack 上限 + 加 final_damage_up 條件式給點存在感
  // 戰鬥內疊滿後 stack +15 STR/DEX 跟 +15 VIT/AGI 都各算 +15 屬性，加上物魔減傷 15%
  // 提高效果讓 BOSS 卡有 BOSS 感
  "古龍王(B)卡": {
    passive: [
      { key: "stack_on_hit_offense", value: 4, params: { cap: 20 } },
      { key: "stack_on_taken_defense", value: 4, params: { cap: 20 } },
      { key: "physical_damage_reduction", value: 18 },
      { key: "magic_damage_reduction", value: 18 },
      { key: "last_stand", value: 20, params: { thresholdPct: 30 } },
    ],
    description: "[A階 / 龍王系] 每次出手 +4 STR/DEX（上限 +20）、每次受擊 +4 VIT/AGI（上限 +20）；物理/魔法減傷 +18%；HP<30% 時傷害再 +20%",
  },
};

function pe(key, value, extras = {}) {
  return {
    key,
    target: "self",
    trigger: extras.trigger || "passive",
    chance: 100,
    sourcePhase: "passive",
    params: { value, ...(extras.params || {}) },
  };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const db = await getMongoDb();
  console.log(`調整 ${Object.keys(ADJUSTMENTS).length} 張卡（dryRun=${dryRun}）`);
  console.log("─".repeat(95));

  for (const [name, conf] of Object.entries(ADJUSTMENTS)) {
    const card = await db.collection("items").findOne({ name, equipSlot: "special" });
    if (!card) { console.warn(`⚠ 找不到 ${name}`); continue; }
    const passiveEffects = conf.passive.map((p) => pe(p.key, p.value, { params: p.params || {} }));
    console.log(`UPDATE  ${name.padEnd(16)} → ${conf.description}`);
    if (!dryRun) {
      await db.collection("items").updateOne(
        { _id: card._id },
        { $set: { passiveEffects, description: conf.description, updatedAt: NOW } }
      );
    }
  }
  console.log("─".repeat(95));
  console.log(dryRun ? "完成（dry-run）" : "完成");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
