"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const DEFAULT_PATH = path.join(__dirname, "cloudflare-media-manifest.json");
const CDN_ORIGINS = new Set(["https://assets.otonashikoi.org", "https://otonashi-game-media.otonashikoi1228.workers.dev"]);

function validateCloudManifest(manifest) {
  if (!manifest.excludedCollections || !CDN_ORIGINS.has(manifest.origin) || !Array.isArray(manifest.assets)) throw new Error("Invalid Cloudflare game media manifest");
  const entries = new Map();
  for (const asset of manifest.assets) {
    if (!/^[a-f0-9]{64}$/.test(asset.revision) || !/^[a-f0-9]{64}$/.test(asset.originalRevision)
      || !Number.isSafeInteger(asset.bytes) || asset.bytes <= 0
      || !new RegExp(`^media/${asset.revision}\\.(?:png|jpe?g|webp|gif|avif|svg|mp3|m4a|wav|ogg|aac)$`).test(asset.key)
      || entries.has(asset.url)) throw new Error("Invalid Cloudflare game media entry");
    entries.set(asset.url, asset);
  }
  return entries;
}

function applyCloudManifest(assets, manifest) {
  const index = validateCloudManifest(manifest), available = [], unavailable = [];
  // Only the current, collection-filtered catalog can select entries from this release map.
  for (const asset of assets) {
    const cloud = index.get(asset.url);
    const sourceRevision = asset.sourceRevision || asset.revision;
    if (!cloud || cloud.originalRevision !== sourceRevision) { unavailable.push(asset.url); continue; }
    available.push({ ...asset, sourceRevision, revision: cloud.revision, bytes: cloud.bytes, integrity: true,
      downloadUrl: `${manifest.origin}/${cloud.key}` });
  }
  return { assets: available, unavailable, delivery: "cloudflare-static-assets", cdnOrigin: manifest.origin };
}

async function attachCloudflareGameMedia(assets, file = DEFAULT_PATH) {
  let json;
  try { json = await fs.readFile(file, "utf8"); }
  catch (error) { if (error.code === "ENOENT") return { assets, unavailable: [] }; throw error; }
  return applyCloudManifest(assets, JSON.parse(json));
}

module.exports = { attachCloudflareGameMedia, applyCloudManifest, validateCloudManifest };
