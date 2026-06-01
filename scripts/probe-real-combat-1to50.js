"use strict";

/**
 * Read-only probe: estimate solo Lv.1 -> Lv.50 using current combat/reward flow.
 *
 * Assumptions:
 * - Solo player, full damage credit on each monster kill.
 * - Uses the same zone route as the level gates.
 * - Uses a swordsman-style baseline build and level-appropriate basic gear.
 * - Monster selection is weighted by spawnRate.
 * - EXP/gold/drops are granted on kill; persistent monster HP means a kill may take
 *   multiple battle sessions.
 */
require("dotenv").config();

const { MongoClient } = require("mongodb");
const { calcPlayerStats } = require("../src/shared/combatStats");
const { runCombatLoop } = require("../src/shared/combatLoop");
const { expToNextLevel, MAX_LEVEL } = require("../src/shared/progression");
const { ZONE_BY_KEY } = require("../src/shared/zones");
const { getEquipmentTierSetBonuses } = require("../src/shared/equipmentTierSetBonuses");

const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/equipmentGame";
const dbName = process.env.MONGODB_DB_NAME || "equipmentGame";
const RUNS = Math.max(3, Number(process.env.RUNS || 24));
const OP_SECONDS = Math.max(0, Number(process.env.OP_SECONDS || 15));
const MAX_ROUNDS = 15;

const GOLD_POOL_RULE_BY_ZONE = {
  beginner: { minPerPlayer: 80 },
  normal: { minPerPlayer: 220 },
  mid: { minPerPlayer: 650 },
  hard: { minPerPlayer: 1200 },
  elite: { minPerPlayer: 6000 }
};

const ZONE_DAMAGE_SYNC_RULES = {
  beginner: { maxHpRatioPerBattle: 0.30 },
  normal: { maxHpRatioPerBattle: 0.45 }
};

const ENHANCE_GEM_IDS = {
  D: "72fde92d-e33f-42fb-8d86-2e811d03f84d",
  C: "556db9e1-b084-4b22-bab5-a66c2b586184",
  B: "8fdfa7d9-f0fa-4e6a-a291-703b1e354072",
  A: "a6ae293d-52fc-4af5-8770-891ddf842e35"
};

const ZONE_PARTICIPATION_GEM_TIER = {
  beginner: "D",
  normal: "D",
  mid: "C",
  hard: "B",
  elite: "A"
};
const GEM_PARTICIPATION_RATE = { D: 0.50, C: 0.50, B: 0.30, A: 0.30 };
const GEM_TIER_ORDER = ["D", "C", "B", "A"];
const RARE_TIERS = new Set(["A", "S", "SS", "SSR", "UR"]);

const JOB = {
  job: "劍士",
  badge: "劍士徽章",
  weapon: "單手劍",
  offhand: "盾",
  armorFlavor: "鬥紋",
  ratio: { str: 40, agi: 25, vit: 20, int: 1, dex: 8, luk: 6 }
};

const ARMOR_SLOTS = ["armor", "garment", "shoes", "head_top", "head_mid", "head_low", "accessory_l", "accessory_r"];
const WEAPON_MATERIAL = { D: "木製", C: "鐵製", B: "鋼製", A: "秘銀" };
const WEAPON_TYPE_NAME = { "單手劍": "單手劍", "盾": "盾" };
const ARMOR_NAMES = {
  D: { material: "布", slots: { armor: "衣", garment: "披風", shoes: "鞋", head_top: "帽", head_mid: "護目", head_low: "口罩", accessory_l: "戒指(左)", accessory_r: "戒指(右)" } },
  C: { material: "皮", slots: { armor: "甲", garment: "披風", shoes: "靴", head_top: "帽", head_mid: "護目", head_low: "口罩", accessory_l: "戒指(左)", accessory_r: "戒指(右)" } },
  B: { material: "鐵", slots: { armor: "甲", garment: "披風", shoes: "靴", head_top: "帽", head_mid: "護目", head_low: "口罩", accessory_l: "戒指(左)", accessory_r: "戒指(右)" } },
  A: { material: "秘銀", slots: { armor: "甲", garment: "披風", shoes: "靴", head_top: "帽", head_mid: "護目", head_low: "口罩", accessory_l: "戒指(左)", accessory_r: "戒指(右)" } }
};
const ACCESSORY_TIER_MATERIAL = { D: "銅", C: "鐵", B: "銀", A: "金" };

function tierForLevel(level) {
  if (level < 10) return "D";
  if (level < 20) return "C";
  if (level < 30) return "B";
  return "A";
}

