"use strict";

const path = require("path");
const { Router } = require("express");

function createAdminStudioRoutes() {
  const router = Router();
  router.get("/studio", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.sendFile(path.resolve(__dirname, "../../web/public/studio.html"));
  });
  return router;
}

module.exports = { createAdminStudioRoutes };
