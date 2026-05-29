"use strict";
/**
 * 為 dragon_realm 10 隻怪建立對應的 A 階怪物卡 + 加進該怪的 drops（chance=1%）
 *
 * 設計：每張卡 procEffects 給單一效果為主；BOSS 卡多重效果
 */
require("dotenv").config();
const crypto = require("node:crypto");
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const NOW = new Date().toISOString();

// 卡片設計（monsterName 對應 monsters.name）
const CARDS = [
  {
    monsterName: "飛龍幼崽",
    cardName: "飛龍幼崽卡",
    skill: {
      key: "dragon_hatchling_agi",
      name: "飛掠突襲",
      description: "攻擊時 40% 機率自身 AGI+10%，持續 2 回合。",
      chance: 40, cooldownTurns: 0, trigger: "on_hit",
      effects: [{ key: "agi_up", target: "self", value: 10, duration: 2 }],
    },
  },
  {
    monsterName: "龍蜥武士",
    cardName: "龍蜥武士卡",
    skill: {
      key: "dragonkin_warrior_counter",
      name: "鱗甲反擊",
      description: "受擊時 30% 機率反擊一次。",
      chance: 30, cooldownTurns: 0, trigger: "on_hit",
      effects: [{ key: "counter", target: "self", value: 50, duration: 1 }],
    },
  },
  {
    monsterName: "火翼龍人",
    cardName: "火翼龍人卡",
    skill: {
      key: "flame_winged_burn",
      name: "龍焰焚燒",
      description: "攻擊時 45% 機率讓敵方燃燒，每回合受 8 點傷害，持續 3 回合。",
      chance: 45, cooldownTurns: 0, trigger: "on_hit",
      effects: [{ key: "burn", target: "enemy", value: 8, duration: 3 }],
    },
  },
  {
    monsterName: "冰鱗龍人",
    cardName: "冰鱗龍人卡",
    skill: {
      key: "frost_scale_freeze",
      name: "冰封凍結",
      description: "攻擊時 40% 機率使敵方 AGI-15%，持續 2 回合。",
      chance: 40, cooldownTurns: 0, trigger: "on_hit",
      effects: [{ key: "agi_down", target: "enemy", value: 15, duration: 2 }],
    },
  },
  {
    monsterName: "雷霆飛龍",
    cardName: "雷霆飛龍卡",
    skill: {
      key: "thunder_wyvern_lightning",
      name: "雷霆萬鈞",
      description: "攻擊時 35% 機率附加雷擊額外傷害。",
      chance: 35, cooldownTurns: 0, trigger: "on_hit",
      effects: [{ key: "lightning", target: "enemy", value: 20, duration: 1 }],
    },
  },
  {
    monsterName: "黑曜龍騎",
    cardName: "黑曜龍騎卡",
    skill: {
      key: "obsidian_rider_def_break",
      name: "黑曜碎甲",
      description: "攻擊時 35% 機率敵方 DEF-25%，持續 2 回合。",
      chance: 35, cooldownTurns: 0, trigger: "on_hit",
      effects: [{ key: "def_down", target: "enemy", value: 25, duration: 2 }],
    },
  },
  {
    monsterName: "黃金幼龍(稀)",
    cardName: "黃金幼龍(稀)卡",
    skill: {
      key: "gold_dragonling_crit",
      name: "黃金加護",
      description: "攻擊時 60% 機率自身爆擊率+15%，持續 2 回合。",
      chance: 60, cooldownTurns: 0, trigger: "on_hit",
      effects: [{ key: "crit_rate_up", target: "self", value: 15, duration: 2 }],
    },
  },
  {
    monsterName: "暗影龍將",
    cardName: "暗影龍將卡",
    skill: {
      key: "shadow_dragon_pierce",
      name: "影襲穿透",
      description: "攻擊時 40% 機率無視敵方 25% 防禦，持續 1 回合。",
      chance: 40, cooldownTurns: 0, trigger: "on_hit",
      effects: [{ key: "def_ignore", target: "self", value: 25, duration: 1 }],
    },
  },
  {
    monsterName: "龍翼魔法師",
    cardName: "龍翼魔法師卡",
    skill: {
      key: "dragon_mage_silence",
      name: "龍語沉默",
      description: "攻擊時 40% 機率沉默敵方 1 回合；冷卻 2 回合。",
      chance: 40, cooldownTurns: 2, trigger: "on_hit",
      effects: [{ key: "silence", target: "enemy", value: 0, duration: 1 }],
    },
  },
  {
    monsterName: "古龍王(B)",
    cardName: "古龍王(B)卡",
    skill: {
      key: "ancient_dragon_king_aura",
      name: "龍王威壓",
      description: "攻擊時 60% 機率自身最終傷害+25%、敵方 ATK-15%，持續 2 回合；冷卻 3 回合。",
      chance: 60, cooldownTurns: 3, trigger: "on_hit",
      effects: [
        { key: "final_damage_up", target: "self",  value: 25, duration: 2 },
        { key: "atk_down",        target: "enemy", value: 15, duration: 2 },
      ],
    },
  },
];

