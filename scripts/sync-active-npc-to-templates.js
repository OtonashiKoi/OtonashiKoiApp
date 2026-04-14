#!/usr/bin/env node
require('dotenv').config();
const { createServiceContext } = require('../src/services/createServiceContext');

(async function main() {
  try {
    const sc = createServiceContext();
    const zones = ['normal', 'mid'];
    for (const zone of zones) {
      try {
        const state = await sc.monsterRepository.getState(zone);
        const activeEvent = state && state.activeEvent ? state.activeEvent : null;
        if (!activeEvent || !activeEvent.id) {
          console.log(`[${zone}] no activeEvent found`);
          continue;
        }

        const eventId = activeEvent.id;
        console.log(`[${zone}] found activeEvent id=${eventId}`);

        const existing = await sc.monsterEventRepository.findById(eventId);
        const npc = activeEvent.npc || null;

        if (existing) {
          const updated = Object.assign({}, existing, { npc, updatedAt: new Date().toISOString() });
          await sc.monsterEventRepository.save(updated);
          console.log(`[${zone}] updated monsterEvent ${eventId} with npc`);
        } else {
          // create a minimal event document using runtime data
          const newEvent = {
            id: eventId,
            zone: zone === 'mid' ? 'mid' : 'normal',
            name: activeEvent.name || `NPC ${eventId.slice(0, 8)}`,
            message: activeEvent.message || (activeEvent.nodes && activeEvent.nodes[0] && activeEvent.nodes[0].text) || '',
            triggerMonsterSeq: activeEvent.triggerMonsterSeq == null ? null : activeEvent.triggerMonsterSeq,
            durationSec: activeEvent.durationSec || 12,
            priority: activeEvent.priority != null ? activeEvent.priority : 100,
            enabled: true,
            npc,
            nodes: activeEvent.nodes || [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          await sc.monsterEventRepository.save(newEvent);
          console.log(`[${zone}] created new monsterEvent ${eventId} with npc`);
        }
      } catch (err) {
        console.error(`[${zone}] error:`, err && err.message ? err.message : err);
      }
    }
    process.exit(0);
  } catch (err) {
    console.error('fatal:', err && err.message ? err.message : err);
    process.exit(1);
  }
})();
