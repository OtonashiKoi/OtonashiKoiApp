const path = require("path");
const { Router } = require("express");
const multer = require("multer");
const { ok, fail } = require("../../shared/response");

const upload = multer({
  dest: path.resolve(__dirname, "../../web/public/uploads/monsters"),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (!file.mimetype.startsWith("image/")) return cb(new Error("只允許上傳圖片檔案"));
    cb(null, true);
  }
});

function createAdminMonsterRoutes(serviceContext) {
  const router = Router();

  router.use("/admin/monsters", (req, res, next) => {
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
  router.get("/admin/monsters/state", async (_req, res, next) => {
    try {
      const state = await serviceContext.monsterService.getState();
      const monsters = await serviceContext.monsterService.listMonsters({ includeDisabled: true });
      const active = monsters.find((m) => m.seq === state.activeMonsterSeq) || monsters[0] || null;
      res.json(ok({ state, active }, "monster state fetched"));
    } catch (error) {
      next(error);
    }
  });

  router.put("/admin/monsters/state", async (req, res, next) => {
    try {
      const { activeMonsterSeq } = req.body;
      const current = await serviceContext.monsterService.getState();
      const monsters = await serviceContext.monsterService.listMonsters({ includeDisabled: true });
      const target = monsters.find((m) => m.seq === Number(activeMonsterSeq));
      if (!target) {
        res.status(400).json(fail("INVALID_ARGUMENT", "找不到該序號的怪物"));
        return;
      }
      const newState = { ...current, activeMonsterSeq: target.seq, currentHp: target.calc.maxHp };
      await serviceContext.monsterService.saveState(newState);
      res.json(ok({ state: newState, active: target }, "monster state updated"));
    } catch (error) {
      next(error);
    }
  });

  router.put("/admin/monsters/:id", async (req, res, next) => {
    try {
      const monster = await serviceContext.monsterService.updateMonster(req.params.id, req.body);
      res.json(ok(monster, "monster updated"));
    } catch (error) {
      next(error);
    }
  });

  // 怪物區狀態（目前上場怪物、擊殺次數）
  router.get("/admin/monsters/state", async (_req, res, next) => {
    try {
      const state = await serviceContext.monsterService.getState();
      const monsters = await serviceContext.monsterService.listMonsters({ includeDisabled: true });
      const active = monsters.find((m) => m.seq === state.activeMonsterSeq) || monsters[0] || null;
      res.json(ok({ state, active }, "monster state fetched"));
    } catch (error) {
      next(error);
    }
  });

  router.put("/admin/monsters/state", async (req, res, next) => {
    try {
      const { activeMonsterSeq } = req.body;
      const current = await serviceContext.monsterService.getState();
      const monsters = await serviceContext.monsterService.listMonsters({ includeDisabled: true });
      const target = monsters.find((m) => m.seq === Number(activeMonsterSeq));
      if (!target) {
        res.status(400).json(fail("INVALID_ARGUMENT", "找不到該序號的怪物"));
        return;
      }
      const newState = { ...current, activeMonsterSeq: target.seq, currentHp: target.calc.maxHp };
      await serviceContext.monsterService.saveState(newState);
      res.json(ok({ state: newState, active: target }, "monster state updated"));
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
      const fsp = require("fs/promises");
      const sharp = require("sharp");
      const ext = req.file.mimetype === "image/png" ? ".png"
        : req.file.mimetype === "image/gif" ? ".gif"
        : req.file.mimetype === "image/webp" ? ".webp"
        : ".jpg";
      const newName = req.file.filename + ext;
      const newPath = req.file.path + ext;
      await fsp.rename(req.file.path, newPath);
      const imageUrl = `/uploads/monsters/${newName}`;
      const thumbName = req.file.filename + "_thumb.webp";
      const thumbPath = path.resolve(__dirname, "../../web/public/uploads/monsters", thumbName);
      await sharp(newPath)
        .resize({ width: 120, height: 120, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 35 })
        .toFile(thumbPath);
      const imageThumbnailUrl = `/uploads/monsters/${thumbName}`;
      const monster = await serviceContext.monsterService.updateMonster(req.params.id, { imageUrl, imageThumbnailUrl });
      res.json(ok({ imageUrl, imageThumbnailUrl, monster }, "image uploaded"));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createAdminMonsterRoutes };
