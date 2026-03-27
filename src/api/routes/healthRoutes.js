const { Router } = require("express");
const { ok } = require("../../shared/response");

function createHealthRoutes() {
  const router = Router();

  router.get("/health", (_req, res) => {
    res.json(ok({ service: "equipment-game-platform", time: new Date().toISOString() }));
  });

  return router;
}

module.exports = {
  createHealthRoutes
};