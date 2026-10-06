'use strict';
const assert = require('node:assert/strict');
const group = require('../src/shared/encounterGroup');
const {runCombatLoop} = require('../src/shared/combatLoop');
const {normalMaxHp, scaleNormalMonster} = require('../src/services/monster/normalCoopScaling');
const {MonsterService} = require('../src/services/monster/monsterService');
const {iterateFloor} = require('../src/bot/handlers/towerHandlers');
const stats = {atk:50,maxHp:10000,agi:1,dex:1,int:0,level:10,def:0,flatDef:0,hit:100,dodge:0,crit:0,comboChance:0,dmgMin:1,dmgMax:1};
const monster = {id:'test',seq:7,name:'群怪',zone:'mid',enabled:true,str:4,level:10,maxHp:100,calc:{...stats,atk:10,maxHp:100}};
async function main() {
 for(const [r,n] of [[0,1],[.4,2],[.999,3]]) assert.equal(group.randomCount(3,()=>r),n);
 for(let n=1;n<=5;n++) for(let i=0;i<=n;i++) {
  assert.equal(group.remaining(i*100,100,n),i);
  if(i) assert.equal(group.targetHp(i*100,100),100);
 }
 const saved=group.spawnState({activeMonsterSeq:7},monster,()=>.999);
 assert.equal(saved.encounterCount,3); assert.equal(saved.currentHp,300); assert.equal(monster.calc.maxHp,100);
 for(const [encounterCount,bonus] of [[1,0],[2,10],[3,20],[5,20]]) assert.equal(group.expBonusPct({...saved,encounterCount},monster),bonus);
 assert.equal(group.expBonusPct({...saved,encounterMonsterSeq:8},monster),0,'stale encounter does not receive bonus');
 assert.equal(group.expBonusPct(saved,{...monster,isBoss:true}),0,'BOSS excluded');
 assert.equal(group.expBonusPct(saved,{...monster,zone:'elite'}),0,'non-normal zone excluded');
 const damaged={...saved,currentHp:150,damageMap:{one:{damage:150}}};
 const scaled=scaleNormalMonster(damaged,monster,{one:{damage:150},two:{damage:1},three:{assist:1}});
 assert.equal(normalMaxHp({...damaged,...scaled},monster),300);
 assert.equal(group.remaining(scaled.currentHp,scaled.coopMaxHp/3,3),2,'joining players cannot revive the first defeated monster');
 let state={}; const svc=new MonsterService({findAll:async()=>[monster],saveState:async s=>state=structuredClone(s),getState:async()=>state});
 const random=Math.random; Math.random=()=>.999;
 try { await svc.saveState({activeMonsterSeq:7,currentHp:100},'mid'); } finally {Math.random=random;}
 assert.equal(state.currentHp,300);
 Math.random=()=>0;try{await svc.saveState({...state,currentHp:250},'mid');}finally{Math.random=random;}
 assert.equal(state.encounterCount,3); assert.equal(state.currentHp,250,'ordinary save must not reroll or restore HP');
 Math.random=()=>.5;
 try {
  for(const [hp,taken,left] of [[300,30,3],[250,20,2],[200,20,2],[150,10,1],[100,10,1],[50,0,0]]) {
   const r=runCombatLoop({...stats},monster.calc,monster.name,hp,1,{playerLevel:10,encounterCount:3,encounterUnitHp:100,equipped:{},inventory:[]});
   assert.equal(r.damageTaken,taken,`alive attackers for HP ${hp}`);assert.equal(r.remainingEnemies,left);
  }
  const boss=runCombatLoop({...stats},monster.calc,monster.name,100,1,{playerLevel:10,monsterIsBoss:true,encounterCount:5,encounterUnitHp:100,equipped:{},inventory:[]});
  assert.equal(boss.encounterCount,1);assert.equal(boss.damageTaken,10);
  const members=['tank','dps'].map(id=>({discordId:id,name:id,partyV2:true,level:10,towerRole:id,stats:{...stats,agi:1,atk:1},maxHp:10000,currentHp:10000,equipped:{},inventory:[]}));
  const it=iterateFloor({partyV2:true,currentFloor:1,members},{...monster,encounterCount:5},500,10);
  const actions=[];for(let i=0;i<14;i++){const r=it.next();assert(!r.done);actions.push(r.value);}it.return();
  const enemies=actions.filter(a=>a.type==='monster');
  assert.equal(new Set(enemies.map(a=>a.actorId)).size,5,'five enemies have independent action clocks');
  assert(enemies.every(a=>a.targetId==='tank'),'existing tank targeting retained');
  assert(enemies.every(a=>a.logs.filter(x=>x.includes('造成 **10**')).length<=1),'enemy actions are separate, not one five-hit burst');
 } finally {Math.random=random;}
 console.log('PASS group spawn persistence, segmented HP, 3→2→1 attacks, immediate kill exclusion, coop no revival, BOSS singleton, five independent party actions/tank targeting');
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
