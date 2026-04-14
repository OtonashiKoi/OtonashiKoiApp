#!/usr/bin/env node
require('dotenv').config();
const { createServiceContext } = require('../src/services/createServiceContext');

(async function main(){
  try {
    const id = process.argv[2];
    if (!id) {
      console.error('Usage: node scripts/show-item.js <itemId>');
      process.exit(1);
    }
    const sc = createServiceContext();
    const item = await sc.itemService.getItemById(id).catch(() => null);
    if (!item) {
      console.error('Item not found:', id);
      process.exit(2);
    }
    console.log(JSON.stringify(item, null, 2));
    process.exit(0);
  } catch (e) {
    console.error('error', e && e.message ? e.message : e);
    process.exit(1);
  }
})();