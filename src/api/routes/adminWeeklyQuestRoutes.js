"use strict";

const { Router } = require("express");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { ok, fail } = require("../../shared/response");
const { CURRENCY_SOURCES, EXP_SOURCES } = require("../../shared/sources");
const { pushBonusWeaponToInventory } = require("../../shared/jobBadgeBonus");

async function grantQuestReward(serviceContext, { discordId, displayName, reward, sourceTag = "quest" }) {
  if (reward.gold > 0) {
    await serviceContext.rewardService.grantCurrency({
      discordId,
      displayName,
      currencyType: "gold",
      amount: reward.gold,
      source: CURRENCY_SOURCES.QUEST_REWARD,
      operator: sourceTag
    });
  }
  if (reward.exp > 0) {
    await serviceContext.progressService.grantExp({
      discordId,
      displayName,
      amount: reward.exp,
      source: EXP_SOURCES.QUEST_REWARD_EXP
    });
  }
  if (reward.diamond > 0) {
    // Legacy compatibility: keep field readable but no longer grant diamond rewards.
  }
  if (reward.rewardItemId) {
    try {
      const item = await serviceContext.itemRepository.findById(reward.rewardItemId);
      if (item) {
        const progress = await serviceContext.progressRepository.findByPlayerId(discordId);
        if (progress) {
          if (!Array.isArray(progress.inventory)) progress.inventory = [];
          const rewardItemType = item.equipSlot === "job_eq" ? "job_badge" : (item.itemType || "consumable");
          const badgeEntry = {
            uuid: crypto.randomUUID(),
            itemId: item.id,
            itemName: item.name,
            itemEffect: item.effect || { type: "none", value: 0 },
            useEffects: item.useEffects || [],
            passiveEffects: item.passiveEffects || [],
            procEffects: item.procEffects || [],
            combatEffects: item.combatEffects || [],
            itemType: rewardItemType,
            imageUrl: item.imageUrl || null,
            imageThumbnailUrl: item.imageThumbnailUrl || null,
            equipSlot: item.equipSlot || null,
            equipStats: item.equipStats || null,
            weaponType: item.weaponType || null,
            isTwoHanded: item.isTwoHanded || false,
            tier: item.tier || null,
            source: sourceTag,
            obtainedAt: new Date().toISOString()
          };
          progress.inventory.push(badgeEntry);

          // 領取職業徽章時，附送對應職業的 C 階武器
          const bonusWeapon = await pushBonusWeaponToInventory({
            progress,
            itemRepository: serviceContext.itemRepository,
            badge: badgeEntry,
            source: sourceTag + "_job_badge_bonus",
          }).catch((err) => { console.warn("[admin grantQuestReward] bonus weapon grant failed:", err?.message); return null; });
          if (bonusWeapon) {
            reward.bonusWeaponName = bonusWeapon.name;
          }

          progress.updatedAt = new Date().toISOString();
          await serviceContext.progressRepository.save(progress);
        }
        reward.rewardItemName = item.name;
      }
    } catch (_) {
      // ignore item grant fallback errors
    }
  }
}

