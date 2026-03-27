const path = require("path");
const { Router } = require("express");
const config = require("../../config");
const { fail, ok } = require("../../shared/response");

function createAdminConsoleRoutes(serviceContext) {
  const router = Router();

  router.get("/admin", (_req, res) => {
    res.sendFile(path.resolve(__dirname, "../../web/public/admin.html"));
  });

  router.use("/admin", (req, res, next) => {
    const authHeader = req.header("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");

    if (token !== config.api.adminPassword) {
      res.status(401).json(fail("ADMIN_UNAUTHORIZED", "Invalid admin password."));
      return;
    }

    next();
  });

  router.get("/admin/console/bootstrap", async (_req, res, next) => {
    try {
      const [accessControl, channelLayout, channels, roles] = await Promise.all([
        serviceContext.accessControlService.getAccessControl(),
        serviceContext.adminConsoleService.getChannelLayout(),
        serviceContext.adminConsoleService.listDiscordChannels(),
        serviceContext.adminConsoleService.listDiscordRoles()
      ]);

      res.json(
        ok(
          {
            accessControl,
            channelLayout,
            discord: {
              channels,
              roles
            }
          },
          "admin console bootstrap fetched"
        )
      );
    } catch (error) {
      next(error);
    }
  });

  router.put("/admin/channel-layout", async (req, res, next) => {
    try {
      const { bindings } = req.body;
      const result = await serviceContext.adminConsoleService.setChannelLayout(bindings);
      res.json(ok(result, "channel layout updated"));
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/channel-layout/publish-player-panel", async (req, res, next) => {
    try {
      const { channelId } = req.body;
      const result = await serviceContext.adminConsoleService.publishPlayerPanel(channelId);
      res.json(ok(result, "player panel published"));
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/channel-layout/publish-player-query", async (req, res, next) => {
    try {
      const { channelId } = req.body;
      const result = await serviceContext.adminConsoleService.publishPlayerQueryPanel(channelId);
      res.json(ok(result, "player query panel published"));
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/console/players", async (req, res, next) => {
    try {
      const limit = req.query.limit ? Number(req.query.limit) : 50;
      const players = await serviceContext.adminConsoleService.listAllPlayers(limit);
      res.json(ok(players, "players fetched"));
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/console/players/:discordId", async (req, res, next) => {
    try {
      const { discordId } = req.params;
      const playerInfo = await serviceContext.adminConsoleService.getPlayerQueryInfo(discordId);
      res.json(ok(playerInfo, "player info fetched"));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = {
  createAdminConsoleRoutes
};