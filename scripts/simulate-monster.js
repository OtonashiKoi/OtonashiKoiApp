require('dotenv').config();
const { MongoClient } = require('mongodb');
const fs = require('fs/promises');
const path = require('path');
const config = require('../src/config');
const { calcPlayerStats } = require('../src/shared/combatStats');
const { calcStats } = require('../src/services/monster/monsterService');

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URL || null;
const DB_NAME = process.env.MONGODB_DB_NAME || process.env.MONGO_DB_NAME || 'equipment_game';

async function loadMonstersFromJSON(){
  const p = path.resolve(config.storage.jsonDataPath);
  const raw = await fs.readFile(p, 'utf8');
  const data = JSON.parse(raw);
  return Array.isArray(data.monsters) ? data.monsters : [];
}

async function loadItemsFromJSON(){
  const p = path.resolve(config.storage.jsonDataPath);
  const raw = await fs.readFile(p, 'utf8');
  const data = JSON.parse(raw);
  return Array.isArray(data.items) ? data.items : [];
}

async function findMonster(name){
  if (MONGO_URI){
    try{
      const client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
      await client.connect();
      const m = await client.db(DB_NAME).collection('monsters').findOne({ name });
      await client.close();
      if (m) return m;
    }catch(e){ /* ignore and fallback */ }
  }
  const mons = await loadMonstersFromJSON();
  return mons.find(m => m.name === name || (m.name||'').includes(name));
}

async function findWoodenSword(){
  if (MONGO_URI){
    try{
      const client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
      await client.connect();
      const it = await client.db(DB_NAME).collection('items').findOne({ name: '木劍' }) || await client.db(DB_NAME).collection('items').findOne({ name: /木劍/ });
      await client.close();
      if (it) return it;
    }catch(e){ /* fallback */ }
  }
  const items = await loadItemsFromJSON();
  return items.find(i => i.name === '木劍' || /木劍/.test(i.name));
}

function rand(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
const rollDmg = (base) => Math.max(1, Math.round(base * (0.8 + Math.random() * 0.4)));

async function simulate(monsterName){
  const monster = await findMonster(monsterName);
  if (!monster) { console.error('找不到怪物:', monsterName); process.exit(1); }
  const mCalc = calcStats(monster);

  const sword = await findWoodenSword();
  const equippedWeapon = sword ? Object.assign({}, sword) : null;

  const baseAttrs = { str:1, agi:1, vit:1, int:1, dex:1, luk:1 };
  const players = [
    { name: '新人A', attrs: baseAttrs },
    { name: '新人B', attrs: baseAttrs },
    { name: '新人C', attrs: baseAttrs }
  ];

  const statePlayers = players.map(p => {
    const stats = calcPlayerStats(p.attrs, { weapon: equippedWeapon });
    return { name: p.name, attrs: p.attrs, stats, hp: stats.maxHp, totalDamage: 0, alive: true };
  });

  let monsterHp = mCalc.maxHp;
  const monsterStats = { atk: mCalc.atk, def: mCalc.def, mdef: mCalc.mdef || 0, dodge: mCalc.dodge, hit: mCalc.hit };

  console.log('Simulating vs monster:', monster.name);
  console.log('Monster calc:', mCalc);
  console.log('Players:'); statePlayers.forEach(p => console.log(` - ${p.name}:`, p.stats));

  const MAX_ROUNDS = 40;
  const logs = [];
  for (let round=1; round<=MAX_ROUNDS; round++){
    logs.push(`=== Round ${round} ===`);
    for (const p of statePlayers.filter(x=>x.alive)){
      const atkCount = p.stats.attackCount || 1;
      for (let a=0;a<atkCount;a++){
        const hitChance = p.stats.hit - mCalc.dodge;
        if (p.stats.absoluteHit || Math.random()*100 < hitChance){
          let dmg = rollDmg(Math.max(1, p.stats.atk - monsterStats.def));
          const isCrit = Math.random()*100 < p.stats.crit;
          if (isCrit) dmg = Math.round(dmg*1.5);
          monsterHp -= dmg; p.totalDamage += dmg;
          logs.push(`${p.name} hits for ${dmg}${isCrit? ' (crit)':''} (monsterHP ${Math.max(0,monsterHp)})`);
          if (monsterHp<=0) break;
          if (Math.random()*100 < p.stats.combo){
            const cdmg = rollDmg(Math.max(1, p.stats.atk - monsterStats.def));
            monsterHp -= cdmg; p.totalDamage += cdmg;
            logs.push(`${p.name} combo for ${cdmg} (monsterHP ${Math.max(0,monsterHp)})`);
            if (monsterHp<=0) break;
          }
        } else {
          logs.push(`${p.name} missed`);
        }
      }
      if (monsterHp<=0) break;
    }
    if (monsterHp<=0){ logs.push('Monster defeated!'); break; }

    const alive = statePlayers.filter(x=>x.alive);
    if (alive.length===0){ logs.push('All players dead'); break; }
    const target = rand(alive);
    const monsterAttackCount = mCalc.monsterAttackCount || 1;
    for (let ma=0; ma<monsterAttackCount; ma++){
      const mhc = monsterStats.hit - target.stats.dodge;
      if (Math.random()*100 < mhc){
        const dmg = rollDmg(Math.max(1, monsterStats.atk - target.stats.def));
        target.hp -= dmg; logs.push(`Monster hits ${target.name} for ${dmg} (hp ${Math.max(0,target.hp)})`);
        if (target.hp<=0){ target.alive=false; logs.push(`${target.name} died`); break; }
      } else {
        logs.push(`Monster missed ${target.name}`);
      }
    }

    const allDead = statePlayers.every(x=>!x.alive);
    if (allDead){ logs.push('All players dead'); break; }
  }

  console.log(logs.join('\n'));
  console.log('\nSummary:');
  statePlayers.forEach(p=> console.log(`${p.name}: alive=${p.alive} hp=${Math.max(0,p.hp)} totalDamage=${p.totalDamage}`));
  console.log(`Monster remaining HP: ${Math.max(0,monsterHp)}`);
}

const monsterName = process.argv[2] || '小史';
simulate(monsterName).catch(e=>{ console.error(e); process.exit(1); });
