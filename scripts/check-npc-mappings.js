#!/usr/bin/env node
require('dotenv').config();
const { createServiceContext } = require('../src/services/createServiceContext');

(async function main(){
  try {
    const sc = createServiceContext();
    const zone = 'normal';
    const monsters = await sc.monsterService.listMonsters({ includeDisabled: true, zone });
    const events = await sc.monsterEventService.listEvents({ includeDisabled: true });
    const eventIds = new Set(events.map(e => e.id));
    for (const m of monsters) {
      const mappings = Array.isArray(m.npcMappings) ? m.npcMappings : [];
      console.log(`monster seq=${m.seq} id=${m.id} name=${m.name} mappings=${mappings.length}`);
      for (const mp of mappings) {
        console.log('  mapping -> eventId:', mp.eventId, 'exists:', eventIds.has(mp.eventId));
      }
    }
    process.exit(0);
  } catch (err) {
    console.error('error:', err && err.message ? err.message : err);
    process.exit(1);
  }
})();
