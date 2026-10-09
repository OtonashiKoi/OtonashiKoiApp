"use strict";
const { requireAuth } = require("./requireAuth");
const { ok } = require("../../shared/response");
const potions = require("../../services/realtime/liveBattlePotions");
const { normalLiveCombat: engine } = require("../../services/realtime/normalLiveCombat");
const ZONE = "event_boss_hutao_preview";
const artCaches = new WeakMap();
async function withArtwork(sc, data) {
  if (!data) return data;
  let cached = artCaches.get(sc);
  if (!cached || Date.now() - cached.at > 60000) {
    const rows = await Promise.all(data.items.map(async item => {
      const definition = await sc.itemService.getItemById(item.itemId);
      return [item.itemId, { imageUrl: definition?.imageUrl || null, imageThumbnailUrl: definition?.imageThumbnailUrl || null }];
    }));
    cached = { at: Date.now(), art: Object.fromEntries(rows) }; artCaches.set(sc, cached);
  }
  return { ...data, items: data.items.map(item => ({ ...item, ...cached.art[item.itemId] })) };
}
function register(router, sc) {
  router.get("/api/me/combat-potions", requireAuth, async (req, res, next) => {
    try {
      const p = await sc.progressRepository.findByPlayerId(req.playerRecord.discordId);
      res.json(ok(await withArtwork(sc, { plan: p?.combatPotionPlan || {}, items: potions.items(p), limit: 10 })));
    } catch (e) { next(e); }
  });
  router.put("/api/me/combat-potions", requireAuth, async (req, res, next) => {
    try { res.json(ok(await withArtwork(sc, await potions.configure(sc, req.playerRecord.discordId, req.body?.plan, engine)))); }
    catch (e) { next(e); }
  });
  router.get("/api/combat/potions", requireAuth, async (req, res, next) => {
    try {
      const id = req.playerRecord.discordId, a = engine.players.get(id), room = engine.zones.get(ZONE);
      if (!a || a.joining || a.initial.zone !== ZONE || !room || room.closed) return res.json(ok(null));
      const state = await sc.monsterService.getState(ZONE);
      res.json(ok(await withArtwork(sc, potions.view(room, state, id, engine.now()))));
    } catch (e) { next(e); }
  });
  router.post("/api/combat/potions/use", requireAuth, async (req, res, next) => {
    try {
      const id = req.playerRecord.discordId, a = engine.players.get(id), room = engine.zones.get(ZONE);
      if (!a || a.joining || a.initial.zone !== ZONE || !room || room.closed) throw Object.assign(new Error("本場戰鬥已結束"), { statusCode: 409 });
      const data = await engine.serial(ZONE, async () => {
        const state = await potions.use(engine, room, id, req.body || {});
        engine.updateScene(room, state, [], []);
        return potions.view(room, state, id, engine.now());
      });
      res.json(ok(await withArtwork(sc, data)));
    } catch (e) { next(e); }
  });
}
module.exports = { register };
