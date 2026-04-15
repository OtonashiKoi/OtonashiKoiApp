const { Router } = require("express");
const multer = require("multer");
const os = require("os");
const fs = require("fs");
const path = require("path");
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

// Template ID prefixes for identifying template events
const TEMPLATE_PREFIXES = ["job_", "merchant_", "encounter_", "villager_", "warrior_"];

function isTemplateEvent(eventId) {
  return TEMPLATE_PREFIXES.some((prefix) => eventId.startsWith(prefix));
}

async function loadTemplatesFromFiles() {
  const templatesDir = path.resolve(__dirname, "../../..", "scripts", "npc-templates-clean");
  const templates = [];

  if (!fs.existsSync(templatesDir)) {
    throw new Error(`Templates directory not found: ${templatesDir}`);
  }

  const files = fs.readdirSync(templatesDir).filter((f) => f.endsWith(".json"));

  for (const file of files) {
    try {
      const filePath = path.join(templatesDir, file);
      const content = fs.readFileSync(filePath, "utf8");
      const template = JSON.parse(content);
      templates.push(template);
    } catch (error) {
      throw new Error(`Failed to parse ${file}: ${error.message}`);
    }
  }

  return templates;
}

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

  router.post("/admin/monster-events/reload-templates", async (req, res, next) => {
    try {
      // Load all templates from JSON files
      const templates = await loadTemplatesFromFiles();

      // Get all existing events
      const allEvents = await serviceContext.monsterEventService.listEvents({ includeDisabled: true });

      // Delete existing template events
      const templateEvents = allEvents.filter((event) => isTemplateEvent(event.id));
      for (const event of templateEvents) {
        await serviceContext.monsterEventService.deleteEvent(event.id);
      }

      // Create new events from templates
      const created = [];
      for (const template of templates) {
        try {
          const event = await serviceContext.monsterEventService.createEvent(template);
          created.push({ id: template.id, eventId: event.id });
        } catch (error) {
          console.error(`Failed to create template ${template.id}:`, error.message);
        }
      }

      res.json(
        ok(
          {
            deletedCount: templateEvents.length,
            createdCount: created.length,
            created
          },
          `templates reloaded: deleted ${templateEvents.length}, created ${created.length}`
        )
      );
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = { createAdminMonsterEventRoutes };
