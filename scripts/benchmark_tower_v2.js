"use strict";
// 爬塔隊伍模擬 v2：6人隊，可用環境變數指定等級 / 階級 / 強化 / 次數
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
const SIMS = Math.max(1, Number(process.env.TOWER_BENCH_SIMS || 30));
const BENCH_LEVEL = Math.max(1, Number(process.env.TOWER_BENCH_LEVEL || 30));
const BENCH_TIER = String(process.env.TOWER_BENCH_TIER || "B").toUpperCase();
const BENCH_ENHANCE = Math.max(0, Number(process.env.TOWER_BENCH_ENHANCE || 3));
const PARTY_FILTER = process.env.TOWER_BENCH_PARTY_FILTER
  ? new RegExp(process.env.TOWER_BENCH_PARTY_FILTER)
  : null;

// 平均屬性：基礎1 + 每級2點，平均分配到6屬。
function getAverageBaseStats(level) {
  const total = Math.max(0, (level - 1) * 2);
  const per = Math.floor(total / 6);
  const rem = total % 6;
  return {
    str: 1 + per + (rem > 0 ? 1 : 0),
    agi: 1 + per + (rem > 1 ? 1 : 0),
    vit: 1 + per + (rem > 2 ? 1 : 0),
    int: 1 + per + (rem > 3 ? 1 : 0),
    dex: 1 + per + (rem > 4 ? 1 : 0),
    luk: 1 + per,
  };
}

const BASE_STATS = getAverageBaseStats(BENCH_LEVEL);

// 職業對應武器與偏好屬性（+3強化加主屬性+6）
const JOB_CFG = {
  swordsman:    { main: "sword_1h",  offhand: "shield",         enhStat: "str"  },
  warrior:      { main: "axe_2h",   offhand: null,             enhStat: "str"  },
  dwarf_warrior:{ main: "mace_1h",  offhand: "shield",         enhStat: "str"  },
  rogue:        { main: "dagger",   offhand: "offhand_dagger", enhStat: "str"  },
  mage:         { main: "staff_2h", offhand: null,             enhStat: "int"  },
  healer:       { main: "staff_1h", offhand: "shield",         enhStat: "int"  },
  archer:       { main: "bow",      offhand: null,             enhStat: "dex"  },
  tactician:    { main: "sword_1h", offhand: "shield",         enhStat: "str"  },
  bard:         { main: "bow",      offhand: null,             enhStat: "dex"  },
  barrier_mage: { main: "staff_1h", offhand: "shield",         enhStat: "int"  },
};

const JOB_NAME = {
  swordsman:"劍士", warrior:"戰士", dwarf_warrior:"矮人",
  rogue:"盜賊", mage:"法師", healer:"治療師",
  archer:"弓箭手", tactician:"軍師", bard:"詩人", barrier_mage:"結界師",
};

// 20 種 6 人隊伍
const PARTY_CONFIGS = [
  ["均衡標準隊",   ["swordsman","warrior","mage","archer","healer","barrier_mage"]],
  ["雙奶坦克隊",   ["dwarf_warrior","dwarf_warrior","swordsman","healer","healer","barrier_mage"]],
  ["三攻輸出隊",   ["warrior","warrior","archer","archer","mage","healer"]],
  ["全攻無奶隊",   ["warrior","warrior","swordsman","archer","mage","rogue"]],
  ["矮人鋼鐵隊",   ["dwarf_warrior","dwarf_warrior","dwarf_warrior","healer","barrier_mage","tactician"]],
  ["法師轟炸隊",   ["mage","mage","mage","healer","barrier_mage","tactician"]],
  ["盜賊刺客隊",   ["rogue","rogue","rogue","archer","bard","healer"]],
  ["軍師指揮隊",   ["tactician","swordsman","warrior","archer","healer","barrier_mage"]],
  ["詩人支援隊",   ["bard","bard","archer","archer","healer","barrier_mage"]],
  ["全輔0攻隊",    ["healer","healer","barrier_mage","barrier_mage","bard","tactician"]],
  ["劍士盾陣隊",   ["swordsman","swordsman","swordsman","healer","barrier_mage","tactician"]],
  ["弓箭暴雨隊",   ["archer","archer","archer","bard","healer","barrier_mage"]],
  ["混亂隨機隊A",  ["swordsman","mage","rogue","archer","bard","healer"]],
  ["混亂隨機隊B",  ["warrior","dwarf_warrior","mage","archer","tactician","healer"]],
  ["混亂隨機隊C",  ["rogue","rogue","mage","mage","healer","barrier_mage"]],
  ["雙職業光環",   ["tactician","bard","swordsman","warrior","healer","barrier_mage"]],
  ["近戰全家桶",   ["swordsman","warrior","dwarf_warrior","rogue","healer","barrier_mage"]],
  ["遠攻全家桶",   ["mage","mage","archer","archer","bard","healer"]],
  ["一奶帶五攻",   ["warrior","warrior","swordsman","archer","mage","healer"]],
  ["終極夢幻隊",   ["swordsman","warrior","mage","archer","healer","barrier_mage"]],
  // 終極夢幻隊跟均衡標準隊故意相同，用來驗證亂數穩定度
];

