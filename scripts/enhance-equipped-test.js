"use strict";
/**
 * 測試用：把玩家「身上(已裝備)」武器以外、可強化的裝備強化到 +TARGET。
 * 比照 enhanceService._applyEnhanceStats(防具/飾品=隨機加既有屬性,每階加 ARMOR_RANDOM_BONUS[階] 點)。
 * 用法：node scripts/enhance-equipped-test.js <discordId> [target=5]
 */
require("dotenv").config();

const ARMOR_RANDOM_BONUS = { D: 1, C: 1, B: 2, A: 3, S: 4 };
const PID = process.argv[2] || "865264891991425055";
const TARGET = Number(process.argv[3]) || 5;

(async () => {
  const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
  const db = await getMongoDb();
  const p = await db.collection("progress").findOne({ playerId: PID });
  if (!p) { console.error("找不到玩家", PID); process.exit(1); }
  const eq = p.equipment || {};

  const report = [];
  for (const slot of Object.keys(eq)) {
    if (slot === "weapon") { report.push(`[${slot}] 略過(武器)`); continue; }
    const it = eq[slot];
    if (!it) continue;
    const tier = String(it.tier || "").toUpperCase();
    const delta = ARMOR_RANDOM_BONUS[tier];
    const stats = it.equipStats || {};
    const candidates = Object.entries(stats).filter(([k, v]) => k && Number.isFinite(Number(v)) && Number(v) !== 0).map(([k]) => k);
    const cur = Number(it.enhanceLevel) || 0;
    if (!delta) { report.push(`[${slot}] ${it.itemName || it.name} 略過(階級 ${it.tier || "無"} 不可強化)`); continue; }
    if (!candidates.length) { report.push(`[${slot}] ${it.itemName || it.name} 略過(無可加成屬性)`); continue; }
    if (cur >= TARGET) { report.push(`[${slot}] ${it.itemName || it.name} 已 +${cur}`); continue; }

    const before = JSON.stringify(stats);
    for (let lvl = cur; lvl < TARGET; lvl++) {
      for (let i = 0; i < delta; i++) {
        const stat = candidates[Math.floor(Math.random() * candidates.length)];
        stats[stat] = (Number(stats[stat]) || 0) + 1;
      }
    }
    it.equipStats = stats;
    it.enhanceLevel = TARGET;
    report.push(`[${slot}] ${it.itemName || it.name}(${tier}) +${cur}→+${TARGET}  ${before} → ${JSON.stringify(stats)}`);
  }

  await db.collection("progress").updateOne({ playerId: PID }, { $set: { equipment: eq, updatedAt: new Date().toISOString() } });
  console.log(`玩家 ${PID} 裝備強化(武器除外 → +${TARGET}):`);
  for (const r of report) console.log("  " + r);
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
