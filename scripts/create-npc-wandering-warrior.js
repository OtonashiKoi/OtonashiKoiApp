#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const { createServiceContext } = require('../src/services/createServiceContext');

(async function main() {
  try {
    const tplPath = require('path').resolve(__dirname, './npc-templates/wandering-warrior.json');
    const raw = fs.readFileSync(tplPath, 'utf8');
    const payload = JSON.parse(raw);
    console.log('Loaded NPC template:', payload.id);

    const sc = createServiceContext();
    try {
      const allItems = await sc.itemService.listItems().catch(() => []);

      const findWarriorItem = () => {
        return allItems.find(it => (it.itemType === 'equipment' || it.itemType === 'item') && /戰士|Warrior|職業/i.test(String(it.name || '')));
      };

      const startNode = payload.nodes && payload.nodes[0];
      if (startNode && Array.isArray(startNode.options)) {
        for (const opt of startNode.options) {
          const effs = Array.isArray(opt.effects) ? opt.effects : [];
          for (const eff of effs) {
            if (eff.type === 'grant_item') {
              const desired = eff.payload && eff.payload.itemId ? String(eff.payload.itemId) : '';
              let resolved = null;
              try {
                if (desired) await sc.itemService.getItemById(desired).then((r) => { resolved = r.id; }).catch(() => { resolved = null; });
              } catch (_) { resolved = null; }
              if (!resolved) {
                const war = findWarriorItem();
                if (war) resolved = war.id;
                else {
                  // fallback: any equipment
                  const anyEq = allItems.find(x => x.itemType === 'equipment');
                  if (anyEq) resolved = anyEq.id;
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
