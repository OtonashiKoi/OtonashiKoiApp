"use strict";

/**
 * 計算各職業傷害對比
 * 場景：35 等玩家（各屬性 50+30=80）穿 A 階裝備，打 Lv.35 怪物（DEF 60）
 * 執行：node scripts/calculate-job-damage-comparison.js
 */

// 簡化版傷害計算（基於 combatStats.js 和 combatLoop.js）
function calcPlayerStats(job, attributes = {}) {
  const { str = 80, agi = 80, vit = 80, int: INT = 80, dex = 80, luk = 80 } = attributes;

  const WEAPON_CONFIG = {
    sword_1h: { mult: 4, baseStat: "str" },
    sword_2h: { mult: 7, baseStat: "str" },
    axe_2h: { mult: 5, baseStat: "str", armorBreak: 15 },
    dagger: { mult: 2, baseStat: "str", comboBonus: 20 },
    mace_2h: { mult: 4, baseStat: "str", stunChance: 10 },
    staff_2h: { mult: 5, baseStat: "int", monsterAtk: 2, bypassDefPct: 35 },
    bow: { mult: 4, baseStat: "dex", isTwoHanded: true, dodgeBonus: 20 }
  };

  const jobConfigs = {
    swordsman: { weapon: "sword_1h", jobMult: 1.0, desc: "劍士（單手劍+盾）" },
    warrior: { weapon: "axe_2h", jobMult: 1.0, desc: "戰士（雙手斧）" },
    dwarf: { weapon: "mace_2h", jobMult: 1.0, desc: "矮人（雙手錘）" },
    rogue: { weapon: "dagger", jobMult: 1.0, desc: "盜賊（匕首）" },
    mage: { weapon: "staff_2h", jobMult: 1.15, desc: "法師（雙手法杖）" },
    archer: { weapon: "bow", jobMult: 1.2, desc: "弓箭手（弓）" }
  };

  const cfg = jobConfigs[job];
  const wCfg = WEAPON_CONFIG[cfg.weapon];
  const baseStat = wCfg.baseStat === "int" ? INT : wCfg.baseStat === "dex" ? dex : str;

  const atk = Math.round(baseStat * wCfg.mult * cfg.jobMult);
  const crit = Math.min(100, luk * 0.3);
  const combo = Math.min(80, 3 + agi * 0.5 + (wCfg.comboBonus || 0));
  const bypass = wCfg.bypassDefPct || 0;
  const armorBreak = wCfg.armorBreak || 0;

  return {
    job,
    desc: cfg.desc,
    atk,
    crit,
    combo,
    bypass,
    armorBreak,
    baseStat,
    weapon: cfg.weapon
  };
}

// 計算一次攻擊的傷害
function calcDamage(playerStats, monsterDef = 60, isCrit = false) {
  let { atk, bypass, baseStat } = playerStats;

  // 基礎傷害計算
  // defReduction = DEF * (100 - bypass) / 100
  const effectiveDef = monsterDef * (100 - bypass) / 100;
  const defReduction = Math.max(0, Math.min(75, effectiveDef * 2)); // DEF % 最多 75%

  // 基礎傷害 = ATK × (1 - DEF%)
  let baseDmg = Math.round(atk * (1 - defReduction / 100));

  // 傷害浮動 0.9 ~ 1.3
  let minDmg = Math.round(baseDmg * 0.9);
  let maxDmg = Math.round(baseDmg * 1.3);
  let avgDmg = Math.round((minDmg + maxDmg) / 2);

  // 爆擊傷害 ×2.5
  if (isCrit) {
    avgDmg = Math.round(avgDmg * 2.5);
    maxDmg = Math.round(maxDmg * 2.5);
  }

  return {
    min: minDmg,
    max: maxDmg,
    avg: avgDmg,
    baseDmg,
    defReduction
  };
}

async function main() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("職業傷害對比計算");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("\n【場景設定】");
  console.log("玩家：Lv.35，各屬性 80（50基礎 + 30 A階裝備加成）");
  console.log("怪物：Lv.35，DEF 60（精英區怪物）");
  console.log("武器：各職業最優配置、未強化\n");

  const jobs = ["swordsman", "warrior", "dwarf", "rogue", "mage", "archer"];
  const monsterDef = 60;
  const results = [];

  for (const job of jobs) {
    const stats = calcPlayerStats(job);
    const normalDmg = calcDamage(stats, monsterDef, false);
    const critDmg = calcDamage(stats, monsterDef, true);

    // 法師特殊機制：怪物攻擊 ×2，所以防禦實際加倍效果
    const adjustedDesc = job === "mage" ? `${stats.desc}（怪物攻擊×2）` : stats.desc;

    results.push({
      job,
      desc: adjustedDesc,
      atk: stats.atk,
      crit: stats.crit.toFixed(1),
      normal: normalDmg.avg,
      crit: critDmg.avg,
      defReduction: normalDmg.defReduction.toFixed(1)
    });
  }

  // 排序（按一般攻擊傷害從高到低）
  results.sort((a, b) => b.normal - a.normal);

  console.log("【傷害數據】");
  console.log("");
  let maxAtk = Math.max(...results.map(r => r.atk));
  let maxNormal = Math.max(...results.map(r => r.normal));

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const atkBar = "█".repeat(Math.round(r.atk / maxAtk * 20));
    const normalBar = "█".repeat(Math.round(r.normal / maxNormal * 20));

    console.log(`${i + 1}. ${r.desc}`);
    console.log(`   ATK: ${r.atk.toString().padStart(3)} ${atkBar} (爆擊率: ${r.crit}%)`);
    console.log(`   平常攻擊: ${r.normal.toString().padStart(4)} 傷害 ${normalBar}`);
    console.log(`   爆擊攻擊: ${r.crit.toString().padStart(4)} 傷害 (×2.5 倍率)`);
    console.log(`   怪物實際 DEF: ${r.defReduction}%（已扣除穿防）\n`);
  }

  // 統計
  console.log("【傷害排名】");
  console.log("");
  results.forEach((r, i) => {
    const diff = results[0].normal - r.normal;
    const diffPercent = ((diff / results[0].normal) * 100).toFixed(1);
    const status = i === 0 ? "🔴 最強" : i === results.length - 1 ? "🔵 最弱" : "⚪ 中等";
    console.log(`${status} ${r.desc.padEnd(20)} | 平攻 ${r.normal.toString().padStart(4)} (第一名低 ${diffPercent}%)`);
  });

  console.log("\n【特殊機制說明】");
  console.log("• 弓箭手：命中要害 +35%+DEX×0.45% → 有額外傷害加成（未計入此表）");
  console.log("• 戰士  ：低血量 HP<35% 時傷害 ×1.15（未計入此表）");
  console.log("• 盜賊  ：連擊率 +20%，每次連擊傷害 ×1.1（未計入此表）");
  console.log("• 矮人  ：高血量 HP>90% 時擊暈 +5%（未計入此表）");
  console.log("• 法師  ：無視怪物 DEF 35%，怪物攻擊 ×2（攻擊低但生存難）");
  console.log("• 劍士  ：盾格擋 20%，格擋反擊命中 +20%（防守優先）");
}

main().catch(console.error);
