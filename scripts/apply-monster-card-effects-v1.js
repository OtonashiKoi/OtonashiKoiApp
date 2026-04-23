require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const ZERO_STATS = { str: 0, agi: 0, vit: 0, int: 0, dex: 0, luk: 0 };

function duration(value) {
  return { mode: "turns", value };
}

function effect(key, target, value, turns, params = {}) {
  return {
    key,
    target,
    trigger: "on_hit",
    chance: 100,
    sourcePhase: "proc",
    params: {
      value,
      duration: duration(turns),
      ...params
    }
  };
}

function skill(key, name, description, chance, procEffects, cooldownTurns = 0) {
  return {
    key,
    name,
    description,
    chance,
    cooldownTurns,
    trigger: "on_hit",
    procEffects
  };
}

const CARD_DESIGNS = [
  {
    id: "daishi-b-card",
    monsterName: "大史(B)",
    cardName: "大史(B)卡",
    tier: "D",
    boss: true,
    skill: skill("daishi_crit_rate", "致命一擊", "自身暴擊率+15%，持續1回合。", 10, [
      effect("crit_rate_up", "self", 15, 1)
    ])
  },
  {
    id: "xiaoshi-small-card",
    monsterName: "小史(小)",
    cardName: "小史(小)卡",
    tier: "D",
    skill: skill("small_slime_lifesteal", "生命偷取", "造成傷害的15%轉為自身回復，持續1回合。", 10, [
      effect("lifesteal", "self", 15, 1)
    ])
  },
  {
    monsterName: "小史",
    cardName: "小史卡",
    tier: "D",
    skill: skill("slime_def_combo", "黏液防禦", "DEF上升15%；同時裝備小史(小)卡與小史(中)卡時，DEF上升50%。", 15, [
      effect("def_up", "self", 15, 1, {
        bonusIfEquippedNames: ["小史(小)卡", "小史(中)卡"],
        bonusIfEquippedValue: 50
      })
    ])
  },
  {
    id: "xiaolang-card",
    monsterName: "小狼",
    cardName: "小狼卡",
    tier: "D",
    skill: skill("wolf_agi_up", "迅捷狼影", "自身AGI+3，持續2回合，不可疊加。", 10, [
      effect("agi_up", "self", 3, 2, { stackMode: "refresh" })
    ])
  },
  {
    id: "stone-card",
    monsterName: "石頭",
    cardName: "石頭卡",
    tier: "D",
    skill: skill("stone_def_up", "石皮防禦", "自身DEF+10，持續1回合。", 10, [
      effect("def_up", "self", 10, 1, { mode: "flat" })
    ])
  },
  {
    id: "grass-goblin-card",
    monsterName: "青草地精",
    cardName: "青草地精卡",
    tier: "D",
    skill: skill("grass_goblin_atk_stack", "妖靈之力", "自身攻擊力+5%，持續2回合，最高疊加至10%。", 10, [
      effect("atk_up", "self", 5, 2, { stackMode: "stack_value", stackAdd: 5, maxValue: 10 })
    ])
  },
  {
    id: "goblin-card",
    monsterName: "哥布",
    cardName: "哥布卡",
    tier: "D",
    skill: skill("goblin_atk_down", "降攻", "敵方攻擊力-5%，持續2回合，最高疊加至10%。", 10, [
      effect("atk_down", "enemy", 5, 2, { stackMode: "stack_value", stackAdd: 5, maxValue: 10 })
    ])
  },
  {
    id: "green-wolf-card",
    monsterName: "綠野狼",
    cardName: "綠野狼卡",
    tier: "D",
    skill: skill("green_wolf_bleed", "撕裂流血", "每回合依照自身攻擊力的2%造成流血傷害，持續3回合，最高疊加到8%，每回合最多30點。", 10, [
      effect("bleed", "enemy", 2, 3, { mode: "caster_atk_pct", stackMode: "stack_value", stackAdd: 2, maxValue: 8, maxDamage: 30 })
    ])
  },
  {
    monsterName: "大野兔(B)",
    cardName: "大野兔(B)卡",
    tier: "D",
    boss: true,
    skill: skill("big_rabbit_crit_damage", "強襲跳擊", "自身爆擊傷害+15%，持續1回合。", 10, [
      effect("crit_damage_up", "self", 15, 1)
    ])
  },
  {
    monsterName: "小史(中)",
    cardName: "小史(中)卡",
    tier: "D",
    skill: skill("medium_slime_lifesteal", "黏液吸收", "造成傷害的15%轉為自身回復，持續1回合。", 10, [
      effect("lifesteal", "self", 15, 1)
    ])
  },
  {
    monsterName: "野兔",
    cardName: "野兔卡",
    tier: "D",
    skill: skill("rabbit_crit_rate", "靈巧突襲", "自身暴擊率+5%，持續3回合。", 10, [
      effect("crit_rate_up", "self", 5, 3)
    ])
  },
  {
    monsterName: "蘑菇怪",
    cardName: "蘑菇怪卡",
    tier: "D",
    skill: skill("mushroom_paralyze", "麻痺孢子", "造成敵方麻痺，命中率下降15%，持續1回合。", 5, [
      effect("hit_down", "enemy", 15, 1)
    ])
  },
  {
    id: "fang-wolf-card",
    monsterName: "牙牙狼",
    cardName: "牙牙狼卡",
    tier: "C",
    skill: skill("fang_wolf_bleed", "牙裂流血", "敵方每回合流血扣除最大HP 0.5%，持續1回合。", 5, [
      effect("bleed", "enemy", 0.5, 1, { mode: "target_max_hp_pct" })
    ])
  },
  {
    id: "giant-card",
    monsterName: "巨巨",
    cardName: "巨巨卡",
    tier: "C",
    skill: skill("giant_stun", "重擊擊暈", "敵方被暈眩，持續1回合。", 5, [
      effect("stun", "enemy", 100, 1)
    ])
  },
  {
    id: "crab-card",
    monsterName: "甲蟹",
    cardName: "甲蟹卡",
    tier: "C",
    skill: skill("crab_counter", "甲殼反擊", "受擊後反擊，造成所受傷害的30%，持續1回合。", 5, [
      effect("counter", "self", 100, 1, { counterDamagePct: 30 })
    ])
  },
  {
    id: "mira-b-card",
    monsterName: "米拉桑(B)",
    cardName: "米拉桑(B)卡",
    tier: "C",
    boss: true,
    skill: skill("mira_charm", "魅惑", "使敵方魅惑，降低傷害15%，持續2回合。", 10, [
      effect("charm", "enemy", 15, 2)
    ])
  },
  {
    id: "dark-archer-card",
    monsterName: "黑暗弓手",
    cardName: "黑暗弓手卡",
    tier: "C",
    skill: skill("dark_archer_silence", "沉默箭", "使敵方沉默，無法施放技能，持續2回合。", 10, [
      effect("silence", "enemy", 100, 2)
    ])
  },
  {
    monsterName: "小金(稀)",
    cardName: "小金(稀)卡",
    tier: "C",
    skill: skill("golden_dodge", "金光閃避", "自身迴避率提升10%，持續2回合。", 15, [
      effect("dodge_up", "self", 10, 2)
    ])
  },
  {
    monsterName: "中金(稀)",
    cardName: "中金(稀)卡",
    tier: "C",
    skill: skill("mid_gold_dodge_combo", "金影閃避", "自身迴避率提升10%，持續2回合；同時裝備小金(稀)卡時，迴避率提升20%。", 15, [
      effect("dodge_up", "self", 10, 2, {
        bonusIfEquippedAnyNames: ["小金(稀)卡", "小金(稀有)卡"],
        bonusIfEquippedValue: 20
      })
    ])
  },
  {
    id: "forest-spirit-card",
    monsterName: "林地妖靈(樹樹)",
    cardName: "林地妖靈卡",
    tier: "B",
    skill: skill("forest_spirit_lifesteal", "強效生命偷取", "造成傷害的30%轉為自身回復，持續1回合。", 10, [
      effect("lifesteal", "self", 30, 1)
    ])
  },
  {
    id: "forest-beast-card",
    monsterName: "森林之獸",
    cardName: "森林之獸卡",
    tier: "B",
    skill: skill("forest_beast_atk_stack", "獸性覺醒", "自身攻擊力+7%，持續2回合，最高疊加至21%。", 10, [
      effect("atk_up", "self", 7, 2, { stackMode: "stack_value", stackAdd: 7, maxValue: 21 })
    ])
  },
  {
    id: "forest-tree-card",
    monsterName: "森林古樹",
    cardName: "森林古樹卡",
    tier: "B",
    skill: skill("forest_tree_agi_down", "根鬚纏足", "敵方AGI-10，持續2回合，不可疊加。", 5, [
      effect("agi_down", "enemy", 10, 2, { stackMode: "refresh" })
    ])
  },
  {
    id: "forest-wizard-card",
    monsterName: "森林巫師",
    cardName: "森林巫師卡",
    tier: "B",
    skill: skill("forest_wizard_lightning", "雷擊術", "依照自身攻擊力110%施展雷擊，持續2回合；發動後冷卻3回合。", 5, [
      effect("lightning", "enemy", 110, 2, { mode: "caster_atk_pct" })
    ], 3)
  },
  {
    id: "forest-rogue-card",
    monsterName: "森林盜賊",
    cardName: "森林盜賊卡",
    tier: "B",
    skill: skill("forest_rogue_atk_down", "森林暗算", "敵方攻擊力-7%，持續2回合，最高疊加至21%。", 10, [
      effect("atk_down", "enemy", 7, 2, { stackMode: "stack_value", stackAdd: 7, maxValue: 21 })
    ])
  },
  {
    id: "night-leopard-card",
    monsterName: "暗夜獵豹",
    cardName: "暗夜獵豹卡",
    tier: "B",
    skill: skill("night_leopard_bleed", "夜襲撕裂", "每回合依照自身攻擊力10%造成持續傷害，持續3回合，最高疊加到15%，每回合最多50點。", 10, [
      effect("bleed", "enemy", 10, 3, { mode: "caster_atk_pct", stackMode: "stack_value", stackAdd: 5, maxValue: 15, maxDamage: 50 })
    ])
  },
  {
    monsterName: "古城弓手",
    cardName: "古城弓手卡",
    tier: "A",
    skill: skill("castle_archer_dex", "高位狙擊", "血量高於50%時，自身命中率+10，持續1回合。", 25, [
      effect("hit_up", "self", 10, 1, { ownerHpAbovePct: 50 })
    ])
  },
  {
    monsterName: "古城狂戰士",
    cardName: "古城狂戰士卡",
    tier: "A",
    skill: skill("castle_berserker_crit", "瀕死狂暴", "血量低於30%時，自身爆擊率+10%，持續1回合。", 25, [
      effect("crit_rate_up", "self", 10, 1, { ownerHpBelowPct: 30 })
    ])
  },
  {
    monsterName: "古城刺客",
    cardName: "古城刺客卡",
    tier: "A",
    skill: skill("castle_assassin_agi", "暗影先手", "血量高於80%時，自身迴避+5、攻擊力-5%，持續1回合。", 25, [
      effect("dodge_up", "self", 5, 1, { ownerHpAbovePct: 80 }),
      effect("atk_down", "self", 5, 1, { ownerHpAbovePct: 80 })
    ])
  },
  {
    monsterName: "古城法師",
    cardName: "古城法師卡",
    tier: "A",
    skill: skill("castle_mage_int", "古城術式", "血量高於60%時，自身攻擊力+10%，持續1回合。", 25, [
      effect("atk_up", "self", 10, 1, { ownerHpAbovePct: 60 })
    ])
  },
  {
    monsterName: "古城將軍(B)",
    cardName: "古城將軍(B)卡",
    tier: "A",
    boss: true,
    skill: skill("castle_general_def_ignore", "破陣指揮", "攻擊時無視敵方20%防禦；若目標處於Debuff狀態，提升至30%，持續1回合。", 15, [
      effect("def_ignore", "self", 20, 1, { bonusIfTargetDebuffed: 30 })
    ])
  },
  {
    monsterName: "石像鬼",
    cardName: "石像鬼卡",
    tier: "A",
    skill: skill("gargoyle_vit", "石像守勢", "血量低於50%時，自身DEF+20，持續1回合。", 25, [
      effect("def_up", "self", 20, 1, { mode: "flat", ownerHpBelowPct: 50 })
    ])
  },
  {
    monsterName: "冰封騎士",
    cardName: "冰封騎士卡",
    tier: "A",
    skill: skill("frozen_knight_str", "冰封斬擊", "血量高於50%時，自身攻擊力+10%，持續1回合。", 25, [
      effect("atk_up", "self", 10, 1, { ownerHpAbovePct: 50 })
    ])
  },
  {
    monsterName: "城堡魔像(B)",
    cardName: "城堡魔像(B)卡",
    tier: "A",
    boss: true,
    skill: skill("castle_golem_petrify", "石化再生", "血量低於30%時免疫傷害1回合，並恢復自身15%HP；冷卻3回合。", 50, [
      effect("invincible_short", "self", 100, 1, { ownerHpBelowPct: 30 }),
      effect("heal_over_time", "self", 15, 1, { ownerHpBelowPct: 30 })
    ], 3)
  },
  {
    monsterName: "城牆衛兵",
    cardName: "城牆衛兵卡",
    tier: "A",
    skill: skill("wall_guard_counter", "城牆反擊", "受到攻擊時反擊所受傷害40%，並使自身DEF+5，可疊加，持續2回合。", 20, [
      effect("counter", "self", 100, 2, { counterDamagePct: 40 }),
      effect("def_up", "self", 5, 2, { mode: "flat", stackMode: "stack_value", stackAdd: 5, maxValue: 50 })
    ])
  },
  {
    monsterName: "毒霧蜘蛛",
    cardName: "毒霧蜘蛛卡",
    tier: "A",
    skill: skill("poison_spider_dot", "毒霧侵蝕", "每回合依照自身攻擊力10%造成中毒傷害，持續3回合，最高疊加到15%，每回合最多50點。", 10, [
      effect("poison", "enemy", 10, 3, { mode: "caster_atk_pct", stackMode: "stack_value", stackAdd: 5, maxValue: 15, maxDamage: 50 })
    ])
  },
  {
    monsterName: "詛咒祭司",
    cardName: "詛咒祭司卡",
    tier: "A",
    skill: skill("curse_priest_debuff", "衰弱詛咒", "使敵方攻擊與防禦-10%，持續2回合；若目標已有Debuff，效果提升至-15%。", 20, [
      effect("atk_down", "enemy", 10, 2, { bonusIfTargetDebuffed: 15 }),
      effect("def_down", "enemy", 10, 2, { bonusIfTargetDebuffed: 15 })
    ])
  },
  {
    monsterName: "黑焰巫師",
    cardName: "黑焰巫師卡",
    tier: "A",
    skill: skill("blackflame_wizard_burn", "黑焰術", "每回合造成自身攻擊力110%的燃燒傷害，持續3回合；發動後冷卻3回合。", 15, [
      effect("burn", "enemy", 110, 3, { mode: "caster_atk_pct" })
    ], 3)
  },
  {
    monsterName: "廢都魔王(B)",
    cardName: "廢都魔王(B)卡",
    tier: "A",
    boss: true,
    skill: skill("ruin_demon_execute", "魔王追擊", "敵方血量低於30%時，自身造成傷害+30%，持續1回合。", 15, [
      effect("final_damage_up", "self", 30, 1, { targetHpBelowPct: 30 })
    ])
  },
  {
    monsterName: "廢墟蠍兵",
    cardName: "廢墟蠍兵卡",
    tier: "A",
    skill: skill("ruin_scorpion_poison_bonus", "毒蠍追擊", "對中毒中的敵人傷害+20%。", 100, [
      effect("bonus_vs_poisoned", "self", 20, 1)
    ])
  },
  {
    monsterName: "鐵甲衛將",
    cardName: "鐵甲衛將卡",
    tier: "A",
    skill: skill("iron_guard_stance", "鐵甲守勢", "血量高於70%時受到傷害-20%；血量低於20%時恢復最大HP的5%，持續1回合。", 25, [
      effect("damage_reduction", "self", 20, 1, { ownerHpAbovePct: 70 }),
      effect("heal_over_time", "self", 5, 1, { ownerHpBelowPct: 20 })
    ])
  },
  {
    monsterName: "大史王",
    cardName: "大史王卡",
    tier: "A",
    boss: true,
    skill: skill("daishi_king_lightning", "王者雷擊", "造成自身攻擊力150%的雷擊傷害，持續1回合。", 50, [
      effect("lightning", "enemy", 150, 1, { mode: "caster_atk_pct" })
    ])
  }
];

