"use strict";
// 多等級×多裝備階級×多強化的爬塔突破點分析，複用 benchmark_tower_v2 的戰鬥邏輯
require("dotenv").config();
const { MongoClient } = require("mongodb");
const { runCombatLoop } = require("../src/shared/combatLoop");
const { calcPlayerStats } = require("../src/shared/combatStats");
const {
  getTowerFloorBuff, scaleTowerMonsterHp, scaleTowerMonsterAtk,
  getCumulativePartyBonus, TOWER_TOTAL_FLOORS, MAX_ROUNDS_PER_MEMBER,
} = require("../src/shared/towerConfig");
const { collectEquipmentEffects, applyEffectsToStats, isEffectConditionMet } = require("../src/shared/effectEngine");

const client = new MongoClient("mongodb://localhost:27017");
const SIMS = 15; // 每組跑15次取平均

const JOB_CFG = {
  swordsman:    { main: "sword_1h",  offhand: "shield",  enhStat: "str" },
  warrior:      { main: "axe_2h",   offhand: null,      enhStat: "str" },
  dwarf_warrior:{ main: "mace_1h",  offhand: "shield",  enhStat: "str" },
  mage:         { main: "staff_2h", offhand: null,      enhStat: "int" },
  healer:       { main: "staff_1h", offhand: "shield",  enhStat: "int" },
  archer:       { main: "bow",      offhand: null,      enhStat: "dex" },
  barrier_mage: { main: "staff_1h", offhand: "shield",  enhStat: "int" },
  tactician:    { main: "sword_1h", offhand: "shield",  enhStat: "str" },
  bard:         { main: "bow",      offhand: null,      enhStat: "dex" },
  rogue:        { main: "dagger",   offhand: null,      enhStat: "str" },
};

const JOB_NAME = {
  swordsman:"劍士", warrior:"戰士", dwarf_warrior:"矮人",
  mage:"法師", healer:"治療師", archer:"弓箭手",
  barrier_mage:"結界師", tactician:"軍師", bard:"詩人", rogue:"盜賊",
};

// 3 種代表性隊伍
const PARTIES = [
  { label: "均衡隊", jobs: ["swordsman","warrior","archer","mage","healer","barrier_mage"] },
  { label: "重攻隊", jobs: ["warrior","warrior","warrior","archer","mage","healer"] },
  { label: "坦奶隊", jobs: ["dwarf_warrior","dwarf_warrior","swordsman","healer","healer","barrier_mage"] },
];

// 測試組合
const TEST_CASES = [
  { tier: "D", enh: 0, lvs: [30, 35, 40] },
  { tier: "D", enh: 3, lvs: [30, 35, 40] },
  { tier: "C", enh: 0, lvs: [30, 35, 40] },
  { tier: "C", enh: 3, lvs: [30, 35, 40] },
  { tier: "C", enh: 6, lvs: [30, 35, 40] },
  { tier: "B", enh: 0, lvs: [30, 35, 40, 45] },
  { tier: "B", enh: 3, lvs: [30, 35, 40, 45] },
  { tier: "B", enh: 6, lvs: [30, 35, 40, 45, 50] },
  { tier: "A", enh: 0, lvs: [35, 40, 45, 50] },
  { tier: "A", enh: 3, lvs: [35, 40, 45, 50] },
  { tier: "A", enh: 6, lvs: [40, 45, 50] },
];

// 等級 → 屬性點（1 + (lv-1)*2 分配，各屬性盡量均等）
function getBaseStats(lv) {
  const total = 1 + (lv - 1) * 2;
  const base = Math.floor(total / 6);
  const rem  = total % 6;
  const stats = { str: base, agi: base, vit: base, int: base, dex: base, luk: base };
  const order = ["str","agi","vit","int","dex","luk"];
  for (let i = 0; i < rem; i++) stats[order[i]]++;
  return stats;
}

function applyEnhance(item, enhStat, level) {
  if (!item || level === 0) return item;
  const clone = JSON.parse(JSON.stringify(item));
  clone.enhanceLevel = level;
  if (!clone.equipStats) clone.equipStats = {};
  const slot = clone.equipSlot || "";
  if (slot === "weapon") {
    clone.equipStats[enhStat] = (Number(clone.equipStats[enhStat]) || 0) + level * 2;
  } else {
    const keys = Object.keys(clone.equipStats).filter(k => Number(clone.equipStats[k]) !== 0);
    if (keys.length > 0) {
      const perKey = Math.floor((level * 2) / keys.length);
      const extra  = (level * 2) % keys.length;
      keys.forEach((k, i) => {
        clone.equipStats[k] = (Number(clone.equipStats[k]) || 0) + perKey + (i < extra ? 1 : 0);
      });
    }
  }
  return clone;
}

