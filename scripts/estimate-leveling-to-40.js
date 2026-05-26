"use strict";
/**
 * 估算「從 Lv.1 練到 Lv.40」需要多少場戰鬥與時間
 *
 * 假設：
 *   - 玩家穿同階基本套裝（用 benchmark-level-progression 那批模板平均 DPR）
 *   - 每隻怪 fightsToKill = ceil(monsterHp / avgDmgPerFight)
 *   - 各等選擇對應區（同 benchmark-real-players 規則）
 *   - 一場戰鬥 ≈ 15 回合，實機顯示時間 baseline 每回合 8-15 秒，取均值 12 秒 → 一場 3 分鐘
 *     （若是 instant mode / 已優化短戰鬥就要再縮）
 *   - 單怪殺死後同一隻可重生（monsterState 重置），重複殺
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const { calcPlayerStats } = require("../src/shared/combatStats");
const { runCombatLoop } = require("../src/shared/combatLoop");
const { expToNextLevel, MAX_LEVEL } = require("../src/shared/progression");

const RUNS_PER_MONSTER = 10;
const MAX_ROUNDS = 15;
const SECONDS_PER_ROUND = 12;

// 標竿職業（劍士套裝）作為基準
const JOB = { job: "劍士", weapon: "單手劍", offhand: "盾", armorFlavor: "鬥紋",
  ratio: { str: 40, agi: 25, vit: 20, int: 1, dex: 8, luk: 6 } };

const ARMOR_SLOTS = ["armor","garment","shoes","head_top","head_mid","head_low","accessory_l","accessory_r"];
const WEAPON_MAT = { D:"木製", C:"鐵製", B:"鋼製", A:"秘銀" };
const WEAPON_TYPE = { "單手劍":"單手劍","盾":"盾" };
const ARMOR_NAMES = {
  D: { material:"布", slots:{armor:"衣",garment:"披風",shoes:"鞋",head_top:"帽",head_mid:"護目",head_low:"口罩",accessory_l:"戒指(左)",accessory_r:"戒指(右)"}},
  C: { material:"皮", slots:{armor:"甲",garment:"披風",shoes:"靴",head_top:"帽",head_mid:"護目",head_low:"口罩",accessory_l:"戒指(左)",accessory_r:"戒指(右)"}},
  B: { material:"鐵", slots:{armor:"甲",garment:"披風",shoes:"靴",head_top:"帽",head_mid:"護目",head_low:"口罩",accessory_l:"戒指(左)",accessory_r:"戒指(右)"}},
  A: { material:"秘銀", slots:{armor:"甲",garment:"披風",shoes:"靴",head_top:"帽",head_mid:"護目",head_low:"口罩",accessory_l:"戒指(左)",accessory_r:"戒指(右)"}},
};
const ACC_MAT = { D:"銅", C:"鐵", B:"銀", A:"金" };

function tierForLevel(lv) {
  if (lv < 10) return "D";
  if (lv < 20) return "C";
  if (lv < 30) return "B";
  return "A";
}
function totalAttrForLevel(lv) { return 10 + (lv - 1) * 2; } // 粗估每等 +2 點
function pickZoneForLevel(level) {
  if (level <= 3)  return "beginner";
  if (level < 10)  return "normal";
  if (level < 20)  return "mid";
  if (level < 30)  return "ancient_city";       // Lv.20-29
  if (level < 40)  return "ancient_city_deep";  // Lv.30-39
  return "dragon_realm";                        // Lv.40-50
}

function scaleAttrs(ratio, total) {
  const sum = Object.values(ratio).reduce((a,b)=>a+b,0);
  const r = {};
  let allocated = 0;
  const keys = Object.keys(ratio);
  keys.forEach((k,i)=>{
    if (i === keys.length-1) r[k] = Math.max(1, total - allocated);
    else { const v = Math.max(1, Math.round((ratio[k]/sum)*total)); r[k]=v; allocated += v; }
  });
  return r;
}

function buildEquipped(tier, items, includeBadge) {
  const find = (name) => items.find(it => it.name === name && (tier == null || it.tier === tier));
  const findBySlot = (slot) => items.find(it => it.equipSlot === slot && it.tier === tier);
  const eq = {};
  const mat = WEAPON_MAT[tier];
  const w = find(`${mat}${WEAPON_TYPE[JOB.weapon]}`) || findBySlot("weapon");
  if (w) eq.weapon = { ...w, itemId: w.id, itemName: w.name };
  const s = find(`${mat}盾`);
  if (s) eq.shield = { ...s, itemId: s.id, itemName: s.name };
  for (const slot of ARMOR_SLOTS) {
    let p;
    if (slot.startsWith("accessory_")) {
      const am = ACC_MAT[tier];
      p = find(`${JOB.armorFlavor}${am}戒指(${slot === "accessory_l" ? "左" : "右"})`);
    } else {
      const arm = ARMOR_NAMES[tier].material;
      const suf = ARMOR_NAMES[tier].slots[slot];
      p = find(`${JOB.armorFlavor}${arm}${suf}`) || find(`${arm}${suf}`);
    }
    if (!p) p = findBySlot(slot);
    if (p) eq[slot] = { ...p, itemId: p.id, itemName: p.name };
  }
  if (includeBadge) {
    const b = items.find(it => it.name === "劍士徽章");
    if (b) eq.job_eq = { ...b, itemId: b.id, itemName: b.name };
  }
  return eq;
}

function buildMonsterCalc(m) {
  const level = Math.max(1, m.level || 1);
  const vit = m.vit || 0;
  return {
    maxHp: m.maxHp || 800,
    atk: (m.str || 1) * 3,
    def: Math.min(75, Math.max(0, Number(m.def) || 0)),
    flatDef: (typeof m.flatDef === "number") ? Math.max(0, m.flatDef) : level + vit,
    level, agi: m.agi||1, int: m.int||0, dex: m.dex||1, luk: m.luk||0,
    dodge: Math.min(50, (m.agi||1)*0.5),
    hit: Math.min(100, 80 + (m.dex||1)),
    critRate: Math.min(100, Math.round((m.luk||0)*0.3)),
    comboChance: Math.min(80, Math.round(3 + (m.agi||1)*0.5)),
    defIgnorePct: m.defIgnorePct||0,
    isBoss: !!m.isBoss,
    dmgMin: Math.min(1, 0.7 + (m.int||0)*0.01),
    dmgMax: 1,
  };
}

async function main() {
  const db = await getMongoDb();
  const items = await db.collection("items").find({}).toArray();
  const allMonsters = (await db.collection("monsters").find({}).toArray())
    .filter(m => !String(m._id||"").startsWith("monsterState:"))
    .filter(m => m.enabled !== false);

  console.log(`\n${"═".repeat(100)}`);
  console.log(`練到 Lv.${MAX_LEVEL} 估算（劍士範本，每等對應區，每場 ≤ ${MAX_ROUNDS} 回合 × ${SECONDS_PER_ROUND}s）`);
  console.log("═".repeat(100));
  console.log([
    "Lv→Lv+1".padEnd(9),"Zone".padEnd(20),"裝備階".padEnd(6),
    "需要EXP".padEnd(8),"代表怪EXP".padEnd(10),"擊殺/隻".padEnd(8),
    "本級場數".padEnd(8),"本級時長",
  ].join("  "));
  console.log("─".repeat(100));

  let totalFights = 0;
  let totalSeconds = 0;
  let totalGold = 0;

  for (let lv = 1; lv < MAX_LEVEL; lv++) {
    const zone = pickZoneForLevel(lv);
    const monsters = allMonsters.filter(m => m.zone === zone);
    if (!monsters.length) {
      console.log(`Lv.${lv} ${zone} 無怪物，跳過`);
      continue;
    }
    const tier = tierForLevel(lv);
    const includeBadge = lv >= 10;
    const attrs = scaleAttrs(JOB.ratio, totalAttrForLevel(lv));
    const equipped = buildEquipped(tier, items, includeBadge);
    const ps = calcPlayerStats(attrs, equipped, [], [], {});

    // 算這個區的「平均一場可給多少 exp」(weighted by fightsToKill)
    let zoneExpPerFight = 0;
    let zoneGoldPerFight = 0;
    let sampleCount = 0;
    let sampleMonster = monsters[0];

    for (const m of monsters) {
      const mCalc = buildMonsterCalc(m);
      let dmgSum = 0;
      for (let i = 0; i < RUNS_PER_MONSTER; i++) {
        const r = runCombatLoop(ps, mCalc, m.name, mCalc.maxHp, MAX_ROUNDS, {
          playerLevel: lv, equipped, inventory: [], monsterIsBoss: !!m.isBoss,
        });
        dmgSum += r.totalDamage || 0;
      }
      const avgDmg = dmgSum / RUNS_PER_MONSTER;
      const fightsToKill = avgDmg > 0 ? Math.ceil(mCalc.maxHp / avgDmg) : 9999;
      const expPerFight = (m.expReward || 0) / fightsToKill;
      const goldPerFight = (m.goldReward || 0) / fightsToKill;
      zoneExpPerFight += expPerFight;
      zoneGoldPerFight += goldPerFight;
      sampleCount++;
    }
    zoneExpPerFight /= sampleCount;
    zoneGoldPerFight /= sampleCount;

    const needExp = expToNextLevel(lv);
    const fightsNeeded = zoneExpPerFight > 0 ? Math.ceil(needExp / zoneExpPerFight) : Infinity;
    const seconds = fightsNeeded * MAX_ROUNDS * SECONDS_PER_ROUND;

    totalFights += fightsNeeded;
    totalSeconds += seconds;
    totalGold += fightsNeeded * zoneGoldPerFight;

    const fmtT = (sec) => {
      if (!isFinite(sec)) return "∞";
      if (sec < 3600) return `${Math.round(sec/60)}分`;
      const h = Math.floor(sec/3600);
      const mm = Math.round((sec%3600)/60);
      return `${h}小時${mm}分`;
    };

    console.log([
      `${lv}→${lv+1}`.padEnd(9),
      zone.padEnd(20),
      tier.padEnd(6),
      String(needExp).padEnd(8),
      zoneExpPerFight.toFixed(1).padEnd(10),
      "—".padEnd(8),
      String(fightsNeeded).padEnd(8),
      fmtT(seconds),
    ].join("  "));
  }

  console.log("─".repeat(100));
  console.log(`\n總計：練到 Lv.${MAX_LEVEL}`);
  console.log(`  - 戰鬥場數：${totalFights} 場`);
  console.log(`  - 預估時長：${(totalSeconds/3600).toFixed(1)} 小時（≈ ${(totalSeconds/3600/24).toFixed(1)} 天連續打）`);
  console.log(`  - 累計金幣：約 ${Math.round(totalGold).toLocaleString()} G`);
  console.log(`\n備註：`);
  console.log(`  - 假設每場固定 15 回合 × 12 秒 = 3 分鐘（實機 baseline 受 AGI 影響）`);
  console.log(`  - 用劍士範本（5 件 D→C→B→A 套裝 + 徽章），實際裸玩家會更慢`);
  console.log(`  - 沒算 quest/daily/job 任務獎勵 exp（會大幅縮減時間）`);
}

main().then(()=>process.exit(0)).catch(e=>{console.error(e); process.exit(1);});
