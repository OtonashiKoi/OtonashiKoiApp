#!/usr/bin/env node
require('dotenv').config();
const { createServiceContext } = require('../src/services/createServiceContext');

(async function main() {
  try {
    const sc = createServiceContext();
    const payload = {
      zone: 'normal',
      name: 'Sample NPC: Test Wizard',
      message: '你好，冒險者，這是測試 NPC。',
      triggerMonsterSeq: null,
      durationSec: 30,
      priority: 50,
      enabled: true,
      npc: { name: 'Test Wizard', imageUrl: null, imageThumbnailUrl: null },
      nodes: [{
        id: 'start',
        text: '歡迎！選一個。',
        options: [
          {
            id: 'opt_1',
            label: '拿獎勵',
            npcReply: '這是你的獎勵。',
            nextNodeId: null,
            effects: [{ type: 'grant_currency', payload: { currencyType: 'gold', amount: 100 } }]
          }
        ]
      }]
    };

    const created = await sc.monsterEventService.createEvent(payload);
    console.log('created:', created && created.id ? created.id : created);
    process.exit(0);
  } catch (err) {
    console.error('error:', err && err.message ? err.message : err);
    process.exit(1);
  }
})();
