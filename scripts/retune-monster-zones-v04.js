// V0.4 怪物地圖強度重調（只動 6 主線區；大史王/古龍王世界王不碰，它們在 elite/dragon_king_lair 區）
// 做法：每區把 maxHp/str/def 乘上「區倍率」，命中平滑且略難的綜合戰力目標曲線。
// 綜合戰力 = HP×0.5 + STR×10 + DEF×5（與分析報告同公式）。
// 安全：先備份到 scripts/backups/，並在每隻怪打 _retuneV04 旗標防止重複套用。
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

// 區倍率（= 目標綜合戰力 / 現況綜合戰力）
const ZONE_MULT = {
  beginner: 1.0,          // 591 → 591（起點不動）
  normal: 2.33,           // 729 → ~1,700
  mid: 1.84,              // 2,117 → ~3,900
  ancient_city: 2.10,     // 4,103 → ~8,600
  ancient_city_deep: 1.44,// 13,223 → ~19,000
  dragon_realm: 3.00      // 13,352 → ~40,000（補斷層+抵附魔）
};
const ZONES = Object.keys(ZONE_MULT);
const power = (m) => (Number(m.maxHp) || 0) * 0.5 + (Number(m.str) || 0) * 10 + (Number(m.def) || 0) * 5;

(async () => {
  const db = await getMongoDb();
  const col = db.collection("monsters");

  // 現況（含未調整前綜合戰力）
  const before = {};
  const all = await col.find({ zone: { $in: ZONES }, enabled: true }).toArray();

  // 備份
  const backupDir = path.resolve(__dirname, "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFile = path.join(backupDir, `monster-retune-v04-${stamp}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(
    all.map((m) => ({ id: m.id, _id: m._id, name: m.name, zone: m.zone, maxHp: m.maxHp, str: m.str, def: m.def })), null, 1
  ));
  console.log(`📦 已備份 ${all.length} 隻怪 → ${backupFile}\n`);

  let updated = 0, skipped = 0;
  for (const z of ZONES) {
    const mult = ZONE_MULT[z];
    const arr = all.filter((m) => m.zone === z);
    before[z] = arr.reduce((s, m) => s + power(m), 0) / (arr.length || 1);
    if (mult === 1.0) { skipped += arr.length; continue; }
    for (const m of arr) {
      if (m._retuneV04) { skipped++; continue; } // 已套過，防重跑
      const nm = Math.max(1, Math.round((Number(m.maxHp) || 0) * mult));
      const ns = Math.max(0, Math.round((Number(m.str) || 0) * mult));
      const nd = Math.max(0, Math.round((Number(m.def) || 0) * mult));
      await col.updateOne({ _id: m._id }, { $set: { maxHp: nm, str: ns, def: nd, _retuneV04: true, updatedAt: new Date().toISOString() } });
      updated++;
    }
  }

  // 驗證：重讀算新綜合戰力 + 成長%
  const after = {};
  for (const z of ZONES) {
    const arr = await col.find({ zone: z, enabled: true }).toArray();
    after[z] = arr.reduce((s, m) => s + power(m), 0) / (arr.length || 1);
  }
  console.log(`✅ 更新 ${updated} 隻、略過 ${skipped} 隻\n`);
  console.log("區域              現況戰力   → 新戰力     vs前區成長%");
  let prev = null;
  for (const z of ZONES) {
    const g = prev == null ? "  —" : `+${Math.round((after[z] / prev - 1) * 100)}%`;
    console.log(`${z.padEnd(18)} ${String(Math.round(before[z])).padStart(8)} → ${String(Math.round(after[z])).padStart(8)}   ${g}`);
    prev = after[z];
  }
  process.exit(0);
})().catch((e) => { console.error("錯誤:", e); process.exit(1); });
