"use strict";
function registerWeaponChoiceRoutes(router, sc, requireAuth) {
  const service = require("../../services/shop/weaponChoiceChest").createWeaponChoiceService(sc.shopService);
  router.get("/api/me/inventory/weapon-choice/:uuid", requireAuth, async (req, res, next) => {
    try { res.json({ ok: true, data: await service.list(req.playerRecord.discordId, req.params.uuid) }); }
    catch (e) { next(e); }
  });
  router.post("/api/me/inventory/weapon-choice/:uuid", requireAuth, async (req, res, next) => {
    try { res.json({ ok: true, data: await service.open(req.playerRecord.discordId, req.params.uuid, req.body?.itemId, req.body?.operationId) }); }
    catch (e) { next(e); }
  });
}
module.exports = { registerWeaponChoiceRoutes };
