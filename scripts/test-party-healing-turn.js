'use strict';
const assert=require('node:assert/strict');
require('../src/adapters/mongo/createMongoClient').getMongoDb=async()=>{throw Error('isolated healing test: live DB forbidden');};
const core=require('../src/bot/handlers/towerHandlers');
const stats={atk:10,maxHp:1000,agi:30,dex:20,level:40,int:0,def:0,flatDef:0,hit:100,dodge:0,crit:0,dmgMin:1,dmgMax:1};
const member=(id,agi,hp=500)=>({discordId:id,name:id,partyV2:true,level:40,towerRole:id==='tank'?'tank':'dps',stats:{...stats,agi},maxHp:1000,currentHp:hp,equipped:{},inventory:[]});
function run(deadHealer=false){
 const members=[member('tank',80),member('dps',60),member('healer',20,deadHealer?0:500),member('dead',1,0),member('full',40,1000)];
 members[2].equipped={accessory1:{itemId:'test-healing-aura',passiveEffects:[{key:'heal_over_time',target:'party',trigger:'passive',params:{value:10,mode:'pct'}}]}};
 const monster={name:'回血時序怪',zone:'ancient_city_deep',calc:{...stats,agi:1,atk:1,maxHp:1e8}};
 const iterator=core.iterateFloor({partyV2:true,members,currentFloor:1},monster,1e8,1);
 let pulses=0;
 for(let i=0;i<24;i++){
  const before=members.map(m=>m.currentHp),step=iterator.next();assert(!step.done);
  const action=step.value,heals=action.logs.filter(x=>x.startsWith('💚 全隊回復'));
  if(action.actorId==='healer'&&!deadHealer){pulses++;assert.equal(heals.length,1);for(let j=0;j<2;j++){const h=action.partyHealing.find(h=>h.discordId===members[j].discordId);if(before[j]<1000){assert(h);assert.equal(h.hp,Math.min(1000,before[j]+100));assert.equal(h.amount,h.hp-before[j]);}}}
  else {assert.equal(heals.length,0);assert.equal((action.partyHealing||[]).length,0);}
  assert.equal(members[3].currentHp,0);assert(members.every(m=>m.currentHp<=m.maxHp));
 }
 if(deadHealer)assert.equal(pulses,0);else assert(pulses>=2);
 iterator.return();
}
run();run(true);
console.log('PASS real action loop: caster-only team healing, repeated pulses, no DPS/monster pulse, HP cap, dead target and dead provider');
