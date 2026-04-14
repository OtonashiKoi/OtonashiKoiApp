#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const { createServiceContext } = require('../src/services/createServiceContext');

(async function main() {
  try {
    const tplPath = require('path').resolve(__dirname, './npc-templates/wandering-merchant-basic.json');
    const raw = fs.readFileSync(tplPath, 'utf8');
    const payload = JSON.parse(raw);
    console.log('Loaded NPC template:', payload.id);

    // Try to create via service context if DB is configured
    const sc = createServiceContext();
    try {
      // Resolve placeholder itemIds by searching item library for D-tier equipment
      const allItems = await sc.itemService.listItems().catch(() => []);
      const itemsBySlot = {};
      for (const it of allItems) {
        if (it.itemType !== 'equipment') continue;
        // prefer items that mention D級 in description
        const isD = String(it.description || '').includes('D級') || String(it.name || '').startsWith('D');
        const slot = it.equipSlot || 'unknown';
        itemsBySlot[slot] = itemsBySlot[slot] || [];
        itemsBySlot[slot].push({ item: it, isD });
      }

      // preferred slots for the four options: head_top, armor, garment, shoes
      const preferredSlots = ['head_top','armor','garment','shoes'];
      const startNode = payload.nodes && payload.nodes[0];
      if (startNode && Array.isArray(startNode.options)) {
        for (let i = 0; i < startNode.options.length; i++) {
          const opt = startNode.options[i];
          const effs = Array.isArray(opt.effects) ? opt.effects : [];
          for (const eff of effs) {
            if (eff.type === 'grant_item') {
              const desired = eff.payload && eff.payload.itemId ? String(eff.payload.itemId) : '';
              let resolved = null;
              try {
                // try existing id first
                if (desired) await sc.itemService.getItemById(desired).then((r) => { resolved = r.id; }).catch(() => { resolved = null; });
              } catch (_) { resolved = null; }
              if (!resolved) {
                const slot = preferredSlots[i] || preferredSlots[preferredSlots.length-1];
                const candidates = (itemsBySlot[slot] || []).filter(x => x.isD).map(x => x.item).concat(itemsBySlot[slot] ? itemsBySlot[slot].map(x=>x.item) : []);
                if (candidates.length) resolved = candidates[0].id;
                else {
                  // fallback: any D equipment
                  const anyD = allItems.find(x => x.itemType === 'equipment' && (String(x.description||'').includes('D級') || String(x.name||'').startsWith('D')));
                  if (anyD) resolved = anyD.id;
                }
              }
              if (resolved) {
                console.log(`Resolved placeholder ${desired || '(none)'} -> ${resolved} for option ${opt.id}`);
                eff.payload = eff.payload || {};
                eff.payload.itemId = resolved;
              } else {
                console.warn(`Could not resolve item for option ${opt.id}; leaving as ${desired}`);
              }
            }
          }
        }
      }

      const created = await sc.monsterEventService.createEvent(payload);
      console.log('Created event id:', created && created.id ? created.id : created);
      process.exit(0);
    } catch (e) {
      console.warn('Could not create event via service (no DB or error). Template JSON available at:', tplPath);
      console.error(e && e.message ? e.message : e);
      console.log('Template content:\n', raw);
      process.exit(0);
    }
  } catch (err) {
    console.error('error:', err && err.message ? err.message : err);
    process.exit(1);
  }
})();
