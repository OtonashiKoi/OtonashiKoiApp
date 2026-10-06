"use strict";
const {calcPlayerStats}=require('../../shared/combatStats');
const {calculateBattleTickMs}=require('../../shared/battleTiming');
const {BASE_JOBS}=require('../../shared/jobAdvancement');
const REVISION='starter-companions-20261006-v3';
const ZONES={
  beginner:{level:2,tier:'D',keys:['swordsman','healer']},
  normal:{level:6,tier:'D',keys:['archer','bard']},
  mid:{level:15,tier:'C',keys:['mage','tactician']},
  ancient_city:{level:25,tier:'B',keys:['rogue','barrier-mage']},
};
const TYPES={
  swordsman:{name:'白鷺',jobName:'劍士',role:'output',weapon:'sword_1h',main:'str',flavor:'鬥紋'},
  healer:{name:'無傷',jobName:'治癒師',role:'support',weapon:'staff_1h',main:'int',flavor:'智紋'},
  archer:{name:'遠山',jobName:'弓箭手',role:'output',weapon:'bow',main:'dex',flavor:'迅紋'},
  bard:{name:'斷弦',jobName:'吟遊詩人',role:'support',weapon:'bow',main:'dex',flavor:'迅紋'},
  mage:{name:'灰燼夫人',jobName:'法師',role:'output',weapon:'staff_2h',main:'int',flavor:'智紋'},
  tactician:{name:'枯棋',jobName:'戰術師',role:'support',weapon:'staff_1h',main:'int',flavor:'智紋'},
  rogue:{name:'影七',jobName:'盜賊',role:'output',weapon:'dagger',main:'agi',flavor:'迅紋'},
  'barrier-mage':{name:'壁',jobName:'結界師',role:'support',weapon:'staff_1h',main:'int',flavor:'智紋'},
};
const ATTRS=['str','agi','vit','int','dex','luk'];
// The same 1 random + 1 allocated point per level as real characters. A fixed
// rotation replaces randomness so entering/leaving cannot reroll a stronger NPC.
function attributesAt(level,main){
  const attrs=Object.fromEntries(ATTRS.map(k=>[k,1]));
  const allocation=[main,main,'vit',main,'agi','vit',main,main,'dex',main];
  for(let n=0;n<level-1;n++){attrs[ATTRS[n%6]]++;attrs[allocation[n%allocation.length]]++;}
  return attrs;
}
function buildCompanion(key,zone,items,monsters){
  const config=ZONES[zone],type=TYPES[key];
  if(!config||!type||!config.keys.includes(key))throw Error('Unknown starter companion');
  const {level,tier}=config,attributes=attributesAt(level,type.main),equipped={};
  const dropIds=monsters?new Set(monsters.filter(m=>m.zone===zone&&m.enabled!==false&&!m.allZones).flatMap(m=>(m.drops||[]).filter(d=>Number(d.chance)>0).map(d=>d.itemId))):null;
  const preference=i=>String(i.name).startsWith(type.flavor)?2:/^(鬥紋|智紋|迅紋)/.test(String(i.name))?0:1;
  const sorted=items.filter(i=>i.itemType==='equipment'&&i.tier===tier&&!i.monsterCardOf&&(!dropIds||dropIds.has(i.id)))
    .sort((a,b)=>preference(b)-preference(a)||String(a.id).localeCompare(String(b.id)));
  const slots=['weapon','armor','garment','shoes','head_top','head_mid','head_low','accessory_l','accessory_r'];
  if(['sword_1h','staff_1h','dagger'].includes(type.weapon))slots.push('shield');
  for(const slot of slots){
    const item=sorted.find(i=>i.equipSlot===slot&&(slot!=='weapon'||i.weaponType===type.weapon)&&(slot!=='shield'||(key==='rogue'?i.weaponType==='offhand_dagger':!i.weaponType))&&Number(i.requiredLevel||i.minLevel||0)<=level);
    if(!item)throw Error(`Missing starter companion ${tier} ${key} ${slot}`);
    equipped[slot]={...structuredClone(item),itemId:item.id,itemName:item.name,enhanceLevel:0};
  }
  if(level>=10){const job=BASE_JOBS[key.replace('-','_')],badge=items.find(i=>i.id===job?.badgeId);if(!badge)throw Error(`Missing starter companion badge ${key}`);equipped.job_eq={...structuredClone(badge),itemId:badge.id,itemName:badge.name,jobExp:0,enhanceLevel:0};}
  const stats=calcPlayerStats(attributes,equipped,[],[],{zone});
  const outputShare=type.role==='output'?0.4:0.12;
  const skill=key==='healer'?{key:'party_heal',value:Math.max(1,Math.round(stats.int*0.35+level*0.2))}
    :key==='barrier-mage'?{key:'party_damage_reduction',value:Math.min(15,5+Math.floor(stats.int/10))}
    :type.role==='support'?{key:'party_damage_up',value:Math.min(10,5+Math.floor((key==='bard'?stats.dex:stats.int)/12))}:null;
  return {key,actorId:`starter-npc:${zone}:${key}`,actorName:type.name,jobName:type.jobName,role:type.role,level,tier,attributes,equipped,stats,skill,outputShare,
    tick:calculateBattleTickMs(stats.agi),avatarUrl:`/reception/starter-companions/${key}-v2.webp`,revision:REVISION};
}
function selectedCompanions(zone,members,state){
  const config=ZONES[zone];if(!config)return [];
  const humans=[...members.values()].filter(a=>!a.done&&a.hp>0&&(state?.normalLive?.actors?.[a.actorId]?.active!==false));
  if(humans.length<=1)return config.keys;
  if(humans.length!==2)return [];
  const hasProtection=humans.some(a=>(a.options.partyEffects||[]).some(e=>String(e.sourceDiscordId||'')===a.actorId&&['party_heal','heal_over_time','party_damage_reduction'].includes(e.key)));
  return [config.keys[hasProtection?0:1]];
}
// Fixed game-owned definitions: joining or replacing an encounter does no library I/O.
const FIXED_LOADOUTS=require('../../shared/starterCompanionLoadouts.json');
async function loadCompanions(_sc,zone){
  // HP, session and skill cooldowns belong to each room, never the shared template.
  return structuredClone(FIXED_LOADOUTS[zone]||[]);
}
function companionEffects(room,state){
  return (room.companions||[]).filter(n=>n.skill&&state.normalLive?.npcs?.[n.key]?.selected&&Number(state.normalLive.npcs[n.key].hp)>0).map(n=>({key:n.skill.key,target:'party',params:{value:n.skill.value,mode:'flat'},sourceNpcId:n.actorId,sourceName:n.actorName,sourceJobName:`新手陪練・${n.jobName}`,isSelfAura:false}));
}
module.exports={REVISION,ZONES,TYPES,attributesAt,buildCompanion,loadCompanions,selectedCompanions,companionEffects};
