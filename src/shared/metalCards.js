"use strict";
const DEFINITIONS = Object.freeze([
 ['rat','碎鐵磨刃','普攻主擊被敵人格擋後，下一次普攻主擊傷害提高20%；不疊加，出手後消耗。'],
 ['artillery','懸浮卸力','受到的物理普攻連擊傷害降低20%；第一擊不變。'],
 ['pangolin','層疊鋼甲','前三次受到物理普攻時，傷害依序降低15%、10%、5%；每場重新獲得三層。'],
 ['scout','磁刃追引','普攻主擊落空後，下一次普攻主擊命中率提高10個百分點；出手後消耗。'],
 ['repair','緊急焊補','血量首次低於50%時回復最大HP的8%，每場一次。組隊區擊敗每隻怪後，存活持卡者另回復最大HP的5%，同一隻怪只結算一次，不復活。'],
 ['heavy','重錘定勢','普攻主擊未爆擊時，該擊傷害提高8%；不強化副手、連擊或技能。'],
 ['supervisor','磁場鎖定','連續兩次普攻主擊落空後，下一次普攻主擊必定命中；不能穿過無敵或免疫，命中後重置。'],
 ['crown','鋼冕浮游兵裝','開戰展開4枚浮游鋼刃；每累積3次普攻主擊命中，射出一枚，造成自身攻擊力70%的金1傷害。四枚用完不補充；不爆擊、不連擊、不自行連鎖，受防禦、等級壓制、屬性抗性及承傷上限影響。'],
]);
const KEY = Object.freeze(Object.fromEntries(DEFINITIONS.map(([k]) => [k,`metal_card_${k}`])));
function skillForMetalMonster(seq) {
 const d=DEFINITIONS[seq-1];if(!d)throw Error('Unknown metal card '+seq);
 return {key:KEY[d[0]],name:d[1],description:d[2],trigger:'battle_event',chance:100,cooldownTurns:0,procEffects:[],
 monsterSkill:{key:'metal_plain_attack',name:'普通攻擊',chance:0,procEffects:[]}};
}
function hasMetalCard(equipped,key) {return ['special_1','special_2','special_3'].some(s=>equipped?.[s]?.monsterCardSkill?.key===KEY[key]);}
function createMetalCards(equipped={},maxHp=1) {
 const has=k=>hasMetalCard(equipped,k);
 const state={sharpened:false,ratReady:false,guided:false,misses:0,plates:3,repaired:false,hits:0,blades:4,deployed:false};
 const metrics={sharpenBonus:0,floatPrevented:0,platePrevented:0,guidedAttacks:0,repairHeal:0,steadyBonus:0,lockedAttacks:0,bladeDamage:0,bladesFired:0};
 let ctx;
 const usable=()=>ctx&&!ctx.silenced()&&ctx.playerHp()>0;
 return {state,metrics,setContext(v){ctx=v;if(has('crown')&&!state.deployed&&usable()){state.deployed=true;ctx.deployLog?.();}},
  aim(){if(!usable())return {bonus:0,forced:false};const guided=has('scout')&&state.guided,forced=has('supervisor')&&state.misses>=2;
   state.ratReady=state.sharpened;state.sharpened=false;if(guided)metrics.guidedAttacks++;if(forced)metrics.lockedAttacks++;state.guided=false;return {bonus:guided?10:0,forced};},
  onMiss(){if(!usable())return;state.guided=has('scout');state.misses=Math.min(2,state.misses+1);},
  onDodge(){},
  mainDamage(raw,crit=false){if(!usable()||raw<=0)return raw;let v=raw;
   if(has('rat')&&state.ratReady){const n=Math.round(v*1.2);metrics.sharpenBonus+=n-v;v=n;}state.ratReady=false;
   if(has('heavy')&&!crit){const n=Math.round(v*1.08);metrics.steadyBonus+=n-v;v=n;}return v;},
  onHit(actual,crit,blocked=false){if(!usable())return;state.misses=0;state.sharpened=has('rat')&&blocked;
   if(actual<=0)return;state.hits++;if(has('crown')&&state.hits%3===0&&state.blades>0&&ctx.enemyHp()>0){state.blades--;metrics.bladesFired++;const d=ctx.bladeDamage();metrics.bladeDamage+=d;ctx.bladeLog(d,state.blades);}},
  beforePhysical(raw,round,combo=false){if(!usable()||raw<=0)return raw;let v=raw;
   if(has('artillery')&&combo){const n=Math.max(1,Math.round(v*.8));metrics.floatPrevented+=v-n;v=n;}
   if(has('pangolin')&&state.plates>0){const pct=state.plates*5;state.plates--;const n=Math.max(1,Math.round(v*(1-pct/100)));metrics.platePrevented+=v-n;v=n;}return v;},
  checkHealth(){if(usable()&&has('repair')&&!state.repaired&&ctx.playerHp()<maxHp*.5){state.repaired=true;metrics.repairHeal+=ctx.heal(Math.floor(maxHp*.08));}},
  onPhysicalTaken(){this.checkHealth();},
 };
}
// Called only by the party area's successful monster settlement, never the combat round.
function applyMetalPartyRecovery(member,killId) {
 if(!killId||member.currentHp<=0||!hasMetalCard(member.equipped,'repair')||member.metalRepairKillId===killId)return 0;
 member.metalRepairKillId=killId;const before=member.currentHp;
 member.currentHp=Math.min(member.maxHp,member.currentHp+Math.floor(member.maxHp*.05));return member.currentHp-before;
}
module.exports={KEY,DEFINITIONS,skillForMetalMonster,createMetalCards,hasMetalCard,applyMetalPartyRecovery};
