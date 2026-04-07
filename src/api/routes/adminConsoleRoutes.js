const path = require("path");
const { Router } = require("express");
const multer = require("multer");
const config = require("../../config");
const { fail, ok } = require("../../shared/response");

// multer 設定：圖片存到 uploads/items/，限制 25MB，只接受圖片
const upload = multer({
  dest: path.resolve(__dirname, "../../web/public/uploads/items"),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("只允許上傳圖片檔案"));
    }
    cb(null, true);
  }
});

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
      const [accessControl, channelLayout, channels, roles, playerTiers] = await Promise.all([
        serviceContext.accessControlService.getAccessControl(),
        serviceContext.adminConsoleService.getChannelLayout(),
        serviceContext.adminConsoleService.listDiscordChannels(),
        serviceContext.adminConsoleService.listDiscordRoles(),
        serviceContext.playerTierService.getTiers()
      ]);

      res.json(
        ok(
          {
            accessControl,
            channelLayout,
            playerTiers,
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

  router.post("/admin/channel-layout/sync-permissions", async (_req, res, next) => {
    try {
      const accessControl = await serviceContext.accessControlService.getAccessControl();
      const result = await serviceContext.adminConsoleService.syncChannelPermissions(accessControl);
      res.json(ok(result, "channel permissions synced"));
    } catch (error) {
      next(error);
    }
  });

  // 金幣商店商品管理
  router.get("/admin/shop/items", async (_req, res, next) => {
    try {
      const items = await serviceContext.shopService.listItems({ includeDisabled: true });
      res.json(ok(items, "shop items fetched"));
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/shop/items", async (req, res, next) => {
    try {
      const item = await serviceContext.shopService.createItem(req.body);
      res.json(ok(item, "shop item created"));
    } catch (error) {
      next(error);
    }
  });

  router.put("/admin/shop/items/:id", async (req, res, next) => {
    try {
      const item = await serviceContext.shopService.updateItem(req.params.id, req.body);
      res.json(ok(item, "shop item updated"));
    } catch (error) {
      next(error);
    }
  });

  router.delete("/admin/shop/items/:id", async (req, res, next) => {
    try {
      await serviceContext.shopService.deleteItem(req.params.id);
      res.json(ok(null, "shop item deleted"));
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/channel-layout/publish-coin-shop", async (req, res, next) => {
    try {
      const { channelId } = req.body;
      const result = await serviceContext.adminConsoleService.publishCoinShopPanel(channelId);
      res.json(ok(result, "coin shop panel published"));
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/channel-layout/publish-monster-zone", async (req, res, next) => {
    try {
      const { channelId } = req.body;
      // 從 binding 推算 zone（monster_zone → normal, monster_zone_mid → mid）
      const layout = await serviceContext.adminConsoleService.getChannelLayout();
      const bindings = layout?.discord?.bindings || [];
      const binding = bindings.find((b) => b.channelId === channelId && b.featureKey?.startsWith("monster_zone"));
      const zone = (binding?.featureKey === "monster_zone_mid") ? "mid" : "normal";
      const state = await serviceContext.monsterService.getState(zone);
      const monsters = await serviceContext.monsterService.listMonsters({ includeDisabled: true, zone });
      const activeMonster = monsters.find((m) => m.seq === state.activeMonsterSeq) || monsters[0] || null;
      const currentHp = state.currentHp != null ? state.currentHp : (activeMonster?.calc?.maxHp ?? null);
      const participantCount = Array.isArray(state.participants) ? state.participants.length : 0;
      const result = await serviceContext.adminConsoleService.publishMonsterZonePanel(channelId, activeMonster, currentHp, { participantCount, cleanChannel: true });
      res.json(ok(result, "monster zone panel published"));
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

  router.get("/admin/console/leaderboard", async (req, res, next) => {
    try {
      const limit = req.query.limit ? Number(req.query.limit) : 20;
      const data = await serviceContext.adminConsoleService.getLeaderboard(limit);
      res.json(ok(data, "leaderboard fetched"));
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/console/players/:discordId", async (req, res, next) => {
    try {
      const { discordId } = req.params;
      const playerInfo = await serviceContext.adminConsoleService.getPlayerQueryInfo(discordId);
      // 即時從 Discord 抴取成員身分組並同步等級
      try {
        const { getBotClient } = require("../../bot/runtimeContext");
        const config = require("../../config");
        const client = getBotClient();
        if (client?.isReady() && config.discord.guildId) {
          const guild = await client.guilds.fetch(config.discord.guildId);
          const member = await guild.members.fetch(discordId).catch(() => null);
          if (member) {
            const memberRoleIds = [...member.roles.cache.keys()];
            await serviceContext.shopService.updatePlayerTier(discordId, memberRoleIds);
            // 將更新後的等級寫回回傳資料
            playerInfo.progress = await serviceContext.progressRepository
              .findByPlayerId(discordId) || playerInfo.progress;
          }
        }
      } catch { /* 非關鍵操作，非同步失敗不影響回傳 */ }
      res.json(ok(playerInfo, "player info fetched"));
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/console/players/:discordId/grant-item", async (req, res, next) => {
    try {
      const { discordId } = req.params;
      const { itemId } = req.body;
      if (!itemId) {
        res.status(400).json(fail("INVALID_ARGUMENT", "itemId is required"));
        return;
      }
      const item = await serviceContext.itemService.getItemById(itemId);
      const progress = await serviceContext.progressRepository.findByPlayerId(discordId);
      if (!progress) {
        res.status(404).json(fail("PLAYER_NOT_FOUND", "找不到玩家進度資料"));
        return;
      }
      if (!Array.isArray(progress.inventory)) progress.inventory = [];
      progress.inventory.push({
        uuid: require("crypto").randomUUID(),
        itemId: item.id,
        itemName: item.name,
        itemEffect: item.effect || { type: "none", value: 0 },
        itemType: item.itemType || "consumable",
        imageUrl: item.imageUrl || null,
        imageThumbnailUrl: item.imageThumbnailUrl || null,
        equipSlot: item.equipSlot || null,
        equipStats: item.equipStats || null,
        weaponType: item.weaponType || null,
        isTwoHanded: item.isTwoHanded || false,
        atkStat: item.atkStat || null,
        purchasedAt: new Date().toISOString()
      });
      progress.updatedAt = new Date().toISOString();
      await serviceContext.progressRepository.save(progress);
      res.json(ok({ itemName: item.name }, "item granted"));
    } catch (error) {
      next(error);
    }
  });

  // 道具庫管理
  router.get("/admin/items", async (_req, res, next) => {
    try {
      const items = await serviceContext.itemService.listItems();
      res.json(ok(items, "items fetched"));
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/items", async (req, res, next) => {
    try {
      const item = await serviceContext.itemService.createItem(req.body);
      res.json(ok(item, "item created"));
    } catch (error) {
      next(error);
    }
  });

  router.put("/admin/items/:id", async (req, res, next) => {
    try {
      const item = await serviceContext.itemService.updateItem(req.params.id, req.body);
      res.json(ok(item, "item updated"));
    } catch (error) {
      next(error);
    }
  });

  router.delete("/admin/items/:id", async (req, res, next) => {
    try {
      await serviceContext.itemService.deleteItem(req.params.id);
      res.json(ok(null, "item deleted"));
    } catch (error) {
      next(error);
    }
  });

  // 道具圖片上傳
  router.post("/admin/items/:id/image", upload.single("image"), async (req, res, next) => {
    try {
      if (!req.file) {
        res.status(400).json(fail("NO_FILE", "請選擇要上傳的圖片"));
        return;
      }
      // multer dest 模式存的是無副檔名的 buffer 檔，重新命名加副檔名
      const fsp = require("fs/promises");
      const sharp = require("sharp");
      const ext = req.file.mimetype === "image/png" ? ".png"
        : req.file.mimetype === "image/gif" ? ".gif"
        : req.file.mimetype === "image/webp" ? ".webp"
        : ".jpg";
      const newName = req.file.filename + ext;
      const oldPath = req.file.path;
      const newPath = oldPath + ext;
      await fsp.rename(oldPath, newPath);
      const imageUrl = `/uploads/items/${newName}`;
      // 生成低解析度縮圖（最大 120x120，保持比例，WebP quality 35）
      const thumbName = req.file.filename + "_thumb.webp";
      const thumbPath = path.resolve(__dirname, "../../web/public/uploads/items", thumbName);
      await sharp(newPath)
        .resize({ width: 120, height: 120, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 35 })
        .toFile(thumbPath);
      const imageThumbnailUrl = `/uploads/items/${thumbName}`;
      const item = await serviceContext.itemService.updateItem(req.params.id, { imageUrl, imageThumbnailUrl });
      res.json(ok({ imageUrl, imageThumbnailUrl, item }, "image uploaded"));
    } catch (error) {
      next(error);
    }
  });

  // 玩家等級設定（E~SS）
  router.get("/admin/player-tiers", async (_req, res, next) => {
    try {
      const tiers = await serviceContext.playerTierService.getTiers();
      res.json(ok(tiers, "player tiers fetched"));
    } catch (error) {
      next(error);
    }
  });

  router.put("/admin/player-tiers", async (req, res, next) => {
    try {
      const tiers = await serviceContext.playerTierService.saveTiers(req.body);
      res.json(ok(tiers, "player tiers saved"));
    } catch (error) {
      next(error);
    }
  });

  // 商店商品圖片上傳
  router.post("/admin/shop/items/:id/image", upload.single("image"), async (req, res, next) => {
    try {
      if (!req.file) {
        res.status(400).json(fail("NO_FILE", "請選擇要上傳的圖片"));
        return;
      }
      const fsp = require("fs/promises");
      const sharp = require("sharp");
      const ext = req.file.mimetype === "image/png" ? ".png"
        : req.file.mimetype === "image/gif" ? ".gif"
        : req.file.mimetype === "image/webp" ? ".webp"
        : ".jpg";
      const newName = req.file.filename + ext;
      const newPath = req.file.path + ext;
      await fsp.rename(req.file.path, newPath);
      const imageUrl = `/uploads/items/${newName}`;
      const thumbName = req.file.filename + "_thumb.webp";
      const thumbPath = path.resolve(__dirname, "../../web/public/uploads/items", thumbName);
      await sharp(newPath)
        .resize({ width: 120, height: 120, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 35 })
        .toFile(thumbPath);
      const imageThumbnailUrl = `/uploads/items/${thumbName}`;
      const item = await serviceContext.shopService.updateItem(req.params.id, { imageUrl, imageThumbnailUrl });
      res.json(ok({ imageUrl, imageThumbnailUrl, item }, "image uploaded"));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = {
  createAdminConsoleRoutes
};