"use strict";
/**
 * 龍族卡片 v3：龍味十足、淨化壓到 2 張（黃金 + 古龍王）
 * 引入新的卡片支援效果（已加進 combatLoop.js）：
 *   proc_extra_hit  — 追擊（單次 ATK% 即時傷害）
 *   proc_chain_hit  — 連鎖（多段 ATK% 即時傷害）
 *   proc_execute    — 斬殺（低血即殺）
 *   proc_heal       — 即時回血
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
      key: "dragon_hatchling_swoop",
      name: "俯衝撕咬",
      description: "30% 機率：俯衝追擊一次（自身攻擊力 60% 傷害），同時獲得 1 回合 25% 吸血。",
      chance: 30, cooldownTurns: 0, trigger: "on_hit",
      procEffects: [
        eff("proc_extra_hit", "enemy", 0, 1, { damageMultiplier: 0.6 }),
        eff("lifesteal",      "self",  25, 1),
      ],
    },
  },
  {
    cardName: "龍蜥武士卡",
    skill: {
      key: "dragonkin_warrior_scale_shock",
      name: "鱗甲反震",
      description: "30% 機率：龍鱗反震 — 反擊所受傷害 60% + 自身減傷 20%，持續 3 回合。",
      chance: 30, cooldownTurns: 0, trigger: "on_hit",
      procEffects: [
        eff("counter",          "self", 100, 3, { counterDamagePct: 60 }),
        eff("damage_reduction", "self",  20, 3),
      ],
    },
  },
  {
    cardName: "火翼龍人卡",
    skill: {
      key: "flame_winged_breath",
      name: "龍焰噴吐",
      description: "45% 機率：龍焰噴吐使敵方燃燒（每回合 14 點），持續 3 回合；同時造成流血傷害。",
      chance: 45, cooldownTurns: 0, trigger: "on_hit",
      procEffects: [
        eff("burn",  "enemy", 14, 3, { bonusIfTargetDebuffed: 6 }),
        eff("bleed", "enemy",  8, 2, { mode: "flat" }),
      ],
    },
  },
  {
    cardName: "冰鱗龍人卡",
    skill: {
      key: "frost_scale_breath",
      name: "冰息凝霜",
      description: "40% 機率：冰息凍結敵方 1 回合並陷入緩速；若敵方 HP < 40%，額外沉默 1 回合。",
      chance: 40, cooldownTurns: 0, trigger: "on_hit",
      procEffects: [
        eff("freeze",   "enemy", 0,  1),
        eff("agi_down", "enemy", 25, 2),
        eff("silence",  "enemy", 0,  1, { targetHpBelowPct: 40 }),
      ],
    },
  },
  {
    cardName: "雷霆飛龍卡",
    skill: {
      key: "thunder_wyvern_chain",
      name: "雷霆三連",
      description: "30% 機率：召喚連鎖閃電打擊敵方 3 次，每次造成自身攻擊力 30% 的雷擊傷害。",
      chance: 30, cooldownTurns: 0, trigger: "on_hit",
      procEffects: [
        eff("proc_chain_hit", "enemy", 0, 1, { chainCount: 3, damageMultiplier: 0.3 }),
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
      name: "黃金祝福",
      description: "55% 機率：淨化自身負面狀態 + 即時回復 10% 最大 HP；若已滿血，改為對敵方追擊一次（自身攻擊力 70% 傷害）。",
      chance: 55, cooldownTurns: 0, trigger: "on_hit",
      procEffects: [
        eff("proc_cleanse",   "self", 0,   1),
        eff("proc_heal",      "self", 10,  1, { ownerHpBelowPct: 99 }),
        eff("proc_extra_hit", "enemy", 0,  1, { damageMultiplier: 0.7, ownerHpAbovePct: 99 }),
      ],
    },
  },
  {
    cardName: "暗影龍將卡",
    skill: {
      key: "shadow_dragon_general_assassinate",
      name: "影襲斬殺",
      description: "40% 機率：對 HP < 20% 的敵人直接斬殺；否則無視 35% 防禦並吸血 30%，持續 1 回合。",
      chance: 40, cooldownTurns: 0, trigger: "on_hit",
      procEffects: [
        eff("proc_execute", "enemy",  0, 1, { thresholdPct: 20 }),
        eff("def_ignore",   "self",  35, 1),
        eff("lifesteal",    "self",  30, 1, { ownerHpAbovePct: 1 }),
      ],
    },
  },
  {
    cardName: "龍翼魔法師卡",
    skill: {
      key: "dragon_mage_arcane_seal",
      name: "龍語禁咒",
      description: "35% 機率：沉默敵方 1 回合並驅散其增益狀態；冷卻 2 回合。",
      chance: 35, cooldownTurns: 2, trigger: "on_hit",
      procEffects: [
        eff("silence",     "enemy", 0, 1),
        eff("proc_dispel", "enemy", 0, 1),
      ],
    },
  },
  {
    cardName: "古龍王(B)卡",
    skill: {
      key: "ancient_dragon_king_domain",
      name: "龍王領域",
      description: "50% 機率：展開龍王領域 — 淨化自身負面、驅散敵方增益、沉默敵方 1 回合；HP < 50% 時額外無敵 1 回合；冷卻 4 回合。",
      chance: 50, cooldownTurns: 4, trigger: "on_hit",
      procEffects: [
        eff("proc_cleanse",     "self",   0, 1),
        eff("proc_dispel",      "enemy",  0, 1),
        eff("silence",          "enemy",  0, 1),
        eff("invincible_short", "self", 100, 1, { ownerHpBelowPct: 50 }),
      ],
    },
  },
];

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const db = await getMongoDb();

  console.log(`v3 龍族卡片設計（dryRun=${dryRun}）`);
  console.log("─".repeat(95));

  let updated = 0;
  for (const card of CARDS) {
    const existing = await db.collection("items").findOne({ name: card.cardName, equipSlot: "special" });
    if (!existing) { console.warn(`⚠ 找不到 ${card.cardName}`); continue; }
    console.log(`UPDATE  ${card.cardName.padEnd(16)} ${card.skill.name}  ${card.skill.chance}%/cd${card.skill.cooldownTurns}, ${card.skill.procEffects.length} effects`);
    if (!dryRun) {
      await db.collection("items").updateOne(
        { _id: existing._id },
        { $set: {
          monsterCardSkill: card.skill,
          procEffects: card.skill.procEffects,
          description: card.skill.description,
          updatedAt: NOW,
        }}
      );
    }
    updated++;
  }
  console.log("─".repeat(95));
  console.log(`完成：更新 ${updated} 張${dryRun ? "（dry-run）" : ""}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
