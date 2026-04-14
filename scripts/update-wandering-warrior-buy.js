#!/usr/bin/env node
require('dotenv').config();
const { createServiceContext } = require('../src/services/createServiceContext');

(async function main(){
  try {
    const sc = createServiceContext();
    const id = 'e2d4f176-6222-4f0c-afb0-4ae05422a76c'; // 流浪戰士
    const ev = await sc.monsterEventService.getEventById(id).catch(() => null);
    if (!ev) {
      console.error('event not found:', id);
      process.exit(1);
    }
    const nodes = Array.isArray(ev.nodes) ? ev.nodes : [];
    if (!nodes.length) {
      console.error('no nodes found on event');
      process.exit(1);
    }
    const start = nodes[0];

    // 找一把單手斧（優先秘銀/精鋼）
    const allItems = await sc.itemService.listItems().catch(() => []);
    const prefer = ['秘銀單手斧','精鋼單手斧','鐵製單手斧','木製單手斧'];
    let axeItem = allItems.find(it => it.type === 'axe_1h' || it.weaponType === 'axe_1h');
    if (!axeItem) {
      // 嘗試按名稱匹配優先列表
      for (const name of prefer) {
        const f = allItems.find(it => String(it.name || '').includes(name));
        if (f) { axeItem = f; break; }
      }
    }
    if (!axeItem) {
      // fallback: any equipment
      axeItem = allItems.find(it => it.itemType === 'equipment');
    }
    if (!axeItem) {
      console.error('No suitable axe/equipment found in item library. Aborting.');
      process.exit(2);
    }

    let changed = false;
    for (const opt of start.options) {
      const maybePurchase = String(opt.label || '').toLowerCase().includes('職業') || (Array.isArray(opt.effects) && opt.effects.some(e => e.type === 'grant_currency' && e.payload && e.payload.amount === -5000));
      if (maybePurchase) {
        opt.effects = [
          { type: 'grant_equipment', payload: { itemId: axeItem.id, enhanceLevel: 3 } }
        ];
        opt.label = opt.label.replace(/\d+金幣/, '+3 單手斧').replace(/購買職業道具：戰士（.*?）/, '購買 +3 單手斧');
        changed = true;
        console.log('Replaced effects for option', opt.id || opt.label, '->', axeItem.id);
      }
    }

    if (!changed) {
      console.log('No matching option found to update. Options:');
      console.log(JSON.stringify(start.options, null, 2));
      process.exit(0);
    }

    const updated = await sc.monsterEventService.updateEvent(id, { nodes }).catch((e) => { console.error('update failed', e && e.message || e); return null; });
    if (!updated) {
      console.error('Failed to update event.');
      process.exit(1);
    }
    console.log('Event updated.');
    console.log(JSON.stringify(updated.nodes && updated.nodes[0] ? updated.nodes[0].options : updated, null, 2));
    process.exit(0);
  } catch (err) {
    console.error('error:', err && err.message ? err.message : err);
    process.exit(1);
  }
})();