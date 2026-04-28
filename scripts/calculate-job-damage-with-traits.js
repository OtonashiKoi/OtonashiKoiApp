"use strict";

/**
 * 完整職業傷害對比（包含徽章特性 + 概率）
 * 場景：35 等玩家（各屬性 80）穿 A 階裝備，打 Lv.35 怪物（DEF 60）
 * 執行：node scripts/calculate-job-damage-with-traits.js
 */

function calcPlayerStats(job, attributes = {}) {
  const { str = 80, agi = 80, vit = 80, int: INT = 80, dex = 80, luk = 80 } = attributes;

  const WEAPON_CONFIG = {
    sword_1h: { mult: 4, baseStat: "str" },
    sword_2h: { mult: 7, baseStat: "str" },
    axe_1h: { mult: 3, baseStat: "str", armorBreak: 15, critBonus: 10 },
    axe_2h: { mult: 5, baseStat: "str", armorBreak: 15, critBonus: 20 },
    dagger: { mult: 2, baseStat: "str", comboBonus: 20 },
    mace_2h: { mult: 4, baseStat: "str", stunChance: 10 },
    staff_1h: { mult: 3, baseStat: "int", monsterAtk: 2, bypassDefPct: 15 },
    staff_2h: { mult: 4, baseStat: "int", monsterAtk: 2, bypassDefPct: 25 },
    bow: { mult: 4, baseStat: "dex", isTwoHanded: true, dodgeBonus: 20 }
  };

  const jobConfigs = {
    swordsman: { weapon: "sword_1h", jobMult: 1.0, shield: true },
    warrior: { weapon: "axe_2h", jobMult: 1.0 },
    dwarf: { weapon: "mace_2h", jobMult: 1.0 },
    rogue: { weapon: "dagger", jobMult: 1.0 },
    mage: { weapon: "staff_2h", jobMult: 1.15, baseBypass: 25 },
    archer: { weapon: "bow", jobMult: 1.2 }
  };

  const cfg = jobConfigs[job];
  const wCfg = WEAPON_CONFIG[cfg.weapon];
  const baseStat = wCfg.baseStat === "int" ? INT : wCfg.baseStat === "dex" ? dex : str;

  const atk = Math.round(baseStat * wCfg.mult * cfg.jobMult);
  const crit = Math.min(100, luk * 0.3 + (wCfg.critBonus || 0));
  const combo = Math.min(80, 3 + agi * 0.5 + (wCfg.comboBonus || 0));
  const dodge = Math.min(50, agi * 0.5) + (wCfg.dodgeBonus || 0);
  const stun = (wCfg.stunChance || 0);
  const bypass = wCfg.bypassDefPct || 0;

  return {
    atk, crit, combo, dodge, stun, bypass, str, agi, vit, int: INT, dex, luk
  };
}

function calcBaseDamage(atk, monsterDef = 60, bypass = 0) {
  const effectiveDef = monsterDef * (100 - bypass) / 100;
  const defReduction = Math.max(0, Math.min(75, effectiveDef * 2));
  const baseDmg = Math.round(atk * (1 - defReduction / 100));
  const minDmg = Math.round(baseDmg * 0.9);
  const maxDmg = Math.round(baseDmg * 1.3);
  return {
    min: minDmg,
    max: maxDmg,
    avg: Math.round((minDmg + maxDmg) / 2)
  };
}