function zoneForLevel(level) {
  if (level <= 3) return "beginner";
  if (level < 10) return "normal";
  if (level < 20) return "mid";
  if (level < 30) return "ancient_city";
  if (level < 40) return "ancient_city_deep";
  return "dragon_realm";
}

function scaleAttrs(ratio, total) {
  const sum = Object.values(ratio).reduce((a, b) => a + b, 0);
  const result = {};
  let allocated = 0;
  const keys = Object.keys(ratio);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (i === keys.length - 1) {
      result[k] = Math.max(1, total - allocated);
    } else {
      const v = Math.max(1, Math.round((ratio[k] / sum) * total));
      result[k] = v;
      allocated += v;
    }
  }
  return result;
}

function totalAttrForLevel(level) {
  return 6 + (level - 1) * 2;
}

function buildEquipped(tier, items, includeBadge) {
  const find = (name, tierFilter) => items.find((it) => it.name === name && (tierFilter == null || it.tier === tierFilter));
  const findBySlot = (slot, tierFilter, weaponType = null) => items.find((it) =>
    it.equipSlot === slot && (tierFilter == null || it.tier === tierFilter) && (weaponType == null || it.weaponType === weaponType));

  const equipped = {};
  const mat = WEAPON_MATERIAL[tier] || "鋼製";
  const weapon = find(`${mat}${WEAPON_TYPE_NAME[JOB.weapon]}`, tier) || findBySlot("weapon", tier);
  if (weapon) equipped.weapon = { ...weapon, itemId: weapon.id, itemName: weapon.name };
  const shield = find(`${mat}${WEAPON_TYPE_NAME[JOB.offhand]}`, tier) || findBySlot("shield", tier);
  if (shield) equipped.shield = { ...shield, itemId: shield.id, itemName: shield.name };

  for (const slot of ARMOR_SLOTS) {
    let piece = null;
    if (slot === "accessory_l" || slot === "accessory_r") {
      const accMat = ACCESSORY_TIER_MATERIAL[tier] || "銀";
      piece = find(`${JOB.armorFlavor}${accMat}戒指(${slot === "accessory_l" ? "左" : "右"})`, tier);
    } else {
      const armorMat = ARMOR_NAMES[tier]?.material || "鐵";
      const suffix = ARMOR_NAMES[tier]?.slots?.[slot] || "";
      piece = find(`${JOB.armorFlavor}${armorMat}${suffix}`, tier) || find(`${armorMat}${suffix}`, tier);
    }
    if (!piece) piece = findBySlot(slot, tier);
    if (piece) equipped[slot] = { ...piece, itemId: piece.id, itemName: piece.name };
  }

  if (includeBadge) {
    const badge = find(JOB.badge, null);
    if (badge) equipped.job_eq = { ...badge, itemId: badge.id, itemName: badge.name };
  }
  return equipped;
}

function buildMonsterCalc(m) {
  const level = Math.max(1, Number(m.level) || 1);
  const vit = Number(m.vit) || 0;
  const intStat = Number(m.int) || 0;
  return {
    maxHp: Math.max(1, Number(m.maxHp) || (level * 800 + vit * 200)),
    atk: (Number(m.str) || 1) * 3,
    def: Math.min(75, Math.max(0, Number(m.def) || 0)),
    flatDef: (typeof m.flatDef === "number") ? Math.max(0, m.flatDef) : level + vit,
    level,
    agi: Number(m.agi) || 1,
    int: intStat,
    dex: Number(m.dex) || 1,
    luk: Number(m.luk) || 0,
    dodge: Math.min(50, (Number(m.agi) || 1) * 0.5),
    hit: Math.min(100, 80 + (Number(m.dex) || 1)),
    critRate: Math.min(100, Math.round((Number(m.luk) || 0) * 0.3)),
    comboChance: Math.min(80, Math.round(3 + (Number(m.agi) || 1) * 0.5)),
    defIgnorePct: Number(m.defIgnorePct) || 0,
    isBoss: Boolean(m.isBoss),
    dmgMin: Math.min(1.0, 0.7 + intStat * 0.01),
    dmgMax: 1.0
  };
}

function battleSeconds(agi, rounds) {
  const baseDelay = 1500;
  const minDelay = 500;
  const capAgi = 40;
  const capped = Math.min(Math.max(1, Number(agi) || 1), capAgi);
  const tickDelay = Math.round(baseDelay - ((capped - 1) / (capAgi - 1)) * (baseDelay - minDelay));
  return (tickDelay * Math.max(1, rounds)) / 1000;
}

