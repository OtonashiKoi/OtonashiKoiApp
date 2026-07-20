"use strict";
// 職業主動技能寫入工具。
//
// ⚠️ 本檔的 JOB_SKILLS 是「線上正式庫 equipmentGame 的鏡像」，於 2026-07-20 從 DB 反向產生。
//    先前這裡的資料比線上舊（且腳本寫錯資料庫寫進 equipment_game 空庫），已一併修正。
//    日後在後台或 DB 直接調過技能後，請把改動同步回這裡，避免再次出現落差。
//
// 用法（必須指定職業 key，避免誤覆蓋其他職業）：
//   node scripts/write_job_skills.js gambler
//   node scripts/write_job_skills.js all      ← 確定要覆蓋全部時才用
require("dotenv").config();
const { MongoClient } = require("mongodb");
const client = new MongoClient(process.env.MONGO_URI || "mongodb://127.0.0.1:27017");

const JOB_SKILLS = {
  swordsman: [ // 劍士徽章
    {
      key: "swordsman_shield_bash",
      name: "舉步若堅",
      description: "格擋率+25%、DEF+12，持續2回合。",
      cooldownTurns: 3,
      condition: {},
      procEffects: [
        {"key":"block_chance_up","target":"self","params":{"value":25,"duration":{"mode":"turns","value":2}}},
        {"key":"def_up","target":"self","params":{"value":12,"mode":"flat","duration":{"mode":"turns","value":2}}}
      ]
    },
    {
      key: "swordsman_armor_rend",
      name: "碎甲斬",
      description: "敵方DEF-10，持續3回合，可疊加至-30。",
      cooldownTurns: 3,
      condition: {},
      procEffects: [
        {"key":"def_down","target":"enemy","params":{"value":10,"duration":{"mode":"turns","value":3},"stackMode":"stack_value","stackAdd":10,"maxValue":30}}
      ]
    }
  ],
  warrior: [ // 戰士徽章
    {
      key: "warrior_berserk",
      name: "踢到桌腳很生氣",
      description: "自身ATK+25%，持續2回合。",
      cooldownTurns: 4,
      condition: {},
      procEffects: [
        {"key":"atk_up","target":"self","params":{"value":25,"duration":{"mode":"turns","value":2}}}
      ]
    },
    {
      key: "warrior_death_will",
      name: "死亡意志",
      description: "HP低於35%時發動：免疫傷害1回合並ATK+50%，持續1回合。",
      cooldownTurns: 5,
      condition: {"ownerHpBelowPct":35},
      procEffects: [
        {"key":"invincible_short","target":"self","params":{"value":100,"duration":{"mode":"turns","value":1}}},
        {"key":"atk_up","target":"self","params":{"value":50,"duration":{"mode":"turns","value":1}}}
      ]
    }
  ],
  dwarf_warrior: [ // 矮人戰士徽章
    {
      key: "dwarf_iron_wall",
      name: "鐵壁",
      description: "受傷降低25%、DEF+15，持續2回合。",
      cooldownTurns: 2,
      condition: {},
      procEffects: [
        {"key":"damage_reduction","target":"self","params":{"value":25,"duration":{"mode":"turns","value":2}}},
        {"key":"def_up","target":"self","params":{"value":15,"mode":"flat","duration":{"mode":"turns","value":2}}}
      ]
    },
    {
      key: "dwarf_quake_strike",
      name: "震地重擊",
      description: "敵方暈眩1回合並ATK-10%，持續2回合。",
      cooldownTurns: 4,
      condition: {},
      procEffects: [
        {"key":"stun","target":"enemy","params":{"value":100,"duration":{"mode":"turns","value":1}}},
        {"key":"atk_down","target":"enemy","params":{"value":10,"duration":{"mode":"turns","value":2}}}
      ]
    }
  ],
  archer: [ // 弓箭手徽章
    {
      key: "archer_aim",
      name: "瞄準",
      description: "命中+20、爆擊率+15%，持續2回合。",
      cooldownTurns: 3,
      condition: {},
      procEffects: [
        {"key":"hit_up","target":"self","params":{"value":20,"duration":{"mode":"turns","value":2}}},
        {"key":"crit_rate_up","target":"self","params":{"value":15,"duration":{"mode":"turns","value":2}}}
      ]
    },
    {
      key: "archer_pierce_arrow",
      name: "穿刺箭",
      description: "ATK+20%、敵方DEF-15、自身爆擊率+20%，持續2回合。",
      cooldownTurns: 3,
      condition: {},
      procEffects: [
        {"key":"atk_up","target":"self","params":{"value":20,"duration":{"mode":"turns","value":2}}},
        {"key":"def_down","target":"enemy","params":{"value":15,"duration":{"mode":"turns","value":2}}},
        {"key":"crit_rate_up","target":"self","params":{"value":20,"duration":{"mode":"turns","value":2}}}
      ]
    }
  ],
  mage: [ // 法師徽章
    {
      key: "mage_mana_burst",
      name: "魔力爆炎",
      description: "自身ATK+40%並無視防禦+50%，持續1回合。",
      cooldownTurns: 3,
      condition: {},
      procEffects: [
        {"key":"atk_up","target":"self","params":{"value":40,"duration":{"mode":"turns","value":1}}},
        {"key":"def_ignore","target":"self","params":{"value":50,"duration":{"mode":"turns","value":1}}}
      ]
    },
    {
      key: "mage_mana_drain",
      name: "魔力衰減",
      description: "敵方最終傷害-25%、DEF-10，持續3回合。",
      cooldownTurns: 4,
      condition: {},
      procEffects: [
        {"key":"final_damage_down","target":"enemy","params":{"value":25,"duration":{"mode":"turns","value":3}}},
        {"key":"def_down","target":"enemy","params":{"value":10,"duration":{"mode":"turns","value":3}}}
      ]
    }
  ],
  rogue: [ // 盜賊徽章
    {
      key: "rogue_backstab",
      name: "背刺",
      description: "自身爆擊率+20%、爆擊傷害+30%，持續2回合。",
      cooldownTurns: 3,
      condition: {},
      procEffects: [
        {"key":"crit_rate_up","target":"self","params":{"value":20,"duration":{"mode":"turns","value":2}}},
        {"key":"crit_damage_up","target":"self","params":{"value":30,"duration":{"mode":"turns","value":2}}}
      ]
    },
    {
      key: "rogue_smoke_bomb",
      name: "煙霧彈",
      description: "敵方命中-20、自身迴避+12，持續2回合。",
      cooldownTurns: 4,
      condition: {},
      procEffects: [
        {"key":"hit_down","target":"enemy","params":{"value":20,"duration":{"mode":"turns","value":2}}},
        {"key":"dodge_up","target":"self","params":{"value":12,"duration":{"mode":"turns","value":2}}}
      ]
    }
  ],
  healer: [ // 治療師徽章
    {
      key: "healer_holy_light",
      name: "聖光術",
      description: "立即回復最大HP的12%。",
      cooldownTurns: 3,
      condition: {},
      procEffects: [
        {"key":"heal_over_time","target":"self","params":{"value":12,"mode":"pct","duration":{"mode":"turns","value":1}}}
      ]
    },
    {
      key: "healer_divine_shield",
      name: "神聖護盾",
      description: "HP低於60%時：受傷降低35%，持續2回合。",
      cooldownTurns: 4,
      condition: {"ownerHpBelowPct":60},
      procEffects: [
        {"key":"damage_reduction","target":"self","params":{"value":35,"duration":{"mode":"turns","value":2}}}
      ]
    }
  ],
  tactician: [ // 軍師徽章
    {
      key: "tactician_analysis",
      name: "戰術分析",
      description: "敵方DEF-15、ATK-10，持續3回合。",
      cooldownTurns: 4,
      condition: {},
      procEffects: [
        {"key":"def_down","target":"enemy","params":{"value":15,"duration":{"mode":"turns","value":3}}},
        {"key":"atk_down","target":"enemy","params":{"value":10,"duration":{"mode":"turns","value":3}}}
      ]
    },
    {
      key: "tactician_formation_break",
      name: "兵法破陣",
      description: "無視敵方防禦+35%、自身ATK+10%，持續2回合。",
      cooldownTurns: 5,
      condition: {},
      procEffects: [
        {"key":"def_ignore","target":"self","params":{"value":35,"duration":{"mode":"turns","value":2}}},
        {"key":"atk_up","target":"self","params":{"value":10,"duration":{"mode":"turns","value":2}}}
      ]
    }
  ],
  bard: [ // 詩人徽章
    {
      key: "bard_battle_anthem",
      name: "激昂旋律",
      description: "自身ATK+18%、AGI+8，持續2回合。",
      cooldownTurns: 3,
      condition: {},
      procEffects: [
        {"key":"atk_up","target":"self","params":{"value":18,"duration":{"mode":"turns","value":2}}},
        {"key":"agi_up","target":"self","params":{"value":8,"duration":{"mode":"turns","value":2}}}
      ]
    },
    {
      key: "bard_silence_song",
      name: "沉靜之歌",
      description: "敵方ATK-15%、AGI-6，持續3回合。",
      cooldownTurns: 4,
      condition: {},
      procEffects: [
        {"key":"atk_down","target":"enemy","params":{"value":15,"duration":{"mode":"turns","value":3}}},
        {"key":"agi_down","target":"enemy","params":{"value":6,"duration":{"mode":"turns","value":3}}}
      ]
    }
  ],
  barrier_mage: [ // 結界師徽章
    {
      key: "barrier_mage_barrier",
      name: "八門盾甲",
      description: "敵方受到傷害增加20%，持續2回合。",
      cooldownTurns: 3,
      condition: {},
      procEffects: [
        {"key":"damage_taken_up","target":"enemy","params":{"value":20,"duration":{"mode":"turns","value":2}}}
      ]
    },
    {
      key: "barrier_mage_reflect",
      name: "束縛之陣",
      description: "敵方迴避-50%、命中-30%，持續3回合。",
      cooldownTurns: 5,
      condition: {},
      procEffects: [
        {"key":"dodge_down","target":"enemy","params":{"value":50,"duration":{"mode":"turns","value":3}}},
        {"key":"hit_down","target":"enemy","params":{"value":30,"duration":{"mode":"turns","value":3}}}
      ]
    }
  ],
  // 賭徒：爆擊率天生靠 LUK 堆很高（Lv50 專精約 50%），所以技能補的是「爆傷」而不是爆率。
  //       與盜賊「背刺」的分工：盜賊堆爆率、賭徒堆爆傷。
  // 賭徒：技能走「自訂 trigger」，不吃其他職業那套「每回合 35% 隨機發動一個」的閘門。
  //   將大局逆轉吧 — trigger: on_dice_one     → 骰出 1 就必定發動（見 combatLoop 擲骰處）
  //   千術         — trigger: round_start_chance → 回合開始擲自己的 chance
  gambler: [ // 賭徒徽章
    {
      key: "gambler_turn_the_table",
      name: "將大局逆轉吧",
      description: "當回合有骰子擲出【1】時，重骰該顆骰子，並自身LUK+15持續1回合。",
      trigger: "on_dice_one",
      cooldownTurns: 2,
      condition: {},
      procEffects: [
        {"key":"luk_up","target":"self","params":{"value":15,"duration":{"mode":"turns","value":1}}}
      ]
    },
    {
      key: "gambler_loaded_dice",
      name: "千術",
      description: "50%機率發動：敵方本回合攻擊必定大失敗（自傷並無法攻擊）。",
      trigger: "round_start_chance",
      chance: 50,
      cooldownTurns: 3,
      condition: {},
      procEffects: [
        {"key":"force_crit_fail","target":"enemy","params":{"value":100,"duration":{"mode":"turns","value":1}}}
      ]
    }
  ]
};

