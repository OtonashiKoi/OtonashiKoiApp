const { Router } = require("express");
const multer = require("multer");
const os = require("os");
const { ok, fail } = require("../../shared/response");
const { uploadImage } = require("../../shared/cloudinaryUpload");
const { ALL_ZONE_KEYS, zoneToFeatureKey } = require("../../shared/zones");

const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (!file.mimetype.startsWith("image/")) return cb(new Error("只允許上傳圖片檔案"));
    cb(null, true);
  }
});

function createAdminMonsterRoutes(serviceContext) {
  const router = Router();

  router.use("/admin/", (req, res, next) => {
    // creator-auth HTML 頁放行（頁內 API 另有 requireAdmin）；originalUrl 才是完整路徑
    if (req.method === "GET" && req.originalUrl.split("?")[0] === "/admin/creator-auth") {
      return next();
    }
    const token = (req.header("Authorization") || "").replace("Bearer ", "");
    const config = require("../../config");
    if (token !== config.api.adminPassword) {
      res.status(401).json(fail("ADMIN_UNAUTHORIZED", "Invalid admin password."));
      return;
    }
    next();
  });

  router.get("/admin/monsters", async (_req, res, next) => {
    try {
      const monsters = await serviceContext.monsterService.listMonsters({ includeDisabled: true });
      res.json(ok(monsters, "monsters fetched"));
    } catch (error) {
      next(error);
    }
  });

  // 依 zone 取對應世界王 service（找不到 fallback 大史王 default）
  const pickWorldBossService = (zone) => {
    if (zone && typeof serviceContext.worldBossServiceFor === "function") {
      const svc = serviceContext.worldBossServiceFor(zone);
      if (svc) return svc;
    }
    return serviceContext.worldBossService;
  };

  router.get("/admin/world-boss-config", async (req, res, next) => {
    try {
      const svc = pickWorldBossService(req.query.zone);
      const data = await svc.getConfigWithStatus();
      res.json(ok(data, "world boss config fetched"));
    } catch (error) {
      next(error);
    }
  });

  router.put("/admin/world-boss-config", async (req, res, next) => {
    try {
      const body = req.body || {};
      const svc = pickWorldBossService(body.zone || req.query.zone);
      const config = await svc.saveConfig(body);
      const data = await svc.getConfigWithStatus();
      res.json(ok({ config, state: data.state, status: data.status }, "world boss config saved"));
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/monsters", async (req, res, next) => {
    try {
      const monster = await serviceContext.monsterService.createMonster(req.body);
      res.json(ok(monster, "monster created"));
    } catch (error) {
      next(error);
    }
  });

  // 怪物區狀態 — 必須在 /:id 之前，否則 "state" 會被當成 id
  router.get("/admin/monsters/state", async (req, res, next) => {
    try {
      const zone = req.query.zone || "normal";
      const state = await serviceContext.monsterService.getState(zone);
      const monsters = await serviceContext.monsterService.listMonsters({ includeDisabled: true, zone });
      const active = monsters.find((m) => m.seq === state.activeMonsterSeq) || monsters[0] || null;
      res.json(ok({ state, active }, "monster state fetched"));
    } catch (error) {
      next(error);
    }
  });

  router.put("/admin/monsters/state", async (req, res, next) => {
    try {
      const { activeMonsterSeq, zone = "normal" } = req.body;
      const current = await serviceContext.monsterService.getState(zone);
      const monsters = await serviceContext.monsterService.listMonsters({ includeDisabled: true, zone });
      const nextState = { ...current };
      const hasNpcMappings = Array.isArray(req.body.npcMappings);

      if (hasNpcMappings) {
        nextState.npcMappings = req.body.npcMappings.map((entry, index) => ({
          eventId: entry?.eventId || entry?.id || "",
          chance: Math.min(100, Math.max(0, Number(entry?.chance) || 0)),
          triggerMonsterSeq: entry?.triggerMonsterSeq == null || entry?.triggerMonsterSeq === ""
            ? null
            : Number(entry.triggerMonsterSeq),
          order: Number.isFinite(Number(entry?.order)) ? Number(entry.order) : index
        })).filter((entry) => entry.eventId);
      }

      let target = null;
      if (activeMonsterSeq !== undefined && activeMonsterSeq !== null && activeMonsterSeq !== "") {
        target = monsters.find((m) => m.seq === Number(activeMonsterSeq));
        if (!target) {
          if (!hasNpcMappings) {
            res.status(400).json(fail("INVALID_ARGUMENT", "找不到該序號的怪物"));
            return;
          }
          target = null;
        }
        if (target) {
          nextState.activeMonsterSeq = target.seq;
          nextState.currentHp = target.calc.maxHp;
          nextState.participants = [];
          nextState.damageMap = {};
        }
      }

      await serviceContext.monsterService.saveState(nextState, zone);

      // 若手動切換到 BOSS，也發廣播
      if (target?.isBoss) {
        const { _broadcastBossSpawn } = require("../../bot/handlers/monsterZoneHandlers");
        _broadcastBossSpawn(serviceContext, zone, target).catch(() => {});
      }

      const active = target || monsters.find((m) => m.seq === nextState.activeMonsterSeq) || monsters[0] || null;
      res.json(ok({ state: nextState, active }, "monster state updated"));
    } catch (error) {
      next(error);
    }
  });

  router.put("/admin/monsters/:id", async (req, res, next) => {
    try {
      const monster = await serviceContext.monsterService.updateMonster(req.params.id, req.body);
      // 如果被編輯的怪物正在上場，自動重發面板讓 Discord 即時顯示新資料
      for (const zone of ALL_ZONE_KEYS) {
        try {
          const state = await serviceContext.monsterService.getState(zone);
          const monsters = await serviceContext.monsterService.listMonsters({ zone });
          const active = monsters.find((m) => m.seq === state.activeMonsterSeq);
          if (active && active.id === monster.id) {
            const currentHp = state.currentHp != null ? state.currentHp : active.calc.maxHp;
            const featureKey = zoneToFeatureKey(zone);
            const layout = await serviceContext.adminConsoleService.getChannelLayout();
            const binding = (layout?.discord?.bindings || []).find((b) => b.featureKey === featureKey && b.enabled);
            if (binding?.channelId) {
              serviceContext.adminConsoleService.publishMonsterZonePanel(
                binding.channelId, active, currentHp,
                { participantCount: (state.participants || []).length, damageMap: state.damageMap || {} }
              ).catch(() => {});
            }
          }
        } catch (_) {}
      }
      res.json(ok(monster, "monster updated"));
    } catch (error) {
      next(error);
    }
  });

  router.delete("/admin/monsters/:id", async (req, res, next) => {
    try {
      await serviceContext.monsterService.deleteMonster(req.params.id);
      res.json(ok(null, "monster deleted"));
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/monsters/:id/image", upload.single("image"), async (req, res, next) => {
    try {
      if (!req.file) {
        res.status(400).json(fail("NO_FILE", "請選擇要上傳的圖片"));
        return;
      }
      // 統一走 Cloudinary（與舊版一致）；本機 /uploads 版本曾造成圖片不同步
      const { imageUrl, imageThumbnailUrl } = await uploadImage(req.file.path, "monsters");
      const monster = await serviceContext.monsterService.updateMonster(req.params.id, { imageUrl, imageThumbnailUrl });
      const linkedCards = await serviceContext.itemRepository?.findByMonsterCardOf?.(monster.id).catch(() => []);
      if (Array.isArray(linkedCards) && linkedCards.length > 0) {
        const updatedAt = new Date().toISOString();
        await Promise.all(linkedCards.map(async (card) => {
          await serviceContext.itemRepository.save({
            ...card,
            imageUrl,
            imageThumbnailUrl,
            updatedAt
          });
        }));
      }
      res.json(ok({ imageUrl, imageThumbnailUrl, monster }, "image uploaded"));
    } catch (error) {
      next(error);
    }
  });

  // 戰鬥監視：各區域當前在戰鬥中的玩家數（公開，不需要 admin token）
  router.get("/monitor/combat-status", async (_req, res, next) => {
    try {
      const { ALL_ZONE_KEYS } = require("../../shared/zones");
      const { getMongoDb } = require("../../adapters/mongo/createMongoClient");
      const db = await getMongoDb();

      const zones = [];
      let grandTotal = 0;

      for (const zoneKey of ALL_ZONE_KEYS) {
        const stateDoc = await db.collection("monsters").findOne({ _id: `monsterState:${zoneKey}` });
        const state = stateDoc?.value || null;
        const participants = Array.isArray(state?.participants) ? state.participants : [];
        const damageMap = state?.damageMap || {};
        const currentHp = state?.currentHp ?? null;

        // 用 activeMonsterSeq 查怪物名稱和 maxHp
        let monsterName = null;
        let maxHp = null;
        if (state?.activeMonsterSeq != null) {
          const monsterDoc = await db.collection("monsters").findOne(
            { zone: zoneKey, seq: state.activeMonsterSeq, id: { $exists: true } },
            { projection: { name: 1, "calc.maxHp": 1 } }
          );
          if (monsterDoc) {
            monsterName = monsterDoc.name || null;
            maxHp = monsterDoc.calc?.maxHp ?? null;
          }
        }

        // 從 damageMap 取玩家名稱對應。
        // 此端點為公開監視,不外洩原始 Discord ID(只給遮罩後的識別碼當 key)。
        const maskId = (pid) => `u#${String(pid || "").slice(-4)}`;
        const fighters = participants.map(pid => ({
          id: maskId(pid),
          name: damageMap[pid]?.name || maskId(pid),
          damage: damageMap[pid]?.damage || 0
        }));

        grandTotal += participants.length;
        zones.push({
          zoneKey,
          count: participants.length,
          monsterName,
          currentHp,
          maxHp,
          fighters
        });
      }

      res.json(ok({ zones, grandTotal }, "combat status fetched"));
    } catch (error) {
      next(error);
    }
  });

  // 怪物卡片庫 API
  router.get("/admin/monster-cards", async (_req, res, next) => {
    try {
      const { getMongoDb } = require("../../adapters/mongo/createMongoClient");
      const db = await getMongoDb();
      const cards = await db.collection("items").find({
        itemType: 'equipment',
        equipSlot: 'special'
      }).sort({ name: 1 }).toArray();
      res.json(ok(cards, `${cards.length} cards fetched`));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createAdminMonsterRoutes };
