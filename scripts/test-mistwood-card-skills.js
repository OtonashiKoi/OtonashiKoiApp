"use strict";
const assert = require('node:assert/strict');
const { createMistwoodCards, KEY, STEAL_CAPS } = require('../src/shared/mistwoodCards');
const { runCombatLoop } = require('../src/shared/combatLoop');
const { calcPlayerStats } = require('../src/shared/combatStats');
const { skillForMistwoodMonster, SKILLS, MONSTER_SKILLS } = require('./lib/mistwood-card-skills');
const { withSeed } = require('./lib/seededRandom');
const fs = require('node:fs');
function unit(names, boss = false) {
  const equipped = Object.fromEntries(names.map((n,i)=>[`special_${i+1}`,{monsterCardSkill:{key:KEY[n]}}]));
  const card = createMistwoodCards(equipped, 1000); let hp=500, enemy=10000; const log=[];
  card.setContext({ log, atk:100, boss, playerName:'測試玩家',enemyName:'測試怪',playerHp:()=>hp,enemyHp:()=>enemy,silenced:()=>false,heal:n=>{const a=Math.min(1000-hp,n);hp+=a;return a;},damage:n=>{enemy-=n;return n;} });
  return {card, log};
}
const buff = (extra={}) => ({key:'atk_up',params:{value:80,duration:{mode:'turns',value:3}},appliedAt:1,...extra});
const oldRandom=Math.random;
try {
 Math.random=()=>0;
 let c=unit(['wisp']).card;
 for(let i=1;i<=3;i++){c.onTaken(500,i);c.onBasicHit(1,i,[],[]);}
 assert.equal(c.metrics.storedHeal,160);assert.equal(c.state.heals,2);
 c=unit(['tree']).card;
 for(let i=0;i<3;i++)c.onTaken(100,1);
 assert.equal(c.beforeDamage(100,1),65);c.onTaken(65,1);c.onTaken(100,2);c.onTaken(100,3);assert.equal(c.state.rings,0);c.onTaken(100,4);assert.equal(c.state.rings,1);
 c=unit(['panther']).card;c.onDodge(1);c.onDodge(1);c.onDodge(2);c.onDodge(3);assert.equal(c.metrics.counterDamage,120);
 c=unit(['wizard']).card;c.onCardDamage('other',60);c.onCardDamage('other',60);c.onCardDamage(KEY.wizard,60);c.onCardDamage('other',0);assert.equal(c.metrics.echoDamage,90);assert.equal(c.metrics.echoChecks,2);
 c=unit(['beast']).card;for(let i=0;i<8;i++)c.onBasicHit(1,1,[],[]);assert.equal(c.metrics.stompDamage,90);assert.equal(unit(['beast']).card.state.hits,0);
 c=unit(['guardian']).card;assert.equal(c.onDebuff({key:'stun',unremovable:true},1),false);assert.equal(c.onDebuff({key:'atk_down'},1),true);assert.equal(c.onDebuff({key:'poison'},1),false);assert.equal(c.beforeDamage(100,1),20);assert.equal(c.metrics.shieldAbsorbed,80);
 c=unit(['guardian']).card;c.onDebuff({key:'atk_down'},1);assert.equal(c.beforeDamage(100,3),100);
 for(const boss of [false,true]){c=unit(['raider'],boss).card;const me=[buff()],pe=[];c.onBasicHit(1,1,me,pe);assert.equal(c.metrics.steals,boss?0:1);if(!boss){assert.equal(me.length,0);assert.equal(pe[0].params.value,STEAL_CAPS.atk_up);assert.equal(pe[0].params.duration.value,2);me.push(buff());c.onBasicHit(1,2,me,pe);assert.equal(c.metrics.steals,1);}}
 c=unit(['raider']).card;for(const e of [buff({unremovable:true}),{key:'atk_up',params:{value:80,duration:{mode:'permanent'}}}]){c.onBasicHit(1,1,[e],[]);assert.equal(c.metrics.steals,0);}
} finally { Math.random=oldRandom; }
assert.equal(SKILLS.length,8);assert.equal(new Set(SKILLS.slice(1).map(s=>s.key)).size,7);
for(let i=1;i<=7;i++){assert.equal(SKILLS[i].trigger,'battle_event');assert.deepEqual(SKILLS[i].monsterSkill,MONSTER_SKILLS[i]);}

