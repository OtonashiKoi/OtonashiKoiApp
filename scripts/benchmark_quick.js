"use strict";
// 用真實的爬塔戰鬥邏輯模擬，測試各隊伍能爬到幾層
require("dotenv").config();
const { MongoClient } = require("mongodb");
const { runCombatLoop } = require("../src/shared/combatLoop");
const { calcPlayerStats } = require("../src/shared/combatStats");
const {
  getTowerFloorBuff, scaleTowerMonsterHp, scaleTowerMonsterAtk,
  getCumulativePartyBonus, TOWER_TOTAL_FLOORS, MAX_ROUNDS_PER_MEMBER,
} = require("../src/shared/towerConfig");

const client = new MongoClient(process.env.MONGODB_URI);
const SIMS = 10;

const TOWER_FLOOR_BOSS = {
  10: "大野兔(B)", 20: "米拉桑(B)", 30: "古城將軍(B)",
  40: "城堡魔像(B)", 41: "大史王",
};
const TOWER_FLOOR_ZONE = (floor) => {
  if (floor <= 10) return "beginner";
  if (floor <= 20) return "normal";
  if (floor <= 30) return "mid";
  return "hard";
};

const JOB_NAME = {
  swordsman:"劍士", warrior:"戰士", dwarf_warrior:"矮人",
  mage:"法師", healer:"治療師", archer:"弓箭手",
  barrier_mage:"結界師", tactician:"軍師",
};

// Lv40 不同裝備等級的屬性模擬
function buildMember(job, tier = "A", enhance = 6) {
  const WEAPON_ATK = { D: 35, C: 65, B: 120, A: 200 };
  const ARMOR_BONUS = { D: 24 + enhance*2, C: 48 + enhance*3, B: 84 + enhance*4, A: 132 + enhance*6 };

  const isStr = ["swordsman","warrior","dwarf_warrior","tactician"].includes(job);
  const isInt = ["mage","healer","barrier_mage"].includes(job);
  const isDex = ["archer"].includes(job);
  const WEAPON_TYPE = { swordsman:"sword_1h", warrior:"axe_2h", dwarf_warrior:"mace_1h", mage:"staff_2h", healer:"staff_1h", archer:"bow", barrier_mage:"staff_1h", tactician:"sword_1h" };

  // Lv40 = 1 + 39*2 = 79 pts，分配給主屬性
  const base = { str:8, agi:8, vit:8, int:8, dex:8, luk:8 };
  const remain = 79 - 48; // = 31 pts 灌主屬
  if (isStr) base.str += remain + Math.floor(ARMOR_BONUS[tier] * 0.2);
  else if (isInt) base.int += remain + Math.floor(ARMOR_BONUS[tier] * 0.2);
  else if (isDex) base.dex += remain + Math.floor(ARMOR_BONUS[tier] * 0.2);
  base.vit += Math.floor(ARMOR_BONUS[tier] * 0.4);

  const equipped = { weapon: { weaponType: WEAPON_TYPE[job], baseAtk: WEAPON_ATK[tier] + enhance * 8, effects: [] } };
  const raw = calcPlayerStats(base, equipped);
  return {
    job, level: 40,
    name: JOB_NAME[job],
    discordId: `sim_${job}_${Math.random()}`,
    stats: raw,
    currentHp: raw.maxHp,
    maxHp: raw.maxHp,
    equipped,
    inventory: [],
    activeEffects: [],
  };
}

function buildMonsterCalc(monster, floor) {
  const monHp  = scaleTowerMonsterHp(monster.maxHp, floor);
  const monAtk = scaleTowerMonsterAtk((monster.str || 1) * 8, floor);
  return {
    hp: monHp, atk: monAtk,
    def: monster.def || 0,
    agi: monster.agi || 5,
    vit: monster.vit || 10,
    str: monster.str || 1,
    int: 0, dex: 0, luk: 0,
    critRate: 0, critDmg: 1.5,
    dodgeRate: 0, hitRate: 0.95,
    defIgnorePct: monster.defIgnorePct || 0,
    isBoss: monster.isBoss || false,
  };
}

// 簡化版爬塔戰鬥：輪流讓每個存活成員攻擊一次，怪物攻擊全體
function runFloorBattle(members, monster, floor) {
  const mCalc = buildMonsterCalc(monster, floor);
  const bonus  = getCumulativePartyBonus(floor);
  const maxSlices = MAX_ROUNDS_PER_MEMBER * (members.length + 1);

  let monsterHp = mCalc.hp;
  let totalActions = 0;
  const alive = () => members.filter(m => m.currentHp > 0);

  while (monsterHp > 0 && alive().length > 0 && totalActions < maxSlices) {
    // 輪流讓成員攻擊（簡化：每人各打一次怪一次的輪迴）
    for (const m of alive()) {
      if (monsterHp <= 0) break;
      totalActions++;

      const effAtk = Math.round((m.stats.atk || 1) * (1 + bonus.atkPct / 100));
      const effMaxHp = Math.round(m.maxHp * (1 + bonus.hpPct / 100));
      const curHp = Math.min(m.currentHp, effMaxHp);

      const result = runCombatLoop(
        { ...m.stats, atk: effAtk, maxHp: effMaxHp },
        { ...mCalc, atk: 0, monsterAttackCount: 0 },
        monster.name,
        mCalc.hp,
        1,
        { startMonsterHp: monsterHp, startPlayerHp: curHp, startRound: 1, monsterIsBoss: mCalc.isBoss }
      );
      monsterHp = result.finalMonsterHp;
      m.currentHp = Math.max(0, Math.round(result.finalPlayerHp));
    }
    if (monsterHp <= 0) break;

    // 怪物攻擊全體存活成員
    const targets = alive();
    if (!targets.length) break;
    totalActions++;
    for (const t of targets) {
      const rawDmg = mCalc.atk;
      const def = t.stats.def || 0;
      const dmg = Math.max(1, Math.round(rawDmg * (1 - def / (def + 200))));
      t.currentHp = Math.max(0, t.currentHp - dmg);
    }
  }

  return { killed: monsterHp <= 0, survived: alive().length > 0 };
}

