"use strict";
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{deserialize}=require('bson');
require('dotenv').config({quiet:true});
const testDb=`event_boss_verification_${Date.now()}`;
process.env.MONGODB_DB_NAME=testDb;
assert.ok(testDb.startsWith('event_boss_verification_'));
const {getMongoDb,closeMongoClient}=require('../src/adapters/mongo/createMongoClient');
const {loadCharacters}=require('./test-event-worldboss-growth');
const {buildEventBossContent}=require('./lib/event-boss-content');
const {createGameProgress}=require('../src/domain/progress/createGameProgress');
const {ZONE_BY_KEY}=require('../src/shared/zones');
function bson(file){const b=fs.readFileSync(file),out=[];let p=0;while(p<b.length){const n=b.readInt32LE(p);out.push(deserialize(b.subarray(p,p+n)));p+=n;}return out;}
async function main(){
 const output=process.argv.find(a=>a.startsWith('--output='))?.slice(9);assert.ok(output);
 const snapshot='/Users/riuchen/Documents/game-backups/worldboss-implementation-20261004/live-snapshot';
 const db=await getMongoDb();
 for(const name of ['items','monsters','worldBossConfig','weeklyQuests','shopItems','enchantConfig','gameSeasonState']){
  const rows=bson(snapshot+'/'+name+'.bson');if(rows.length)await db.collection(name).insertMany(rows);
 }
 const ht=await db.collection('monsters').findOne({id:'event-northwind-hutao'}),items=await db.collection('items').find({}).toArray(),content=buildEventBossContent(items,ht);
 for(const i of content.items)await db.collection('items').updateOne({id:i.id},{$set:i},{upsert:true});
 await db.collection('monsters').insertOne(content.monster);
 await db.collection('monsters').updateOne({id:ht.id},{$set:{chestDrops:content.hutaoChestDrops}});
 await db.collection('monsters').updateOne({id:'event-island-turtle'},{$set:{enabled:true}});
 const turtle=await db.collection('monsters').findOne({id:'event-island-turtle'});
 const aDrops=items.filter(i=>i.tier==='A'&&(i.setKey==='island_turtle'||i.setKeys?.includes('island_turtle'))).map(i=>({itemId:i.id,itemName:i.name,chance:4.25}));
 await db.collection('monsters').updateOne({id:turtle.id},{$set:{chestDrops:turtle.drops,drops:[...turtle.drops,...aDrops]}});
 assert.equal(aDrops.length,17,'existing turtle A sources');

 await db.collection('worldBossConfig').updateOne({_id:'island_turtle'},{$set:{'value.enabled':true}});
 await db.collection('worldBossConfig').insertOne({_id:'mantou_rabbit',value:content.config});
 await db.collection('maintenanceState').insertOne({_id:'default',enabled:false,strict:false,openAt:null,activateAt:null});
 await require('../src/services/access/seasonStateStore').refresh();
 const chars=loadCharacters('/Users/riuchen/Documents/game-backups/growth-rerun-20261002-v2');
 chars.forEach((c,n)=>{c.id=`event-test-${n}`;for(const zone of ['event_boss','event_boss_hutao_preview','event_boss_rabbit_preview'])ZONE_BY_KEY[zone].previewPlayerIds=[...(ZONE_BY_KEY[zone].previewPlayerIds||[]),c.id];});
 // Time is advanced by real API cooldowns; only the interactive human-check is omitted.
 const NativeDate=Date;let clock=NativeDate.now();global.Date=class extends NativeDate{constructor(...a){super(...(a.length?a:[clock]));}static now(){return clock;}};
 require('../src/services/humanCheck/humanCheckService').guard=async()=>({ok:true});
 const {serviceContext:sc}=require('../src/services/runtimeContext');
 const express=require('express'),jwt=require('jsonwebtoken'),app=express();app.use(express.json());app.use(require('../src/api/routes/playerAppRoutes').createPlayerAppRoutes(sc,null));app.use((e,q,s,n)=>s.status(e.statusCode||500).json({message:e.message,code:e.code}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.on('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
 async function request(c,url,body){const token=jwt.sign({discordId:c.id,displayName:c.summary.route.t2Name},process.env.JWT_SECRET,{expiresIn:'1h'});const response=await fetch(base+url,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};}
 const report={testDb,productionWrites:false,clock:'actual combat cooldown and quiz deadline; 11 characters enter together, wait for slowest animation before next wave',humanCheck:'interactive challenge omitted; combat, fees, HP, rewards and inventory use actual APIs and repositories',characters:chars.map(c=>({job:c.summary.route.t2Name,level:c.summary.level,source:c.source,hash:c.sha256})),bosses:[],failures:[]};
 try {
 for(const zone of (process.argv.includes('--only-rabbit')?['event_boss_rabbit_preview']:['event_boss','event_boss_hutao_preview','event_boss_rabbit_preview'])){
  clock+=180000;
  for(const c of chars){const p={...createGameProgress(c.id),level:50,seasonKey:require('../src/services/access/seasonStateStore').getActiveKey(),attributes:c.summary.attributes,equipment:structuredClone(c.equipment),inventory:structuredClone(c.options.inventory),activeEffects:[],exp:0};await db.collection('players').updateOne({discordId:c.id},{$set:{discordId:c.id,displayName:c.summary.route.t2Name,status:'active'}},{upsert:true});await sc.progressRepository.save(p);await sc.walletRepository.save({playerId:c.id,gold:c.summary.finalGold,diamonds:0});}
  const boss=(await sc.monsterService.listMonsters({zone,includeDisabled:false})).find(m=>m.isBoss);assert.ok(boss);
  await sc.monsterService.saveState({activeMonsterSeq:boss.seq,currentHp:boss.calc.maxHp,damageMap:{},participants:[],killCount:{}},zone);
  const start=clock;let entries=0,deaths=0,crushes=0,quizCount=0,killed=false,damage=0,waveMs=0,waveWait=0;
  for(let n=0;n<1500&&!killed;n++){
   const c=chars[n%chars.length],s=await sc.monsterService.getState(zone),part=Object.keys(require('../src/services/battle/bossMechanics').ensureWorldBossPartState(s,boss.calc.maxHp,zone).worldBossPartsHp).find(k=>k!=='head'&&s.worldBossPartsHp?.[k]>0)||(s.worldBossPartsHp?.head>0?'head':'body');
   const liveStatus=await sc.worldBossServiceFor(zone).getConfigWithStatus();assert.ok(!liveStatus.status.battleTimeoutReached,zone+' exceeds actual battle limit');
   const before=(await sc.walletRepository.findByPlayerId(c.id)).gold;
   const res=await request(c,'/api/combat/quick-battle',{zone,part});
   if(res.status===400&&/漲潮中/.test(res.body.message||'')){assert.equal((await sc.walletRepository.findByPlayerId(c.id)).gold,before);clock+=60000;n--;continue;}
   if(res.status===409&&res.body.code==='HUTAO_RIICHI_ACTIVE'||res.status===409&&res.body.data?.hutaoEvent?.blocking){
    assert.equal((await sc.walletRepository.findByPlayerId(c.id)).gold,before,'quiz blocks before charging');
    const hs=await sc.hutaoEventService.getSnapshot(clock);const h=require('../src/shared/hutaoEvent'),q=h.questionById(hs.quiz.question.id||hs.quiz.questionId,hs.quiz.mark,hs.runKey);
    // Exercise both a failed quiz (self-draw crush) and a correct quiz.
    const choice=quizCount===0?q.choices.find(x=>!q.correctChoiceIds.includes(x.id)).id:q.correctChoiceIds[0];
    await sc.hutaoEventService.submitAnswer({quizId:hs.quiz.id,discordId:c.id,displayName:c.summary.route.t2Name,choiceId:choice},clock);
    clock=hs.quiz.endsAt+1;quizCount++;n--;continue;
   }
   if(res.status!==200)throw Error(zone+' entry '+n+': '+res.status+' '+JSON.stringify(res.body));
   if(zone==='event_boss_rabbit_preview') {
    const rb=require('../src/shared/rabbitWorldBoss'), state=await sc.monsterService.getState(zone), e=rb.view(state);
    if(e.phase==='casting') {
      const hp=state.currentHp;
      for(const pc of chars.filter(pc=>state.damageMap?.[pc.id]).slice(0,e.target)) {
        const gold=(await sc.walletRepository.findByPlayerId(pc.id)).gold;
        const pr=await request(pc,'/api/worldboss/rabbit/poke',{castId:e.castId});assert.equal(pr.status,200,JSON.stringify(pr.body));
        assert.equal((await sc.walletRepository.findByPlayerId(pc.id)).gold,gold,'poke costs no gold');
        assert.equal((await sc.monsterService.getState(zone)).currentHp,hp,'poke deals no damage');
        const retry=await request(pc,'/api/worldboss/rabbit/poke',{castId:e.castId});assert.ok([200,409].includes(retry.status),'poke retry is safe');
      }
      assert.equal(rb.view(await sc.monsterService.getState(zone)).phase,'recovery','poke interrupts into 30sec weakness');
    }
   }
   const d=res.body.data;entries++;damage+=Number(d.totalDamage||d.damage||0);deaths+=d.outcome==='lose';crushes+=(d.roundLogs||[]).some(l=>/壓血|大招結束/.test(l));
   waveMs=Math.max(waveMs,Number(d.cooldownMs)||30000);
   if(d.zoneTurtle?.tsunami)waveWait=Math.max(waveWait,Number(d.zoneTurtle.tsunamiRemainMs)||0);
   if(n%chars.length===chars.length-1){clock+=Math.max(waveMs,waveWait)+1;waveMs=0;waveWait=0;}
   killed=d.allPartsDefeated===true;
   if(entries%100===0)console.log(zone,'entries',entries,'HP',d.partHp?.current,'virtual minutes',Math.round((clock-start)/60000));
  }
  assert.ok(killed,zone+' not killed within1500 actual entries');
  const configState=await sc.worldBossServiceFor(zone).getConfigWithStatus();assert.ok(configState.status.cooldownRemainingMs>0,'death enters cooldown');
  const chestId=require('../src/services/battle/worldBossChestRewards')._resolveWorldBossChestId(boss,zone);assert.ok(chestId,'chest resolver');
  const winners=[];
  for(const c of chars){const p=await sc.progressRepository.findByPlayerId(c.id),chest=p.inventory.find(i=>i.itemId===chestId);if(!chest)continue;const count=chest.stackCount||1,oldQty=count;const opened=await request(c,'/api/me/inventory/use/'+chest.uuid,{});assert.equal(opened.status,200,JSON.stringify(opened.body));const fresh=await sc.progressRepository.findByPlayerId(c.id);const remaining=fresh.inventory.find(i=>i.itemId===chestId);assert.equal(remaining?.stackCount||0,oldQty-1,'one chest consumed');const reward=opened.body.data?.chestReward;assert.ok(reward?.rewardItemId,'opening yields item');assert.ok(fresh.inventory.some(i=>i.itemId===reward.rewardItemId),'reward persisted');winners.push({job:c.summary.route.t2Name,count,reward:reward.rewardItemName});}
  assert.equal(winners.length,6,'current contribution rule awards top6');
  const row={boss:boss.name,zone,entries,deaths,crushes,quizCount,minutes:(clock-start)/60000,chests:winners,killed:true,openAndPersisted:true};report.bosses.push(row);console.log('PASS',boss.name,entries,'entries',winners.length,'winners');
 }
 }catch(e){report.failures.push(e.message);console.error(e.message);process.exitCode=1;}finally{fs.writeFileSync(output,JSON.stringify(report,null,2));await new Promise(r=>server.close(r));await closeMongoClient();global.Date=NativeDate;}
}
main().catch(e=>{console.error(e);process.exitCode=1;return closeMongoClient()}).finally(()=>process.exit(process.exitCode||0));