function buildProcEffects(effects, trigger) {
  return effects.map((e) => ({
    key: e.key,
    target: e.target,
    trigger,
    chance: 100, // 卡片本身有 outer chance，內層命中 100%
    sourcePhase: "proc",
    params: {
      value: e.value,
      duration: { mode: "turns", value: e.duration },
    },
  }));
}

function buildCardDoc(card, monsterImageUrl = null, monsterThumbnailUrl = null) {
  const uuid = crypto.randomUUID();
  const id = `monster-card-${uuid}`;
  const procEffects = buildProcEffects(card.skill.effects, card.skill.trigger);

  const monsterCardSkill = {
    key: card.skill.key,
    name: card.skill.name,
    description: card.skill.description,
    chance: card.skill.chance,
    cooldownTurns: card.skill.cooldownTurns,
    trigger: card.skill.trigger,
    procEffects,
  };

  return {
    id,
    seq: 0,
    name: card.cardName,
    imageUrl: monsterImageUrl,
    imageThumbnailUrl: monsterThumbnailUrl,
    itemType: "equipment",
    equipSlot: "special",
    tier: "A",
    equipStats: { str: 0, agi: 0, vit: 0, int: 0, dex: 0, luk: 0 },
    monsterCardSkill,
    procEffects,
    passiveEffects: [],
    combatEffects: [],
    useEffects: [],
    weaponType: null,
    isTwoHanded: false,
    atkStat: null,
    effect: { type: "none", value: 0 },
    description: card.skill.description,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const db = await getMongoDb();

  console.log(`建立 ${CARDS.length} 張龍族卡片（dryRun=${dryRun}）`);
  console.log("─".repeat(95));

  let cardsAdded = 0, dropsAdded = 0;
  for (const card of CARDS) {
    // 找對應怪物
    const monster = await db.collection("monsters").findOne({ zone: "dragon_realm", name: card.monsterName });
    if (!monster) {
      console.warn(`⚠ 找不到怪物 ${card.monsterName}，跳過`);
      continue;
    }

    // 檢查是否已有同名卡
    const existing = await db.collection("items").findOne({ name: card.cardName, equipSlot: "special" });
    if (existing) {
      console.log(`UNCHANGED ${card.cardName}（已存在 id=${existing.id}）`);
    } else {
      const cardDoc = buildCardDoc(card, monster.imageUrl, monster.imageThumbnailUrl);
      console.log(`CREATE    ${cardDoc.name} → ${cardDoc.id}  skill=${cardDoc.monsterCardSkill.name}  chance=${cardDoc.monsterCardSkill.chance}%`);
      if (!dryRun) {
        await db.collection("items").insertOne(cardDoc);
      }
      cardsAdded++;
    }

    // 加進該怪 drops
    const cardId = existing?.id || (dryRun ? "(dry-run-pending)" : (await db.collection("items").findOne({ name: card.cardName, equipSlot: "special" }))?.id);
    if (!cardId || cardId === "(dry-run-pending)") continue;
    const drops = Array.isArray(monster.drops) ? [...monster.drops] : [];
    const hasDrop = drops.find((d) => d.itemId === cardId);
    if (!hasDrop) {
      drops.push({ itemId: cardId, itemName: card.cardName, chance: 1 });
      console.log(`          + drops on ${monster.name}: ${card.cardName}@1%`);
      if (!dryRun) {
        await db.collection("monsters").updateOne({ _id: monster._id }, { $set: { drops } });
      }
      dropsAdded++;
    }
  }
  console.log("─".repeat(95));
  console.log(`完成：新卡片 ${cardsAdded} / 新 drops ${dropsAdded}${dryRun ? "（dry-run）" : ""}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
