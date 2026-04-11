/**
 * 遷移本機圖片到 Cloudinary
 * 用法：node scripts/migrate-images-to-cloudinary.js
 *
 * 執行流程：
 * 1. 從 MongoDB 讀取所有 items 和 monsters
 * 2. 找出 imageUrl 還是 /uploads/... 的本機路徑
 * 3. 上傳對應本機檔案到 Cloudinary
 * 4. 更新 MongoDB 裡的 imageUrl / imageThumbnailUrl
 */

require("dotenv").config();

const path = require("path");
const fs = require("fs");
const { MongoClient } = require("mongodb");
const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const UPLOADS_ROOT = path.resolve(__dirname, "../src/web/public");

async function uploadFile(localPath, folder) {
  const result = await cloudinary.uploader.upload(localPath, {
    folder: `equipment-game/${folder}`,
    resource_type: "image",
  });
  return result.secure_url;
}

async function migrateCollection(db, collectionName, folder) {
  const col = db.collection(collectionName);
  const docs = await col.find({
    imageUrl: { $regex: "^/uploads/" }
  }).toArray();

  console.log(`\n[${collectionName}] 找到 ${docs.length} 筆需要遷移`);

  let success = 0, skip = 0, fail = 0;

  for (const doc of docs) {
    const localImagePath = path.join(UPLOADS_ROOT, doc.imageUrl);
    const localThumbPath = doc.imageThumbnailUrl
      ? path.join(UPLOADS_ROOT, doc.imageThumbnailUrl)
      : null;

    if (!fs.existsSync(localImagePath)) {
      console.log(`  ⚠️  跳過（本機檔案不存在）: ${doc.imageUrl}`);
      skip++;
      continue;
    }

    try {
      const newImageUrl = await uploadFile(localImagePath, folder);

      let newThumbUrl = newImageUrl; // fallback
      if (localThumbPath && fs.existsSync(localThumbPath)) {
        newThumbUrl = await uploadFile(localThumbPath, folder);
      }

      await col.updateOne(
        { _id: doc._id },
        { $set: { imageUrl: newImageUrl, imageThumbnailUrl: newThumbUrl } }
      );

      console.log(`  ✅ ${doc.name || doc._id} → ${newImageUrl}`);
      success++;
    } catch (e) {
      console.error(`  ❌ ${doc.name || doc._id} 失敗: ${e.message}`);
      fail++;
    }
  }

  console.log(`  完成：成功 ${success}，跳過 ${skip}，失敗 ${fail}`);
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB_NAME || "equipment_game");

  console.log("=== 開始遷移圖片到 Cloudinary ===");

  await migrateCollection(db, "items", "items");
  await migrateCollection(db, "monsters", "monsters");

  // shopItems 的 imageUrl 通常跟 items 同步，但也一起更新
  await migrateCollection(db, "shopItems", "items");

  await client.close();
  console.log("\n=== 遷移完成 ===");
}

main().catch((e) => {
  console.error("遷移失敗:", e);
  process.exit(1);
});
