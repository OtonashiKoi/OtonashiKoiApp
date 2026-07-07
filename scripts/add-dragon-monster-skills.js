"use strict";
/** 龍族之領怪物技能實裝(monsterCardSkill+equipment.special_1)，補齊唯一啞火的一區。龍主題:雷/冰/暗/炎。 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const NOW = new Date().toISOString();
function proc(key, value, turns, mode) { const p={key,target:"enemy",trigger:"on_hit",chance:100,sourcePhase:"proc",params:{value,duration:{mode:"turns",value:turns}}}; if(mode)p.params.mode=mode; return p; }
const light=(v)=>proc("lightning",v,1,"caster_atk_pct");
const burn=(v,t=1)=>proc("burn",v,t,"caster_atk_pct");
const bleed=(v,t)=>proc("bleed",v,t,"caster_atk_pct");
const defD=(v,t)=>proc("def_down",v,t); const agiD=(v,t)=>proc("agi_down",v,t); const atkD=(v,t)=>proc("atk_down",v,t);
const SKILLS=[
  ["飛龍幼崽","dr_hatchling_zap","幼龍電擊",20,0,"20% 機率電擊，造成 70% 攻擊力雷擊。",[light(70)]],
  ["龍蜥武士","dr_lizardknight_rend","龍牙撕裂",25,0,"25% 機率撕裂，造成每回合 8% 攻擊力流血(3回)並使你防禦-12%。",[bleed(8,3),defD(12,2)]],
  ["火翼龍人","dr_firewing_scorch","炎翼焚燒",25,0,"25% 機率炎翼，每回合造成 100% 攻擊力燃燒(2回)。",[burn(100,2)]],
  ["冰鱗龍人","dr_frostscale_chill","霜鱗凍緩",25,0,"25% 機率霜凍，造成 70% 攻擊力雷擊並使你敏捷-15%(2回)。",[light(70),agiD(15,2)]],
  ["雷霆飛龍","dr_thunder_breath","雷霆吐息",30,0,"30% 機率雷霆吐息，造成 110% 攻擊力雷擊。",[light(110)]],
  ["黑曜龍騎","dr_obsidian_break","黑曜碎甲",30,0,"30% 機率碎甲，使你防禦-25%(2回)。",[defD(25,2)]],
  ["暗影龍將","dr_shadow_maul","暗影撕咬",28,0,"28% 機率暗影撕咬，造成 90% 攻擊力雷擊並使你攻擊-15%(2回)。",[light(90),atkD(15,2)]],
  ["龍翼魔法師","dr_wingmage_blast","龍語爆炎",20,3,"20% 機率龍語爆炎，每回合造成 110% 攻擊力燃燒(3回)；冷卻3回。",[burn(110,3)]],
  ["黃金幼龍(稀)","dr_gold_breath","黃金吐息",25,0,"25% 機率黃金吐息，造成 90% 攻擊力雷擊。",[light(90)]],
  ["龍王(B)","dr_dragonlord_wrath","龍王之怒",35,0,"35% 機率龍王之怒，造成 130% 攻擊力雷擊並使你防禦-20%(2回)。",[light(130),defD(20,2)]],
];
(async()=>{const dry=process.argv.includes("--dry-run");const db=await getMongoDb();let done=0;
for(const [name,key,sn,chance,cd,desc,procs] of SKILLS){
  const m=await db.collection("monsters").findOne({zone:"dragon_realm",name});if(!m){console.log("SKIP",name);continue;}
  const skill={key,name:sn,description:desc,chance,cooldownTurns:cd,trigger:"on_hit",procEffects:procs};
  const card={itemId:`monster-skill-${key}`,itemName:`${name}·${sn}`,itemType:"equipment",equipSlot:"special",tier:"A",monsterCardSkill:skill,procEffects:procs,equipStats:{str:0,agi:0,vit:0,int:0,dex:0,luk:0},passiveEffects:[],combatEffects:[],useEffects:[],imageUrl:null,imageThumbnailUrl:null};
  const equipment={...(m.equipment||{}),special_1:card};
  if(!dry)await db.collection("monsters").updateOne({_id:m._id},{$set:{monsterCardSkill:skill,equipment,updatedAt:NOW}});
  done++;console.log(`  ${name} ${sn}(${chance}%) → ${procs.map(p=>p.key+(p.params.value||"")).join("+")}`);
}
console.log(`${dry?"[DRY-RUN] ":""}完成:${done}隻龍族怪實裝技能`);process.exit(0);})().catch(e=>{console.error(e);process.exit(1);});