const TARGET = process.argv[2];
if (!TARGET) {
  console.error("必須指定職業 key，避免誤覆蓋其他職業的線上設定。");
  console.error("可用 key:", Object.keys(JOB_SKILLS).join(", "), "或 all");
  console.error("例如: node scripts/write_job_skills.js gambler");
  process.exit(1);
}
if (TARGET !== "all" && !JOB_SKILLS[TARGET]) {
  console.error(`未知的職業 key: ${TARGET}`);
  console.error("可用 key:", Object.keys(JOB_SKILLS).join(", "), "或 all");
  process.exit(1);
}

async function main() {
  await client.connect();
  // 正式庫是 equipmentGame；equipment_game 是早期殘留的空庫，寫進去不會生效
  const db = client.db("equipmentGame");
  const col = db.collection("items");

  const badges = await col.find({ itemType: "job_badge" }).toArray();
  console.log("找到職業徽章數:", badges.length);

  let updated = 0;
  for (const badge of badges) {
    const id = String(badge.id || badge._id || "").toLowerCase();
    const name = String(badge.name || "").toLowerCase();
    let skills = null;

    if (id.includes("barrier_mage") || name.includes("結界")) skills = JOB_SKILLS.barrier_mage;
    else if (id.includes("dwarf") || name.includes("矮人")) skills = JOB_SKILLS.dwarf_warrior;
    else if (id.includes("swordsman") || name.includes("劍士")) skills = JOB_SKILLS.swordsman;
    else if (id.includes("warrior") || name.includes("戰士")) skills = JOB_SKILLS.warrior;
    else if (id.includes("archer") || name.includes("弓箭手")) skills = JOB_SKILLS.archer;
    else if (id.includes("tactician") || name.includes("軍師")) skills = JOB_SKILLS.tactician;
    else if (id.includes("bard") || name.includes("詩人")) skills = JOB_SKILLS.bard;
    else if (id.includes("healer") || name.includes("治療")) skills = JOB_SKILLS.healer;
    else if (id.includes("mage") || name.includes("法師")) skills = JOB_SKILLS.mage;
    else if (id.includes("rogue") || name.includes("盜賊")) skills = JOB_SKILLS.rogue;
    else if (id.includes("gambler") || name.includes("賭徒")) skills = JOB_SKILLS.gambler;

    if (!skills) { console.log("未匹配:", badge.name, "|", id); continue; }
    if (TARGET !== "all" && skills !== JOB_SKILLS[TARGET]) continue; // 只寫指定職業

    const r = await col.updateOne({ _id: badge._id }, { $set: { jobSkills: skills } });
    console.log(badge.name, "->", r.modifiedCount ? "✅ 已更新" : "✓ 已同步（內容相同）");
    updated += r.modifiedCount;
  }
  console.log("總更新:", updated, "筆");
  await client.close();
}
main().catch(console.error);
