"use strict";
/**
 * 龍族 10 張卡跑分對照：每張卡 vs 無卡基準，在「能觸發其效果的情境」下比較
 * 輸出：DPR、受傷/場、陣亡率、效果證據
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const { calcPlayerStats } = require("../src/shared/combatStats");
const { runCombatLoop } = require("../src/shared/combatLoop");

const RUNS = 60;
const MAX_ROUNDS = 15;

function buildMonsterCalc(m) {
  const level = Math.max(1, m.level || 1);
  const vit = m.vit || 0;
  return {
    maxHp: m.maxHp || 800,
    atk: (m.str || 1) * 3,
    def: Math.min(75, Math.max(0, Number(m.def) || 0)),
    flatDef: (typeof m.flatDef === "number") ? Math.max(0, m.flatDef) : level + vit,
    level, agi: m.agi || 1, int: m.int || 0, dex: m.dex || 1, luk: m.luk || 0,
    dodge: Math.min(50, (m.agi || 1) * 0.5),
    hit: Math.min(100, 80 + (m.dex || 1)),
    critRate: Math.min(100, Math.round((m.luk || 0) * 0.3)),
    comboChance: Math.min(80, Math.round(3 + (m.agi || 1) * 0.5)),
    defIgnorePct: m.defIgnorePct || 0,
    isBoss: Boolean(m.isBoss),
    dmgMin: Math.min(1.0, 0.7 + (m.int || 0) * 0.01),
    dmgMax: 1.0,
  };
}

function runMany(player, monster, card, opts = {}) {
  const eq = { ...(player.equipment || {}), special_1: card, special_2: null, special_3: null };
  const ps = calcPlayerStats(player.attributes || {}, eq, [], player.inventory || [], { pkRating: null });
  const mCalc = buildMonsterCalc(monster);
  const startHp = Math.max(1, Math.round(ps.maxHp * ((opts.startHpPct ?? 100) / 100)));
  let dmg = 0, rounds = 0, taken = 0, deaths = 0, wins = 0;
  const kw = {};
  for (let i = 0; i < RUNS; i++) {
    const r = runCombatLoop(ps, mCalc, monster.name, mCalc.maxHp, MAX_ROUNDS, {
      playerLevel: player.level, equipped: eq, inventory: player.inventory || [],
      monsterIsBoss: !!monster.isBoss, startPlayerHp: startHp,
      startMonsterHp: opts.startMonsterHp,
      monsterActiveEffects: opts.monsterActiveEffects?.map(e => ({ ...e })),
    });
    if (r.outcome === "lose") deaths++;
    if (r.outcome === "win") wins++;
    dmg += r.totalDamage || 0; rounds += r.roundLogs?.length || 0;
    taken += Math.max(0, startHp - (r.finalPlayerHp ?? startHp));
    if (i < 8) for (const w of ["反彈","反擊","護盾","斬殺","回血","回復","連擊","暴擊","免疫","戰後"]) {
      if ((r.roundLogs || []).join("\n").includes(w)) kw[w] = (kw[w] || 0) + 1;
    }
  }
  return { ps, dpr: dmg / Math.max(1, rounds), taken: taken / RUNS, deaths, wins, kw };
}

async function fetchCard(db, name) {
  const c = await db.collection("items").findOne({ name, equipSlot: "special" });
  if (!c) return null;
  return { uuid: "t", itemId: c.id, itemName: c.name, itemType: c.itemType, equipSlot: c.equipSlot, tier: c.tier,
    equipStats: c.equipStats || {}, passiveEffects: c.passiveEffects || [], procEffects: c.procEffects || [],
    combatEffects: c.combatEffects || [], monsterCardSkill: c.monsterCardSkill || null };
}

async function main() {
  const db = await getMongoDb();
  const cands = await db.collection("progress").find({ level: 40 }).limit(100).toArray();
  let tp = null;
  for (const p of cands) {
    const c = ["weapon","armor","garment","shoes","head_top","head_mid","head_low","accessory_l","accessory_r","job_eq"].filter(s => p.equipment?.[s]).length;
    if (c >= 9) { tp = p; break; }
  }
  const boss = await db.collection("monsters").findOne({ name: "古龍王(B)" });
  const baseEq = { ...(tp.equipment || {}), special_1: null, special_2: null, special_3: null };
  const baseP = { ...tp, equipment: baseEq };
  const baseStats = calcPlayerStats(tp.attributes || {}, baseEq, [], tp.inventory || [], { pkRating: null });

  const baseFull = runMany(baseP, boss, null, { startHpPct: 100 });
  const baseLow = runMany(baseP, boss, null, { startHpPct: 25 });
  const baseExec = runMany(baseP, boss, null, { startHpPct: 100, startMonsterHp: Math.round(boss.maxHp * 0.1) });
  const baseBurn = runMany(baseP, boss, null, { startHpPct: 100, monsterActiveEffects: [{ key: "burn", params: { value: 1, mode: "flat", duration: { mode: "turns", value: 15 } }, appliedAt: 1 }] });

  console.log(`測試玩家 Lv.40（ATK=${baseStats.atk} HP=${baseStats.maxHp}）vs 古龍王(B) HP=${boss.maxHp}，每組 ${RUNS} 場`);
  console.log(`基準無卡：滿血 DPR=${baseFull.dpr.toFixed(0)} 受傷=${baseFull.taken.toFixed(0)} 陣亡=${baseFull.deaths}｜HP25% 陣亡=${baseLow.deaths} 受傷=${baseLow.taken.toFixed(0)}`);
  console.log("═".repeat(100));
  console.log(["卡片".padEnd(16), "情境", "DPR(對基準)", "受傷/場", "陣亡", "效果證據"].join("  "));
  console.log("─".repeat(100));

  const CARDS = [
    { n: "飛龍幼崽卡", scen: { startHpPct: 100 }, base: baseFull },
    { n: "龍蜥武士卡", scen: { startHpPct: 100 }, base: baseFull },
    { n: "火翼龍人卡", scen: { startHpPct: 100, monsterActiveEffects: [{ key: "burn", params: { value: 1, mode: "flat", duration: { mode: "turns", value: 15 } }, appliedAt: 1 }] }, base: baseBurn, label: "vs燃燒怪" },
    { n: "冰鱗龍人卡", scen: { startHpPct: 100 }, base: baseFull },
    { n: "雷霆飛龍卡", scen: { startHpPct: 100 }, base: baseFull },
    { n: "黑曜龍騎卡", scen: { startHpPct: 100 }, base: baseFull, label: "vsBOSS" },
    { n: "黃金幼龍(稀)卡", scen: { startHpPct: 50 }, base: baseFull },
    { n: "暗影龍將卡", scen: { startHpPct: 25 }, base: baseLow, label: "低血" },
    { n: "暗影龍將卡", scen: { startHpPct: 100, startMonsterHp: Math.round(boss.maxHp * 0.1) }, base: baseExec, label: "斬殺(怪10%HP)" },
    { n: "龍翼魔法師卡", scen: { startHpPct: 100 }, base: baseFull },
    { n: "古龍王(B)卡", scen: { startHpPct: 25 }, base: baseLow, label: "低血" },
  ];

  for (const c of CARDS) {
    const card = await fetchCard(db, c.n);
    if (!card) { console.log(`✗ ${c.n}`); continue; }
    const r = runMany(tp, boss, card, c.scen);
    const delta = ((r.dpr - c.base.dpr) / c.base.dpr * 100);
    const dprStr = `${r.dpr.toFixed(0)} (${delta >= 0 ? "+" : ""}${delta.toFixed(0)}%)`;
    const kwStr = Object.entries(r.kw).map(([k, v]) => `${k}${v}`).join(" ");
    let extra = "";
    if (c.label === "斬殺(怪10%HP)") extra = `勝率 ${(c.base.wins/RUNS*100).toFixed(0)}%→${(r.wins/RUNS*100).toFixed(0)}%`;
    console.log([
      c.n.padEnd(15), (c.label || "標準").padEnd(8),
      dprStr.padEnd(12), r.taken.toFixed(0).padStart(6), String(r.deaths).padStart(4),
      (kwStr + (extra ? "｜" + extra : "")).slice(0, 50),
    ].join("  "));
  }
  console.log("═".repeat(100));
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