// ── 強化：每級約 +2 主屬性 / 裝備既有屬性分散加成 ─────────────────
function applyEnhance(item, enhStat, enhanceLevel = BENCH_ENHANCE) {
  if (!item) return item;
  const clone = JSON.parse(JSON.stringify(item));
  clone.enhanceLevel = enhanceLevel;
  if (!clone.equipStats) clone.equipStats = {};
  const slot = clone.equipSlot || "";
  if (slot === "weapon") {
    clone.equipStats[enhStat] = (Number(clone.equipStats[enhStat]) || 0) + enhanceLevel * 2;
  } else {
    const keys = Object.keys(clone.equipStats).filter(k => Number(clone.equipStats[k]) !== 0);
    if (keys.length > 0) {
      const totalBonus = enhanceLevel * 2;
      const perKey = Math.floor(totalBonus / keys.length);
      const extra  = totalBonus % keys.length;
      keys.forEach((k, i) => {
        clone.equipStats[k] = (Number(clone.equipStats[k]) || 0) + perKey + (i < extra ? 1 : 0);
      });
    }
  }
  return clone;
}

// ── party 光環 ─────────────────────────────────────────────────
// 與正式爬塔一致：只沿用裝備／職業徽章本來就有的一般隊伍光環，
// 不再注入或取代各職業的塔專屬光環。
function buildPartyEffects(members) {
  const bestByJobAndKey = new Map();
  for (const m of members) {
    if (!m.equipped || m.currentHp <= 0) continue;
    const ctx = { equipped: m.equipped, inventory: [] };
    const refs = collectEquipmentEffects(m.equipped, null, ctx);
    for (const r of refs) {
      if (!r || r.target !== "party" || !isEffectConditionMet(r, ctx)) continue;
      const k = `${m.jobKey}:${r.key}`;
      const cur = bestByJobAndKey.get(k);
      if (!cur || Number(r.params?.value||0) > Number(cur.params?.value||0))
        bestByJobAndKey.set(k, { ...r, sourceName: m.name, sourceJobName: JOB_NAME[m.jobKey] || m.jobKey });
    }
  }
  return [...bestByJobAndKey.values()];
}

function sumPartyEffectValue(partyEffects, key) {
  return partyEffects.reduce((sum, pe) => (
    pe?.key === key ? sum + Math.max(0, Number(pe.params?.value || 0)) : sum
  ), 0);
}

function getEffectiveMemberStats(member, partyEffects) {
  const eff = applyEffectsToStats(member.stats, member.activeEffects||[], { equipped: member.equipped, inventory: [] });
  const agiPct = sumPartyEffectValue(partyEffects, "party_agi_up");
  const stunAdd = sumPartyEffectValue(partyEffects, "party_stun_chance_up");
  if (agiPct > 0) eff.agi = Math.round(Number(eff.agi || 0) * (1 + agiPct / 100));
  if (stunAdd > 0) eff.stunChance = Math.min(100, Math.max(0, Number(eff.stunChance || 0) + stunAdd));
  return eff;
}

function calcMaxHp(member, floor, partyEffects) {
  const bonus = getCumulativePartyBonus(floor);
  const maxHpPct = sumPartyEffectValue(partyEffects, "party_max_hp_up");
  return Math.max(1, Math.round((member.stats.maxHp || 100) * (1 + bonus.hpPct / 100) * (1 + maxHpPct / 100)));
}

