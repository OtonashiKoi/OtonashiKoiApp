"use strict";
const assert = require("node:assert/strict");
const { MongoMemoryServer } = require("mongodb-memory-server");

async function main() {
  const mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri();
  process.env.MONGODB_DB_NAME = "worldboss_levels_isolated";
  process.env.JWT_SECRET = "isolated-worldboss-level-test-secret";
  const { getMongoDb, closeMongoClient } = require("../src/adapters/mongo/createMongoClient");
  let server;
  try {
    const db = await getMongoDb();
    const { createMongoRepositories } = require("../src/adapters/mongo/createMongoRepositories");
    const { WorldBossService, WORLD_BOSS_ZONES } = require("../src/services/worldBoss/worldBossService");
    const zones = require("../src/shared/zones");
    const repos = createMongoRepositories();
    const playerId = "worldboss-level-player";
    const bindings = Object.keys(WORLD_BOSS_ZONES).map(zone => ({
      featureKey: zones.zoneToFeatureKey(zone), enabled: true, channelId: `test-${zone}`,
      minLevel: zone === "elite" ? 30 : 40, maxLevel: null,
    }));
    const layout = { discord: { bindings } };
    const bossServices = Object.fromEntries(Object.entries(WORLD_BOSS_ZONES).map(([zone, bossKey]) => [zone,
      new WorldBossService({ getConfig: async () => ({ enabled: true }), getState: async () => null },
        { bossKey, progressRepository: repos.progressRepository })]));
    let dcMode = false, soloMode = false, beyondLevelGate = 0;
    const stop = () => { beyondLevelGate++; throw Object.assign(Error("AFTER_LEVEL_GATE"), { status: 418 }); };
    const monster = { id: "elite-daishi-king", name: "大史王", isBoss: true, seq: 1,
      level: 60, calc: { maxHp: 100000, str: 1, vit: 1, agi: 1 }, drops: [] };
    const sc = { ...repos, adminConsoleService: { getChannelLayout: async () => layout },
      channelLayoutRepository: { get: async () => layout }, worldBossService: bossServices.elite,
      worldBossServiceFor: zone => bossServices[zone],
      storyService: { checkZoneStoryGate: async () => ({ chapterTitle: "AFTER_LEVEL_GATE", chapterId: "sentinel" }) },
      monsterService: {
        getState: async () => dcMode ? stop() : { activeMonsterSeq: 1, currentHp: 100000, participants: [], damageMap: {} },
        listMonsters: async () => soloMode ? stop() : [monster],
        saveState: async () => { throw Error("test must not mutate monster state"); },
      },
    };
    // Only the test process uses this context. No live runtime or Discord client is created.
    const contextPath = require.resolve("../src/services/runtimeContext");
    require.cache[contextPath] = { id: contextPath, filename: contextPath, loaded: true,
      exports: { serviceContext: sc, getBotClient: () => null } };
    const express = require("express"), app = express(); app.use(express.json());
    app.use(require("../src/api/routes/playerAppRoutes").createPlayerAppRoutes(sc));
    app.use(require("../src/api/routes/soloBossRoutes").createSoloBossRoutes(sc));
    app.use((error, req, res, next) => res.status(error.status || 500).json({ message: error.message }));
    server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const headers = { Authorization: `Bearer ${require("jsonwebtoken").sign({ discordId: playerId }, process.env.JWT_SECRET)}`,
      "Content-Type": "application/json" };
    const seed = async level => {
      await db.collection("progress").replaceOne({ playerId }, { playerId, level, inventory: [], equipment: {},
        accountWorldBossClears: { default: true, dragon_king: true, hellfang_king: true }, updatedAt: "before" }, { upsert: true });
      await db.collection("wallets").replaceOne({ playerId }, { playerId, gold: 1000000 }, { upsert: true });
    };
    let cases = 0;
    for (const zone of Object.keys(WORLD_BOSS_ZONES)) {
      const min = zone === "elite" ? 30 : 40;
      assert.equal(zones.getZoneLevelLimits(zone).minLevel, min);
      assert.ok(zones.checkZoneLevelRequirement(zone, min - 1));
      assert.equal(zones.checkZoneLevelRequirement(zone, min), null);
      assert.equal(zones.checkZoneLevelRequirementWithBinding(zone, min, bindings.find(b => b.featureKey === zones.zoneToFeatureKey(zone))), null);
      if (zone.startsWith("event_boss")) assert.equal(zones.canPlayerAccessZone(zone, "865264891991425055"), false);
      cases++;
    }
    const dc = require("../src/bot/handlers/monsterZoneHandlers");
    for (const zone of ["elite", "dragon_king_lair", "hellfire_depths", "metal_throne"]) {
      const min = zone === "elite" ? 30 : 40;
      for (const level of [min - 1, min]) {
        await seed(level);
        const metadata = await (await fetch(`${base}/api/worldboss/status`, { headers })).json();
        const boss = metadata.data.bosses.find(b => b.zoneKey === zone);
        assert.equal(boss.minLevel, min);
        assert.equal(boss.canChallenge, level >= min);
        assert.equal(Boolean(boss.lockedReason), level < min);
        const response = await fetch(`${base}/api/combat/quick-battle`, { headers, method: "POST", body: JSON.stringify({ zone, worldBossPart: "body" }) });
        const body = await response.json();
        if (level < min) { assert.equal(response.status, 400); assert.match(body.message, new RegExp(`Lv\\.${min}`)); }
        else { assert.equal(response.status, 403); assert.equal(body.code, "story_required"); }
        assert.equal((await repos.walletRepository.findByPlayerId(playerId)).gold, 1000000);
        cases++;
        dcMode = true; beyondLevelGate = 0; const replies = [];
        await dc.handleMonsterZoneButton({ customId: "monster-zone:enter-battle:body", channelId: `test-${zone}`,
          user: { id: playerId, username: "隔離測試" }, member: { displayName: "隔離測試" },
          deferReply: async () => {}, editReply: async reply => { replies.push(reply.content); } });
        dcMode = false;
        assert.equal(beyondLevelGate > 0, level >= min);
        if (level < min) assert.ok(replies.some(text => text.includes(`Lv.${min}`)));
        assert.equal((await repos.walletRepository.findByPlayerId(playerId)).gold, 1000000);
        assert.equal(dc.activeSessions.has(playerId), false); cases++;
      }
    }
    for (const level of [29, 30]) {
      await seed(level);
      const response = await fetch(`${base}/api/me/solo-boss/status`, { headers });
      const info = (await response.json()).data.bosses[0];
      assert.equal(info.minLevel, 30); assert.equal(info.canChallenge, level >= 30);
      soloMode = true; beyondLevelGate = 0;
      const battle = await fetch(`${base}/api/me/solo-boss/battle`, { headers, method: "POST", body: JSON.stringify({ key: "daishi", part: "body" }) });
      soloMode = false;
      assert.equal(battle.status, level < 30 ? 400 : 418);
      assert.equal(beyondLevelGate > 0, level >= 30);
      assert.equal((await repos.walletRepository.findByPlayerId(playerId)).gold, 1000000); cases++;
    }
    console.log(`PASS: ${cases} world boss entry scenarios; Web/Discord/solo boundaries, no entry debit, closed event bosses`);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await closeMongoClient(); await mongo.stop();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
