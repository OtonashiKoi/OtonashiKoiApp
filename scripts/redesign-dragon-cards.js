"use strict";
/**
 * 重新設計龍族卡片，加入古城等級的機制豐富度：
 * - HP 條件雙階段（ownerHpAbovePct / ownerHpBelowPct）
 * - 對目標狀態加成（bonusIfTargetDebuffed / targetHpBelowPct）
 * - 可疊加（stackMode / stackAdd / maxValue）
 * - 多重 procEffects（一張卡多個效果同時觸發）
 *
 * 直接 update items.monsterCardSkill 與 items.procEffects（id 沿用）
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const NOW = new Date().toISOString();

function eff(key, target, value, duration, extras = {}) {
  return {
    key,
    target,
    trigger: "on_hit",
    chance: 100,
    sourcePhase: "proc",
    params: {
      value,
      duration: { mode: "turns", value: duration },
      ...extras,
    },
  };
}

const CARDS = [
  {
    cardName: "飛龍幼崽卡",
    skill: {
      key: "dragon_hatchling_dive",
      name: "俯衝突襲",
      description: "30% 機率：滿血俯衝（HP > 70% 時 AGI +15、迴避 +5）；瀕死反撲（HP ≤ 30% 時 ATK +15%），持續 2 回合。",
      chance: 30, cooldownTurns: 0, trigger: "on_hit",
      procEffects: [
        eff("agi_up",   "self", 15, 2, { mode: "flat", ownerHpAbovePct: 70 }),
        eff("dodge_up", "self",  5, 2, { mode: "flat", ownerHpAbovePct: 70 }),
        eff("atk_up",   "self", 15, 2, { ownerHpBelowPct: 30 }),
      ],
    },
  },
  {
    cardName: "龍蜥武士卡",
    skill: {
      key: "dragonkin_warrior_scale_counter",
      name: "龍鱗反擊",
      description: "30% 機率：反擊所受傷害 50%，並使自身 DEF +10 可疊加（每層 +5、最高 +40），持續 3 回合。",
      chance: 30, cooldownTurns: 0, trigger: "on_hit",
      procEffects: [
        eff("counter", "self", 100, 3, { counterDamagePct: 50 }),
        eff("def_up",  "self",  10, 3, { mode: "flat", stackMode: "stack_value", stackAdd: 5, maxValue: 40 }),
      ],
    },
  },
  {
    cardName: "火翼龍人卡",
    skill: {
      key: "flame_winged_inferno",
      name: "龍焰浸蝕",
      description: "40% 機率：讓敵方燃燒（每回合 12 點），持續 3 回合；若目標已有 Debuff，燃燒提升至 18 點。",
      chance: 40, cooldownTurns: 0, trigger: "on_hit",
      procEffects: [
        eff("burn", "enemy", 12, 3, { bonusIfTargetDebuffed: 6 }),
      ],
    },
  },
  {
    cardName: "冰鱗龍人卡",
    skill: {
      key: "frost_scale_freeze",
      name: "霜寒禁錮",
      description: "45% 機率：敵方 AGI -20%、命中 -15，持續 2 回合；若目標 HP < 30%，額外沉默 1 回合。",
      chance: 45, cooldownTurns: 0, trigger: "on_hit",
      procEffects: [
        eff("agi_down", "enemy", 20, 2),
        eff("hit_down", "enemy", 15, 2, { mode: "flat" }),
        eff("silence",  "enemy",  0, 1, { targetHpBelowPct: 30 }),
      ],
    },
  },
  {
    cardName: "雷霆飛龍卡",
    skill: {
      key: "thunder_wyvern_chain",
      name: "雷霆貫擊",
      description: "30% 機率：對敵方造成自身攻擊力 60% 的雷擊；若目標處於 Debuff 狀態，傷害提升至 100%。",
      chance: 30, cooldownTurns: 0, trigger: "on_hit",
      procEffects: [
        eff("lightning", "enemy", 60, 1, { bonusIfTargetDebuffed: 40 }),
      ],
    },
  },
  {
    cardName: "黑曜龍騎卡",
    skill: {
      key: "obsidian_rider_armor_break",
      name: "黑曜碎甲",
      description: "35% 機率：敵方 DEF -30% 可疊加（每層 +10、最高 -50%），持續 2 回合；同時自身穿透 +25%，持續 1 回合。",
      chance: 35, cooldownTurns: 0, trigger: "on_hit",
      procEffects: [
        eff("def_down",   "enemy", 30, 2, { stackMode: "stack_value", stackAdd: 10, maxValue: 50 }),
        eff("def_ignore", "self",  25, 1),
      ],
    },
  },
  {
    cardName: "黃金幼龍(稀)卡",
    skill: {
      key: "gold_dragonling_blessing",
      name: "黃金加護",
      description: "60% 機率：爆擊率 +25、爆擊傷害 +25%，持續 2 回合；HP > 80% 時額外回復 8% HP。",
      chance: 60, cooldownTurns: 0, trigger: "on_hit",
      procEffects: [
        eff("crit_rate_up",   "self", 25, 2, { mode: "flat" }),
        eff("crit_damage_up", "self", 25, 2),
        eff("heal_over_time", "self",  8, 1, { ownerHpAbovePct: 80 }),
      ],
    },
  },
  {
    cardName: "暗影龍將卡",
    skill: {
      key: "shadow_dragon_general_backstab",
      name: "影襲背刺",
      description: "40% 機率：自身命中 +10、無視敵方 30% 防禦，持續 1 回合；若敵方 HP < 50%，額外造成 20% 最終傷害加成。",
      chance: 40, cooldownTurns: 0, trigger: "on_hit",
      procEffects: [
        eff("hit_up",          "self", 10, 1, { mode: "flat" }),
        eff("def_ignore",      "self", 30, 1),
        eff("final_damage_up", "self", 20, 1, { targetHpBelowPct: 50 }),
      ],
    },
  },
  {
    cardName: "龍翼魔法師卡",
    skill: {
      key: "dragon_mage_silencing_seal",
      name: "龍語封印",
      description: "35% 機率：沉默敵方 1 回合並使其 ATK -15%，持續 2 回合；冷卻 2 回合。",
      chance: 35, cooldownTurns: 2, trigger: "on_hit",
      procEffects: [
        eff("silence",  "enemy",  0, 1),
        eff("atk_down", "enemy", 15, 2),
      ],
    },
  },
  {
    cardName: "古龍王(B)卡",
    skill: {
      key: "ancient_dragon_king_domain",
      name: "龍王領域",
      description: "50% 機率：展開龍王領域 — 自身最終傷害 +30%、減傷 +15%；敵方 ATK -15%、命中 -10，持續 3 回合；HP < 50% 時額外無敵 1 回合。冷卻 4 回合。",
      chance: 50, cooldownTurns: 4, trigger: "on_hit",
      procEffects: [
        eff("final_damage_up",  "self",  30, 3),
        eff("damage_reduction", "self",  15, 3),
        eff("atk_down",         "enemy", 15, 3),
        eff("hit_down",         "enemy", 10, 3, { mode: "flat" }),
        eff("invincible_short", "self", 100, 1, { ownerHpBelowPct: 50 }),
      ],
    },
  },
];

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const db = await getMongoDb();

  console.log(`重新設計 ${CARDS.length} 張龍族卡片（dryRun=${dryRun}）`);
  console.log("─".repeat(95));

  let updated = 0;
  for (const card of CARDS) {
    const existing = await db.collection("items").findOne({ name: card.cardName, equipSlot: "special" });
    if (!existing) {
      console.warn(`⚠ 找不到 ${card.cardName}，跳過`);
      continue;
    }
    const monsterCardSkill = card.skill;
    const procEffects = card.skill.procEffects;
    console.log(`UPDATE  ${card.cardName.padEnd(16)} ${card.skill.name} (chance ${card.skill.chance}%, cd ${card.skill.cooldownTurns}, ${procEffects.length} effects)`);
    if (!dryRun) {
      await db.collection("items").updateOne(
        { _id: existing._id },
        { $set: { monsterCardSkill, procEffects, description: card.skill.description, updatedAt: NOW } }
      );
    }
    updated++;
  }
  console.log("─".repeat(95));
  console.log(`完成：更新 ${updated} 張${dryRun ? "（dry-run）" : ""}`);
  console.log("\n注意：已發給玩家的卡片實例（progress.inventory / equipment）仍是舊技能 snapshot。");
  console.log("      新效果只在 (1) 玩家重新撿取掉落，或 (2) 走再裝備流程觸發 snapshot 更新後生效。");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
