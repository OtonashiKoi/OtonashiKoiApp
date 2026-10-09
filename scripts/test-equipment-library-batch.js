'use strict';
const assert=require('node:assert/strict');
const {mergeEquippedFromLibrary}=require('../src/shared/effectEngine');
(async()=>{
 const equipped={weapon:{uuid:'owned',itemId:'sword',enhanceLevel:7,equipStats:{atk:80},stackCount:1},offhand:null,head:{itemId:'hat'},body:{itemId:'sword'}};
 const items=[{id:'hat',name:'帽',passiveEffects:[{type:'def',value:12}]},{id:'sword',name:'劍',equipStats:{atk:5},passiveEffects:[{type:'atk',value:9}],monsterCardSkill:{kind:'qa'}}];let batchCalls=0;
 const repo={findByIds:async ids=>{batchCalls++;assert.deepEqual(ids,['sword','hat']);return items;},findById:async()=>{throw Error('individual read must not run');}};
 const merged=await mergeEquippedFromLibrary(equipped,repo);assert.equal(batchCalls,1);assert.equal(merged.weapon.uuid,'owned');assert.equal(merged.weapon.enhanceLevel,7);assert.equal(merged.weapon.equipStats.atk,80);assert.equal(merged.head.name,'帽');assert.equal(merged.body.name,'劍');assert.deepEqual(merged.weapon.monsterCardSkill,{kind:'qa'});
 items[1].passiveEffects=[{type:'atk',value:27}];assert.equal((await mergeEquippedFromLibrary(equipped,repo)).weapon.passiveEffects[0].value,27,'next read sees design changes without stale cache');
 assert.deepEqual(await mergeEquippedFromLibrary(equipped,{findByIds:async()=>{throw Error('db offline')}}),equipped);
 const legacy=await mergeEquippedFromLibrary(equipped,{findById:async id=>({name:id})});assert.equal(legacy.weapon.name,'sword');
 console.log('PASS one batch, arbitrary result order, latest definitions, enhancement/ownership preserved, failure and legacy fallback');
})().catch(e=>{console.error(e);process.exit(1)});
