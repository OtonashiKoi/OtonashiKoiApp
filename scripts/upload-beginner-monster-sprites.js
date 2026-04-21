"use strict";
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const { MongoClient } = require("mongodb");
const cloudinary = require("cloudinary").v2;
const path = require("path");
const fs = require("fs");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const SPRITE_DIR = path.join(__dirname, "monster-sprites");

// seq → 檔名對應
const SPRITES = [
  { seq: 1, file: "beginner_1_slime_tiny.png",  name: "小史(超小)" },
  { seq: 2, file: "beginner_2_rabbit.png",       name: "野兔" },
  { seq: 3, file: "beginner_3_mushroom.png",     name: "蘑菇怪" },
  { seq: 4, file: "beginner_4_slime_mid.png",    name: "小史(中)" },
  { seq: 5, file: "beginner_5_boss_rabbit.png",  name: "大野兔(B)" },
];

async function uploadSprite(filePath, publicId) {
  const result = await cloudinary.uploader.upload(filePath, {
    public_id: publicId,
    folder: "monsters/beginner",
    overwrite: true,
  });
  return {
    imageUrl: result.secure_url,
    imageThumbnailUrl: result.eager?.[0]?.secure_url || result.secure_url,
  };
}

async function main() {
  const client = new MongoClient("mongodb://localhost:27017");
  await client.connect();
  const db = client.db("equipment_game");
  const col = db.collection("monsters");

  for (const s of SPRITES) {
    const filePath = path.join(SPRITE_DIR, s.file);
    if (!fs.existsSync(filePath)) {
      console.warn(`[SKIP] 找不到檔案: ${s.file}`);
      continue;
    }

    console.log(`[上傳] ${s.name} ...`);
    const publicId = `beginner_${s.seq}_${s.name.replace(/[()]/g, "")}`;
    const { imageUrl } = await uploadSprite(filePath, publicId);
    console.log(`  ✓ URL: ${imageUrl}`);

    const res = await col.updateOne(
      { zone: "beginner", seq: s.seq },
      { $set: { imageUrl, updatedAt: new Date().toISOString() } }
    );
    if (res.matchedCount === 0) {
      console.warn(`  ⚠ 找不到 zone=beginner seq=${s.seq} 的怪物`);
    } else {
      console.log(`  ✓ MongoDB 已更新`);
    }
  }

  await client.close();
  console.log("\n全部完成！");
}

main().catch(err => { console.error(err); process.exit(1); });
