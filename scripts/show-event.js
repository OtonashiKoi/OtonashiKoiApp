#!/usr/bin/env node
require('dotenv').config();
const { createServiceContext } = require('../src/services/createServiceContext');

(async function main(){
  try {
    const sc = createServiceContext();
    const id = 'e2d4f176-6222-4f0c-afb0-4ae05422a76c';
    const ev = await sc.monsterEventService.getEventById(id);
    console.log(JSON.stringify(ev, null, 2));
    process.exit(0);
  } catch (err) {
    console.error('error:', err && err.message ? err.message : err);
    process.exit(1);
  }
})();
