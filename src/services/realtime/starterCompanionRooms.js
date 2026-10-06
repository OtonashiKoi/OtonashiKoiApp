'use strict';
const {ZONES,loadCompanions}=require('./starterCompanions');
const {syncCompanions}=require('./starterCompanionCombat');
const {encounterKey}=require('./normalLiveJournal');
const {calculateBattleTickMs}=require('../../shared/battleTiming');
function liveForEncounter(state,zone,seq){
  const key=encounterKey(zone,seq,state);
  if(state.normalLive?.encounterKey===key)return state.normalLive;
  const npcs=Object.fromEntries(Object.entries(state.normalLive?.npcs||{}).map(([id,value])=>[id,{...value,damage:0,enemyTurns:0}]));
  return {seq,encounterKey:key,actors:{},npcs};
}
async function createLiveRoom(engine,sc,zone,monster,state,monsterStats=monster.calc){
  const epoch=Number(state.normalLiveSpawnAt)||engine.scene.ensure(zone,state,monster)?.spawnAt||engine.now();
  const enemyTick=calculateBattleTickMs(monsterStats.agi||1);
  const companions=engine.starterNpcs?await loadCompanions(sc,zone):[];
  return {sc,zone,monster,seq:Number(monster.seq),epoch,enemyAt:epoch+Math.max(1,Math.floor((engine.now()-epoch)/enemyTick)+1)*enemyTick,enemyTick,enemyTurn:0,members:new Map(),companions,closed:false};
}
function startRoomClock(engine,room){
  if(engine.auto&&!room.timer){
    room.timer=setInterval(()=>{
      // A slow read/settlement must not enqueue another 25 clock jobs/second.
      // Joins and withdrawals can then reach the serial queue promptly.
      if(room.closed||room.clockPending)return;
      room.clockPending=true;
      engine.advance(room.zone).catch(error=>engine.failRoom(room,error)).finally(()=>{room.clockPending=false;});
    },40);
    room.timer.unref?.();
  }
}
async function ensureStarterRoom(engine,sc,zone){
  if(!engine.starterNpcs||!ZONES[zone]||(engine.auto&&require('../access/maintenanceStore').isActive()))return;
  return engine.serial(zone,async()=>{
    const previous=engine.zones.get(zone);if(previous&&!previous.closed)return;
    const state=await sc.monsterService.getState(zone);
    if(state.activeTransition||state.activeEvent||Number(state.currentHp)<=0)return;
    const monster=(await sc.monsterService.listMonsters({includeDisabled:false,zone})).find(m=>Number(m.seq)===Number(state.activeMonsterSeq));
    if(!monster)return;
    const room=await createLiveRoom(engine,sc,zone,monster,state);
    const candidate={...state,normalLiveSpawnAt:room.epoch,normalLive:liveForEncounter(state,zone,room.seq)};
    syncCompanions(room,candidate,Math.max(engine.now(),room.epoch));
    if(!await sc.monsterService.saveStateIfActiveMonster(candidate,zone,room.seq,state.currentHp))return;
    engine.zones.set(zone,room);engine.updateScene(room,candidate,[],[]);startRoomClock(engine,room);
  });
}
async function startStarterRooms(engine,sc){
  if(!engine.auto||!engine.starterNpcs)return;
  const refresh=async()=>{
    if(engine.starterRoomsRefreshing)return;engine.starterRoomsRefreshing=true;
    try{const results=await Promise.allSettled(Object.keys(ZONES).map(zone=>ensureStarterRoom(engine,sc,zone)));for(const r of results)if(r.status==='rejected')console.error('[StarterCompanions]',r.reason.message);}
    finally{engine.starterRoomsRefreshing=false;}
  };
  await refresh();
  if(!engine.starterRoomsTimer){engine.starterRoomsTimer=setInterval(refresh,1000);engine.starterRoomsTimer.unref?.();}
}
module.exports={liveForEncounter,createLiveRoom,startRoomClock,ensureStarterRoom,startStarterRooms};
