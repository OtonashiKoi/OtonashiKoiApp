"use strict";
/**
 * 主線故事路由。
 * 玩家端（requireAuth JWT）：
 *   GET  /api/story/chapters           章節目錄（含 locked/available/completed 狀態）
 *   GET  /api/story/chapters/:id       章節內容（nodes 附 NPC 名字/立繪）
 *   POST /api/story/chapters/:id/complete  完成章節（body.skipped=true 代表按 SKIP）
 * 後台（Bearer adminPassword，同其他 /admin 路由）：
 *   GET/POST /admin/story/chapters、DELETE /admin/story/chapters/:id
 *   GET/POST /admin/story/npcs、DELETE /admin/story/npcs/:id
 *   POST /admin/story/npcs/:id/portrait  立繪上傳（Cloudinary，同怪物圖片流程）
 */

const { Router } = require("express");
const fs = require("fs");
const multer = require("multer");
const { ok, fail } = require("../../shared/response");
const { requireAuth } = require("./requireAuth");
const config = require("../../config");

const upload = multer({
  dest: "/tmp/story-uploads/",
  limits: { fileSize: 8 * 1024 * 1024 }
});

function createStoryRoutes(serviceContext, discordClient) {
  const router = Router();
  const storyService = serviceContext.storyService;

  // 主角＝玩家：登入者的 DC 頭像（做立繪）。短期快取避免每次開章節都打 Discord。
  const _avatarCache = new Map(); // discordId → { url, ts }
  const AVATAR_TTL = 10 * 60 * 1000;
  async function playerAvatarUrl(discordId) {
    if (!discordClient) return null;
    const hit = _avatarCache.get(discordId);
    if (hit && Date.now() - hit.ts < AVATAR_TTL) return hit.url;
    try {
      const u = await discordClient.users.fetch(discordId, { force: false });
      const url = u.displayAvatarURL({ size: 256, extension: "png" });
      _avatarCache.set(discordId, { url, ts: Date.now() });
      return url;
    } catch (_) {
      return hit?.url || null;
    }
  }

  // ── 玩家端 ──

  router.get("/api/story/chapters", requireAuth, async (req, res, next) => {
    try {
      const list = await storyService.listChaptersForPlayer(req.playerRecord.discordId);
      res.json(ok(list, "story chapters fetched"));
    } catch (error) { next(error); }
  });

  // 登入時預抓：回傳劇情會用到的背景/CG 圖 + BGM 曲目 key，前端背景預先下載
  router.get("/api/story/preload", requireAuth, async (req, res, next) => {
    try {
      res.json(ok(await storyService.listPreloadAssets(), "story preload assets"));
    } catch (error) { next(error); }
  });

  router.get("/api/story/chapters/:id", requireAuth, async (req, res, next) => {
    try {
      const { discordId, displayName } = req.playerRecord;
      const avatarUrl = await playerAvatarUrl(discordId);
      const chapter = await storyService.getChapterForPlayer(discordId, req.params.id, {
        name: displayName || null,
        avatarUrl
      });
      res.json(ok(chapter, "story chapter fetched"));
    } catch (error) { next(error); }
  });

  router.post("/api/story/chapters/:id/complete", requireAuth, async (req, res, next) => {
    try {
      const result = await storyService.completeChapter(req.playerRecord.discordId, req.params.id, {
        skipped: req.body?.skipped === true
      });
      res.json(ok(result, "story chapter completed"));
    } catch (error) { next(error); }
  });

  // 劇情戰鬥：打章節裡指定的怪。無入場費、無獎勵、不動區域狀態；勝利才記錄通過。
  router.post("/api/story/battle", requireAuth, async (req, res, next) => {
    try {
      const discordId = req.playerRecord.discordId;
      const chapterId = String(req.body?.chapterId || "");
      const nodeIndex = Number(req.body?.nodeIndex);
      const battleNode = await storyService.getBattleNode(discordId, chapterId, nodeIndex);
      const monster = await serviceContext.monsterService.getMonsterById(battleNode.monsterId);
      if (!monster) {
        res.status(400).json(fail("INVALID_ARGUMENT", "該戰鬥節點指定的怪物不存在"));
        return;
      }

      const progress = await serviceContext.progressRepository.findByPlayerId(discordId);
      const { calcPlayerStats } = require("../../shared/combatStats");
      const { mergeEquippedFromLibrary } = require("../../shared/effectEngine");
      const { runCombatLoop } = require("../../shared/combatLoop");
      const attrs = progress?.attributes || { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 };
      const equipped = await mergeEquippedFromLibrary(progress?.equipment || {}, serviceContext.itemRepository);
      const pStats = calcPlayerStats(attrs, equipped, progress?.activeEffects || [], progress?.inventory || [], { pkRating: progress?.pkRating });

      const result = runCombatLoop(pStats, monster.calc, monster.name, monster.calc.maxHp, undefined, {
        playerName: req.playerRecord.displayName || "我",
        playerLevel: progress?.level || 1,
        equipped,
        inventory: progress?.inventory || [],
        monsterEquipped: monster.equipped || {},
        monsterIsBoss: Boolean(monster?.isBoss)
      });

      // 劇情殺：不管實際結果，強制指定結局（動畫仍播真實回合日誌，最終血量/勝負覆寫）
      const forced = battleNode.forcedOutcome; // "win" | "lose" | null
      let won, outcome, finalPlayerHp, finalMonsterHp;
      if (forced === "win") {
        won = true; outcome = "win"; finalMonsterHp = 0; finalPlayerHp = Math.max(1, Math.round(result.finalPlayerHp));
      } else if (forced === "lose") {
        won = false; outcome = "lose"; finalPlayerHp = 0; finalMonsterHp = Math.max(1, Math.round(result.finalMonsterHp ?? monster.calc.maxHp));
      } else {
        won = result.outcome === "win"; outcome = result.outcome; finalPlayerHp = result.finalPlayerHp; finalMonsterHp = result.finalMonsterHp;
      }
      // 通過記錄：正常勝利 或 劇情殺(必勝/必敗都算「已解決」→劇情往下、重玩不再擋)
      if (won || forced) await storyService.recordBattleWin(discordId, chapterId, nodeIndex).catch(() => {});

      res.json(ok({
        won,
        outcome,
        mustWin: battleNode.mustWin,
        forcedOutcome: forced,
        logs: result.roundLogs || [],
        finalPlayerHp,
        playerMaxHp: pStats.maxHp,
        monster: { name: monster.name, imageUrl: monster.imageUrl || null, maxHp: monster.calc.maxHp },
        finalMonsterHp,
        // 動畫戰鬥場景用：玩家名/頭像/武器種類(打擊音效)
        playerName: req.playerRecord.displayName || "我",
        playerAvatarUrl: await playerAvatarUrl(discordId).catch(() => null),
        weaponType: equipped?.weapon?.weaponType || null
      }, "story battle resolved"));
    } catch (error) { next(error); }
  });

  // ── 後台 ──

  router.use("/admin/story", (req, res, next) => {
    const authHeader = req.header("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    if (token !== config.api.adminPassword) {
      res.status(401).json(fail("ADMIN_UNAUTHORIZED", "Invalid admin password."));
      return;
    }
    next();
  });

  router.get("/admin/story/chapters", async (req, res, next) => {
    try { res.json(ok(await storyService.adminListChapters(), "chapters listed")); }
    catch (error) { next(error); }
  });

  router.post("/admin/story/chapters", async (req, res, next) => {
    try { res.json(ok(await storyService.adminSaveChapter(req.body || {}), "chapter saved")); }
    catch (error) { next(error); }
  });

  router.delete("/admin/story/chapters/:id", async (req, res, next) => {
    try { res.json(ok(await storyService.adminDeleteChapter(req.params.id), "chapter deleted")); }
    catch (error) { next(error); }
  });

  router.get("/admin/story/npcs", async (req, res, next) => {
    try { res.json(ok(await storyService.adminListNpcs(), "npcs listed")); }
    catch (error) { next(error); }
  });

  router.post("/admin/story/npcs", async (req, res, next) => {
    try { res.json(ok(await storyService.adminSaveNpc(req.body || {}), "npc saved")); }
    catch (error) { next(error); }
  });

  router.delete("/admin/story/npcs/:id", async (req, res, next) => {
    try { res.json(ok(await storyService.adminDeleteNpc(req.params.id), "npc deleted")); }
    catch (error) { next(error); }
  });

  // 編輯器用：怪物清單（下拉選戰鬥節點的怪，含 BOSS）
  router.get("/admin/story/monsters", async (req, res, next) => {
    try {
      const list = await serviceContext.monsterService.listMonsters({ includeDisabled: false });
      const slim = list.map((m) => ({ id: m.id, name: m.name, zone: m.zone, level: m.level, isBoss: Boolean(m.isBoss), imageUrl: m.imageUrl || null }))
        .sort((a, b) => String(a.zone || "").localeCompare(String(b.zone || "")) || (a.level || 0) - (b.level || 0));
      res.json(ok(slim, "monsters listed"));
    } catch (error) { next(error); }
  });

  // 編輯器用：zone 下拉選單（單一來源 src/shared/zones.js）
  router.get("/admin/story/zones", (req, res) => {
    const { ALL_ZONE_KEYS, getZoneTheme } = require("../../shared/zones");
    const zones = ALL_ZONE_KEYS.map((key) => ({ key, label: getZoneTheme(key)?.label || key }));
    res.json(ok(zones, "zones listed"));
  });

  // 通用圖片上傳（章節/節點背景圖用）：統一走 Cloudinary
  router.post("/admin/story/upload", upload.single("image"), async (req, res, next) => {
    try {
      if (!req.file) {
        res.status(400).json(fail("INVALID_ARGUMENT", "image file is required"));
        return;
      }
      const { uploadImage } = require("../../shared/cloudinaryUpload");
      const { imageUrl } = await uploadImage(req.file.path, "story-backgrounds");
      res.json(ok({ imageUrl }, "image uploaded"));
    } catch (error) {
      next(error);
    } finally {
      if (req.file?.path) fs.unlink(req.file.path, () => {});
    }
  });

  // 劇情圖庫：上傳過的圖存起來(命名)，下次直接選、不用重傳（背景/CG/立繪共用）
  router.get("/admin/story/assets", async (req, res, next) => {
    try {
      const db = await require("../../adapters/mongo/createMongoClient").getMongoDb();
      const kind = String(req.query.kind || "").trim();
      const list = await db.collection("storyAssets").find(kind ? { kind } : {}).sort({ createdAt: -1 }).limit(500).toArray();
      res.json(ok(list, "assets listed"));
    } catch (e) { next(e); }
  });
  router.post("/admin/story/assets", async (req, res, next) => {
    try {
      const db = await require("../../adapters/mongo/createMongoClient").getMongoDb();
      const name = String(req.body?.name || "").trim();
      const url = String(req.body?.url || "").trim();
      const kind = String(req.body?.kind || "background").trim();
      if (!name || !url) return res.status(400).json(fail("INVALID_ARGUMENT", "name and url required"));
      // 去重：同一 url+kind 已存在就直接回傳既有，不再新增（backfill/重載都不會再長重複）
      const existing = await db.collection("storyAssets").findOne({ url, kind });
      if (existing) { res.json(ok(existing, "asset exists")); return; }
      const doc = { id: require("crypto").randomUUID(), name, url, kind, createdAt: new Date().toISOString() };
      await db.collection("storyAssets").insertOne(doc);
      res.json(ok(doc, "asset saved"));
    } catch (e) { next(e); }
  });
  router.delete("/admin/story/assets/:id", async (req, res, next) => {
    try {
      const db = await require("../../adapters/mongo/createMongoClient").getMongoDb();
      await db.collection("storyAssets").deleteOne({ id: req.params.id });
      res.json(ok({ deleted: true }, "asset deleted"));
    } catch (e) { next(e); }
  });

  // NPC 立繪上傳：統一走 Cloudinary（與怪物圖片同流程）
  router.post("/admin/story/npcs/:id/portrait", upload.single("image"), async (req, res, next) => {
    try {
      if (!req.file) {
        res.status(400).json(fail("INVALID_ARGUMENT", "image file is required"));
        return;
      }
      const { uploadImage } = require("../../shared/cloudinaryUpload");
      const { imageUrl } = await uploadImage(req.file.path, "story-npcs", { trim: true }); // 立繪去背裁邊置中
      const npc = await storyService.adminSaveNpc({ id: req.params.id, name: undefined, portraitUrl: imageUrl });
      res.json(ok({ portraitUrl: imageUrl, npc }, "portrait uploaded"));
    } catch (error) {
      next(error);
    } finally {
      if (req.file?.path) fs.unlink(req.file.path, () => {});
    }
  });

  return router;
}

module.exports = { createStoryRoutes };
