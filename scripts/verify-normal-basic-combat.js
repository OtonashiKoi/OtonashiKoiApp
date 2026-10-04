"use strict";
const { calcPlayerStats } = require('../src/shared/combatStats');
const { runCombatLoop } = require('../src/shared/combatLoop');
const { MonsterService } = require('../src/services/monster/monsterService');
const { buildPlayer, loadBson } = require('./verify-normal-progression');
const { SETTINGS } = require('./lib/gear-ladder');

function basicPlayer(items, level, armorTier, weaponTier = armorTier, job = 'swordsman') {
  const p = buildPlayer(items, level, armorTier, job);
  const w = buildPlayer(items, level, weaponTier, job);
  delete p.equipped.job_eq;
  if (w.equipped.weapon) p.equipped.weapon = w.equipped.weapon;
  else delete p.equipped.weapon;
  for (const it of Object.values(p.equipped)) {
    for (const k of ['passiveEffects','procEffects','combatEffects','useEffects']) it[k] = [];
    delete it.monsterCardSkill;
  }
  return p;
}
function simulate(m, items, level, armorTier, weaponTier, runs = 80, seedValue = 20260930) {
  let seed = seedValue;
  const random = Math.random;
  Math.random = () => { seed = (Math.imul(seed,1664525)+1013904223)>>>0; return seed/4294967296; };
  try {
    let deaths=0, kills=0, rounds=0, hp=0;
    const byJob={};
    for (const job of ['swordsman','mage','archer']) {
      const p=basicPlayer(items,level,armorTier,weaponTier,job);
      let jobDeaths=0,jobKills=0,jobRounds=0;
      const stats=calcPlayerStats(p.attrs,p.equipped,[],[],{zone:m.zone});
      for (let i=0;i<runs;i++) {
        const r=runCombatLoop(structuredClone(stats),{...m.calc},m.name,m.calc.maxHp,15,{
          playerLevel:level, equipped:p.equipped, inventory:[], monsterEquipped:{},
          zone:m.zone, monsterIsBoss:false,
          // No cards, badge skills, auras, bestiary, elemental gems or party control.
        });
        deaths+=r.outcome==='lose'; kills+=r.finalMonsterHp<=0;
        jobDeaths+=r.outcome==='lose';jobKills+=r.finalMonsterHp<=0;
        jobRounds+=Math.min(15,r.outcome==='win'||r.outcome==='lose'?r.nextRound:r.nextRound-1);
        rounds+=Math.min(15,r.outcome === "win" || r.outcome === "lose" ? r.nextRound : r.nextRound-1); hp+=r.finalPlayerHp/stats.maxHp;
      }
      byJob[job]={deathPct:100*jobDeaths/runs,killPct:100*jobKills/runs,rounds:jobRounds/runs};
    }
    const n=runs*3;
    return {deathPct:100*deaths/n,killPct:100*kills/n,rounds:rounds/n,hpPct:100*hp/n,byJob};
  } finally {Math.random=random;}
}
async function verify(monsters,items,runs=80) {
  const all=await new MonsterService({findAll:async()=>monsters}).listMonsters();
  const rows=[];
  for (const [zone,t] of Object.entries(SETTINGS)) {
    const tiers=t.tiers, level=t.level;
    for(const m of all.filter(m=>m.zone===zone&&!m.isBoss&&!m.allZones&&!m.incomingDamageCap)) {
      const cases={full:[tiers[2],tiers[2]],armorLow:[tiers[1],tiers[2]],weaponLow:[tiers[2],tiers[1]],insufficient:[tiers[0],tiers[0]]};
      const row={id:m.id,name:m.name,zone,level,monsterLevel:m.level,atk:m.calc.atk,hp:m.calc.maxHp,def:m.calc.def};
      for(const [key,[a,w]] of Object.entries(cases))row[key]=simulate(m,items,level,a,w,runs);
      rows.push(row);
    }
  }
  return rows;
}
async function main(){const fs=require('fs');const snap=process.argv.find(a=>a.startsWith('--snapshot='))?.slice(11);if(!snap)throw Error('snapshot required');const rows=await verify(loadBson(snap+'/monsters.bson'),loadBson(snap+'/items.bson'),Number(process.argv.find(a=>a.startsWith('--runs='))?.slice(7)||80));const out=process.argv.find(a=>a.startsWith('--output='))?.slice(9);if(out)fs.writeFileSync(out,JSON.stringify(rows,null,2));for(const zone of Object.keys(SETTINGS)){const rs=rows.filter(r=>r.zone===zone);console.log(JSON.stringify({zone,...Object.fromEntries(['full','armorLow','weaponLow','insufficient'].map(k=>[k,Object.fromEntries(['deathPct','killPct','rounds'].map(s=>[s,+(rs.reduce((n,r)=>n+r[k][s],0)/rs.length).toFixed(1)]))]))}));}}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1});
module.exports={basicPlayer,simulate,verify};
