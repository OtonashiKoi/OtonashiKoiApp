"use strict";
/**
 * 世界王跑分：所有 S 龍系最強武器 × 對應職業 × 物理/DOT 兩流派，對兩隻世界王跑分。
 * 指標：單場(15 回合)平均傷害 + 單人預估擊殺場數。
 * 玩家設高血以純測輸出(不計存活)；用基礎王 calc(不含階段/部位修正)，並傳 zone 觸發屠龍特攻。
 *
 * 假設屬性檔(可調 BASE/MAIN)：每屬性 BASE，主屬性 = BASE+EXTRA；玩家等級 PLV。
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const { calcPlayerStats } = require("../src/shared/combatStats");
const { runCombatLoop } = require("../src/shared/combatLoop");
const { createServiceContext } = require("../src/services/createServiceContext");

const RUNS = 60;          // 每組合模擬次數(平均化暴擊/觸發)
const MAX_ROUNDS = 60;    // 量測窗(讓多數能殺的組合在窗內擊殺取得實際回合);實戰一場=15 回合,場數用 /15 換算
const PLV = 60;           // 玩家等級(endgame)
const BASE = 60;          // 每屬性基礎
const EXTRA = 120;        // 主屬性額外點(主屬性 = BASE+EXTRA = 180)

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
  "monster-card-35ec8cc7-9f0c-4d61-8a40-343d8857be2f", // 黑焰巫師(burn)
  "fang-wolf-card",                                    // 牙牙狼(bleed)
  "monster-card-9a0ac6a5-4f2e-4186-a66a-73a6de9cb5e2", // 詛咒祭司(def_down/atk_down)
];

function buildAttrs(main) {
  const a = { str: BASE, agi: BASE, vit: BASE, int: BASE, dex: BASE, luk: BASE };
  a[main] += EXTRA;
  return a;
}

// 用真實王血跑；回傳 { roundsToKill, battlesToKill, perBattleDmg }
//  - 殺得動：roundsToKill = 實際擊殺回合；殺不動：用每回合 DPS 外推
//  - 每場 = 15 回合(實戰一場上限)
function simBuild(weaponItem, jobItem, dotCards, attrs, boss) {
  const equipped = { weapon: weaponItem, job_eq: jobItem };
  if (dotCards) { equipped.special_1 = dotCards[0]; equipped.special_2 = dotCards[1]; equipped.special_3 = dotCards[2]; }
  const ps = calcPlayerStats(attrs, equipped, [], [], { zone: boss.zone });
  ps.maxHp = 99999999; // 玩家不死,純測輸出(王血用真實值,bleed 等 %血 才正常)
  let roundsSum = 0, perBattleSum = 0;
  for (let i = 0; i < RUNS; i++) {
    const r = runCombatLoop(ps, boss.calc, boss.name, boss.hp, MAX_ROUNDS, {
      playerName: "BENCH", playerLevel: PLV, equipped, inventory: [],
      partyEffects: [], monsterEquipped: {}, monsterIsBoss: true,
      worldBossPhase: null, bestiaryBonusPct: 0, zone: boss.zone,
    });
    const rounds = Array.isArray(r.roundLogs) ? r.roundLogs.length : MAX_ROUNDS;
    const dmg = r.totalDamage || 0;
    const dpsRound = rounds > 0 ? dmg / rounds : 0;
    // 一場(15 回合)輸出 = 每回合 DPS × 15(未封頂估計)
    perBattleSum += dpsRound * 15;
    if (r.outcome === "win") roundsSum += rounds;
    else roundsSum += dpsRound > 0 ? boss.hp / dpsRound : Infinity; // 殺不動 → 外推
  }
  const roundsToKill = roundsSum / RUNS;
  const perBattleDmg = perBattleSum / RUNS;
  return { roundsToKill, battlesToKill: Math.max(1, Math.ceil(roundsToKill / 15)), perBattleDmg };
}

async function main() {
  const db = await getMongoDb();
  const sc = createServiceContext();
  const elite = await sc.monsterService.listMonsters({ includeDisabled: false, zone: "elite" });
  const lair = await sc.monsterService.listMonsters({ includeDisabled: false, zone: "dragon_king_lair" });
  const daishi = elite.find(m => m.id === "elite-daishi-king");
  const dragon = lair.find(m => m.id === "dragon-king-boss");
  const bosses = [
    { name: "大史王", zone: "elite", calc: daishi.calc, hp: daishi.calc.maxHp, lv: daishi.level, def: daishi.calc.def },
    { name: "古龍王", zone: "dragon_king_lair", calc: dragon.calc, hp: dragon.calc.maxHp, lv: dragon.level, def: dragon.calc.def },
  ];

  // 載入武器/徽章/卡片完整道具文件
  const ids = [...new Set([...WEAPONS.map(w => w.wid), ...WEAPONS.map(w => w.job), ...DOT_CARD_IDS])];
  const items = await db.collection("items").find({ id: { $in: ids } }).toArray();
  const byId = new Map(items.map(it => [it.id, it]));
  const dotCards = DOT_CARD_IDS.map(id => byId.get(id));

  console.log(`跑分設定：玩家 Lv${PLV}，屬性 主${BASE + EXTRA}/其餘${BASE}，每組合 ${RUNS} 場 × ${MAX_ROUNDS} 回合，玩家高血純測輸出。`);
  console.log(`屠龍特攻(S 龍武 +20% 最終傷害)：大史王(elite)不觸發、古龍王(龍王巢穴)觸發。\n`);

  for (const boss of bosses) {
    console.log("═".repeat(96));
    console.log(`【${boss.name}】Lv${boss.lv}｜HP ${boss.hp.toLocaleString()}｜def ${boss.def}%｜flatDef ${boss.calc.flatDef}`);
    console.log("─".repeat(96));
    console.log("武器/職業".padEnd(22) + "物理·場數".padStart(10) + "物理·單場傷害".padStart(15) + "  │ " + "DOT·場數".padStart(9) + "DOT·單場傷害".padStart(15));
    console.log("─".repeat(96));
    const rows = [];
    for (const w of WEAPONS) {
      const attrs = buildAttrs(w.main);
      const phys = simBuild(byId.get(w.wid), byId.get(w.job), null, attrs, boss);
      const dot = simBuild(byId.get(w.wid), byId.get(w.job), dotCards, attrs, boss);
      rows.push({ w, phys, dot });
    }
    rows.sort((a, b) => a.phys.battlesToKill - b.phys.battlesToKill);
    const fmtB = (x) => (x.battlesToKill >= 999 ? "打不動" : `${x.battlesToKill} 場`);
    const fmtD = (x) => Math.min(x.perBattleDmg, boss.hp).toLocaleString(undefined, { maximumFractionDigits: 0 });
    for (const { w, phys, dot } of rows) {
      console.log(
        `${w.jobName}/${w.label}`.padEnd(22) +
        fmtB(phys).padStart(10) + fmtD(phys).padStart(15) + "  │ " +
        fmtB(dot).padStart(9) + fmtD(dot).padStart(15)
      );
    }
    console.log("");
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