async function runTowerSim(jobs, tier, enhance, monstersByZone, bossMap) {
  const members = jobs.map(job => buildMember(job, tier, enhance));
  let clearedFloor = 0;

  for (let floor = 1; floor <= TOWER_TOTAL_FLOORS; floor++) {
    // 還原 currentHp（不回血，但每層保持上一層結束狀態）
    const bonus = getCumulativePartyBonus(floor);
    for (const m of members) {
      const newMax = Math.round(m.maxHp * (1 + bonus.hpPct / 100));
      if (newMax > m.currentHp + (newMax - m.maxHp)) {
        m.currentHp = Math.min(newMax, m.currentHp + Math.max(0, newMax - m.maxHp));
      }
    }

    let monster;
    if (TOWER_FLOOR_BOSS[floor]) {
      monster = bossMap[TOWER_FLOOR_BOSS[floor]];
    } else {
      const zone = TOWER_FLOOR_ZONE(floor);
      const pool = monstersByZone[zone] || [];
      if (!pool.length) break;
      monster = pool[Math.floor(Math.random() * pool.length)];
    }
    if (!monster) break;

    const { killed, survived } = runFloorBattle(members, monster, floor);
    if (!killed || !survived) break;
    clearedFloor = floor;
  }
  return clearedFloor;
}

const PARTIES = [
  { label: "均衡隊（劍士×2+弓+法+奶+結）", jobs: ["swordsman","swordsman","archer","mage","healer","barrier_mage"] },
  { label: "重攻隊（戰士×3+弓+法+奶）",     jobs: ["warrior","warrior","warrior","archer","mage","healer"] },
  { label: "坦奶隊（矮人×3+奶×2+結）",       jobs: ["dwarf_warrior","dwarf_warrior","dwarf_warrior","healer","healer","barrier_mage"] },
];

const CONFIGS = [
  { tier:"B", enhance:0, label:"B+0" },
  { tier:"B", enhance:3, label:"B+3" },
  { tier:"B", enhance:6, label:"B+6" },
  { tier:"A", enhance:0, label:"A+0" },
  { tier:"A", enhance:3, label:"A+3" },
  { tier:"A", enhance:6, label:"A+6" },
];

async function main() {
  await client.connect();
  const db = client.db("equipmentGame");

  const all = await db.collection("monsters").find({}).toArray();
  const monstersByZone = {
    beginner: all.filter(m => m.zone === "beginner" && !m.isBoss),
    normal:   all.filter(m => m.zone === "normal"   && !m.isBoss),
    mid:      all.filter(m => m.zone === "mid"      && !m.isBoss),
    hard:     all.filter(m => m.zone === "hard"     && !m.isBoss),
  };
  const bossMap = {};
  for (const name of Object.values(TOWER_FLOOR_BOSS)) {
    const m = all.find(m => m.name === name);
    if (m) bossMap[name] = m;
    else console.warn("⚠ 找不到 boss:", name);
  }

  // 先印 Boss 的縮放後數值供參考
  console.log("=== Boss 縮放後強度 ===");
  for (const [floor, name] of Object.entries(TOWER_FLOOR_BOSS)) {
    const m = bossMap[name];
    if (!m) continue;
    const hp  = scaleTowerMonsterHp(m.maxHp, Number(floor));
    const atk = scaleTowerMonsterAtk(m.str * 8, Number(floor));
    console.log(`  Floor ${floor} ${name}: HP=${hp.toLocaleString()} ATK=${atk}`);
  }
  console.log();

  console.log("═".repeat(72));
  console.log("  爬塔模擬（Lv40，各隊伍 × 裝備配置，" + SIMS + "次平均）");
  console.log("═".repeat(72));
  const pad = (s, n) => String(s).padEnd(n);

  process.stdout.write(pad("隊伍", 28));
  for (const c of CONFIGS) process.stdout.write(pad(c.label, 8));
  console.log();
  console.log("─".repeat(72));

  for (const party of PARTIES) {
    process.stdout.write(pad(party.label, 28));
    for (const cfg of CONFIGS) {
      let total = 0;
      for (let i = 0; i < SIMS; i++) {
        total += await runTowerSim(party.jobs, cfg.tier, cfg.enhance, monstersByZone, bossMap);
      }
      const avg = (total / SIMS).toFixed(1);
      process.stdout.write(pad(avg, 8));
    }
    console.log();
  }

  await client.close();
}
main().catch(console.error);
