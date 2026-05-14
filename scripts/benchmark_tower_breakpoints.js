"use strict";
// 各等級 × 裝備強化 × 代表隊伍的層數突破分析
require("dotenv").config();
const { MongoClient } = require("mongodb");
const { runCombatLoop } = require("../src/shared/combatLoop");
const { calcPlayerStats } = require("../src/shared/combatStats");
const {
  getTowerFloorBuff, scaleTowerMonsterHp, scaleTowerMonsterAtk,
  getCumulativePartyBonus, TOWER_TOTAL_FLOORS, MAX_ROUNDS_PER_MEMBER,
} = require("../src/shared/towerConfig");
const { collectEquipmentEffects, applyEffectsToStats } = require("../src/shared/effectEngine");

const client = new MongoClient("mongodb://localhost:27017");
const SIMS = 20;

// 職業設定
const JOB_CFG = {
  swordsman:    { main: "sword_1h",  offhand: "shield"         },
  warrior:      { main: "axe_2h",   offhand: null             },
  dwarf_warrior:{ main: "mace_1h",  offhand: "shield"         },
  mage:         { main: "staff_2h", offhand: null             },
  healer:       { main: "staff_1h", offhand: "shield"         },
  archer:       { main: "bow",      offhand: null             },
  barrier_mage: { main: "staff_1h", offhand: "shield"         },
  tactician:    { main: "sword_1h", offhand: "shield"         },
};

const JOB_NAME = {
  swordsman:"劍士", warrior:"戰士", dwarf_warrior:"矮人",
  mage:"法師", healer:"治療師", archer:"弓箭手",
  barrier_mage:"結界師", tactician:"軍師",
};

// 代表性 3 種隊伍
const PARTIES = [
  { label: "均衡隊（劍士×2+弓+法+奶+結）", jobs: ["swordsman","swordsman","archer","mage","healer","barrier_mage"] },
  { label: "重攻隊（戰士×3+弓+法+奶）",     jobs: ["warrior","warrior","warrior","archer","mage","healer"] },
  { label: "坦奶隊（矮人×3+奶×2+結）",       jobs: ["dwarf_warrior","dwarf_warrior","dwarf_warrior","healer","healer","barrier_mage"] },
];

// 等級設定：基礎屬性 = 1 + (lv-1)*2 均分6屬
function getBaseStats(lv) {
  const pts = Math.floor((lv - 1) * 2 / 6);
  const rem = (lv - 1) * 2 % 6;
  return {
    str: 1 + pts + (rem > 0 ? 1 : 0),
    agi: 1 + pts + (rem > 1 ? 1 : 0),
    vit: 1 + pts + (rem > 2 ? 1 : 0),
    int: 1 + pts + (rem > 3 ? 1 : 0),
    dex: 1 + pts + (rem > 4 ? 1 : 0),
    luk: 1 + pts,
  };
}

// 裝備強化值：+0/+3/+6 給主要輸出屬性
const ENH_MAIN = { "+0": 0, "+3": 6, "+6": 12 };
// 防具全身共6件，每件隨機1屬性+強化bonus
const ENH_ARMOR = { "+0": 0, "+3": 3, "+6": 6 }; // 平均每件額外加成

const TIERS = [
  { tier: "D", weaponAtk: 35, armorStats: 4, label: "D階裝備" },
  { tier: "C", weaponAtk: 65, armorStats: 8, label: "C階裝備" },
  { tier: "B", weaponAtk: 120, armorStats: 14, label: "B階裝備" },
  { tier: "A", weaponAtk: 200, armorStats: 22, label: "A階裝備" },
];

const ENH_LEVELS = ["+0", "+3", "+6"];
const CHAR_LEVELS = [30, 35, 40, 45, 50];

function buildMember(job, lv, tier, enh, db_monsters) {
  const base = getBaseStats(lv);
  const cfg = JOB_CFG[job];
  const enhMain = ENH_MAIN[enh];
  const enhArmor = ENH_ARMOR[enh];

  // 主屬性加成依職業
  const isStrJob = ["swordsman","warrior","dwarf_warrior","tactician"].includes(job);
  const isIntJob = ["mage","healer","barrier_mage"].includes(job);
  const isDexJob = ["archer"].includes(job);

  const statBonus = {
    str: base.str + (isStrJob ? enhMain : 0),
    agi: base.agi,
    vit: base.vit + Math.floor(enhArmor * 0.5), // 防具給一半VIT
    int: base.int + (isIntJob ? enhMain : 0),
    dex: base.dex + (isDexJob ? enhMain : 0),
    luk: base.luk,
  };

  const equipped = {
    weapon: {
      weaponType: cfg.main,
      baseAtk: tier.weaponAtk,
      effects: [],
    },
  };

  // 防具加成（每件給 armorStats 到 VIT/STR 等）
  const totalArmorBonus = tier.armorStats * 6 + enhArmor * 6;
  statBonus.vit += Math.floor(totalArmorBonus * 0.4);
  statBonus.str += Math.floor(totalArmorBonus * 0.15);
  statBonus.int += Math.floor(totalArmorBonus * 0.15);

  const raw = calcPlayerStats({ job, stats: statBonus, level: lv }, { equipped });
  return { job, level: lv, stats: raw, equipped };
}

