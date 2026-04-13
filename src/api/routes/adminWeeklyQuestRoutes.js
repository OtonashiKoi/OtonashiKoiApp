"use strict";

const { Router } = require("express");
const { ok, fail } = require("../../shared/response");

function createAdminWeeklyQuestRoutes(serviceContext) {
  const router = Router();

  // 管理員驗證 middleware
  router.use("/admin/weekly-quests", (req, res, next) => {
    const token = (req.header("Authorization") || "").replace("Bearer ", "");
    const config = require("../../config");
    if (token !== config.api.adminPassword) {
      res.status(401).json(fail("ADMIN_UNAUTHORIZED", "Invalid admin password."));
      return;
    }
    next();
  });

  // GET /admin/weekly-quests — 取得所有任務定義
  router.get("/admin/weekly-quests", async (_req, res, next) => {
    try {
      const quests = await serviceContext.weeklyQuestService.listQuests();
      res.json(ok(quests, "quests fetched"));
    } catch (err) {
      next(err);
    }
  });

  // POST /admin/weekly-quests — 新增任務
  router.post("/admin/weekly-quests", async (req, res, next) => {
    try {
      const quest = await serviceContext.weeklyQuestService.createQuest(req.body);
      res.json(ok(quest, "quest created"));
    } catch (err) {
      next(err);
    }
  });

  // PUT /admin/weekly-quests/:id — 更新任務
  router.put("/admin/weekly-quests/:id", async (req, res, next) => {
    try {
      const quest = await serviceContext.weeklyQuestService.updateQuest(req.params.id, req.body);
      res.json(ok(quest, "quest updated"));
    } catch (err) {
      next(err);
    }
  });

  // DELETE /admin/weekly-quests/:id — 刪除任務
  router.delete("/admin/weekly-quests/:id", async (req, res, next) => {
    try {
      await serviceContext.weeklyQuestService.deleteQuest(req.params.id);
      res.json(ok(null, "quest deleted"));
    } catch (err) {
      next(err);
    }
  });

  // GET /admin/weekly-quests/summary — 本週所有玩家完成概況（後台查看）
  router.get("/admin/weekly-quests/summary", async (req, res, next) => {
    try {
      const weekLabel = req.query.week || null;
      const summary = await serviceContext.weeklyQuestService.getWeekSummary(weekLabel);
      res.json(ok(summary, "summary fetched"));
    } catch (err) {
      next(err);
    }
  });

  // ── 玩家端 API（需要 JWT） ──────────────────────────────

  router.use("/api/weekly-quests", (req, res, next) => {
    const jwt = require("jsonwebtoken");
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

  // GET /api/weekly-quests — 取得自己本週任務進度
  router.get("/api/weekly-quests", async (req, res, next) => {
    try {
      const { discordId } = req.playerRecord;
      const progress = await serviceContext.weeklyQuestService.getPlayerProgress(discordId);
      res.json(ok(progress, "progress fetched"));
    } catch (err) {
      next(err);
    }
  });

  // POST /api/weekly-quests/:id/claim — 領取獎勵
  router.post("/api/weekly-quests/:id/claim", async (req, res, next) => {
    try {
      const { discordId, displayName } = req.playerRecord;
      const reward = await serviceContext.weeklyQuestService.claimReward(discordId, req.params.id);

      // 發放金幣 / 鑽石
      if (reward.gold > 0) {
        await serviceContext.rewardService.grantCurrency({
          discordId, displayName,
          currencyType: "gold",
          amount: reward.gold,
          source: "weekly_quest_reward",
          operator: "weekly_quest"
        });
      }
      if (reward.diamond > 0) {
        await serviceContext.rewardService.grantCurrency({
          discordId, displayName,
          currencyType: "diamond",
          amount: reward.diamond,
          source: "weekly_quest_reward",
          operator: "weekly_quest"
        });
      }
      // 發放道具（若有）
      if (reward.rewardItemId) {
        try {
          const item = await serviceContext.itemRepository.findById(reward.rewardItemId);
          if (item) {
            const progress = await serviceContext.progressRepository.findByPlayerId(discordId);
            if (progress) {
              if (!Array.isArray(progress.inventory)) progress.inventory = [];
              progress.inventory.push({
                uuid: crypto.randomUUID(),
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
                tier: item.tier || null,
                source: "weekly_quest",
                obtainedAt: new Date().toISOString()
              });
              progress.updatedAt = new Date().toISOString();
              await serviceContext.progressRepository.save(progress);
            }
            reward.rewardItemName = item.name;
          }
        } catch (_) {}
      }

      res.json(ok(reward, "reward claimed"));
    } catch (err) {
      // 友善地把業務錯誤（未完成、已領取）回傳給前端
      if (err.message && (err.message.includes("未完成") || err.message.includes("已領取") || err.message.includes("不存在"))) {
        return res.status(400).json(fail("CLAIM_FAILED", err.message));
      }
      next(err);
    }
  });

  return router;
}

module.exports = { createAdminWeeklyQuestRoutes };
