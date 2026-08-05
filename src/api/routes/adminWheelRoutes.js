// 後台：直播轉盤（VTuber 常用抽選轉盤）
//   - 後台 CRUD：/admin/wheel/*（Bearer adminPassword，走既有後台登入）
//   - 公開讀取：/api/wheel/config（OBS overlay 用，唯讀、無敏感資料，依使用者需求不設密碼）
// 資料落地：MongoDB `streamWheels` collection，一份文件＝一個轉盤。
const { Router } = require("express");
const crypto = require("crypto");
const config = require("../../config");
const { ok, fail } = require("../../shared/response");
const { getMongoDb } = require("../../adapters/mongo/createMongoClient");

const MAX_ITEMS = 60;      // 單一轉盤最多項目數（再多畫面上字也擠不下）
const MAX_WHEELS = 30;

// 項目清洗：label 必填、weight 1~1000 整數、color 允許 #rrggbb（不合法就交給前端調色盤預設）
function sanitizeItems(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((it) => ({
      label: String(it?.label || "").trim().slice(0, 40),
      weight: Math.max(1, Math.min(1000, Math.round(Number(it?.weight) || 1))),
      color: /^#[0-9a-fA-F]{6}$/.test(String(it?.color || "")) ? String(it.color) : null
    }))
    .filter((it) => it.label)
    .slice(0, MAX_ITEMS);
}

function createAdminWheelRoutes() {
  const router = Router();

  function requireAdmin(req, res, next) {
    const token = (req.header("Authorization") || "").replace("Bearer ", "");
    if (token !== config.api.adminPassword) {
      return res.status(401).json(fail("ADMIN_UNAUTHORIZED", "Invalid admin password."));
    }
    next();
  }

  const col = async () => (await getMongoDb()).collection("streamWheels");

  // ── 後台：轉盤清單 ──
  router.get("/admin/wheel/list", requireAdmin, async (_req, res, next) => {
    try {
      const wheels = await (await col()).find({}).sort({ createdAt: 1 }).toArray();
      res.json(ok(wheels.map((w) => ({ ...w, id: w._id }))));
    } catch (err) { next(err); }
  });

  // ── 後台：新增/更新轉盤 ──
  router.post("/admin/wheel/save", requireAdmin, async (req, res, next) => {
    try {
      const body = req.body || {};
      const name = String(body.name || "").trim().slice(0, 30) || "未命名轉盤";
      const items = sanitizeItems(body.items);
      const spinSeconds = Math.max(3, Math.min(15, Math.round(Number(body.spinSeconds) || 6)));
      const showHistory = body.showHistory !== false; // 預設顯示歷史
      const c = await col();

      let id = String(body.id || "").trim();
      if (!id) {
        const count = await c.countDocuments();
        if (count >= MAX_WHEELS) return res.status(400).json(fail("TOO_MANY", `轉盤數量已達上限 ${MAX_WHEELS} 個`));
        id = crypto.randomUUID().slice(0, 8); // 短 id，OBS 網址好看
      }
      const now = new Date().toISOString();
      await c.updateOne(
        { _id: id },
        { $set: { name, items, spinSeconds, showHistory, updatedAt: now }, $setOnInsert: { createdAt: now } },
        { upsert: true }
      );
      res.json(ok({ id, name, items, spinSeconds, showHistory }, "wheel saved"));
    } catch (err) { next(err); }
  });

  // ── 後台：刪除轉盤 ──
  router.post("/admin/wheel/delete", requireAdmin, async (req, res, next) => {
    try {
      const id = String(req.body?.id || "").trim();
      if (!id) return res.status(400).json(fail("INVALID_ARGUMENT", "缺少轉盤 id"));
      await (await col()).deleteOne({ _id: id });
      res.json(ok({}, "wheel deleted"));
    } catch (err) { next(err); }
  });

  // ── 公開：overlay 讀取轉盤設定（無密碼；只回顯示需要的欄位）──
  // ?id=xxx 指定轉盤；不帶 id 回傳最早建立的那個（單轉盤使用者免帶參數）
  router.get("/api/wheel/config", async (req, res, next) => {
    try {
      const id = String(req.query.id || "").trim();
      const c = await col();
      const doc = id
        ? await c.findOne({ _id: id })
        : await c.find({}).sort({ createdAt: 1 }).limit(1).next();
      if (!doc) return res.status(404).json(fail("NOT_FOUND", "找不到轉盤，請先到後台建立"));
      res.setHeader("Cache-Control", "no-store"); // overlay 要即時吃到後台改動
      res.json(ok({
        id: doc._id,
        name: doc.name,
        items: doc.items || [],
        spinSeconds: doc.spinSeconds || 6,
        showHistory: doc.showHistory !== false,
        updatedAt: doc.updatedAt
      }));
    } catch (err) { next(err); }
  });

  return router;
}

module.exports = { createAdminWheelRoutes };
