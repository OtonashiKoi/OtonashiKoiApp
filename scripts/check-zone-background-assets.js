"use strict";

// Check expected URLs, not just files that already exist in the media directory.
const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { getPublicZoneKeys } = require("../src/shared/zones");
const { validateCloudManifest } = require("../src/services/assets/cloudflareGameMedia");
const root = path.resolve(__dirname, "../src/web/public");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");

async function checkZoneBackgroundAssets({ publicReadback = false } = {}) {
  const manifest = JSON.parse(await fs.readFile(path.resolve(__dirname, "../src/services/assets/cloudflare-media-manifest.json"), "utf8"));
  const cloud = validateCloudManifest(manifest);
  const results = [], failures = [];
  for (const zone of getPublicZoneKeys()) {
    const url = `/uploads/zones/${zone}.webp`;
    try {
      const bytes = await fs.readFile(path.join(root, url));
      const revision = hash(bytes), entry = cloud.get(url);
      if (!entry || entry.originalRevision !== revision || entry.revision !== revision || entry.bytes !== bytes.length) throw new Error("Cloudflare mapping is missing or stale");
      const item = { zone, url, revision, bytes: bytes.length };
      if (publicReadback) {
        const response = await fetch(`https://otonashikoi.org${url}?zoneAssetAudit=${revision}`, { signal: AbortSignal.timeout(20_000) });
        if (!response.ok || !response.url.startsWith(`${manifest.origin}/media/`) || !response.headers.get("content-type")?.startsWith("image/")) throw new Error(`Invalid public image response: ${response.status}`);
        if (hash(Buffer.from(await response.arrayBuffer())) !== revision) throw new Error("Public image bytes differ from local art");
        item.status = response.status; item.downloadUrl = response.url;
      }
      results.push(item);
    } catch (error) { failures.push({ zone, url, error: error.message }); }
  }
  return { scope: "public zone background URLs; disabled and private preview zones excluded", checked: results.length + failures.length, results, failures };
}

if (require.main === module) checkZoneBackgroundAssets({ publicReadback: process.argv.includes("--public") }).then(result => {
  console.log(JSON.stringify(result, null, 2));
  if (result.failures.length) process.exitCode = 1;
}).catch(error => { console.error(error.message); process.exitCode = 1; });

module.exports = { checkZoneBackgroundAssets };
