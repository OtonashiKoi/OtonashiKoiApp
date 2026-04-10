require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createRepositories } = require('../src/repositories/createRepositories');
const { MonsterService } = require('../src/services/monster/monsterService');

(async function(){
  try {
    const repos = createRepositories();
    const svc = new MonsterService(repos.monsterRepository, repos.itemRepository);
    const mons = await svc.listMonsters({ includeDisabled: true });
    const out = mons.map(m => ({ id: m.id||m._id, name: m.name, seq: m.seq, zone: m.zone, level: m.level, str: m.str, agi: m.agi, vit: m.vit, int: m.int, dex: m.dex, luk: m.luk, maxHp: m.maxHp||null, def: m.def||null, mdef: m.mdef||null, expReward: m.expReward||0, goldReward: m.goldReward||0, updatedAt: m.updatedAt||null }));
    const dest = path.resolve(__dirname, '../data/monsters-cloud.json');
    fs.writeFileSync(dest, JSON.stringify({ pulledAt: new Date().toISOString(), count: out.length, monsters: out }, null, 2), 'utf8');
    console.log(`Wrote ${out.length} monsters to ${dest}`);
  } catch (e) {
    console.error('Failed to pull monsters:', e && e.message);
    process.exit(1);
  }
})();
