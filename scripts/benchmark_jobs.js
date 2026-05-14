"use strict";
const { MongoClient } = require("mongodb");
const { runCombatLoop } = require("../src/shared/combatLoop");
const { calcPlayerStats } = require("../src/shared/combatStats");

const client = new MongoClient("mongodb://localhost:27017");

const SIMS = 500;
const MAX_ROUNDS = 25;

// 平均分配：64點÷6屬性，多4點補前4項
const BASE_STATS = { str: 11, agi: 11, vit: 11, int: 11, dex: 10, luk: 10 };

// 所有配法：[label, jobKey, mainWeaponType, offhandType]
const ALL_BUILDS = [
  // 劍士
  ["劍士 單手劍+盾",     "swordsman",     "sword_1h",  "shield"         ],
  ["劍士 單手劍+副手匕", "swordsman",     "sword_1h",  "offhand_dagger" ],
  ["劍士 雙手劍",        "swordsman",     "sword_2h",  null             ],
  // 戰士
  ["戰士 單手斧+盾",     "warrior",       "axe_1h",    "shield"         ],
  ["戰士 單手斧+副手匕", "warrior",       "axe_1h",    "offhand_dagger" ],
  ["戰士 雙手斧",        "warrior",       "axe_2h",    null             ],
  // 矮人戰士
  ["矮人 單手槌+盾",     "dwarf_warrior", "mace_1h",   "shield"         ],
  ["矮人 單手槌+副手匕", "dwarf_warrior", "mace_1h",   "offhand_dagger" ],
  ["矮人 雙手槌",        "dwarf_warrior", "mace_2h",   null             ],
  // 盜賊
  ["盜賊 匕首單持",      "rogue",         "dagger",    null             ],
  ["盜賊 雙持匕首",      "rogue",         "dagger",    "offhand_dagger" ],
  // 法師
  ["法師 單手杖+盾",     "mage",          "staff_1h",  "shield"         ],
  ["法師 雙手杖",        "mage",          "staff_2h",  null             ],
  // 治療師
  ["治療師 單手杖+盾",   "healer",        "staff_1h",  "shield"         ],
  ["治療師 雙手杖",      "healer",        "staff_2h",  null             ],
  // 弓箭手
  ["弓箭手 弓",          "archer",        "bow",       null             ],
  // 軍師
  ["軍師 單手劍+盾",     "tactician",     "sword_1h",  "shield"         ],
  ["軍師 單手劍",        "tactician",     "sword_1h",  null             ],
  // 詩人
  ["詩人 弓",            "bard",          "bow",       null             ],
  // 結界師
  ["結界師 單手杖+盾",   "barrier_mage",  "staff_1h",  "shield"         ],
  ["結界師 雙手杖",      "barrier_mage",  "staff_2h",  null             ],
];

function parseSkillTriggers(roundLogs) {
  const counts = {};
  for (const log of roundLogs) {
    for (const m of log.matchAll(/發動【(.+?)】/g)) {
      counts[m[1]] = (counts[m[1]] || 0) + 1;
    }
  }
  return counts;
}

function parseProcTriggers(roundLogs) {
  let poison = 0, burn = 0, paralyze = 0, freeze = 0, stun = 0, weakSpot = 0;
  for (const log of roundLogs) {
    if (log.includes("匕首淬毒") || log.includes("中毒持續")) poison++;
    if (log.includes("被燒傷")) burn++;
    if (log.includes("被麻痺")) paralyze++;
    if (log.includes("被冰凍")) freeze++;
    if (log.includes("😵") || log.includes("被重擊擊暈")) stun++;
    if (log.includes("命中要害")) weakSpot++;
  }
  return { poison, burn, paralyze, freeze, stun, weakSpot };
}