function slugifyName(name) {
  return `monster-card-${Buffer.from(name).toString("hex").slice(0, 24)}`;
}

function cloneForEquipment(item) {
  if (!item) return null;
  return {
    itemId: item.id,
    itemName: item.name,
    itemType: item.itemType,
    itemEffect: item.effect || { type: "none", value: 0 },
    useEffects: item.useEffects || [],
    passiveEffects: item.passiveEffects || [],
    procEffects: item.procEffects || [],
    combatEffects: item.combatEffects || [],
    imageUrl: item.imageUrl || null,
    imageThumbnailUrl: item.imageThumbnailUrl || null,
    equipSlot: item.equipSlot || null,
    equipStats: item.equipStats || null,
    weaponType: item.weaponType || null,
    isTwoHanded: item.isTwoHanded || false,
    atkStat: item.atkStat || null,
    tier: item.tier || null,
    monsterCardSkill: item.monsterCardSkill || null,
    monsterCardOf: item.monsterCardOf || null
  };
}

async function main() {
  const db = await getMongoDb();
  const now = new Date().toISOString();
  const monsters = await db.collection("monsters").find({ id: { $exists: true } }).toArray();
  const monstersByName = new Map(monsters.map((monster) => [monster.name, monster]));
  const generatedCards = await db.collection("items").find({ id: /^monster-card-/ }).toArray();
  const generatedByMonsterId = new Map();
  for (const card of generatedCards) {
    const monsterId = String(card.id || "").replace(/^monster-card-/, "");
    generatedByMonsterId.set(monsterId, card);
  }

  const updated = [];
  const missing = [];

  for (const design of CARD_DESIGNS) {
    const monster = monstersByName.get(design.monsterName);
    if (!monster) {
      missing.push(design.monsterName);
      continue;
    }

    const generated = generatedByMonsterId.get(monster.id);
    const existing = (
      (design.id ? await db.collection("items").findOne({ id: design.id }) : null)
      || await db.collection("items").findOne({ name: design.cardName })
      || await db.collection("items").findOne({ itemName: design.cardName })
      || await db.collection("items").findOne({ monsterCardOf: monster.id, itemType: "equipment", equipSlot: "special" })
      || await db.collection("items").findOne({ monsterCardOf: monster.id, itemType: "monster_card" })
    );
    const id = existing?.id || design.id || generated?.id || slugifyName(design.cardName);
    const imageUrl = existing?.imageUrl ?? generated?.imageUrl ?? monster.imageUrl ?? null;
    const imageThumbnailUrl = existing?.imageThumbnailUrl ?? generated?.imageThumbnailUrl ?? monster.imageThumbnailUrl ?? null;
    const itemDoc = {
      ...(existing || {}),
      id,
      itemId: id,
      name: design.cardName,
      itemName: design.cardName,
      description: design.skill.description,
      itemType: "equipment",
      equipSlot: "special",
      slotType: "special_1",
      equipStats: ZERO_STATS,
      effect: { type: "none", value: 0 },
      useEffects: [],
      passiveEffects: [],
      procEffects: design.skill.procEffects,
      combatEffects: [],
      monsterCardOf: monster.id,
      monsterName: monster.name,
      monsterCardSkill: design.skill,
      tier: design.tier,
      rarity: design.boss ? "boss" : (design.tier === "A" ? "legendary" : design.tier === "B" ? "epic" : design.tier === "C" ? "rare" : "uncommon"),
      dropable: true,
      tradeable: existing?.tradeable ?? false,
      sellValue: existing?.sellValue ?? 0,
      imageUrl,
      imageThumbnailUrl,
      updatedAt: now
    };

    await db.collection("items").updateOne({ id }, { $set: itemDoc }, { upsert: true });
    await db.collection("items").updateMany(
      {
        monsterCardOf: monster.id,
        itemType: "equipment",
        equipSlot: "special",
        id: { $ne: id }
      },
      {
        $set: {
          itemType: "monster_card",
          equipSlot: null,
          slotType: null,
          updatedAt: now
        }
      }
    );
    await db.collection("monsters").updateOne(
      { id: monster.id },
      {
        $set: {
          "equipment.special_1": cloneForEquipment(itemDoc),
          monsterCardSkill: design.skill,
          updatedAt: now
        }
      }
    );
    updated.push(`${design.cardName} -> ${monster.name}`);
  }

  console.log(JSON.stringify({ updatedCount: updated.length, updated, missing }, null, 2));
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  CARD_DESIGNS,
  main
};
