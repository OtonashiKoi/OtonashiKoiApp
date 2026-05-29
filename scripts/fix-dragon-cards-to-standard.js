"use strict";
/**
 * 修正龍族 10 張卡：從錯誤的「always-on 被動卡」改回標準怪物卡結構
 * 對齊現有 41 張怪物卡：觸發式技能（chance% + on_hit + cooldown + procEffects）
 * 補齊 monsterCardOf / monsterCardMeta / monsterName / rarity / slotType / dropable / tradeable
 * 清空 passiveEffects（怪物卡不用被動，全走 monsterCardSkill 觸發）
 *
 * 執行：node scripts/fix-dragon-cards-to-standard.js [--dry-run]
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const NOW = new Date().toISOString();

// 共用 procEffect 產生器
function eff(key, target, value, dur, extra = {}) {
  return {
    key, target, trigger: "on_hit", chance: 100, sourcePhase: "proc",
    params: { value, duration: { mode: "turns", value: dur }, ...extra },
  };
}

// 龍族卡設計（觸發式技能，使用現有卡確定能運作的 key）
// 來源怪物名 → 卡片設計
const CARDS = {
  "飛龍幼崽": {
    key: "dragon_hatchling_dive", name: "俯衝突擊", chance: 30, cd: 0,
    desc: "攻擊時 30% 機率自身攻擊力+15%、爆擊率+10，持續 2 回合。",
    procEffects: [eff("atk_up", "self", 15, 2), eff("crit_rate_up", "self", 10, 2, { mode: "flat" })],
  },
  "龍蜥武士": {
    key: "dragonkin_warrior_counter", name: "龍鱗反震", chance: 25, cd: 0,
    desc: "受到攻擊時反擊所受傷害 60%，並使自身 DEF+10 可疊加（最高+40），持續 2 回合。",
    procEffects: [
      eff("counter", "self", 100, 2, { counterDamagePct: 60 }),
      eff("def_up", "self", 10, 2, { mode: "flat", stackMode: "stack_value", stackAdd: 10, maxValue: 40 }),
    ],
  },
  "火翼龍人": {
    key: "flame_winged_breath", name: "龍焰焚燒", chance: 40, cd: 0,
    desc: "攻擊時 40% 機率使敵方燃燒（每回合最大HP 1.2%）並流血，持續 3 回合。",
    procEffects: [
      eff("burn", "enemy", 1.2, 3, { mode: "pct" }),
      eff("bleed", "enemy", 10, 2, { mode: "flat" }),
    ],
  },
  "冰鱗龍人": {
    key: "frost_scale_freeze", name: "霜寒禁錮", chance: 30, cd: 0,
    desc: "攻擊時 30% 機率使敵方 AGI-25%、命中-15，持續 2 回合。",
    procEffects: [
      eff("agi_down", "enemy", 25, 2),
      eff("hit_down", "enemy", 15, 2, { mode: "flat" }),
    ],
  },
  "雷霆飛龍": {
    key: "thunder_wyvern_bolt", name: "雷霆貫穿", chance: 30, cd: 0,
    desc: "攻擊時 30% 機率召喚雷擊（自身攻擊力 80%）並擊破敵方 DEF-20%，持續 2 回合。",
    procEffects: [
      eff("lightning", "enemy", 80, 1, { mode: "caster_atk_pct" }),
      eff("def_down", "enemy", 20, 2),
    ],
  },
  "黑曜龍騎": {
    key: "obsidian_rider_pierce", name: "黑曜碎甲", chance: 35, cd: 0,
    desc: "攻擊時 35% 機率無視敵方 30% 防禦、自身攻擊力+15%，持續 1 回合。",
    procEffects: [
      eff("def_ignore", "self", 30, 1),
      eff("atk_up", "self", 15, 1),
    ],
  },
  "黃金幼龍(稀)": {
    key: "gold_dragonling_grace", name: "黃金護佑", chance: 50, cd: 3,
    desc: "攻擊時 50% 機率回復（每回合最大HP 8%）2 回合；HP 低於 30% 時額外免疫傷害 1 回合。冷卻 3 回合。",
    procEffects: [
      eff("heal_over_time", "self", 8, 2),
      eff("invincible_short", "self", 100, 1, { ownerHpBelowPct: 30 }),
    ],
  },
  "暗影龍將": {
    key: "shadow_dragon_drain", name: "影襲奪魂", chance: 35, cd: 0,
    desc: "攻擊時 35% 機率吸取造成傷害的 30% 為 HP，並提升爆擊傷害+30%，持續 2 回合。",
    procEffects: [
      eff("lifesteal", "self", 30, 2),
      eff("crit_damage_up", "self", 30, 2),
    ],
  },
  "龍翼魔法師": {
    key: "dragon_mage_seal", name: "龍語封印", chance: 35, cd: 2,
    desc: "攻擊時 35% 機率沉默敵方 1 回合並使其攻擊力-15%，持續 2 回合。冷卻 2 回合。",
    procEffects: [
      eff("silence", "enemy", 0, 1),
      eff("atk_down", "enemy", 15, 2),
    ],
  },
  "古龍王(B)": {
    key: "ancient_dragon_king_domain", name: "龍王威壓", chance: 50, cd: 3,
    desc: "攻擊時 50% 機率展開龍王領域：自身最終傷害+30%，敵方攻擊力-15%、AGI-15%，持續 3 回合。冷卻 3 回合。",
    procEffects: [
      eff("final_damage_up", "self", 30, 3),
      eff("atk_down", "enemy", 15, 3),
      eff("agi_down", "enemy", 15, 3),
    ],
  },
};

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const db = await getMongoDb();
  console.log(`修正龍族卡為標準怪物卡結構（dryRun=${dryRun}）`);
  console.log("─".repeat(95));

  let fixed = 0;
  for (const [monsterName, design] of Object.entries(CARDS)) {
    const monster = await db.collection("monsters").findOne({ zone: "dragon_realm", name: monsterName });
    if (!monster) { console.warn(`⚠ 找不到怪物 ${monsterName}`); continue; }
    const card = await db.collection("items").findOne({ name: monsterName + "卡", equipSlot: "special" });
    if (!card) { console.warn(`⚠ 找不到卡片 ${monsterName}卡`); continue; }

    const monsterUuid = monster.id; // monsterCardOf 指向來源怪物 id
    const skill = {
      key: design.key,
      name: design.name,
      description: design.desc,
      chance: design.chance,
      cooldownTurns: design.cd,
      trigger: "on_hit",
      procEffects: design.procEffects,
    };

    const update = {
      // 標準怪物卡欄位
      description: design.desc,
      passiveEffects: [],                 // 清空錯誤的被動
      procEffects: design.procEffects,    // top-level 鏡像
      combatEffects: [],
      useEffects: [],
      monsterCardSkill: skill,
      monsterCardOf: monsterUuid,
      monsterCardMeta: {
        monsterName,
        zone: "dragon_realm",
        seq: monster.seq || 0,
        level: monster.level || 0,
      },
      monsterName,
      rarity: monsterName.includes("(B)") ? "boss" : "legendary",
      slotType: "special_1",
      dropable: true,
      tradeable: true,
      equipStats: card.equipStats || { str: 0, agi: 0, vit: 0, int: 0, dex: 0, luk: 0 },
      itemId: card.id,
      itemName: card.name,
      sellValue: 0,
      updatedAt: NOW,
    };

    console.log(`FIX  ${(monsterName + "卡").padEnd(16)} ${design.name}（${design.chance}%${design.cd ? `/cd${design.cd}` : ""}）← 來源 ${monsterName} (id ${monsterUuid.slice(0, 8)})`);
    if (!dryRun) {
      await db.collection("items").updateOne({ _id: card._id }, { $set: update });
    }
    fixed++;
  }
  console.log("─".repeat(95));
  console.log(`完成：修正 ${fixed} 張${dryRun ? "（dry-run）" : ""}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
