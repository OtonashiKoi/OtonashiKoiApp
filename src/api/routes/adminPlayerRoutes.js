const { Router } = require("express");
const config = require("../../config");
const { AppError, ERROR_CODES } = require("../../shared/errors");
const { ok, fail } = require("../../shared/response");

function createAdminPlayerRoutes(serviceContext) {
  const router = Router();
  const mergeAccessControlForSync = (previous = {}, current = {}) => {
    const p = previous?.discord || {};
    const c = current?.discord || {};
    const union = (a, b) => [...new Set([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])])];
    return {
      discord: {
        adminRoleIds: union(p.adminRoleIds, c.adminRoleIds),
        adminUserIds: union(p.adminUserIds, c.adminUserIds),
        playerRoleIds: union(p.playerRoleIds, c.playerRoleIds),
        playerUserIds: union(p.playerUserIds, c.playerUserIds)
      }
    };
  };

  router.use("/admin", (req, res, next) => {
    // creator-auth 的 HTML 頁本身不需密碼（頁內 API 呼叫另有 requireAdmin 把關）
    // router.use("/admin",...) 內 req.path 相對掛載點，要用 originalUrl 判斷
    if (req.method === "GET" && req.originalUrl.split("?")[0] === "/admin/creator-auth") {
      return next();
    }
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
      const previousAccessControl = await serviceContext.accessControlService.getAccessControl();
      const { adminRoleIds } = req.body;
      const accessControl = await serviceContext.accessControlService.setDiscordRoleIds(adminRoleIds);
      const syncReport = await serviceContext.accessControlService.syncAllowedPlayers();
      const permissionSync = await serviceContext.adminConsoleService.syncChannelPermissions(
        mergeAccessControlForSync(previousAccessControl, accessControl)
      );
      res.json(ok({ accessControl, syncReport, permissionSync }, "discord admin roles updated"));
    } catch (error) {
      next(error);
    }
  });

  router.put("/admin/access-control/discord-users", async (req, res, next) => {
    try {
      const previousAccessControl = await serviceContext.accessControlService.getAccessControl();
      const { adminUserIds } = req.body;
      const accessControl = await serviceContext.accessControlService.setDiscordUserIds(adminUserIds);
      const syncReport = await serviceContext.accessControlService.syncAllowedPlayers();
      const permissionSync = await serviceContext.adminConsoleService.syncChannelPermissions(
        mergeAccessControlForSync(previousAccessControl, accessControl)
      );
      res.json(ok({ accessControl, syncReport, permissionSync }, "discord admin users updated"));
    } catch (error) {
      next(error);
    }
  });

  router.put("/admin/access-control/player-roles", async (req, res, next) => {
    try {
      const previousAccessControl = await serviceContext.accessControlService.getAccessControl();
      const { playerRoleIds } = req.body;
      const accessControl = await serviceContext.accessControlService.setDiscordPlayerRoleIds(playerRoleIds);
      const syncReport = await serviceContext.accessControlService.syncAllowedPlayers();
      const permissionSync = await serviceContext.adminConsoleService.syncChannelPermissions(
        mergeAccessControlForSync(previousAccessControl, accessControl)
      );
      res.json(ok({ accessControl, syncReport, permissionSync }, "discord player roles updated"));
    } catch (error) {
      next(error);
    }
  });

  router.put("/admin/access-control/player-users", async (req, res, next) => {
    try {
      const previousAccessControl = await serviceContext.accessControlService.getAccessControl();
      const { playerUserIds } = req.body;
      const accessControl = await serviceContext.accessControlService.setDiscordPlayerUserIds(playerUserIds);
      const syncReport = await serviceContext.accessControlService.syncAllowedPlayers();
      const permissionSync = await serviceContext.adminConsoleService.syncChannelPermissions(
        mergeAccessControlForSync(previousAccessControl, accessControl)
      );
      res.json(ok({ accessControl, syncReport, permissionSync }, "discord player users updated"));
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

  router.post("/admin/players/:discordId/allocate-attribute", async (req, res, next) => {
    try {
      const { attribute, amount = 1 } = req.body;
      const result = await serviceContext.progressService.allocateAttribute({
        discordId: req.params.discordId,
        attribute,
        amount
      });
      res.json(ok(result, "attribute allocated"));
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

  // ── 網頁玩家管控:強制登出 / 強制重整 / 封鎖 / 解封 ──
  const webBanStore = require("../../services/access/webBanStore");
  const emitToPlayer = (discordId, type, reason) => {
    try {
      const { playerEventBus } = require("../../services/realtime/playerEventBus");
      playerEventBus.emit(String(discordId), { type, data: { reason: reason || "admin_action", ts: new Date().toISOString() } });
    } catch (_) { /* 推播失敗不影響後續 */ }
  };

  // 強制該玩家網頁登出(清 token 跳登入頁)
  router.post("/admin/players/:discordId/force-logout", (req, res, next) => {
    try {
      emitToPlayer(req.params.discordId, "force_logout", req.body?.reason);
      res.json(ok({ discordId: req.params.discordId }, "force logout sent"));
    } catch (error) { next(error); }
  });

  // 強制該玩家網頁重新整理
  router.post("/admin/players/:discordId/force-reload", (req, res, next) => {
    try {
      emitToPlayer(req.params.discordId, "force_reload", req.body?.reason);
      res.json(ok({ discordId: req.params.discordId }, "force reload sent"));
    } catch (error) { next(error); }
  });

  // 封鎖玩家網頁使用權(同時強制登出其現有連線)
  router.post("/admin/players/:discordId/block-web", async (req, res, next) => {
    try {
      const ids = await webBanStore.block(req.params.discordId);
      emitToPlayer(req.params.discordId, "force_logout", "web_blocked");
      res.json(ok({ blocked: ids }, "player blocked from web"));
    } catch (error) { next(error); }
  });

  // 解除封鎖
  router.post("/admin/players/:discordId/unblock-web", async (req, res, next) => {
    try {
      const ids = await webBanStore.unblock(req.params.discordId);
      res.json(ok({ blocked: ids }, "player unblocked from web"));
    } catch (error) { next(error); }
  });

  // 重啟/熱更新前預告:對在線玩家彈「即將短暫斷線」輕量提示(數秒後自動消失)
  router.post("/admin/broadcast/maintenance", (req, res, next) => {
    try {
      const message = String(req.body?.message || "").trim();
      const seconds = Number(req.body?.seconds) || 0;
      const count = typeof serviceContext._broadcastMaintenance === "function"
        ? serviceContext._broadcastMaintenance(message, seconds)
        : 0;
      res.json(ok({ notified: count }, "maintenance notice sent"));
    } catch (error) { next(error); }
  });

  // 開/關服排程設定（讀）：openAt(未到=尚未開服)、activateAt(到了=賽季結束)、目前 phase
  router.get("/admin/maintenance/config", async (req, res, next) => {
    try {
      const maintenance = require("../../services/access/maintenanceStore");
      await maintenance.ensureLoaded();
      res.json(ok(maintenance.getRawState(), "maintenance config"));
    } catch (error) { next(error); }
  });
  // 開/關服排程設定（寫）：body 可帶 enabled/openAt/activateAt/title/message/openTitle/openMessage/whitelist
  router.post("/admin/maintenance/config", async (req, res, next) => {
    try {
      const maintenance = require("../../services/access/maintenanceStore");
      const saved = await maintenance.setState(req.body || {});
      res.json(ok(saved, "maintenance config saved"));
    } catch (error) { next(error); }
  });

  // 全體公告 + 重整/熱更新提示
  //   body.mode = "force"  → 立即強制重整(不問玩家)
  //   body.mode = "prompt" → 彈出「有更新,請重整/重登」視窗,玩家自己按(預設)
  //   body.message         → 同步發到聊天大廳的公告(可空)
  router.post("/admin/broadcast/announce-and-reload", async (req, res, next) => {
    try {
      const message = String(req.body?.message || "").trim();
      const mode = req.body?.mode === "force" ? "force" : "prompt";
      const promptMessage = String(req.body?.promptMessage || "").trim();
      if (message && typeof serviceContext._announceTownChat === "function") {
        await serviceContext._announceTownChat(message);
      }
      const count = typeof serviceContext._broadcastForceReload === "function"
        ? serviceContext._broadcastForceReload("admin_announce_reload", mode, promptMessage)
        : 0;
      res.json(ok({ notified: count, mode, announced: !!message }, "broadcast done"));
    } catch (error) { next(error); }
  });

  // 公會自訂 emoji 清單(給公告編輯器插入用),回傳 Discord 插入碼 <:name:id>
  router.get("/admin/guild-emojis", async (_req, res, next) => {
    try {
      const guildId = config.discord?.guildId;
      const client = require("../../bot/runtimeContext").getBotClient();
      if (!guildId || !client) return res.json(ok({ emojis: [] }));
      const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
      if (!guild) return res.json(ok({ emojis: [] }));
      const fetched = await guild.emojis.fetch().catch(() => guild.emojis.cache);
      const emojis = [...fetched.values()].map((e) => ({
        name: e.name, id: e.id, animated: !!e.animated,
        url: `https://cdn.discordapp.com/emojis/${e.id}.${e.animated ? "gif" : "png"}`,
        code: e.animated ? `<a:${e.name}:${e.id}>` : `<:${e.name}:${e.id}>`
      }));
      res.json(ok({ emojis }));
    } catch (error) { next(error); }
  });

  // ── 公告管理 ──
  router.get("/admin/announcements", async (_req, res, next) => {
    try {
      const svc = require("../../services/announcement/announcementService");
      res.json(ok({ announcements: await svc.listAll() }));
    } catch (error) { next(error); }
  });
  router.post("/admin/announcements", async (req, res, next) => {
    try {
      const svc = require("../../services/announcement/announcementService");
      const a = await svc.create({
        title: req.body?.title, body: req.body?.body,
        imageUrl: req.body?.imageUrl, enabled: req.body?.enabled, pinned: req.body?.pinned
      });
      res.json(ok(a, "announcement created"));
    } catch (error) { next(error); }
  });
  router.patch("/admin/announcements/:id", async (req, res, next) => {
    try {
      const svc = require("../../services/announcement/announcementService");
      res.json(ok(await svc.update(req.params.id, req.body || {}), "announcement updated"));
    } catch (error) { next(error); }
  });
  router.delete("/admin/announcements/:id", async (req, res, next) => {
    try {
      const svc = require("../../services/announcement/announcementService");
      res.json(ok(await svc.remove(req.params.id), "announcement removed"));
    } catch (error) { next(error); }
  });

  // ── 綠界斗內：對帳 / 補發 ──
  // 列出最近的綠界收單（含未對應到玩家的 unbound、驗簽失敗 mac_failed 等）
  router.get("/admin/ecpay/donations", async (req, res, next) => {
    try {
      const { getMongoDb } = require("../../adapters/mongo/createMongoClient");
      const db = await getMongoDb();
      const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
      const status = req.query.status ? { status: String(req.query.status) } : {};
      const donations = await db.collection("ecpayDonations")
        .find(status).sort({ receivedAt: -1 }).limit(limit).toArray();
      res.json(ok({ donations }, "ecpay donations"));
    } catch (error) { next(error); }
  });

  // 人工指派某筆收單給玩家並補發（給留言沒填/填錯碼的情況）
  router.post("/admin/ecpay/donations/:tradeNo/assign", async (req, res, next) => {
    try {
      const tradeNo = String(req.params.tradeNo || "");
      const discordId = String(req.body?.discordId || "").trim();
      if (!discordId) return res.status(400).json(fail("INVALID_ARGUMENT", "請提供 discordId"));
      const { getMongoDb } = require("../../adapters/mongo/createMongoClient");
      const { settleForPlayer } = require("../../services/payment/ecpayDonationService");
      const db = await getMongoDb();
      const rec = await db.collection("ecpayDonations").findOne({ tradeNo });
      if (!rec) return res.status(404).json(fail("NOT_FOUND", "找不到這筆收單"));
      if (rec.status === "granted") return res.status(400).json(fail("ALREADY_GRANTED", "這筆已發放過"));
      const player = await serviceContext.progressRepository.findByPlayerId(discordId);
      const r = await settleForPlayer({
        discordId,
        displayName: player?.displayName || rec.patronName || "斗內者",
        twdAmount: Number(rec.twdAmount) || 0,
        sourceRef: `ecpay:${tradeNo}`
      }, serviceContext);
      await db.collection("ecpayDonations").updateOne(
        { tradeNo },
        { $set: { status: "granted", reason: "manual-assign", matchedDiscordId: discordId, diamondsGranted: r.diamonds || 0, processedAt: new Date().toISOString() } }
      );
      res.json(ok({ granted: r.diamonds || 0, duplicated: r.duplicated || false }, "assigned"));
    } catch (error) { next(error); }
  });

  // 目前封鎖名單
  router.get("/admin/web-bans", async (_req, res, next) => {
    try {
      const ids = await webBanStore.list();
      res.json(ok({ blocked: ids }, "web bans fetched"));
    } catch (error) { next(error); }
  });

  // 回歸賽季重製(固定工具):只留鑽石/稱號/收藏,其餘全部重置;會先寫一份備份到 backups/
  router.post("/admin/players/:discordId/season-reset", async (req, res, next) => {
    try {
      const id = req.params.discordId;
      const { seasonResetPlayer, buildSeasonResetBackup } = require("../../services/admin/seasonResetService");
      try {
        const fs = require("fs");
        const path = require("path");
        const dir = path.resolve(__dirname, "../../../backups");
        fs.mkdirSync(dir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const backup = await buildSeasonResetBackup(id);
        fs.writeFileSync(path.join(dir, `season-reset-${id}-${stamp}.json`), JSON.stringify(backup));
      } catch (e) {
        return res.status(500).json(fail("BACKUP_FAILED", `備份失敗,已中止重製:${e.message}`));
      }
      const summary = await seasonResetPlayer(id, { dryRun: false });
      res.json(ok(summary, "season reset done"));
    } catch (error) { next(error); }
  });

  // 回歸賽季重製預覽(dry run,不寫入)
  router.get("/admin/players/:discordId/season-reset/preview", async (req, res, next) => {
    try {
      const { seasonResetPlayer } = require("../../services/admin/seasonResetService");
      const summary = await seasonResetPlayer(req.params.discordId, { dryRun: true });
      res.json(ok(summary, "season reset preview"));
    } catch (error) { next(error); }
  });

  // 全體回歸賽季重製預覽:回傳會被重製的玩家總數
  router.get("/admin/season-reset-all/preview", async (_req, res, next) => {
    try {
      const { seasonResetAllPlayers } = require("../../services/admin/seasonResetService");
      const summary = await seasonResetAllPlayers({ dryRun: true });
      res.json(ok(summary, "season reset all preview"));
    } catch (error) { next(error); }
  });

  // 全體回歸賽季重製(高破壞性):需在 body 帶 confirm:"RESET-ALL";先寫一份全體備份才執行
  router.post("/admin/season-reset-all", async (req, res, next) => {
    try {
      if (String(req.body?.confirm || "") !== "RESET-ALL") {
        return res.status(400).json(fail("CONFIRM_REQUIRED", '需要 confirm:"RESET-ALL" 才能執行全體重製'));
      }
      const { seasonResetAllPlayers } = require("../../services/admin/seasonResetService");
      const summary = await seasonResetAllPlayers({
        dryRun: false,
        monsterService: serviceContext.monsterService,
        onBackup: async (allBackups) => {
          const fs = require("fs");
          const path = require("path");
          const dir = path.resolve(__dirname, "../../../backups");
          fs.mkdirSync(dir, { recursive: true });
          const stamp = new Date().toISOString().replace(/[:.]/g, "-");
          fs.writeFileSync(path.join(dir, `season-reset-ALL-${stamp}.json`),
            JSON.stringify({ kind: "season-reset-all-backup", at: new Date().toISOString(), count: allBackups.length, players: allBackups }));
        }
      });
      res.json(ok(summary, "season reset all done"));
    } catch (error) { next(error); }
  });

  // 目前正在用網頁(SSE 在線)的玩家,附帶封鎖狀態
  router.get("/admin/web-online", async (_req, res, next) => {
    try {
      const webPresence = require("../../services/realtime/webPresence");
      const blocked = new Set(await webBanStore.list());
      const players = webPresence.list().map((p) => ({ ...p, blocked: blocked.has(p.discordId) }));
      res.json(ok({ players }, "online web players"));
    } catch (error) { next(error); }
  });

  return router;
}

module.exports = {
  createAdminPlayerRoutes
};
