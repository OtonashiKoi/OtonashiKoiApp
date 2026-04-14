#!/usr/bin/env node
require('dotenv').config();
const { createServiceContext } = require('../src/services/createServiceContext');

(async function main() {
  try {
    const sc = createServiceContext();
    const zone = 'normal';
    const monsters = await sc.monsterService.listMonsters({ includeDisabled: true, zone });
    console.log('monsters:', monsters.map(m => ({ id: m.id, seq: m.seq, name: m.name, npcMappings: m.npcMappings || [] })));
    const target = monsters.find(m => m.seq === 1) || monsters[0];
    if (!target) {
      console.error('No monster found to update');
      process.exit(1);
    }
    const eventId = '27afa441-9c4c-4c05-aac7-01955685c20f'; // sample npc created earlier
    const mapping = { eventId, chance: 20, triggerMonsterSeq: null };
    const existing = Array.isArray(target.npcMappings) ? target.npcMappings.slice() : [];
    existing.push(mapping);
    const updated = await sc.monsterService.updateMonster(target.id, { npcMappings: existing });
    console.log('Updated monster:', updated.id, 'npcMappings:', updated.npcMappings || []);
    process.exit(0);
  } catch (err) {
    console.error('error:', err && err.message ? err.message : err);
    process.exit(1);
  }
})();
