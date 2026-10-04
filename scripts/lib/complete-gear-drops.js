"use strict";
const assert=require('node:assert/strict');
const {skillForMistwoodMonster}=require('./mistwood-card-skills');
const REVISION='gear-drops-complete-20260929-v1';
const STATS=['str','agi','vit','int','dex','luk'];
const SLOTS=['head_top','head_mid','head_low','armor','garment','shoes','accessory_l','accessory_r'];
const STYLES=['steel_p','swift','might','sage'];
const CARD_SOURCES=['林地妖靈','森林古樹','暗夜獵豹','森林巫師','森林盜賊','森林之獸','森林古樹'];
function planContent(items,monsters){
 const mist=monsters.filter(m=>m.zone==='mistwood'&&m.enabled).sort((a,b)=>a.seq-b.seq);assert.equal(mist.length,7);
 const cards=mist.map((m,n)=>{const oldMonster=monsters.find(x=>x.zone==='mid'&&x.name.startsWith(CARD_SOURCES[n]));assert.ok(oldMonster);
  const old=items.find(i=>i.monsterCardOf===oldMonster.id);assert.ok(old,oldMonster.name);
  const { _id,...card}=structuredClone(old);const id='monster-card-'+m.id;const skill=skillForMistwoodMonster(m.seq);
  card.id=id;card.itemId=id;card.name=m.name.replace(/\(B\)$/,'')+'卡';card.itemName=card.name;card.monsterName=m.name;card.monsterCardOf=m.id;
  card.monsterCardMeta={monsterName:m.name,zone:'mistwood',seq:m.seq,level:m.level};
  card.imageUrl=m.imageUrl;card.imageThumbnailUrl=m.imageThumbnailUrl;card.tier='B';card.contentRevision=REVISION;
  card.monsterCardSkill=skill;
  card.procEffects=structuredClone(skill.procEffects);
  card.description=skill.description;
  return card;});
 const s=[];for(const style of STYLES)for(const slot of SLOTS){const old=items.find(i=>i.tier==='A'&&i.itemType==='equipment'&&(i.setKey===style||(style==='steel_p'&&slot.startsWith('accessory_')&&i.setKey==null))&&i.equipSlot===slot&&!i.monsterCardOf);assert.ok(old,style+':'+slot);const {_id,...item}=structuredClone(old);
  item.id=`s-final-${style}-${slot}`;if(item.itemId)item.itemId=item.id;item.name=style==='steel_p'?`古龍真銀・${old.name}`:`${old.name.slice(0,2)}古龍真銀・${old.name.slice(2)}`;item.itemName=item.name;item.tier='S';item.description='古龍王與地獄狼牙王產出的 S 階裝備。';item.equipStats=Object.fromEntries(STATS.map(k=>[k,Math.round(Number(old.equipStats?.[k]||0)*1.4)]));item.setKey=null;item.setKeys=[];item.setName=null;item.contentRevision=REVISION;
  s.push(item);}
 // Physical shield and mage off-hand book complete the 10-slot paths.
 for(const [suffix,name]of [['shield','秘銀盾'],['book','秘銀法典']]){const old=items.find(i=>i.tier==='A'&&i.name===name);assert.ok(old,name);const {_id,...item}=structuredClone(old);item.id=`s-final-${suffix}`;if(item.itemId)item.itemId=item.id;item.name=`古龍真銀・${old.name}`;item.itemName=item.name;item.tier='S';item.equipStats=Object.fromEntries(STATS.map(k=>[k,Math.round(Number(old.equipStats?.[k]||0)*1.4)]));item.setKey=null;item.setKeys=[];item.setName=null;item.description='古龍王與地獄狼牙王產出的 S 階副手。';item.contentRevision=REVISION;s.push(item);}
 const targets=new Map();for(const m of mist){const card=cards.find(c=>c.monsterCardOf===m.id);targets.set(m.id,{drops:[...(m.drops||[]),{itemId:card.id,itemName:card.name,chance:1,source:'monster_card'}]});}
 const c=items.find(i=>i.name==='迅紋皮護目');assert.ok(c);const mid=monsters.filter(m=>m.zone==='mid'&&m.enabled&&!m.isBoss&&!String(m.name).includes('稀'));assert.ok(mid.length);const chosen=mid.sort((a,b)=>a.level-b.level)[Math.floor(mid.length/2)];targets.set(chosen.id,{drops:[...(chosen.drops||[]),{itemId:c.id,itemName:c.name,chance:1,source:'equipment_completion'}]});
 const daishi=monsters.find(m=>m.zone==='elite'&&m.id==='elite-daishi-king');assert.ok(daishi);
 const sIds=new Set(items.filter(i=>i.tier==='S'&&i.itemType==='equipment'&&!['special','anchor'].includes(i.equipSlot)).map(i=>i.id));
 const shifted=(daishi.drops||[]).filter(d=>sIds.has(d.itemId));
 targets.set(daishi.id,{drops:(daishi.drops||[]).filter(d=>!sIds.has(d.itemId))});
 for(const zone of ['dragon_king_lair','hellfire_depths']){const boss=monsters.find(m=>m.zone===zone&&m.enabled&&m.isBoss);assert.ok(boss,zone);const pool=s.filter((_,i)=>zone==='dragon_king_lair'?i%2===0:i%2===1);targets.set(boss.id,{drops:[...(boss.drops||[]),...(zone==='dragon_king_lair'?shifted:[]),...pool.map(i=>({itemId:i.id,itemName:i.name,chance:0.5,source:'s_boss_gear'}))]});}
 assert.ok(s.every(i=>[...targets.values()].some(t=>t.drops.some(d=>d.itemId===i.id))));
 return {cards,s,targetUpdates:targets};
}
module.exports={planContent,REVISION,SLOTS};
