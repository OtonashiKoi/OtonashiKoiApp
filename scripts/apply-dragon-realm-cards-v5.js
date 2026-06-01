"use strict";
/**
 * Apply Dragon Realm card redesign V5 to MongoDB items.
 *
 * Usage:
 *   node scripts/apply-dragon-realm-cards-v5.js --dry-run
 *   node scripts/apply-dragon-realm-cards-v5.js
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const NOW = new Date().toISOString();

function passive(key, value, extras = {}) {
  return {
    key,
    target: "self",
    trigger: extras.trigger || "passive",
    chance: 100,
    sourcePhase: "passive",
    params: { value, ...(extras.params || {}) },
  };
}

function proc(key, target, value, durationTurns, chance, extras = {}) {
  return {
    key,
    target,
    trigger: extras.trigger || "on_hit",
    chance,
    sourcePhase: "proc",
    params: {
      value,
      duration: { mode: "turns", value: durationTurns },
      ...(extras.params || {}),
    },
  };
}

const CARDS = [
  {
    monsterName: "飛龍幼崽",
    cardName: "飛龍幼崽卡",
    skillName: "俯衝先制",
    description: "[A階 / 飛龍系] 常駐：連擊率 +12，戰鬥第一擊傷害 +20%。",
    passiveEffects: [
      passive("combo_up", 12),
      passive("bonus_first_hit", 20),
    ],
  },
  {
    monsterName: "龍蜥武士",
    cardName: "龍蜥武士卡",
    skillName: "龍鱗反震",
    description: "[A階 / 反震系] 常駐：受到攻擊時反彈 22% 傷害，並有 25% 機率立刻反擊一次。",
    passiveEffects: [
      passive("reflect_damage", 22),
      passive("counter_attack", 25),
    ],
  },
  {
    monsterName: "火翼龍人",
    cardName: "火翼龍人卡",
    skillName: "龍焰共生",
    description: "[A階 / 火焰系] 常駐：對燃燒中的目標傷害 +30%；攻擊命中回復造成傷害的 5%。",
    passiveEffects: [
      passive("bonus_vs_burning", 30),
      passive("on_hit_heal", 5),
    ],
  },
  {
    monsterName: "冰鱗龍人",
    cardName: "冰鱗龍人卡",
    skillName: "霜甲護身",
    description: "[A階 / 守護系] 常駐：免疫負面狀態；HP 高於 70% 時造成傷害 +18%。",
    passiveEffects: [
      passive("debuff_immunity", 1),
      passive("bonus_when_hp_high", 18, { params: { thresholdPct: 70 } }),
    ],
  },
  {
    monsterName: "雷霆飛龍",
    cardName: "雷霆飛龍卡",
    skillName: "雷霆連擊",
    description: "[A階 / 連擊系] 常駐：連擊傷害 +22%，爆擊率 +10。",
    passiveEffects: [
      passive("combo_damage_up", 22),
      passive("crit_rate_up", 10),
    ],
  },
  {
    monsterName: "黑曜龍騎",
    cardName: "黑曜龍騎卡",
    skillName: "黑曜碎甲",
    description: "[A階 / 破甲系] 常駐：對 BOSS 傷害 +25%；對破防或防禦下降中的目標額外傷害 +18%。",
    combatEffects: [
      passive("bonus_vs_boss", 25),
      passive("bonus_vs_def_broken", 18),
    ],
  },
  {
    monsterName: "黃金幼龍(稀)",
    cardName: "黃金幼龍(稀)卡",
    skillName: "黃金祝福",
    description: "[A階 / 救護系] 常駐：每 3 回合回復 10% MaxHP；擊殺敵人時回復 18% MaxHP；戰鬥結束後回復 30% MaxHP。",
    passiveEffects: [
      passive("life_regen", 10, { params: { interval: 3 } }),
      passive("on_kill_heal", 18),
      passive("post_battle_heal", 30),
    ],
  },
  {
    monsterName: "暗影龍將",
    cardName: "暗影龍將卡",
    skillName: "影襲斬殺",
    description: "[A階 / 狂血系] 常駐：HP 低於 30% 時造成傷害 +25%、受到傷害 -20%；攻擊 HP 低於 20% 的敵人時，有 25% 機率直接斬殺。",
    passiveEffects: [
      passive("bonus_when_hp_low", 25, { params: { thresholdPct: 30 } }),
      passive("bonus_reduction_when_hp_low", 20, { params: { thresholdPct: 30 } }),
      passive("execute_under_hp_pct", 25, { params: { thresholdPct: 20 } }),
    ],
  },
  {
    monsterName: "龍翼魔法師",
    cardName: "龍翼魔法師卡",
    skillName: "龍語魔盾",
    description: "[A階 / 守護系] 常駐：開戰獲得 20% MaxHP 護盾；擁有護盾時造成傷害 +20%；免疫控制效果。",
    passiveEffects: [
      passive("shield", 20, { trigger: "battle_start", params: { trigger: "battle_start" } }),
      passive("bonus_while_shielded", 20),
      passive("control_immunity", 1),
    ],
  },
  {
    monsterName: "古龍王(B)",
    cardName: "古龍王(B)卡",
    skillName: "龍王戰意",
    description: "[A階 / 龍王系] 常駐：每次出手獲得 STR/DEX +3，最高 +15；每次受擊獲得 VIT/AGI +3，最高 +15；物理傷害 -15%、魔法傷害 -15%。",
    passiveEffects: [
      passive("stack_on_hit_offense", 3, { params: { cap: 15 } }),
      passive("stack_on_taken_defense", 3, { params: { cap: 15 } }),
      passive("physical_damage_reduction", 15),
      passive("magic_damage_reduction", 15),
    ],
  },
];

function skillKey(cardName) {
  return `dragon_card_v5_${cardName.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, "_")}`;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const db = await getMongoDb();

  console.log(`套用龍族之領怪物卡 V5（dryRun=${dryRun}）`);
  console.log("-".repeat(100));

  let updated = 0;
  for (const card of CARDS) {
    const monster = await db.collection("monsters").findOne({ zone: "dragon_realm", name: card.monsterName });
    if (!monster) {
      console.warn(`SKIP  找不到來源怪物：${card.monsterName}`);
      continue;
    }

    const existing = await db.collection("items").findOne({ name: card.cardName, equipSlot: "special" });
    if (!existing) {
      console.warn(`SKIP  找不到卡片：${card.cardName}`);
      continue;
    }

    const procEffects = card.procEffects || [];
    const hasAnyAlwaysOnEffect = (card.passiveEffects || []).length > 0 || (card.combatEffects || []).length > 0;
    const monsterCardSkill = {
      key: skillKey(card.cardName),
      name: card.skillName,
      description: card.description,
      chance: procEffects.length > 0
        ? Math.max(...procEffects.map((effect) => Number(effect.chance || 0)))
        : (hasAnyAlwaysOnEffect ? 100 : 0),
      cooldownTurns: 0,
      trigger: procEffects.length > 0 ? "on_hit" : "passive",
      procEffects,
    };

    const update = {
      description: card.description,
      passiveEffects: card.passiveEffects || [],
      procEffects,
      combatEffects: card.combatEffects || [],
      useEffects: [],
      monsterCardSkill,
      monsterCardOf: monster.id,
      monsterCardMeta: {
        monsterName: card.monsterName,
        zone: "dragon_realm",
        seq: monster.seq || 0,
        level: monster.level || 0,
      },
      monsterName: card.monsterName,
      rarity: card.monsterName.includes("(B)") ? "boss" : "legendary",
      slotType: existing.slotType || "special_1",
      dropable: true,
      tradeable: true,
      equipStats: existing.equipStats || { str: 0, agi: 0, vit: 0, int: 0, dex: 0, luk: 0 },
      itemId: existing.id,
      itemName: existing.name,
      updatedAt: NOW,
    };

    console.log(`UPDATE ${card.cardName.padEnd(16)} ${card.skillName.padEnd(8)} passive=${(card.passiveEffects || []).length} combat=${(card.combatEffects || []).length} proc=${procEffects.length}`);
    console.log(`       ${card.description}`);

    if (!dryRun) {
      await db.collection("items").updateOne({ _id: existing._id }, { $set: update });
    }
    updated++;
  }

  console.log("-".repeat(100));
  console.log(`完成：${dryRun ? "預覽" : "更新"} ${updated} 張卡`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
