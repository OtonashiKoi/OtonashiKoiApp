"use strict";
/**
 * A 階三區難度重調（三區 40 開放，難度 古城深處 < 龍族 = 火焰）。
 *   - ancient_city_deep(秘銀·最易A)：小升到 ~24k HP，relevel L40-45（接古城B ~11k）
 *   - hellfire(焚獄)：由終局(199k)大降到 = 龍族(~54k)，relevel L42-48
 *   - dragon_realm(龍鱗)：基準，不動
 * 作法：每隻怪的 HP/STR/DEF/agi/dex 依「該區目標均值 / 現況均值」等比縮放（保留區內相對差異）；等級線性重映。
 * 世界王/菁英(isBoss 或名稱含王)不縮 HP，只 relevel（避免破壞世界王/菁英強度）。
 * 保留原值到 _rebalABackup 供還原。 dry-run 支援。
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const NOW = new Date().toISOString();

// zone → { hp, str, def, agi, dex, lvLo, lvHi }（目標均值 + 目標等級帶）
const TARGET = {
  ancient_city_deep: { hp: 24000, str: 60, def: 76, lvLo: 40, lvHi: 45 },
  hellfire:          { hp: 54000, str: 143, def: 121, lvLo: 42, lvHi: 48 },
};

function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 1; }

async function main() {
  const dry = process.argv.includes("--dry-run");
  const db = await getMongoDb();
  for (const [zone, t] of Object.entries(TARGET)) {
    const all = await db.collection("monsters").find({ zone, enabled: true }).sort({ seq: 1 }).toArray();
    const normal = all.filter((m) => !m.isBoss);
    if (!normal.length) continue;
    const curHp = avg(normal.map((m) => Number(m.maxHp) || 0));
    const curStr = avg(normal.map((m) => Number(m.str) || 0));
    const curDef = avg(normal.map((m) => Number(m.def) || 0));
    const fHp = t.hp / curHp, fStr = t.str / curStr, fDef = t.def / (curDef || 1);
    const lvs = normal.map((m) => Number(m.level) || 0);
    const loL = Math.min(...lvs), hiL = Math.max(...lvs);
    const remapLv = (lv) => (hiL > loL) ? Math.round(t.lvLo + (lv - loL) / (hiL - loL) * (t.lvHi - t.lvLo)) : t.lvLo;

    console.log(`\n[${zone}] HP ${Math.round(curHp).toLocaleString()}→${t.hp.toLocaleString()}(×${fHp.toFixed(2)}) STR ${Math.round(curStr)}→${t.str}(×${fStr.toFixed(2)}) 等級 L${loL}-${hiL}→L${t.lvLo}-${t.lvHi}`);
    for (const m of all) {
      const isBossish = Boolean(m.isBoss); // 只跳過真正世界王/區域王(isBoss)；菁英照比例縮
      const set = { level: remapLv(Number(m.level) || t.lvLo), updatedAt: NOW };
      if (!m._rebalABackup) set._rebalABackup = { maxHp: m.maxHp, str: m.str, def: m.def, level: m.level, agi: m.agi, dex: m.dex };
      if (!isBossish) {
        set.maxHp = Math.max(1, Math.round((Number(m.maxHp) || 0) * fHp));
        set.str = Math.max(1, Math.round((Number(m.str) || 0) * fStr));
        set.def = Math.max(0, Math.round((Number(m.def) || 0) * fDef));
      }
      console.log(`  ${(m.name || "").padEnd(12)} L${m.level}→${set.level}${isBossish ? " (王:僅relevel)" : ` HP${(Number(m.maxHp) || 0).toLocaleString()}→${set.maxHp.toLocaleString()} STR${m.str}→${set.str}`}`);
      if (!dry) await db.collection("monsters").updateOne({ _id: m._id }, { $set: set });
    }
  }
  console.log(`\n${dry ? "[DRY-RUN] " : ""}完成。龍族不動(基準)。原值存 _rebalABackup。`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