function monsterAttack(members, mCalc, partyEffects) {
  const monsterHit = Math.min(100, Number(mCalc.hit || 80));
  const isCrit = Math.random() * 100 < (mCalc.critRate || 0);
  let damageRedPct = 0, critRedPct = 0;
  for (const pe of partyEffects) {
    const v = Number(pe.params?.value || 0);
    if (pe.key === "party_damage_reduction") damageRedPct += Math.max(0, v);
    if (pe.key === "party_crit_damage_reduction") critRedPct += Math.max(0, v);
  }
  for (const m of members) {
    if (m.currentHp <= 0) continue;
    const eff = getEffectiveMemberStats(m, partyEffects);
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
      ...alive.map((m, idx) => {
        const eff = getEffectiveMemberStats(m, partyEffects);
        return {
          type:"member", id:m.id, member:m,
          speed: 100 + Math.max(0, Number(eff.agi||0)), agi:eff.agi, idx,
        };
      }),
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
      monsterIsBoss: Boolean(monster.isBoss),
      monsterIsElite: monster.zone === "elite",
      monsterActiveEffects,
      stunRoundsLeft: stunLeft,
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
  const members = memberTemplates.map((t, i) => {
    return { ...t, id:`p${i}`, currentHp: 1, maxHp: 1, activeEffects: [] };
  });
  const openingEffects = buildPartyEffects(members);
  for (const m of members) {
    m.maxHp = calcMaxHp(m, 1, openingEffects);
    m.currentHp = m.maxHp;
  }
  let clearedFloor = 0;
  for (let floor = 1; floor <= TOWER_TOTAL_FLOORS; floor++) {
    const partyEffects = buildPartyEffects(members);
    for (const m of members) {
      const oldMax = m.maxHp;
      const newMax = calcMaxHp(m, floor, partyEffects);
      m.maxHp = newMax;
      if (newMax > oldMax) m.currentHp = Math.min(newMax, m.currentHp + (newMax - oldMax));
      else m.currentHp = Math.min(m.currentHp, newMax);
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

  const weaponItems = await db.collection("items").find({ tier:BENCH_TIER, equipSlot:"weapon" }).toArray();
  const weaponMap = {};
  for (const w of weaponItems) if (w.weaponType) weaponMap[w.weaponType] = w;

  const offhandItems = await db.collection("items").find({ tier:BENCH_TIER, equipSlot:"shield" }).toArray();
  const offhandMap = {};
  for (const o of offhandItems) offhandMap[o.weaponType || "shield"] = o;

  const armorSlots = ["armor","head_top","garment","shoes","accessory_l","accessory_r"];
  const allArmor = await db.collection("items").find({ tier:BENCH_TIER, equipSlot:{ $in: armorSlots }}).toArray();
  const armorSet = {};
  for (const it of allArmor) if (it.name.startsWith("鬥紋")) armorSet[it.equipSlot] = it;

  const badges = await db.collection("items").find({ itemType:"job_badge" }).toArray();
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
    else if (id.includes("mage")||name.includes("法師")) badgeMap.mage = b;
    else if (id.includes("rogue")||name.includes("盜賊")) badgeMap.rogue = b;
  }

  const ZONE_ORDER = ["beginner","normal","mid","hard","elite"];
  const allMonsters = await db.collection("monsters").find({ disabled:{ $ne:true }}).toArray();
  const monsterList = [...allMonsters].sort((a,b) => {
    const za = ZONE_ORDER.indexOf(a.zone||"normal"), zb = ZONE_ORDER.indexOf(b.zone||"normal");
    if (za !== zb) return za - zb;
    if (!!a.isBoss !== !!b.isBoss) return a.isBoss ? 1 : -1;
    return (a.maxHp||0) - (b.maxHp||0);
  });

  console.log(`\n${"═".repeat(100)}`);
  console.log(`  爬塔隊伍模擬 v2 ── 6人隊 / Lv${BENCH_LEVEL} / ${BENCH_TIER}+${BENCH_ENHANCE} 裝備 / ${SIMS}次/隊`);
  console.log(`  屬性：STR/AGI/VIT/INT/DEX/LUK ≈ ${BASE_STATS.str}/${BASE_STATS.agi}/${BASE_STATS.vit}/${BASE_STATS.int}/${BASE_STATS.dex}/${BASE_STATS.luk} + 武器主屬性+${BENCH_ENHANCE * 2} + 防具分散強化`);
  console.log(`${"═".repeat(100)}`);

  const results = [];

  for (const [partyName, jobKeys] of PARTY_CONFIGS) {
    if (PARTY_FILTER && !PARTY_FILTER.test(partyName)) continue;
    const memberTemplates = [];
    for (let i = 0; i < jobKeys.length; i++) {
      const jobKey = jobKeys[i];
      const cfg    = JOB_CFG[jobKey] || { main:"sword_1h", offhand:null, enhStat:"str" };
      const badge  = badgeMap[jobKey];
      const rawWeapon  = weaponMap[cfg.main];
      const rawOffhand = cfg.offhand ? (offhandMap[cfg.offhand] || null) : null;
      if (!badge || !rawWeapon) { console.log(`⚠️ 找不到 ${jobKey}`); continue; }

      // 套 +3 強化
      const weapon  = applyEnhance(rawWeapon,  cfg.enhStat);
      const offhand = rawOffhand ? applyEnhance(rawOffhand, cfg.enhStat) : null;
      const enhArmorSet = {};
      for (const [slot, item] of Object.entries(armorSet)) {
        enhArmorSet[slot] = applyEnhance(item, cfg.enhStat);
      }

      const equipped = { weapon, job_eq: badge, ...enhArmorSet, ...(offhand ? { shield: offhand } : {}) };
      const stats = calcPlayerStats(BASE_STATS, equipped, [], []);
      memberTemplates.push({ name: `${JOB_NAME[jobKey]||jobKey}${i+1}`, jobKey, stats, equipped });
    }
    if (memberTemplates.length === 0) continue;

    // 顯示代表成員數值（取第一位）
    const rep = memberTemplates[0];

    let totalCleared = 0;
    const floorDist = {};
    for (let s = 0; s < SIMS; s++) {
      const cleared = runTowerSim(memberTemplates, monsterList);
      totalCleared += cleared;
      floorDist[cleared] = (floorDist[cleared] || 0) + 1;
    }

    const avgFloor  = totalCleared / SIMS;
    const bestFloor = Math.max(...Object.keys(floorDist).map(Number));
    const worstFloor = Math.min(...Object.keys(floorDist).map(Number));
    const reward    = calcTowerReward(Math.round(avgFloor));
    const clearBuff = getTowerClearBuff(Math.round(avgFloor));
    const memberStr = memberTemplates.map(m => JOB_NAME[m.jobKey]||m.jobKey).join("+");

    const brackets = { "≤10":0, "11-20":0, "21-30":0, "31-40":0, "41全通":0 };
    for (const [f, cnt] of Object.entries(floorDist)) {
      const fl = Number(f);
      if (fl <= 10) brackets["≤10"] += cnt;
      else if (fl <= 20) brackets["11-20"] += cnt;
      else if (fl <= 30) brackets["21-30"] += cnt;
      else if (fl <= 40) brackets["31-40"] += cnt;
      else brackets["41全通"] += cnt;
    }
    const distStr = Object.entries(brackets)
      .filter(([,c]) => c > 0)
      .map(([k,c]) => `${k}層:${Math.round(c/SIMS*100)}%`)
      .join("  ");

    results.push({ partyName, memberStr, avgFloor, bestFloor, worstFloor, reward, clearBuff, distStr,
      repAtk: rep.stats.atk, repHp: rep.stats.maxHp, repDef: rep.stats.def });
  }

  // 依平均層排序輸出
  results.sort((a,b) => b.avgFloor - a.avgFloor);

  let rank = 1;
  for (const r of results) {
    const buffStr = r.clearBuff
      ? `⚡ ${r.clearBuff.label}（${r.clearBuff.durationSec >= 3600 ? "1小時" : "30分"}）`
      : "無（未達15層）";
    console.log(`\n${rank++}. 【${r.partyName}】`);
    console.log(`   成員：${r.memberStr}`);
    console.log(`   代表ATK:${r.repAtk}  HP:${r.repHp}  DEF:${r.repDef.toFixed(0)}%`);
    console.log(`   平均層：${r.avgFloor.toFixed(1)}  最佳：${r.bestFloor}  最差：${r.worstFloor}`);
    console.log(`   個人獎勵：💰 ${r.reward.gold} 金  ✨ ${r.reward.exp} EXP${r.reward.bonusMsg ? "  " + r.reward.bonusMsg : ""}`);
    console.log(`   過關Buff：${buffStr}`);
    console.log(`   層數分布：${r.distStr}`);
  }

  console.log(`\n${"═".repeat(100)}`);
  console.log("  獎勵說明：每位成員「各自」拿到相同金額（非均分）");
  console.log("  過關Buff：怪物區限定，刷新不疊加");
  console.log(`${"═".repeat(100)}\n`);

  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
