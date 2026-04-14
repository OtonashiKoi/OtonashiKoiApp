#!/usr/bin/env node
require('dotenv').config();
const { createServiceContext } = require('../src/services/createServiceContext');

(async function main(){
  try {
    const sc = createServiceContext();
    const eventId = process.argv[2];
    const zone = process.argv[3] || 'normal';
    if (!eventId) {
      console.error('Usage: node scripts/sync-active-event-to-template.js <eventId> [zone]');
      process.exit(1);
    }
    const tpl = await sc.monsterEventService.getEventById(eventId).catch(() => null);
    if (!tpl) {
      console.error('Template event not found:', eventId);
      process.exit(2);
    }
    const state = await sc.monsterService.getState(zone).catch(() => null);
    if (!state) {
      console.error('No state for zone', zone);
      process.exit(3);
    }
    if (!state.activeEvent || state.activeEvent.id !== eventId) {
      console.log('Active event is not the target event; nothing to sync.');
      console.log('Current activeEvent:', state.activeEvent ? state.activeEvent.id : null);
      process.exit(0);
    }
    state.activeEvent.nodes = tpl.nodes || [];
    state.activeEvent.message = tpl.message || state.activeEvent.message;
    state.activeEvent.name = tpl.name || state.activeEvent.name;
    await sc.monsterService.saveState(state, zone);
    console.log('Synced activeEvent nodes to template for', eventId, 'zone', zone);
    process.exit(0);
  } catch (e) {
    console.error('error', e && e.message ? e.message : e);
    process.exit(1);
  }
})();