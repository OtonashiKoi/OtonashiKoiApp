"use strict";

require("dotenv").config();

const { MongoClient } = require("mongodb");
const { calcPlayerStats } = require("../src/shared/combatStats");
const { runCombatLoop } = require("../src/shared/combatLoop");
const {
  TOWER_TOTAL_FLOORS,
  MAX_ROUNDS_PER_MEMBER,
  scaleTowerMonsterHp,
  scaleTowerMonsterAtk,
  getCumulativePartyBonus,
  calcTowerReward,
} = require("../src/shared/towerConfig");
const {
  collectEquipmentEffects,
  applyEffectsToStats,
  isEffectConditionMet,
} = require("../src/shared/effectEngine");

const SIMS = Number(process.env.TOWER_TEST_SIMS || 3);
const TEST_LEVEL = Number(process.env.TOWER_TEST_LEVEL || 30);
const TEST_TIER = String(process.env.TOWER_TEST_TIER || "B").toUpperCase();

const JOB_CFG = {
  swordsman: { name: "劍士", jobId: "job_swordsman_v1", main: "sword_1h", offhand: "shield" },
  warrior: { name: "戰士", jobId: "job_warrior_v1", main: "axe_2h", offhand: null },
  dwarf_warrior: { name: "矮人", jobId: "job_dwarf_warrior_v1", main: "mace_1h", offhand: "shield" },
  rogue: { name: "盜賊", jobId: "job_rogue_v1", main: "dagger", offhand: null },
  mage: { name: "法師", jobId: "job_mage_v1", main: "staff_2h", offhand: null },
  healer: { name: "治療師", jobId: "job_healer_v1", main: "staff_1h", offhand: "shield" },
  archer: { name: "弓箭手", jobId: "job_archer_v1", main: "bow", offhand: null },
  tactician: { name: "軍師", jobId: "job_tactician_v1", main: "sword_1h", offhand: "shield" },
  bard: { name: "詩人", jobId: "job_bard_v1", main: "bow", offhand: null },
  barrier_mage: { name: "結界師", jobId: "job_barrier_mage_v1", main: "staff_1h", offhand: "shield" },
};

const PARTIES = [
  { label: "均衡隊", jobs: ["swordsman", "warrior", "archer", "mage", "healer", "barrier_mage"] },
  { label: "重攻隊", jobs: ["warrior", "warrior", "warrior", "archer", "mage", "healer"] },
  { label: "坦奶隊", jobs: ["dwarf_warrior", "dwarf_warrior", "swordsman", "healer", "healer", "barrier_mage"] },
  { label: "雙劍穩定隊", jobs: ["swordsman", "swordsman", "warrior", "archer", "healer", "barrier_mage"] },
  { label: "雙弓爆發隊", jobs: ["swordsman", "warrior", "archer", "archer", "healer", "bard"] },
  { label: "法術爆發隊", jobs: ["mage", "mage", "barrier_mage", "healer", "tactician", "swordsman"] },
  { label: "三法隊", jobs: ["mage", "mage", "mage", "healer", "barrier_mage", "bard"] },
  { label: "三弓隊", jobs: ["archer", "archer", "archer", "healer", "bard", "tactician"] },
  { label: "盜賊連擊隊", jobs: ["rogue", "rogue", "rogue", "archer", "healer", "bard"] },
  { label: "雙盜快攻隊", jobs: ["rogue", "rogue", "warrior", "archer", "healer", "barrier_mage"] },
  { label: "軍師指揮隊", jobs: ["tactician", "tactician", "swordsman", "warrior", "healer", "barrier_mage"] },
  { label: "雙軍師破防隊", jobs: ["tactician", "tactician", "archer", "mage", "healer", "bard"] },
  { label: "詩人支援隊", jobs: ["bard", "bard", "archer", "warrior", "healer", "barrier_mage"] },
  { label: "雙補續戰隊", jobs: ["healer", "healer", "swordsman", "warrior", "archer", "barrier_mage"] },
  { label: "三補保守隊", jobs: ["healer", "healer", "healer", "warrior", "archer", "barrier_mage"] },
  { label: "雙結界防守隊", jobs: ["barrier_mage", "barrier_mage", "healer", "swordsman", "warrior", "archer"] },
  { label: "矮人控制隊", jobs: ["dwarf_warrior", "dwarf_warrior", "dwarf_warrior", "archer", "healer", "bard"] },
  { label: "戰士玻璃砲隊", jobs: ["warrior", "warrior", "warrior", "warrior", "archer", "healer"] },
  { label: "四輸出一補一結", jobs: ["warrior", "archer", "mage", "rogue", "healer", "barrier_mage"] },
  { label: "全職業混合A", jobs: ["swordsman", "dwarf_warrior", "rogue", "mage", "healer", "bard"] },
  { label: "全職業混合B", jobs: ["warrior", "archer", "tactician", "barrier_mage", "healer", "rogue"] },
  { label: "Boss取向隊", jobs: ["tactician", "bard", "archer", "warrior", "mage", "healer"] },
  { label: "物理主力隊", jobs: ["swordsman", "warrior", "dwarf_warrior", "rogue", "archer", "healer"] },
  { label: "魔法支援隊", jobs: ["mage", "mage", "healer", "healer", "barrier_mage", "tactician"] },
];

