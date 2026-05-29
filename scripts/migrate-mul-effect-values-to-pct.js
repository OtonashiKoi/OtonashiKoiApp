"use strict";
/**
 * 統一 mul 模式效果的數值慣例為「百分比制」
 * 引擎已改為 × (1 + value/100)，所以舊的「倍率制」值（如 1.2/1.5/1.1）要轉成百分比：
 *   倍率 v（0.5 < v < 3）→ 百分比 (v-1)*100   例：1.5→50、1.2→20、1.1→10、1.35→35
 *   已是百分比的值（>= 3，如 5/13/20/30）→ 不動
 *
 * 範圍：所有 items 的 passiveEffects / procEffects / combatEffects / monsterCardSkill.procEffects
 * 只動這些 mul-key：crit_damage_up/down, atk_multiplier_up, def_multiplier_up,
 *                   max_hp_multiplier_up, combo_damage_up, final_damage_up/down
 *
 * 執行：node scripts/migrate-mul-effect-values-to-pct.js [--dry-run]
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const NOW = new Date().toISOString();
const MUL_KEYS = new Set([
  "crit_damage_up", "crit_damage_down",
  "atk_multiplier_up", "def_multiplier_up", "max_hp_multiplier_up",
  "combo_damage_up", "final_damage_up", "final_damage_down",
]);

// 倍率制 → 百分比制（只轉 0.5 < v < 3 的倍率值；>=3 視為已是百分比）
function toPct(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (n > 0.5 && n < 3) return Math.round((n - 1) * 100);
  return null; // 不需轉換
}

function fixEffectList(list, changes, ctxLabel) {
  if (!Array.isArray(list)) return list;
  return list.map((e) => {
    if (!e || !MUL_KEYS.has(e.key)) return e;
    const v = e.params?.value;
    const nv = toPct(v);
    if (nv === null) return e;
    changes.push(`${ctxLabel} ${e.key}: ${v}→${nv}`);
    return { ...e, params: { ...e.params, value: nv } };
  });
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const db = await getMongoDb();
  const items = await db.collection("items").find({}).toArray();

  let touched = 0;
  const allChanges = [];
  for (const it of items) {
    const changes = [];
    const passiveEffects = fixEffectList(it.passiveEffects, changes, it.name);
    const procEffects = fixEffectList(it.procEffects, changes, it.name);
    const combatEffects = fixEffectList(it.combatEffects, changes, it.name);
    let monsterCardSkill = it.monsterCardSkill;
    if (monsterCardSkill?.procEffects) {
      const skProc = fixEffectList(monsterCardSkill.procEffects, changes, it.name + "(skill)");
      monsterCardSkill = { ...monsterCardSkill, procEffects: skProc };
    }
    if (changes.length === 0) continue;
    allChanges.push(...changes);
    touched++;
    if (!dryRun) {
      await db.collection("items").updateOne(
        { _id: it._id },
        { $set: { passiveEffects, procEffects, combatEffects, monsterCardSkill, updatedAt: NOW } }
      );
    }
  }

  console.log(`掃描 ${items.length} 件道具，需轉換 ${touched} 件（dryRun=${dryRun}）`);
  console.log("─".repeat(80));
  allChanges.forEach((c) => console.log("  " + c));
  console.log("─".repeat(80));
  console.log(`完成：${touched} 件、${allChanges.length} 個效果值${dryRun ? "（dry-run，未寫入）" : "已轉換"}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