// 複用 v2 的戰鬥函式
function buildPartyEffects(members) {
  const bestByJobAndKey = new Map();
  for (const m of members) {
    if (!m.equipped) continue;
    const ctx = { equipped: m.equipped, inventory: [] };
    const refs = collectEquipmentEffects(m.equipped, null, ctx);
    for (const r of refs) {
      if (!r || r.target !== "party" || !isEffectConditionMet(r, ctx)) continue;
      const k = `${m.jobKey}:${r.key}`;
      const cur = bestByJobAndKey.get(k);
      if (!cur || Number(r.params?.value||0) > Number(cur.params?.value||0))
        bestByJobAndKey.set(k, r);
    }
  }
  return [...bestByJobAndKey.values()];
}

function monsterAttack(members, mCalc, partyEffects) {
  const monsterHit = Math.min(100, Number(mCalc.hit || 80));
  const isCrit = Math.random() * 100 < (mCalc.critRate || 0);
  let damageRedPct = 0, critRedPct = 0;
  for (const pe of partyEffects) {
    const v = Number(pe.params?.value || 0);
    if (pe.key === "party_damage_reduction") damageRedPct = Math.max(damageRedPct, v);
    if (pe.key === "party_crit_damage_reduction") critRedPct = Math.max(critRedPct, v);
  }
  for (const m of members) {
    if (m.currentHp <= 0) continue;
    const eff = applyEffectsToStats(m.stats, m.activeEffects||[], { equipped: m.equipped, inventory: [] });
    const dodge = Math.min(95, Number(eff.dodge || 0));
    if (Math.random() * 100 < Math.max(0, dodge - monsterHit + 70)) continue;
    const defPct = Math.min(75, Number(eff.def || 0));
    let dmg = mCalc.atk * (1 - defPct / 100);
    if (isCrit) dmg *= Math.max(1, 1.5 - critRedPct / 100);
    dmg *= (1 - Math.min(90, damageRedPct) / 100);
    m.currentHp = Math.max(0, m.currentHp - Math.max(1, Math.round(dmg)));
  }
}

function applyHealing(members, partyEffects) {
  for (const m of members) {
    if (m.currentHp <= 0) continue;
    for (const pe of partyEffects) {
      if (pe.key !== "heal_over_time" && pe.key !== "party_heal") continue;
      const val = Number(pe.params?.value || 0);
      if (val <= 0) continue;
      const heal = pe.params?.mode === "flat" ? Math.round(val) : Math.round(m.maxHp * val / 100);
      m.currentHp = Math.min(m.maxHp, m.currentHp + heal);
    }
  }
}

function fightFloor(members, monster, floor) {
  const bonus    = getCumulativePartyBonus(floor);
  const scaledHp  = scaleTowerMonsterHp(monster.calc?.maxHp || monster.maxHp || 200, floor);
  const scaledAtk = scaleTowerMonsterAtk(monster.calc?.atk  || 20, floor);
  const mCalc = {
    atk: scaledAtk, def: monster.calc?.def ?? monster.def ?? 0,
    agi: monster.calc?.agi ?? monster.agi ?? 1, maxHp: scaledHp,
    dodge: monster.calc?.dodge ?? 0, hit: monster.calc?.hit ?? 80,
    critRate: monster.calc?.critRate ?? 0,
  };
  let monsterHp = scaledHp, monsterActiveEffects = [], stunLeft = 0, sharedRound = 1;
  const gauges = new Map();
  for (const m of members) gauges.set(m.id, 0);
  gauges.set("monster", 0);
  const maxSlices = Math.max(50, (members.length + 1) * 50);
  let actions = 0;

  while (monsterHp > 0 && members.some(m => m.currentHp > 0) && actions < maxSlices) {
    const partyEffects = buildPartyEffects(members);
    const alive = members.filter(m => m.currentHp > 0);
    const actors = [
      ...alive.map((m, idx) => ({
        type:"member", id:m.id, member:m,
        speed: 100 + Math.max(0, Number(m.stats.agi||0)), agi:m.stats.agi, idx,
      })),
      { type:"monster", id:"monster", speed: 100 + Math.max(0, Number(mCalc.agi||0)), agi:mCalc.agi, idx:999 },
    ];
    if (actors.length <= 1) break;
    const nextNeed = Math.min(...actors.map(a => (1000-(gauges.get(a.id)||0)) / Math.max(1,a.speed)));
    for (const a of actors) gauges.set(a.id, (gauges.get(a.id)||0) + a.speed * nextNeed);
    const ready = actors
      .filter(a => (gauges.get(a.id)||0) >= 999.999)
      .sort((a,b) => ((gauges.get(b.id)||0)-(gauges.get(a.id)||0)) || (b.agi-a.agi) || (a.idx-b.idx));
    const actor = ready[0];
    gauges.set(actor.id, (gauges.get(actor.id)||0) - 1000);
    actions++;

    if (actor.type === "monster") {
      if (stunLeft > 0) { stunLeft--; continue; }
      monsterAttack(members, mCalc, partyEffects);
      continue;
    }

    const m = actor.member;
    applyHealing(members, partyEffects);
    const nonHeal = partyEffects.filter(pe => pe.key !== "heal_over_time" && pe.key !== "party_heal");
    const effStats = { ...m.stats, atk: Math.round((m.stats.atk||10) * (1 + bonus.atkPct/100)), maxHp: m.maxHp };
    const opts = {
      startMonsterHp: monsterHp, startPlayerHp: m.currentHp, startRound: sharedRound,
      playerName: m.name, equipped: m.equipped, inventory: [],
      playerActiveEffects: Array.isArray(m.activeEffects) ? [...m.activeEffects] : [],
      partyEffects: nonHeal, monsterEquipped: monster.equipment || {},
      monsterIsBoss: Boolean(monster.isBoss), monsterActiveEffects, stunRoundsLeft: stunLeft,
    };
    const res = runCombatLoop(effStats, { ...mCalc, atk:0, monsterAttackCount:0 }, monster.name, scaledHp, 1, opts);
    monsterHp = res.finalMonsterHp;
    m.currentHp = Math.max(0, Math.round(res.finalPlayerHp));
    m.activeEffects = opts.playerActiveEffects;
    monsterActiveEffects = Array.isArray(res.monsterActiveEffects) ? res.monsterActiveEffects : [];
    stunLeft = Math.max(0, Number(res.stunRoundsLeft||0));
    sharedRound = Math.max(sharedRound+1, Number(res.nextRound||sharedRound+1));
  }
  return { killed: monsterHp <= 0, survived: members.some(m => m.currentHp > 0) };
}

