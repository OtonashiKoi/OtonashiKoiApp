#!/usr/bin/env node
require('dotenv').config();
const { createServiceContext } = require('../src/services/createServiceContext');

(async function main(){
  try {
    const sc = createServiceContext();
    const events = await sc.monsterEventService.listEvents({ includeDisabled: true });
    console.log('events:', events.map(e => ({ id: e.id, name: e.name, zone: e.zone, enabled: e.enabled, chance: e.chance || 0 })));
    process.exit(0);
  } catch (err) {
    console.error('error:', err && err.message ? err.message : err);
    process.exit(1);
  }
})();
