"use strict";
const { MongoClient } = require("mongodb");
const client = new MongoClient("mongodb://localhost:27017");

const JOB_SKILLS = {
  swordsman: [
    {
      key: "swordsman_shield_bash",
      name: "盾擊",
      description: "格擋率+25%、DEF+12，持續2回合。",
      cooldownTurns: 3,
      condition: {},
      procEffects: [
        { key: "block_chance_up", target: "self", params: { value: 25, duration: { mode: "turns", value: 2 } } },
        { key: "def_up", target: "self", params: { value: 12, mode: "flat", duration: { mode: "turns", value: 2 } } }
      ]
    },
    {
      key: "swordsman_armor_rend",
      name: "碎甲斬",
      description: "敵方DEF-15，持續3回合，可疊加至-30。",
      cooldownTurns: 4,
      condition: {},
      procEffects: [
        { key: "def_down", target: "enemy", params: { value: 15, duration: { mode: "turns", value: 3 }, stackMode: "stack_value", stackAdd: 15, maxValue: 30 } }
      ]
    }
  ],
  warrior: [
    {
      key: "warrior_berserk",
      name: "狂暴",
      description: "自身ATK+25%，持續2回合。",
      cooldownTurns: 4,
      condition: {},
      procEffects: [
        { key: "atk_up", target: "self", params: { value: 25, duration: { mode: "turns", value: 2 } } }
      ]
    },
    {
      key: "warrior_death_will",
      name: "死亡意志",
      description: "HP低於35%時發動：免疫傷害1回合並ATK+20%，持續2回合。",
      cooldownTurns: 5,
      condition: { ownerHpBelowPct: 35 },
      procEffects: [
        { key: "invincible_short", target: "self", params: { value: 100, duration: { mode: "turns", value: 1 } } },
        { key: "atk_up", target: "self", params: { value: 20, duration: { mode: "turns", value: 2 } } }
      ]
    }
  ],
  dwarf_warrior: [
    {
      key: "dwarf_iron_wall",
      name: "鐵壁",
      description: "受傷降低25%、DEF+15，持續2回合。",
      cooldownTurns: 3,
      condition: {},
      procEffects: [
        { key: "damage_reduction", target: "self", params: { value: 25, duration: { mode: "turns", value: 2 } } },
        { key: "def_up", target: "self", params: { value: 15, mode: "flat", duration: { mode: "turns", value: 2 } } }
      ]
    },
    {
      key: "dwarf_quake_strike",
      name: "震地重擊",
      description: "HP高於50%時：敵方暈眩1回合並ATK-10，持續2回合。",
      cooldownTurns: 4,
      condition: { ownerHpAbovePct: 50 },
      procEffects: [
        { key: "stun", target: "enemy", params: { value: 100, duration: { mode: "turns", value: 1 } } },
        { key: "atk_down", target: "enemy", params: { value: 10, duration: { mode: "turns", value: 2 } } }
      ]
    }
  ],
  archer: [
    {
      key: "archer_aim",
      name: "瞄準",
      description: "命中+20、爆擊率+15%，持續2回合。",
      cooldownTurns: 3,
      condition: {},
      procEffects: [
        { key: "hit_up", target: "self", params: { value: 20, duration: { mode: "turns", value: 2 } } },
        { key: "crit_rate_up", target: "self", params: { value: 15, duration: { mode: "turns", value: 2 } } }
      ]
    },
    {
      key: "archer_pierce_arrow",
      name: "穿刺箭",
      description: "敵方DEF-15、自身爆擊率+20%，持續2回合。",
      cooldownTurns: 4,
      condition: {},
      procEffects: [
        { key: "def_down", target: "enemy", params: { value: 15, duration: { mode: "turns", value: 2 } } },
        { key: "crit_rate_up", target: "self", params: { value: 20, duration: { mode: "turns", value: 2 } } }
      ]
    }
  ],
  mage: [
    {
      key: "mage_mana_burst",
      name: "魔力爆炎",
      description: "自身ATK+40%並無視防禦+50%，持續1回合。",
      cooldownTurns: 4,
      condition: {},
      procEffects: [
        { key: "atk_up", target: "self", params: { value: 40, duration: { mode: "turns", value: 1 } } },
        { key: "def_ignore", target: "self", params: { value: 50, duration: { mode: "turns", value: 1 } } }
      ]
    },
    {
      key: "mage_mana_drain",
      name: "魔力衰減",
      description: "敵方最終傷害-25%、DEF-10，持續3回合。",
      cooldownTurns: 4,
      condition: {},
      procEffects: [
        { key: "final_damage_down", target: "enemy", params: { value: 25, duration: { mode: "turns", value: 3 } } },
        { key: "def_down", target: "enemy", params: { value: 10, duration: { mode: "turns", value: 3 } } }
      ]
    }
  ],
  rogue: [
    {
      key: "rogue_backstab",
      name: "背刺",
      description: "自身爆擊率+20%、爆擊傷害+30%，持續2回合。",
      cooldownTurns: 3,
      condition: {},
      procEffects: [
        { key: "crit_rate_up", target: "self", params: { value: 20, duration: { mode: "turns", value: 2 } } },
        { key: "crit_damage_up", target: "self", params: { value: 30, duration: { mode: "turns", value: 2 } } }
      ]
    },
    {
      key: "rogue_smoke_bomb",
      name: "煙霧彈",
      description: "敵方命中-20、自身迴避+12，持續2回合。",
      cooldownTurns: 4,
      condition: {},
      procEffects: [
        { key: "hit_down", target: "enemy", params: { value: 20, duration: { mode: "turns", value: 2 } } },
        { key: "dodge_up", target: "self", params: { value: 12, duration: { mode: "turns", value: 2 } } }
      ]
    }
  ],
  healer: [
    {
      key: "healer_holy_light",
      name: "聖光術",
      description: "立即回復最大HP的12%。",
      cooldownTurns: 3,
      condition: {},
      procEffects: [
        { key: "heal_over_time", target: "self", params: { value: 12, mode: "pct", duration: { mode: "turns", value: 1 } } }
      ]
    },
    {
      key: "healer_divine_shield",
      name: "神聖護盾",
      description: "HP低於60%時：受傷降低35%，持續2回合。",
      cooldownTurns: 4,
      condition: { ownerHpBelowPct: 60 },
      procEffects: [
        { key: "damage_reduction", target: "self", params: { value: 35, duration: { mode: "turns", value: 2 } } }
      ]
    }
  ],
  tactician: [
    {
      key: "tactician_analysis",
      name: "戰術分析",
      description: "敵方DEF-15、ATK-10，持續3回合。",
      cooldownTurns: 4,
      condition: {},
      procEffects: [
        { key: "def_down", target: "enemy", params: { value: 15, duration: { mode: "turns", value: 3 } } },
        { key: "atk_down", target: "enemy", params: { value: 10, duration: { mode: "turns", value: 3 } } }
      ]
    },
    {
      key: "tactician_formation_break",
      name: "兵法破陣",
      description: "無視敵方防禦+35%、自身ATK+10%，持續2回合。",
      cooldownTurns: 5,
      condition: {},
      procEffects: [
        { key: "def_ignore", target: "self", params: { value: 35, duration: { mode: "turns", value: 2 } } },
        { key: "atk_up", target: "self", params: { value: 10, duration: { mode: "turns", value: 2 } } }
      ]
    }
  ],
  bard: [
    {
      key: "bard_battle_anthem",
      name: "激昂旋律",
      description: "自身ATK+18%、AGI+8，持續2回合。",
      cooldownTurns: 3,
      condition: {},
      procEffects: [
        { key: "atk_up", target: "self", params: { value: 18, duration: { mode: "turns", value: 2 } } },
        { key: "agi_up", target: "self", params: { value: 8, duration: { mode: "turns", value: 2 } } }
      ]
    },
    {
      key: "bard_silence_song",
      name: "沉靜之歌",
      description: "敵方ATK-15%、AGI-6，持續3回合。",
      cooldownTurns: 4,
      condition: {},
      procEffects: [
        { key: "atk_down", target: "enemy", params: { value: 15, duration: { mode: "turns", value: 3 } } },
        { key: "agi_down", target: "enemy", params: { value: 6, duration: { mode: "turns", value: 3 } } }
      ]
    }
  ],
  barrier_mage: [
    {
      key: "barrier_mage_barrier",
      name: "魔法結界",
      description: "自身受傷降低40%，持續2回合。",
      cooldownTurns: 3,
      condition: {},
      procEffects: [
        { key: "damage_reduction", target: "self", params: { value: 40, duration: { mode: "turns", value: 2 } } }
      ]
    },
    {
      key: "barrier_mage_reflect",
      name: "反射護盾",
      description: "HP低於50%時：受傷降低20%、DEF+20，持續2回合。",
      cooldownTurns: 5,
      condition: { ownerHpBelowPct: 50 },
      procEffects: [
        { key: "damage_reduction", target: "self", params: { value: 20, duration: { mode: "turns", value: 2 } } },
        { key: "def_up", target: "self", params: { value: 20, mode: "flat", duration: { mode: "turns", value: 2 } } }
      ]
    }
  ]
};

async function main() {
  await client.connect();
  const db = client.db("equipment_game");
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

    if (!skills) { console.log("未匹配:", badge.name, "|", id); continue; }

    const r = await col.updateOne({ _id: badge._id }, { $set: { jobSkills: skills } });
    console.log(badge.name, "->", r.modifiedCount ? "✅" : "⚠️ 未改");
    updated += r.modifiedCount;
  }
  console.log("總更新:", updated, "筆");
  await client.close();
}
main().catch(console.error);
