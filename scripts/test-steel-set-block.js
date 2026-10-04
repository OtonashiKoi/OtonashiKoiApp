'use strict';
const assert=require('assert/strict');
const {calcPlayerStats}=require('../src/shared/combatStats'),{runCombatLoop}=require('../src/shared/combatLoop');
const {SET_SLOTS,getSetEffects}=require('../src/shared/equipmentSetBonuses');
const rows=[];let battles=0;
for(const key of ['steel_p','steel_m']){
 const equipment=n=>Object.fromEntries(SET_SLOTS.filter(s=>!["weapon","shield"].includes(s)).slice(0,n).map(s=>[s,{tier:'A',equipSlot:s,setKey:key}]));
 assert.equal(getSetEffects(equipment(4)).some(e=>e.key==='block_chance_up'),false);
 assert.equal(getSetEffects(equipment(5)).find(e=>e.key==='block_chance_up').params.value,8);
 const before=Math.random;let seed=937451;
 Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296};
 try{for(const count of [4,5]){let blocks=0;const eq=equipment(count);const stats={...calcPlayerStats({str:10,int:10,vit:10,agi:10,dex:10,luk:10},eq,[],[],{zone:'normal'}),maxHp:10000,def:0,flatDef:0,agi:10,dodge:0};
 for(let i=0;i<400;i++){const r=runCombatLoop(stats,{maxHp:50000,atk:100,def:0,flatDef:0,agi:10,dex:100,luk:10,hit:100,dodge:0},'防禦木樁',50000,1,{equipped:eq,skipPlayerAttack:true});battles++;blocks+=Number(r.combatStats?.blockCount)||0;}
 assert.ok(count===4?blocks===0:blocks>=10&&blocks<=55,key+': block count '+blocks);rows.push({key,count,blocks,battles:400});
 }}finally{Math.random=before;}
}
const fs=require('fs');const report={passed:true,battles,seed:937451,rows};const out=process.argv.find(a=>a.startsWith('--output='))?.slice(9);if(out)fs.writeFileSync(out,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
