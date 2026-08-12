"use strict";

const { Router } = require("express");
const { ok } = require("../../shared/response");
const { CharacterService } = require("../../services/character/characterService");
const { requireAuth } = require("./requireAuth");

function createPlayerCharacterRoutes(serviceContext) {
  const router = Router();
  const service = new CharacterService({
    progressRepository: serviceContext.progressRepository,
    streamAccountBindingRepository: serviceContext.streamAccountBindingRepository,
    monsterService: serviceContext.monsterService,
  });

  router.get("/api/me/characters", requireAuth, async (req, res, next) => {
    try {
      return res.json(ok(await service.getState(req.playerRecord.discordId)));
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/me/characters/switch", requireAuth, async (req, res, next) => {
    try {
      const data = await service.switchCharacter(req.playerRecord.discordId, req.body?.slot);
      return res.json(ok(data, data.created ? `已建立並切換到角色 ${data.activeSlot}` : `已切換到角色 ${data.activeSlot}`));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = {
  createPlayerCharacterRoutes,
};
