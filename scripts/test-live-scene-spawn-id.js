'use strict';
const assert=require('node:assert/strict');
const {ZoneCombatScene}=require('../src/services/realtime/zoneCombatScene');
let now=1000;const scenes=new ZoneCombatScene({now:()=>now,emit:()=>{}});scenes.liveMode=true;
const first={seq:1,id:'first',name:'first',calc:{maxHp:100,agi:1}},next={seq:2,id:'next',name:'next',calc:{maxHp:100,agi:1}};
const dead=scenes.ensure('normal',{activeMonsterSeq:1,currentHp:100,normalLiveSpawnAt:1000},first);dead.deathAt=1100;dead.liveHp=0;dead.transitionPending=true;
scenes.prepareNext('normal',next,{currentHp:100,activeMonsterSeq:2},{advanceAt:1750,spawnAt:3250});const plannedId=dead.next.encounterId;
now=3300;const saved={activeMonsterSeq:2,currentHp:100,normalLiveSpawnAt:3300};
// The Mongo write finishes, a scene GET reads it, then the writer's async
// monster-library read completes and publishes the exact same spawn again.
const fromGet=scenes.ensure('normal',saved,next);assert.equal(fromGet.encounterId,plannedId);fromGet.events.push({id:'already-started-hit'});fromGet.liveHp=80;
const fromWriter=scenes.ensure('normal',saved,next,{force:true});assert.equal(fromWriter.encounterId,plannedId,'late save publication cannot replace the already published spawn ID');assert.equal(fromWriter.liveHp,80);assert.equal(fromWriter.events.length,1);
// A real later spawn of the same monster must still get a new encounter.
fromWriter.deathAt=4000;now=6150;const later=scenes.ensure('normal',{...saved,normalLiveSpawnAt:6150},next,{force:true});assert.notEqual(later.encounterId,plannedId);
console.log('PASS GET versus delayed spawn publication preserves identity, HP and events; later same-monster spawn remains distinct');
