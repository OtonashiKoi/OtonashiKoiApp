'use strict';
const fs=require('fs'),crypto=require('crypto');
const {calcPlayerStats}=require('../src/shared/combatStats');
const {runCombatLoop}=require('../src/shared/combatLoop');
const {SET_SLOTS,getSetEffects,getSetNumericBonuses,getRegionalSetProcChance}=require('../src/shared/equipmentSetBonuses');
const failures=[],rows=[];let battles=0;
const check=(ok,text)=>{if(!ok)failures.push(text)};
function fight(key,n=5,roll=.19,extra={}){
 const equipped=Object.fromEntries(SET_SLOTS.slice(0,n).map(s=>[s,{setKey:key,tier:'A',equipSlot:s}]));
 if(extra.sWeapon)equipped.weapon.tier='S';if(extra.foreignWeapon)equipped.weapon={tier:'S',equipSlot:'weapon',setKey:extra.foreignWeapon};if(extra.sShield)equipped.shield.tier='S';
 const stats={...calcPlayerStats({str:10,int:10,vit:10,agi:10,dex:10,luk:10},equipped,[],[],{zone:'normal'}),maxHp:10000,atk:100,def:0,flatDef:0,agi:10,hit:100,dodge:0,crit:0,combo:0,dmgMin:1,dmgMax:1};
 const monster={...extra.monsterOverrides,maxHp:50000,atk:100,def:0,flatDef:0,agi:10,dex:10,luk:10,hit:100,dodge:0,critRate:0};
 const previous=Math.random;let rolls=0;
 Math.random=()=>{if(/_tryHellfireEmber|_tryMithrilPrecision/.test(new Error().stack)){rolls++;return extra.firstOnly&&rolls>1?.99:roll;}return .5};
 try{battles++;const result=runCombatLoop(stats,monster,'套裝木樁',extra.hp||50000,extra.rounds||1,{equipped,zone:'normal',...extra});rows.push({key,n,roll,rolls,damageTaken:result.damageTaken,totalDamage:result.totalDamage,effects:result.monsterActiveEffects,log:result.roundLogs});return{...result,rolls}}finally{Math.random=previous;}
}
for(const key of ['hellfire_p','hellfire_m']){
 check(fight(key,4).monsterActiveEffects.every(e=>e.sourceId!=='set:hellfire_ember'),key+': four pieces inactive');
 check(fight(key).monsterActiveEffects.some(e=>e.sourceId==='set:hellfire_ember'&&e.params.casterAtk===100&&e.params.value===20),key+': A20% activates ATK-scaled burn');
 check(fight(key,5,.2).monsterActiveEffects.every(e=>e.sourceId!=='set:hellfire_ember'),key+': A exclusive boundary');
 check(fight(key,5,.299,{sWeapon:true}).monsterActiveEffects.some(e=>e.sourceId==='set:hellfire_ember'),key+': S30% activates');
 check(fight(key,5,.30,{sWeapon:true}).monsterActiveEffects.every(e=>e.sourceId!=='set:hellfire_ember'),key+': S exclusive boundary');
 check(fight(key,7,.25,{sShield:true}).monsterActiveEffects.every(e=>e.sourceId!=='set:hellfire_ember'),key+': S shield cannot upgrade');
 check(fight(key,7,.25,{foreignWeapon:'magnetic_p'}).monsterActiveEffects.every(e=>e.sourceId!=='set:hellfire_ember'),key+': foreign S cannot upgrade');
 check(fight(key,5,.01,{skipPlayerAttack:true}).rolls===0,key+': no ordinary attack no proc');
 check(fight(key,5,.01,{hp:1}).rolls===0,key+': dead enemy cannot burn');
 const duration=fight(key,5,.01,{rounds:4,firstOnly:true});
 check((duration.roundLogs.join("\n").match(/燒/g)||[]).length===2,key+': one application ticks exactly two following rounds');
 check(!duration.monsterActiveEffects.some(e=>e.sourceId==='set:hellfire_ember'),key+': expired burn cleared');
 const repeat=fight(key,5,.01,{rounds:3});check(repeat.monsterActiveEffects.filter(e=>e.sourceId==='set:hellfire_ember').length===1,key+': refresh cannot stack');
 const fx=getSetEffects(Object.fromEntries(SET_SLOTS.slice(0,5).map(s=>[s,{tier:'A',setKey:key}])));check(!fx.some(e=>e.key==='def_ignore'),key+': old five-piece magic penetration removed');
}
for(const key of ['mithril_p','mithril_m']){
 const baseline=fight(key,5,.20),active=fight(key,5,.19);
 check(active.totalDamage===Math.round(baseline.totalDamage*1.3),key+': main hit boosts30%');
 check(fight(key,4,.01).rolls===0,key+': four pieces inactive');
 check(fight(key,5,.299,{sWeapon:true}).totalDamage===active.totalDamage,key+': same S30% activates');
 check(fight(key,5,.30,{sWeapon:true}).totalDamage===baseline.totalDamage,key+': S30% exclusive boundary');
 check(fight(key,5,.01,{skipPlayerAttack:true}).rolls===0,key+': incoming damage cannot trigger');
 check(fight(key,5,.01,{monsterActiveEffects:[{key:'invincible_short',params:{duration:{mode:'turns',value:2}},appliedAt:1}]}).totalDamage===0,key+': invincibility preserved');
 const cap=fight(key,5,.01,{monsterOverrides:{incomingDamageCap:5}});check(cap.totalDamage<=5,key+': precision respects enemy cap');
 const gear=Object.fromEntries(SET_SLOTS.slice(0,7).map(slot=>[slot,{setKey:key,tier:'A',equipSlot:slot}]));
 check(getRegionalSetProcChance({...gear,shield:{...gear.shield,tier:'S'}},key)===20,key+': S shield cannot upgrade');
 check(getRegionalSetProcChance({...gear,weapon:{tier:'S',setKey:'magnetic_p'}},key)===20,key+': foreign S cannot upgrade');
 check(!getSetEffects(gear).some(e=>e.key==='magic_damage_reduction'),key+': incorrect refraction withdrawn');
}
for(const key of ['hellfire_p','mithril_p']) {
 const nums=getSetNumericBonuses(Object.fromEntries(SET_SLOTS.slice(0,5).map(s=>[s,{tier:'A',setKey:key}])));check(!nums.critDamagePct,key+': old five-piece crit damage removed');
}
const report={passed:!failures.length,battles,failures,rows,hashes:Object.fromEntries(['src/shared/combatLoop.js','src/shared/equipmentSetBonuses.js'].map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')]))};
const out=process.argv.find(a=>a.startsWith('--output='))?.slice(9);if(out)fs.writeFileSync(out,JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,battles,failures}));if(failures.length)process.exitCode=1;
