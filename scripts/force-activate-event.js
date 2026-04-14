#!/usr/bin/env node
require('dotenv').config();
const { createServiceContext } = require('../src/services/createServiceContext');

(async function main() {
  try {
    const sc = createServiceContext();
    const args = process.argv.slice(2);
    const eventId = args[0] || null;
    const zone = args[1] || 'normal';
    if (!eventId) {
      console.error('Usage: node scripts/force-activate-event.js <eventId> [zone]');
      process.exit(1);
    }
    const tpl = await sc.monsterEventService.getEventById(eventId).catch(() => null);
    if (!tpl) {
      console.error('Event not found:', eventId);
      process.exit(2);
    }

    const allMonsters = await sc.monsterService.listMonsters({ includeDisabled: false, zone });
    const pending = allMonsters && allMonsters.length ? allMonsters[0] : null;
    const startedAt = new Date().toISOString();
    const endsAt = new Date(Date.now() + ((tpl.durationSec || 12) * 1000)).toISOString();
    const state = await sc.monsterService.getState(zone);
    const newState = {
      ...state,
      activeEvent: {
        id: tpl.id,
        name: tpl.name,
        message: tpl.message,
        startedAt,
        endsAt,
        pendingMonsterSeq: pending ? pending.seq : null,
        nodes: tpl.nodes || [],
        npc: tpl.npc || null
      },
      currentHp: 0
    };
    await sc.monsterService.saveState(newState, zone);
    console.log('Activated event', tpl.id, 'zone', zone);
    process.exit(0);
  } catch (e) {
    console.error('error', e && e.message ? e.message : e);
    process.exit(1);
  }
})();