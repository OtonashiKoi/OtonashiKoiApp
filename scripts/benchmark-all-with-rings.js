"use strict";
/**
 * 全玩家跑分：現有裝備 vs 現有裝備+換上同階特效戒指（獵手=暴擊流）
 * 分等級彙整，對照清整區場數
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const { calcPlayerStats } = require("../src/shared/combatStats");
const { runCombatLoop } = require("../src/shared/combatLoop");

const RUNS = 12, MAX_ROUNDS = 15;

function pickZoneForLevel(level) {
  if (level <= 3) return "beginner";
  if (level < 10) return "normal";
  if (level < 20) return "mid";
  if (level < 30) return "ancient_city";
  if (level < 40) return "ancient_city_deep";
  return "dragon_realm";
}
function buildMonsterCalc(m) {
  const lv = Math.max(1, m.level || 1), vit = m.vit || 0, intStat = m.int || 0;
  return {
    maxHp: m.maxHp || 800, atk: (m.str || 1) * 3,
    def: Math.min(75, Math.max(0, Number(m.def) || 0)),
    flatDef: (typeof m.flatDef === "number") ? Math.max(0, m.flatDef) : lv + vit,
    level: lv, agi: m.agi || 1, int: intStat, dex: m.dex || 1, luk: m.luk || 0,
    dodge: Math.min(50, (m.agi || 1) * 0.5), hit: Math.min(100, 80 + (m.dex || 1)),
    critRate: Math.min(100, Math.round((m.luk || 0) * 0.3)),
    comboChance: Math.min(80, Math.round(3 + (m.agi || 1) * 0.5)),
    defIgnorePct: m.defIgnorePct || 0, isBoss: !!m.isBoss,
    dmgMin: Math.min(1, 0.7 + intStat * 0.01), dmgMax: 1,
  };
}
// 玩家最佳裝備階 → 給的戒指階（戒指最低 C）
function ringTierFor(player) {
  const order = { D: 1, C: 2, B: 3, A: 4 };
  let best = 0;
  for (const s of ["weapon","armor","garment","shoes","head_top","head_mid","head_low","accessory_l","accessory_r"]) {
    const t = player.equipment?.[s]?.tier; if (t && order[t] > best) best = order[t];
  }
  return best >= 4 ? "A" : best >= 3 ? "B" : "C"; // D/C 裝 → C 戒
}
function clearZone(player, monsters, ringOverride) {
  const eq = { ...(player.equipment || {}), ...ringOverride };
  const ps = calcPlayerStats(player.attributes || {}, eq, [], player.inventory || [], { pkRating: null });
  let total = 0, deaths = 0, runs = 0;
  for (const m of monsters) {
    const mC = buildMonsterCalc(m); let dmgSum = 0, d = 0;
    for (let i = 0; i < RUNS; i++) {
      const r = runCombatLoop(ps, mC, m.name, mC.maxHp, MAX_ROUNDS, { playerLevel: player.level, equipped: eq, inventory: player.inventory || [], monsterIsBoss: !!m.isBoss });
      dmgSum += r.totalDamage || 0; if (r.outcome === "lose") d++;
    }
    const avg = dmgSum / RUNS;
    total += avg > 0 ? Math.min(Math.ceil(mC.maxHp / avg), 9999) : 9999;
    deaths += d; runs += RUNS;
  }
  return { total: total >= 9999 * monsters.length ? Infinity : total, deathRate: deaths / runs };
}

async function main() {
  const db = await getMongoDb();
  const progresses = await db.collection("progress").find({ level: { $gte: 2 } }).toArray();
  const monstersByZone = {};
  const allM = (await db.collection("monsters").find({}).toArray()).filter(m => !String(m._id||"").startsWith("monsterState:") && m.enabled !== false);
  for (const m of allM) (monstersByZone[m.zone] = monstersByZone[m.zone] || []).push(m);
  Object.values(monstersByZone).forEach(a => a.sort((x, y) => x.level - y.level));

  const rings = await db.collection("items").find({ name: { $in: ["獵手左之戒", "獵手右之戒"] } }).toArray();
  const ringByTier = (tier, slot) => {
    const name = slot === "accessory_l" ? "獵手左之戒" : "獵手右之戒";
    const it = rings.find(r => r.name === name && r.tier === tier);
    return it ? { uuid: "r-" + it.id, itemId: it.id, itemName: it.name, itemType: "equipment", tier: it.tier, equipSlot: it.equipSlot, equipStats: it.equipStats || {}, passiveEffects: it.passiveEffects || [], procEffects: it.procEffects || [], combatEffects: it.combatEffects || [] } : null;
  };

  // 依等級分組
  const byLv = new Map();
  for (const p of progresses) { if (!byLv.has(p.level)) byLv.set(p.level, []); byLv.get(p.level).push(p); }

  console.log("全玩家：現有裝備 vs 換上同階獵手戒（暴擊流）");
  console.log("═".repeat(90));
  console.log(["Lv", "Zone", "人數", "基準清整區", "戴戒清整區", "改善"].map((s,i)=>s.padEnd([4,18,5,12,12,8][i])).join(""));
  console.log("─".repeat(90));

  for (const lv of [...byLv.keys()].sort((a, b) => a - b)) {
    const zone = pickZoneForLevel(lv);
    const monsters = monstersByZone[zone] || [];
    if (!monsters.length) continue;
    const players = byLv.get(lv);
    let baseSum = 0, ringSum = 0, n = 0;
    for (const p of players) {
      const rt = ringTierFor(p);
      const ov = { accessory_l: ringByTier(rt, "accessory_l"), accessory_r: ringByTier(rt, "accessory_r") };
      if (!ov.accessory_l || !ov.accessory_r) continue;
      const base = clearZone(p, monsters, {});
      const ring = clearZone(p, monsters, ov);
      if (!isFinite(base.total) || !isFinite(ring.total)) continue;
      baseSum += base.total; ringSum += ring.total; n++;
    }
    if (!n) continue;
    const b = Math.round(baseSum / n), r = Math.round(ringSum / n);
    const imp = ((r - b) / b * 100).toFixed(0);
    console.log([`${lv}`, zone, `${n}`, `${b} 場`, `${r} 場`, `${imp}%`].map((s,i)=>s.padEnd([4,18,5,12,12,8][i])).join(""));
  }
  console.log("═".repeat(90));
  console.log("註：戒指為暴擊流（獵手左 crit_rate / 右 crit_damage）；D/C 裝玩家給 C 階戒、B→B、A→A");
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
