#!/usr/bin/env node
const { createServiceContext } = require('../src/services/createServiceContext');

(async () => {
  try {
    const sc = createServiceContext();
    const targetName = (process.env.EVENT_NAME || 'SIMPLE NPC').toLowerCase();
    const trials = Number(process.env.TRIALS || 1000);
    const zone = process.env.ZONE || 'normal';
    const includeDisabled = process.env.INCLUDE_DISABLED === 'false' ? false : true;

    let events = await sc.monsterEventService.listEvents({ zone, includeDisabled }).catch(() => []);
    // fallback: try all zones
    if (!events.length) {
      events = await sc.monsterEventService.listEvents({ includeDisabled: true }).catch(() => []);
    }
    if (!events.length) {
      console.error('No events found in zone normal.');
      process.exit(2);
    }

    const target = events.find((e) => (String(e.name || '').toLowerCase().includes(targetName)) || ((e.npc && String(e.npc.name || '').toLowerCase().includes(targetName))));
    if (!target) {
      console.error('Target event not found. Available events:');
      events.forEach((e) => console.error(`- id=${e.id} name=${e.name} zone=${e.zone} npc.name=${(e.npc && e.npc.name) || ''}`));
      process.exit(2);
    }

    let count = 0;
    for (let i = 0; i < trials; i++) {
      const picked = await sc.monsterEventService.pickEventForTransition({ zone: 'normal', defeatedMonsterSeq: null });
      if (picked && picked.id === target.id) count++;
    }

    console.log(`Target event id=${target.id} name=${target.name} encountered ${count} / ${trials} times`);
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
