// 直播 overlay 公開唯讀 API（OBS 用，依使用者需求不設密碼；只回顯示需要的欄位）
//   GET /api/stream-overlay/thanks        今日（台北時區）斗內彙總 + 新會員名單 → 感謝名單輪播用
//   GET /api/stream-overlay/feed?since=   增量事件流（斗內 + 會員加入/續約/升級）→ 斗內警報/入場動畫用
const { Router } = require("express");
const { ok } = require("../../shared/response");
const { getMongoDb } = require("../../adapters/mongo/createMongoClient");
const config = require("../../config");

// 會員位階顯示名：以 YT 頻道位階設定為準（config.streamMembership.youtubeTiers：C=鯉民/B=鯉長/A=鯉市長）
function tierLabel(tier, fallback = null) {
  return config.streamMembership?.youtubeTiers?.[String(tier || "").toUpperCase()] || fallback;
}

// 台北時區(+8, 無夏令)的「今日 00:00」
function taipeiStartOfToday() {
  const shifted = new Date(Date.now() + 8 * 3600e3);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - 8 * 3600e3);
}

const MEMBER_EVENTS = new Set(["join", "rejoin", "upgrade"]);
const MEMBER_EVENT_LABEL = { join: "加入會員", rejoin: "回歸會員", upgrade: "會員升級" };

function createStreamOverlayRoutes() {
  const router = Router();

  router.get("/api/stream-overlay/thanks", async (_req, res, next) => {
    try {
      const db = await getMongoDb();
      const sinceIso = taipeiStartOfToday().toISOString();

      const donations = await db.collection("donationEvents")
        .find({ createdAt: { $gte: sinceIso } })
        .project({ displayName: 1, twdAmount: 1 })
        .sort({ createdAt: 1 }).limit(500).toArray();
      // 同名彙總（今日總額），由大到小
      const byName = new Map();
      for (const d of donations) {
        const name = String(d.displayName || "匿名").trim() || "匿名";
        byName.set(name, (byName.get(name) || 0) + (Number(d.twdAmount) || 0));
      }
      const donors = [...byName.entries()]
        .map(([name, total]) => ({ name, total }))
        .sort((a, b) => b.total - a.total);

      const members = await db.collection("membershipEvents")
        .find({ at: { $gte: sinceIso }, event: { $in: [...MEMBER_EVENTS] } })
        .project({ displayName: 1, event: 1, toTier: 1, toLabel: 1 })
        .sort({ at: 1 }).limit(200).toArray();

      res.setHeader("Cache-Control", "no-store");
      res.json(ok({
        donors,
        members: members.map((m) => ({
          name: String(m.displayName || "").trim() || "神秘鯉魚",
          label: tierLabel(m.toTier, m.toLabel),
          eventText: MEMBER_EVENT_LABEL[m.event] || "加入會員"
        }))
      }));
    } catch (err) { next(err); }
  });

  router.get("/api/stream-overlay/feed", async (req, res, next) => {
    try {
      const db = await getMongoDb();
      const now = new Date().toISOString();
      // since 無效/未帶 → 只回游標不回事件（alertbox 開頁先對時，之後只播新事件）
      const since = String(req.query.since || "").trim();
      if (!since || Number.isNaN(Date.parse(since))) {
        res.setHeader("Cache-Control", "no-store");
        return res.json(ok({ now, events: [] }));
      }

      const [donations, members, alerts] = await Promise.all([
        db.collection("donationEvents")
          .find({ createdAt: { $gt: since, $lte: now } })
          .project({ displayName: 1, twdAmount: 1, platform: 1, supportKind: 1, createdAt: 1 })
          .sort({ createdAt: 1 }).limit(20).toArray(),
        db.collection("membershipEvents")
          .find({ at: { $gt: since, $lte: now }, event: { $in: [...MEMBER_EVENTS] } })
          .project({ displayName: 1, event: 1, toTier: 1, toLabel: 1, at: 1 })
          .sort({ at: 1 }).limit(20).toArray(),
        // 警報事件層：Twitch 訂閱(sub)/Raid 降落(raid)/YT 即時會員加入(member)/YT 訂閱數里程碑(milestone)
        db.collection("streamAlertEvents")
          .find({ createdAt: { $gt: since, $lte: now } })
          .sort({ createdAt: 1 }).limit(20).toArray()
      ]);

      const events = [
        ...donations.map((d) => ({
          type: "donation",
          name: String(d.displayName || "匿名").trim() || "匿名",
          amount: Number(d.twdAmount) || 0,
          platform: d.platform || null,
          ts: d.createdAt
        })),
        ...members.map((m) => ({
          type: "member",
          name: String(m.displayName || "").trim() || "神秘鯉魚",
          label: tierLabel(m.toTier, m.toLabel),
          eventText: MEMBER_EVENT_LABEL[m.event] || "加入會員",
          ts: m.at
        })),
        ...alerts.map((a) => ({
          type: a.type, // sub | raid | member | milestone（測試時也可帶 donation）
          name: a.name || null,
          amount: a.amount || 0,
          months: a.months || 0,
          gift: a.gift === true,
          viewers: a.viewers || 0,
          count: a.count || 0,
          milestone: a.milestone || 0,
          eventText: a.eventText || null,
          label: a.label || null,
          platform: a.platform || null,
          ts: a.createdAt
        }))
      ].sort((a, b) => String(a.ts).localeCompare(String(b.ts))).slice(0, 20);

      res.setHeader("Cache-Control", "no-store");
      res.json(ok({ now, events }));
    } catch (err) { next(err); }
  });

  return router;
}

module.exports = { createStreamOverlayRoutes };
