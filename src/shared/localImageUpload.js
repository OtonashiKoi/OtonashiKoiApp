const path = require("path");
const fsp = require("fs/promises");
const sharp = require("sharp");
const { randomUUID } = require("crypto");

function extFromMime(mime) {
  switch (mime) {
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    default:
      return "";
  }
}

function extFromFormat(format) {
  switch (format) {
    case "jpeg":
      return ".jpg";
    case "png":
      return ".png";
    case "webp":
      return ".webp";
    case "gif":
      return ".gif";
    default:
      return "";
  }
}

function normalizeExt(ext) {
  if (!ext) return "";
  const safe = ext.trim().toLowerCase();
  return /^\.[a-z0-9]{1,5}$/.test(safe) ? safe : "";
}

async function uploadImageLocally(filePath, folder, originalName = "", mimeType = "") {
  const baseDir = path.resolve(__dirname, "../web/public/uploads", folder);
  await fsp.mkdir(baseDir, { recursive: true });

  const metadata = await sharp(filePath).metadata().catch(() => ({}));
  const ext =
    normalizeExt(path.extname(originalName)) ||
    extFromMime(mimeType) ||
    extFromFormat(metadata.format) ||
    ".png";

  const fileName = `${randomUUID()}${ext}`;
  const thumbName = `${randomUUID()}.webp`;
  const isGif = ext === ".gif" || metadata.format === "gif" || mimeType === "image/gif";

  const imageUrlPath = path.posix.join("/uploads", folder, fileName);
  const thumbUrlPath = path.posix.join("/uploads", folder, thumbName);

  if (isGif) {
    await fsp.copyFile(filePath, path.join(baseDir, fileName));
    await fsp.copyFile(filePath, path.join(baseDir, thumbName.replace(/\.webp$/, ".gif")));
    await fsp.unlink(filePath).catch(() => {});
    return {
      imageUrl: imageUrlPath,
      imageThumbnailUrl: thumbUrlPath.replace(/\.webp$/, ".gif")
    };
  }

  await sharp(filePath).toFile(path.join(baseDir, fileName));
  await sharp(filePath)
    .resize({ width: 120, height: 120, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 35 })
    .toFile(path.join(baseDir, thumbName));

  await fsp.unlink(filePath).catch(() => {});

  return {
    imageUrl: imageUrlPath,
    imageThumbnailUrl: thumbUrlPath
  };
}

module.exports = {
  uploadImageLocally
};
