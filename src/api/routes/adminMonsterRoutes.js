const { Router } = require("express");
const multer = require("multer");
const os = require("os");
const { ok, fail } = require("../../shared/response");
const { uploadImage } = require("../../shared/cloudinaryUpload");

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
      for (const zone of ["normal", "mid"]) {
        try {
          const state = await serviceContext.monsterService.getState(zone);
          const monsters = await serviceContext.monsterService.listMonsters({ zone });
          const active = monsters.find((m) => m.seq === state.activeMonsterSeq);
          if (active && active.id === monster.id) {
            const currentHp = state.currentHp != null ? state.currentHp : active.calc.maxHp;
            const featureKey = zone === "mid" ? "monster_zone_mid" : "monster_zone";
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
      const { imageUrl, imageThumbnailUrl } = await uploadImage(req.file.path, "monsters");
      const monster = await serviceContext.monsterService.updateMonster(req.params.id, { imageUrl, imageThumbnailUrl });
      res.json(ok({ imageUrl, imageThumbnailUrl, monster }, "image uploaded"));
    } catch (error) {
      next(error);
    }
  });

  // 怪物卡片庫 API
  router.get("/admin/monster-cards", async (_req, res, next) => {
    try {
      const { getMongoDb } = require("../../adapters/mongo/createMongoClient");
      const db = await getMongoDb();
      const cards = await db.collection("monsterCards").find({}).sort({ zone: 1, level: 1, card_id: 1 }).toArray();
      res.json(ok(cards, `${cards.length} cards fetched`));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createAdminMonsterRoutes };
