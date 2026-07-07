"use strict";
/**
 * 全區迴避基線平滑化（隨機出怪 → 不做尖刺、做「整區迴避帶」）。
 * 作法：每區設定「目標基線總迴避」；每隻怪保留自身 AGI 帶來的差異(±)，
 *       用 dodgeBonus 補到「基線 + (該怪AGI相對區內中位的偏移，壓縮後)」。
 *   - 天生高敏(弓/匕首流)仍略高，天生鈍(石頭/龜)仍略低，但全區落在一個窄帶內。
 *   - 先清掉先前的尖刺 dodgeBonus，統一重算。
 * 前期(新手/一般)維持近 0 迴避(必中手感)。
 * 可重複執行。 dry-run 支援。
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const NOW = new Date().toISOString();

// 區域 → 目標基線總迴避（非BOSS一般怪的中心值）
const ZONE_BASELINE = {
  beginner: 2, normal: 3,
  mid: 12, ancient_city: 18, ancient_city_deep: 15,
  dragon_realm: 22, hellfire: 30,
};
const SPREAD = 5;          // 區內允許的上下浮動(讓敏系仍略高、鈍系略低)
const DODGE_HARD_CAP = 45; // 一般怪總迴避上限(避免又變尖刺；BOSS不在此腳本)

function baseDodgeOf(agi) { return Math.min(50, (Number(agi) || 1) * 0.5); }

async function main() {
  const dry = process.argv.includes("--dry-run");
  const db = await getMongoDb();
  const rows = [];
  for (const [zone, baseline] of Object.entries(ZONE_BASELINE)) {
    const ms = await db.collection("monsters").find({ zone, enabled: true, isBoss: { $ne: true } })
      .project({ name: 1, agi: 1, seq: 1 }).sort({ seq: 1 }).toArray();
    if (!ms.length) continue;
    const agis = ms.map((m) => Number(m.agi) || 0).sort((a, b) => a - b);
    const midAgi = agis[Math.floor(agis.length / 2)] || 1;
    for (const m of ms) {
      const agi = Number(m.agi) || 0;
      // 相對區內中位的 AGI 偏移 → 壓縮到 ±SPREAD
      const rel = midAgi > 0 ? (agi - midAgi) / midAgi : 0;
      const offset = Math.max(-SPREAD, Math.min(SPREAD, Math.round(rel * SPREAD)));
      const target = Math.max(0, Math.min(DODGE_HARD_CAP, baseline + offset));
      const bonus = Math.max(0, Math.round(target - baseDodgeOf(agi)));
      const finalDodge = Math.min(75, baseDodgeOf(agi) + bonus);
      rows.push({ zone, name: m.name, agi, bonus, finalDodge });
      if (!dry) await db.collection("monsters").updateOne({ _id: m._id }, { $set: { dodgeBonus: bonus, updatedAt: NOW } });
    }
  }
  // 依區列印
  let curZone = "";
  for (const r of rows) {
    if (r.zone !== curZone) { curZone = r.zone; const zr = rows.filter((x) => x.zone === curZone); console.log(`\n[${curZone}] 平均迴避 ${Math.round(zr.reduce((a, b) => a + b.finalDodge, 0) / zr.length)}`); }
    console.log(`  ${(r.name || "").padEnd(12)} AGI${String(r.agi).padStart(3)} → 迴避${String(r.finalDodge).padStart(2)}${r.bonus ? `(+${r.bonus})` : ""}`);
  }
  console.log(`\n${dry ? "[DRY-RUN] " : ""}處理 ${rows.length} 隻。前期(新手/一般)維持近0；尖刺已由統一重算覆蓋。`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
