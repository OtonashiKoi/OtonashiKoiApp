#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createServiceContext } = require('../src/services/createServiceContext');

(async function main(){
  try {
    const sc = createServiceContext();
    const dir = path.resolve(__dirname, 'npc-templates-clean');
    if (!fs.existsSync(dir)) {
      console.error('npc-templates-clean directory not found:', dir);
      process.exit(1);
    }

    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    if (!files.length) {
      console.log('No template files found in', dir);
      process.exit(0);
    }

    const created = [];
    for (const f of files) {
      try {
        const raw = fs.readFileSync(path.join(dir, f), 'utf8');
        const tpl = JSON.parse(raw);
        if (!tpl.id) tpl.id = tpl.name || `npc-${path.basename(f, '.json')}`;

        const res = await sc.monsterEventService.createEvent(tpl).catch(err=>{ throw err; });
        if (res && res.id) {
          console.log('Imported template', f, '=> event id', res.id);
          created.push({ file: f, id: res.id });
        } else {
          console.warn('Create returned no id for', f, '— skipping');
        }
      } catch (e) {
        console.error('Failed importing', f, e && e.message ? e.message : e);
      }
    }

    console.log('Import finished. Imported count:', created.length);
    process.exit(0);
  } catch (e) {
    console.error('fatal:', e && e.message ? e.message : e);
    process.exit(1);
  }
})();
