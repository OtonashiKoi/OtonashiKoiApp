#!/usr/bin/env node
require('dotenv').config();
const { createServiceContext } = require('../src/services/createServiceContext');

(async function main(){
  try {
    const sc = createServiceContext();
    const id = 'e2d4f176-6222-4f0c-afb0-4ae05422a76c'; // 流浪戰士
    const ev = await sc.monsterEventService.getEventById(id);
    if (!ev) {
      console.error('event not found:', id);
      process.exit(1);
    }
    // 實作：在第一個 node 的 options 中，找到看起來像購買職業道具的選項（匹配 label 或 effects），加入 condition
    const nodes = Array.isArray(ev.nodes) ? ev.nodes : [];
    if (!nodes.length) {
      console.error('no nodes found on event');
      process.exit(1);
    }
    const start = nodes[0];
    let changed = false;
    for (const opt of start.options) {
      const maybePurchase = String(opt.label || '').toLowerCase().includes('職業') || (Array.isArray(opt.effects) && opt.effects.some(e => e.type === 'grant_item'));
      if (maybePurchase) {
        opt.condition = { any: [ { weaponType: 'axe_1h' }, { weaponType: 'axe_2h' } ] };
        changed = true;
        console.log('Added condition to option', opt.id || opt.label);
      }
    }
    if (!changed) {
      console.log('No matching option found to update. Listing options:');
      console.log(JSON.stringify(start.options, null, 2));
      process.exit(0);
    }
    // persist
    const updated = await sc.monsterEventService.updateEvent(id, { nodes });
    console.log('Event updated.');
    console.log(JSON.stringify(updated, null, 2));
    process.exit(0);
  } catch (err) {
    console.error('error:', err && err.message ? err.message : err);
    process.exit(1);
  }
})();
