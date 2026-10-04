'use strict';
// Full sequential growth; computational workers simulate virtual time, never sleep it.
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
const {initialize,NativeDate}=require('./lib/journey-runtime');
const policy=require('./lib/journey-policy');
const {fight,settle,recordBattle}=require('./lib/journey-combat');
const {MonsterService}=require('../src/services/monster/monsterService');
const {pickWeightedNextMonster}=require('../src/services/battle/zoneTransitions');
const fatigue=require('../src/services/farmFatigue/farmFatigueService');
const {ZONE_BY_KEY}=require('../src/shared/zones');
const {loadBson}=require('./verify-normal-progression');
const {expToNextLevel}=require('../src/shared/progression');
const SOURCES=['src/shared/progression.js','src/shared/combatLoop.js','src/shared/combatStats.js','src/shared/jobAdvancement.js','src/shared/jobBadgeLevel.js','src/services/shop/shopService.js','src/services/enhance/enhanceService.js','src/services/job/jobBadgeService.js','src/services/weeklyQuest/weeklyQuestService.js','src/services/battle/grantKillCurrencyAndExp.js','src/services/battle/grantKillDrops.js','scripts/sim-normal-player-journey.js','scripts/lib/journey-runtime.js','scripts/lib/journey-policy.js','scripts/lib/journey-combat.js'];
const RULES={version:'journey-20261002-v1',runsPerRoute:100,maxHours:200,maxBattles:200000,targetLevel:50,
  attributes:'real random 1 + chosen 1, repeating 70% primary / 20% VIT / 10% AGI',
  route:'grass until Lv4 then level-appropriate map; retreat one map after >=50% losses over last20 bouts; retry after100 bouts',
  equipment:'keep real initial wooden sword; only actual monster drops or quest rewards may replace gear; no NPC purchases; acquired damage cards with matching weapon conditions; recycle spares; open acquired gold/EXP bags using actual service',
  enhancement:'normal mode +3; real costs/random failures; reserve250k for first T2 fromLv30; no free success',
  fatigue:'real service, stop for30min when fatigued; no idle earnings during rest',
  skills:'default stance; berserker uses blood-sacrifice; gauges start0 and persist through actual modules; minstrel90% per key',
  excluded:['other players/party buffs','world bosses and calendar/transition events','auction/crafting/casino','livestream/member/pass/checkin rewards','pet hatching/stat bonuses','manual elemental socketing/reroll'],
  hp:'actual normal Web/DC bout starts fullHP; monsterHP persists across continue/lose; real death30s and timing',
};
const routeForLevel=lv=>lv<4?'beginner':lv<10?'normal':lv<20?'mid':lv<30?'ancient_city':lv<40?'mistwood':'ancient_city_deep';
const ORDER=['beginner','normal','mid','ancient_city','mistwood','ancient_city_deep'];
async function runOne({snapshot,route,seed,output,maxHours=RULES.maxHours,maxBattles=RULES.maxBattles,stopLevel=50,captureEvery=0,monsterPlan=null}) {
  let state=seed>>>0;const random=Math.random;
  Math.random=()=>((state=(Math.imul(state,1664525)+1013904223)>>>0)/4294967296);
  const tracePath=path.join(output,route.baseKey+'-'+seed+'.jsonl.gz');
  const file=fs.createWriteStream(tracePath),gzip=zlib.createGzip({level:1});gzip.pipe(file);
  let r,events=0;const levels=[],milestones=[],zones={},firstTiers={},upgrades=[];
  const emit=(type,data)=>{
    const at=r?((r.now-start)/1000):0;
    gzip.write(JSON.stringify({type,t:at,lv:r?.progress.level,...data})+'\n');events++;
    if(type==='level')levels.push({level:data.level,seconds:at,zone:r?.zone,gold:data.gold});
    if(type==='t1'||type==='t2')milestones.push({type,seconds:at,...data});
    if(type==='equip'){upgrades.push({seconds:at,level:r.progress.level,zone:r.zone,...data});for(const [s,i]of Object.entries(data.after)){if(i.tier&&!firstTiers[i.tier])firstTiers[i.tier]={seconds:at,level:r.progress.level,id:i.id,name:i.name,slot:s};}}
  };
  const start=NativeDate.parse('2026-10-02T14:00:00Z');
  let battles=0,kills=0,deaths=0,restMs=0,managementMs=0,combatMs=0,blocked=null;
  const perf={fight:0,settle:0,record:0,manage:0};let mark;
  try{
    r=await initialize(snapshot,route,seed,emit);
    if(monsterPlan){const changes=new Map(monsterPlan.plan.map(x=>[x.id,x.values]));r.monsters=r.monsters.map(m=>({...m,...changes.get(m.id)}));}
    if(captureEvery){let lastLevel=0;r.captureCombat=data=>{if(data.level>=20&&(data.level!==lastLevel||battles%captureEvery===0)){lastLevel=data.level;fs.appendFileSync(path.join(output,route.baseKey+'-'+seed+'.fixtures.jsonl'),JSON.stringify({route,seed,battle:battles,...data})+'\n');}};}
    const originalItemsHash=crypto.createHash('sha256').update(JSON.stringify(r.items)).digest('hex');
    const monsters=await new MonsterService({findAll:async()=>r.monsters}).listMonsters();
    const byZone=Object.fromEntries(ORDER.map(z=>[z,monsters.filter(m=>(m.zone===z||m.allZones)&&!m.allZonesExclude?.includes(z))]));
    emit('start',{seed,route,initialGold:r.wallet.gold,attributes:r.progress.attributes,gear:policy.gearView(r.progress),rules:RULES});
    let monster=null,hp=0,totalDamage=0,zone='beginner',retreatUntil=0,retreatZone=null,recent=[];
    const zoneStates={};
    while(r.progress.level<stopLevel&&battles<maxBattles&&r.now-start<maxHours*3600000){
      const target=routeForLevel(r.progress.level);
      const selected=battles<retreatUntil?retreatZone:target;
      if(selected!==zone){zoneStates[zone]={monster,hp,totalDamage};zone=selected;({monster=null,hp=0,totalDamage=0}=zoneStates[zone]||{});recent=[];emit('zone',{zone,target});}
      r.zone=zone;
      if(!monster){monster=pickWeightedNextMonster(byZone[zone],null);assert.ok(monster,'no enabled monster '+zone);hp=monster.calc.maxHp;totalDamage=0;}
      const fee=Number(monster.entryFee??ZONE_BY_KEY[zone].defaultEntryFee)||0;
      if(r.wallet.gold<fee){blocked='insufficient entry gold';break;}
      if(fee)await r.rewardService.grantCurrency({amount:-fee,currencyType:'gold',source:'monster:entry-fee'});
      const beforeLevel=r.progress.level,beforeGold=r.wallet.gold,beforeExp=r.progress.exp,beforeHp=hp,beforeRng=state;
      mark=performance.now();const {result,ms,rounds,stats,job}=await fight(r,monster,hp,zone);perf.fight+=performance.now()-mark;battles++;hp=result.finalMonsterHp;totalDamage+=result.totalDamage;
      deaths+=result.outcome==='lose';recent.push(result.outcome==='lose');if(recent.length>20)recent.shift();
      const z=zones[zone]||={battles:0,kills:0,deaths:0,seconds:0,gold:0,exp:0};z.battles++;z.deaths+=result.outcome==='lose';z.seconds+=ms/1000;
      let reward;
      if(hp<=0){
        const existing=new Set(r.progress.inventory.map(i=>i.uuid));
        mark=performance.now();reward=await settle(r,monster,zone,totalDamage);perf.settle+=performance.now()-mark;kills++;z.kills++;z.gold+=reward?.gold||0;z.exp+=reward?.exp||0;
        emit('drops',{monster:monster.id,items:r.progress.inventory.filter(i=>!existing.has(i.uuid)).map(i=>({id:i.itemId,name:i.itemName,tier:i.tier,slot:i.equipSlot,plus:i.enhanceLevel||0,source:i.source,element:i.element,elementLevel:i.elementLevel,enchantments:i.enchantments}))});
      }
      mark=performance.now();await recordBattle(r,result,stats,zone,job);perf.record+=performance.now()-mark;
      emit('battle',{n:battles,rng:beforeRng,zone,monster:monster.id,mhp:beforeHp,end:hp,outcome:result.outcome,rounds,damage:result.totalDamage,taken:result.damageTaken,agi:stats.agi,ms,levelBefore:beforeLevel,expBefore:beforeExp,expAfter:r.progress.exp,goldBefore:beforeGold,goldAfter:r.wallet.gold,reward});
      r.now+=ms;combatMs+=ms;
      if(hp<=0){const priorId=monster.id;monster=pickWeightedNextMonster(byZone[zone],priorId);hp=monster.calc.maxHp;totalDamage=0;}
      if(reward||r.progress.level!==beforeLevel||battles%20===0){
        mark=performance.now();
        await policy.claimAvailable(r);
        const eventsBefore=events;await policy.equipAndRecycle(r,zone);await policy.enhance(r);
        const actions=events-eventsBefore;if(actions){const time=actions*1000;managementMs+=time;r.now+=time;}
        perf.manage+=performance.now()-mark;
      }
      const f=await fatigue.peek(r.id,r.now);
      if(f.penalized){restMs+=fatigue.RESET_GAP_MS;r.now+=fatigue.RESET_GAP_MS;emit('rest',{seconds:fatigue.RESET_GAP_MS/1000});}
      if(recent.length===20&&recent.filter(Boolean).length>=10&&battles>=retreatUntil){
        const idx=ORDER.indexOf(target);if(idx>0){retreatZone=ORDER[idx-1];retreatUntil=battles+100;emit('retreat',{from:target,to:retreatZone,retryBattle:retreatUntil});}
      }
      if(battles%2000===0)console.log(JSON.stringify({type:'progress',job:route.baseKey,seed,battles,level:r.progress.level,hours:(r.now-start)/3600000,perf}));
      if(battles%200===0)await new Promise(resolve=>setImmediate(resolve));
    }
    assert.equal(crypto.createHash('sha256').update(JSON.stringify(r.items)).digest('hex'),originalItemsHash,'shared library mutated');
    const questAudit=await r.questService.getPlayerProgress(r.id,'job');
    assert.equal(r.forbidden.length,0,'unknown database access: '+r.forbidden.join(','));
    const levelReached=r.progress.level>=stopLevel;
    const complete=levelReached&&(stopLevel<50||milestones.some(m=>m.type==='t1')&&milestones.some(m=>m.type==='t2'));
    blocked ||=complete?null:levelReached?'missing job transfer':battles>=maxBattles?'battle limit':'virtual time limit';
    const summary={route,seed,complete,blocked,level:r.progress.level,hours:(r.now-start)/3600000,combatHours:combatMs/3600000,restHours:restMs/3600000,managementHours:managementMs/3600000,battles,kills,deaths,
      levels,milestones,firstTiers,zones,currency:r.currency,expBySource:r.expBySource,finalGold:r.wallet.gold,attributes:r.progress.attributes,gear:policy.gearView(r.progress),upgrades,
      inventory:r.progress.inventory.map(i=>({id:i.itemId,name:i.itemName,qty:i.stackCount||1})),questAudit,tracePath,events,itemLibraryUnchanged:true,productionWrites:false};
    emit('finish',{complete,blocked,level:r.progress.level,hours:summary.hours});
    fs.writeFileSync(path.join(output,route.baseKey+'-'+seed+'.summary.json'),JSON.stringify(summary,null,2));return summary;
  }finally{Math.random=random;gzip.end();await new Promise((resolve,reject)=>{file.on('finish',resolve);file.on('error',reject);gzip.on('error',reject);});}
}
async function main(){
  const arg=k=>process.argv.find(a=>a.startsWith(k+'='))?.slice(k.length+1),snapshot=arg('--snapshot'),output=arg('--output');assert.ok(snapshot&&output);
  fs.mkdirSync(output,{recursive:true});const items=loadBson(snapshot+'/items.bson'),defs=loadBson(snapshot+'/weeklyQuests.bson');
  const m=policy.matrix(items,defs),jobs=arg('--jobs')?arg('--jobs').split(','):m.included.map(r=>r.baseKey),runs=Number(arg('--runs')||100);
  const planPath=arg('--plan'),monsterPlan=planPath?JSON.parse(fs.readFileSync(planPath)):null;
  const captureEvery=Number(arg('--capture-every')||0);
  const manifest={rules:RULES,matrix:m,runsPerRoute:runs,jobs,seeds:[],captureEvery,planHash:planPath?crypto.createHash('sha256').update(fs.readFileSync(planPath)).digest('hex'):null,sourceHashes:Object.fromEntries(SOURCES.map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'..',f))).digest('hex')])),snapshotHashes:Object.fromEntries(['items.bson','monsters.bson','weeklyQuests.bson','shopItems.bson','maintenanceState.bson','enchantConfig.json'].map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(snapshot+'/'+f)).digest('hex')]))};
  for(let n=0;n<runs;n++)for(const job of jobs){
    const route=m.included.find(r=>r.baseKey===job);assert.ok(route,'no eligible job '+job);
    manifest.seeds.push({job,n,seed:(Number(arg('--seed')||937451)+m.included.indexOf(route)*100003+n*7919)>>>0});
  }
  fs.writeFileSync(output+'/manifest.json',JSON.stringify(manifest,null,2));
  for(let n=0;n<runs;n++)for(const job of jobs){
    const route=m.included.find(r=>r.baseKey===job);assert.ok(route,'no eligible job '+job);
    const seed=manifest.seeds.find(s=>s.job===job&&s.n===n).seed;
    const summary=await runOne({snapshot,route,seed,output,maxHours:Number(arg('--max-hours')||RULES.maxHours),maxBattles:Number(arg('--max-battles')||RULES.maxBattles),stopLevel:Number(arg('--stop-level')||50),captureEvery,monsterPlan});
    console.log(JSON.stringify({type:'finished',job,n,seed,complete:summary.complete,hours:summary.hours,battles:summary.battles,milestones:summary.milestones.map(m=>({type:m.type,level:m.level,hours:m.seconds/3600}))}));
    fs.writeFileSync(output+'/manifest.json',JSON.stringify(manifest,null,2));
  }
}
if(require.main===module)main().catch(e=>{console.error(e.stack);process.exitCode=1});
module.exports={runOne,RULES,routeForLevel};