async function main() {
  await client.connect();
  const db = client.db("equipment_game");

  // B 級武器
  const weaponItems = await db.collection("items").find({ tier: "B", equipSlot: "weapon" }).toArray();
  const weaponMap = {};
  for (const w of weaponItems) { if (w.weaponType) weaponMap[w.weaponType] = w; }

  // B 級副手（shield slot）
  const offhandItems = await db.collection("items").find({ tier: "B", equipSlot: "shield" }).toArray();
  const offhandMap = {};
  for (const o of offhandItems) { offhandMap[o.weaponType || "shield"] = o; }

  // 統一防具：鬥紋 B 套（最通用，所有職業同一套）
  const armorSlots = ["armor", "head_top", "garment", "shoes", "accessory_l", "accessory_r"];
  const allArmor = await db.collection("items").find({ tier: "B", equipSlot: { $in: armorSlots } }).toArray();
  const armorSet = {};
  for (const it of allArmor) {
    if (it.name.startsWith("鬥紋")) armorSet[it.equipSlot] = it;
  }

  // 職業徽章
  const badges = await db.collection("items").find({ itemType: "job_badge" }).toArray();
  const badgeMap = {};
  for (const b of badges) {
    const id = String(b.id || b._id || "").toLowerCase();
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

  // 怪物
  const monster = await db.collection("monsters").findOne({
    zone: "hard", isBoss: false, level: { $gte: 20, $lte: 22 }, name: { $not: /城牆|石像/ }
  });
  if (!monster) { console.error("找不到怪物"); process.exit(1); }

  const mCalc = {
    maxHp: monster.maxHp,
    atk: Math.round((monster.str || 10) * 3),
    def: monster.def || 15,
    dodge: Math.min(50, (monster.agi || 5) * 0.5),
    hit: 80 + (monster.dex || 5),
    crit: (monster.luk || 1) * 0.3,
    combo: 3 + (monster.agi || 5) * 0.5,
    comboChance: 3 + (monster.agi || 5) * 0.5,
  };

  console.log(`\n${"═".repeat(110)}`);
  console.log(`  平均屬性測試 STR/AGI/VIT/INT/DEX/LUK = 11/11/11/11/10/10（共64點）`);
  console.log(`  統一防具：鬥紋B套 | 武器+徽章為唯一變因 | ${SIMS} 次/配法 | MAX ${MAX_ROUNDS} 回合`);
  console.log(`  怪物：${monster.name} | HP: ${mCalc.maxHp} | ATK: ${mCalc.atk} | DEF: ${mCalc.def}%`);
  console.log(`${"═".repeat(110)}`);

  const results = [];

  for (const [label, jobKey, mainWpnType, offhandType] of ALL_BUILDS) {
    const badge = badgeMap[jobKey];
    const weapon = weaponMap[mainWpnType];
    if (!badge || !weapon) { console.log(`⚠️ 找不到 ${label}`); continue; }

    const offhand = offhandType ? offhandMap[offhandType] : null;
    const equipped = { weapon, job_eq: badge, ...armorSet, ...(offhand ? { shield: offhand } : {}) };
    const pStats = calcPlayerStats(BASE_STATS, equipped, [], []);

    let wins = 0, losses = 0, timeouts = 0;
    let totalRounds = 0, totalDmg = 0, totalFinalHp = 0;
    const skillCountTotal = {};
    const procTotals = { poison: 0, burn: 0, paralyze: 0, freeze: 0, stun: 0, weakSpot: 0 };

    for (let i = 0; i < SIMS; i++) {
      const result = runCombatLoop(
        pStats, mCalc, monster.name, mCalc.maxHp, MAX_ROUNDS,
        { equipped, monsterEquipped: monster.equipment || {}, monsterActiveEffects: [] }
      );
      if (result.outcome === "win") wins++;
      else if (result.outcome === "lose") losses++;
      else timeouts++;

      totalRounds += result.roundLogs.length;
      totalDmg += result.totalDamage || 0;
      totalFinalHp += result.finalPlayerHp || 0;

      const triggers = parseSkillTriggers(result.roundLogs);
      for (const [name, cnt] of Object.entries(triggers)) {
        skillCountTotal[name] = (skillCountTotal[name] || 0) + cnt;
      }
      const procs = parseProcTriggers(result.roundLogs);
      for (const k of Object.keys(procTotals)) procTotals[k] += procs[k];
    }

    const jobSkillNames = (badge.jobSkills || []).map(s => s.name);
    const skillParts = Object.entries(skillCountTotal)
      .filter(([n]) => jobSkillNames.includes(n))
      .sort((a, b) => b[1] - a[1])
      .map(([n, c]) => `${n}:${(c/SIMS).toFixed(1)}`);

    const procParts = [];
    if (procTotals.poison   > 0) procParts.push(`☠️${(procTotals.poison/SIMS).toFixed(1)}`);
    if (procTotals.burn     > 0) procParts.push(`🔥${(procTotals.burn/SIMS).toFixed(1)}`);
    if (procTotals.paralyze > 0) procParts.push(`⚡${(procTotals.paralyze/SIMS).toFixed(1)}`);
    if (procTotals.freeze   > 0) procParts.push(`❄️${(procTotals.freeze/SIMS).toFixed(1)}`);
    if (procTotals.stun     > 0) procParts.push(`😵${(procTotals.stun/SIMS).toFixed(1)}`);
    if (procTotals.weakSpot > 0) procParts.push(`🎯${(procTotals.weakSpot/SIMS).toFixed(1)}`);

    const winRate      = wins / SIMS * 100;
    const survivalRate = (wins + timeouts) / SIMS * 100;
    const avgRounds    = totalRounds / SIMS;
    const avgDmg       = Math.round(totalDmg / SIMS);
    const avgFinalHp   = Math.round(totalFinalHp / SIMS);

    results.push({ label, jobKey, winRate, survivalRate, avgRounds, avgDmg, avgFinalHp,
      atk: pStats.atk, def: pStats.def, crit: pStats.crit, hp: pStats.maxHp, combo: pStats.combo,
      skillParts, procParts, wins, losses, timeouts });

    const extra = [...skillParts, ...procParts].join("  ");
    console.log(
      `${label.padEnd(18)}` +
      ` ATK:${String(pStats.atk).padStart(4)} DEF:${pStats.def.toFixed(0).padStart(2)}% 爆:${pStats.crit.toFixed(1).padStart(5)}% 連:${pStats.combo.toFixed(0).padStart(2)}% HP:${pStats.maxHp}` +
      `  勝:${winRate.toFixed(0).padStart(3)}% 生存:${survivalRate.toFixed(0).padStart(3)}%  傷:${avgDmg.toLocaleString().padStart(7)}  HP剩:${avgFinalHp.toLocaleString().padStart(5)}`
    );
    if (extra) console.log(`${"".padEnd(18)}  ${extra}`);
  }

  // ─── 排行榜 ───
  console.log(`\n${"═".repeat(110)}`);
  console.log("【平均傷害排行】");
  [...results].sort((a, b) => b.avgDmg - a.avgDmg).forEach((r, i) => {
    const bar = "█".repeat(Math.min(35, Math.round(r.avgDmg / 400)));
    console.log(`  ${String(i+1).padStart(2)}. ${r.label.padEnd(18)} 傷害:${r.avgDmg.toLocaleString().padStart(7)}  生存:${r.survivalRate.toFixed(0).padStart(3)}%  ${bar}`);
  });

  console.log("\n【生存率排行（傷害作次排）】");
  [...results].sort((a, b) => b.survivalRate - a.survivalRate || b.avgDmg - a.avgDmg).forEach((r, i) => {
    const bar = "█".repeat(Math.round(r.survivalRate / 5));
    console.log(`  ${String(i+1).padStart(2)}. ${r.label.padEnd(18)} 生存:${r.survivalRate.toFixed(0).padStart(3)}%  傷害:${r.avgDmg.toLocaleString().padStart(7)}  ${bar}`);
  });

  await client.close();
}

main().catch(console.error);
