#!/usr/bin/env node
require('dotenv').config();
const { createServiceContext } = require('../src/services/createServiceContext');

(async function main() {
  try {
    const sc = createServiceContext();
    const rows = await sc.monsterEventRepository.findAll();
    const list = rows.map((row) => ({
      id: row.id,
      name: row.name,
      zone: row.zone,
      npc: row.npc || null,
      startText: Array.isArray(row.nodes) && row.nodes.length ? row.nodes[0].text : null,
      createdAt: row.createdAt
    }));
    console.log(JSON.stringify(list, null, 2));
    process.exit(0);
  } catch (err) {
    console.error('error:', err && err.message ? err.message : err);
    process.exit(1);
  }
})();
