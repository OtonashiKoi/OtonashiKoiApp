"use strict";
const assert=require('assert/strict'), {crushHp}=require('../src/shared/eventWorldBoss'),rb=require('../src/shared/rabbitWorldBoss');
const {runCombatLoop}=require('../src/shared/combatLoop');
for(const [hp,max,expected]of [[1000,1000,10],[200,1000,10],[3,1000,3],[1,1000,1],[0,1000,0],[51,101,2]])assert.equal(crushHp(hp,max),expected);
const stats={maxHp:1000,atk:10,def:0,str:1,agi:1,vit:1,int:1,dex:100,luk:1,hit:100,dodge:0,crit:0,combo:0};
const monster={...stats,maxHp:100000,atk:999999};
for(const name of ['海嘯','胡桃自摸','蒸氣大爆發'])for(const hp of [1000,200,3,1]){
 const res=runCombatLoop(stats,monster,name,100000,15,{equipped:{},inventory:[],startPlayerHp:hp,eventHpCrush:true,eventHpCrushName:name});
 assert.equal(res.finalPlayerHp,crushHp(hp,1000));assert.equal(res.outcome,'timeout');assert.equal(res.totalDamage,0);assert.equal(res.damageTaken,hp-res.finalPlayerHp);assert.equal(res.nextRound,1);
}
const state={};rb.advance(state,100,100,20,1000);assert.equal(rb.view(state,1000).dodgeBonus,45);
for(let n=0;n<5;n++)rb.recordDamage(state,10,1001+n);assert.equal(rb.view(state,1007).phase,'rage');assert.equal(rb.view(state,1007).dodgeBonus,0);
rb.advance(state,69,100,20,1008);assert.equal(state.rabbit.cast.target,5);assert.deepEqual(state.rabbit.marks,[70]);
const cast=state.rabbit.cast.id;rb.recordDamage(state,999999,1009);assert.equal(rb.view(state,1010).phase,'casting','damage cannot interrupt');
assert.equal(rb.poke(state,'x',cast,1011).interrupted,false);assert.equal(rb.poke(state,'x',cast,1012).duplicate,true);
for(const id of ['y','z','w','v'])rb.poke(state,id,cast,1013);assert.equal(rb.view(state,1014).phase,'recovery');assert.equal(rb.poke(state,'x',cast,1015).ok,false);
rb.advance(state,20,100,5,32002);assert.deepEqual(state.rabbit.marks,[70,30]);const restored=JSON.parse(JSON.stringify(state));rb.advance(restored,20,100,5,52002);assert.ok(rb.crushPending(restored,'x',52003));rb.markCrushed(restored,'x');assert.equal(rb.crushPending(restored,'x',52003),false);assert.ok(rb.crushPending(restored,'y',52003));
rb.advance(restored,20,100,5,100000);assert.deepEqual(restored.rabbit.marks,[70,30]);assert.equal(restored.rabbit.cast,null);
console.log('Rabbit original: taunt/rage/dodge/poke/no damage interrupt/retry/restart/nonlethal failure: PASS');
