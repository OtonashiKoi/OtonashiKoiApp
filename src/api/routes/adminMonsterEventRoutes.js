const { Router } = require("express");
const multer = require("multer");
const os = require("os");
const { ok, fail } = require("../../shared/response");
const { uploadImage } = require("../../shared/cloudinaryUpload");

const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (!file.mimetype.startsWith("image/")) return cb(new Error("Only image file is allowed."));
    cb(null, true);
  }
});

function createAdminMonsterEventRoutes(serviceContext) {
  const router = Router();

  router.use("/admin/monster-events", (req, res, next) => {
    const token = (req.header("Authorization") || "").replace("Bearer ", "");
    const config = require("../../config");
    if (token !== config.api.adminPassword) {
      res.status(401).json(fail("ADMIN_UNAUTHORIZED", "Invalid admin password."));
      return;
    }
    next();
  });

  router.get("/admin/monster-events", async (req, res, next) => {
    try {
      const zone = req.query.zone || null;
      const includeDisabled = String(req.query.includeDisabled || "1") !== "0";
      const events = await serviceContext.monsterEventService.listEvents({ zone, includeDisabled });
      res.json(ok(events, "monster events fetched"));
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/monster-events", async (req, res, next) => {
    try {
      const event = await serviceContext.monsterEventService.createEvent(req.body || {});
      res.json(ok(event, "monster event created"));
    } catch (error) {
      next(error);
    }
  });

  router.put("/admin/monster-events/:id", async (req, res, next) => {
    try {
      const event = await serviceContext.monsterEventService.updateEvent(req.params.id, req.body || {});
      res.json(ok(event, "monster event updated"));
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/monster-events/:id/npc-image", upload.single("image"), async (req, res, next) => {
    try {
      if (!req.file) {
        res.status(400).json(fail("NO_FILE", "No file uploaded."));
        return;
      }
      const { imageUrl, imageThumbnailUrl } = await uploadImage(req.file.path, "npc_events");
      const event = await serviceContext.monsterEventService.updateEventNpcImage(req.params.id, { imageUrl, imageThumbnailUrl });
      res.json(ok({ imageUrl, imageThumbnailUrl, event }, "npc image uploaded"));
    } catch (error) {
      next(error);
    }
  });

  router.delete("/admin/monster-events/:id", async (req, res, next) => {
    try {
      await serviceContext.monsterEventService.deleteEvent(req.params.id);
      res.json(ok(null, "monster event deleted"));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createAdminMonsterEventRoutes };
