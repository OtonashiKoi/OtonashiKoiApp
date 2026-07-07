const cloudinary = require("cloudinary").v2;
const sharp = require("sharp");
const fsp = require("fs/promises");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/** 在 Cloudinary URL 的 /upload/ 後插入最佳化參數（已有則不動）。非 Cloudinary URL 原樣回傳。
 *  opts.trim=true 會加 e_trim（裁掉透明邊→立繪貼齊角色框，顯示才會真正置中）。*/
function withAutoOptimize(url, opts = {}) {
  if (!url || typeof url !== "string") return url;
  if (!url.includes("res.cloudinary.com") || !url.includes("/upload/")) return url;
  if (/\/upload\/[^/]*(f_auto|q_auto|e_trim)/.test(url)) return url; // 已有轉換就不重複
  const t = opts.trim ? "e_trim," : "";
  return url.replace("/upload/", `/upload/${t}f_auto,q_auto/`);
}

/**
 * 上傳圖片到 Cloudinary，回傳 { imageUrl, imageThumbnailUrl }
 * imageUrl 自動套 f_auto,q_auto（+ e_trim 當 opts.trim，供立繪去背貼齊）。
 * @param {string} filePath - multer 存到本機的暫存路徑
 * @param {string} folder   - Cloudinary 資料夾，例如 "items" 或 "monsters"
 * @param {{trim?:boolean, noThumb?:boolean}} [opts] - trim=立繪去背裁邊置中；noThumb=不另存120px縮圖(劇情立繪/背景用不到，避免圖庫多一份小圖)
 */
async function uploadImage(filePath, folder, opts = {}) {
  // 上傳原圖
  const result = await cloudinary.uploader.upload(filePath, {
    folder: `equipment-game/${folder}`,
    resource_type: "image",
  });

  // 縮圖：只有需要的地方(道具/怪物/商店後台格線)才產；劇情立繪/背景 noThumb → 只留一份高解析原圖
  let thumbUrl = null;
  if (!opts.noThumb) {
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
    thumbUrl = thumbResult.secure_url;
  }

  // 清掉 multer 暫存檔
  await fsp.unlink(filePath).catch(() => {});

  return {
    imageUrl: withAutoOptimize(result.secure_url, opts),
    imageThumbnailUrl: thumbUrl,
  };
}

/**
 * 上傳音訊（配音/語音）到 Cloudinary，回傳 { audioUrl }。
 * Cloudinary 的音訊走 resource_type "video"。
 */
async function uploadAudio(filePath, folder) {
  const result = await cloudinary.uploader.upload(filePath, {
    folder: `equipment-game/${folder}`,
    resource_type: "video"
  });
  await fsp.unlink(filePath).catch(() => {});
  return { audioUrl: result.secure_url };
}

module.exports = { uploadImage, uploadAudio, withAutoOptimize };
