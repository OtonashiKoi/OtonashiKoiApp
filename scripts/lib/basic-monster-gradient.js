"use strict";
const REVISION='basic-monster-gradient-20260930-agi-v2';
// Zone base attack grows independently of HP/DEF. Creature identity and level
// determine the offset; storage order never determines monster strength.
const BASE_ATTACK={metal_mine:315,beginner:3,normal:90,mid:120,ancient_city:170,mistwood:225,ancient_city_deep:300,dragon_realm:315,hellfire:330};
const PROFILES={
  sturdy:{atk:0.85}, agile:{atk:1.08}, caster:{atk:1.12}, beast:{atk:1.12}, balanced:{atk:1},
};
function profileOf(name){
 if(/石頭|甲蟹|石像|古樹|巨巨|巨獸|騎士|衛將|衛兵|龍蜥|冰鱗|黑曜|巨蟲/.test(name))return 'sturdy';
 if(/弓手|獵豹|刺客|潛襲|盜賊|掠奪|蝙蝠|炙炎鴉/.test(name))return 'agile';
 if(/法師|巫師|術師|祭司|妖靈/.test(name))return 'caster';
 if(/狼|獸|豺|犬|巨斧|狂戰|飛龍|龍將/.test(name))return 'beast';
 return 'balanced';
}
function attackFor(m){
 const base=BASE_ATTACK[m.zone];if(!base)return null;
 if(m.zone==='beginner')return 1;
 const starts={metal_mine:40,normal:4,mid:10,ancient_city:20,mistwood:30,ancient_city_deep:40,dragon_realm:40,hellfire:40};
 const width=m.zone==='normal'?5:9;
 const levelFactor=0.9+0.2*Math.min(1,Math.max(0,(m.level-starts[m.zone])/width));
 // Slow creatures already lose alternate counterattacks to the existing AGI
 // rule. Budget their per-hit threat against that actual action frequency.
 const referenceLevel={metal_mine:40,normal:5,mid:10,ancient_city:20,mistwood:30,ancient_city_deep:40,dragon_realm:40,hellfire:40}[m.zone];
 const referenceAgi=1+(referenceLevel-1)*(1/6+0.15);
 const actionFactor=referenceAgi-Number(m.agi||1)>15?1.4:1;
 return Math.max(1,Math.round(base*PROFILES[profileOf(m.name)].atk*levelFactor*actionFactor/3));
}
module.exports={REVISION,BASE_ATTACK,PROFILES,profileOf,attackFor};
