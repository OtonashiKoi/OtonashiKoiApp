'use strict';
const assert=require('node:assert/strict');
const {expToNextLevel,MAX_LEVEL}=require('../src/shared/progression');
const {NORMAL_ZONE_HOURLY_REWARDS:R,IDLE_REWARD_RATIO,MAX_LEVEL_EXP_TO_GOLD_DIVISOR}=require('../src/shared/normalEconomy');
const {getEnhanceCost}=require('../src/shared/enhanceConfig');
const {getParticipationGemTiers,getDynamicGoldPoolFloor}=require('../src/services/battle/battleRewardRules');
const {IdleService}=require('../src/services/idle/idleService');
const {ProgressService}=require('../src/services/progress/progressService');
async function main(){
 const mongo=require('../src/adapters/mongo/createMongoClient'),oldMongo=mongo.getMongoDb;
 const stream=require('../src/services/stream/globalBuffService'),oldBuff=stream.isShortTermBuffActive;
 const fatigueState=new Map();let buffActive=false;
 mongo.getMongoDb=async()=>({collection:()=>({findOne:async q=>fatigueState.get(q.discordId)||null,updateOne:async(q,u)=>fatigueState.set(q.discordId,{...u.$set})})});
 stream.isShortTermBuffActive=()=>buffActive;
 const fatigue=require('../src/services/farmFatigue/farmFatigueService');
 try {
  const t=100000000;fatigueState.set('economy-fatigue',{start:t,last:t+fatigue.SIX_HOURS_MS-1});
  assert.equal(await fatigue.applyAndGetMultiplier('economy-fatigue',t+fatigue.SIX_HOURS_MS-1),1);
  assert.equal(await fatigue.applyAndGetMultiplier('economy-fatigue',t+fatigue.SIX_HOURS_MS),.2);
  buffActive=true;assert.equal(await fatigue.applyAndGetMultiplier('economy-fatigue',t+fatigue.SIX_HOURS_MS+1),1);
  buffActive=false;assert.equal(await fatigue.applyAndGetMultiplier('economy-fatigue',t+fatigue.SIX_HOURS_MS+2),.2);
  assert.equal(await fatigue.applyAndGetMultiplier('economy-fatigue',t+fatigue.SIX_HOURS_MS+2+fatigue.RESET_GAP_MS),1);
 } finally { mongo.getMongoDb=oldMongo;stream.isShortTermBuffActive=oldBuff; }

 let previous=0;for(let level=1;level<MAX_LEVEL;level++){const need=expToNextLevel(level);assert.ok(Number.isInteger(need)&&need>=previous&&need>0);previous=need;}
 assert.equal(expToNextLevel(MAX_LEVEL),0);assert.equal(expToNextLevel(NaN),expToNextLevel(1));
 assert.deepEqual(getParticipationGemTiers('metal_mine',{isBoss:false}),['A']);
 assert.equal(getDynamicGoldPoolFloor('normal',1),1);assert.equal(getDynamicGoldPoolFloor('elite',1),6000);
 for(const[tier,zone]of Object.entries({D:'normal',C:'mid',B:'ancient_city',A:'ancient_city_deep'})){
  let gold=0,gems=0;for(let n=0;n<3;n++){const cost=getEnhanceCost(tier,n);gold+=cost.goldRequired/(cost.successRate/100);gems+=cost.gemsRequired/(cost.successRate/100);}assert.ok(gold*10/R[zone].goldPerHour>=.8&&gold*10/R[zone].goldPerHour<=1.5,`${tier} core gold hours`);assert.ok(Math.abs(gems-19.3109243697479)<1e-8);
 }
 let progress={playerId:'economy-test',level:50,exp:0,attributes:{str:1,agi:1,vit:1,int:1,dex:1,luk:1},updatedAt:'before'},balance=0,state={},failClear=false;
 const currencyReceipts=new Set();const rewardService={async grantCurrency(e){if(e.sourceRef&&currencyReceipts.has(e.sourceRef))return{duplicate:true};balance+=e.amount;if(e.sourceRef)currencyReceipts.add(e.sourceRef);}};
 const playerService={async ensurePlayer(){return{player:{},progress:structuredClone(progress)}}};
 const repository={async saveIfUnchanged(next,old){if(progress.updatedAt!==old)return false;progress=structuredClone(next);return true;},async findByPlayerId(){return structuredClone(progress)}};
 const progressService=new ProgressService(playerService,repository,rewardService);
 const overflow=await progressService.grantExp({discordId:'economy-test',displayName:'test',amount:10000,source:'monster:kill',operationId:'cap-one'});assert.equal(overflow.overflowGold,10000/MAX_LEVEL_EXP_TO_GOLD_DIVISOR);assert.equal(progress.exp,0);
 const again=await progressService.grantExp({discordId:'economy-test',displayName:'test',amount:10000,source:'monster:kill',operationId:'cap-one'});assert.equal(again.duplicate,true);assert.equal(balance,50);
 const idle=new IdleService({playerService,progressRepository:repository,progressService,rewardService,idleRepository:{async findPlayerState(){return structuredClone(state)},async savePlayerState(id,next){if(failClear&&next.discordSession===null){failClear=false;throw Error('simulated after EXP before clearing idle')}state=structuredClone(next);}},monsterService:{async listMonsters(){return[{zone:'metal_mine',goldReward:1,expReward:1},{zone:'metal_mine',isBoss:true,goldReward:1e9,expReward:1e9},{zone:'normal',goldReward:1e9,expReward:1e9}]}}});
 idle._resolveMembership=async()=>({isMember:false,tier:null});
 const rate=await idle._getMonsterZoneAverageReward('metal_mine',45);assert.equal(rate.monsterCount,1);assert.equal(rate.avgGold*12,R.metal_mine.goldPerHour*IDLE_REWARD_RATIO);assert.equal(rate.avgExp*12,R.metal_mine.expPerHour*IDLE_REWARD_RATIO);
 const old=await idle._getMonsterZoneAverageReward('metal_mine',50);assert.ok(Math.abs(old.avgExp-rate.avgExp*.95)<1e-8,'idle cross-zone level penalty');
 const session={sessionId:'retry-idle',zoneKey:'metal_mine',startedAt:new Date(Date.now()-3600000).toISOString(),avgGoldPerTick:rate.avgGold,avgExpPerTick:rate.avgExp};state={discordSession:session};
 assert.equal(idle._computeDiscordSessionSummary({...session,startedAt:new Date(0)},new Date(4*60000)).totalGold,0);
 assert.equal(idle._computeDiscordSessionSummary({...session,startedAt:new Date(0)},new Date(5*60000)).totalGold,Math.round(rate.avgGold));
 assert.equal(idle._computeDiscordSessionSummary({...session,startedAt:new Date(0)},new Date(24*3600000)).effectiveMinutes,720);
 const capped=idle._applyDailyLimitToSummary({effectiveMinutes:720,totalGold:360000,totalExp:120000},{isMember:false,nonMemberClaimedMinutes:300});assert.equal(capped.effectiveMinutes,60);assert.equal(capped.totalGold,30000);
 const member=idle._applyDailyLimitToSummary({effectiveMinutes:720,totalGold:360000,totalExp:120000},{isMember:true});assert.equal(member.totalGold,360000);
 failClear=true;await assert.rejects(idle.claimDiscordSession('economy-test','test'),/simulated after EXP/);const afterFailure=balance;await idle.claimDiscordSession('economy-test','test');assert.equal(balance,afterFailure,'retry must not mint gold or EXP twice');assert.equal(state.discordSession,null);assert.equal(state.dailyClaim.nonMemberClaimedMinutes,60);
 const legacy=idle._computeDiscordSessionSummary({startedAt:new Date(0),avgGoldPerTick:10,avgExpPerTick:20},new Date(3600000));assert.deepEqual([legacy.totalGold,legacy.totalExp],[120,240],'already-started sessions keep stored rates');
 console.log('PASS: monotonic level curve, core affordability, metal A stones, cap conversion, true 10% hourly idle, level penalty, 5m/12h/6h limits, old rates, fatigue 6h/30m/BUFF and failed-clear retry');
}
main().catch(e=>{console.error(e.stack);process.exitCode=1});