function createAdminWeeklyQuestRoutes(serviceContext) {
  const router = Router();
  const questService = serviceContext.questService || serviceContext.weeklyQuestService;

  // ── Admin auth ─────────────────────────────────────
  router.use(["/admin/weekly-quests", "/admin/quests"], (req, res, next) => {
    const token = (req.header("Authorization") || "").replace("Bearer ", "");
    const config = require("../../config");
    if (token !== config.api.adminPassword) {
      res.status(401).json(fail("ADMIN_UNAUTHORIZED", "Invalid admin password."));
      return;
    }
    next();
  });

  // ── Admin weekly (legacy) ──────────────────────────
  router.get("/admin/weekly-quests", async (_req, res, next) => {
    try {
      const quests = await questService.listDefinitions("weekly");
      res.json(ok(quests, "quests fetched"));
    } catch (err) {
      next(err);
    }
  });

  router.post("/admin/weekly-quests", async (req, res, next) => {
    try {
      const quest = await questService.createDefinition({ cadence: "weekly", ...req.body });
      res.json(ok(quest, "quest created"));
    } catch (err) {
      next(err);
    }
  });

  router.put("/admin/weekly-quests/:id", async (req, res, next) => {
    try {
      const quest = await questService.updateDefinition(req.params.id, { cadence: "weekly", ...req.body });
      res.json(ok(quest, "quest updated"));
    } catch (err) {
      next(err);
    }
  });

  router.delete("/admin/weekly-quests/:id", async (req, res, next) => {
    try {
      await questService.deleteDefinition(req.params.id);
      res.json(ok(null, "quest deleted"));
    } catch (err) {
      next(err);
    }
  });

  router.get("/admin/weekly-quests/summary", async (req, res, next) => {
    try {
      const weekLabel = req.query.week || null;
      const summary = await questService.getSummary("weekly", weekLabel);
      res.json(ok({ weekLabel: summary.periodKey, quests: summary.quests, progress: summary.progress }, "summary fetched"));
    } catch (err) {
      next(err);
    }
  });

  // ── Admin quests (new unified) ─────────────────────
  router.get("/admin/quests", async (req, res, next) => {
    try {
      const cadence = String(req.query.cadence || "all");
      const quests = await questService.listDefinitions(cadence);
      res.json(ok(quests, "quests fetched"));
    } catch (err) {
      next(err);
    }
  });

  router.post("/admin/quests", async (req, res, next) => {
    try {
      const quest = await questService.createDefinition(req.body || {});
      res.json(ok(quest, "quest created"));
    } catch (err) {
      next(err);
    }
  });

  router.put("/admin/quests/:id", async (req, res, next) => {
    try {
      const quest = await questService.updateDefinition(req.params.id, req.body || {});
      res.json(ok(quest, "quest updated"));
    } catch (err) {
      next(err);
    }
  });

  router.delete("/admin/quests/:id", async (req, res, next) => {
    try {
      await questService.deleteDefinition(req.params.id);
      res.json(ok(null, "quest deleted"));
    } catch (err) {
      next(err);
    }
  });

  router.get("/admin/quests/summary", async (req, res, next) => {
    try {
      const cadence = String(req.query.cadence || "weekly");
      const periodKey = req.query.periodKey || null;
      const summary = await questService.getSummary(cadence, periodKey);
      res.json(ok(summary, "summary fetched"));
    } catch (err) {
      next(err);
    }
  });

  router.post("/admin/quests/seed", async (_req, res, next) => {
    try {
      const result = await questService.ensureDefaultSeeds();
      res.json(ok(result, "quest seeds ensured"));
    } catch (err) {
      next(err);
    }
  });

  // ── Player auth ────────────────────────────────────
  router.use(["/api/weekly-quests", "/api/quests"], (req, res, next) => {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) return res.status(401).json(fail("UNAUTHORIZED", "Missing token"));
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || "super-secret-jwt-key");
      req.playerRecord = decoded;
      next();
    } catch {
      return res.status(401).json(fail("UNAUTHORIZED", "Invalid or expired token"));
    }
  });

  // ── Player weekly (legacy) ─────────────────────────
  router.get("/api/weekly-quests", async (req, res, next) => {
    try {
      const { discordId } = req.playerRecord;
      const progress = await questService.getPlayerProgress(discordId, "weekly");
      res.json(ok(progress, "progress fetched"));
    } catch (err) {
      next(err);
    }
  });

  router.post("/api/weekly-quests/:id/claim", async (req, res, next) => {
    try {
      const { discordId, displayName } = req.playerRecord;
      const reward = await questService.claimReward(discordId, req.params.id, (rw) =>
        grantQuestReward(serviceContext, { discordId, displayName, reward: rw, sourceTag: "weekly_quest" })
      );
      res.json(ok(reward, "reward claimed"));
    } catch (err) {
      if (err.message && (err.message.includes("未完成") || err.message.includes("已領取") || err.message.includes("不存在") || err.message.includes("不足") || err.message.includes("領取中"))) {
        return res.status(400).json(fail("CLAIM_FAILED", err.message));
      }
      next(err);
    }
  });

  // ── Player unified (new) ───────────────────────────
  router.get("/api/quests", async (req, res, next) => {
    try {
      const { discordId } = req.playerRecord;
      const cadence = String(req.query.cadence || "all");
      const progress = await questService.getPlayerProgress(discordId, cadence);
      res.json(ok(progress, "progress fetched"));
    } catch (err) {
      next(err);
    }
  });

  router.post("/api/quests/:id/claim", async (req, res, next) => {
    try {
      const { discordId, displayName } = req.playerRecord;
      const reward = await questService.claimReward(discordId, req.params.id, (rw) =>
        grantQuestReward(serviceContext, { discordId, displayName, reward: rw, sourceTag: "quest" })
      );
      res.json(ok(reward, "reward claimed"));
    } catch (err) {
      if (err.message && (err.message.includes("未完成") || err.message.includes("已領取") || err.message.includes("不存在") || err.message.includes("不足") || err.message.includes("領取中"))) {
        return res.status(400).json(fail("CLAIM_FAILED", err.message));
      }
      next(err);
    }
  });

  return router;
}

module.exports = { createAdminWeeklyQuestRoutes };
