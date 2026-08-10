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
const { isLeaderboardExcluded } = require("../../shared/leaderboardEligibility");

// 怪物圖鑑累積 key（與 playerPanel._bestiaryKey 同規則）
function bestiaryKey(m) {
  return String(m?.id || m?._id || m?.name || "");
}

function createPlayerCollectionRoutes(serviceContext) {
  const router = Router();

  // ──────────────────────────────────────────────────
  // 怪物圖鑑：各區域怪物清單、累積擊殺、完成度與傷害加成
  // 規則（shared/bestiary.js）：一般 100｜BOSS 50｜世界王 10 隻＝滿 +25% 對該怪傷害
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
            // 完成度帶來的「對該怪傷害」加成（線性，封頂 +25%）
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
        rule: `打越多，對該怪傷害越高（一般 100｜BOSS 50｜世界王 10 隻＝滿 +${MAX_BONUS_PCT}%）。每場依造成傷害比例累積：打掉該怪 100% 血＝1 隻，可累積。`,
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
      const [dex, state] = await Promise.all([
        serviceContext.petService.getPetDex(discordId),        // 品種×位階網格 + 收集分數/里程碑
        serviceContext.petService.getPetState(discordId)       // 我的寵物清單
      ]);
      res.json(ok({
        ...dex, // species(grid) / score / maxScore / collected / totalSlots / pct / bonus / milestones / unlockedCount
        pets: state.pets || [],
        activePetUuid: state.activePetUuid || null
      }));
    } catch (err) {
      next(err);
    }
  });

  // ──────────────────────────────────────────────────
  // 錨點圖鑑：列出全部錨點(equipSlot anchor)＋是否已取得(背包/裝備 或 曾領過)
  // ──────────────────────────────────────────────────
  router.get("/api/me/anchors", requireAuth, async (req, res, next) => {
    try {
      const { discordId } = req.playerRecord;
      const { getMongoDb } = require("../../adapters/mongo/createMongoClient");
      const db = await getMongoDb();
      const [items, progress, grants] = await Promise.all([
        db.collection("items").find({ equipSlot: "anchor" }).toArray().catch(() => []),
        serviceContext.progressRepository.findByPlayerId(discordId).catch(() => null),
        db.collection("uniqueItemGrants").find({ discordId: String(discordId) }, { projection: { itemId: 1 } }).toArray().catch(() => []),
      ]);
      const owned = new Set();
      for (const e of (progress?.inventory || [])) if (e?.itemId) owned.add(String(e.itemId));
      for (const e of Object.values(progress?.equipment || {})) if (e?.itemId) owned.add(String(e.itemId));
      for (const g of grants) if (g?.itemId) owned.add(String(g.itemId));

      const anchors = items
        .sort((a, b) => String(a.id).localeCompare(String(b.id)))
        .map((it) => {
          const obtained = owned.has(String(it.id));
          return {
            id: it.id,
            obtained,
            // 未取得只回名稱與剪影提示，效果保密（保留探索感）；已取得回完整說明
            name: obtained ? it.name : "？？？",
            description: obtained ? (it.description || "") : "尚未取得——找到它的獲得管道來解鎖這件傳說錨點。",
            tier: it.tier || "S",
            imageUrl: obtained ? (it.imageUrl || null) : null,
          };
        });
      res.json(ok({
        anchors,
        total: anchors.length,
        collected: anchors.filter((a) => a.obtained).length,
      }));
    } catch (err) { next(err); }
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

      // 多數玩家沒有設定暱稱(displayName 就是純數字 Discord ID)→ 不要把 18 碼 ID 攤在排行榜上,
      // 改顯示友善暱稱「玩家#末四碼」;有真實暱稱者照常顯示。
      const prettyName = (displayName, discordId) => {
        const dn = String(displayName || "").trim();
        const id = String(discordId || "");
        if (!dn || dn === id || /^\d{15,}$/.test(dn)) {
          return id ? `玩家#${id.slice(-4)}` : "玩家";
        }
        return dn;
      };

      // 達成時間排序用：有記錄→毫秒；沒有(此功能上線前就達成該級的老玩家)→視為「最早」(0),
      // 因為他們確實比任何上線後才升到此級的人更早達成。
      const reachedMs = (iso) => {
        if (!iso) return 0;
        const t = Date.parse(iso);
        return Number.isFinite(t) ? t : 0;
      };

      const rows = players
        .filter((p) => p.status !== "disabled")
        .filter((p) => !isLeaderboardExcluded(progressMap[p.discordId]))
        .map((p) => {
          const prog = progressMap[p.discordId] || {};
          return {
            discordId: p.discordId,
            name: prettyName(p.displayName, p.discordId),
            level: prog.level ?? 1,
            exp: prog.exp ?? 0,
            levelReachedAt: prog.levelReachedAt || null,
            jobName: prog.equipment?.job_eq?.itemName || prog.equipment?.job_eq?.name || ""
          };
        })
        // 等級高→前；同級「越早達成該級」→前；再平手才比經驗。
        .sort((a, b) =>
          b.level - a.level ||
          reachedMs(a.levelReachedAt) - reachedMs(b.levelReachedAt) ||
          b.exp - a.exp
        );

      const list = rows.slice(0, limit).map((r, i) => ({ rank: i + 1, ...r }));
      const myIdx = rows.findIndex((r) => r.discordId === discordId);
      const myProgress = progressMap[discordId] || {};
      const me = myIdx >= 0
        ? { rank: myIdx + 1, ...rows[myIdx] }
        : {
            rank: null,
            discordId,
            name: prettyName(req.playerRecord.displayName, discordId),
            level: myProgress.level ?? 1,
            exp: myProgress.exp ?? 0,
            levelReachedAt: myProgress.levelReachedAt || null,
            jobName: myProgress.equipment?.job_eq?.itemName || myProgress.equipment?.job_eq?.name || ""
          };

      res.json(ok({ list, me, totalPlayers: rows.length }));
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { createPlayerCollectionRoutes };
