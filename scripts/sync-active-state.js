require('dotenv').config();
const { createRepositories } = require('../src/repositories/createRepositories');
const { MonsterService } = require('../src/services/monster/monsterService');
const config = require('../src/config');

async function run() {
  const args = process.argv.slice(2);
  const doIt = args.includes('--yes');
  const zones = ['normal', 'mid'];
  const repos = createRepositories();
  const svc = new MonsterService(repos.monsterRepository, repos.item_repository || repos.itemRepository);

  const changes = [];
  for (const zone of zones) {
    try {
      const state = await svc.getState(zone);
      const monsters = await svc.listMonsters({ includeDisabled: true, zone });
      const active = monsters.find(m => m.seq === state.activeMonsterSeq) || null;
      if (!active) continue;
      const desired = active.calc && typeof active.calc.maxHp === 'number' ? active.calc.maxHp : null;
      const current = state.currentHp != null ? state.currentHp : desired;
      if (desired != null && current !== desired) {
        changes.push({ zone, seq: active.seq, id: active.id, name: active.name, before: current, after: desired });
        if (doIt) {
          const newState = { ...state, activeMonsterSeq: active.seq, currentHp: desired };
          await svc.saveState(newState, zone);
        }
      }
    } catch (err) {
      console.error('Error processing zone', zone, err && err.message);
    }
  }

  if (!doIt) {
    console.log(`Dry-run. Would update ${changes.length} zones`);
    console.log(changes);
    return;
  }
  console.log(`Wrote ${changes.length} changes to state`);
  console.log(changes);
}

run().catch(err => { console.error(err); process.exit(1); });
