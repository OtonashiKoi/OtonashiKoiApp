"use strict";
require('dotenv').config();const fs=require('node:fs'),assert=require('node:assert/strict'),jwt=require('jsonwebtoken');
process.env.JWT_SECRET='qa-http-'+require('crypto').randomBytes(32).toString('hex');process.env.MONGODB_DB_NAME='qa_normal_http_'+Date.now();process.env.DISABLE_AUTO_ROTATE='1';
const {getMongoDb}=require('../src/adapters/mongo/createMongoClient');
const sc=require('../src/bot/runtimeContext').serviceContext;
const {createApiServer}=require('../src/api/server');
const {normalLiveCombat}=require('../src/services/realtime/normalLiveCombat');
(async()=>{
 const db=await getMongoDb();assert.ok(db.databaseName.startsWith('qa_normal_http_'));
 const bytes=fs.readFileSync('/Users/riuchen/Documents/game-backups/realtime-combat-20261005/snapshot/items.bson');const items=[];for(let offset=0;offset<bytes.length;){const size=bytes.readInt32LE(offset);items.push(require('bson').deserialize(bytes.subarray(offset,offset+size)));offset+=size;}
 await db.collection('items').insertMany(items);
 const ids=['qa_http_A','qa_http_B'];
 for(const id of ids){await sc.playerService.ensurePlayer(id,id);await sc.progressRepository.updateFields(id,{level:8,exp:0,attributes:{str:30,agi:id===ids[0]?1:5,vit:30,int:5,dex:20,luk:1},equipment:{},inventory:[],statusPoints:0});}
 const loot=[{id:'qa-http-material',name:'验收素材',itemType:'material',tier:'D'},{id:'qa-http-armor',name:'驗收防具',itemType:'equipment',equipSlot:'armor',tier:'D',equipStats:{}}];for(const item of loot)await sc.itemRepository.save(item);
 await sc.progressRepository.updateFields(ids[0],{inventory:Array.from({length:149},(_,i)=>({uuid:'qa-bag-'+i,itemId:'qa-http-armor',itemType:'equipment',equipSlot:'armor'}))});
 const backpack=require('../src/services/backpack/backpackService');let membershipLookups=0;backpack.resolveEffectiveCapacity=async()=>{membershipLookups++;await new Promise(r=>setTimeout(r,2500));return {cap:150};};
 const monster=await sc.monsterService.createMonster({id:'qa-http-enemy',name:'共鬥驗收怪',zone:'normal',maxHp:600,atk:10,agi:1,level:8,def:0,flatDef:0,expReward:200,goldReward:80,drops:loot.map(item=>({itemId:item.id,chance:100})),enabled:true});
 await sc.monsterRepository.saveState({activeMonsterSeq:monster.seq,currentHp:600,encounterCount:1,encounterMonsterSeq:monster.seq,killCount:{},damageMap:{},participants:[]},'normal');
 normalLiveCombat.starterNpcs=false;
 await normalLiveCombat.ready(sc);
 const app=require('express')();app.get('/api/qa/token',(req,res)=>{const discordId=req.query.actor==='B'?'qa_http_B':'qa_http_A';res.json({jwt:jwt.sign({discordId,displayName:discordId},process.env.JWT_SECRET,{expiresIn:'30m'})});});app.use(createApiServer(null));
 const server=app.listen(process.argv.includes('--serve')?5194:0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 if(process.argv.includes('--serve')){console.log('QA HTTP listening on 127.0.0.1:5194 with isolated database '+db.databaseName);return;}
 const tokens=ids.map(discordId=>jwt.sign({discordId,displayName:discordId},process.env.JWT_SECRET,{expiresIn:'5m'}));
 const headers=i=>({Authorization:'Bearer '+tokens[i],'Content-Type':'application/json'});
 assert.equal((await fetch(base+'/api/combat/scene?zone=normal')).status,401);
 const profileResponse=await fetch(base+'/api/me/profile',{headers:headers(0)});assert.equal(profileResponse.status,200);const profileBody=await profileResponse.json();assert.equal(profileBody.data.player.discordId,ids[0]);assert.ok(Number.isFinite(profileBody.data.wallet.gold));assert.ok(Number.isFinite(profileBody.data.progress.level));
 const inventoryResponse=await fetch(base+'/api/me/inventory',{headers:headers(0)});assert.equal(inventoryResponse.status,200);const inventoryBody=await inventoryResponse.json();assert.equal(inventoryBody.data.inventory.filter(e=>e.itemType==='equipment'&&e.equipSlot==='armor').length,149,'batch hydration preserves every owned item');
 membershipLookups=0; // Inventory capacity display may query membership; measure combat from here.
 // The enemy may change after route preparation but before durable admission.
 const originalJoin=normalLiveCombat.join;
 for(const [name,change,failCas] of [
  ['sequence changed',s=>({...s,activeMonsterSeq:s.activeMonsterSeq+1}),false],
  ['transition started',s=>({...s,activeTransition:{startedAt:Date.now()}}),false],
  ['event started',s=>({...s,activeEvent:{id:'qa-event'}}),false],
  ['enemy died',s=>({...s,currentHp:0}),false],
  ['admission CAS rejected',s=>s,true],
 ]) {
  const before=await sc.monsterService.getState('normal'),wallet=await sc.walletRepository.findByPlayerId(ids[0]);
  normalLiveCombat.join=function(args){return originalJoin.call(this,{...args,sc:{...args.sc,monsterService:{...args.sc.monsterService,getState:async z=>change(await args.sc.monsterService.getState(z)),...(failCas?{saveStateIfActiveMonster:async()=>false}:{})}}});};
  let rejected;
  try{rejected=await fetch(base+'/api/combat/quick-battle',{method:'POST',headers:headers(0),body:JSON.stringify({zone:'normal',liveStartOnly:true})});}
  finally{normalLiveCombat.join=originalJoin;const room=normalLiveCombat.zones.get('normal');if(room)room.sc=sc;}
  assert.equal(rejected.status,409,name);assert.equal((await rejected.json()).code,'scene_transition',name);
  assert.equal(normalLiveCombat.players.has(ids[0]),false,'failed join must release actor reservation');
  const after=await sc.monsterService.getState('normal');assert.deepEqual(after,before,'failed join must not persist participation or damage');
  assert.deepEqual(await sc.walletRepository.findByPlayerId(ids[0]),wallet,'failed join must not debit or grant currency');
  console.log('PASS admission race:',name);
 }
 const packets=[[],[]],controllers=ids.map(()=>new AbortController());
 const streams=ids.map(async(id,i)=>{const r=await fetch(base+'/api/me/stream?token='+encodeURIComponent(tokens[i]),{signal:controllers[i].signal});assert.equal(r.status,200);let text='';for await(const chunk of r.body){text+=Buffer.from(chunk).toString();let cut;while((cut=text.indexOf('\n\n'))>=0){const message=text.slice(0,cut);text=text.slice(cut+2);for(const line of message.split('\n'))if(line.startsWith('data: ')){try{packets[i].push({...JSON.parse(line.slice(6)),receivedAt:Date.now()});}catch{}}}}});streams.forEach(p=>p.catch(()=>{}));
 const wait=ms=>new Promise(r=>setTimeout(r,ms));await wait(150);
 const requests=ids.map((id,i)=>fetch(base+'/api/combat/quick-battle',{method:'POST',headers:headers(i),body:JSON.stringify({zone:'normal',liveStartOnly:process.argv.includes('--start-only'),damage:999999999,attackSpeed:1,hp:999999999})}).then(async r=>({status:r.status,body:await r.json()})));
 let pendingStatus;for(let spin=0;spin<30;spin++){pendingStatus=await(await fetch(base+'/api/combat/live-session',{headers:headers(0)})).json();if(pendingStatus.data?.livePending)break;await wait(100);}const status=await (await fetch(base+'/api/combat/live-session?discordId='+ids[1],{headers:headers(0)})).json();assert.ok(status.data?.livePending,'HTTP should start a real pending session');
 const initial=(await sc.monsterService.getState('normal'));assert.equal(initial.currentHp,600,'forged request damage must not be trusted');
 const duplicate=await fetch(base+'/api/combat/quick-battle',{method:'POST',headers:headers(0),body:JSON.stringify({zone:'normal'})});assert.equal(duplicate.status,409);
 if(process.argv.includes('--start-only')){const early=await Promise.all(requests);assert.ok(early.every(r=>r.status===200&&r.body.data.livePending));assert.ok((await sc.walletRepository.findByPlayerId(ids[0])).gold===100,'start response must not grant rewards');}
 const start=Date.now();const history=[];
 while(Date.now()-start<48000){const snapshots=await Promise.all(ids.map((id,i)=>fetch(base+'/api/combat/scene?zone=normal',{headers:headers(i)}).then(r=>r.json())));const a=snapshots[0].data,b=snapshots[1].data;assert.equal(a.encounterId,b.encounterId);history.push({at:Date.now(),hp:a.liveHp,revision:a.revision,actorCount:a.actors?.length});if(a.liveHp===0||a.previous)break;await wait(350);}
 const results=await Promise.all(requests);assert.ok(results.every(r=>r.status===200),JSON.stringify(results));assert.ok(history.some(s=>s.hp<600&&s.hp>0),'damage must happen over actual server time');assert.ok(history.some(s=>s.actorCount===2),'both participants should be visible');
 for(let spin=0;spin<100&&!packets.every(a=>a.some(p=>p.type==='normal_live_result')&&a.some(p=>p.type==='normal_live_drops'));spin++)await wait(100);
 for(let i=0;i<2;i++){assert.ok(packets[i].some(p=>p.type==='normal_live_start'));assert.ok(packets[i].some(p=>p.type==='normal_live_action'));assert.ok(packets[i].some(p=>p.type==='normal_live_result'));assert.ok(results[i].body.data.liveBattleId);const wallet=await sc.walletRepository.findByPlayerId(ids[i]);assert.ok(wallet.gold>0);}
 assert.equal(membershipLookups,0,'material and underfilled equipment bags never wait for Discord membership');
 const transitionEvidence=[];
 for(let i=0;i<2;i++){
  const death=packets[i].find(p=>p.type==='zone_combat_scene'&&p.data.liveHp===0&&p.data.transitionPending);
  const drop=packets[i].find(p=>p.type==='normal_live_drops');
  const plan=packets[i].find(p=>p.type==='zone_combat_scene'&&p.data.next);
  assert.ok(death&&drop&&plan,'death, real drop and prepared successor must all be published');
  assert.ok(drop.data.drops.some(d=>d.name==='驗收防具'),'real equipment receipt must arrive');
  assert.equal(drop.data.encounterId,death.data.encounterId,'late loot belongs to the defeated encounter');
  assert.ok(plan.receivedAt<plan.data.next.spawnAt,'successor is ready before its scheduled arrival');
  assert.equal(plan.data.next.spawnAt-plan.data.advanceAt,1500,'walk is exactly 1.5 seconds');
  assert.equal(plan.data.next.spawnAt-death.data.deathAt,2150,'reward delivery cannot extend the death clock');
  transitionEvidence.push({deathAt:death.data.deathAt,dropAt:drop.receivedAt,advanceAt:plan.data.advanceAt,spawnAt:plan.data.next.spawnAt});
 }
 const planned=packets[0].find(p=>p.type==='zone_combat_scene'&&p.data.next).data.next;
 await wait(Math.max(0,planned.spawnAt-Date.now()+80));
 const arrived=(await(await fetch(base+'/api/combat/scene?zone=normal',{headers:headers(0)})).json()).data;
 assert.equal(arrived.encounterId,planned.encounterId,'actual successor uses the identity already sent before walking '+JSON.stringify({planned,arrived,observedAt:Date.now()}));
 const fullBag=await sc.progressRepository.findByPlayerId(ids[0]);
 assert.equal(fullBag.inventory.filter(e=>e.itemType==='equipment'&&e.equipSlot==='armor').length,150,'the final earned equipment is received');
 const blocked=await fetch(base+'/api/combat/quick-battle',{method:'POST',headers:headers(0),body:JSON.stringify({zone:'normal'})});
 assert.equal(blocked.status,409);assert.equal((await blocked.json()).code,'bag_full','capacity blocks the next battle, not earned loot');
 assert.equal(arrived.maxHp,planned.maxHp,'group size does not reroll at arrival');
 const own=(await(await fetch(base+'/api/combat/live-session?discordId='+ids[1],{headers:headers(0)})).json()).data;assert.equal(own.liveBattleId,results[0].body.data.liveBattleId,'query cannot impersonate another player');
 const result={ok:true,testDb:db.databaseName,checks:['actual authenticated HTTP and SSE for 2 players','public snapshots refer to the same living/dead enemy','request forgery does not change damage or speed','duplicate battle rejected','other actor ID in status query ignored','real-time intermediate HP persisted before final response','gold committed and live result delivered','independent loot delivery, prepared successor, exactly 1.5 seconds, no membership lookup below capacity'],elapsedMs:Date.now()-start,transitionEvidence,membershipLookups,history,resultIds:results.map(r=>r.body.data.liveBattleId),eventCounts:packets.map(a=>a.filter(p=>String(p.type).startsWith('normal_live')).length)};
 if(process.argv[2])fs.writeFileSync(process.argv[2],JSON.stringify(result,null,2));console.log(JSON.stringify({ok:true,checks:result.checks,elapsedMs:result.elapsedMs}));controllers.forEach(c=>c.abort());server.close();process.exit(0);
})().catch(e=>{console.error(e.stack);process.exit(1)});
