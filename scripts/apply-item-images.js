"use strict";
/**
 * 把 resolved.json (itemId -> rawUrl PNG) 套用到 items：
 *   imageUrl = rawUrl、imageThumbnailUrl = rawUrl 換成 _min.webp
 * 冪等；只更新有給 URL 的道具。
 */
require("dotenv").config();
const fs = require("fs");
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const RESOLVED = process.env.RESOLVED_PATH;

(async () => {
  const map = JSON.parse(fs.readFileSync(RESOLVED, "utf8"));
  const db = await getMongoDb();
  const items = db.collection("items");
  let ok = 0, miss = 0;
  const NOW = new Date().toISOString();
  for (const [id, rawUrl] of Object.entries(map)) {
    if (!rawUrl || !/^https?:\/\//.test(rawUrl)) { console.log("⚠️ 跳過(無效URL):", id); continue; }
    const thumb = rawUrl.replace(/\.png$/i, "_min.webp");
    const r = await items.updateOne({ id }, { $set: { imageUrl: rawUrl, imageThumbnailUrl: thumb, updatedAt: NOW } });
    if (r.matchedCount) { ok++; }
    else { miss++; console.log("⚠️ 找不到道具:", id); }
  }
  console.log(`\n完成：更新 ${ok} 個道具圖片${miss ? `（${miss} 個找不到）` : ""}。`);
  // 回報還有多少無圖
  const left = await items.countDocuments({ $or: [ {imageUrl:{$in:[null,""]}}, {imageUrl:{$exists:false}} ] });
  console.log("道具庫剩餘無圖:", left);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