const ARMOR_SLOTS = ["head_top", "head_mid", "head_low", "armor", "garment", "shoes", "accessory_l", "accessory_r"];
const BOSS_BY_FLOOR = {
  10: "大野兔(B)",
  20: "米拉桑(B)",
  30: "古城將軍(B)",
  40: "城堡魔像(B)",
  41: "大史王",
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function getBaseStats(level) {
  const points = 1 + (level - 1) * 2;
  const base = Math.floor(points / 6);
  const rem = points % 6;
  const stats = { str: base, agi: base, vit: base, int: base, dex: base, luk: base };
  for (const key of ["str", "agi", "vit", "int", "dex", "luk"].slice(0, rem)) stats[key] += 1;
  return stats;
}

function monsterCalc(monster) {
  const agi = Number(monster.agi || 1);
  const dex = Number(monster.dex || 1);
  const luk = Number(monster.luk || 0);
  return {
    maxHp: Number(monster.maxHp || 100),
    atk: Math.round(Number(monster.str || 1) * 3),
    def: Number(monster.def || 0),
    agi,
    dodge: Math.min(50, agi * 0.5),
    hit: Math.min(100, 80 + dex),
    critRate: Math.min(100, luk * 0.3),
    comboChance: Math.min(80, 3 + agi * 0.5),
  };
}

function pickItem(items, filter) {
  return items.find((item) => item.tier === TEST_TIER && filter(item))
    || items.find(filter);
}

function buildPartyEffects(members) {
  const best = new Map();
  const stack = [];
  for (const member of members) {
    if (member.currentHp <= 0) continue;
    const context = { equipped: member.equipped, inventory: [] };
    const refs = collectEquipmentEffects(member.equipped, null, context);
    for (const effect of refs) {
      if (!effect || effect.target !== "party" || !isEffectConditionMet(effect, context)) continue;
      const key = `${member.jobKey}:${effect.key}`;
      if (!member.jobKey) {
        stack.push(effect);
        continue;
      }
      const current = best.get(key);
      if (!current || Number(effect.params?.value || 0) > Number(current.params?.value || 0)) best.set(key, effect);
    }
  }
  return [...best.values(), ...stack];
}

function applyHealing(members, partyEffects) {
  for (const member of members) {
    if (member.currentHp <= 0) continue;
    for (const effect of partyEffects) {
      if (effect.key !== "heal_over_time" && effect.key !== "party_heal") continue;
      const value = Number(effect.params?.value || 0);
      if (value <= 0) continue;
      const heal = effect.params?.mode === "flat"
        ? Math.round(value)
        : Math.round(member.maxHp * value / 100);
      member.currentHp = Math.min(member.maxHp, member.currentHp + heal);
    }
  }
}

function monsterTeamAttack(members, mCalc, partyEffects) {
  let damageReductionPct = 0;
  let critReductionPct = 0;
  for (const effect of partyEffects) {
    const value = Number(effect.params?.value || 0);
    if (effect.key === "party_damage_reduction") damageReductionPct = Math.max(damageReductionPct, value);
    if (effect.key === "party_crit_damage_reduction") critReductionPct = Math.max(critReductionPct, value);
  }
  const isCrit = Math.random() * 100 < Number(mCalc.critRate || 0);
  for (const member of members) {
    if (member.currentHp <= 0) continue;
    const stats = applyEffectsToStats(member.stats, member.activeEffects || [], { equipped: member.equipped, inventory: [] });
    const hitChance = Math.max(5, Math.min(95, Number(mCalc.hit || 80) - Number(stats.dodge || 0) + 30));
    if (Math.random() * 100 >= hitChance) continue;
    let damage = Number(mCalc.atk || 1) * (1 - Math.min(75, Number(stats.def || 0)) / 100);
    if (isCrit) damage *= Math.max(1, 1.5 - critReductionPct / 100);
    damage *= 1 - Math.min(90, damageReductionPct) / 100;
    member.currentHp = Math.max(0, member.currentHp - Math.max(1, Math.round(damage)));
  }
}

function fightFloor(memberTemplates, monster, floor) {
  const bonus = getCumulativePartyBonus(floor);
  const members = memberTemplates.map((member) => {
    const maxHp = Math.round(member.baseMaxHp * (1 + bonus.hpPct / 100));
    const currentHp = Math.min(maxHp, Math.round(member.currentHp + Math.max(0, maxHp - member.maxHp)));
    return { ...member, maxHp, currentHp };
  });

  const baseCalc = monster.calc || monsterCalc(monster);
  const scaledHp = scaleTowerMonsterHp(Number(baseCalc.maxHp || monster.maxHp || 100), floor);
  const scaledAtk = scaleTowerMonsterAtk(Number(baseCalc.atk || 1), floor);
  const mCalc = { ...baseCalc, maxHp: scaledHp, atk: scaledAtk };
  const gauges = new Map();
  for (const member of members) gauges.set(member.id, 0);
  gauges.set("monster", 0);

  let monsterHp = scaledHp;
  let monsterActiveEffects = [];
  let stunRoundsLeft = 0;
  let sharedRound = 1;
  let actions = 0;
  const maxActions = Math.max(50, MAX_ROUNDS_PER_MEMBER * (members.length + 1));

  while (monsterHp > 0 && members.some((m) => m.currentHp > 0) && actions < maxActions) {
    const partyEffects = buildPartyEffects(members);
    const actors = [
      ...members.filter((m) => m.currentHp > 0).map((member, index) => {
        const stats = applyEffectsToStats(member.stats, partyEffects, { equipped: member.equipped, inventory: [] });
        return {
          type: "member",
          id: member.id,
          index,
          agi: Number(stats.agi || 0),
          dex: Number(stats.dex || 0),
          speed: 100 + Math.max(0, Number(stats.agi || 0)),
          member,
          stats,
        };
      }),
      {
        type: "monster",
        id: "monster",
        index: 999,
        agi: Number(mCalc.agi || 0),
        dex: Number(mCalc.dex || 0),
        speed: 100 + Math.max(0, Number(mCalc.agi || 0)),
      },
    ];
    const nextNeed = Math.min(...actors.map((actor) => (1000 - (gauges.get(actor.id) || 0)) / Math.max(1, actor.speed)));
    for (const actor of actors) gauges.set(actor.id, (gauges.get(actor.id) || 0) + actor.speed * nextNeed);
    const ready = actors
      .filter((actor) => (gauges.get(actor.id) || 0) >= 999.999)
      .sort((a, b) => ((gauges.get(b.id) || 0) - (gauges.get(a.id) || 0)) || (b.agi - a.agi) || (b.dex - a.dex) || (a.index - b.index));
    const actor = ready[0];
    gauges.set(actor.id, (gauges.get(actor.id) || 0) - 1000);
    actions += 1;

    if (actor.type === "monster") {
      if (stunRoundsLeft > 0) {
        stunRoundsLeft -= 1;
      } else {
        monsterTeamAttack(members, mCalc, partyEffects);
      }
      continue;
    }

    const member = actor.member;
    applyHealing(members, partyEffects);
    const nonHealPartyEffects = partyEffects.filter((effect) => effect.key !== "heal_over_time" && effect.key !== "party_heal");
    const effectiveStats = {
      ...actor.stats,
      atk: Math.round(Number(actor.stats.atk || 1) * (1 + bonus.atkPct / 100)),
      maxHp: member.maxHp,
    };
    const options = {
      startMonsterHp: monsterHp,
      startPlayerHp: member.currentHp,
      startRound: sharedRound,
      playerName: member.name,
      equipped: member.equipped,
      inventory: [],
      playerActiveEffects: [...(member.activeEffects || [])],
      partyEffects: nonHealPartyEffects,
      monsterEquipped: monster.equipment || {},
      monsterIsBoss: Boolean(monster.isBoss),
      monsterActiveEffects,
      stunRoundsLeft,
    };
    const result = runCombatLoop(
      effectiveStats,
      { ...mCalc, atk: 0, monsterAttackCount: 0 },
      monster.name,
      scaledHp,
      1,
      options,
    );
    monsterHp = result.finalMonsterHp;
    member.currentHp = Math.max(0, Math.round(result.finalPlayerHp));
    member.activeEffects = options.playerActiveEffects || [];
    monsterActiveEffects = result.monsterActiveEffects || [];
    stunRoundsLeft = Math.max(0, Number(result.stunRoundsLeft || 0));
    sharedRound = Math.max(sharedRound + 1, Number(result.nextRound || sharedRound + 1));
  }

  for (let i = 0; i < memberTemplates.length; i += 1) {
    memberTemplates[i].currentHp = members[i].currentHp;
    memberTemplates[i].maxHp = members[i].maxHp;
    memberTemplates[i].activeEffects = members[i].activeEffects || [];
  }

  return {
    killed: monsterHp <= 0,
    survived: members.some((m) => m.currentHp > 0),
    actions,
    monsterHp,
    scaledHp,
  };
}

function floorZone(floor) {
  if (floor <= 10) return "beginner";
  if (floor <= 20) return "normal";
  if (floor <= 30) return "mid";
  return "hard";
}

function pickFloorMonster(floor, pools, bossMap) {
  const bossName = BOSS_BY_FLOOR[floor];
  if (bossName && bossMap.get(bossName)) return bossMap.get(bossName);
  const pool = pools[floorZone(floor)] || [];
  if (!pool.length) return null;
  return pool[(floor - 1) % pool.length];
}

function buildMember(items, jobKey, index) {
  const cfg = JOB_CFG[jobKey];
  const job = items.find((item) => item.id === cfg.jobId);
  const weapon = pickItem(items, (item) => item.equipSlot === "weapon" && item.weaponType === cfg.main);
  const offhand = cfg.offhand
    ? pickItem(items, (item) => item.equipSlot === cfg.offhand)
    : null;
  assert(job, `${cfg.name} missing job badge`);
  assert(weapon, `${cfg.name} missing weapon ${cfg.main}`);

  const equipped = { weapon, job_eq: job };
  for (const slot of ARMOR_SLOTS) {
    const item = pickItem(items, (row) => row.itemType === "equipment" && row.equipSlot === slot);
    if (item) equipped[slot] = item;
  }
  if (offhand) equipped.shield = offhand;

  const stats = calcPlayerStats(getBaseStats(TEST_LEVEL), equipped, [], [], { pkRating: 1500 });
  return {
    id: `${jobKey}-${index}`,
    jobKey,
    name: `${cfg.name}${index + 1}`,
    stats,
    equipped,
    baseMaxHp: stats.maxHp,
    maxHp: stats.maxHp,
    currentHp: stats.maxHp,
    activeEffects: [],
  };
}

function runTower(party, items, pools, bossMap) {
  const members = party.jobs.map((jobKey, index) => buildMember(items, jobKey, index));
  let last = null;
  let cleared = 0;

  for (let floor = 1; floor <= TOWER_TOTAL_FLOORS; floor += 1) {
    const monster = pickFloorMonster(floor, pools, bossMap);
    if (!monster) {
      last = { floor, reason: "missing_monster" };
      break;
    }
    const result = fightFloor(members, monster, floor);
    last = { floor, monster: monster.name, ...result };
    if (!result.killed || !result.survived) break;
    cleared = floor;
  }

  return { cleared, last, reward: calcTowerReward(cleared, members.length) };
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB_NAME);

  const items = await db.collection("items").find({}).toArray();
  const monsters = await db.collection("monsters").find({ enabled: { $ne: false } }).toArray();
  const withCalc = monsters.map((monster) => ({ ...monster, calc: monsterCalc(monster) }));
  const pools = {};
  for (const zone of ["beginner", "normal", "mid", "hard"]) {
    pools[zone] = withCalc
      .filter((monster) => (monster.zone || "normal") === zone && !monster.isBoss)
      .sort((a, b) => Number(a.seq || 0) - Number(b.seq || 0) || Number(a.maxHp || 0) - Number(b.maxHp || 0));
  }
  const bossMap = new Map(withCalc.filter((monster) => monster.isBoss).map((monster) => [monster.name, monster]));

  console.log(`爬塔隊伍測試：Lv.${TEST_LEVEL} / ${TEST_TIER}階裝備 / 每隊 ${SIMS} 次 / DB=${db.databaseName}`);
  console.log("隊伍, 平均層數, 最好, 最差, 失敗點");

  for (const party of PARTIES) {
    const runs = [];
    for (let i = 0; i < SIMS; i += 1) {
      runs.push(runTower(party, items, pools, bossMap));
    }
    const floors = runs.map((run) => run.cleared);
    const avg = floors.reduce((sum, value) => sum + value, 0) / Math.max(1, floors.length);
    const best = Math.max(...floors);
    const worst = Math.min(...floors);
    const fail = runs[0].last
      ? `F${runs[0].last.floor} ${runs[0].last.monster || runs[0].last.reason} HP剩${Math.round(runs[0].last.monsterHp || 0)}/${Math.round(runs[0].last.scaledHp || 0)}`
      : "-";
    console.log(`${party.label}, ${avg.toFixed(1)}, ${best}, ${worst}, ${fail}`);
  }

  await client.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
