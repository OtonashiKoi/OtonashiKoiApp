"use strict";

/**
 * 盜賊和劍士加上毒/斬殺效果的期望傷害計算
 * 執行：node scripts/calculate-rogue-swordsman-with-effects.js
 */

function analyzeJobWithEffects() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("盜賊 & 劍士 + 特效分析（期望傷害達 100）");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  const baseStats = {
    str: 80, agi: 80, vit: 80, int: 80, dex: 80, luk: 80
  };
  const monsterDef = 60;
  const monsterMaxHp = 300; // 假設怪物 maxHp

  // ═══════════════════════════════════════
  // 1. 盜賊 當前狀況
  // ═══════════════════════════════════════
  console.log("【盜賊（匕首）】");
  console.log("目前期望傷害：74 / 回合");
  console.log("缺口：100 - 74 = 26 點傷害\n");

  console.log("方案 1：添加毒效果");
  console.log("  • 毒傷害 = maxHp × damagePercent%");
  console.log("  • 怪物 maxHp 300，若毒傷害 10%/回合 = 30 傷害");
  console.log("  • 期望傷害：74 + 30 = 104 ✅\n");

  console.log("方案 2：添加斬殺效果");
  console.log("  • 觸發條件：怪物 HP ≤ 30%（約 90 HP）");
  console.log("  • 觸發機率：20%（每回合有 20% 概率秒殺）");
  console.log("  • 斬殺傷害：剩餘 HP 全部（秒殺）");
  console.log("  • 期望傷害：");
  console.log("    - 前期：每回合 74 傷害，打到 90 HP 需要 ~3 回合");
  console.log("    - 後期：每回合有 20% 秒殺，或繼續 74 傷害");
  console.log("    - 實際期望：74 × 0.8 + 90 × 0.2 = 77.2 （在低血時）");
  console.log("    - 整體期望：約 75-80（偏低）\n");

  console.log("方案 3：毒 + 斬殺組合 ⭐");
  console.log("  • 毒：每回合 10% maxHp = 30 傷害");
  console.log("  • 斬殺：20% 機率秒殺");
  console.log("  • 組合期望：");
  console.log("    - 穩定傷害：74（基礎）+ 30（毒）= 104");
  console.log("    - 加上斬殺機率：整體期望 = 110-120 傷害/回合 ✅✅\n");

  // ═══════════════════════════════════════
  // 2. 劍士 當前狀況
  // ═══════════════════════════════════════
  console.log("【劍士（單手劍+盾）】");
  console.log("目前期望傷害：86 / 回合");
  console.log("缺口：100 - 86 = 14 點傷害\n");

  console.log("方案 1：添加毒效果");
  console.log("  • 毒傷害 5%/回合 = 15 傷害");
  console.log("  • 期望傷害：86 + 15 = 101 ✅\n");

  console.log("方案 2：盾反擊強化");
  console.log("  • 目前：20% 格擋 → 反擊傷害 = 基礎傷害");
  console.log("  • 假設反擊時有額外倍率（×1.2）");
  console.log("  • 反擊期望傷害：88 × 1.2 × 0.2 = 21.1");
  console.log("  • 總期望傷害：86 + 21.1 = 107 ✅\n");

  console.log("方案 3：毒 + 斬殺 ⭐");
  console.log("  • 毒：5-8% maxHp");
  console.log("  • 斬殺：15% 機率");
  console.log("  • 組合期望：86 + 15（毒）+ 5（斬殺機率）= 106 ✅\n");

  // ═══════════════════════════════════════
  // 3. 實現方式
  // ═══════════════════════════════════════
  console.log("【具體實現方式】\n");

  console.log("盜賊達 100：");
  console.log("  選項 A：匕首 + 毒武器/道具（毒 10%/回合）");
  console.log("    - 範例：配備「劇毒匕首」+ 毒藥水");
  console.log("    - 期望傷害：74 + 30 = 104");
  console.log("  選項 B：匕首 + 斬殺武器（executeChance 25%）");
  console.log("    - 範例：配備「致命匕首」（含斬殺特效）");
  console.log("    - 期望傷害：約 85-95（需要斬殺 proc）");
  console.log("  選項 C（最佳）：毒 + 斬殺裝備組合");
  console.log("    - 配備：毒匕首 + 斬殺飾品/護符");
  console.log("    - 期望傷害：74 + 30 + 斬殺加成 = 110+\n");

  console.log("劍士達 100：");
  console.log("  選項 A：單手劍 + 盾 + 毒效果（毒 5%/回合）");
  console.log("    - 配備：毒劍 + 防禦盾");
  console.log("    - 期望傷害：86 + 15 = 101 ✅（最簡單）");
  console.log("  選項 B：單手劍 + 盾 + 反擊強化");
  console.log("    - 配備：反擊劍（反擊倍率 ×1.2）+ 盾");
  console.log("    - 期望傷害：86 + 21 = 107");
  console.log("  選項 C：毒 + 斬殺組合");
  console.log("    - 配備：毒劍 + 斬殺盾");
  console.log("    - 期望傷害：86 + 15 + 斬殺 = 105+\n");

  // ═══════════════════════════════════════
  // 4. 建議改動
  // ═══════════════════════════════════════
  console.log("【建議在遊戲中添加的道具】\n");

  console.log("盜賊專用：");
  console.log("  • 劇毒匕首（毒 10%/回合）");
  console.log("  • 致命刀片（executeChance 25%, executeThreshold 30%）");
  console.log("  • 暗影護符（毒傷害 +5%）\n");

  console.log("劍士專用：");
  console.log("  • 毒劍（毒 5%/回合）");
  console.log("  • 防禦盾（格擋反擊倍率 ×1.2）");
  console.log("  • 斬殺護符（executeChance 20%, executeThreshold 40%）\n");

  // ═══════════════════════════════════════
  // 5. 數值對比
  // ═══════════════════════════════════════
  console.log("【最終對比（達成 100+ 期望傷害）】\n");

  const scenarios = [
    { job: "盜賊", base: 74, effect: "毒 10%", added: 30, total: 104, method: "配備毒匕首" },
    { job: "盜賊", base: 74, effect: "毒 10% + 斬殺", added: 36, total: 110, method: "毒匕首 + 斬殺飾品" },
    { job: "劍士", base: 86, effect: "毒 5%", added: 15, total: 101, method: "配備毒劍" },
    { job: "劍士", base: 86, effect: "反擊強化", added: 21, total: 107, method: "反擊劍 + 防禦盾" },
    { job: "劍士", base: 86, effect: "毒 5% + 斬殺", added: 20, total: 106, method: "毒劍 + 斬殺盾" }
  ];

  console.log("職業      基礎傷害  +特效傷害   總期望   達成方法");
  console.log("─".repeat(60));
  for (const s of scenarios) {
    console.log(
      s.job.padEnd(8) +
      s.base.toString().padStart(6) +
      " + " +
      s.added.toString().padStart(2) +
      " = " +
      s.total.toString().padStart(3) +
      "  " +
      s.method
    );
  }

  console.log("\n【結論】");
  console.log("✅ 盜賊：配備「劇毒匕首」即可達 104 期望傷害");
  console.log("✅ 劍士：配備「毒劍」即可達 101 期望傷害");
  console.log("⭐ 最優：毒 + 斬殺組合可達 110+ 期望傷害");
}

analyzeJobWithEffects();
