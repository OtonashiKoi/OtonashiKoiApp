// 一次性遷移：把 DB 中 /uploads/... 的本機圖片重新上傳到 Cloudinary 並更新 URL。
// 背景：2026-05-06 起後台上傳曾改存本機，與舊版 Cloudinary 流程不一致，
//       造成跨機器/部署的圖片不同步。本腳本統一回 Cloudinary。
// 用法：node scripts/migrate-local-images-to-cloudinary.js [--dry-run]
require("dotenv").config();
const path = require("path");
const fsp = require("fs/promises");
const os = require("os");
const { MongoClient } = require("mongodb");
const { uploadImage } = require("../src/shared/cloudinaryUpload");

const DRY = process.argv.includes("--dry-run");
const UPLOADS_ROOT = path.resolve(__dirname, "../src/web/public");

// collection → Cloudinary 資料夾（與後台上傳路由一致）
const TARGETS = [
  { coll: "monsters", folder: "monsters" },
  { coll: "items", folder: "items" },
  { coll: "shopItems", folder: "shop_items" },
];

async function migrateDoc(db, collName, folder, doc, cache) {
  const localUrl = String(doc.imageUrl || "");
  if (!localUrl.startsWith("/uploads/")) return null;

  // 同一個檔案可能被多筆引用（怪物與其卡片共用圖）→ 上傳一次重複使用
  if (!cache.has(localUrl)) {
    const filePath = path.join(UPLOADS_ROOT, localUrl);
    await fsp.access(filePath); // 不存在會 throw
    if (DRY) {
      cache.set(localUrl, { imageUrl: "(dry-run)", imageThumbnailUrl: "(dry-run)" });
    } else {
      // uploadImage 會刪掉來源檔，所以先複製到 tmp 再上傳，保留本機原檔
      const tmp = path.join(os.tmpdir(), `migrate-${Date.now()}-${path.basename(filePath)}`);
      await fsp.copyFile(filePath, tmp);
      cache.set(localUrl, await uploadImage(tmp, folder));
    }
  }
  const { imageUrl, imageThumbnailUrl } = cache.get(localUrl);
  if (!DRY) {
    await db.collection(collName).updateOne(
      { _id: doc._id },
      { $set: { imageUrl, imageThumbnailUrl, updatedAt: new Date().toISOString() } }
    );
  }
  return { name: doc.name || doc.itemName || String(doc._id), from: localUrl, to: imageUrl };
}

// 商店道具沒填圖時，從道具庫（itemLibraryId）補上（庫圖此時已是 Cloudinary）
async function backfillShopImages(db) {
  const shop = await db.collection("shopItems").find({
    $and: [
      { $or: [{ imageUrl: { $in: [null, ""] } }, { imageUrl: { $exists: false } }] },
      { itemLibraryId: { $exists: true, $ne: null } },
    ],
  }).toArray();
  let filled = 0;
  for (const s of shop) {
    const lib = await db.collection("items").findOne({ id: s.itemLibraryId });
    if (!lib?.imageUrl) continue;
    if (DRY) { filled++; console.log(`  ↪ (dry) 商店 ${s.name} ← 庫圖`); continue; }
    await db.collection("shopItems").updateOne(
      { _id: s._id },
      { $set: { imageUrl: lib.imageUrl, imageThumbnailUrl: lib.imageThumbnailUrl || lib.imageUrl, updatedAt: new Date().toISOString() } }
    );
    filled++;
    console.log(`  ↪ 商店 ${s.name} ← 庫圖 ${String(lib.imageUrl).slice(0, 70)}`);
  }
  return filled;
}

async function migrateOneDb(uri, label) {
  const cli = new MongoClient(uri);
  await cli.connect();
  const db = cli.db("equipmentGame");
  const cache = new Map();
  let okCount = 0, failCount = 0;

  for (const { coll, folder } of TARGETS) {
    const docs = await db.collection(coll)
      .find({ $or: [{ imageUrl: /^\/uploads\// }, { imageThumbnailUrl: /^\/uploads\// }] })
      .toArray();
    if (docs.length) console.log(`\n[${label}] ${coll}：${docs.length} 筆 /uploads 需遷移`);
    for (const doc of docs) {
      try {
        const r = await migrateDoc(db, coll, folder, doc, cache);
        if (r) { console.log(`  ✅ ${r.name} → ${String(r.to).slice(0, 70)}`); okCount++; }
      } catch (err) {
        console.error(`  ❌ ${doc.name || doc.itemName}: ${err.message}`);
        failCount++;
      }
    }
  }
  // 庫圖搬完再補商店空圖
  const filled = await backfillShopImages(db);
  console.log(`\n[${label}] 遷移 ${okCount} 筆、商店補圖 ${filled} 筆、失敗 ${failCount} 筆`);
  await cli.close();
  return failCount;
}

(async () => {
  let fails = 0;
  fails += await migrateOneDb("mongodb://127.0.0.1:27017/equipmentGame", "本機");
  if (process.env.MONGODB_CLOUD_URI) fails += await migrateOneDb(process.env.MONGODB_CLOUD_URI, "雲端");
  console.log(`\n全部完成${DRY ? "（dry-run）" : ""}，總失敗 ${fails} 筆`);
  process.exit(fails > 0 ? 1 : 0);
})().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
