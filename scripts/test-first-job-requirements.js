'use strict';
const assert=require('node:assert/strict');
const {WeeklyQuestService}=require('../src/services/weeklyQuest/weeklyQuestService');
(async()=>{
const service=new WeeklyQuestService({getPlayerProgress:async()=>({})},{},{});
const q=service._normalizeDefinition({id:'test-first-job',cadence:'job',enabled:true,type:'battle_with_sword',target:10,rewardItemId:'job_swordsman_v1',unlockLevel:10,unlockAttributes:['str','dex'],unlockAttributeMin:10,unlockWeaponTypes:['sword_1h']});
const context={level:10,attributes:{str:5,dex:5},weaponType:'sword_1h',inventoryItemIds:new Set(),equippedItemIds:new Set(),ownedT2BaseKeys:new Set()};
assert(service._isQuestVisibleForPlayer(q,context));assert(!service._isQuestUnlocked(q,0,context));assert(!service._canAccrueProgress(q,context));
const rows=await service._getProgressByCadence('test','job',{definitions:[q],context});assert.equal(rows[0].jobRequirements.required,11);assert.equal(rows[0].jobRequirements.missing,1);assert.equal(rows[0].locked,true);assert.equal(rows[0].unlockHint,'屬性還差 1 點');
const ready={...context,attributes:{str:6,dex:5}};assert(service._isQuestUnlocked(q,0,ready));assert(service._canAccrueProgress(q,ready));
const readyRows=await service._getProgressByCadence('test','job',{definitions:[q],context:ready});assert.equal(readyRows[0].jobRequirements.missing,0);assert.equal(readyRows[0].locked,false);
const low={...ready,level:1};assert(service._isQuestVisibleForPlayer(q,low));assert(!service._isQuestUnlocked(q,0,low));assert(!service._canAccrueProgress(q,low));
const lowRows=await service._getProgressByCadence('test','job',{definitions:[q],context:low});assert.equal(lowRows.length,1);assert.equal(lowRows[0].jobRequirements.level,1);assert.equal(lowRows[0].locked,true);assert.equal(lowRows[0].done,false);
assert(!service._isQuestVisibleForPlayer({...q,cadence:'season'},context));
const bard={...q,rewardItemId:'job_bard_v1',unlockAttributes:['dex','agi','luk']};const bardRows=await service._getProgressByCadence('test','job',{definitions:[bard],context:{...context,attributes:{dex:2,agi:3,luk:1}}});assert.equal(bardRows[0].jobRequirements.missing,5);
console.log('PASS first-job requirements: strict > boundary, missing/ready totals, three attributes, unchanged level/accrual and hidden non-job rules');
})().catch(e=>{console.error(e);process.exitCode=1});