function calcJobDamage(job, stats, monsterDef = 60) {
  const base = calcBaseDamage(stats.atk, monsterDef, stats.bypass);
  const baseDamagePerRound = [];

  switch (job) {
    case "swordsman": {
      // 劍士：20% 格擋反擊，命中 +20%
      // 假設戰鬥中：80% 打到怪物，其中 20% 被格擋但反擊成功
      const normalHit = base.avg * 0.8; // 80% 正常傷害
      const blockCounter = base.avg * 0.2 * 0.9; // 20% 被格擋，其中 90% 反擊成功（命中+20%）
      const avgPerRound = normalHit + blockCounter;
      return {
        desc: "劍士（單手劍+盾）",
        baseNormalDmg: base.avg,
        baseCritDmg: Math.round(base.avg * 2.5),
        normalDmgPerRound: Math.round(avgPerRound),
        critDmgPerRound: Math.round(avgPerRound * 2.5),
        traits: [
          `格擋機率: 20%（傷害降至 1）`,
          `格擋反擊: 成功命中傷害 = 基礎傷害`,
          `實際每回合傷害: ${Math.round(avgPerRound)} (含格擋與反擊)`
        ]
      };
    }

    case "warrior": {
      // 戰士：低血 <35% 時傷害 ×1.15
      // 假設戰鬥中平均 20% 時間在低血狀態
      const normalDmg = base.avg;
      const lowHpDmg = Math.round(base.avg * 1.15);
      const avgPerRound = normalDmg * 0.8 + lowHpDmg * 0.2;
      return {
        desc: "戰士（雙手斧）",
        baseNormalDmg: normalDmg,
        baseCritDmg: Math.round(normalDmg * 2.5),
        normalDmgPerRound: Math.round(avgPerRound),
        critDmgPerRound: Math.round(avgPerRound * 2.5),
        traits: [
          `破防機率: 15%（此次攻擊無視怪物 DEF）`,
          `低血傷害倍增: HP <35% 時傷害 ×1.15`,
          `假設低血時間占比 20%，實際每回合傷害: ${Math.round(avgPerRound)}`
        ]
      };
    }

    case "dwarf": {
      // 矮人：高血 >90% 時擊暈 +5%（基礎 10%）
      // 擊暈後怪物 3 回合無法攻擊，等於傷害提升
      const stunChance = Math.min(100, 10 + 5); // 15%
      const stunValue = stunChance / 100; // 佔比
      const damageBoost = stunValue * 3; // 3 回合無怪物傷害
      const avgPerRound = base.avg * (1 + damageBoost / 4); // 分攤到 4 回合
      return {
        desc: "矮人（雙手錘）",
        baseNormalDmg: base.avg,
        baseCritDmg: Math.round(base.avg * 2.5),
        normalDmgPerRound: Math.round(avgPerRound),
        critDmgPerRound: Math.round(avgPerRound * 2.5),
        traits: [
          `擊暈機率: 15% (基礎 10% + 高血 +5%)`,
          `擊暈效果: 怪物 3 回合無法攻擊`,
          `實際每回合傷害: ${Math.round(avgPerRound)} (含防守效益)`
        ]
      };
    }

    case "rogue": {
      // 盜賊：連擊率 63%，連擊傷害 ×1.1
      // 實際傷害 = 100% 正常 + 63% 連擊
      const comboChance = Math.min(80, 3 + stats.agi * 0.5 + 20); // 63%
      const comboDmg = Math.round(base.avg * 1.1);
      const avgPerRound = base.avg + (comboDmg * comboChance / 100);
      return {
        desc: "盜賊（匕首）",
        baseNormalDmg: base.avg,
        baseCritDmg: Math.round(base.avg * 2.5),
        normalDmgPerRound: Math.round(avgPerRound),
        critDmgPerRound: Math.round(avgPerRound * 2.5),
        traits: [
          `連擊率: ${comboChance.toFixed(1)}% (基礎 3% + AGI×0.5 + 匕首 20%)`,
          `連擊傷害: ${comboDmg} (基礎傷害 ×1.1)`,
          `實際每回合傷害: ${Math.round(avgPerRound)} (包含連擊)`
        ]
      };
    }

    case "mage": {
      // 法師：穿防 35%，怪物攻擊 ×2（防守負擔）
      // 無視 DEF 會顯著提升傷害
      const baseMage = calcBaseDamage(stats.atk, monsterDef, 35);
      const damageIncrease = ((baseMage.avg - base.avg) / base.avg * 100).toFixed(1);
      return {
        desc: "法師（雙手法杖）",
        baseNormalDmg: baseMage.avg,
        baseCritDmg: Math.round(baseMage.avg * 2.5),
        normalDmgPerRound: baseMage.avg,
        critDmgPerRound: Math.round(baseMage.avg * 2.5),
        traits: [
          `無視怪物 DEF: 35%（傷害提升 ${damageIncrease}%）`,
          `怪物攻擊次數: ×2（生存難度增加）`,
          `穿防優勢顯著，但受傷頻繁`
        ]
      };
    }

    case "archer": {
      // 弓箭手：命中要害 71%（35% + DEX×0.45），傷害 ×1.5
      // 爆擊機率 24%，爆擊傷害 ×2.5
      // 命中要害與爆擊可疊加（最高 71% × 24% 同時觸發）
      const critChance = stats.crit;
      const archerCritChance = Math.min(80, 35 + stats.dex * 0.45); // 71%

      // 期望傷害 = 100% 基礎 + 71% 要害 + 24% 爆擊 + 17% 要害+爆擊疊加
      const normalOnly = base.avg * (1 - archerCritChance / 100) * (1 - critChance / 100);
      const archerOnly = base.avg * 1.5 * (archerCritChance / 100) * (1 - critChance / 100);
      const critOnly = base.avg * 2.5 * (1 - archerCritChance / 100) * (critChance / 100);
      const bothCrit = base.avg * 1.5 * 2.5 * (archerCritChance / 100) * (critChance / 100);
      const avgPerRound = normalOnly + archerOnly + critOnly + bothCrit;

      return {
        desc: "弓箭手（弓）",
        baseNormalDmg: base.avg,
        baseCritDmg: Math.round(base.avg * 2.5),
        normalDmgPerRound: Math.round(avgPerRound),
        critDmgPerRound: Math.round(avgPerRound * 2.5),
        traits: [
          `命中要害率: ${archerCritChance.toFixed(1)}% (35% + DEX×0.45%)`,
          `要害傷害: ×1.5（可與爆擊疊加）`,
          `爆擊機率: ${critChance.toFixed(1)}%`,
          `期望傷害分解:`,
          `  • 普通攻擊: ${Math.round(normalOnly)} (${(normalOnly/avgPerRound*100).toFixed(1)}%)`,
          `  • 要害攻擊: ${Math.round(archerOnly)} (${(archerOnly/avgPerRound*100).toFixed(1)}%)`,
          `  • 爆擊攻擊: ${Math.round(critOnly)} (${(critOnly/avgPerRound*100).toFixed(1)}%)`,
          `  • 要害+爆擊: ${Math.round(bothCrit)} (${(bothCrit/avgPerRound*100).toFixed(1)}%)`,
          `實際每回合傷害: ${Math.round(avgPerRound)}`
        ]
      };
    }

    default:
      return null;
  }
}

