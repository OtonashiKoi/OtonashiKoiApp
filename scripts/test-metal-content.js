"use strict";
const assert=require('node:assert/strict');
const {WorldBossService,isWorldBossZone}=require('../src/services/worldBoss/worldBossService');
const {getWorldBossPartKeys,createWorldBossPartHpTemplate,getWorldBossTargetProfile,applyWorldBossTargetToPlayerStats,applyWorldBossTargetToMonster}=require('../src/services/battle/bossMechanics');
const {checkZoneLevelRequirement,canPlayerAccessZone}=require('../src/shared/zones');
const {normalZoneExpMultiplier}=require('../src/shared/normalZoneExp');
const {loadBson}=require('./verify-normal-progression');
const {buildMetalContent}=require('./lib/metal-content');
const {MonsterService}=require('../src/services/monster/monsterService');
async function main(){
 const snap=process.argv.find(x=>x.startsWith('--snapshot='))?.slice(11);assert.ok(snap);
 const items=loadBson(snap+'/items.bson'),monsters=loadBson(snap+'/monsters.bson');
 const p=buildMetalContent(items,monsters);
 assert.equal(isWorldBossZone('metal_throne'),true);assert.equal(isWorldBossZone('metal_mine'),false);
 assert.ok(checkZoneLevelRequirement('metal_mine',39));assert.equal(checkZoneLevelRequirement('metal_mine',40),null);
 assert.ok(checkZoneLevelRequirement('metal_throne',49));assert.equal(checkZoneLevelRequirement('metal_throne',50),null);
 assert.equal(canPlayerAccessZone('event_1','865264891991425055'),false);
 assert.equal(normalZoneExpMultiplier('metal_mine',40),1);assert.equal(normalZoneExpMultiplier('metal_mine',50),0.95);
 assert.deepEqual(getWorldBossPartKeys('metal_throne'),['body']);
 assert.deepEqual(createWorldBossPartHpTemplate(1500000,'metal_throne'),{body:1500000});
 assert.deepEqual(getWorldBossTargetProfile('body','metal_throne'),{label:'本體'});
 assert.equal(applyWorldBossTargetToPlayerStats({atk:500},'body','metal_throne').stats.atk,500);
 assert.equal(applyWorldBossTargetToMonster({atk:165,flatDef:0},{},'body','metal_throne').monsterStats.atk,165);
 const svc=new WorldBossService({getConfig:async()=>p.config.value},{bossKey:'steel_crown'});
 const cfg=await svc.getConfig();
 for(const [hp,atk]of [[100,1],[30,1],[29.9,1.15],[0,1.15]]){
   const phase=svc.resolvePhase(cfg,hp);assert.equal(phase.atkMultiplier,atk);assert.equal(phase.lightningEnabled,false);assert.equal(phase.agiBonus,0);
 }
 const ms=new MonsterService({findAll:async()=>[...monsters.filter(m=>!p.mobs.some(x=>x.id===m.id)),...p.mobs]});
 const world=await ms.listMonsters({zone:'metal_throne'});assert.equal(world.length,1);assert.equal(world[0].id,'metal-steel-crown');
 for(const tier of ['A','S']){
   const g=p.gear.filter(i=>i.tier===tier);assert.equal(g.length,30);
   assert.equal(new Set(g.filter(i=>i.equipSlot==='weapon').map(i=>i.weaponType)).size,11);
   for(const kind of ['p','m'])for(const slot of ['head_top','head_mid','head_low','armor','garment','shoes','accessory_l','accessory_r'])assert.ok(g.some(i=>i.setKey==='magnetic_'+kind&&i.equipSlot===slot),tier+'/'+kind+'/'+slot);
 }
 assert.ok(p.mobs.filter(m=>m.zone==='metal_mine').every(m=>m.drops.every(d=>!p.gear.some(i=>i.id===d.itemId&&i.tier==='S'))));
 console.log('PASS: new map gates, EXP band, 60 gear coverage, single-body boss, phase boundaries, no inherited lightning / event gate preserved');
}
main().catch(e=>{console.error(e);process.exitCode=1});
