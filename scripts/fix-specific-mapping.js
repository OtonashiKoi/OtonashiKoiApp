#!/usr/bin/env node
require('dotenv').config();
const { createServiceContext } = require('../src/services/createServiceContext');

(async function main(){
  try {
    const sc = createServiceContext();
    const zone = 'normal';
    const monsters = await sc.monsterService.listMonsters({ includeDisabled: true, zone });
    const fromId = '27afa441-9c4c-4c05-aac7-01955685c20f';
    const toId = 'e2d4f176-6222-4f0c-afb0-4ae05422a76c';
    for (const m of monsters) {
      const mappings = Array.isArray(m.npcMappings) ? m.npcMappings.map(mp => ({ ...mp })) : [];
      let changed = false;
      for (const mp of mappings) {
        if (mp.eventId === fromId) {
          mp.eventId = toId;
          changed = true;
          console.log(`Updating monster ${m.name} mapping ${fromId} -> ${toId}`);
        }
      }
      if (changed) {
        const updated = await sc.monsterService.updateMonster(m.id, { npcMappings: mappings });
        console.log('Updated:', updated.id, updated.npcMappings);
      }
    }
    console.log('done');
    process.exit(0);
  } catch (err) {
    console.error('error:', err && err.message ? err.message : err);
    process.exit(1);
  }
})();
