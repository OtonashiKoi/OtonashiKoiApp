"use strict";
// 爬塔隊伍模擬腳本
// 模擬 10 種隊伍組合，每隊跑 20 次取平均，輸出通關層、獎勵估算
require("dotenv").config();
const { MongoClient } = require("mongodb");
const { runCombatLoop } = require("../src/shared/combatLoop");
const { calcPlayerStats } = require("../src/shared/combatStats");
const {
  getTowerFloorBuff, scaleTowerMonsterHp, scaleTowerMonsterAtk,
  getCumulativePartyBonus, calcTowerReward, getTowerClearBuff,
  TOWER_TOTAL_FLOORS,
} = require("../src/shared/towerConfig");
const { collectEquipmentEffects, applyEffectsToStats, isEffectConditionMet } = require("../src/shared/effectEngine");

const client = new MongoClient("mongodb://localhost:27017");

const SIMS = 20;         // 每隊跑幾次
const BASE_STATS = { str: 11, agi: 11, vit: 11, int: 11, dex: 10, luk: 10 };

// 10 種隊伍：[隊名, [成員職業陣列]]
const PARTY_CONFIGS = [
  ["純攻隊",         ["warrior", "warrior", "swordsman", "archer"]],
  ["攻坦各半",       ["swordsman", "dwarf_warrior", "warrior", "healer"]],
  ["四職業混搭",     ["swordsman", "mage", "archer", "healer"]],
  ["法師+結界",      ["mage", "mage", "barrier_mage", "healer"]],
  ["盜賊連擊隊",     ["rogue", "rogue", "archer", "bard"]],
  ["軍師指揮隊",     ["tactician", "swordsman", "warrior", "healer"]],
  ["支援光環隊",     ["healer", "barrier_mage", "bard", "tactician"]],
  ["六人滿員隊",     ["swordsman", "warrior", "mage", "archer", "healer", "barrier_mage"]],
  ["矮人霸佔隊",     ["dwarf_warrior", "dwarf_warrior", "dwarf_warrior", "healer"]],
  ["單人solo隊",     ["warrior"]],
];

// 職業對應武器
const JOB_WEAPON = {
  swordsman:    { main: "sword_1h",  offhand: "shield"         },
  warrior:      { main: "axe_2h",   offhand: null              },
  dwarf_warrior:{ main: "mace_1h",  offhand: "shield"          },
  rogue:        { main: "dagger",   offhand: "offhand_dagger"  },
  mage:         { main: "staff_2h", offhand: null              },
  healer:       { main: "staff_1h", offhand: "shield"          },
  archer:       { main: "bow",      offhand: null              },
  tactician:    { main: "sword_1h", offhand: "shield"          },
  bard:         { main: "bow",      offhand: null              },
  barrier_mage: { main: "staff_1h", offhand: "shield"          },
};

const JOB_NAME = {
  swordsman: "劍士", warrior: "戰士", dwarf_warrior: "矮人",
  rogue: "盜賊", mage: "法師", healer: "治療師",
  archer: "弓箭手", tactician: "軍師", bard: "詩人", barrier_mage: "結界師",
};

// ── 計算隊伍 party 光環 ────────────────────────────────────────
function buildPartyEffects(members) {
  const bestByJobAndKey = new Map();
  for (const m of members) {
    if (!m.equipped) continue;
    const ctx = { equipped: m.equipped, inventory: [] };
    const refs = collectEquipmentEffects(m.equipped, null, ctx);
    for (const r of refs) {
      if (!r || r.target !== "party" || !isEffectConditionMet(r, ctx)) continue;
      const jobKey = `${m.jobKey}:${r.key}`;
      const cur = bestByJobAndKey.get(jobKey);
      if (!cur || Number(r.params?.value || 0) > Number(cur.params?.value || 0))
        bestByJobAndKey.set(jobKey, r);
    }
  }
  return [...bestByJobAndKey.values()];
}