function runTowerSim(memberTemplates, monsterList) {
  const bonus1 = getCumulativePartyBonus(1);
  const members = memberTemplates.map((t, i) => {
    const maxHp = Math.round((t.stats.maxHp||100) * (1 + bonus1.hpPct/100));
    return { ...t, id:`p${i}`, currentHp: maxHp, maxHp, activeEffects: [] };
  });
  let clearedFloor = 0;
  for (let floor = 1; floor <= TOWER_TOTAL_FLOORS; floor++) {
    const bonus = getCumulativePartyBonus(floor);
    for (const m of members) {
      const newMax = Math.round((m.stats.maxHp||100) * (1 + bonus.hpPct/100));
      if (newMax > m.maxHp) { m.currentHp = Math.min(newMax, m.currentHp + (newMax - m.maxHp)); m.maxHp = newMax; }
    }
    const monster = monsterList[floor - 1];
    if (!monster) break;
    const result = fightFloor(members, monster, floor);
    if (!result.killed || !result.survived) break;
    clearedFloor = floor;
  }
  return clearedFloor;
}

async function main() {
  await client.connect();
  const db = client.db("equipment_game");

  // Load items from DB
  const allItems = await db.collection("items").find({}).toArray();
  const badges   = allItems.filter(i => i.itemType === "job_badge");

  // Build badge map
  const badgeMap = {};
  for (const b of badges) {
    const id = String(b.id||"").toLowerCase(), name = String(b.name||"").toLowerCase();
    if (id.includes("barrier_mage")||name.includes("結界")) badgeMap.barrier_mage = b;
    else if (id.includes("dwarf")||name.includes("矮人")) badgeMap.dwarf_warrior = b;
    else if (id.includes("swordsman")||name.includes("劍士")) badgeMap.swordsman = b;
    else if (id.includes("warrior")||name.includes("戰士")) badgeMap.warrior = b;
    else if (id.includes("archer")||name.includes("弓箭手")) badgeMap.archer = b;
    else if (id.includes("tactician")||name.includes("軍師")) badgeMap.tactician = b;
    else if (id.includes("bard")||name.includes("詩人")) badgeMap.bard = b;
    else if (id.includes("healer")||name.includes("治療")) badgeMap.healer = b;
    else if (id.includes("mage")||name.includes("法師")&&!id.includes("barrier")) badgeMap.mage = b;
    else if (id.includes("rogue")||name.includes("盜賊")) badgeMap.rogue = b;
  }

  // Build weapon map by weaponType and tier
  function getWeapon(weaponType, tier) {
    return allItems.find(i =>
      i.equipSlot === "weapon" &&
      i.weaponType === weaponType &&
      i.tier === tier
    ) || allItems.find(i => i.equipSlot === "weapon" && i.weaponType === weaponType);
  }
  function getOffhand(slot, tier) {
    return allItems.find(i => i.equipSlot === slot && i.tier === tier)
        || allItems.find(i => i.equipSlot === slot);
  }
  // Build armor set by tier (one piece per slot)
  const ARMOR_SLOTS = ["head","face","body","back","feet","ring_l","ring_r"];
  function getArmorSet(tier) {
    const set = {};
    for (const slot of ARMOR_SLOTS) {
      set[slot] = allItems.find(i => i.equipSlot === slot && i.tier === tier && i.itemType === "equipment")
               || allItems.find(i => i.equipSlot === slot && i.itemType === "equipment");
    }
    return set;
  }

  // Monster list (same ordering as v2)
  const ZONE_ORDER = ["beginner","normal","mid","hard","elite"];
  const allMonsters = await db.collection("monsters").find({ disabled:{ $ne:true }}).toArray();
  const monsterList = [...allMonsters].sort((a,b) => {
    const za = ZONE_ORDER.indexOf(a.zone||"normal"), zb = ZONE_ORDER.indexOf(b.zone||"normal");
    if (za !== zb) return za - zb;
    if (!!a.isBoss !== !!b.isBoss) return a.isBoss ? 1 : -1;
    return (a.maxHp||0) - (b.maxHp||0);
  });

  // Header
  console.log("═".repeat(80));
  console.log("  爬塔突破點分析 ── 等級 × 裝備 × 強化 × 隊伍（各" + SIMS + "次模擬）");
  console.log("═".repeat(80));

  // Results table: key = "tier+enh_lv", value = { partyLabel: avgFloor }
  const TABLE = {}; // [testLabel][partyLabel] = avgFloor

  for (const tc of TEST_CASES) {
    for (const lv of tc.lvs) {
      const testLabel = `${tc.tier}+${tc.enh} Lv${lv}`;
      if (!TABLE[testLabel]) TABLE[testLabel] = {};

      for (const party of PARTIES) {
        const armorSet = getArmorSet(tc.tier);
        const memberTemplates = [];

        for (let i = 0; i < party.jobs.length; i++) {
          const jobKey = party.jobs[i];
          const cfg = JOB_CFG[jobKey];
          const badge = badgeMap[jobKey];
          const rawWeapon = getWeapon(cfg.main, tc.tier);
          const rawOffhand = cfg.offhand ? getOffhand(cfg.offhand === "shield" ? "shield" : "offhand_dagger", tc.tier) : null;
          if (!badge || !rawWeapon) continue;

          const weapon  = applyEnhance(rawWeapon,  cfg.enhStat, tc.enh);
          const offhand = rawOffhand ? applyEnhance(rawOffhand, cfg.enhStat, tc.enh) : null;
          const enhArmorSet = {};
          for (const [slot, item] of Object.entries(armorSet)) {
            if (item) enhArmorSet[slot] = applyEnhance(item, "vit", tc.enh);
          }

          const equipped = { weapon, job_eq: badge, ...enhArmorSet, ...(offhand ? { shield: offhand } : {}) };
          const baseStats = getBaseStats(lv);
          const stats = calcPlayerStats(baseStats, equipped, [], []);
          memberTemplates.push({ name: `${JOB_NAME[jobKey]}`, jobKey, stats, equipped });
        }

        if (memberTemplates.length < 6) {
          TABLE[testLabel][party.label] = "N/A";
          continue;
        }

        let total = 0;
        for (let s = 0; s < SIMS; s++) {
          total += runTowerSim(memberTemplates, monsterList);
        }
        TABLE[testLabel][party.label] = Math.round(total / SIMS * 10) / 10;
      }
    }
  }

  // Print table
  const partyLabels = PARTIES.map(p => p.label);
  const col0 = 16;
  const colW = 10;
  console.log("\n" + "裝備/等級".padEnd(col0) + partyLabels.map(l => l.padEnd(colW)).join(""));
  console.log("─".repeat(col0 + colW * partyLabels.length));

  let lastTierEnh = "";
  for (const [label, results] of Object.entries(TABLE)) {
    const tierEnh = label.split(" ")[0];
    if (tierEnh !== lastTierEnh) {
      console.log();
      lastTierEnh = tierEnh;
    }
    const row = label.padEnd(col0) + partyLabels.map(pl => {
      const v = results[pl];
      if (v === undefined || v === "N/A") return "  -     ".slice(0, colW);
      // Add visual marker for 35+ floors
      const num = Number(v);
      const mark = num >= 41 ? "★" : num >= 35 ? "◆" : num >= 30 ? "·" : " ";
      return (mark + String(v)).padEnd(colW);
    }).join("");
    console.log(row);
  }

  console.log("\n凡例：★=通關41層  ◆=達到35層以上  ·=達到30層以上");
  console.log("─".repeat(80));

  await client.close();
}

main().catch(console.error);