function effectiveDamage(zone, monsterMaxHp, startHp, rawDamage) {
  const rule = ZONE_DAMAGE_SYNC_RULES[zone];
  const damage = Math.max(0, Math.round(rawDamage || 0));
  if (!rule) return Math.min(damage, startHp);
  const cap = Math.max(1, Math.round(Math.max(1, monsterMaxHp) * Number(rule.maxHpRatioPerBattle || 1)));
  return Math.min(damage, cap, startHp);
}

function getDynamicGoldPoolFloor(zone, participantCount = 1) {
  const rule = GOLD_POOL_RULE_BY_ZONE[zone];
  if (!rule) return 0;
  return Math.round(Math.max(1, participantCount) * Math.max(0, Number(rule.minPerPlayer || 0)));
}

function getNextGemTier(tier) {
  const idx = GEM_TIER_ORDER.indexOf(String(tier || "").toUpperCase());
  if (idx < 0 || idx >= GEM_TIER_ORDER.length - 1) return null;
  return GEM_TIER_ORDER[idx + 1];
}

function participationGemTiers(zone, monster) {
  const base = ZONE_PARTICIPATION_GEM_TIER[zone] || "D";
  const tiers = [base];
  if (monster?.isBoss) {
    const next = getNextGemTier(base);
    if (next) tiers.push(next);
  }
  return tiers;
}

function isMonsterCardItem(item) {
  return !!(item && (item.equipSlot === "special" || item.slotType === "special_1" || item.monsterCardOf || item.monsterCardSkill));
}

function buildDropPool(monster, itemById) {
  const pool = Array.isArray(monster?.drops) ? monster.drops.map((d) => ({ ...d })) : [];
  const cardItemId = monster?.equipment?.special_1?.itemId || monster?.equipment?.special_1?.id || null;
  if (!cardItemId) return pool;
  const card = itemById.get(cardItemId);
  if (!isMonsterCardItem(card)) return pool;
  const idx = pool.findIndex((drop) => drop?.itemId === cardItemId);
  if (idx >= 0) {
    pool[idx] = { ...pool[idx], chance: 1, source: pool[idx].source || "monster_card" };
  } else {
    pool.push({ itemId: card.id, chance: 1, source: "monster_card" });
  }
  return pool;
}

function addCount(map, key, value) {
  map[key] = (map[key] || 0) + value;
}

