#!/usr/bin/env node
require('dotenv').config();
const { createServiceContext } = require('../src/services/createServiceContext');

function pickWeightedFromPool(pool, weightFn) {
  const total = pool.reduce((s, p) => s + (Number(weightFn(p)) || 0), 0);
  if (total <= 0) return null;
  let r = Math.random() * total;
  for (const p of pool) {
    r -= (Number(weightFn(p)) || 0);
    if (r <= 0) return p;
  }
  return pool[pool.length - 1] || null;
}

function pickWeightedMonster(pool, excludeId = null) {
  const candidates = pool.filter(m => m.id !== excludeId || pool.length === 1);
  if (!candidates.length) return null;
  return pickWeightedFromPool(candidates, (m) => m.spawnRate || 10);
}

async function main() {
  // lightweight argv parsing (supports --zone, --iterations, --with-cooldown, --defeatedSeq)
  const raw = process.argv.slice(2);
  const args = {};
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const next = raw[i+1];
      if (typeof next === 'string' && !next.startsWith('--')) { args[k] = next; i++; }
      else { args[k] = true; }
    }
  }
  const zone = args.zone || 'normal';
  const iterations = Number(args.iterations || 10000);
  const withCooldown = Boolean(args['with-cooldown'] || args.c || false);
  const defeatedSeq = args.defeatedSeq ? Number(args.defeatedSeq) : null;

  const sc = createServiceContext();
  console.log(`Loading monsters/events for zone='${zone}' from DB...`);
  const allMonsters = await sc.monsterService.listMonsters({ includeDisabled: false, zone });
  const allEvents = await sc.monsterEventService.listEvents({ zone, includeDisabled: false }).catch(() => []);

  if (!Array.isArray(allMonsters) || allMonsters.length === 0) {
    console.error('No monsters found for zone:', zone);
    process.exit(1);
  }

  // determine the defeated monster (if provided by seq) otherwise pick the first
  const defeatedMonster = defeatedSeq ? allMonsters.find(m => m.seq === defeatedSeq) : allMonsters[0];
  const defeatedId = defeatedMonster ? defeatedMonster.id : null;

  console.log(`Monsters: ${allMonsters.length}, Events: ${allEvents.length}, iterations=${iterations}, withCooldown=${withCooldown}`);

  const counts = { monsters: {}, events: {} };
  let lastChosen = null;

  for (let i = 0; i < iterations; i++) {
    // build pools for this draw
    let monsterPool = allMonsters.filter(m => m.id !== defeatedId || allMonsters.length === 1);
    // build event pool from per-monster npcMappings (map-level configuration)
    const mappingPool = [];
    for (const m of allMonsters) {
      const mappings = Array.isArray(m.npcMappings) ? m.npcMappings : [];
      for (const mp of mappings) {
        if (mp.triggerMonsterSeq != null && Number(mp.triggerMonsterSeq) !== Number(defeatedMonster?.seq)) continue;
        const tpl = (allEvents || []).find(e => e.id === mp.eventId) || null;
        mappingPool.push({ id: mp.eventId, chance: Number(mp.chance) || 0, template: tpl });
      }
    }
    let eventPool = mappingPool;

    if (withCooldown && lastChosen) {
      const lastType = lastChosen.type, lastId = lastChosen.id;
      const mFiltered = monsterPool.filter(m => !(lastType === 'monster' && m.id === lastId));
      const eFiltered = eventPool.filter(e => !(lastType === 'event' && e.id === lastId));
      if (mFiltered.length || eFiltered.length) {
        monsterPool = mFiltered.length ? mFiltered : monsterPool;
        eventPool = eFiltered.length ? eFiltered : eventPool;
      }
    }

    const totalMonsterWeight = monsterPool.reduce((s, m) => s + (Number(m.spawnRate) || 10), 0);
    const totalEventWeight = eventPool.reduce((s, e) => s + (Number(e.chance) || 0), 0);
    const totalWeight = totalMonsterWeight + totalEventWeight;

    let chosenEvent = null;
    let chosenMonster = null;

    if (totalWeight <= 0) {
      chosenMonster = pickWeightedMonster(allMonsters, defeatedId);
    } else {
      let r = Math.random() * totalWeight;
      for (let k = 0; k < monsterPool.length; k++) {
        r -= (Number(monsterPool[k].spawnRate) || 10);
        if (r <= 0) { chosenMonster = monsterPool[k]; break; }
      }
      if (!chosenMonster) {
        for (let k = 0; k < eventPool.length; k++) {
          r -= (Number(eventPool[k].chance) || 0);
          if (r <= 0) { chosenEvent = eventPool[k]; break; }
        }
      }
    }

    if (chosenEvent) {
      counts.events[chosenEvent.id] = (counts.events[chosenEvent.id] || 0) + 1;
      lastChosen = { type: 'event', id: chosenEvent.id };
      // pending monster selection (not counted as primary spawn)
      const pending = pickWeightedMonster(allMonsters, defeatedId);
      if (pending) counts.monsters[pending.id] = counts.monsters[pending.id] || 0;
    } else if (chosenMonster) {
      counts.monsters[chosenMonster.id] = (counts.monsters[chosenMonster.id] || 0) + 1;
      lastChosen = { type: 'monster', id: chosenMonster.id };
    } else {
      const fb = pickWeightedMonster(allMonsters, defeatedId);
      if (fb) { counts.monsters[fb.id] = (counts.monsters[fb.id] || 0) + 1; lastChosen = { type: 'monster', id: fb.id }; }
    }
  }

  // print results
  const mTotal = Object.values(counts.monsters).reduce((s, v) => s + v, 0);
  const eTotal = Object.values(counts.events).reduce((s, v) => s + v, 0);
  console.log('\n=== Simulation Result ===');
  console.log(`Zone: ${zone}  iterations: ${iterations}  withCooldown: ${withCooldown}`);
  console.log(`Monsters chosen: ${mTotal}  Events chosen: ${eTotal}`);
  console.log('\n-- Monsters --');
  for (const m of allMonsters) {
    const c = counts.monsters[m.id] || 0;
    console.log(`${m.name.padEnd(20)} ${c.toString().padStart(6)}  ${(c / iterations * 100).toFixed(2)}%`);
  }
  console.log('\n-- Events --');
  // rebuild mappingPool across allMonsters for reporting
  const mappingPoolFinal = [];
  for (const m of allMonsters) {
    const mappings = Array.isArray(m.npcMappings) ? m.npcMappings : [];
    for (const mp of mappings) {
      const tpl = (allEvents || []).find(e => e.id === mp.eventId) || null;
      mappingPoolFinal.push({ id: mp.eventId, chance: Number(mp.chance) || 0, template: tpl });
    }
  }
  const uniqueMappings = Array.from(new Map((mappingPoolFinal || []).map(m => [m.id, m])).values());
  if (uniqueMappings.length) {
    for (const e of uniqueMappings) {
      const name = (e.template && e.template.name) ? e.template.name : e.id;
      const c = counts.events[e.id] || 0;
      console.log(`${name.toString().padEnd(30)} ${c.toString().padStart(6)}  ${(c / iterations * 100).toFixed(2)}%`);
    }
  } else {
    for (const e of allEvents) {
      const c = counts.events[e.id] || 0;
      console.log(`${(e.name || e.id).toString().padEnd(30)} ${c.toString().padStart(6)}  ${(c / iterations * 100).toFixed(2)}%`);
    }
  }
  process.exit(0);
}

main().catch(err => { console.error('error:', err); process.exit(1); });
