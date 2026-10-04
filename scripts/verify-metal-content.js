"use strict";
const fs=require('node:fs'),crypto=require('node:crypto');
const {loadBson,buildPlayer}=require('./verify-normal-progression');
const {simulate,basicPlayer}=require('./verify-normal-basic-combat');
const {calcPlayerStats}=require('../src/shared/combatStats');
const {runCombatLoop}=require('../src/shared/combatLoop');
const {MonsterService}=require('../src/services/monster/monsterService');
const {buildMetalContent}=require('./lib/metal-content');
function metalPlayer(items,level,tier,job) {
  const p=basicPlayer(items,level,tier==='S'?'A':tier,tier,job),kind=job==='mage'?'m':'p';
  const type={swordsman:'sword_1h',mage:'staff_2h',archer:'bow'}[job];
  for(const [slot,old]of Object.entries(p.equipped)) {
    const armorTier=tier==='S'?'A':tier;
    const id=slot==='weapon'?`metal-${tier.toLowerCase()}-weapon-${type}`:slot==='shield'?`metal-${armorTier.toLowerCase()}-shield`:`metal-${armorTier.toLowerCase()}-${kind}-${slot}`;
    const i=items.find(x=>x.id===id);if(!i)throw Error('Missing '+id);
    p.equipped[slot]={...structuredClone(i),itemId:i.id,itemName:i.name,enhanceLevel:0};
  }
  return p;
}
function ownSample(m,items,level=40,tier='A',runs=100,seed=20260930,phase=null,metalResist=0) {
  const old=Math.random;Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  try {const out={};for(const job of ['swordsman','mage','archer']) {
    const p=metalPlayer(items,level,tier,job);
    if(metalResist)for(const slot of ['head_top','head_mid','head_low','armor','garment','shoes'])p.equipped[slot].elements={metal:metalResist};
    const s=calcPlayerStats(p.attrs,p.equipped,[],[],{zone:m.zone});
    let deaths=0,kills=0,rounds=0,damage=0;
    for(let n=0;n<runs;n++) {
      const calc={...m.calc,atk:m.calc.atk*(phase?.atkMultiplier||1)};
      const r=runCombatLoop(structuredClone(s),calc,m.name,calc.maxHp,15,{playerLevel:level,equipped:p.equipped,inventory:[],monsterEquipped:{},zone:m.zone,monsterIsBoss:m.isBoss,worldBossPhase:phase,...(metalResist?{monsterElement:m.element,monsterElementLevel:m.elementLevel}:{})});
      deaths+=r.outcome==='lose';kills+=r.finalMonsterHp<=0;rounds+=Math.min(15,r.nextRound-(r.outcome==='ongoing'?1:0));damage+=calc.maxHp-r.finalMonsterHp;
    }
    out[job]={deathPct:100*deaths/runs,killPct:100*kills/runs,rounds:rounds/runs,damage:damage/runs};
  }return out;}finally{Math.random=old;}
}
async function main(){const arg=k=>process.argv.find(a=>a.startsWith(k+'='))?.slice(k.length+1);
 const snap=arg('--snapshot'),out=arg('--output');if(!snap||!out)throw Error('snapshot/output required');
 let items=loadBson(snap+'/items.bson'),monsters=loadBson(snap+'/monsters.bson');
 const calibrate=process.argv.includes('--calibrate'),candidate=arg('--candidate');
 let content=calibrate?buildMetalContent(items,monsters):candidate?JSON.parse(fs.readFileSync(candidate)):null;
 if(content){items=items.filter(i=>!content.gear.some(x=>x.id===i.id)).concat(content.gear);monsters=monsters.filter(m=>!content.mobs.some(x=>x.id===m.id)).concat(content.mobs);}
 const calc=async m=>(await new MonsterService({findAll:async()=>[m]}).listMonsters())[0];
 if(calibrate){for(const m of content.mobs.filter(m=>!m.isBoss)) {
   let lo=100,hi=5000;
   for(let n=0;n<10;n++){const hp=Math.floor((lo+hi)/2),x=await calc({...m,maxHp:hp});
     const results=[...Object.values(ownSample(x,items,40,'A',30)),...Object.values(simulate(x,items,40,'A','A',30).byJob)];
     if(results.every(r=>r.deathPct<=8&&r.killPct>=90&&r.rounds<=10))lo=hp+1;else hi=hp-1;
   }m.maxHp=Math.max(100,Math.round(hi*0.9));m.expReward=Math.round(6000*m.maxHp/2200);
   console.log(JSON.stringify({name:m.name,hp:m.maxHp,atk:m.str*3}));
 }fs.writeFileSync(out,JSON.stringify(content,null,2));return;}
 const rows=[],failures=[];const check=(ok,msg)=>{if(!ok)failures.push(msg);};const seed=937451,runs=200;
 const newMobs=monsters.filter(m=>m.zone==='metal_mine'&&!m.isBoss);
 check(newMobs.length===6,'Six ordinary monsters required');
 for(const m0 of newMobs){const m=await calc(m0);const canonical=simulate(m,items,40,'A','A',runs,seed),own=ownSample(m,items,40,'A',runs,seed);
   const row={name:m.name,canonical,own,armorLow:simulate(m,items,40,'B','A',runs,seed),weaponLow:simulate(m,items,40,'A','B',runs,seed),insufficient:simulate(m,items,40,'C','C',runs,seed),midpoint:simulate(m,items,44,'A','A',runs,seed)};
   for(const [job,r]of Object.entries({...Object.fromEntries(Object.entries(canonical.byJob).map(([k,v])=>['canonical/'+k,v])),...own})){check(r.deathPct<=20,m.name+'/'+job+' death >20');check(r.killPct>=80,m.name+'/'+job+' kill <80');check(r.rounds<=12,m.name+'/'+job+' rounds >12');}
   rows.push(row);
 }
 const mean=(key,stat)=>rows.reduce((n,r)=>n+r[key][stat],0)/rows.length;
 check(mean('canonical','deathPct')<=10,'Area full gear death >10%');
 check(mean('insufficient','deathPct')>=50,'Insufficient gear death <50%');
 check(mean('armorLow','deathPct')>mean('canonical','deathPct')+10,'Armor improvement <=10pp');
 check(mean('weaponLow','rounds')>mean('canonical','rounds')*1.1,'Weapon improvement <=10%');
 const gear=items.filter(i=>i.contentRevision==='metal-content-20260930-v1');
 for(const tier of ['A','S'])check(gear.filter(i=>i.tier===tier).length===30,tier+' requires 30 gear');
 for(const i of gear)check(monsters.some(m=>m.drops?.some(d=>d.itemId===i.id)),'No source '+i.id);
 const boss=await calc(monsters.find(m=>m.id==='metal-steel-crown'));
 const release={phase:2,atkMultiplier:1.15,agiBonus:0,lightningEnabled:false};
 const bossRows={A:ownSample(boss,items,50,'A',runs,seed),S:ownSample(boss,items,50,'S',runs,seed),releasedA:ownSample(boss,items,50,'A',runs,seed,release),releasedAWithSixMetalStones:ownSample(boss,items,50,'A',runs,seed,release,1),releasedSWithSixMetalStones:ownSample(boss,items,50,'S',runs,seed,release,1)};
 for(const [job,r]of Object.entries(bossRows.A)){check(r.damage>0,'Boss cannot be damaged '+job);check(r.deathPct<=30,'A boss baseline death >30% '+job);}
 for(const [job,r]of Object.entries(bossRows.releasedSWithSixMetalStones))check(r.deathPct<=20,'S + metal resist released boss death >20% '+job);
 const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
 const report={sScenario:'S main-hand weapon + A armor; S non-weapons closed',passed:!failures.length,failures,sourceMode:content?'snapshot + candidate':'live snapshot',seed,runsPerJob:runs,battles:rows.length*6*3*runs+5*3*runs,rows,bossRows,summary:{fullDeath:mean('canonical','deathPct'),armorLowDeath:mean('armorLow','deathPct'),insufficientDeath:mean('insufficient','deathPct'),fullRounds:mean('canonical','rounds'),weaponLowRounds:mean('weaponLow','rounds')},snapshotHashes:{monsters:hash(snap+'/monsters.bson'),items:hash(snap+'/items.bson')},coreHashes:Object.fromEntries(['src/shared/combatStats.js','src/shared/combatLoop.js','src/shared/equipmentSetBonuses.js','scripts/lib/metal-content.js','scripts/verify-metal-content.js'].map(f=>[f,hash(require('path').join(__dirname,'..',f))]))};
 fs.writeFileSync(out,JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,failures,summary:report.summary,bossRows}));if(failures.length)process.exitCode=1;
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1});
module.exports={metalPlayer,ownSample};
