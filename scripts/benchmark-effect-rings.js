"use strict";
/**
 * 對照：Lv.40 玩家在龍族之領，現狀飾品 vs 換上 A 階特效戒指 3 種組合
 * 看「清整區場數 / BOSS 場數」的改善
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const { calcPlayerStats } = require("../src/shared/combatStats");
const { runCombatLoop } = require("../src/shared/combatLoop");

const RUNS = 15, MAX_ROUNDS = 15;

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

function ringEntry(it) {
  return { uuid: "ring-" + it.id, itemId: it.id, itemName: it.name, itemType: "equipment",
    tier: it.tier, equipSlot: it.equipSlot, equipStats: it.equipStats || {},
    passiveEffects: it.passiveEffects || [], procEffects: it.procEffects || [], combatEffects: it.combatEffects || [] };
}

// 對整區算「清整區場數」
function clearZoneFights(player, monsters, equipOverride) {
  const eq = { ...(player.equipment || {}), ...equipOverride };
  const ps = calcPlayerStats(player.attributes || {}, eq, [], player.inventory || [], { pkRating: null });
  let total = 0, deaths = 0, runs = 0, bossFights = "-";
  for (const m of monsters) {
    const mC = buildMonsterCalc(m);
    let dmgSum = 0, d = 0;
    for (let i = 0; i < RUNS; i++) {
      const r = runCombatLoop(ps, mC, m.name, mC.maxHp, MAX_ROUNDS, { playerLevel: player.level, equipped: eq, inventory: player.inventory || [], monsterIsBoss: !!m.isBoss });
      dmgSum += r.totalDamage || 0; if (r.outcome === "lose") d++;
    }
    const avg = dmgSum / RUNS;
    const fights = avg > 0 ? Math.ceil(mC.maxHp / avg) : 9999;
    total += Math.min(fights, 9999); deaths += d; runs += RUNS;
    if (m.name === "古龍王(B)") bossFights = fights;
  }
  return { total, bossFights, deathRate: (deaths / runs * 100).toFixed(0) + "%", atk: ps.atk };
}

async function main() {
  const db = await getMongoDb();
  const monsters = (await db.collection("monsters").find({ zone: "dragon_realm" }).toArray()).sort((a, b) => a.level - b.level);
  const rings = await db.collection("items").find({ itemType: "equipment", tier: "A", equipSlot: { $in: ["accessory_l", "accessory_r"] } }).toArray();
  const byName = (n) => rings.find(r => r.name === n);
  const builds = {
    "暴擊流(獵手)": { accessory_l: ringEntry(byName("獵手左之戒")), accessory_r: ringEntry(byName("獵手右之戒")) },
    "連擊流(疾風)": { accessory_l: ringEntry(byName("疾風左之戒")), accessory_r: ringEntry(byName("疾風右之戒")) },
    "重擊流(重擊)": { accessory_l: ringEntry(byName("重擊左之戒")), accessory_r: ringEntry(byName("重擊右之戒")) },
  };

  // 取幾位代表 Lv.40 玩家（A 裝為主 / 混搭 / 純 B）
  const cands = await db.collection("progress").find({ level: 40 }).limit(100).toArray();
  const pick = [];
  for (const p of cands) {
    const slots = ["weapon","armor","garment","shoes","head_top","head_mid","head_low","accessory_l","accessory_r","job_eq"];
    const aCnt = slots.filter(s => p.equipment?.[s]?.tier === "A").length;
    const cnt = slots.filter(s => p.equipment?.[s]).length;
    if (cnt >= 9) {
      const tag = aCnt >= 5 ? "A裝為主" : aCnt >= 2 ? "A/B混搭" : "純B/低A";
      if (pick.filter(x => x.tag === tag).length < 1) pick.push({ p, tag, aCnt });
    }
    if (pick.length >= 3) break;
  }

  console.log(`龍族之領：現狀飾品 vs 換 A 階特效戒指（每怪 ${RUNS} 場）`);
  console.log("═".repeat(95));
  for (const { p, tag, aCnt } of pick) {
    console.log(`\n■ ${tag}（A裝${aCnt}件）`);
    const base = clearZoneFights(p, monsters, {});
    console.log(`  現狀飾品      ：清整區 ${base.total} 場｜BOSS ${base.bossFights} 場｜陣亡 ${base.deathRate}｜ATK ${base.atk}`);
    for (const [name, ov] of Object.entries(builds)) {
      const r = clearZoneFights(p, monsters, ov);
      const dz = ((r.total - base.total) / base.total * 100).toFixed(0);
      console.log(`  ${name.padEnd(12)}：清整區 ${r.total} 場（${dz}%）｜BOSS ${r.bossFights} 場｜陣亡 ${r.deathRate}｜ATK ${r.atk}`);
    }
  }
  console.log("═".repeat(95));
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
