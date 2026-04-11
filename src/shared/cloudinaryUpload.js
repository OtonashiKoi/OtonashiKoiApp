const cloudinary = require("cloudinary").v2;
const sharp = require("sharp");
const fsp = require("fs/promises");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * 上傳圖片到 Cloudinary，回傳 { imageUrl, imageThumbnailUrl }
 * @param {string} filePath - multer 存到本機的暫存路徑
 * @param {string} folder   - Cloudinary 資料夾，例如 "items" 或 "monsters"
 */
async function uploadImage(filePath, folder) {
  // 上傳原圖
  const result = await cloudinary.uploader.upload(filePath, {
    folder: `equipment-game/${folder}`,
    resource_type: "image",
  });

  // 用 sharp 產生縮圖 buffer，再上傳
  const thumbBuffer = await sharp(filePath)
    .resize({ width: 120, height: 120, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 35 })
    .toBuffer();

  const thumbResult = await new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: `equipment-game/${folder}`, resource_type: "image", format: "webp" },
      (err, res) => (err ? reject(err) : resolve(res))
    );
    stream.end(thumbBuffer);
  });

  // 清掉 multer 暫存檔
  await fsp.unlink(filePath).catch(() => {});

  return {
    imageUrl: result.secure_url,
    imageThumbnailUrl: thumbResult.secure_url,
  };
}

module.exports = { uploadImage };
