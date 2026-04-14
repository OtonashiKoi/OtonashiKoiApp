// Simple simulator for combined monster+event weighted selection
// Run: node scripts/simulate-weighted-spawns.js
const DEFAULT_MONSTERS = [
  { id: 'm1', seq: 1, name: 'Slime', spawnRate: 10 },
  { id: 'm2', seq: 2, name: 'Wolf', spawnRate: 20 },
  { id: 'm3', seq: 3, name: 'Orc', spawnRate: 30 }
];

const DEFAULT_EVENTS = [
  { id: 'e1', name: 'Ambush', chance: 5, durationSec: 10 },
  { id: 'e2', name: 'Wandering NPC', chance: 15, durationSec: 8 }
];

function pickWeightedMonster(pool, excludeId = null) {
  const candidates = pool.filter(m => m.id !== excludeId || pool.length === 1);
  if (!candidates.length) return null;
  const total = candidates.reduce((s, m) => s + (Number(m.spawnRate) || 10), 0);
  let r = Math.random() * Math.max(1, total);
  for (const m of candidates) {
    r -= (Number(m.spawnRate) || 10);
    if (r <= 0) return m;
  }
  return candidates[candidates.length - 1];
}

function simulate({ monsters = DEFAULT_MONSTERS, events = DEFAULT_EVENTS, iterations = 10000, withCooldown = false }) {
  const counts = { monsters: {}, events: {} };
  let lastChosen = null; // { type: 'monster'|'event', id }

  for (let i = 0; i < iterations; i++) {
    let monsterPool = monsters.slice();
    let eventPool = events.slice();

    if (withCooldown && lastChosen) {
      const lastType = lastChosen.type, lastId = lastChosen.id;
      const mFiltered = monsterPool.filter(m => !(lastType === 'monster' && m.id === lastId));
      const eFiltered = eventPool.filter(e => !(lastType === 'event' && e.id === lastId));
      if (mFiltered.length || eFiltered.length) {
        monsterPool = mFiltered.length ? mFiltered : monsterPool;
        eventPool = eFiltered.length ? eFiltered : eventPool;
      }
    }

    const monsterWeights = monsterPool.map(m => Number(m.spawnRate) || 10);
    const eventWeights = eventPool.map(e => Number(e.chance) || 0);
    const total = monsterWeights.reduce((s, v) => s + v, 0) + eventWeights.reduce((s, v) => s + v, 0);

    let chosenEvent = null, chosenMonster = null;
    if (total <= 0) {
      chosenMonster = pickWeightedMonster(monsters, null);
    } else {
      let r = Math.random() * total;
      for (let k = 0; k < monsterPool.length; k++) {
        r -= monsterWeights[k] || 0;
        if (r <= 0) { chosenMonster = monsterPool[k]; break; }
      }
      if (!chosenMonster) {
        for (let k = 0; k < eventPool.length; k++) {
          r -= eventWeights[k] || 0;
          if (r <= 0) { chosenEvent = eventPool[k]; break; }
        }
      }
    }

    if (chosenEvent) {
      counts.events[chosenEvent.id] = (counts.events[chosenEvent.id] || 0) + 1;
      lastChosen = { type: 'event', id: chosenEvent.id };
      // pending monster selection (not counted as primary spawn)
      const pending = pickWeightedMonster(monsters, null);
      if (pending) counts.monsters[pending.id] = (counts.monsters[pending.id] || 0) + 0; // ensure key exists
    } else if (chosenMonster) {
      counts.monsters[chosenMonster.id] = (counts.monsters[chosenMonster.id] || 0) + 1;
      lastChosen = { type: 'monster', id: chosenMonster.id };
    } else {
      const fb = pickWeightedMonster(monsters, null);
      if (fb) { counts.monsters[fb.id] = (counts.monsters[fb.id] || 0) + 1; lastChosen = { type: 'monster', id: fb.id }; }
    }
  }

  return counts;
}

function printResult(title, counts, iterations) {
  console.log(`\n=== ${title} (runs=${iterations}) ===`);
  const mTotal = Object.values(counts.monsters).reduce((s, v) => s + v, 0);
  const eTotal = Object.values(counts.events).reduce((s, v) => s + v, 0);
  console.log(`Monsters chosen: ${mTotal}  Events chosen: ${eTotal}`);
  console.log('-- Monsters --');
  for (const m of DEFAULT_MONSTERS) {
    const c = counts.monsters[m.id] || 0;
    console.log(`${m.name.padEnd(12)} ${c.toString().padStart(6)} (${((c/iterations)*100).toFixed(2)}%)`);
  }
  console.log('-- Events --');
  for (const e of DEFAULT_EVENTS) {
    const c = counts.events[e.id] || 0;
    console.log(`${e.name.padEnd(18)} ${c.toString().padStart(6)} (${((c/iterations)*100).toFixed(2)}%)`);
  }
}

const ITER = 10000;
const withoutCooldown = simulate({ iterations: ITER, withCooldown: false });
const withCooldown = simulate({ iterations: ITER, withCooldown: true });
printResult('Without Cooldown', withoutCooldown, ITER);
printResult('With Immediate-Repeat Cooldown', withCooldown, ITER);

console.log('\nDone.');
