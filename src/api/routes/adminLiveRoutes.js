// 直播控制台 API（/static/live.html 用）
//   GET  /admin/live/stats       一次回傳直播中會看的所有即時數據（單次請求，前端 10s 輪詢）
//   POST /admin/live/test-alert  發一筆測試警報到 OBS 警報 overlay（取代手動塞 DB）
const { Router } = require("express");
const config = require("../../config");
const { ok, fail } = require("../../shared/response");
const { getMongoDb } = require("../../adapters/mongo/createMongoClient");
const { getSnapshot: getStreamPresenceSnapshot } = require("../../services/stream/streamPresence");

const WB_ZONES = ["elite", "dragon_king_lair", "hellfire_depths"];

function taipeiStartOfToday() {
  const shifted = new Date(Date.now() + 8 * 3600e3);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - 8 * 3600e3);
}

function createAdminLiveRoutes(serviceContext) {
  const router = Router();

  function requireAdmin(req, res, next) {
    const token = (req.header("Authorization") || "").replace("Bearer ", "");
    if (token !== config.api.adminPassword) {
      return res.status(401).json(fail("ADMIN_UNAUTHORIZED", "Invalid admin password."));
    }
    next();
  }

  router.get("/admin/live/stats", requireAdmin, async (_req, res, next) => {
    try {
      const db = await getMongoDb();
      const sinceIso = taipeiStartOfToday().toISOString();

      const [donations, memberCount, scBar, wbList] = await Promise.all([
        db.collection("donationEvents")
          .find({ createdAt: { $gte: sinceIso } }).project({ twdAmount: 1 }).toArray(),
        db.collection("membershipEvents")
          .countDocuments({ at: { $gte: sinceIso }, event: { $in: ["join", "rejoin", "upgrade"] } }),
        Promise.resolve().then(() => require("../../services/stream/scBarService").getPublicProgress()).catch(() => null),
        Promise.all(WB_ZONES.map(async (zone) => {
          try {
            const [state, monsters] = await Promise.all([
              serviceContext.monsterService.getState(zone),
              serviceContext.monsterService.listMonsters({ includeDisabled: false, zone })
            ]);
            const boss = monsters.find((m) => m.seq === state.activeMonsterSeq) || monsters[0];
            if (!boss) return null;
            const partsHp = state.worldBossPartsHp || {};
            const cur = Object.keys(partsHp).length
              ? Object.values(partsHp).reduce((s, v) => s + Math.max(0, Number(v) || 0), 0)
              : Math.max(0, Number(state.currentHp) || 0);
            const max = Object.keys(state.worldBossPartsMaxHp || {}).length
              ? Object.values(state.worldBossPartsMaxHp).reduce((s, v) => s + (Number(v) || 0), 0)
              : (boss.calc?.maxHp || boss.maxHp || 1);
            return { zone, name: boss.name, currentHp: Math.round(cur), maxHp: Math.round(max) };
          } catch (_) { return null; }
        }))
      ]);

      const presence = getStreamPresenceSnapshot() || {};
      const webPresence = require("../../services/realtime/webPresence");
      const ytSubs = await db.collection("streamAlertState").findOne({ _id: "ytSubs" }).catch(() => null);

      res.setHeader("Cache-Control", "no-store");
      res.json(ok({
        now: new Date().toISOString(),
        stream: {
          isLive: presence.isLive === true,
          viewerCount: Number(presence.viewerCount) || 0,
          lastCommentAt: presence.lastCommentAt || null,
          checkedInCount: Array.isArray(presence.actors) ? presence.actors.length : 0
        },
        today: {
          donationTotal: donations.reduce((s, d) => s + (Number(d.twdAmount) || 0), 0),
          donationCount: donations.length,
          newMembers: memberCount
        },
        webOnlinePlayers: webPresence.list().length,
        scBar: scBar,
        ytSubscribers: Number(ytSubs?.lastCount) || null,
        worldBosses: wbList.filter(Boolean)
      }));
    } catch (err) { next(err); }
  });

  // 測試警報：塞一筆 test 事件進警報層（不碰真實斗內對帳），OBS 警報 overlay 4 秒內彈出
  router.post("/admin/live/test-alert", requireAdmin, async (req, res, next) => {
    try {
      const type = String(req.body?.type || "").trim();
      const SAMPLES = {
        donation:  { type: "donation", name: "測試・鯉魚大王", amount: 520, platform: "test" },
        member:    { type: "member", name: "測試・新鯉魚", eventText: "加入會員", label: config.streamMembership?.youtubeTiers?.C || "鯉民", platform: "test" },
        sub:       { type: "sub", name: "測試・推しの旅人", months: 3, gift: false, platform: "test" },
        raid:      { type: "raid", name: "測試・隔壁勇者台", viewers: 87, platform: "test" },
        milestone: { type: "milestone", milestone: 1500, count: 1503, platform: "test" }
      };
      const sample = SAMPLES[type];
      if (!sample) return res.status(400).json(fail("INVALID_ARGUMENT", "type 需為 donation/member/sub/raid/milestone"));
      const { insertEvent } = require("../../services/stream/streamAlertService");
      await insertEvent(sample, `test:${Date.now()}:${type}`);
      res.json(ok({ fired: type }, "test alert fired"));
    } catch (err) { next(err); }
  });

  return router;
}

module.exports = { createAdminLiveRoutes };
