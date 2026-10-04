'use strict';
const fs=require('node:fs'),crypto=require('node:crypto');
const {SET_SLOTS,getSetEffects,getRegionalSetProcChance}=require('../src/shared/equipmentSetBonuses');
const {calcPlayerStats}=require('../src/shared/combatStats');
const {runCombatLoop}=require('../src/shared/combatLoop');
const failures=[],rows=[];let battles=0;
const check=(x,m)=>{if(!x)failures.push(m)};
function fight(key,n,roll=.5,extra={}){
 const equipped=Object.fromEntries(SET_SLOTS.slice(0,n).map((s,i)=>[s,{setKey:key,tier:'A',itemId:`test-${i}`} ]));
 const stats={...calcPlayerStats({str:10,int:10,vit:10,agi:10,dex:10,luk:10},equipped,[],[],{zone:extra.zone||'normal'}),maxHp:10000,atk:100,def:0,flatDef:0,agi:10,hit:100,dodge:0,crit:0,combo:0,dmgMin:1,dmgMax:1};
 if (extra.sPieces) for (const item of Object.values(equipped).slice(0,extra.sPieces)) item.tier='S';
 if(extra.sSlot && equipped[extra.sSlot]) equipped[extra.sSlot].tier='S';
 if(extra.foreignWeapon) equipped.weapon={tier:'S',setKey:extra.foreignWeapon};
 const monster={maxHp:50000,atk:100,def:0,flatDef:0,agi:10,dex:10,luk:10,hit:100,dodge:0,critRate:0};
 const old=Math.random;Math.random=()=> /_tryMagneticDeflection|_tryDragonReflection/.test(new Error().stack)?roll:.5;
 try{battles++;const result=runCombatLoop(stats,monster,'反應木樁',50000,1,{equipped,zone:'normal',skipPlayerAttack:true,...extra});rows.push({key,n,roll,damageTaken:result.damageTaken,totalDamage:result.totalDamage,log:result.log});return result;}finally{Math.random=old;}
}
for(const key of ['magnetic_p','magnetic_m']){
 check(fight(key,4,.079).damageTaken===85,`${key}: four pieces do not deflect`);
 check(fight(key,5,.079).damageTaken===0,`${key}: below 8% deflects`);
 check(fight(key,5,.08).damageTaken===85,`${key}: at 8% does not deflect`);
 check(fight(key,7,.5,{zone:'metal_mine'}).damageTaken===72,`${key}: seven-piece local reduction retained`);
 const magic={special_1:{monsterCardSkill:{key:'test_lightning',name:'雷擊',chance:100,procEffects:[{key:'lightning',target:'enemy',params:{mode:'flat',value:100}}]}}};
 check(fight(key,5,.079,{monsterEquipped:magic}).damageTaken===100,`${key}: magic cannot deflect`);
 check(!getSetEffects(Object.fromEntries(SET_SLOTS.slice(0,5).map(s=>[s,{setKey:key}]))).some(e=>e.key==='physical_damage_reduction'),`${key}: old armor removed`);
}
for(const key of ['dragonscale_p','dragonscale_m']){
 const four=fight(key,4,.299),five=fight(key,5,.299),local=fight(key,7,.299,{zone:'dragon_realm'});
 check(four.totalDamage===0,`${key}: four pieces no thorns`);
 check(five.damageTaken===85&&five.totalDamage===10,`${key}: reflects 12% actual physical damage`);
 check(local.damageTaken===72&&local.totalDamage===9,`${key}: local DR before thorns`);
 check(fight(key,5,.5,{playerActiveEffects:[{key:'shield',params:{amount:100,value:100},duration:{mode:'battle',value:1}}]}).totalDamage===0,`${key}: absorbed damage cannot reflect`);
}
check(fight('mithril_p',5,.079,{playerActiveEffects:[{key:'magnetic_deflection',params:{value:100},duration:{mode:'battle',value:1}}]}).damageTaken===85,'foreign buff cannot grant magnetic deflection');
for (const key of ['magnetic_p','magnetic_m']) check(fight(key,5,.079,{monsterIsBoss:true}).damageTaken===0,`${key}: boss physical attack deflects`);
for (const key of ['dragonscale_p','dragonscale_m']) check(fight(key,5,.299,{monsterIsBoss:true}).totalDamage===10,`${key}: boss physical attack reflects`);
const magicOnly={special_1:{monsterCardSkill:{key:'test_lightning',name:'雷擊',chance:100,procEffects:[{key:'lightning',target:'enemy',params:{mode:'flat',value:100}}]}}};
check(fight('dragonscale_m',5,.299,{monsterEquipped:magicOnly}).totalDamage===10,'magic damage does not inflate dragon reflection');
for (const key of ['magnetic_p','magnetic_m']) {
 check(fight(key,5,.119,{sPieces:1}).damageTaken===0,`${key}: same-kind S upgrades to 12%`);
 check(fight(key,5,.12,{sPieces:1}).damageTaken===85,`${key}: 12% exclusive boundary`);
 check(fight(key,5,.12,{sPieces:5}).damageTaken===85,`${key}: multiple S pieces do not stack`);
 check(fight(key,4,.01,{sPieces:1}).damageTaken===85,`${key}: S does not bypass five-piece activation`);
}
for (const key of ['dragonscale_p','dragonscale_m']) {
 check(fight(key,5,.299).totalDamage===10,`${key}: A below 30% reflects`);
 check(fight(key,5,.30).totalDamage===0,`${key}: A 30% exclusive boundary`);
 check(fight(key,5,.449,{sPieces:1}).totalDamage===10,`${key}: S below 45% reflects`);
 check(fight(key,5,.45,{sPieces:1}).totalDamage===0,`${key}: S 45% exclusive boundary`);
 check(fight(key,5,.45,{sPieces:5}).totalDamage===0,`${key}: more S does not stack`);
}
const {bestiaryBonusPct,MAX_BONUS_PCT}=require('../src/shared/bestiary');
const {getSage}=require('../src/shared/jobAdvancement');
check(MAX_BONUS_PCT===10&&bestiaryBonusPct(50,100)===5&&bestiaryBonusPct(1000,100)===10,'bestiary linear growth and 10% cap');
const knowledge=getSage({itemId:'job_sage_t2_v1'}).knowledgeMult;check(knowledge===2,'sage knowledge multiplier unchanged');
function attack(bonus,cap){const old=Math.random;Math.random=()=>.5;try{battles++;return runCombatLoop({maxHp:10000,atk:100,def:0,flatDef:0,agi:10,dex:10,luk:10,hit:100,dodge:0,crit:0,combo:0,dmgMin:1,dmgMax:1},{maxHp:50000,atk:1,def:0,flatDef:0,agi:10,dex:10,luk:10,hit:100,dodge:0,critRate:0},'圖鑑木樁',50000,1,{bestiaryBonusPct:bonus,...(cap?{bestiaryBonusCapPct:cap}:{})}).totalDamage;}finally{Math.random=old;}}
const baseline=attack(0),normal=attack(10),overflow=attack(15),sage=attack(10*knowledge,10*knowledge);
check(normal>baseline&&normal===overflow&&sage>normal,'real combat clamps ordinary bonus at 10% and preserves sage x2');
const report={passed:!failures.length,battles,failures,rows,hashes:Object.fromEntries(['src/shared/combatLoop.js','src/shared/equipmentSetBonuses.js'].map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')]))};
const out=process.argv.find(x=>x.startsWith('--output='))?.slice(9);if(out)fs.writeFileSync(out,JSON.stringify(report,null,2));if(failures.length)process.exitCode=1;

for(const key of ['magnetic_p','magnetic_m','dragonscale_p','dragonscale_m']) {
 const upgraded=key.startsWith('magnetic')?12:45, base=key.startsWith('magnetic')?8:30;
 const kit=Object.fromEntries(SET_SLOTS.slice(0,7).map(slot=>[slot,{tier:'A',setKey:key,equipSlot:slot}]));
 check(getRegionalSetProcChance({...kit,weapon:{...kit.weapon,tier:'S'}},key)===upgraded,key+': S main-hand upgrades');
 for(const slot of ['shield','head_top','armor'])check(getRegionalSetProcChance({...kit,[slot]:{...kit[slot],tier:'S'}},key)===base,key+': S '+slot+' cannot upgrade');
 check(getRegionalSetProcChance({...kit,weapon:{tier:'S',setKey:'mithril_p'}},key)===base,key+': foreign S weapon cannot upgrade');
 check(getRegionalSetProcChance({...kit,weapon:{tier:'S',setKey:key.endsWith('_p')?key.replace('_p','_m'):key.replace('_m','_p')}},key)===base,key+': wrong build S weapon cannot upgrade');
 const inactive=fight(key,7,.1,{sSlot:'shield'});
 check(key.startsWith('magnetic')?inactive.damageTaken===85:inactive.totalDamage===10,key+': inactive S shield supplies neither seven-piece DR nor S upgrade');
}
report.passed=!failures.length;report.battles=battles;console.log(JSON.stringify({passed:report.passed,battles,failures}));if(out)fs.writeFileSync(out,JSON.stringify(report,null,2));if(failures.length){console.error(failures);process.exitCode=1;}