const stats=calcPlayerStats({str:35,agi:8,vit:45,int:5,dex:25,luk:5},{},[],[],{});
const monster={maxHp:10000,atk:70,def:10,flatDef:0,level:35,agi:30,int:1,dex:30,luk:1,dodge:0,hit:70,critRate:0,comboChance:0,dmgMin:1,dmgMax:1};
function run(seq,seed,boss=false){const eq={special_1:{itemId:'card'+seq,monsterCardSkill:skillForMistwoodMonster(seq)}};
 if(seq===4)eq.special_2={itemId:'damage-card',monsterCardSkill:{key:'test_chain',name:'測試連擊',chance:100,procEffects:[{key:'proc_chain_hit',target:'enemy',params:{chainCount:3,damageMultiplier:0.3}}]}};
 const enemy={special_1:{itemId:'monster',monsterCardSkill:{key:'test_buff',name:'敵方強化',chance:100,procEffects:[{key:seq===7?'atk_down':'atk_up',target:seq===7?'enemy':'self',params:{value:50,duration:{mode:'turns',value:3}}}]}}};
 return withSeed(seed,()=>runCombatLoop({...stats},monster,'測試怪',10000,15,{playerLevel:35,equipped:eq,monsterEquipped:enemy,monsterIsBoss:boss}));}
const totals=[];
for(let seq=1;seq<=7;seq++){
 const sum={};const count=process.argv.includes('--simulate')?10000:100;let deaths=0,rounds=0,damage=0;
 for(let n=0;n<count;n++){const r=run(seq,`mistwood:${seq}:${n}`);assert.ok(r.finalPlayerHp>=0&&r.finalMonsterHp>=0);for(const [k,v]of Object.entries(r.mistwoodCardMetrics))sum[k]=(sum[k]||0)+v;deaths+=r.outcome==='lose'?1:0;rounds+=r.nextRound-1;damage+=r.totalDamage;assert.ok(r.mistwoodCardState.heals<=2);}
 const field=['storedHeal','treePrevented','counterDamage','echoDamage','steals','stompDamage','cleanses'][seq-1];assert.ok(sum[field]>0,`Card ${seq} never triggered`);
 if(seq===4)assert.equal(sum.echoChecks,15*count,'three-hit card must check echo only once per cast');
 totals.push({card:SKILLS[seq].name,battles:count,deaths,averageDamage:Math.round(damage/count),averageRounds:rounds/count,metrics:sum});
 console.log(`${seq}. ${SKILLS[seq].name}: verified ${count} battles`);
}
for(const opts of [{monsterIsBoss:true},{isBoss:true},{isWorldBoss:true},{monsterIsBoss:true,isWorldBoss:true}]){
 const r=withSeed('blocked-boss',()=>{const eq={special_1:{monsterCardSkill:skillForMistwoodMonster(5)}};return runCombatLoop({...stats},monster,'BOSS',10000,15,{playerLevel:35,equipped:eq,monsterActiveEffects:[buff()],...opts});});assert.equal(r.mistwoodCardMetrics.steals,0);
}
// No skill amplification or follow-up recursion: use the real card loop and compare multi-hit check count.
const report=process.argv.find(a=>a.startsWith('--report='))?.slice(9);if(report)fs.writeFileSync(report,JSON.stringify(totals,null,2));
console.log('All seven event cards, caps, cooldowns, no recursive procs and BOSS exclusions passed');

// Monster skill fallback must not lose its original behavior when its drop card is redesigned.
for (let i=1;i<=7;i++) {
 const plain={special_1:{itemId:'monster',monsterCardSkill:MONSTER_SKILLS[i]}};
 const event={special_1:{itemId:'monster',monsterCardSkill:SKILLS[i]}};
 const battle=eq=>withSeed('monster-skill:'+i,()=>runCombatLoop({...stats},monster,'測試怪',10000,15,{playerLevel:35,monsterEquipped:eq}));
 const a=battle(plain),b=battle(event);
 assert.equal(a.totalDamage,b.totalDamage);assert.equal(a.finalPlayerHp,b.finalPlayerHp);assert.deepEqual(a.roundLogs,b.roundLogs);
}
// HP-gated unremovable mechanics remain applied and do not consume the guardian's once-per-battle rescue.
const guardianEq={special_1:{monsterCardSkill:SKILLS[7]}};
const hostile={special_1:{monsterCardSkill:{key:'test_unremovable',chance:100,procEffects:[{key:'atk_down',target:'enemy',unremovable:true,params:{value:10,ownerHpAbovePct:0,duration:{mode:'turns',value:2}}}]}}};
const protectedBattle=withSeed('unremovable',()=>runCombatLoop({...stats},monster,'測試怪',10000,3,{playerLevel:35,equipped:guardianEq,monsterEquipped:hostile}));
assert.equal(protectedBattle.mistwoodCardMetrics.cleanses,0);
console.log('Monster skills preserved; unremovable HP-gated mechanics preserved');
