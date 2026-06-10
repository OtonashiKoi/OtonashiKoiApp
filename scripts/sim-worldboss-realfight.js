"use strict";
/**
 * 世界王「真實對戰」跑分：王會全力反擊(王者雷擊/逆鱗焚天),玩家用真實血量會死。
 * Part A：真實玩家(Lv40+,實際裝備)對兩王能撐幾回合、死亡率、單場傷害。
 * Part B：S 武器 × 職業 × 物理/DOT 跑分(同一套 +5A 防具→真實血),含王反擊。
 * 指標：血量 / 死亡率 / 平均存活回合 / 單場傷害 / 單人擊殺場數。基礎王(不含階段/部位修正)。
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const { calcPlayerStats } = require("../src/shared/combatStats");
const { runCombatLoop } = require("../src/shared/combatLoop");
const { createServiceContext } = require("../src/services/createServiceContext");

const MAX_ROUNDS = 15;   // 一場上限
const PLV = 60;
const BASE = 60, EXTRA = 120;

const WEAPONS = [
  { wid: "s-dragon-sword_1h", label: "幼龍牙劍·單手劍", job: "job_swordsman_v1", jobName: "劍士", main: "str" },
  { wid: "s-dragon-sword_2h", label: "龍脊巨劍·雙手劍", job: "job_swordsman_v1", jobName: "劍士", main: "str" },
  { wid: "s-dragon-axe_1h", label: "裂龍手斧·單手斧", job: "job_warrior_v1", jobName: "戰士", main: "str" },
  { wid: "s-dragon-axe_2h", label: "屠龍巨斧·雙手斧", job: "job_warrior_v1", jobName: "戰士", main: "str" },
  { wid: "s-dragon-mace_1h", label: "龍顎戰錘·單手槌", job: "job_dwarf_warrior_v1", jobName: "矮人戰士", main: "str" },
  { wid: "s-dragon-mace_2h", label: "龍骨碎天槌·雙手槌", job: "job_dwarf_warrior_v1", jobName: "矮人戰士", main: "str" },
  { wid: "s-dragon-dagger", label: "龍鱗短刃·匕首", job: "job_rogue_v1", jobName: "盜賊", main: "str" },
  { wid: "s-dragon-staff_1h", label: "龍語法杖·單手杖", job: "job_mage_v1", jobName: "法師", main: "int" },
  { wid: "s-dragon-staff_2h", label: "龍脈長杖·雙手杖", job: "job_mage_v1", jobName: "法師", main: "int" },
  { wid: "s-dragon-bow", label: "龍筋獵弓·弓", job: "job_archer_v1", jobName: "弓箭手", main: "dex" },
];
const DOT_CARD_IDS = [
  "monster-card-35ec8cc7-9f0c-4d61-8a40-343d8857be2f",
  "fang-wolf-card",
  "monster-card-9a0ac6a5-4f2e-4186-a66a-73a6de9cb5e2",
];
const ARMOR_SLOTS = ["head_top", "head_mid", "head_low", "armor", "shield", "garment", "shoes", "accessory_l", "accessory_r"];

function buildAttrs(main) {
  const a = { str: BASE, agi: BASE, vit: BASE, int: BASE, dex: BASE, luk: BASE };
  a[main] += EXTRA;
  return a;
}

// 跑 RUNS 場真實對戰,回傳 {hp,deathRate,avgDeathRound,perBattle,battles}
function simFight(ps, equipped, boss, runs) {
  const hp = ps.maxHp;
  let dmgSum = 0, deaths = 0, deathRoundSum = 0;
  for (let i = 0; i < runs; i++) {
    const r = runCombatLoop(ps, boss.calc, boss.name, boss.hp, MAX_ROUNDS, {
      playerName: "BENCH", playerLevel: PLV, equipped, inventory: [],
      partyEffects: [], monsterEquipped: boss.equip, monsterIsBoss: true,
      worldBossPhase: null, bestiaryBonusPct: 0, zone: boss.zone, isWorldBoss: true,
    });
    dmgSum += r.totalDamage || 0;
    const rounds = Array.isArray(r.roundLogs) ? r.roundLogs.length : MAX_ROUNDS;
    if (r.outcome === "lose") { deaths++; deathRoundSum += rounds; }
  }
  const perBattle = dmgSum / runs;
  return {
    hp,
    deathRate: deaths / runs,
    avgDeathRound: deaths ? deathRoundSum / deaths : null,
    perBattle,
    battles: perBattle > 0 ? Math.ceil(boss.hp / perBattle) : Infinity,
  };
}

async function main() {
  const db = await getMongoDb();
  const sc = createServiceContext();
  const elite = await sc.monsterService.listMonsters({ includeDisabled: false, zone: "elite" });
  const lair = await sc.monsterService.listMonsters({ includeDisabled: false, zone: "dragon_king_lair" });
  const daishi = elite.find(m => m.id === "elite-daishi-king");
  const dragon = lair.find(m => m.id === "dragon-king-boss");
  const bosses = [
    { name: "大史王", zone: "elite", calc: daishi.calc, hp: daishi.calc.maxHp, lv: daishi.level, equip: daishi.equipment || {} },
    { name: "古龍王", zone: "dragon_king_lair", calc: dragon.calc, hp: dragon.calc.maxHp, lv: dragon.level, equip: dragon.equipment || {} },
  ];

  // ─────────────────────────  Part A：真實玩家生存  ─────────────────────────
  console.log("█".repeat(90));
  console.log("Part A — 真實玩家(Lv40+ 實際裝備)對世界王生存(王全力反擊,一場 15 回合)");
  console.log("█".repeat(90));
  const progs = await db.collection("progress").find({ level: { $gte: 40 } }).toArray();
  const players = progs.map(p => {
    const ps = calcPlayerStats(p.attributes || {}, p.equipment || {}, [], p.inventory || [], {});
    return { pid: p.playerId, lv: p.level, ps, equipped: p.equipment || {} };
  }).sort((a, b) => a.ps.maxHp - b.ps.maxHp);

  for (const boss of bosses) {
    const rows = players.map(pl => ({ pl, r: simFight(pl.ps, pl.equipped, boss, 16) }));
    const dieRates = rows.map(x => x.r.deathRate);
    const survRounds = rows.map(x => x.r.avgDeathRound).filter(v => v != null);
    const perBs = rows.map(x => x.r.perBattle).sort((a, b) => a - b);
    const avg = a => a.reduce((s, v) => s + v, 0) / (a.length || 1);
    const dieAll = rows.filter(x => x.r.deathRate >= 0.95).length;
    console.log(`\n【${boss.name}】Lv${boss.lv} HP${boss.hp.toLocaleString()} def${boss.calc.def}%`);
    console.log(`  全體 ${rows.length} 人：平均死亡率 ${Math.round(avg(dieRates) * 100)}%｜幾乎必死(>=95%) ${dieAll} 人｜死亡者平均撐 ${avg(survRounds).toFixed(1)} 回合｜單場傷害中位 ${Math.round(perBs[Math.floor(perBs.length / 2)]).toLocaleString()}`);
    // 低/中/高血代表
    const reps = [players[0], players[Math.floor(players.length / 2)], players[players.length - 1]];
    for (const pl of reps) {
      const r = simFight(pl.ps, pl.equipped, boss, 16);
      console.log(`    HP${String(r.hp).padStart(4)}(Lv${pl.lv})：死亡率 ${Math.round(r.deathRate * 100)}%｜${r.avgDeathRound ? "平均第 " + r.avgDeathRound.toFixed(1) + " 回合死" : "可存活整場"}｜單場傷害 ${Math.round(r.perBattle).toLocaleString()}`);
    }
  }

  // ─────────────────────────  Part B：S 武器跑分(含王反擊)  ─────────────────────────
  const ids = [...new Set([...WEAPONS.map(w => w.wid), ...WEAPONS.map(w => w.job), ...DOT_CARD_IDS])];
  const items = await db.collection("items").find({ id: { $in: ids } }).toArray();
  const byId = new Map(items.map(it => [it.id, it]));
  const dotCards = DOT_CARD_IDS.map(id => byId.get(id));
  // 統一防具：用測試帳 865264891991425055 的 +5A 防具(各 build 相同→只比武器/職業)
  const tp = await db.collection("progress").findOne({ playerId: "865264891991425055" });
  const baseArmor = {};
  for (const s of ARMOR_SLOTS) if (tp?.equipment?.[s]) baseArmor[s] = tp.equipment[s];

  console.log("\n" + "█".repeat(90));
  console.log("Part B — S 武器 × 職業 × 物理/DOT 跑分(同一套 +5A 防具,含王全力反擊)");
  console.log("█".repeat(90));

  function build(w, dot, boss) {
    const equipped = { ...baseArmor, weapon: byId.get(w.wid), job_eq: byId.get(w.job) };
    if (dot) { equipped.special_1 = dotCards[0]; equipped.special_2 = dotCards[1]; equipped.special_3 = dotCards[2]; }
    const ps = calcPlayerStats(buildAttrs(w.main), equipped, [], [], { zone: boss.zone });
    return simFight(ps, equipped, boss, 40);
  }

  for (const boss of bosses) {
    console.log(`\n【${boss.name}】Lv${boss.lv} HP${boss.hp.toLocaleString()} def${boss.calc.def}%`);
    console.log("─".repeat(90));
    console.log("職業/武器".padEnd(20) + "血量".padStart(6) + "│物理:死亡率 存活 單場 場數".padStart(30) + " │DOT:死亡率 存活 單場 場數".padStart(28));
    console.log("─".repeat(90));
    const rows = WEAPONS.map(w => ({ w, p: build(w, false, boss), d: build(w, true, boss) }));
    rows.sort((a, b) => a.p.battles - b.p.battles);
    const f = r => `${Math.round(r.deathRate * 100)}% ${r.avgDeathRound ? r.avgDeathRound.toFixed(0) + "r" : "活"} ${Math.round(r.perBattle).toLocaleString()} ${r.battles >= 999999 ? "∞" : r.battles + "場"}`;
    for (const { w, p, d } of rows) {
      console.log(`${w.jobName}/${w.label}`.padEnd(20) + String(p.hp).padStart(6) + " │ " + f(p).padEnd(26) + " │ " + f(d));
    }
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
