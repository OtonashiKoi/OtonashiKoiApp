'use strict';
// Isolated HTTP/SSE harness. All writes target an ephemeral MongoDB; no Discord client is started.
const fs=require('node:fs'),assert=require('node:assert/strict');
const {MongoMemoryServer}=require('mongodb-memory-server');
(async()=>{
 const root=process.env.BATTLE_QA_ROOT;assert(root&&fs.existsSync(root+'/snapshot/items.bson'));
 const mongo=await MongoMemoryServer.create();
 process.env.MONGODB_URI=mongo.getUri();process.env.MONGODB_DB_NAME='qa_battle_flow';process.env.JWT_SECRET='qa-only-'+require('crypto').randomUUID();process.env.DISABLE_AUTO_ROTATE='1';
 const {getMongoDb}=require('../src/adapters/mongo/createMongoClient'),db=await getMongoDb();assert.equal(db.databaseName,'qa_battle_flow');
 const parse=name=>{const bytes=fs.readFileSync(root+'/snapshot/'+name+'.bson'),docs=[];for(let i=0;i<bytes.length;){const n=bytes.readInt32LE(i);docs.push(require('mongodb').BSON.deserialize(bytes.subarray(i,i+n)));i+=n;}return docs;};
 await db.collection('items').insertMany(parse('items'));await db.collection('monsters').insertMany(parse('monsters'));
 const sc=require('../src/bot/runtimeContext').serviceContext,engine=require('../src/services/realtime/normalLiveCombat').normalLiveCombat;
 engine.starterNpcs=process.env.QA_NPC!=='0';
 const id='qa-flow-player';await sc.playerService.ensurePlayer(id,'流程驗收冒險者');
 const items=await sc.itemService.listItems(),monsters=await sc.monsterService.listMonsters({zone:'normal',includeDisabled:false});
 const npc=require('../src/services/realtime/starterCompanions').buildCompanion('archer','normal',items,monsters);
 await sc.progressRepository.updateFields(id,{level:8,exp:0,attributes:{str:8,agi:6,vit:60,int:3,dex:15,luk:2},equipment:npc.equipped,inventory:[],statusPoints:0});
 // Real stat/equipment rules; deterministic two-enemy fixture keeps both runs comparable.
 const chosen=monsters.filter(m=>!m.isBoss).sort((a,b)=>a.calc.maxHp-b.calc.maxHp).slice(0,2);assert.equal(chosen.length,2);
 const first=chosen[0];await sc.monsterRepository.saveState({activeMonsterSeq:first.seq,currentHp:first.calc.maxHp,encounterCount:1,encounterMonsterSeq:first.seq,normalLiveSpawnAt:Date.now()+2000,killCount:{},damageMap:{},participants:[]},'normal');
 const originalList=sc.monsterService.listMonsters.bind(sc.monsterService);
 // The drop library stays real; the encounter picker is restricted to these two normal monsters.
 sc.monsterService.listMonsters=async opts=>{const all=await originalList(opts);return opts?.zone==='normal'?all.filter(m=>chosen.some(c=>c.id===m.id)):all;};
 const trace=[];
 if(process.env.QA_REPORT_DELAY){
  const complete=engine.complete.bind(engine),ready=engine.markReady.bind(engine);
  engine.markReady=(pid,payload)=>{trace.push({label:'battle-ready',id:payload.liveBattleId,at:Date.now()});return ready(pid,payload);};
  engine.complete=(pid,payload)=>{const at=Date.now();trace.push({label:'report-held',id:payload.liveBattleId,at});setTimeout(()=>{trace.push({label:'report-released',id:payload.liveBattleId,at:Date.now()});complete(pid,payload);},Number(process.env.QA_REPORT_DELAY));};
 }

 for(const [object,key,label] of [[sc.itemService,'listItems','item-library'],[sc.monsterService,'getState','monster-state'],[sc.monsterService,'listMonsters','monster-library']]){
  const fn=object[key].bind(object);object[key]=async(...args)=>{const start=performance.now();try{return await fn(...args);}finally{trace.push({label,ms:performance.now()-start,at:Date.now(),zone:args[0]?.zone||args[0]});}};
 }
 const action=engine.action.bind(engine);let forcedMisses=0;
 engine.action=(room,a,state,enemy,clock)=>{const start=performance.now(),stats=a.stats,mstats=a.monsterStats,random=Math.random;try{
   if(process.env.QA_FORCE_MISS&&!enemy&&forcedMisses<1){forcedMisses++;a.stats={...stats,hit:-100000};a.monsterStats={...mstats,dodge:100000};Math.random=()=>.5;}
   const result=action(room,a,state,enemy,clock);trace.push({label:'combat-calculation',ms:performance.now()-start,at:Date.now(),kind:enemy?'enemy':'player',logs:result.roundLogs});return result;
 }finally{a.stats=stats;a.monsterStats=mstats;Math.random=random;}};
 for(const [file,key] of [['grantKillCurrencyAndExp','grantKillCurrencyAndExp'],['grantKillDrops','grantKillDrops'],['finishMonsterKill','finishMonsterKill']]){
  const module=require('../src/services/battle/'+file),fn=module[key];module[key]=async(...args)=>{const at=Date.now();try{return await fn(...args);}finally{trace.push({label:key,ms:Date.now()-at,at});}};
 }
 const kill=require('../src/services/battle/monsterKillSettlement'),originalKill=kill.handleMonsterKill;
 kill.handleMonsterKill=async args=>{const at=Date.now();if(process.env.QA_SETTLE_DELAY)await new Promise(r=>setTimeout(r,Number(process.env.QA_SETTLE_DELAY)));try{return await originalKill(args);}finally{trace.push({label:'kill-settlement',ms:Date.now()-at,at});}};
 const express=require('express'),app=express(),jwt=require('jsonwebtoken');app.use(express.json());
 app.get('/api/qa/token',(req,res)=>res.json({jwt:jwt.sign({discordId:id,displayName:'流程驗收冒險者'},process.env.JWT_SECRET,{expiresIn:'1h'}),playerId:id,npc:engine.starterNpcs,monsters:chosen.map(m=>({name:m.name,hp:m.calc.maxHp}))}));
 app.get('/api/qa/trace',(req,res)=>res.json(trace));
 app.get('/api/qa/readback',async(req,res)=>res.json({progress:await sc.progressRepository.findByPlayerId(id),wallet:await sc.walletRepository.findByPlayerId(id)}));
 app.use(require('../src/api/server').createApiServer(null));
 const server=app.listen(5194,'127.0.0.1',()=>console.log('QA_READY '+JSON.stringify({port:5194,npc:engine.starterNpcs,db:db.databaseName,monsters:chosen.map(m=>({name:m.name,hp:m.calc.maxHp}))})));
 const stop=async()=>{server.close();await mongo.stop();process.exit(0);};process.on('SIGTERM',stop);process.on('SIGINT',stop);
})().catch(e=>{console.error(e);process.exit(1);});
