#!/usr/bin/env node
const { createRepositories } = require('../src/repositories/createRepositories');
const { MonsterService } = require('../src/services/monster/monsterService');
(async function(){
  const repos = createRepositories();
  const svc = new MonsterService(repos.monsterRepository, repos.itemRepository);
  const mons = await svc.listMonsters({ includeDisabled: true });
  mons.sort((a,b) => (b.calc?.maxHp||0) - (a.calc?.maxHp||0));
  console.log('Top 10 by calc.maxHp:');
  mons.slice(0,10).forEach((m,i)=>{
    console.log(`${i+1}. ${m.name} (${m.id}) HP:${m.calc?.maxHp||0} ATK:${m.calc?.atk||0} Level:${m.level||0}`);
  });
})();
