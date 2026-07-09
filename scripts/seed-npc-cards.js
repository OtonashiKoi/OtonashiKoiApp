"use strict";
/**
 * 主線 NPC 卡片(8 張) — 依 storyNpcs 立繪製作可裝備收藏卡。
 * equipSlot: special；觸發型用 monsterCardSkill(proc)，常駐型用 passiveEffects。
 * 卡片以 npcCardOf 標記來源 NPC。冪等：以 id upsert。
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const NOW = new Date().toISOString();

// —— NPC 立繪(來自 storyNpcs.portraitUrl) ——
const PORTRAIT = {
  "npc-ch1-examiner":   "https://res.cloudinary.com/dxcbxpqmj/image/upload/e_trim,f_auto,q_auto/v1783321845/equipment-game/story-npcs/xvemqt2xzp3mfwfhwoje.png",
  "npc-player-sister":  "https://res.cloudinary.com/dxcbxpqmj/image/upload/e_trim,f_auto,q_auto/v1783321871/equipment-game/story-npcs/zgr8pirlnvuio2t8040c.png",
  "npc-ikea-koi":       "https://res.cloudinary.com/dxcbxpqmj/image/upload/e_trim,f_auto,q_auto/v1783276609/equipment-game/story-npcs/zodjlxojykjcy6dkeqm9.png",
  "npc-ch1-registrar":  "https://res.cloudinary.com/dxcbxpqmj/image/upload/e_trim,f_auto,q_auto/v1783321849/equipment-game/story-npcs/lfcepctis5jzozm6tlgj.png",
  "npc-ch1-student":    "https://res.cloudinary.com/dxcbxpqmj/image/upload/e_trim,f_auto,q_auto/v1783321858/equipment-game/story-npcs/hqokdyn3boh8gwet55ke.png",
  "npc-ch1-passerby-a": "https://res.cloudinary.com/dxcbxpqmj/image/upload/e_trim,f_auto,q_auto/v1783321862/equipment-game/story-npcs/ag72wzipoewhazedafzc.png",
  "npc-ch1-passerby-b": "https://res.cloudinary.com/dxcbxpqmj/image/upload/e_trim,f_auto,q_auto/v1783321867/equipment-game/story-npcs/axvyil41kfsajjalmbuv.png",
  "npc-ch1-staff":      "https://res.cloudinary.com/dxcbxpqmj/image/upload/e_trim,f_auto,q_auto/v1783321854/equipment-game/story-npcs/xquqqrxrb0jqh6ztddjt.png"
};

const RARITY = { A: "epic", B: "rare", C: "uncommon", D: "common" };

// 常駐 passive 效果 helper
function passive(key, value, extraParams = {}, target = "self", condition = null) {
  return {
    key, category: "stat", trigger: "passive", target, chance: 100,
    stacks: 1, stackMode: "replace", duration: { mode: "battle", value: 1 },
    sourcePhase: "passive", params: { value, ...extraParams }, condition
  };
}
// proc 效果 helper(觸發持續 turns)
function proc(key, value, turns, target = "self") {
  return {
    key, target, trigger: "on_hit", chance: 100, sourcePhase: "proc",
    params: { value, duration: { mode: "turns", value: turns } }
  };
}

// —— 8 張卡設計 ——
const CARDS = [
  {
    npcId: "npc-ch1-examiner", name: "測驗教官卡", tier: "A",
    desc: "「嚴格指導」發動率 35%(冷卻2)：無視防禦+15%、命中+10%，持續3回合。",
    equipStats: { str: 5, agi: 0, vit: 0, int: 0, dex: 4, luk: 0 },
    skill: {
      key: "examiner_strict", name: "嚴格指導", description: "發動率 35%(冷卻2回合)：無視防禦+15%、命中+10%，持續3回合。",
      chance: 35, cooldownTurns: 2, trigger: "on_hit",
      procEffects: [proc("def_ignore", 15, 3), proc("hit_up", 10, 3)]
    }
  },
  {
    npcId: "npc-player-sister", name: "玩家妹妹卡", tier: "B",
    desc: "「妹妹的加油」常駐：每回合回復 2% 最大生命、連擊率+6。",
    equipStats: { str: 0, agi: 0, vit: 3, int: 2, dex: 0, luk: 1 },
    passives: [passive("life_regen", 2, { mode: "pct" }), passive("combo_up", 6)]
  },
  {
    npcId: "npc-ikea-koi", name: "IK※A鯉鯉卡", tier: "B",
    desc: "「組裝完成」發動率 20%(冷卻4)：最終傷害+40%，持續1回合；常駐金幣獲得+15%。",
    equipStats: { str: 3, agi: 0, vit: 0, int: 0, dex: 2, luk: 1 },
    passives: [passive("gold_gain_up", 15, {}, "self", null)],
    skill: {
      key: "ikea_assembled", name: "組裝完成", description: "發動率 20%(冷卻4回合)：最終傷害+40%，持續1回合。",
      chance: 20, cooldownTurns: 4, trigger: "on_hit",
      procEffects: [proc("final_damage_up", 40, 1)]
    }
  },
  {
    npcId: "npc-ch1-registrar", name: "報到人員卡", tier: "C",
    desc: "「快速報到」常駐：命中+8。",
    equipStats: { str: 0, agi: 1, vit: 0, int: 0, dex: 3, luk: 0 },
    passives: [passive("hit_up", 8)]
  },
  {
    npcId: "npc-ch1-student", name: "路人學員卡", tier: "D",
    desc: "「勤學不倦」常駐：經驗值獲得+10%。",
    equipStats: { str: 0, agi: 0, vit: 0, int: 1, dex: 0, luk: 1 },
    passives: [passive("exp_gain_up", 10)]
  },
  {
    npcId: "npc-ch1-passerby-a", name: "路人A卡", tier: "D",
    desc: "「路過助攻」常駐：武器倍率+8%。",
    equipStats: { str: 2, agi: 0, vit: 0, int: 0, dex: 0, luk: 0 },
    passives: [passive("atk_multiplier_up", 8)]
  },
  {
    npcId: "npc-ch1-passerby-b", name: "路人B卡", tier: "D",
    desc: "「圍觀鼓勵」常駐：暴擊率+4。",
    equipStats: { str: 0, agi: 0, vit: 0, int: 0, dex: 1, luk: 1 },
    passives: [passive("crit_rate_up", 4)]
  },
  {
    npcId: "npc-ch1-staff", name: "工作人員卡", tier: "D",
    desc: "「後勤支援」常駐：受到傷害-5%。",
    equipStats: { str: 0, agi: 0, vit: 2, int: 0, dex: 0, luk: 0 },
    passives: [passive("damage_reduction", 5)]
  }
];

(async () => {
  const db = await getMongoDb();
  const items = db.collection("items");
  const npcNames = {};
  for (const n of await db.collection("storyNpcs").find({}).toArray()) npcNames[n.id] = n.name;

  for (const c of CARDS) {
    const id = `npc-card-${c.npcId}`;
    const img = PORTRAIT[c.npcId];
    if (!img) { console.log("⚠️ 缺立繪:", c.npcId); continue; }
    const doc = {
      id, itemId: id, name: c.name, itemName: c.name,
      description: c.desc,
      itemType: "equipment",
      effect: { type: "none", value: 0 },
      useEffects: [],
      passiveEffects: c.passives || [],
      procEffects: c.skill ? c.skill.procEffects : [],
      combatEffects: [],
      equipSlot: "special", slotType: "special_1",
      equipStats: c.equipStats,
      weaponType: null, isTwoHanded: false, atkStat: null,
      tier: c.tier, rarity: RARITY[c.tier],
      imageUrl: img, imageThumbnailUrl: img,
      isNpcCard: true,
      npcCardOf: c.npcId,
      npcCardMeta: { npcName: npcNames[c.npcId] || c.name.replace(/卡$/, ""), chapter: "ch1" },
      dropable: false, tradeable: false, sellValue: 0,
      updatedAt: NOW
    };
    if (c.skill) {
      doc.monsterCardSkill = {
        key: c.skill.key, name: c.skill.name, description: c.skill.description,
        chance: c.skill.chance, cooldownTurns: c.skill.cooldownTurns,
        trigger: c.skill.trigger, procEffects: c.skill.procEffects
      };
    }
    const exist = await items.findOne({ id });
    if (exist) {
      await items.updateOne({ id }, { $set: doc });
      console.log(`♻️  更新 ${c.name} (${c.tier}/${RARITY[c.tier]})`);
    } else {
      doc.createdAt = NOW;
      await items.insertOne(doc);
      console.log(`✨ 新增 ${c.name} (${c.tier}/${RARITY[c.tier]})  ${c.skill ? "觸發" : "常駐"}`);
    }
  }
  console.log("\n完成：8 張 NPC 卡已寫入 items。");
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