async function main() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("職業傷害對比（含徽章特性 + 概率計算）");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("\n【場景設定】");
  console.log("玩家：Lv.35，各屬性 80（50基礎 + 30 A階裝備）");
  console.log("怪物：Lv.35，DEF 60（精英區怪物）");
  console.log("武器：各職業最優配置\n");

  const jobs = ["swordsman", "warrior", "dwarf", "rogue", "mage", "archer"];
  const monsterDef = 60;
  const results = [];

  for (const job of jobs) {
    const stats = calcPlayerStats(job);
    const jobDmg = calcJobDamage(job, stats, monsterDef);
    if (jobDmg) results.push({ job, ...jobDmg });
  }

  // 按期望傷害排序
  results.sort((a, b) => b.normalDmgPerRound - a.normalDmgPerRound);

  console.log("【期望傷害排名（含職業特性）】\n");
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const rank = i === 0 ? "🔴 最強" : i === results.length - 1 ? "🔵 最弱" : "⚪ 中等";
    const diff = results[0].normalDmgPerRound - r.normalDmgPerRound;
    const diffPercent = ((diff / results[0].normalDmgPerRound) * 100).toFixed(1);

    console.log(`${rank} ${(i + 1)}. ${r.desc}`);
    console.log(`   期望傷害: ${r.normalDmgPerRound} / 回合 ${diff > 0 ? `(-${diffPercent}% vs 第一名)` : ""}`);
    console.log(`   單次基礎: ${r.baseNormalDmg} | 爆擊: ${r.baseCritDmg}`);
    for (const trait of r.traits) {
      console.log(`   ${trait}`);
    }
    console.log("");
  }

  // 匯總表格
  console.log("\n【簡表：每回合期望傷害】\n");
  console.log("職業".padEnd(16) + "期望傷害".padStart(10) + "vs第一名".padStart(12));
  console.log("─".repeat(40));
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const diff = results[0].normalDmgPerRound - r.normalDmgPerRound;
    const diffPercent = ((diff / results[0].normalDmgPerRound) * 100).toFixed(1);
    const bar = "█".repeat(Math.round(r.normalDmgPerRound / results[0].normalDmgPerRound * 20));
    console.log(
      r.desc.padEnd(16) +
      r.normalDmgPerRound.toString().padStart(6) +
      " " + bar +
      (i === 0 ? "" : ` -${diffPercent}%`)
    );
  }
}

main().catch(console.error);
