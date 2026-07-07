"use strict";
/**
 * 為地獄火焰 11 隻基礎/菁英怪實裝「怪物技能」(monsterCardSkill + equipment.special_1)，
 * 比照龍族/黑焰巫師的實裝方式。純數值,不影響世界王(地獄狼牙王已另有技能)。
 * 數值壓在世界王之下(基礎怪火焰主題,發動率/威力適中)。可重複執行。 dry-run 支援。
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const NOW = new Date().toISOString();

// proc 小工具
function proc(key, value, turns, extra = {}) {
  return {
    key, target: "enemy", trigger: "on_hit", chance: 100, sourcePhase: "proc",
    params: { value, duration: { mode: "turns", value: turns }, ...(extra.mode ? { mode: extra.mode } : {}) },
  };
}
const burn = (v, t = 1) => proc("burn", v, t, { mode: "caster_atk_pct" });      // 灼燒(即時 t=1/DoT t>1)
const bleed = (v, t) => proc("bleed", v, t, { mode: "caster_atk_pct" });         // 流血 DoT
const hitDown = (v, t) => proc("hit_down", v, t);                               // 玩家命中-
const defDown = (v, t) => proc("def_down", v, t);                              // 玩家防禦-
const atkDown = (v, t) => proc("atk_down", v, t);                              // 玩家攻擊-

// name, 技能key, 技能名, 發動率%, cooldown, 說明, procEffects
const SKILLS = [
  ["焰爪幼狼", "hf_pupwolf_scorch", "灼爪", 20, 0, "20% 機率灼爪，造成 60% 攻擊力灼燒。", [burn(60, 1)]],
  ["灰燼豺", "hf_jackal_ashbite", "灰燼撕咬", 20, 0, "20% 機率撕咬，造成每回合 8% 攻擊力流血，持續 3 回合。", [bleed(8, 3)]],
  ["熔岩犬", "hf_lavahound_splash", "熔岩噴濺", 25, 0, "25% 機率噴濺熔岩，造成 80% 攻擊力灼燒。", [burn(80, 1)]],
  ["硫火蝙蝠", "hf_bat_smoke", "硫煙致盲", 30, 0, "30% 機率噴出硫煙，使你命中 -15%，持續 2 回合。", [hitDown(15, 2)]],
  ["焦炎蜥", "hf_lizard_ignite", "焦炎附體", 20, 3, "20% 機率點燃，每回合造成 100% 攻擊力燃燒，持續 3 回合；冷卻 3 回合。", [burn(100, 3)]],
  ["火髓魔蟲", "hf_worm_corrode", "火髓侵蝕", 18, 0, "18% 機率侵蝕，每回合造成 90% 攻擊力燃燒，持續 2 回合。", [burn(90, 2)]],
  ["餘燼骷髏", "hf_skeleton_ember", "餘燼斬", 25, 0, "25% 機率餘燼斬，造成 70% 攻擊力灼燒並使你攻擊 -10%（2 回合）。", [burn(70, 1), atkDown(10, 2)]],
  ["炙炎鴉", "hf_raven_flurry", "炙羽亂舞", 25, 0, "25% 機率炙羽亂舞，造成 85% 攻擊力灼燒。", [burn(85, 1)]],
  ["岩漿巨蟲", "hf_magmaworm_break", "熔岩碎甲", 30, 0, "30% 機率碎甲，使你防禦 -25%，持續 2 回合。", [defDown(25, 2)]],
  ["烈焰狼", "hf_blazewolf_bite", "烈焰咬噬", 30, 0, "30% 機率烈焰咬噬，造成 120% 攻擊力灼燒。", [burn(120, 1)]],
  ["煉獄烈焰狼王", "hf_infernoking_roar", "煉獄咆哮", 40, 0, "40% 機率煉獄咆哮，造成 150% 攻擊力灼燒並使你攻擊 -15%（2 回合）。", [burn(150, 1), atkDown(15, 2)]],
];

async function main() {
  const dry = process.argv.includes("--dry-run");
  const db = await getMongoDb();
  let done = 0;
  console.log(`地獄火焰怪物技能實裝（dryRun=${dry}）\n` + "-".repeat(80));
  for (const [name, key, skillName, chance, cd, desc, procs] of SKILLS) {
    const m = await db.collection("monsters").findOne({ zone: "hellfire", name });
    if (!m) { console.log(`SKIP 找不到 ${name}`); continue; }
    const skill = { key, name: skillName, description: desc, chance, cooldownTurns: cd, trigger: "on_hit", procEffects: procs };
    const cardEquip = {
      itemId: `monster-skill-${key}`, itemName: `${name}·${skillName}`, itemType: "equipment", equipSlot: "special",
      tier: m.level >= 48 ? "A" : "B", monsterCardSkill: skill, procEffects: procs,
      equipStats: { str: 0, agi: 0, vit: 0, int: 0, dex: 0, luk: 0 },
      passiveEffects: [], combatEffects: [], useEffects: [], imageUrl: null, imageThumbnailUrl: null,
    };
    const equipment = { ...(m.equipment || {}), special_1: cardEquip };
    if (!dry) await db.collection("monsters").updateOne({ _id: m._id }, { $set: { monsterCardSkill: skill, equipment, updatedAt: NOW } });
    done++;
    console.log(`  ${name.padEnd(12)} ${skillName}（發動 ${chance}%）→ ${procs.map((p) => p.key + (p.params.value ? p.params.value + (p.params.mode ? "%atk" : "") : "")).join("+")}`);
  }
  console.log("-".repeat(80));
  console.log(`${dry ? "[DRY-RUN] " : ""}完成：${done} 隻火焰怪實裝技能。`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
