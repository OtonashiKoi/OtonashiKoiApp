#!/usr/bin/env node
require('dotenv').config();
const { createServiceContext } = require('../src/services/createServiceContext');

(async function(){
  try {
    const sc = createServiceContext();
    const all = await sc.itemService.listItems().catch(() => []);
    const matches = (all || []).filter(it => /(職業|Warrior|戰士|job_warrior)/i.test(String(it.name || '')));
    console.log(matches.map(i => ({ id: i.id, name: i.name, itemType: i.itemType, weaponType: i.weaponType, tier: i.tier })));
    process.exit(0);
  } catch (e) {
    console.error('error', e && e.message ? e.message : e);
    process.exit(1);
  }
})();