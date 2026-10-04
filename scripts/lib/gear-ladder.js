"use strict";
const REVISION='gear-ladder-20260929-v1';
const SETTINGS={
 metal_mine:{level:40,tiers:['C','B','A'],str:105,hp:2400,exp:6000},
 beginner:{level:1,tiers:['none','none','D'],str:1,hp:25,exp:80},
 normal:{level:5,tiers:['none','D','D'],str:30,hp:180,exp:100},
 mid:{level:10,tiers:['none','D','C'],str:30,hp:800,exp:450},
 ancient_city:{level:20,tiers:['D','C','B'],str:44,hp:2000,exp:1500},
 mistwood:{level:30,tiers:['D','C','B'],str:54,hp:3000,exp:3000},
 ancient_city_deep:{level:40,tiers:['C','B','A'],str:100,hp:3200,exp:6000},
 dragon_realm:{level:40,tiers:['C','B','A'],str:54,hp:4500,exp:8000},
 hellfire:{level:40,tiers:['C','B','A'],str:60,hp:4500,exp:8000},
};
const EXP_CORRECTION={mid:1.6,ancient_city:1.7,mistwood:1.9,ancient_city_deep:1.7,dragon_realm:1.7,hellfire:1.7};
const TIER={metal_mine:'A',beginner:'D',normal:'D',mid:'C',ancient_city:'B',mistwood:'B',ancient_city_deep:'A',dragon_realm:'A',hellfire:'A'};
const ORDER=['D','C','B','A','S','SS','SSR','UR'];
function isGear(item){return item?.itemType==='equipment'&&!item.monsterCardOf&&!item.monsterCardSkill&&!['special','job_eq'].includes(item.equipSlot);}
function buildLadderPlan(monsters,items){
 const byId=new Map(items.map(i=>[i.id,i]));const plan=[];
 for(const [zone,t] of Object.entries(SETTINGS)){
  const mobs=monsters.filter(m=>m.zone===zone&&m.enabled&&!m.allZones&&!m.incomingDamageCap&&!String(m.name).includes('稀'));
  const normal=mobs.filter(m=>!m.isBoss);if(!normal.length)continue;
  const mean=k=>normal.reduce((s,m)=>s+Number(m[k]||0),0)/normal.length;
  for(const m of mobs){
   if(m.gearLadderRevision===REVISION)continue;
   const index=normal.indexOf(m),boss=m.isBoss;
   const values={str:Math.max(1,Math.round(t.str*(boss?1.15:0.9+0.2*index/Math.max(1,normal.length-1)))),
    maxHp:Math.max(1,Math.round(m.maxHp/mean('maxHp')*t.hp)),agi:Math.min(12,m.agi||1),
    expReward:Math.max(1,Math.round(Math.round(m.expReward/mean('expReward')*t.exp)*(EXP_CORRECTION[zone]||1))),
    level:zone==='ancient_city_deep'?(boss?50:(m.level<40?m.level+10:m.level)):m.level,
    drops:(m.drops||[]).filter(d=>{const i=byId.get(d.itemId);return !isGear(i)||ORDER.indexOf(i.tier)<=ORDER.indexOf(TIER[zone]);}),
    gearLadderRevision:REVISION};
   if(zone==='beginner'){values.def=0;values.flatDef=0;}
   plan.push({id:m.id,zone,values});
  }
 }
 return plan;
}
module.exports={REVISION,SETTINGS,TIER,buildLadderPlan,isGear};
