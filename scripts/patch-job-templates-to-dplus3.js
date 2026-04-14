#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createServiceContext } = require('../src/services/createServiceContext');

(async function main(){
  try {
    const sc = createServiceContext();
    const dir = path.resolve(__dirname, 'npc-templates');
    if (!fs.existsSync(dir)) {
      console.error('npc-templates not found');
      process.exit(1);
    }
    const files = fs.readdirSync(dir).filter(f => f.startsWith('wandering-job_') && f.endsWith('.json'));
    const allItems = await sc.itemService.listItems().catch(()=>[]);
    for (const f of files) {
      const p = path.join(dir, f);
      const raw = fs.readFileSync(p, 'utf8');
      const tpl = JSON.parse(raw);
      // determine weapon types from condition if present
      const start = tpl.nodes && tpl.nodes[0];
      const tradeOpt = start && start.options && start.options.find(o=>o.id==='opt_trade');
      let types = [];
      if (tradeOpt && tradeOpt.condition && tradeOpt.condition.any) types = tradeOpt.condition.any.map(a=>a.weaponType).filter(Boolean);

      // find D-tier weapon matching types, fallback to any equipment D
      let weapon = null;
      for (const t of types) {
        const candidates = allItems.filter(it => it.weaponType === t && String(it.tier||'').toUpperCase() === 'D' && it.itemType === 'equipment');
        if (candidates.length) { weapon = candidates[0]; break; }
      }
      if (!weapon) weapon = allItems.find(it=>it.itemType==='equipment' && String(it.tier||'').toUpperCase()==='D') || allItems.find(it=>it.itemType==='equipment') || null;

      if (tradeOpt && weapon) {
        // replace effects: keep take_item requirement but grant D-tier weapon +3
        tradeOpt.effects = [
          { type: 'take_item', payload: { itemId: tradeOpt.effects && tradeOpt.effects[0] && tradeOpt.effects[0].payload && tradeOpt.effects[0].payload.itemId ? tradeOpt.effects[0].payload.itemId : '', enhanceLevel: 3 } },
          { type: 'grant_equipment', payload: { itemId: weapon.id, enhanceLevel: 3 } }
        ];
        fs.writeFileSync(p, JSON.stringify(tpl, null, 2), 'utf8');
        console.log('Patched', f, '=> grants', weapon.name);
      } else {
        console.log('Skipped', f, '(no trade option or no weapon found)');
      }
    }
    process.exit(0);
  } catch (e) {
    console.error(e && e.message || e);
    process.exit(1);
  }
})();
