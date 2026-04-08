"use strict";
require('dotenv').config();
const { createServiceContext } = require('../src/services/createServiceContext');
const { getBotClient } = require('../src/bot/runtimeContext');

(async () => {
  try {
    const ctx = createServiceContext();

    const zones = [
      { key: 'normal', featureKey: 'monster_zone' },
      { key: 'mid', featureKey: 'monster_zone_mid' }
    ];

    for (const z of zones) {
      const monsters = await ctx.monsterService.listMonsters({ zone: z.key });
      if (!monsters || monsters.length === 0) {
        console.warn(`no monsters for zone ${z.key}, skip`);
        continue;
      }
      // choose first monster by seq
      const monster = monsters[0];
      const state = {
        activeMonsterSeq: monster.seq,
        currentHp: monster.calc?.maxHp ?? null,
        participantCount: 0,
        participants: [],
        damageMap: {},
        killClaimedSeq: null,
        killClaimedAt: null,
        killClaimedBy: null,
        killCount: {}
      };

      await ctx.monsterService.saveState(state, z.key);
      console.log(`saved state for zone ${z.key} -> activeMonsterSeq=${monster.seq}, currentHp=${state.currentHp}`);
    }

    // Try to republish panels if bot client is ready
    const client = getBotClient();
    if (client && typeof client.isReady === 'function' && client.isReady()) {
      const layout = await ctx.adminConsoleService.getChannelLayout();
      const bindings = layout.discord.bindings || [];
      for (const b of bindings) {
        if (!b.enabled) continue;
        if (!b.featureKey || !b.featureKey.startsWith('monster_zone')) continue;
        const zoneKey = b.featureKey === 'monster_zone_mid' ? 'mid' : 'normal';
        const monsters = await ctx.monsterService.listMonsters({ zone: zoneKey });
        if (!monsters || monsters.length === 0) continue;
        const monster = monsters[0];
        const currentHp = monster.calc?.maxHp ?? null;
        try {
          // 戰鬥後或例行更新應以 edit 為主，僅在管理員指定時才清空頻道再發布
          const res = await ctx.adminConsoleService.publishMonsterZonePanel(b.channelId, monster, currentHp, { cleanChannel: false });
          console.log(`published panel ${b.featureKey} -> channel ${b.channelId}, messageId=${res.messageId}`);
        } catch (e) {
          console.warn(`publish failed for channel ${b.channelId}:`, e.message || e);
        }
      }
    } else {
      console.log('Discord bot client not ready — skipped publishing panels (DB state updated).');
    }

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
