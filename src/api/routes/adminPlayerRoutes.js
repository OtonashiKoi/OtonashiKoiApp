const { Router } = require("express");
const config = require("../../config");
const { AppError, ERROR_CODES } = require("../../shared/errors");
const { ok, fail } = require("../../shared/response");

function createAdminPlayerRoutes(serviceContext) {
  const router = Router();

  router.use((req, res, next) => {
    const authHeader = req.header("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");

    if (token !== config.api.adminPassword) {
      res.status(401).json(fail("ADMIN_UNAUTHORIZED", "Invalid admin password."));
      return;
    }

    next();
  });

  router.get("/admin/players/:discordId/wallet", async (req, res, next) => {
    try {
      const displayName = req.query.displayName || "unknown";
      const result = await serviceContext.walletService.getWalletByDiscordId(
        req.params.discordId,
        displayName
      );

      res.json(ok(result, "wallet fetched"));
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/access-control", async (_req, res, next) => {
    try {
      const result = await serviceContext.accessControlService.getAccessControl();
      res.json(ok(result, "access control fetched"));
    } catch (error) {
      next(error);
    }
  });

  router.put("/admin/access-control/discord-roles", async (req, res, next) => {
    try {
      const { adminRoleIds } = req.body;
      const result = await serviceContext.accessControlService.setDiscordRoleIds(adminRoleIds);
      res.json(ok(result, "discord admin roles updated"));
    } catch (error) {
      next(error);
    }
  });

  router.put("/admin/access-control/discord-users", async (req, res, next) => {
    try {
      const { adminUserIds } = req.body;
      const result = await serviceContext.accessControlService.setDiscordUserIds(adminUserIds);
      res.json(ok(result, "discord admin users updated"));
    } catch (error) {
      next(error);
    }
  });

  router.put("/admin/access-control/player-roles", async (req, res, next) => {
    try {
      const { playerRoleIds } = req.body;
      const result = await serviceContext.accessControlService.setDiscordPlayerRoleIds(playerRoleIds);
      res.json(ok(result, "discord player roles updated"));
    } catch (error) {
      next(error);
    }
  });

  router.put("/admin/access-control/player-users", async (req, res, next) => {
    try {
      const { playerUserIds } = req.body;
      const result = await serviceContext.accessControlService.setDiscordPlayerUserIds(playerUserIds);
      res.json(ok(result, "discord player users updated"));
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/players/:discordId/profile", async (req, res, next) => {
    try {
      const displayName = req.query.displayName || "unknown";
      const result = await serviceContext.playerService.getProfile(req.params.discordId, displayName);
      res.json(ok(result, "profile fetched"));
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/players/:discordId/transactions", async (req, res, next) => {
    try {
      const displayName = req.query.displayName || "unknown";
      const limit = Number(req.query.limit || 10);
      if (!Number.isFinite(limit) || limit <= 0) {
        throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "limit must be a positive number", 400);
      }
      const result = await serviceContext.transactionService.listRecentByDiscordId(
        req.params.discordId,
        displayName,
        limit
      );
      res.json(ok(result, "transactions fetched"));
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/players/:discordId/grant", async (req, res, next) => {
    try {
      const { displayName = "unknown", currencyType, amount, reason = "admin api grant", adminId = "api" } = req.body;
      const numericAmount = Number(amount);
      if (!Number.isInteger(numericAmount) || numericAmount === 0) {
        throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "amount must be a non-zero integer", 400);
      }

      const result = await serviceContext.adminService.grantCurrencyByAdmin({
        adminId,
        targetDiscordId: req.params.discordId,
        displayName,
        currencyType,
        amount: numericAmount,
        reason
      });
      res.json(ok(result, "grant completed"));
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/players/:discordId/grant-exp", async (req, res, next) => {
    try {
      const { displayName = "unknown", amount, reason = "admin api exp grant", adminId = "api" } = req.body;
      const numericAmount = Number(amount);
      if (!Number.isInteger(numericAmount) || numericAmount <= 0) {
        throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "amount must be a positive integer", 400);
      }

      const result = await serviceContext.adminService.grantExpByAdmin({
        adminId,
        targetDiscordId: req.params.discordId,
        displayName,
        amount: numericAmount,
        reason
      });
      res.json(ok(result, "exp grant completed"));
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/audit-logs", async (req, res, next) => {
    try {
      const limit = Number(req.query.limit || 20);
      if (!Number.isFinite(limit) || limit <= 0) {
        throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "limit must be a positive number", 400);
      }
      const result = await serviceContext.adminService.listRecentAuditLogs(limit);
      res.json(ok(result, "audit logs fetched"));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = {
  createAdminPlayerRoutes
};