async function runTowerSim(party, monsters, floors) {
  const MAX_SLICES = MAX_ROUNDS_PER_MEMBER * (party.length + 1);

  let memberHp = party.map(m => m.stats.hp);
  let clearedFloor = 0;

  for (let floor = 1; floor <= floors; floor++) {
    const floorBuff = getTowerFloorBuff(floor);
    const partyBonus = getCumulativePartyBonus(floor);

    // Pick random monster from appropriate zone
    let pool;
    if (floor >= 31) pool = monsters.hard;
    else if (floor >= 21) pool = monsters.mid;
    else if (floor >= 11) pool = monsters.mid;
    else pool = monsters.normal;

    const monster = pool[Math.floor(Math.random() * pool.length)];
    const monHp = scaleTowerMonsterHp(monster.maxHp, floor);
    const monAtk = scaleTowerMonsterAtk(monster.str * 8, floor);

    // Build combat members with current HP and floor buff
    const combatMembers = party.map((m, i) => {
      const atkBoost = 1 + partyBonus.atkPct / 100;
      const hpBoost = 1 + partyBonus.hpPct / 100;
      const boostedStats = {
        ...m.stats,
        atk: Math.round(m.stats.atk * atkBoost),
        hp: Math.round(m.stats.hp * hpBoost),
        currentHp: Math.min(memberHp[i], Math.round(m.stats.hp * hpBoost)),
      };
      return {
        id: `p${i}`,
        name: JOB_NAME[m.job],
        job: m.job,
        stats: boostedStats,
        equipped: m.equipped,
        level: m.level,
      };
    });

    const monsterCombat = {
      id: "monster",
      name: monster.name,
      stats: {
        hp: monHp, currentHp: monHp,
        atk: monAtk,
        def: monster.def || 0,
        agi: monster.agi || 5,
        vit: monster.vit || 10,
        str: monster.str || 10,
        int: 0, dex: 0, luk: 0,
        critRate: 0, critDmg: 1.5,
        dodgeRate: 0, hitRate: 0.95,
        defIgnorePct: monster.defIgnorePct || 0,
      },
      isMonster: true,
    };

    const opts = {
      maxRounds: MAX_SLICES,
      mode: "tower",
      members: combatMembers,
    };

    let result;
    try {
      result = runCombatLoop(combatMembers, monsterCombat, opts);
    } catch(e) {
      break;
    }

    const alive = result.members ? result.members.filter(m => (m.stats?.currentHp || 0) > 0) : [];
    if (alive.length === 0 || result.winner !== "party") break;

    // Update member HP
    if (result.members) {
      result.members.forEach((m, i) => {
        memberHp[i] = m.stats?.currentHp || 0;
      });
    }
    clearedFloor = floor;
  }

  return clearedFloor;
}

async function main() {
  await client.connect();
  const db = client.db("equipment_game");

  const allMonsters = await db.collection("monsters").find(
    { name: { $exists: true }, zone: { $in: ["normal","mid","hard","elite"] } }
  ).toArray();

  const monsters = {
    normal: allMonsters.filter(m => m.zone === "normal" && !m.isBoss),
    mid:    allMonsters.filter(m => m.zone === "mid" && !m.isBoss),
    hard:   allMonsters.filter(m => m.zone === "hard" && !m.isBoss),
    elite:  allMonsters.filter(m => m.zone === "elite"),
  };

  console.log("═".repeat(90));
  console.log("  爬塔突破點分析 ── 等級 × 裝備階級 × 強化 × 隊伍類型");
  console.log("═".repeat(90));

  for (const party of PARTIES) {
    console.log(`\n▶ ${party.label}`);
    console.log("  等級".padEnd(8) + "D+0".padEnd(7) + "D+3".padEnd(7) + "C+0".padEnd(7) + "C+3".padEnd(7) + "B+0".padEnd(7) + "B+3".padEnd(7) + "B+6".padEnd(7) + "A+0".padEnd(7) + "A+3");

    for (const lv of CHAR_LEVELS) {
      const results = {};

      for (const tier of TIERS) {
        for (const enh of ENH_LEVELS) {
          const key = `${tier.tier}${enh}`;
          if (tier.tier === "D" && enh === "+6") continue; // skip D+6
          if (tier.tier === "A" && enh === "+6") continue; // skip A+6

          const members = party.jobs.map(job => buildMember(job, lv, tier, enh, monsters));

          let total = 0;
          for (let i = 0; i < SIMS; i++) {
            total += await runTowerSim(members, monsters, TOWER_TOTAL_FLOORS);
          }
          results[key] = Math.round(total / SIMS * 10) / 10;
        }
      }

      const fmt = (k) => (results[k] !== undefined ? String(results[k]).padEnd(7) : "  -    ");
      process.stdout.write(`  Lv${lv}  `.padEnd(8));
      process.stdout.write(fmt("D+0") + fmt("D+3") + fmt("C+0") + fmt("C+3") + fmt("B+0") + fmt("B+3") + fmt("B+6") + fmt("A+0") + fmt("A+3"));
      console.log();
    }
  }

  console.log("\n" + "─".repeat(90));
  console.log("  備注：數值為平均通關層數（" + SIMS + "次模擬），怪物隨機抽取對應區間");
  await client.close();
}

main().catch(console.error);