// ── 怪物攻擊（含迴避）─────────────────────────────────────────
function monsterAttack(members, mCalc, partyEffects) {
  const monsterHit = Math.min(100, Number(mCalc.hit || 80));
  const isCrit = Math.random() * 100 < (mCalc.critRate || 0);

  // party 防禦光環
  let damageRedPct = 0, critRedPct = 0;
  for (const pe of partyEffects) {
    const v = Number(pe.params?.value || 0);
    if (pe.key === "party_damage_reduction") damageRedPct = Math.max(damageRedPct, v);
    if (pe.key === "party_crit_damage_reduction") critRedPct = Math.max(critRedPct, v);
  }

  for (const m of members) {
    if (m.currentHp <= 0) continue;
    const effStats = applyEffectsToStats(m.stats, m.activeEffects || [], { equipped: m.equipped, inventory: [] });
    const dodge = Math.min(95, Number(effStats.dodge || 0));
    const miss = Math.max(0, dodge - monsterHit + 70);
    if (Math.random() * 100 < miss) continue;

    const defPct = Math.min(75, Number(effStats.def || 0));
    let dmg = mCalc.atk * (1 - defPct / 100);
    if (isCrit) dmg *= Math.max(1, 1.5 - critRedPct / 100);
    dmg *= (1 - Math.min(90, damageRedPct) / 100);
    m.currentHp = Math.max(0, m.currentHp - Math.max(1, Math.round(dmg)));
  }
}

// ── 治療師光環回血 ─────────────────────────────────────────────
function applyHealing(members, partyEffects) {
  for (const m of members) {
    if (m.currentHp <= 0) continue;
    for (const pe of partyEffects) {
      if (pe.key !== "heal_over_time" && pe.key !== "party_heal") continue;
      const val = Number(pe.params?.value || 0);
      if (val <= 0) continue;
      const heal = pe.params?.mode === "flat"
        ? Math.round(val)
        : Math.round(m.maxHp * (val / 100));
      m.currentHp = Math.min(m.maxHp, m.currentHp + heal);
    }
  }
}

// ── 模擬單層戰鬥 ───────────────────────────────────────────────
function fightFloor(members, monster, floor) {
  const bonus = getCumulativePartyBonus(floor);
  const scaledHp  = scaleTowerMonsterHp(monster.calc?.maxHp || monster.maxHp || 200, floor);
  const scaledAtk = scaleTowerMonsterAtk(monster.calc?.atk  || 20, floor);

  const mCalc = {
    atk: scaledAtk, def: monster.calc?.def ?? monster.def ?? 0,
    agi: monster.calc?.agi ?? monster.agi ?? 1,
    maxHp: scaledHp, dodge: monster.calc?.dodge ?? 0,
    hit: monster.calc?.hit ?? 80, critRate: monster.calc?.critRate ?? 0,
  };

  let monsterHp = scaledHp;
  let monsterActiveEffects = [];
  let stunLeft = 0;
  let sharedRound = 1;
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
        type: "member", id: m.id, member: m,
        speed: 100 + Math.max(0, Number(m.stats.agi || 0)), agi: m.stats.agi, idx,
      })),
      { type: "monster", id: "monster", speed: 100 + Math.max(0, Number(mCalc.agi || 0)), agi: mCalc.agi, idx: 999 },
    ];
    if (actors.length <= 1) break;

    const nextNeed = Math.min(...actors.map(a => (1000 - (gauges.get(a.id) || 0)) / Math.max(1, a.speed)));
    for (const a of actors) gauges.set(a.id, (gauges.get(a.id) || 0) + a.speed * nextNeed);
    const ready = actors
      .filter(a => (gauges.get(a.id) || 0) >= 999.999)
      .sort((a, b) => ((gauges.get(b.id)||0) - (gauges.get(a.id)||0)) || (b.agi - a.agi) || (a.idx - b.idx));
    const actor = ready[0];
    gauges.set(actor.id, (gauges.get(actor.id) || 0) - 1000);
    actions++;

    if (actor.type === "monster") {
      if (stunLeft > 0) { stunLeft--; continue; }
      monsterAttack(members, mCalc, partyEffects);
      continue;
    }

    const m = actor.member;
    applyHealing(members, partyEffects);
    const nonHealEffects = partyEffects.filter(pe => pe.key !== "heal_over_time" && pe.key !== "party_heal");
    const effStats = {
      ...m.stats,
      atk: Math.round((m.stats.atk || 10) * (1 + bonus.atkPct / 100)),
      maxHp: m.maxHp,
    };
    const opts = {
      startMonsterHp: monsterHp, startPlayerHp: m.currentHp, startRound: sharedRound,
      playerName: m.name, equipped: m.equipped, inventory: [],
      playerActiveEffects: Array.isArray(m.activeEffects) ? [...m.activeEffects] : [],
      partyEffects: nonHealEffects,
      monsterEquipped: monster.equipment || {},
      monsterIsBoss: Boolean(monster.isBoss),
      monsterActiveEffects, stunRoundsLeft: stunLeft,
    };
    const res = runCombatLoop(effStats, { ...mCalc, atk: 0, monsterAttackCount: 0 }, monster.name, scaledHp, 1, opts);
    monsterHp = res.finalMonsterHp;
    m.currentHp = Math.max(0, Math.round(res.finalPlayerHp));
    m.activeEffects = opts.playerActiveEffects;
    monsterActiveEffects = Array.isArray(res.monsterActiveEffects) ? res.monsterActiveEffects : [];
    stunLeft = Math.max(0, Number(res.stunRoundsLeft || 0));
    sharedRound = Math.max(sharedRound + 1, Number(res.nextRound || sharedRound + 1));
  }

  return { killed: monsterHp <= 0, survived: members.some(m => m.currentHp > 0) };
}

