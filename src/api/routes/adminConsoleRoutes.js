const path = require("path");
const { Router } = require("express");
const multer = require("multer");
const os = require("os");
const config = require("../../config");
const { fail, ok } = require("../../shared/response");
const { uploadImage } = require("../../shared/cloudinaryUpload");
const { addEnhanceGemToInventory } = require("../../shared/inventoryStacking");
const { featureKeyToZone } = require("../../shared/zones");
const { isWorldBossZone } = require("../../services/worldBoss/worldBossService");

// Upload image to temp directory first, then hand over to Cloudinary helper.
const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed."));
    }
    cb(null, true);
  }
});

function createAdminConsoleRoutes(serviceContext) {
  const router = Router();

  router.get("/admin", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.sendFile(path.resolve(__dirname, "../../web/public/admin.html"));
  });

  router.use("/admin", (req, res, next) => {
    // creator-auth 的 HTML 頁本身不需密碼（頁內 API 呼叫另有 requireAdmin 把關）；
    // 否則瀏覽器直接開頁會被這道守衛擋成 JSON 401，看不到輸入框。
    // 注意：router.use("/admin",...) 內 req.path 是相對掛載點的，要用 originalUrl 判斷
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
      const accessControl = await serviceContext.accessControlService.getAccessControl();
      const syncReport = await serviceContext.adminConsoleService.syncChannelPermissions(accessControl);
      res.json(ok({ channelLayout: result, syncReport }, "channel layout updated"));
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/channel-layout/publish-player-panel", async (req, res, next) => {
    try {
      const { channelId } = req.body;
      const result = await serviceContext.adminConsoleService.publishPlayerPanel(channelId, { cleanChannel: true });
      res.json(ok(result, "player panel published"));
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/channel-layout/publish-player-query", async (req, res, next) => {
    try {
      const { channelId } = req.body;
      const result = await serviceContext.adminConsoleService.publishPlayerQueryPanel(channelId, { cleanChannel: true });
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

  // Shop item administration.
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
      const { itemLibraryId, price, currency, stock, enabled, isSale, allowedTiers, maxPerMonth, maxPerDay, claimLimit } = req.body;
      const item = await serviceContext.shopService.createItem({ itemLibraryId, price, currency, stock, enabled, isSale, allowedTiers, maxPerMonth, maxPerDay, claimLimit });
      res.json(ok(item, "shop item created"));
    } catch (error) {
      next(error);
    }
  });

  router.put("/admin/shop/items/:id", async (req, res, next) => {
    try {
      const { itemLibraryId, price, currency, stock, enabled, isSale, allowedTiers, maxPerMonth, maxPerDay, claimLimit, imageUrl, imageThumbnailUrl, weaponType, isTwoHanded } = req.body;
      const item = await serviceContext.shopService.updateItem(req.params.id, { itemLibraryId, price, currency, stock, enabled, isSale, allowedTiers, maxPerMonth, maxPerDay, claimLimit, imageUrl, imageThumbnailUrl, weaponType, isTwoHanded });
      res.json(ok(item, "shop item updated"));
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/shop/claims", async (_req, res, next) => {
    try {
      const claims = (await serviceContext.shopClaimRepository.listRecent(200))
        .filter((claim) => claim.claimLimit === "once_per_player");
      const players = await serviceContext.playerRepository.listAll().catch(() => []);
      const playerMap = new Map(players.map((p) => [p.discordId, p]));
      const enriched = claims.map((claim) => {
        const player = playerMap.get(claim.discordId || claim.playerId) || null;
        return {
          ...claim,
          playerDisplayName: player?.displayName || claim.playerId || claim.discordId || "",
          boundDiscordId: claim.discordId || claim.playerId || "",
          boundYouTubeId: player?.externalIds?.youtube || "",
          boundTwitchId: player?.externalIds?.twitch || "",
          youtubeLinkedAt: player?.externalIdLinkedAt?.youtube || "",
          twitchLinkedAt: player?.externalIdLinkedAt?.twitch || "",
          playerUpdatedAt: player?.updatedAt || ""
        };
      });
      res.json(ok(enriched, "shop claims fetched"));
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
      const result = await serviceContext.adminConsoleService.publishCoinShopPanel(channelId, { cleanChannel: true });
      res.json(ok(result, "coin shop panel published"));
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/channel-layout/publish-monster-zone", async (req, res, next) => {
    try {
      const { channelId } = req.body;
      // Derive zone from binding key using shared zones module.
      const layout = await serviceContext.adminConsoleService.getChannelLayout();
      const bindings = layout?.discord?.bindings || [];
      const binding = bindings.find((b) => b.channelId === channelId && b.featureKey?.startsWith("monster_zone"));
      const zone = featureKeyToZone(binding?.featureKey);
      let state = await serviceContext.monsterService.getState(zone);
      const monsters = await serviceContext.monsterService.listMonsters({ includeDisabled: true, zone });
      let activeMonster = monsters.find((m) => m.seq === state.activeMonsterSeq);
      if (!activeMonster && monsters.length > 0) {
        // Repair stale activeMonsterSeq if it no longer exists in this zone.
        activeMonster = monsters[0];
        const correctedHp = activeMonster.calc.maxHp;
        await serviceContext.monsterService.saveState(
          { ...state, activeMonsterSeq: activeMonster.seq, currentHp: correctedHp, participants: [], damageMap: {} },
          zone
        );
        state = { ...state, activeMonsterSeq: activeMonster.seq, currentHp: correctedHp };
      }
      const currentHp = state.currentHp != null ? state.currentHp : (activeMonster?.calc?.maxHp ?? null);
      const participantCount = Array.isArray(state.participants) ? state.participants.length : 0;
      const result = await serviceContext.adminConsoleService.publishMonsterZonePanel(channelId, activeMonster, currentHp, {
        participantCount,
        damageMap: state.damageMap || {},
        worldBossPartsHp: isWorldBossZone(zone) ? (state.worldBossPartsHp || null) : null,
        cleanChannel: true
      });
      res.json(ok(result, "monster zone panel published"));
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/channel-layout/publish-weekly-quest", async (req, res, next) => {
    try {
      const { channelId } = req.body;
      const result = await serviceContext.adminConsoleService.publishWeeklyQuestPanel(channelId, { cleanChannel: true });
      res.json(ok(result, "weekly quest panel published"));
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/channel-layout/publish-daily-quest", async (req, res, next) => {
    try {
      const { channelId } = req.body;
      const result = await serviceContext.adminConsoleService.publishDailyQuestPanel(channelId, { cleanChannel: true });
      res.json(ok(result, "daily quest panel published"));
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/channel-layout/publish-idle-zone", async (req, res, next) => {
    try {
      const { channelId } = req.body;
      const result = await serviceContext.adminConsoleService.publishIdleZonePanel(channelId, { cleanChannel: true });
      res.json(ok(result, "idle zone panel published"));
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/channel-layout/publish-pet-panel", async (req, res, next) => {
    try {
      const { channelId } = req.body;
      const result = await serviceContext.adminConsoleService.publishPetPanel(channelId, { cleanChannel: true });
      res.json(ok(result, "pet panel published"));
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/channel-layout/publish-casino", async (req, res, next) => {
    try {
      const { channelId } = req.body;
      if (!channelId) return res.status(400).json(fail("MISSING_CHANNEL", "請提供 channelId"));
      const result = await serviceContext.adminConsoleService.publishCasinoPanel(channelId, { cleanChannel: true });
      res.json(ok(result, "casino panel published"));
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/casino/enabled", async (req, res, next) => {
    try {
      const enabled = req.body?.enabled !== false && req.body?.enabled !== "false" && Boolean(req.body?.enabled);
      const result = await serviceContext.adminConsoleService.setCasinoEnabled(enabled);
      res.json(ok(result, `casino ${enabled ? "enabled" : "disabled"}`));
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/casino/status", async (req, res, next) => {
    try {
      const repo = serviceContext.casinoRepository;
      const state = await repo.getState();
      const daily = await repo.getDailyStats();
      res.json(ok({
        enabled: (await serviceContext.channelLayoutRepository.get())
          ?.discord?.bindings?.find((b) => b.featureKey === "casino_wheel")?.enabled !== false,
        currentRound: state?.currentRound || null,
        recentResults: state?.recentResults || [],
        lastRoundId: state?.lastRoundId || 0,
        daily,
      }, "casino status"));
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/channel-layout/publish-pk-arena", async (req, res, next) => {
    try {
      const { channelId } = req.body;
      if (!channelId) return res.status(400).json(fail("MISSING_CHANNEL", "請提供 channelId"));
      const { publishPkArenaPanelToChannel } = require("../../bot/handlers/pkArenaHandlers");
      const result = await publishPkArenaPanelToChannel(channelId, { cleanChannel: true });
      res.json(ok(result, "pk arena panel published"));
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/channel-layout/publish-tower-hall", async (req, res, next) => {
    try {
      const { channelId } = req.body;
      if (!channelId) return res.status(400).json(fail("MISSING_CHANNEL", "請提供 channelId"));
      const { publishTowerHallPanelToChannel } = require("../../bot/handlers/towerHandlers");
      const result = await publishTowerHallPanelToChannel(channelId, { cleanChannel: true });
      res.json(ok(result, "tower hall panel published"));
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
      // Refresh player tier from live Discord roles when the bot is available.
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
            // Reload progress after tier sync so the response reflects persisted data.
            playerInfo.progress = await serviceContext.progressRepository
              .findByPlayerId(discordId) || playerInfo.progress;
          }
        }
      } catch { /* ignore Discord lookup failures and keep returning stored data */ }
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
      const [item, progress] = await Promise.all([
        serviceContext.itemService.getItemById(itemId),
        serviceContext.progressRepository.findByPlayerId(discordId)
      ]);
      if (!progress) {
        res.status(404).json(fail("PLAYER_NOT_FOUND", "Player progress not found."));
        return;
      }
      if (!Array.isArray(progress.inventory)) progress.inventory = [];
      const stacked = addEnhanceGemToInventory(progress.inventory, item, 1, {
        source: "admin_grant"
      });
      if (!stacked) {
        progress.inventory.push({
          uuid: require("crypto").randomUUID(),
          itemId: item.id,
          itemName: item.name,
          itemEffect: item.effect || { type: "none", value: 0 },
          useEffects: item.useEffects || [],
          passiveEffects: item.passiveEffects || [],
          procEffects: item.procEffects || [],
          combatEffects: item.combatEffects || [],
          itemType: item.itemType || "consumable",
          imageUrl: item.imageUrl || null,
          imageThumbnailUrl: item.imageThumbnailUrl || null,
          equipSlot: item.equipSlot || null,
          equipStats: item.equipStats || null,
          weaponType: item.weaponType || null,
          isTwoHanded: item.isTwoHanded || false,
          atkStat: item.atkStat || null,
          tier: item.tier || null,
          monsterCardSkill: item.monsterCardSkill || null,
          enhanceLevel: 0,
          source: "admin_grant",
          purchasedAt: new Date().toISOString()
        });
      }
      progress.updatedAt = new Date().toISOString();
      await serviceContext.progressRepository.save(progress);
      res.json(ok({ itemName: item.name }, "item granted"));
    } catch (error) {
      next(error);
    }
  });

  // Item library administration.
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

  // Item image upload
  router.post("/admin/items/:id/image", upload.single("image"), async (req, res, next) => {
    try {
      const startedAt = Date.now();
      console.log(`[AdminItemImage] start id=${req.params.id} file=${req.file?.originalname || "none"}`);
      if (!req.file) {
        res.status(400).json(fail("NO_FILE", "Please select an image file to upload."));
        return;
      }
      const { imageUrl, imageThumbnailUrl } = await uploadImage(req.file.path, "items");
      console.log(`[AdminItemImage] upload done id=${req.params.id} elapsed=${Date.now() - startedAt}ms`);
      const item = await serviceContext.itemService.updateItem(
        req.params.id,
        { imageUrl, imageThumbnailUrl },
        { skipPlayerSync: true }
      );
      console.log(`[AdminItemImage] item saved id=${req.params.id} elapsed=${Date.now() - startedAt}ms`);
      res.json(ok({ imageUrl, imageThumbnailUrl, item }, "image uploaded"));
    } catch (error) {
      console.error(`[AdminItemImage] failed id=${req.params.id}`, error?.message || error);
      next(error);
    }
  });

  // Player tier settings
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

  // Shop item image upload
  router.post("/admin/shop/items/:id/image", upload.single("image"), async (req, res, next) => {
    try {
      const startedAt = Date.now();
      console.log(`[AdminShopItemImage] start id=${req.params.id} file=${req.file?.originalname || "none"}`);
      if (!req.file) {
        res.status(400).json(fail("NO_FILE", "Please select an image file to upload."));
        return;
      }
      const { imageUrl, imageThumbnailUrl } = await uploadImage(req.file.path, "shop_items");
      console.log(`[AdminShopItemImage] upload done id=${req.params.id} elapsed=${Date.now() - startedAt}ms`);
      const item = await serviceContext.shopService.updateItem(req.params.id, { imageUrl, imageThumbnailUrl });
      console.log(`[AdminShopItemImage] item saved id=${req.params.id} elapsed=${Date.now() - startedAt}ms`);
      res.json(ok({ imageUrl, imageThumbnailUrl, item }, "image uploaded"));
    } catch (error) {
      console.error(`[AdminShopItemImage] failed id=${req.params.id}`, error?.message || error);
      next(error);
    }
  });

  router.get("/admin/battle-config", async (_req, res, next) => {
    try {
      const configData = await serviceContext.battleConfigService.getConfig();
      res.json(ok(configData, "battle config fetched"));
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/effect-definitions", async (_req, res, next) => {
    try {
      const definitions = await serviceContext.effectDefinitionService.listDefinitions();
      res.json(ok(definitions, "effect definitions fetched"));
    } catch (error) {
      next(error);
    }
  });

  router.put("/admin/battle-config/weapon-rules", async (req, res, next) => {
    try {
      const rules = req.body?.weaponPositionRules || req.body || {};
      const configData = await serviceContext.battleConfigService.saveWeaponRules(rules);
      res.json(ok(configData, "battle weapon rules saved"));
    } catch (error) {
      next(error);
    }
  });

  router.put("/admin/battle-config/assets/:category", async (req, res, next) => {
    try {
      const { category } = req.params;
      const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];
      const configData = await serviceContext.battleConfigService.saveAssetCategory(category, entries);
      res.json(ok(configData, "battle assets saved"));
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/battle-config/assets/:category/image", upload.single("image"), async (req, res, next) => {
    try {
      if (!req.file) {
        res.status(400).json(fail("NO_FILE", "Image file is required."));
        return;
      }
      const { imageUrl, imageThumbnailUrl } = await uploadImage(req.file.path, "battle_assets");
      res.json(ok({ imageUrl, imageThumbnailUrl }, "battle asset image uploaded"));
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/animation-studio/bootstrap", async (_req, res, next) => {
    try {
      const [animationData, monsters] = await Promise.all([
        serviceContext.battleConfigService.getAnimationStudioData(),
        serviceContext.monsterService.listMonsters({ includeDisabled: true })
      ]);
      res.json(ok({
        templates: animationData.templates || [],
        monsters: monsters || [],
        updatedAt: animationData.updatedAt || null
      }, "animation studio bootstrap fetched"));
    } catch (error) {
      next(error);
    }
  });

  // Effect modules (可重複使用的技能/效果模組)
  router.get("/admin/effect-modules", async (_req, res, next) => {
    try {
      const modules = await serviceContext.battleConfigService.getEffectModules();
      res.json(ok(modules, "effect modules fetched"));
    } catch (error) {
      next(error);
    }
  });

  router.put("/admin/effect-modules", async (req, res, next) => {
    try {
      const modules = Array.isArray(req.body?.modules) ? req.body.modules : [];
      const saved = await serviceContext.battleConfigService.saveEffectModules(modules);
      res.json(ok(saved, "effect modules saved"));
    } catch (error) {
      next(error);
    }
  });

  router.put("/admin/animation-studio/templates", async (req, res, next) => {
    try {
      const templates = Array.isArray(req.body?.templates) ? req.body.templates : [];
      const saved = await serviceContext.battleConfigService.saveAnimationTemplates(templates);
      res.json(ok({ templates: saved }, "animation templates saved"));
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/animation-studio/template-image", upload.single("image"), async (req, res, next) => {
    try {
      if (!req.file) {
        res.status(400).json(fail("NO_FILE", "Image file is required."));
        return;
      }
      const { imageUrl, imageThumbnailUrl } = await uploadImage(req.file.path, "animation_templates");
      res.json(ok({ imageUrl, imageThumbnailUrl }, "animation template image uploaded"));
    } catch (error) {
      next(error);
    }
  });

  // ── 拍賣場管理 ──────────────────────────────────────

  // 取得所有拍賣（支援 status 篩選、分頁）
  router.get("/admin/auction/list", async (req, res, next) => {
    try {
      const { status, page = 0, limit = 30 } = req.query;
      const result = await serviceContext.auctionService.adminGetAll({
        status: status || undefined,
        page: parseInt(page, 10) || 0,
        limit: parseInt(limit, 10) || 30
      });
      res.json(ok(result, "auction list fetched"));
    } catch (error) {
      next(error);
    }
  });

  // 強制下架（退還物品給賣家）
  router.delete("/admin/auction/:id", async (req, res, next) => {
    try {
      const auction = await serviceContext.auctionService.adminForceRemove(req.params.id, "admin");
      const { refreshAuctionChannel } = require("../../bot/handlers/auctionZoneHandlers");
      await refreshAuctionChannel();
      res.json(ok({ id: auction.id }, "auction removed"));
    } catch (error) {
      next(error);
    }
  });

  // 取得拍賣場完整設定
  router.get("/admin/auction/config", async (_req, res, next) => {
    try {
      const settings = await serviceContext.auctionService.getSettings();
      res.json(ok(settings, "auction settings fetched"));
    } catch (error) {
      next(error);
    }
  });

  // 儲存拍賣場完整設定（channelId, enabled, sellerTiers）
  router.put("/admin/auction/config", async (req, res, next) => {
    try {
      const { channelId, enabled, sellerTiers } = req.body;
      // 先取得現有設定，只更新有傳入的欄位
      const current = await serviceContext.auctionService.getSettings();
      const updated = {
        ...current,
        ...(channelId !== undefined && { channelId }),
        ...(enabled !== undefined && { enabled: Boolean(enabled) }),
        ...(Array.isArray(sellerTiers) && { sellerTiers })
      };
      const saved = await serviceContext.auctionService.saveSettings(updated);
      res.json(ok(saved, "auction settings saved"));
    } catch (error) {
      next(error);
    }
  });

  // 在指定頻道發布拍賣場面板
  router.post("/admin/auction/publish", async (req, res, next) => {
    try {
      const { channelId } = req.body;
      if (!channelId) {
        return res.status(400).json(fail("MISSING_CHANNEL", "請提供 channelId"));
      }
      const { refreshAuctionChannel } = require("../../bot/handlers/auctionZoneHandlers");
      await serviceContext.auctionService.saveChannelConfig({ channelId });
      await refreshAuctionChannel();
      res.json(ok({ channelId }, "auction panel published"));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = {
  createAdminConsoleRoutes
};
