"use strict";
/**
 * 玩家圖鑑／排行榜 API（網頁 App 用，對應 Discord 玩家面板既有功能）：
 *   GET /api/bestiary          怪物圖鑑（對應 playerPanel 怪物圖鑑，邏輯同 shared/bestiary.js）
 *   GET /api/me/pets/dex       寵物圖鑑（對應 petHandlers 圖鑑；未孵化品種顯示為未知）
 *   GET /api/leaderboard/level 等級排行榜 TOP N + 自己名次（排序同 adminConsoleService.getLeaderboard）
 */

const { Router } = require("express");
const { ok } = require("../../shared/response");
const { requireAuth } = require("./requireAuth");
const { ALL_ZONE_KEYS, ZONE_BY_KEY } = require("../../shared/zones");
const { bestiaryRequirement, bestiaryBonusPct, MAX_BONUS_PCT } = require("../../shared/bestiary");
const { isWorldBossZone } = require("../../services/worldBoss/worldBossService");
const { GATHER_INTERVAL_MIN } = require("../../services/pet/petService");

// 怪物圖鑑累積 key（與 playerPanel._bestiaryKey 同規則）
function bestiaryKey(m) {
  return String(m?.id || m?._id || m?.name || "");
}

function createPlayerCollectionRoutes(serviceContext) {
  const router = Router();

  // ──────────────────────────────────────────────────
  // 怪物圖鑑：各區域怪物清單、累積擊殺、完成度與傷害加成
  // 規則（shared/bestiary.js）：一般 100｜BOSS 50｜世界王 10 隻＝滿 +30% 對該怪傷害
  // ──────────────────────────────────────────────────
  router.get("/api/bestiary", requireAuth, async (req, res, next) => {
    try {
      const { discordId } = req.playerRecord;
      const [monsters, progress] = await Promise.all([
        serviceContext.monsterService.listMonsters({ includeDisabled: false }).catch(() => []),
        serviceContext.progressRepository.findByPlayerId(discordId).catch(() => null)
      ]);
      const bestiary = progress?.bestiary || {};

      // 依 zone 分組（與 playerPanel._loadBestiaryData 同邏輯）
      const byZone = new Map();
      for (const m of monsters) {
        const z = m.zone || "normal";
        if (!byZone.has(z)) byZone.set(z, []);
        byZone.get(z).push(m);
      }
      const zoneOrder = [
        ...ALL_ZONE_KEYS.filter((z) => byZone.has(z)),
        ...[...byZone.keys()].filter((z) => !ALL_ZONE_KEYS.includes(z))
      ];

      let totalMonsters = 0;
      let totalMaxed = 0;
      const zones = zoneOrder.map((zoneKey) => {
        const isWB = isWorldBossZone(zoneKey);
        const list = (byZone.get(zoneKey) || [])
          .slice()
          .sort((a, b) => (a.calc?.level || a.level || 0) - (b.calc?.level || b.level || 0));

        const entries = list.map((m) => {
          const requirement = bestiaryRequirement(m, isWB);
          const kills = Number(bestiary[bestiaryKey(m)]) || 0;
          const bonusPct = bestiaryBonusPct(kills, requirement);
          return {
            monsterId: m.id || null,
            name: m.name,
            level: m.calc?.level || m.level || 0,
            isBoss: Boolean(m.isBoss),
            isWorldBoss: isWB,
            imageUrl: m.imageUrl || null,
            // 累積有效擊殺（一場打掉該怪 100% 血＝1 隻，可累積小數）
            kills: Math.round(kills * 10) / 10,
            requirement,
            unlocked: kills > 0,
            done: kills >= requirement,
            progressRatio: requirement > 0 ? Math.min(1, kills / requirement) : 0,
            // 完成度帶來的「對該怪傷害」加成（線性，封頂 +30%）
            damageBonusPct: Math.round(bonusPct * 10) / 10
          };
        });

        const maxedCount = entries.filter((e) => e.done).length;
        totalMonsters += entries.length;
        totalMaxed += maxedCount;
        return {
          zone: zoneKey,
          zoneLabel: ZONE_BY_KEY[zoneKey]?.label || zoneKey,
          isWorldBoss: isWB,
          monsterCount: entries.length,
          maxedCount,
          monsters: entries
        };
      });

      res.json(ok({
        maxBonusPct: MAX_BONUS_PCT,
        rule: "打越多，對該怪傷害越高（一般 100｜BOSS 50｜世界王 10 隻＝滿 +30%）。每場依造成傷害比例累積：打掉該怪 100% 血＝1 隻，可累積。",
        totalMonsters,
        totalMaxed,
        zones
      }));
    } catch (err) {
      next(err);
    }
  });

  // ──────────────────────────────────────────────────
  // 寵物圖鑑：品種圖鑑（已孵化解鎖、未孵化顯示為未知）＋ 我的寵物清單
  // 對應 DC 寵物面板「📋 圖鑑」；蛋階段一律不揭曉品種（petService._toView 已遮蔽）
  // ──────────────────────────────────────────────────
  router.get("/api/me/pets/dex", requireAuth, async (req, res, next) => {
    try {
      const { discordId } = req.playerRecord;
      const [state, allSpecies] = await Promise.all([
        serviceContext.petService.getPetState(discordId),
        serviceContext.petRepository.findAll().catch(() => [])
      ]);

      // 已孵化品種＝目前持有的 grown 寵物對應品種（蛋不揭曉、放生即不再持有）
      const ownedPetIds = new Set();
      const ownedSpeciesNames = new Set();
      for (const p of state.pets || []) {
        if (p.stage !== "grown") continue;
        if (p.petId) ownedPetIds.add(p.petId);
        if (p.speciesName) ownedSpeciesNames.add(p.speciesName);
      }

      const species = (allSpecies || []).map((sp) => {
        const unlocked = ownedPetIds.has(sp.id) || ownedSpeciesNames.has(sp.name);
        if (!unlocked) {
          // 未孵化品種：隱藏內容，僅保留佔位（前端顯示「？？？」）
          return { id: sp.id, seq: sp.seq || 0, unlocked: false };
        }
        const gather = sp.gather || {};
        const intervalMult = Number(gather.intervalMult) || 1;
        return {
          id: sp.id,
          seq: sp.seq || 0,
          unlocked: true,
          name: sp.name,
          species: sp.species || null,
          rarity: sp.rarity || null,
          description: sp.description || "",
          imageUrl: sp.imageUrl || null,
          imageThumbnailUrl: sp.imageThumbnailUrl || null,
          maxLevel: sp.maxLevel || 50,
          // 採集特性（與 petService._toView 同算法）
          traits: {
            gatherIntervalMin: Math.round(GATHER_INTERVAL_MIN * intervalMult),
            gemBias: Number.isFinite(Number(gather.gemBias)) ? Number(gather.gemBias) : null,
            qualityUpChance: Number(gather.qualityUpChance) || 0
          }
        };
      }).sort((a, b) => (a.seq || 0) - (b.seq || 0));

      res.json(ok({
        unlockedCount: species.filter((s) => s.unlocked).length,
        totalCount: species.length,
        species,
        // 我的寵物清單（同 DC 圖鑑內容；蛋顯示為神秘龍蛋）
        pets: state.pets || [],
        activePetUuid: state.activePetUuid || null
      }));
    } catch (err) {
      next(err);
    }
  });

  // ──────────────────────────────────────────────────
  // 等級排行榜 TOP N + 自己名次
  // 排序規則與 adminConsoleService.getLeaderboard 一致：level desc → exp desc
  // ──────────────────────────────────────────────────
  router.get("/api/leaderboard/level", requireAuth, async (req, res, next) => {
    try {
      const { discordId } = req.playerRecord;
      const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
      const [players, progresses] = await Promise.all([
        serviceContext.playerRepository.listAll(),
        serviceContext.progressRepository.listAll()
      ]);
      const progressMap = Object.fromEntries(progresses.map((p) => [p.playerId, p]));

      const rows = players
        .filter((p) => p.status !== "disabled")
        .map((p) => {
          const prog = progressMap[p.discordId] || {};
          return {
            discordId: p.discordId,
            name: p.displayName || p.discordId,
            level: prog.level ?? 1,
            exp: prog.exp ?? 0,
            jobName: prog.equipment?.job_eq?.itemName || prog.equipment?.job_eq?.name || ""
          };
        })
        .sort((a, b) => b.level - a.level || b.exp - a.exp);

      const list = rows.slice(0, limit).map((r, i) => ({ rank: i + 1, ...r }));
      const myIdx = rows.findIndex((r) => r.discordId === discordId);
      const me = myIdx >= 0
        ? { rank: myIdx + 1, ...rows[myIdx] }
        : { rank: null, discordId, name: req.playerRecord.displayName || discordId, level: 1, exp: 0, jobName: "" };

      res.json(ok({ list, me, totalPlayers: rows.length }));
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { createPlayerCollectionRoutes };
