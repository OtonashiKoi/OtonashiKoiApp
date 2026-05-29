"use strict";
/**
 * 全玩家跑分：現有裝備 vs 換上「最適合自己的特效戒指」（9 種全試，取最佳）
 * 顯示每等級的最佳改善 + 最熱門戒指系列
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const { calcPlayerStats } = require("../src/shared/combatStats");
const { runCombatLoop } = require("../src/shared/combatLoop");

const RUNS = 10, MAX_ROUNDS = 15;
const SERIES = ["疾風", "獵手", "狂血", "吸血", "鏡映", "救護", "重擊", "守護", "戰意"];

function pickZoneForLevel(lv) {
  if (lv <= 3) return "beginner";
  if (lv < 10) return "normal";
  if (lv < 20) return "mid";
  if (lv < 30) return "ancient_city";
  if (lv < 40) return "ancient_city_deep";
  return "dragon_realm";
}
function buildMonsterCalc(m) {
  const lv = Math.max(1, m.level || 1), vit = m.vit || 0, intStat = m.int || 0;
  return { maxHp: m.maxHp || 800, atk: (m.str || 1) * 3, def: Math.min(75, Math.max(0, Number(m.def) || 0)),
    flatDef: (typeof m.flatDef === "number") ? Math.max(0, m.flatDef) : lv + vit, level: lv, agi: m.agi || 1,
    int: intStat, dex: m.dex || 1, luk: m.luk || 0, dodge: Math.min(50, (m.agi || 1) * 0.5),
    hit: Math.min(100, 80 + (m.dex || 1)), critRate: Math.min(100, Math.round((m.luk || 0) * 0.3)),
    comboChance: Math.min(80, Math.round(3 + (m.agi || 1) * 0.5)), defIgnorePct: m.defIgnorePct || 0,
    isBoss: !!m.isBoss, dmgMin: Math.min(1, 0.7 + intStat * 0.01), dmgMax: 1 };
}
function ringTierFor(player) {
  const order = { D: 1, C: 2, B: 3, A: 4 }; let best = 0;
  for (const s of ["weapon","armor","garment","shoes","head_top","head_mid","head_low","accessory_l","accessory_r"]) {
    const t = player.equipment?.[s]?.tier; if (t && order[t] > best) best = order[t];
  }
  return best >= 4 ? "A" : best >= 3 ? "B" : "C";
}
function clearZone(player, monsters, ov) {
  const eq = { ...(player.equipment || {}), ...ov };
  const ps = calcPlayerStats(player.attributes || {}, eq, [], player.inventory || [], { pkRating: null });
  let total = 0;
  for (const m of monsters) {
    const mC = buildMonsterCalc(m); let dmgSum = 0;
    for (let i = 0; i < RUNS; i++) {
      const r = runCombatLoop(ps, mC, m.name, mC.maxHp, MAX_ROUNDS, { playerLevel: player.level, equipped: eq, inventory: player.inventory || [], monsterIsBoss: !!m.isBoss });
      dmgSum += r.totalDamage || 0;
    }
    const avg = dmgSum / RUNS;
    total += avg > 0 ? Math.min(Math.ceil(mC.maxHp / avg), 9999) : 9999;
  }
  return total >= 9999 * monsters.length ? Infinity : total;
}

async function main() {
  const db = await getMongoDb();
  const progresses = await db.collection("progress").find({ level: { $gte: 2 } }).toArray();
  const allM = (await db.collection("monsters").find({}).toArray()).filter(m => !String(m._id||"").startsWith("monsterState:") && m.enabled !== false);
  const monstersByZone = {};
  for (const m of allM) (monstersByZone[m.zone] = monstersByZone[m.zone] || []).push(m);
  Object.values(monstersByZone).forEach(a => a.sort((x, y) => x.level - y.level));

  const allRings = await db.collection("items").find({ equipSlot: { $in: ["accessory_l", "accessory_r"] }, passiveEffects: { $exists: true, $ne: [] } }).toArray();
  function ringPair(series, tier) {
    const mk = (slot) => {
      const want = series + (slot === "accessory_l" ? "左之戒" : "右之戒");
      const it = allRings.find(r => r.name === want && r.tier === tier) || allRings.find(r => r.name === want);
      return it ? { uuid: "r-" + it.id, itemId: it.id, itemName: it.name, itemType: "equipment", tier: it.tier, equipSlot: it.equipSlot, equipStats: it.equipStats || {}, passiveEffects: it.passiveEffects || [], procEffects: it.procEffects || [], combatEffects: it.combatEffects || [] } : null;
    };
    return { accessory_l: mk("accessory_l"), accessory_r: mk("accessory_r") };
  }

  const byLv = new Map();
  for (const p of progresses) { if (!byLv.has(p.level)) byLv.set(p.level, []); byLv.get(p.level).push(p); }

  console.log("全玩家：現有裝備 vs 換上「最適合的特效戒指」（9 種全試取最佳）");
  console.log("═".repeat(95));
  console.log(["Lv","Zone","人數","基準","最佳戒","改善","熱門戒指"].map((s,i)=>s.padEnd([4,18,5,8,8,7,20][i])).join(""));
  console.log("─".repeat(95));

  for (const lv of [...byLv.keys()].sort((a, b) => a - b)) {
    const zone = pickZoneForLevel(lv);
    const monsters = monstersByZone[zone] || [];
    if (!monsters.length) continue;
    let baseSum = 0, bestSum = 0, n = 0;
    const winCount = {};
    for (const p of byLv.get(lv)) {
      const rt = ringTierFor(p);
      const base = clearZone(p, monsters, {});
      if (!isFinite(base)) continue;
      let best = base, bestSeries = "無";
      for (const s of SERIES) {
        const ov = ringPair(s, rt);
        if (!ov.accessory_l || !ov.accessory_r) continue;
        const v = clearZone(p, monsters, ov);
        if (isFinite(v) && v < best) { best = v; bestSeries = s; }
      }
      baseSum += base; bestSum += best; n++;
      winCount[bestSeries] = (winCount[bestSeries] || 0) + 1;
    }
    if (!n) continue;
    const b = Math.round(baseSum / n), bs = Math.round(bestSum / n);
    const imp = ((bs - b) / b * 100).toFixed(0);
    const top = Object.entries(winCount).sort((a, c) => c[1] - a[1]).slice(0, 3).map(([k, v]) => `${k}${v}`).join(" ");
    console.log([`${lv}`, zone, `${n}`, `${b}`, `${bs}`, `${imp}%`, top].map((s,i)=>s.padEnd([4,18,5,8,8,7,20][i])).join(""));
  }
  console.log("═".repeat(95));
  console.log("註：改善為負=變快（場數變少）；熱門戒指=該等級最多人選到的最佳系列");
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
