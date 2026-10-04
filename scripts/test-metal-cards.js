"use strict";
const assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const {createMetalCards,KEY,skillForMetalMonster,applyMetalPartyRecovery}=require('../src/shared/metalCards');
const {runCombatLoop}=require('../src/shared/combatLoop');const {withSeed}=require('./lib/seededRandom');
const {calcPlayerStats}=require('../src/shared/combatStats');
function unit(name){let hp=500;const c=createMetalCards({special_1:{monsterCardSkill:{key:KEY[name]}}},1000);c.setContext({playerHp:()=>hp,enemyHp:()=>1000,silenced:()=>false,heal:n=>{hp+=n;return n;},bladeDamage:()=>70,bladeLog:()=>{}});return {c,hp:n=>{hp=n;}};}
let u=unit('rat');u.c.onHit(1,false,true);u.c.aim();assert.equal(u.c.mainDamage(100),120);u.c.onHit(100,false,false);u.c.aim();assert.equal(u.c.mainDamage(100),100);u.c.onHit(1,false,true);u.c.aim();u.c.onMiss();u.c.aim();assert.equal(u.c.mainDamage(100),100);
u=unit('artillery');assert.equal(u.c.beforePhysical(100,1,false),100);assert.equal(u.c.beforePhysical(100,1,true),80);
u=unit('pangolin');assert.deepEqual([1,2,3,4].map(r=>u.c.beforePhysical(100,r)),[85,90,95,100]);
u=unit('scout');u.c.onMiss();assert.equal(u.c.aim().bonus,10);assert.equal(u.c.aim().bonus,0);
u=unit('repair');u.c.checkHealth();assert.equal(u.c.metrics.repairHeal,0);u.hp(499);u.c.checkHealth();u.c.checkHealth();assert.equal(u.c.metrics.repairHeal,80);
u=unit('heavy');assert.equal(u.c.mainDamage(100,true),100);assert.equal(u.c.mainDamage(100,false),108);
u=unit('supervisor');u.c.onMiss();assert.equal(u.c.aim().forced,false);u.c.onMiss();assert.equal(u.c.aim().forced,true);u.c.onHit(0,false);assert.equal(u.c.aim().forced,false);
u=unit('crown');for(let i=0;i<30;i++)u.c.onHit(10,false);assert.equal(u.c.metrics.bladesFired,4);assert.equal(u.c.metrics.bladeDamage,280);
for(const key of Object.keys(KEY)){u=unit(key);u.hp(0);u.c.checkHealth();assert.equal(u.c.mainDamage(100),100);assert.equal(u.c.beforePhysical(200,1,true),200);assert.deepEqual(u.c.aim(),{bonus:0,forced:false});}
const member={currentHp:100,maxHp:1000,equipped:{special_1:{monsterCardSkill:skillForMetalMonster(5)}}};assert.equal(applyMetalPartyRecovery(member,'run:1'),50);assert.equal(applyMetalPartyRecovery(member,'run:1'),0);assert.equal(applyMetalPartyRecovery(member,'run:2'),50);member.currentHp=0;assert.equal(applyMetalPartyRecovery(member,'run:3'),0);member.currentHp=990;assert.equal(applyMetalPartyRecovery(member,'run:4'),10);
const stats=calcPlayerStats({str:35,agi:8,vit:45,int:5,dex:25,luk:5},{},[],[],{});
const monster={maxHp:100000,atk:100,def:10,flatDef:0,level:40,agi:8,int:1,dex:30,luk:1,dodge:65,hit:100,critRate:0,comboChance:100,dmgMin:1,dmgMax:1,blockChance:50};
const fields=['sharpenBonus','floatPrevented','platePrevented','guidedAttacks','repairHeal','steadyBonus','lockedAttacks','bladeDamage'],rows=[];
for(let seq=1;seq<=8;seq++){const sum={};for(let i=0;i<500;i++){
 const r=withSeed(`metal-v2:${seq}:${i}`,()=>runCombatLoop({...stats},monster,'驗證怪',monster.maxHp,15,{playerLevel:40,equipped:{special_1:{monsterCardSkill:skillForMetalMonster(seq)}}}));assert.ok(r.finalPlayerHp>=0&&r.finalMonsterHp>=0);assert.ok(r.metalCardMetrics.bladesFired<=4);for(const[k,v]of Object.entries(r.metalCardMetrics))sum[k]=(sum[k]||0)+v;
}assert.ok(sum[fields[seq-1]]>0,`Card ${seq} must affect real combat`);rows.push({card:skillForMetalMonster(seq).name,battles:500,metrics:sum});}
for(let seq=1;seq<=8;seq++){const a=withSeed('plain',()=>runCombatLoop({...stats},monster,'驗證怪',monster.maxHp,3,{playerLevel:40}));const b=withSeed('plain',()=>runCombatLoop({...stats},monster,'驗證怪',monster.maxHp,3,{playerLevel:40,monsterEquipped:{special_1:{monsterCardSkill:skillForMetalMonster(seq)}}}));assert.equal(a.totalDamage,b.totalDamage);assert.equal(a.finalPlayerHp,b.finalPlayerHp);}
const equipped={special_1:{monsterCardSkill:skillForMetalMonster(8)}};
const capped=withSeed('cap',()=>runCombatLoop({...stats},{...monster,blockChance:0,dodge:0,incomingDamageCap:1},'上限',100000,15,{playerLevel:40,equipped,forcePlayerHit:true}));assert.ok(capped.metalCardMetrics.bladeDamage<=4);assert.ok(capped.totalDamage<=19);
const immune=withSeed('immune',()=>runCombatLoop({...stats},{...monster,dodge:0},'無敵',100000,3,{playerLevel:40,equipped,forcePlayerHit:true,monsterActiveEffects:[{key:'invincible_short',params:{duration:{mode:'turns',value:4}},appliedAt:0}]}));assert.equal(immune.totalDamage,0);assert.equal(immune.metalCardMetrics.bladesFired,0);
// A resumable party action must retain the four-blade budget for the whole monster.
const session={},opts={playerLevel:40,equipped,forcePlayerHit:true,actionSession:session,startPlayerHp:stats.maxHp,startMonsterHp:100000,skipMonsterAttack:true};let r=runCombatLoop({...stats},{...monster,blockChance:0,dodge:0},'連戰狀態',100000,1,opts);for(let i=0;i<29;i++)r=runCombatLoop({...stats},{...monster,blockChance:0,dodge:0},'連戰狀態',r.finalMonsterHp,1,opts);assert.equal(r.metalCardMetrics.bladesFired,4);
const report=process.argv.find(a=>a.startsWith('--report='))?.slice(9),hash=f=>crypto.createHash('sha256').update(fs.readFileSync(require('node:path').join(__dirname,'..',f))).digest('hex');
const result={passed:true,battles:4000,rows,partyHealOncePerMonster:true,deadExcluded:true,resumableBladeBudget:true,damageCaps:true,invincibility:true,sourceHashes:Object.fromEntries(['src/shared/metalCards.js','src/shared/combatLoop.js','scripts/test-metal-cards.js'].map(f=>[f,hash(f)]))};if(report)fs.writeFileSync(report,JSON.stringify(result,null,2));console.log('PASS metal cards v2: 4000 battles, party heal, lock, four blades, caps and persistence');