function fmt(n, digits = 0) {
  return Number(n || 0).toLocaleString("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  });
}

function weightedAverage(rows, fn) {
  const total = rows.reduce((sum, row) => sum + row.weight, 0);
  if (total <= 0) return 0;
  return rows.reduce((sum, row) => sum + row.weight * fn(row), 0) / total;
}

async function main() {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  const db = client.db(dbName);
  const [monstersRaw, items] = await Promise.all([
    db.collection("monsters").find({ enabled: { $ne: false } }).toArray(),
    db.collection("items").find({}).toArray()
  ]);
  await client.close();

  const itemById = new Map(items.map((item) => [item.id, item]));
  const monsters = monstersRaw
    .filter((m) => !String(m._id || "").startsWith("monsterState:"))
    .filter((m) => (Number(m.level) || 0) > 0)
    .filter((m) => (Number(m.expReward) || 0) > 0);

  const cache = new Map();
  function evalMonster(level, monster) {
    const tier = tierForLevel(level);
    const zone = zoneForLevel(level);
    const key = `${level}:${monster.id || monster._id}`;
    if (cache.has(key)) return cache.get(key);

    const attrs = scaleAttrs(JOB.ratio, totalAttrForLevel(level));
    const equipped = buildEquipped(tier, items, level >= 10);
    const playerStats = calcPlayerStats(attrs, equipped, [], [], {});
    const mCalc = buildMonsterCalc(monster);
    let damage = 0;
    let rounds = 0;
    let deaths = 0;

    for (let i = 0; i < RUNS; i++) {
      const result = runCombatLoop(playerStats, mCalc, monster.name, mCalc.maxHp, MAX_ROUNDS, {
        playerLevel: level,
        equipped,
        inventory: [],
        monsterIsBoss: Boolean(monster.isBoss)
      });
      damage += effectiveDamage(zone, mCalc.maxHp, mCalc.maxHp, result.totalDamage || 0);
      rounds += result.roundLogs?.length || MAX_ROUNDS;
      if (result.outcome === "lose") deaths += 1;
    }

    const avgDamage = Math.max(1, damage / RUNS);
    const avgRounds = Math.max(1, rounds / RUNS);
    const sessionsPerKill = Math.max(1, Math.ceil(mCalc.maxHp / avgDamage));
    const systemSecondsPerSession = battleSeconds(playerStats.agi, avgRounds);
    const result = {
      level,
      zone,
      tier,
      monster,
      playerStats,
      sessionsPerKill,
      avgDamage,
      avgRounds,
      deathRate: deaths / RUNS,
      systemSecondsPerKill: sessionsPerKill * systemSecondsPerSession,
      humanSecondsPerKill: sessionsPerKill * (systemSecondsPerSession + OP_SECONDS),
      expPerKill: Number(monster.expReward) || 0,
      goldPerKill: Math.max(Number(monster.goldReward) || 0, getDynamicGoldPoolFloor(zone, 1))
    };
    cache.set(key, result);
    return result;
  }

  const totals = {
    expNeeded: 0,
    kills: 0,
    sessions: 0,
    systemSeconds: 0,
    humanSeconds: 0,
    gold: 0,
    equip: 0,
    cards: 0,
    gems: 0,
    byZone: {},
    equipByTier: {},
    cardsByTier: {},
    gemsByTier: {},
    deathSessions: 0
  };

  const levelRows = [];
  for (let level = 1; level < MAX_LEVEL; level++) {
    const zone = zoneForLevel(level);
    const zoneMonsters = monsters.filter((m) => m.zone === zone);
    if (!zoneMonsters.length) throw new Error(`No monsters found for zone ${zone}`);

    const rows = zoneMonsters.map((monster) => {
      const evaluated = evalMonster(level, monster);
      return { ...evaluated, weight: Math.max(1, Number(monster.spawnRate) || 10) };
    });
    const expPerKill = weightedAverage(rows, (row) => row.expPerKill);
    const need = expToNextLevel(level);
    const kills = need / Math.max(1, expPerKill);

    const sessionsPerKill = weightedAverage(rows, (row) => row.sessionsPerKill);
    const systemSecondsPerKill = weightedAverage(rows, (row) => row.systemSecondsPerKill);
    const humanSecondsPerKill = weightedAverage(rows, (row) => row.humanSecondsPerKill);
    const goldPerKill = weightedAverage(rows, (row) => row.goldPerKill);
    const deathRate = weightedAverage(rows, (row) => row.deathRate);

    const attrs = scaleAttrs(JOB.ratio, totalAttrForLevel(level));
    const equipped = buildEquipped(tierForLevel(level), items, level >= 10);
    const tierBonuses = getEquipmentTierSetBonuses(equipped);
    const dropPct = (Number(attrs.luk) || 0) * 0.1 + (Number(tierBonuses.dropPct) || 0);
    const dropMultiplier = 1 + dropPct / 100;
    const rareDropMultiplier = 1;

    let equipPerKill = 0;
    let cardPerKill = 0;
    let gemPerKill = 0;
    const equipTierPerKill = {};
    const cardTierPerKill = {};
    const gemTierPerKill = {};

    const totalWeight = rows.reduce((sum, row) => sum + row.weight, 0);
    for (const row of rows) {
      const monsterWeight = row.weight / totalWeight;
      const pool = buildDropPool(row.monster, itemById);
      for (const drop of pool) {
        const item = itemById.get(drop.itemId);
        if (!item) continue;
        const tier = String(item.tier || "?").toUpperCase();
        const isRare = RARE_TIERS.has(tier);
        const finalChance = Math.min(100, Math.max(0, Number(drop.chance) || 0) * dropMultiplier * (isRare ? rareDropMultiplier : 1));
        const expected = monsterWeight * finalChance / 100;
        if (isMonsterCardItem(item)) {
          cardPerKill += expected;
          addCount(cardTierPerKill, tier, expected);
        } else if (item.itemType === "equipment") {
          equipPerKill += expected;
          addCount(equipTierPerKill, tier, expected);
        }
      }

      for (const tier of participationGemTiers(zone, row.monster)) {
        const itemId = ENHANCE_GEM_IDS[tier];
        if (!itemId) continue;
        const rate = Math.min(1, (GEM_PARTICIPATION_RATE[tier] ?? 0.05) + dropPct / 100);
        const expected = monsterWeight * rate;
        gemPerKill += expected;
        addCount(gemTierPerKill, tier, expected);
      }
    }

    const levelResult = {
      level,
      next: level + 1,
      zone,
      need,
      kills,
      sessions: kills * sessionsPerKill,
      systemSeconds: kills * systemSecondsPerKill,
      humanSeconds: kills * humanSecondsPerKill,
      gold: kills * goldPerKill,
      equip: kills * equipPerKill,
      cards: kills * cardPerKill,
      gems: kills * gemPerKill,
      deathSessions: kills * sessionsPerKill * deathRate
    };
    levelRows.push(levelResult);

    totals.expNeeded += need;
    totals.kills += levelResult.kills;
    totals.sessions += levelResult.sessions;
    totals.systemSeconds += levelResult.systemSeconds;
    totals.humanSeconds += levelResult.humanSeconds;
    totals.gold += levelResult.gold;
    totals.equip += levelResult.equip;
    totals.cards += levelResult.cards;
    totals.gems += levelResult.gems;
    totals.deathSessions += levelResult.deathSessions;

    if (!totals.byZone[zone]) {
      totals.byZone[zone] = { kills: 0, sessions: 0, systemSeconds: 0, humanSeconds: 0, gold: 0, equip: 0, cards: 0, gems: 0 };
    }
    const z = totals.byZone[zone];
    z.kills += levelResult.kills;
    z.sessions += levelResult.sessions;
    z.systemSeconds += levelResult.systemSeconds;
    z.humanSeconds += levelResult.humanSeconds;
    z.gold += levelResult.gold;
    z.equip += levelResult.equip;
    z.cards += levelResult.cards;
    z.gems += levelResult.gems;

    for (const [tier, value] of Object.entries(equipTierPerKill)) addCount(totals.equipByTier, tier, value * kills);
    for (const [tier, value] of Object.entries(cardTierPerKill)) addCount(totals.cardsByTier, tier, value * kills);
    for (const [tier, value] of Object.entries(gemTierPerKill)) addCount(totals.gemsByTier, tier, value * kills);
  }

  console.log(`======== Real combat probe Lv.1 -> Lv.${MAX_LEVEL} ========`);
  console.log(`RUNS per monster-level: ${RUNS}`);
  console.log(`Build: ${JOB.job}, level-appropriate D/C/B/A baseline gear, solo`);
  console.log(`Operation overhead: +${OP_SECONDS}s per battle session`);
  console.log("");
  console.log(`Required EXP: ${fmt(totals.expNeeded)}`);
  console.log(`Monster kills: ${fmt(totals.kills)}`);
  console.log(`Battle sessions: ${fmt(totals.sessions)}`);
  console.log(`System time: ${(totals.systemSeconds / 3600).toFixed(1)} h`);
  console.log(`With operation time: ${(totals.humanSeconds / 3600).toFixed(1)} h`);
  console.log(`Days @1h/day: ${Math.ceil(totals.humanSeconds / 3600)} | @2h/day: ${Math.ceil(totals.humanSeconds / 7200)} | @3h/day: ${Math.ceil(totals.humanSeconds / 10800)}`);
  console.log(`Gold: ${fmt(totals.gold)}`);
  console.log(`Equipment drops: ${fmt(totals.equip, 1)} (${Object.entries(totals.equipByTier).map(([k, v]) => `${k}:${fmt(v, 1)}`).join(", ") || "-"})`);
  console.log(`Card drops: ${fmt(totals.cards, 2)} (${Object.entries(totals.cardsByTier).map(([k, v]) => `${k}:${fmt(v, 2)}`).join(", ") || "-"})`);
  console.log(`Participation gems: ${fmt(totals.gems, 1)} (${Object.entries(totals.gemsByTier).map(([k, v]) => `${k}:${fmt(v, 1)}`).join(", ") || "-"})`);
  console.log(`Expected death sessions: ${fmt(totals.deathSessions, 1)}`);
  console.log("");
  console.log("By zone:");
  for (const [zone, row] of Object.entries(totals.byZone)) {
    const label = ZONE_BY_KEY[zone]?.label || zone;
    console.log(`- ${label}(${zone}): kills ${fmt(row.kills)}, sessions ${fmt(row.sessions)}, time ${(row.humanSeconds / 3600).toFixed(1)}h, gold ${fmt(row.gold)}, equip ${fmt(row.equip, 1)}, cards ${fmt(row.cards, 2)}, gems ${fmt(row.gems, 1)}`);
  }
  console.log("");
  console.log("Milestones:");
  for (const maxLevel of [10, 20, 30, 40, 50]) {
    const rows = levelRows.filter((row) => row.next <= maxLevel);
    const sum = (field) => rows.reduce((s, row) => s + row[field], 0);
    console.log(`- Lv.${maxLevel}: time ${(sum("humanSeconds") / 3600).toFixed(1)}h, kills ${fmt(sum("kills"))}, gold ${fmt(sum("gold"))}, equip ${fmt(sum("equip"), 1)}, cards ${fmt(sum("cards"), 2)}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
