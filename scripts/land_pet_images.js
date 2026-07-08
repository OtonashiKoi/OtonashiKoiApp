"use strict";
/**
 * 寵物立繪落地：下載 HIGGSFIELD 生成圖 → 存 src/web/public/uploads/pets/generated/ →
 * 寫回 pets.imageUrl / imageThumbnailUrl（本地路徑，比照既有龍寵 /uploads/pets/generated/...）。
 * 用法：node scripts/land_pet_images.js <map.json>
 *   map.json = [{ "name": "綠史萊姆", "url": "https://..." }, ...]
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const https = require("https");
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

const OUT_DIR = path.join(__dirname, "..", "src", "web", "public", "uploads", "pets", "generated");

// 檔名 slug（中文名 → 物種 species 欄位當檔名）
function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const get = (u, redirects = 0) => {
      https.get(u, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 5) {
          return get(res.headers.location, redirects + 1);
        }
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${u}`));
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
      }).on("error", reject);
    };
    get(url);
  });
}

async function main() {
  const mapFile = process.argv[2];
  if (!mapFile) { console.error("用法：node scripts/land_pet_images.js <map.json>"); process.exit(1); }
  const list = JSON.parse(fs.readFileSync(mapFile, "utf8"));
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const db = await getMongoDb();
  for (const { name, url, kind } of list) {
    if (kind === "egg") {
      // 蛋是 items（比照神秘龍蛋走 Cloudinary）
      const item = await db.collection("items").findOne({ name, itemType: "pet_egg" });
      if (!item) { console.log(`SKIP 找不到蛋 ${name}`); continue; }
      const tmp = path.join(OUT_DIR, `_tmp-egg-${Date.now()}.png`);
      await download(url, tmp);
      const { uploadImage } = require("../src/shared/cloudinaryUpload.js");
      const { imageUrl, imageThumbnailUrl } = await uploadImage(tmp, "items");
      await db.collection("items").updateOne({ _id: item._id }, { $set: { imageUrl, imageThumbnailUrl, updatedAt: new Date().toISOString() } });
      console.log(`  ✅ ${name.padEnd(8)} → Cloudinary ${imageUrl.slice(0, 60)}...`);
      continue;
    }
    const pet = await db.collection("pets").findOne({ name });
    if (!pet) { console.log(`SKIP 找不到物種 ${name}`); continue; }
    const slug = pet.species || name;
    const filename = `${slug}-pixel.png`;
    const dest = path.join(OUT_DIR, filename);
    await download(url, dest);
    const rel = `/uploads/pets/generated/${filename}`;
    await db.collection("pets").updateOne({ _id: pet._id }, { $set: { imageUrl: rel, imageThumbnailUrl: rel, updatedAt: new Date().toISOString() } });
    console.log(`  ✅ ${name.padEnd(8)} → ${rel} (${Math.round(fs.statSync(dest).size / 1024)}KB)`);
  }
  console.log("完成。");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
