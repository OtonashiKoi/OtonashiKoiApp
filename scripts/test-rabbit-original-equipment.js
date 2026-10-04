"use strict";
const assert=require('assert/strict'),{runCombatLoop}=require('../src/shared/combatLoop'),{SET_DEFS}=require('../src/shared/equipmentSetBonuses');
const p={maxHp:999999,atk:100,def:0,flatDef:0,str:50,agi:50,vit:50,int:20,dex:50,luk:20,hit:100,dodge:0,crit:0,combo:0,dmgMin:1,dmgMax:1,weaponType:'sword_1h'};
const m={...p,maxHp:99999999,agi:50,atk:100,hit:100};const random=Math.random;Math.random=()=>.5;
try{
 const eq=Object.fromEntries(['head_top','head_mid','head_low','armor','garment','shoes','accessory_l'].map(s=>[s,{itemId:'rabbit-'+s,setKey:'mantou_rabbit',tier:'A',equipSlot:s,passiveEffects:[]}]));
 assert.deepEqual(SET_DEFS.mantou_rabbit.tiers.map(t=>t.count),[3,5,7]);
 const baseline=runCombatLoop(p,m,'木樁',m.maxHp,6,{equipped:{},inventory:[]});
 const result=runCombatLoop(p,m,'木樁',m.maxHp,6,{equipped:eq,inventory:[]});
 assert.ok(result.totalDamage>baseline.totalDamage,'rage raises actual outgoing damage');assert.ok(result.damageTaken<baseline.damageTaken,'sulk lowers actual incoming damage');
 assert.ok(result.roundLogs.some(l=>l.includes('委屈')));assert.ok(result.roundLogs.some(l=>l.includes('爆走')));
 console.log('7-piece rabbit set: 3/5/7 thresholds, real defense and rage damage: PASS');
}finally{Math.random=random;}
