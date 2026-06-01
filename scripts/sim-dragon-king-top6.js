"use strict";
/**
 * 模擬「最強 6 名玩家」連續打龍王(B)，估算清完 177 萬 HP 要幾場、多久。
 * 計入龍王三階段防禦強化（p1 def×1.0 / p2 ×1.15 / p3 ×1.3）與龍王卡反擊。
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const { calcPlayerStats } = require("../src/shared/combatStats");
const { runCombatLoop } = require("../src/shared/combatLoop");
const { createServiceContext } = require("../src/services/createServiceContext");

const RUNS = 40;          // 每組合模擬場數
const MAX_ROUNDS = 20;    // 單場最多回合
const SEC_PER_BATTLE = 35; // 每場實際耗時（讀戰報+點擊+結算）

// 用遊戲真實 monster.calc（effectiveCalc，def 已 min(75)），再套真實世界王階段修正：
//   atk × atkMult；def = min(75, def × defMult)；flatDef 不變（與 applyWorldBossPhaseModifiers 一致）
function applyPhase(calc, atkMult, defMult) {
  return {
    ...calc,
    atk: Math.max(1, Math.round((calc.atk || 0) * Math.max(0.1, atkMult))),
    def: Math.max(0, Math.min(75, (calc.def || 0) * Math.max(0.1, defMult))),
  };
}

// 對單一玩家跑 RUNS 場，回傳平均傷害 + 陣亡率
function simPlayer(ps, equipped, inventory, level, bossCalc, bossEquip) {
  let dmgSum = 0, deaths = 0;
  for (let i = 0; i < RUNS; i++) {
    const r = runCombatLoop(ps, bossCalc, "龍王(B)", bossCalc.maxHp, MAX_ROUNDS, {
      playerLevel: level, equipped, inventory,
      monsterIsBoss: true, monsterEquipped: bossEquip || {},
      monsterActiveEffects: [], playerActiveEffects: [],
    });
    dmgSum += r.totalDamage || 0;
    if (r.outcome === "lose") deaths++;
  }
  return { avgDmg: dmgSum / RUNS, deathRate: deaths / RUNS };
}

function pickTop6(progresses, nameMap, calcMonster, bossEquip) {
  const ranked = [];
  for (const p of progresses) {
    const ps = calcPlayerStats(p.attributes || {}, p.equipment || {}, p.activeEffects || [], p.inventory || [], { pkRating: p.pkRating });
    const r = simPlayer(ps, p.equipment || {}, p.inventory || [], p.level, calcMonster, bossEquip);
    ranked.push({ p, ps, name: nameMap.get(p.playerId) || p.playerId, level: p.level, avgDmg: r.avgDmg, deathRate: r.deathRate });
  }
  ranked.sort((a, b) => b.avgDmg - a.avgDmg);
  return ranked.slice(0, 6);
}

// boss: 已含真實 .calc 的怪物；phaseCfg: worldBossConfig.phaseConfig
function runBossSim(label, boss, phaseCfg, top6, bossEquip) {
  const TOTAL_HP = boss.calc.maxHp;
  const bossEquipObj = bossEquip || {};
  console.log(`\n${"═".repeat(78)}`);
  console.log(`【${label}】Lv${boss.level} HP ${TOTAL_HP.toLocaleString()}｜真實 calc：atk${boss.calc.atk} def${boss.calc.def}(上限75) flatDef${boss.calc.flatDef}｜三部位需全破`);

  // 用 phaseConfig 算各階段 HP 區段
  const sorted = [...phaseCfg].sort((a, b) => b.hpBelowPercent - a.hpBelowPercent);
  // 區段：100→70, 70→40, 40→0（由 hpBelowPercent 推）
  const cuts = sorted.map(p => p.hpBelowPercent); // [70,40,0]
  const segs = [
    { name: `階段1(100→${cuts[0]}%)`, frac: (100 - cuts[0]) / 100, atk: sorted[0].atkMultiplier, def: sorted[0].defMultiplier },
    { name: `階段2(${cuts[0]}→${cuts[1]}%)`, frac: (cuts[0] - cuts[1]) / 100, atk: sorted[1].atkMultiplier, def: sorted[1].defMultiplier },
    { name: `階段3(${cuts[1]}→0%)`, frac: cuts[1] / 100, atk: sorted[2].atkMultiplier, def: sorted[2].defMultiplier },
  ];

  let totalBattles = 0;
  console.log("─".repeat(78));
  for (const ph of segs) {
    const segHp = TOTAL_HP * ph.frac;
    const calc = applyPhase(boss.calc, ph.atk, ph.def);
    let perRoundDmg = 0, deathSum = 0;
    for (const e of top6) {
      const r = simPlayer(e.ps, e.p.equipment || {}, e.p.inventory || [], e.level, calc, bossEquipObj);
      perRoundDmg += r.avgDmg; deathSum += r.deathRate;
    }
    const roundsNeeded = perRoundDmg > 0 ? segHp / perRoundDmg : Infinity;
    const battles = isFinite(roundsNeeded) ? roundsNeeded * 6 : Infinity;
    totalBattles += battles;
    console.log(`${ph.name}：段HP ${Math.round(segHp).toLocaleString()}｜atk×${ph.atk}｜6人每輪合計 ${Math.round(perRoundDmg).toLocaleString()}｜陣亡率 ${Math.round(deathSum / 6 * 100)}%｜需 ${isFinite(battles) ? Math.ceil(battles) + " 場" : "打不動"}`);
  }
  console.log("─".repeat(78));
  if (!isFinite(totalBattles)) {
    console.log(`結論：最強 6 人打不動【${label}】（傷害趨近 0）。`);
  } else {
    const tb = Math.ceil(totalBattles);
    const perPerson = Math.ceil(tb / 6);
    const seqMin = (tb * SEC_PER_BATTLE) / 60;
    const parMin = perPerson * SEC_PER_BATTLE / 60;
    console.log(`總場數：約 ${tb} 場（每人約 ${perPerson} 場）`);
    console.log(`輪流：約 ${seqMin.toFixed(1)} 分鐘｜並行：約 ${parMin.toFixed(1)} 分鐘`);
    console.log(`30 分時限 → ${parMin <= 30 ? "並行可擊殺 ✅" : "並行也超時 ❌"}`);
  }
}

async function main() {
  const db = await getMongoDb();
  const sc = createServiceContext();
  // 用 monsterService 取得「含真實 calc」的怪物
  const eliteList = await sc.monsterService.listMonsters({ includeDisabled: false, zone: "elite" });
  const lairList = await sc.monsterService.listMonsters({ includeDisabled: false, zone: "dragon_king_lair" });
  const daishi = eliteList.find(m => m.id === "elite-daishi-king");
  const dragon = lairList.find(m => m.id === "dragon-king-boss");
  if (!daishi || !dragon) { console.error("找不到 boss"); process.exit(1); }
  const daishiPhase = (await sc.worldBossServiceFor("elite").getConfig()).phaseConfig;
  const dragonPhase = (await sc.worldBossServiceFor("dragon_king_lair").getConfig()).phaseConfig;

  const progresses = await db.collection("progress").find({ level: { $gte: 2 } }).toArray();
  const playerDocs = await db.collection("players")
    .find({ discordId: { $in: progresses.map(p => p.playerId) } })
    .project({ discordId: 1, displayName: 1, name: 1 }).toArray();
  const nameMap = new Map(playerDocs.map(p => [p.discordId, p.displayName || p.name || p.discordId]));

  // 以龍王（最硬）挑最強 6 人
  const top6 = pickTop6(progresses, nameMap, applyPhase(dragon.calc, 1, 1), dragon.equipment || {});
  console.log("最強 6 名玩家（依對龍王輸出排序，全用真實 calc + 等級壓制）：");
  top6.forEach((e, i) => console.log(`  ${i + 1}. ${e.name}（Lv${e.level}）`));

  runBossSim("大史王(×1.5)", daishi, daishiPhase, top6, daishi.equipment || {});
  runBossSim("龍王(B)(×2.25)", dragon, dragonPhase, top6, dragon.equipment || {});
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
