"use strict";
/**
 * 龍族卡片 v4：仿戒指系統（always-on passive 機制）
 *
 * 每張卡都是被動觸發、無機率 proc。
 * 用 collectEquipmentEffects 已支援的 passive effect keys：
 *   combo_up / combo_damage_up / crit_rate_up / crit_damage_up
 *   lifesteal / on_kill_heal / on_hit_heal / on_crit_heal
 *   reflect_damage / counter_attack / thorns
 *   life_regen / post_battle_heal / heal_over_time
 *   shield(battle_start) / bonus_while_shielded
 *   bonus_when_hp_low / bonus_reduction_when_hp_low
 *   bonus_when_hp_high / bonus_first_hit / bonus_counter_damage
 *   bonus_vs_boss / bonus_vs_burning / bonus_vs_stunned / bonus_vs_poisoned
 *   physical_damage_reduction / magic_damage_reduction
 *   last_stand / debuff_immunity / control_immunity
 *   execute_under_hp_pct
 *   stack_on_hit_offense / stack_on_taken_defense
 *   final_damage_up / hit_up
 *
 * 不再有 monsterCardSkill.procEffects（清空，避免機率觸發）
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const NOW = new Date().toISOString();

function pe(key, value, extras = {}) {
  return {
    key,
    target: "self",
    trigger: extras.trigger || "passive",
    chance: 100,
    sourcePhase: "passive",
    params: { value, ...extras.params },
  };
}

const CARDS = [
  {
    cardName: "飛龍幼崽卡",
    skillName: "俯衝先制",
    description: "[A階 / 飛龍系] 連擊率 +12，第一擊傷害 +20%",
    passiveEffects: [
      pe("combo_up", 12),
      pe("bonus_first_hit", 20),
    ],
  },
  {
    cardName: "龍蜥武士卡",
    skillName: "龍鱗反震",
    description: "[A階 / 反震系] 受擊反彈 22% 傷害，受擊 25% 機率反擊一次",
    passiveEffects: [
      pe("reflect_damage", 22),
      pe("counter_attack", 25),
    ],
  },
  {
    cardName: "火翼龍人卡",
    skillName: "龍焰共生",
    description: "[A階 / 火焰系] 對燃燒中目標傷害 +30%，攻擊命中回復 5% 已造成傷害",
    passiveEffects: [
      pe("bonus_vs_burning", 30),
      pe("on_hit_heal", 5),
    ],
  },
  {
    cardName: "冰鱗龍人卡",
    skillName: "霜甲護身",
    description: "[A階 / 守護系] 免疫所有負面狀態，滿血時傷害 +18%（HP > 70%）",
    passiveEffects: [
      pe("debuff_immunity", 1),
      pe("bonus_when_hp_high", 18, { params: { thresholdPct: 70 } }),
    ],
  },
  {
    cardName: "雷霆飛龍卡",
    skillName: "雷霆連擊",
    description: "[A階 / 連擊系] 連擊時傷害 +22%，爆擊率 +10",
    passiveEffects: [
      pe("combo_damage_up", 22),
      pe("crit_rate_up", 10),
    ],
  },
  {
    cardName: "黑曜龍騎卡",
    skillName: "黑曜碎甲",
    description: "[A階 / 破甲系] 對 BOSS 傷害 +25%，對暈眩中目標傷害 +25%",
    passiveEffects: [
      pe("bonus_vs_boss", 25),
      pe("bonus_vs_stunned", 25),
    ],
  },
  {
    cardName: "黃金幼龍(稀)卡",
    skillName: "黃金祝福",
    description: "[A階 / 救護系] 每 3 回合回 10% MaxHP，擊殺回 18% MaxHP，戰鬥結束回 30% MaxHP",
    passiveEffects: [
      pe("life_regen", 10, { params: { interval: 3 } }),
      pe("on_kill_heal", 18),
      pe("post_battle_heal", 30),
    ],
  },
  {
    cardName: "暗影龍將卡",
    skillName: "影襲斬殺",
    description: "[A階 / 狂血系] HP < 30% 時傷害 +25%、減傷 +20%；HP 低於 20% 的敵方有機率被一擊斬殺",
    passiveEffects: [
      pe("bonus_when_hp_low", 25, { params: { thresholdPct: 30 } }),
      pe("bonus_reduction_when_hp_low", 20, { params: { thresholdPct: 30 } }),
      pe("execute_under_hp_pct", 25, { params: { thresholdPct: 20 } }),
    ],
  },
  {
    cardName: "龍翼魔法師卡",
    skillName: "魔法護盾",
    description: "[A階 / 守護系] 開戰獲得 20% MaxHP 護盾，擁有護盾時傷害 +20%，免疫控制（暈眩/凍結/沉默/緩速等）",
    passiveEffects: [
      pe("shield", 20, { trigger: "battle_start", params: { trigger: "battle_start" } }),
      pe("bonus_while_shielded", 20),
      pe("control_immunity", 1),
    ],
  },
  {
    cardName: "古龍王(B)卡",
    skillName: "龍王戰意",
    description: "[A階 / 龍王系] 每次出手 +3 STR/DEX（上限 +15），每次受擊 +3 VIT/AGI（上限 +15），物理減傷 +15%、魔法減傷 +15%",
    passiveEffects: [
      pe("stack_on_hit_offense", 3, { params: { cap: 15 } }),
      pe("stack_on_taken_defense", 3, { params: { cap: 15 } }),
      pe("physical_damage_reduction", 15),
      pe("magic_damage_reduction", 15),
    ],
  },
];

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const db = await getMongoDb();

  console.log(`v4 龍族卡片（仿戒指系統，被動觸發）（dryRun=${dryRun}）`);
  console.log("─".repeat(105));

  let updated = 0;
  for (const card of CARDS) {
    const existing = await db.collection("items").findOne({ name: card.cardName, equipSlot: "special" });
    if (!existing) { console.warn(`⚠ 找不到 ${card.cardName}`); continue; }

    // 保留 monsterCardSkill 給 UI 顯示，但清空 procEffects 避免觸發機率技
    const monsterCardSkill = {
      key: `dragon_card_passive_${card.cardName.replace(/[^a-zA-Z0-9]/g, "_")}`,
      name: card.skillName,
      description: card.description,
      chance: 0,                    // 0% — 不觸發機率技
      cooldownTurns: 0,
      trigger: "passive",
      procEffects: [],
    };

    console.log(`UPDATE  ${card.cardName.padEnd(16)} ${card.skillName.padEnd(8)} (passive ×${card.passiveEffects.length})`);
    console.log(`        ${card.description}`);
    if (!dryRun) {
      await db.collection("items").updateOne(
        { _id: existing._id },
        { $set: {
          monsterCardSkill,
          procEffects: [],
          passiveEffects: card.passiveEffects,
          description: card.description,
          updatedAt: NOW,
        }}
      );
    }
    updated++;
  }
  console.log("─".repeat(105));
  console.log(`完成：更新 ${updated} 張${dryRun ? "（dry-run）" : ""}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
