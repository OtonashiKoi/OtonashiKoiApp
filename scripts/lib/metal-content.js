"use strict";
const assert = require('node:assert/strict');
const REVISION = 'metal-content-20260930-v1';
const SLOTS = ['head_top','head_mid','head_low','armor','garment','shoes','accessory_l','accessory_r'];
const TYPES = ['sword_1h','sword_2h','mace_1h','mace_2h','axe_1h','axe_2h','dagger','bow','staff_1h','staff_2h','dice'];
const WEAPON_NAMES = ['長劍','巨劍','戰槌','重槌','戰斧','巨斧','短刃','獵弓','短杖','長杖','骰子'];
const ARMOR_NAMES = {
  p: ['戰盔','護目','面甲','重甲','肩披','戰靴','守戒(左)','鋒戒(右)'],
  m: ['法冠','晶鏡','口飾','法袍','法披','法靴','核戒(左)','磁戒(右)'],
};
function buildMetalContent(items, monsters) {
  const byId = new Map(items.map(x => [x.id,x]));
  const pick = fn => { const x=items.find(fn); assert.ok(x,'Missing gear template'); return x; };
  const gear=[];
  function make(base,tier,suffix,name,kind) {
    const {_id,...item}=structuredClone(base);
    item.id=`metal-${tier.toLowerCase()}-${suffix}`;
    item.itemId=item.id;item.name=item.itemName=(tier==='A'?'磁鋼':'鋼冕')+name;
    item.tier=tier;item.minLevel=tier==='A'?40:50;
    item.setKey=`magnetic_${kind}`;item.setKeys=[item.setKey];item.setName=`磁鋼套裝·${kind==='m'?'法':'物'}`;
    item.description=`${tier} 階金屬主題裝備；${tier==='A'?'鐵鳴礦城':'鎧冕王・赫鋼'}掉落。${item.setName}，A／S 同類可混搭、沿用階級套裝。` + require('../../src/shared/equipmentSetBonuses').SET_DEFS[item.setKey].tiers.map(t=>`${t.count} 件：${t.desc}`).join('；') + '。屬性攻擊／抗性依鑲嵌屬性石生效。';
    item.contentRevision=REVISION;
    // No copied event effects, elemental affixes or S-zone damage bonuses.
    for(const k of ['passiveEffects','procEffects','combatEffects','useEffects']) item[k]=[];
    for(const k of ['monsterCardOf','monsterCardSkill','element','elementLevel','elements']) delete item[k];
    gear.push(item);return item;
  }
  for(const tier of ['A','S']) {
    TYPES.forEach((type,n)=>make(pick(i=>i.id===`mithril-${tier.toLowerCase()}-wpn-${type}` ||
      (tier==='A'&&i.name===`秘銀${{'sword_1h':'單手劍','sword_2h':'雙手劍','mace_1h':'單手槌','mace_2h':'雙手槌','axe_1h':'單手斧','axe_2h':'雙手斧','dagger':'匕首','bow':'弓','staff_1h':'單手法杖','staff_2h':'雙手法杖','dice':'骰子'}[type]}`)),tier,`weapon-${type}`,WEAPON_NAMES[n],type.startsWith('staff')?'m':'p'));
    for(const kind of ['p','m']) SLOTS.forEach((slot,n)=>{
      const base=pick(i=>i.tier==='A'&&i.itemType==='equipment'&&i.equipSlot===slot&&
        (kind==='m'?i.setKey==='sage':i.setKey==='steel_p'||(slot.startsWith('accessory')&&i.setKey==null))&&!i.monsterCardOf);
      const item=make(base,tier,`${kind}-${slot}`,ARMOR_NAMES[kind][n],kind);
      if(tier==='S')item.equipStats=Object.fromEntries(Object.entries(base.equipStats||{}).map(([k,v])=>[k,Math.round(Number(v)*1.4)]));
    });
    for(const [suffix,source,name,kind] of [['shield','秘銀盾','壁盾','p'],['book','秘銀法典','術典','m'],['offhand_dagger','秘銀短匕(副手)','副刃','p']]){
      const base=pick(i=>i.tier==='A'&&i.name===source);
      const item=make(base,tier,suffix,name,kind);
      if(tier==='S')item.equipStats=Object.fromEntries(Object.entries(base.equipStats||{}).map(([k,v])=>[k,Math.round(Number(v)*1.4)]));
    }
  }
  assert.equal(gear.length,60);assert.equal(new Set(gear.map(x=>x.id)).size,60);
  const specs=[
    ['鐵屑鼠',40,12,75,35,3102,'accessory'],
    ['磁針浮游砲',42,10,95,35,2663,'head'],
    ['鎧甲穿山獸',44,4,90,60,2073,'body'],
    ['鏽刃斥候',46,12,115,40,1526,'blade'],
    ['齒輪維修工',48,6,92,40,2525,'magic'],
    ['磁甲重兵',49,5,108,55,1940,'heavy'],
    ['礦城監造者(B)',50,12,120,55,12000,'all'],
  ];
  const belongs=(i,group)=>group==='all'||
    (group==='accessory'&&i.equipSlot.startsWith('accessory'))||
    (group==='head'&&i.equipSlot.startsWith('head'))||
    (group==='body'&&['armor','garment'].includes(i.equipSlot))||
    (group==='blade'&&(i.equipSlot==='shoes'||['sword_1h','sword_2h','dagger','bow'].includes(i.weaponType)))||
    (group==='magic'&&(i.equipSlot==='shield'||['staff_1h','staff_2h','dice'].includes(i.weaponType)))||
    (group==='heavy'&&['mace_1h','mace_2h','axe_1h','axe_2h'].includes(i.weaponType));
  const mobs=specs.map(([name,level,agi,str,def,maxHp,group],n)=>({
    id:`metal-monster-${n+1}`,seq:n+1,name,zone:'metal_mine',level,agi,str,def,maxHp,
    vit:40,int:15,dex:20,luk:8,flatDef:0,defIgnorePct:0,
    element:'metal',elementLevel:2,entryFee:0,goldReward:n===6?1800:700,
    expReward:n===6?24000:Math.round(6000*maxHp/2200),spawnRate:n===6?1:10,
    isBoss:n===6,enabled:true,equipment:{},skills:[],passiveEffects:[],procEffects:[],battleStartEffects:[],
    imageUrl:`/uploads/monsters/metal-${n+1}-v3.png`,imageThumbnailUrl:`/uploads/monsters/metal-${n+1}-v3.png`,
    drops:gear.filter(i=>i.tier==='A'&&belongs(i,group)).map(i=>({itemId:i.id,itemName:i.name,chance:n===6?1.2:2})),
    contentRevision:REVISION,
  }));
  const base=monsters.find(m=>m.zone==='dragon_king_lair'&&m.enabled&&m.isBoss);assert.ok(base);
  const {_id,...boss}=structuredClone(base);
  Object.assign(boss,{id:'metal-steel-crown',seq:1,name:'鎧冕王・赫鋼',zone:'metal_throne',level:60,
    maxHp:1500000,str:55,agi:20,vit:100,int:20,dex:25,luk:15,def:55,flatDef:0,defIgnorePct:0,
    element:'metal',elementLevel:4,entryFee:10000,expReward:30000,goldReward:50000,participantGoldReward:500,
    equipment:{},skills:[],passiveEffects:[],procEffects:[],battleStartEffects:[],
    imageUrl:'/uploads/monsters/metal-8-v3.png',imageThumbnailUrl:'/uploads/monsters/metal-8-v3.png',
    drops:gear.filter(i=>i.tier==='S').map(i=>({itemId:i.id,itemName:i.name,chance:i.equipSlot==='weapon'?1.2:0.5})),
    contentRevision:REVISION});
  for(const k of ['monsterCardSkill','worldBossParts','parts','_rebalABackup','_econBackup'])delete boss[k];
  mobs.push(boss);
  const stone=byId.get('element-stone-metal');assert.ok(stone);
  for(const m of mobs)m.drops.push({itemId:stone.id,itemName:stone.name,chance:m.zone==='metal_throne'?10:m.isBoss?8:2});
  assert.ok(gear.every(i=>mobs.some(m=>m.drops.some(d=>d.itemId===i.id))));
  const config={_id:'steel_crown',value:{enabled:true,targetZone:'metal_mine',weeklyUnlockKillTarget:1,
    battleTimeLimitMinutes:30,respawnCooldownMinutes:60,eliteZoneKey:'metal_throne',
    phaseConfig:[{phase:1,hpBelowPercent:30,atkMultiplier:1,defMultiplier:1,agiBonus:0,lightningEnabled:false,note:'鋼冕守勢'},
      {phase:2,hpBelowPercent:0,atkMultiplier:1.15,defMultiplier:1,agiBonus:0,lightningEnabled:false,note:'鋼冕解放：攻擊 +15%'}]}};
  return {gear,mobs,config};
}
module.exports={buildMetalContent,REVISION,SLOTS,TYPES};