// ── 模擬一整場攻塔 ─────────────────────────────────────────────
function runTowerSim(memberTemplates, monsterList) {
  // 初始化成員（快照）
  const bonus1 = getCumulativePartyBonus(1);
  const members = memberTemplates.map((t, i) => {
    const maxHp = Math.round((t.stats.maxHp || 100) * (1 + bonus1.hpPct / 100));
    return { ...t, id: `p${i}`, currentHp: maxHp, maxHp, activeEffects: [] };
  });

  let clearedFloor = 0;

  for (let floor = 1; floor <= TOWER_TOTAL_FLOORS; floor++) {
    // 區段升級補血
    const bonus = getCumulativePartyBonus(floor);
    for (const m of members) {
      const newMax = Math.round((m.stats.maxHp || 100) * (1 + bonus.hpPct / 100));
      if (newMax > m.maxHp) {
        m.currentHp = Math.min(newMax, m.currentHp + (newMax - m.maxHp));
        m.maxHp = newMax;
      }
    }

    const monster = monsterList[floor - 1];
    if (!monster) break;

    const result = fightFloor(members, monster, floor);
    if (!result.killed || !result.survived) break;
    clearedFloor = floor;
  }

  return clearedFloor;
}

// ── 主程式 ─────────────────────────────────────────────────────
async function main() {
  await client.connect();
  const db = client.db("equipment_game");

  // 讀裝備
  const weaponItems = await db.collection("items").find({ tier: "B", equipSlot: "weapon" }).toArray();
  const weaponMap = {};
  for (const w of weaponItems) if (w.weaponType) weaponMap[w.weaponType] = w;

  const offhandItems = await db.collection("items").find({ tier: "B", equipSlot: "shield" }).toArray();
  const offhandMap = {};
  for (const o of offhandItems) offhandMap[o.weaponType || "shield"] = o;

  const armorSlots = ["armor", "head_top", "garment", "shoes", "accessory_l", "accessory_r"];
  const allArmor = await db.collection("items").find({ tier: "B", equipSlot: { $in: armorSlots } }).toArray();
  const armorSet = {};
  for (const it of allArmor) if (it.name.startsWith("鬥紋")) armorSet[it.equipSlot] = it;

  const badges = await db.collection("items").find({ itemType: "job_badge" }).toArray();
  const badgeMap = {};
  for (const b of badges) {
    const id = String(b.id || "").toLowerCase();
    const name = String(b.name || "").toLowerCase();
    if (id.includes("barrier_mage") || name.includes("結界")) badgeMap.barrier_mage = b;
    else if (id.includes("dwarf") || name.includes("矮人")) badgeMap.dwarf_warrior = b;
    else if (id.includes("swordsman") || name.includes("劍士")) badgeMap.swordsman = b;
    else if (id.includes("warrior") || name.includes("戰士")) badgeMap.warrior = b;
    else if (id.includes("archer") || name.includes("弓箭手")) badgeMap.archer = b;
    else if (id.includes("tactician") || name.includes("軍師")) badgeMap.tactician = b;
    else if (id.includes("bard") || name.includes("詩人")) badgeMap.bard = b;
    else if (id.includes("healer") || name.includes("治療")) badgeMap.healer = b;
    else if (id.includes("mage") || name.includes("法師")) badgeMap.mage = b;
    else if (id.includes("rogue") || name.includes("盜賊")) badgeMap.rogue = b;
  }

  // 怪物排序（照 towerHandlers 的 buildTowerMonsterList 邏輯）
  const ZONE_ORDER = ["beginner", "normal", "mid", "hard", "elite"];
  const allMonsters = await db.collection("monsters").find({ disabled: { $ne: true } }).toArray();
  const monsterList = [...allMonsters].sort((a, b) => {
    const za = ZONE_ORDER.indexOf(a.zone || "normal");
    const zb = ZONE_ORDER.indexOf(b.zone || "normal");
    if (za !== zb) return za - zb;
    if (!!a.isBoss !== !!b.isBoss) return a.isBoss ? 1 : -1;
    return (a.maxHp || 0) - (b.maxHp || 0);
  });

  // 顯示層怪物清單（前5層 + 幾個關鍵層）
  const keyFloors = [1, 5, 10, 15, 20, 25, 30, 35, 40, 41];
  console.log("\n── 關鍵層怪物 ──────────────────────────────────────");
  for (const f of keyFloors) {
    const m = monsterList[f - 1];
    if (!m) { console.log(`第 ${f} 層：（無怪物）`); continue; }
    const scaledHp  = scaleTowerMonsterHp(m.calc?.maxHp || m.maxHp || 200, f);
    const scaledAtk = scaleTowerMonsterAtk(m.calc?.atk  || 20, f);
    const buff = getTowerFloorBuff(f);
    console.log(`第${String(f).padStart(2)}層 ${buff.emoji} ${String(m.name || "?").padEnd(12)} HP:${String(scaledHp).padStart(6)}  ATK:${String(scaledAtk).padStart(5)}  區段:${buff.label}`);
  }

  // 獎勵公式說明
  console.log("\n── 獎勵公式 ─────────────────────────────────────────");
  console.log("  基礎：每層 金幣×150 + EXP×80");
  console.log("  里程碑加成：10層×1.0 / 20層×2.5 / 30層×5.0 / 40層×10.0 / 41層×20.0");
  console.log("  算法：gold = 150 × 通關層數 × 倍率（每人均分相同金額）");
  for (const floor of [10, 20, 25, 30, 40, 41]) {
    const r = calcTowerReward(floor);
    console.log(`  第${floor}層：💰 ${r.gold} 金  ✨ ${r.exp} EXP  ${r.bonusMsg || ""}`);
  }

  // 過關 Buff 說明
  console.log("\n── 過關 Buff（怪物區限定，30分/1小時）─────────────────");
  console.log("  第15層：ATK +5%（30分）");
  console.log("  第20層：ATK +7%（30分）");
  console.log("  第25層：ATK +10%（30分）");
  console.log("  第30層：ATK +10% + DEF +5%（1小時）");
  console.log("  第35層：ATK +12% + DEF +8%（1小時）");
  console.log("  第40層：ATK +15% + DEF +10%（1小時）");
  console.log("  第41層：ATK +15% + DEF +10% + MaxHP +15%（1小時）");

  console.log(`\n${"═".repeat(90)}`);
  console.log(`  爬塔隊伍模擬（B級裝備，${SIMS}次/隊）`);
  console.log(`${"═".repeat(90)}`);

  for (const [partyName, jobKeys] of PARTY_CONFIGS) {
    // 建成員模板
    const memberTemplates = [];
    for (let i = 0; i < jobKeys.length; i++) {
      const jobKey = jobKeys[i];
      const badge  = badgeMap[jobKey];
      const wpCfg  = JOB_WEAPON[jobKey] || { main: "sword_1h", offhand: null };
      const weapon = weaponMap[wpCfg.main];
      const offhand = wpCfg.offhand ? (offhandMap[wpCfg.offhand] || null) : null;
      if (!badge || !weapon) { console.log(`⚠️ 找不到 ${jobKey} 裝備`); continue; }
      const equipped = { weapon, job_eq: badge, ...armorSet, ...(offhand ? { shield: offhand } : {}) };
      const stats = calcPlayerStats(BASE_STATS, equipped, [], []);
      memberTemplates.push({
        name: `${JOB_NAME[jobKey] || jobKey}${i + 1}`,
        jobKey, stats, equipped,
      });
    }
    if (memberTemplates.length === 0) continue;

    // 跑模擬
    let totalCleared = 0;
    const floorDist = {};
    for (let s = 0; s < SIMS; s++) {
      const cleared = runTowerSim(memberTemplates, monsterList);
      totalCleared += cleared;
      floorDist[cleared] = (floorDist[cleared] || 0) + 1;
    }

    const avgFloor = (totalCleared / SIMS).toFixed(1);
    const bestFloor = Math.max(...Object.keys(floorDist).map(Number));
    const reward = calcTowerReward(Math.round(totalCleared / SIMS));
    const clearBuff = getTowerClearBuff(Math.round(totalCleared / SIMS));

    // 成員列表
    const memberStr = memberTemplates.map(m => JOB_NAME[m.jobKey] || m.jobKey).join("+");

    console.log(`\n【${partyName}】 (${memberStr})`);
    console.log(`  平均通關層：${avgFloor} 層  最佳：${bestFloor} 層`);
    console.log(`  獎勵（平均）：💰 金幣 ${reward.gold}  ✨ EXP ${reward.exp}${reward.bonusMsg ? "  " + reward.bonusMsg : ""}`);
    if (clearBuff) {
      console.log(`  過關Buff：⚡ ${clearBuff.label}（${clearBuff.durationSec >= 3600 ? "1小時" : "30分鐘"}）`);
    } else {
      console.log(`  過關Buff：なし（未達 15 層）`);
    }

    // 層數分布（簡化）
    const brackets = { "1-10": 0, "11-20": 0, "21-30": 0, "31-40": 0, "41(全通)": 0 };
    for (const [f, cnt] of Object.entries(floorDist)) {
      const fl = Number(f);
      if (fl <= 10) brackets["1-10"] += cnt;
      else if (fl <= 20) brackets["11-20"] += cnt;
      else if (fl <= 30) brackets["21-30"] += cnt;
      else if (fl <= 40) brackets["31-40"] += cnt;
      else brackets["41(全通)"] += cnt;
    }
    const distStr = Object.entries(brackets)
      .filter(([, c]) => c > 0)
      .map(([k, c]) => `${k}層:${Math.round(c / SIMS * 100)}%`)
      .join("  ");
    console.log(`  層數分布：${distStr}`);
  }
  console.log(`\n${"═".repeat(90)}`);
  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
