#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const { createServiceContext } = require('../src/services/createServiceContext');

(async function main(){
  try {
    const tplPath = process.argv[2] || './npc-templates/wandering-warrior.json';
    const eventId = process.argv[3] || 'e2d4f176-6222-4f0c-afb0-4ae05422a76c';
    const raw = fs.readFileSync(require('path').resolve(__dirname, tplPath), 'utf8');
    const tpl = JSON.parse(raw);
    const sc = createServiceContext();
    const ev = await sc.monsterEventService.getEventById(eventId).catch(()=>null);
    if (!ev) {
      console.error('Event not found:', eventId);
      process.exit(2);
    }
    const nodes = tpl.nodes || [];
    const updated = await sc.monsterEventService.updateEvent(eventId, { nodes, message: tpl.message, name: tpl.name }).catch((e)=>{ console.error('update failed', e && e.message || e); return null; });
    if (!updated) {
      console.error('Update failed');
      process.exit(1);
    }
    console.log('Template applied to event', eventId);
    console.log(JSON.stringify(updated.nodes && updated.nodes[0] ? updated.nodes[0] : updated, null, 2));
    process.exit(0);
  } catch (e) {
    console.error('error', e && e.message ? e.message : e);
    process.exit(1);
  }
})();