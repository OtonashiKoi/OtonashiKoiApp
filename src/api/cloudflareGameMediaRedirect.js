"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const { validateCloudManifest } = require("../services/assets/cloudflareGameMedia");

function createCloudflareGameMediaRedirect(file = path.resolve(__dirname, "../services/assets/cloudflare-media-manifest.json")) {
  let cached, expires = 0;
  async function load() {
    if (cached && expires > Date.now()) return cached;
    let manifest;
    try { manifest = JSON.parse(await fs.readFile(file, "utf8")); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
    validateCloudManifest(manifest);
    const exact = new Map(), staticPaths = new Map();
    for (const asset of manifest.assets) {
      // Remote provider URLs are replayed by the player's service worker.
      if (!asset.url.startsWith("/")) continue;
      exact.set(asset.url, asset);
      if (asset.source === "static" || asset.url.startsWith("/uploads/zones/")) staticPaths.set(new URL(asset.url, "https://otonashikoi.org").pathname, asset);
    }
    cached = { origin: manifest.origin, exact, staticPaths }; expires = Date.now() + 30_000;
    return cached;
  }
  return async (req, res, next) => {
    if (!["GET", "HEAD"].includes(req.method) || /^\/(?:api|auth|admin|uploads\/collection|item-art\/collectible)(?:\/|[.-]|$)/.test(req.path)
      || !/\.(?:png|jpe?g|webp|gif|avif|svg|mp3|m4a|wav|ogg|aac)$/i.test(req.path)) return next();
    try {
      const map = await load(); if (!map) return next();
      const url = new URL(req.originalUrl, "https://otonashikoi.org");
      const revision = url.searchParams.get("gameMediaRevision") || url.searchParams.get("gameImageRevision");
      url.searchParams.delete("gameMediaRevision"); url.searchParams.delete("gameImageRevision");
      const asset = map.exact.get(url.pathname + url.search) || map.staticPaths.get(url.pathname);
      if (!asset || (revision && revision !== asset.revision && revision !== asset.originalRevision)) return next();
      res.set("Cache-Control", "no-store");
      return res.redirect(307, `${map.origin}/${asset.key}`);
    } catch (error) { return next(error); }
  };
}
module.exports = { createCloudflareGameMediaRedirect };
