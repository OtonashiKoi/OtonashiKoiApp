#!/usr/bin/env node
require('dotenv').config();
const { createServiceContext } = require('../src/services/createServiceContext');

(async function main(){
  try {
    const sc = createServiceContext();
    const id = 'e2d4f176-6222-4f0c-afb0-4ae05422a76c';
    const ev = await sc.monsterEventService.getEventById(id).catch(() => null);
    if (!ev) {
      console.error('event not found:', id);
      process.exit(1);
    }
    const nodes = Array.isArray(ev.nodes) ? ev.nodes : [];
    if (!nodes.length) {
      console.error('no nodes found');
      process.exit(1);
    }
    const start = nodes[0];

    // profession item id
    const professionId = 'job_warrior_v1';
    // axe item id we used earlier
    const axeId = '4885e098-3624-4c6c-9eb9-e4b27c2fb5ab';

    for (const opt of start.options) {
      const maybe = opt.id === 'opt_3' || String(opt.label||'').toLowerCase().includes('戰士') || (Array.isArray(opt.effects) && opt.effects.some(e=>e.type==='grant_equipment'));
      if (!maybe) continue;
      opt.effects = [
        { type: 'take_item', payload: { itemId: axeId, enhanceLevel: 3 } },
        { type: 'grant_item', payload: { itemId: professionId } }
      ];
      opt.label = '以 +3 木製單手斧 交換 戰士職業道具';
      console.log('Updated option', opt.id);
    }

    const updated = await sc.monsterEventService.updateEvent(id, { nodes }).catch((e)=>{ console.error('update failed', e && e.message || e); return null; });
    if (!updated) {
      console.error('update failed');
      process.exit(1);
    }
    console.log('Event updated. Preview:');
    console.log(JSON.stringify(updated.nodes[0].options, null, 2));
    process.exit(0);
  } catch (e) {
    console.error('error', e && e.message ? e.message : e);
    process.exit(1);
  }
})();