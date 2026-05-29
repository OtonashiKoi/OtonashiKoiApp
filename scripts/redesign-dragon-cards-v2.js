"use strict";
/**
 * 龍族卡片 v2：去掉純數值加成，改為動作 / 淨化 / 驅散 / 控制 / 吸血 / 反擊型
 *
 * 新增的卡片支援機制（已在 combatLoop.js 補上）：
 *   proc_cleanse — 移除自身負面狀態
 *   proc_dispel  — 移除敵方增益狀態
 *
 * 其他不算「純數值」的效果：
 *   counter, lifesteal, def_ignore, invincible_short, lightning,
 *   burn, poison, bleed, stun, silence, charm, freeze, heal_over_time
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
      key: "dragon_hatchling_molt",
      name: "破繭蛻變",
      description: "35% 機率：淨化自身所有負面狀態，並獲得 1 回合 25% 吸血。",
      chance: 35, cooldownTurns: 0, trigger: "on_hit",
      procEffects: [
        eff("proc_cleanse", "self", 0, 1),
        eff("lifesteal",    "self", 25, 1),
      ],
    },
  },
  {
    cardName: "龍蜥武士卡",
    skill: {
      key: "dragonkin_warrior_reflect",
      name: "龍鱗反擊",
      description: "30% 機率：反擊所受傷害 60%，持續 3 回合；若已處於 Debuff 中，淨化並提升至 90%。",
      chance: 30, cooldownTurns: 0, trigger: "on_hit",
      procEffects: [
        eff("proc_cleanse", "self", 0,  1),
        eff("counter",      "self", 100, 3, { counterDamagePct: 60, bonusIfTargetDebuffed: 30 }),
      ],
    },
  },
  {
    cardName: "火翼龍人卡",
    skill: {
      key: "flame_winged_brand",
      name: "龍焰烙印",
      description: "45% 機率：使敵方燃燒（每回合 12 點），持續 3 回合；若目標已有 Debuff，傷害提升至 18 點且追加流血。",
      chance: 45, cooldownTurns: 0, trigger: "on_hit",
      procEffects: [
        eff("burn",  "enemy", 12, 3, { bonusIfTargetDebuffed: 6 }),
        eff("bleed", "enemy", 8,  2, { mode: "flat" }),
      ],
    },
  },
  {
    cardName: "冰鱗龍人卡",
    skill: {
      key: "frost_scale_silence",
      name: "霜寒禁言",
      description: "40% 機率：沉默敵方 1 回合並使其陷入緩速；若目標 HP < 40%，改為直接凍結 1 回合。",
      chance: 40, cooldownTurns: 0, trigger: "on_hit",
      procEffects: [
        eff("silence", "enemy", 0,  1),
        eff("agi_down", "enemy", 25, 2),
        eff("freeze",  "enemy", 0,  1, { targetHpBelowPct: 40 }),
      ],
    },
  },
  {
    cardName: "雷霆飛龍卡",
    skill: {
      key: "thunder_wyvern_bolt",
      name: "雷霆貫擊",
      description: "30% 機率：對敵方造成自身攻擊力 70% 的雷擊；若目標處於 Debuff 狀態，傷害提升至 120%。",
      chance: 30, cooldownTurns: 0, trigger: "on_hit",
      procEffects: [
        eff("lightning", "enemy", 70, 1, { mode: "caster_atk_pct", bonusIfTargetDebuffed: 50 }),
      ],
    },
  },
  {
    cardName: "黑曜龍騎卡",
    skill: {
      key: "obsidian_rider_dispel",
      name: "黑曜驅散",
      description: "35% 機率：驅散敵方所有增益狀態，並使其進入 2 回合的破甲（DEF -30%）。",
      chance: 35, cooldownTurns: 0, trigger: "on_hit",
      procEffects: [
        eff("proc_dispel", "enemy", 0,  1),
        eff("def_down",    "enemy", 30, 2),
      ],
    },
  },
  {
    cardName: "黃金幼龍(稀)卡",
    skill: {
      key: "gold_dragonling_redemption",
      name: "黃金救贖",
      description: "55% 機率：淨化自身負面狀態，並回復 10% 最大 HP；若已滿血則改為對敵方造成自身攻擊力 50% 雷擊。",
      chance: 55, cooldownTurns: 0, trigger: "on_hit",
      procEffects: [
        eff("proc_cleanse",   "self",  0,  1),
        eff("heal_over_time", "self", 10,  1, { ownerHpBelowPct: 99 }),
        eff("lightning",      "enemy", 50, 1, { mode: "caster_atk_pct", ownerHpAbovePct: 99 }),
      ],
    },
  },
  {
    cardName: "暗影龍將卡",
    skill: {
      key: "shadow_dragon_general_pierce",
      name: "影襲穿透",
      description: "40% 機率：無視敵方 35% 防禦，並對 HP < 50% 的敵人吸血 30%；同時為自身淨化 1 個負面狀態。",
      chance: 40, cooldownTurns: 0, trigger: "on_hit",
      procEffects: [
        eff("def_ignore",   "self", 35, 1),
        eff("lifesteal",    "self", 30, 1, { targetHpBelowPct: 50 }),
        eff("proc_cleanse", "self", 0,  1),
      ],
    },
  },
  {
    cardName: "龍翼魔法師卡",
    skill: {
      key: "dragon_mage_arcane_seal",
      name: "龍語禁咒",
      description: "35% 機率：沉默敵方 1 回合、驅散其增益狀態，並淨化自身負面狀態；冷卻 2 回合。",
      chance: 35, cooldownTurns: 2, trigger: "on_hit",
      procEffects: [
        eff("silence",      "enemy", 0, 1),
        eff("proc_dispel",  "enemy", 0, 1),
        eff("proc_cleanse", "self",  0, 1),
      ],
    },
  },
  {
    cardName: "古龍王(B)卡",
    skill: {
      key: "ancient_dragon_king_domain",
      name: "龍王領域",
      description: "50% 機率：展開龍王領域 — 驅散敵方增益、淨化自身負面、對敵方施加沉默 1 回合；HP < 50% 時額外無敵 1 回合；冷卻 4 回合。",
      chance: 50, cooldownTurns: 4, trigger: "on_hit",
      procEffects: [
        eff("proc_dispel",      "enemy",  0, 1),
        eff("proc_cleanse",     "self",   0, 1),
        eff("silence",          "enemy",  0, 1),
        eff("invincible_short", "self", 100, 1, { ownerHpBelowPct: 50 }),
      ],
    },
  },
];

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const db = await getMongoDb();

  console.log(`v2 重新設計 ${CARDS.length} 張龍族卡片（dryRun=${dryRun}）`);
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
    console.log(`UPDATE  ${card.cardName.padEnd(16)} ${card.skill.name} (${card.skill.chance}%/cd${card.skill.cooldownTurns}, ${procEffects.length} effects)`);
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
  console.log("\n注意：玩家身上既有卡片實例仍是舊 snapshot，須重新撿取或重新裝備才生效。");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
