#!/usr/bin/env node
require('dotenv').config();
const { createServiceContext } = require('../src/services/createServiceContext');

(async function main(){
  try {
    const sc = createServiceContext();
    const zone = 'normal';
    const monsters = await sc.monsterService.listMonsters({ includeDisabled: true, zone });
    const events = await sc.monsterEventService.listEvents({ includeDisabled: true });
    const lookup = Object.fromEntries(events.map(e => [e.name, e.id]));

    // mapping: replace unknown eventIds by matching event name if known
    for (const m of monsters) {
      let changed = false;
      const mappings = Array.isArray(m.npcMappings) ? m.npcMappings.map(mp => ({ ...mp })) : [];
      for (let i = 0; i < mappings.length; i++) {
        const mp = mappings[i];
        const exists = events.some(e => e.id === mp.eventId);
        if (!exists) {
          // attempt to find by name: if mp.eventId looks like a name (non-uuid), try match
          const possible = events.find(e => e.name === mp.eventId || e.name === (mp.eventName || ''));
          if (possible) {
            mappings[i].eventId = possible.id;
            changed = true;
            console.log(`Repointed mapping for monster ${m.name} (seq ${m.seq}) to event ${possible.name} (${possible.id})`);
          }
        }
      }
      if (changed) {
        await sc.monsterService.updateMonster(m.id, { npcMappings: mappings });
      }
    }
    console.log('repair complete');
    process.exit(0);
  } catch (err) {
    console.error('error:', err && err.message ? err.message : err);
    process.exit(1);
  }
})();
