"use strict";
require('dotenv').config({quiet:true});const fs=require('node:fs'),assert=require('node:assert/strict'),jwt=require('jsonwebtoken');
const output=process.argv.find(x=>x.startsWith('--output='))?.slice(9);assert.ok(output);
process.env.JWT_SECRET='hutao-qa-'+require('crypto').randomBytes(32).toString('hex');process.env.MONGODB_DB_NAME='qa_hutao_live_'+Date.now();process.env.DISABLE_AUTO_ROTATE='1';
const {getMongoDb,closeMongoClient}=require('../src/adapters/mongo/createMongoClient');
const {loadBson}=require('./verify-normal-progression'),{candidate}=require('./lib/hutao-live-content');
const availability=require('../src/shared/worldBossAvailability');availability.CLOSED_BOSS_KEYS=availability.CLOSED_BOSS_KEYS.filter(k=>k!=='northwind_hutao'); // isolated process only
const {ZONE_BY_KEY}=require('../src/shared/zones'),zone='event_boss_hutao_preview';
const {loadCharacters}=require('./test-event-worldboss-growth');
let clock=Date.now(),server;const report={productionWrites:false,checks:[],db:process.env.MONGODB_DB_NAME};
async function check(name,work){try{const evidence=await work();report.checks.push({name,passed:true,evidence});console.log('PASS',name);}catch(e){report.checks.push({name,passed:false,error:e.stack});throw e;}}
(async()=>{
 const db=await getMongoDb();assert.ok(db.databaseName.startsWith('qa_hutao_live_'));const snapshot=process.argv.find(x=>x.startsWith('--snapshot='))?.slice(11)||'/Users/riuchen/Documents/game-backups/hutao-fix-20261008/live-before';
 for(const name of ['items','monsters','worldBossConfig','weeklyQuests','shopItems','enchantConfig','gameSeasonState']){const rows=loadBson(snapshot+'/'+name+'.bson');if(rows.length)await db.collection(name).insertMany(rows);}
 const source={card:await db.collection('items').findOne({id:'monster-card-northwind-hutao'}),monster:await db.collection('monsters').findOne({id:'event-northwind-hutao'}),config:await db.collection('worldBossConfig').findOne({_id:'northwind_hutao'})};
 const next=process.argv.includes('--live')?source:candidate(source.card,source.monster,source.config);await db.collection('items').replaceOne({_id:next.card._id},next.card);await db.collection('monsters').replaceOne({_id:next.monster._id},next.monster);next.config.value.enabled=true;await db.collection('worldBossConfig').replaceOne({_id:'northwind_hutao'},next.config);
 await db.collection('maintenanceState').insertOne({_id:'default',enabled:false,strict:false,openAt:null,activateAt:null});await require('../src/services/access/seasonStateStore').refresh();
 const sc=require('../src/services/runtimeContext').serviceContext,engine=require('../src/services/realtime/normalLiveCombat').normalLiveCombat;
 engine.auto=false;engine.starterNpcs=false;engine.now=()=>clock;engine.scene.now=()=>clock;
 require('../src/services/humanCheck/humanCheckService').guard=async()=>({ok:true});
 const chars=loadCharacters('/Users/riuchen/Documents/game-backups/growth-rerun-20261002-v2');chars.forEach((c,i)=>c.id='qa_hutao_'+i);ZONE_BY_KEY[zone].previewPlayerIds=chars.map(c=>c.id);
 const {createGameProgress}=require('../src/domain/progress/createGameProgress');
 const revive='c4794326-ced1-4efe-983d-17c14ee2f2f8',heal='3eb1d302-3d04-40a5-8335-1f9ed844dc27';
 const planFile=process.argv.find(x=>x.startsWith('--plan-file='))?.slice(12);
 const previewPlan=process.argv.includes('--serve')&&planFile?JSON.parse(fs.readFileSync(planFile,'utf8')).plan:null;
 const previewPotions=Object.keys(require('../src/bot/handlers/towerHandlers').TOWER_POTION_IDS).map((itemId,index)=>({uuid:'qa-preview-potion-'+index,itemId,stackCount:10}));
 for(const [i,c]of chars.entries()){
 await sc.playerService.ensurePlayer(c.id,c.summary.route.t2Name);const p=createGameProgress(c.id);
 await sc.progressRepository.save({...p,level:50,exp:0,attributes:c.summary.attributes,equipment:{...c.equipment,...(i===0?{special_1:{...next.card,itemId:next.card.id,uuid:'qa-card'}}:{})},inventory:[...c.options.inventory,...(process.argv.includes('--serve')?previewPotions.map(item=>({...item,uuid:item.uuid+'-'+i})):[{uuid:'qa-revive-'+i,itemId:revive,stackCount:5},{uuid:'qa-heal-'+i,itemId:heal,stackCount:5}])],combatPotionPlan:i===0&&previewPlan?previewPlan:{[revive]:5,[heal]:5}});
 await sc.rewardService.grantCurrency({discordId:c.id,displayName:c.id,currencyType:'gold',amount:500000,source:'admin:manual-grant',sourceRef:'qa-hutao-funded-'+i,operator:'QA'});
 }
 const monster=(await sc.monsterService.listMonsters({zone})).find(m=>m.id==='event-northwind-hutao');
 await sc.monsterRepository.saveState({activeMonsterSeq:monster.seq,currentHp:monster.calc.maxHp,worldBossPartsHp:{body:monster.calc.maxHp},killCount:{},damageMap:{},participants:[],normalLiveSpawnAt:clock},zone);
 const express=require('express'),app=express();if(process.argv.includes('--serve'))app.use('/uploads',express.static(require('path').resolve(__dirname,'../src/web/public/uploads')));app.use(express.json());app.use(require('../src/api/routes/playerAppRoutes').createPlayerAppRoutes(sc,null));app.use((e,q,s,n)=>s.status(e.statusCode||e.status||500).json({message:e.message,code:e.code}));
 server=app.listen(process.argv.includes('--serve')?5195:0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 const tokens=chars.map(c=>jwt.sign({discordId:c.id,displayName:c.id},process.env.JWT_SECRET,{expiresIn:'2h'}));
 async function request(i,path,body,method){const response=await fetch(base+path,{method:method||(body?'POST':'GET'),headers:{Authorization:'Bearer '+tokens[i],'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json()};}
 report.characters=chars.map(c=>({job:c.summary.route.t2Name,source:c.source,hash:c.sha256}));
 if(process.argv.includes('--serve')){
 engine.now=()=>Date.now();engine.scene.now=()=>Date.now();engine.auto=true;
 app.get('/api/qa/token',(q,s)=>s.json({jwt:tokens[Number(q.query.actor||0)],id:chars[Number(q.query.actor||0)].id}));
 app.post('/api/qa/tick',async(q,s,n)=>{try{clock=Date.now();const original=Math.random;Math.random=()=>.49;try{await engine.advance(zone);clock+=1;await engine.advance(zone);}finally{Math.random=original;}s.json({clock});}catch(e){n(e);}});
 app.post('/api/qa/down',async(q,s,n)=>{try{const st=await sc.monsterService.getState(zone),id=chars[Number(q.body.actor ?? 1)].id,hp=Number(q.body.hp || 0);st.normalLive.actors[id].hp=hp;st.normalLive.actors[id].active=hp>0;await sc.monsterService.saveStateIfActiveMonster(st,zone,monster.seq,st.currentHp);engine.players.get(id).hp=hp;engine.updateScene(engine.zones.get(zone),st,[],[]);s.json({down:true});}catch(e){n(e);}});
 console.log('QA Hutao server port5195; isolated DB '+db.databaseName);return;
 }
 await check('authenticated loadout counts stack quantities and rejects >10 without changing persisted plan',async()=>{
 const r=await request(0,'/api/me/combat-potions');assert.equal(r.status,200);assert.equal(r.body.data.items.find(i=>i.itemId===revive).count,5);
 assert.equal((await request(0,'/api/me/combat-potions',{plan:{[revive]:5,[heal]:6}},'PUT')).status,400);assert.equal((await sc.progressRepository.findByPlayerId(chars[0].id)).combatPotionPlan[heal],5);
 });
 await check('saved refill targets survive inventory shortage; authenticated configuration accepts targets above stock',async()=>{
 const p=await sc.progressRepository.findByPlayerId(chars[0].id);p.inventory.find(e=>e.uuid==='qa-heal-0').stackCount=3;await sc.progressRepository.save(p);
 const r=await request(0,'/api/me/combat-potions',{plan:{[revive]:5,[heal]:5}},'PUT');assert.equal(r.status,200);assert.equal(r.body.data.plan[heal],5);assert.equal(r.body.data.items.find(i=>i.itemId===heal).count,3);
 });
 await check('11 real Lv50 growth characters enter via live API; each debited exactly50000, no personal hourly limit',async()=>{
 const before=await Promise.all(chars.map(c=>sc.walletRepository.findByPlayerId(c.id))),responses=[];
 for(let i=0;i<chars.length;i++){const r=await request(i,'/api/combat/quick-battle',{zone,liveStartOnly:true});responses.push(r);assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.body.data.livePending,true);}
 for(let i=0;i<chars.length;i++){const after=await sc.walletRepository.findByPlayerId(chars[i].id);assert.equal(before[i].gold-after.gold,50000);assert.equal((await sc.progressRepository.findByPlayerId(chars[i].id)).hutaoChallengeUntil,0);}
 assert.equal((await request(0,'/api/combat/quick-battle',{zone,liveStartOnly:true})).status,409);assert.equal((await request(0,'/api/me/combat-potions',{plan:{}},'PUT')).status,409);
 const pouch=await request(0,'/api/combat/potions');assert.equal(pouch.body.data.items.find(i=>i.itemId===heal).remaining,3);assert.equal(pouch.body.data.items.reduce((n,i)=>n+i.remaining,0),8);
 const saved=await sc.progressRepository.findByPlayerId(chars[0].id);assert.equal(saved.combatPotionPlan[heal],5);assert.equal(saved.inventory.find(e=>e.uuid==='qa-heal-0').stackCount,3);
 return {characters:chars.length,openingHp:(await sc.monsterService.getState(zone)).currentHp};
 });
 await check('opening tsumo visible and four holder-only hits; authenticated scene has absolute15s buff',async()=>{
 const random=Math.random;Math.random=()=>.49;try{await engine.advance(zone);}finally{Math.random=random;}
 const state=await sc.monsterService.getState(zone),r=await request(0,'/api/combat/scene?zone='+zone);
 assert.equal(r.status,200);assert.ok(r.body.data.events.some(e=>e.fx==='tsumo'));assert.equal(state.normalLive.actors[chars[1].id].riichi.agiUntil,clock+15000);
 assert.equal(Object.keys(state.damageMap).length,1);assert.equal(engine.players.get(chars[0].id).attacks,0);return {openingDamage:state.damageMap[chars[0].id].damage};
 });
 await check('quiz API is available and cannot accept an answer before the HP mark',async()=>{
 const r=await request(0,'/api/worldboss/hutao/answer',{choiceId:'m2'});assert.equal(r.status,400);assert.equal(r.body.code,'HUTAO_QUIZ_CLOSED');const status=await request(0,'/api/worldboss/hutao/status');assert.equal(status.body.data.quiz,null);assert.equal(status.body.data.blocking,false);
 });
 await check('HTTP revive consumes one real stacked potion; same operation replay consumes none; persisted inventory readback',async()=>{
 const room=engine.zones.get(zone),target=chars[1].id,s=await sc.monsterService.getState(zone);s.normalLive.actors[target].hp=0;s.normalLive.actors[target].active=false;s.normalLiveDeath={[target]:{recoverAt:clock+30000}};
 assert.equal(await sc.monsterService.saveStateIfActiveMonster(s,zone,monster.seq,s.currentHp),true);room.members.get(target).hp=0;
 const pouch=await request(0,'/api/combat/potions'),req={battleId:pouch.body.data.battleId,operationId:'qa-http-revive-one',itemId:revive,targetId:target};
 assert.equal((await request(0,'/api/combat/potions/use',req)).status,200);assert.equal((await request(0,'/api/combat/potions/use',req)).status,200);
 const p=await sc.progressRepository.findByPlayerId(chars[0].id);assert.equal(p.inventory.find(e=>e.uuid==='qa-revive-0').stackCount,4);assert.equal(p.livePotionReceipts.length,1);
 const inventory=await request(0,'/api/me/inventory');assert.equal(inventory.status,200);return {remaining:4,revivedHp:(await sc.monsterService.getState(zone)).normalLive.actors[target].hp};
 });
 await check('continuous fight pauses for both Mahjong questions and resumes alongside 15s boss riichi',async()=>{
 const history=[];let beyond15=false,beyond120=false,buffSeen=false;let seed=2026100801;const marks=new Set(),answered=new Set();let pausedHp=null,pausedAttacks=null;
 const random=Math.random,realNow=Date.now;Math.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);Date.now=()=>clock;
 try{for(let step=0;step<3000&&!engine.zones.get(zone).closed;step++){
 clock+=250;await engine.advance(zone);
 const event=await sc.hutaoEventService.getSnapshot(clock);
 if(event.blocking){
   marks.add(event.quiz.mark);
   const state=await sc.monsterService.getState(zone),attacks=[...engine.players.values()].reduce((sum,a)=>sum+a.attacks,0);
   if(pausedHp!==null){assert.equal(state.currentHp,pausedHp,'boss HP must freeze during quiz');assert.equal(attacks,pausedAttacks,'player attacks must freeze during quiz');}
   pausedHp=state.currentHp;pausedAttacks=attacks;
   if(clock>=event.quiz.answerStartsAt&&!answered.has(event.quiz.id)){
     const question=require('../src/shared/hutaoEvent').questionForMark(event.quiz.mark,event.runKey);
     const result=await request(0,'/api/worldboss/hutao/answer',{quizId:event.quiz.id,choiceId:question.correctChoiceIds[0]});
     assert.equal(result.status,200,JSON.stringify(result));answered.add(event.quiz.id);
   }
 }else{pausedHp=null;pausedAttacks=null;if(event.effect?.kind==='buff')buffSeen=true;}
 if(step%40===0){const state=await sc.monsterService.getState(zone);history.push({at:clock,hp:state.currentHp,alive:[...engine.players.values()].filter(a=>a.hp>0).length});}
 if([...engine.players.values()].some(a=>a.attacks>15))beyond15=true;if(step>480&&engine.players.size)beyond120=true;
 }}finally{Math.random=random;Date.now=realNow;}
 const state=await sc.monsterService.getState(zone);assert.equal(engine.zones.get(zone).closed,true,'must reach terminal HP within fixture bound');assert.equal(beyond15,true);assert.equal(beyond120,true);assert.deepEqual([...marks].sort(),[40,70]);assert.equal(buffSeen,true);
 for(let wait=0;wait<100&&chars.some(c=>!engine.status(c.id)?.outcome);wait++)await new Promise(r=>setTimeout(r,50));
 const statuses=chars.map(c=>{const s=engine.status(c.id);return s?.liveReport||s;});assert.ok(statuses.every(s=>s&&!s.livePending&&['win','lose'].includes(s.outcome)),JSON.stringify(statuses.map(s=>({outcome:s?.outcome,live:s?.livePending}))));
 assert.equal(state.hutaoQuiz,undefined);return {history,marks:[...marks],outcomes:statuses.map(s=>({name:s.playerName,outcome:s.outcome,hp:s.finalPlayerHp,damage:s.totalDamage})),monsterHp:state.currentHp};
 });
 await check('kill awards six contribution chests; real open API consumes one and persists reward',async()=>{
 const chestId=require('../src/services/battle/worldBossChestRewards')._resolveWorldBossChestId(monster,zone),winners=[];
 for(let i=0;i<chars.length;i++){
   const p=await sc.progressRepository.findByPlayerId(chars[i].id),chest=p.inventory.find(e=>e.itemId===chestId);if(!chest)continue;
   const before=chest.stackCount||1,r=await request(i,'/api/me/inventory/use/'+chest.uuid,{});assert.equal(r.status,200,JSON.stringify(r));
   const fresh=await sc.progressRepository.findByPlayerId(chars[i].id);assert.equal(fresh.inventory.filter(e=>e.itemId===chestId).reduce((n,e)=>n+(e.stackCount||1),0),before-1);
   const reward=r.body.data.chestReward;assert.ok(reward?.rewardItemId);assert.ok(fresh.inventory.some(e=>e.itemId===reward.rewardItemId));winners.push({job:chars[i].summary.route.t2Name,reward:reward.rewardItemName});
 }
 assert.equal(winners.length,6);return winners;
 });
 await check('entry cooldown cannot be bypassed after loss or reboot; restart does not debit again',async()=>{
 const before=await sc.walletRepository.findByPlayerId(chars[0].id);const r=await request(0,'/api/combat/quick-battle',{zone,liveStartOnly:true});assert.equal(r.status,409);assert.equal((await sc.walletRepository.findByPlayerId(chars[0].id)).gold,before.gold);
 const Engine=require('../src/services/realtime/normalLiveCombat').NormalLiveCombat,recovered=new Engine({now:()=>clock,auto:false,starterNpcs:false});await require('../src/services/realtime/normalLiveRecovery').recoverNormalLive(sc,recovered);assert.equal((await sc.walletRepository.findByPlayerId(chars[0].id)).gold,before.gold);
 assert.equal((await sc.progressRepository.findByPlayerId(chars[0].id)).hutaoChallengeUntil,0);
 });
 server.close();await closeMongoClient();fs.writeFileSync(output,JSON.stringify(report,null,2));process.exit(0);
})().catch(async e=>{console.error(e);fs.writeFileSync(output,JSON.stringify({...report,error:e.stack},null,2));server?.close();await closeMongoClient();process.exit(1);});
