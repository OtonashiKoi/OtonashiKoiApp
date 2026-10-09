"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs/promises"), os = require("node:os"), path = require("node:path");
const express = require("express");
const { createCloudflareGameMediaRedirect } = require("../src/api/cloudflareGameMediaRedirect");
(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "otonashi-cdn-redirect-")), file = path.join(dir, "manifest.json");
  const revision = "a".repeat(64), origin = "https://otonashi-game-media.otonashikoi1228.workers.dev";
  await fs.writeFile(file, JSON.stringify({ origin, excludedCollections: true, assets: [
    { url: "/bgm/music.mp3", source: "static", revision, originalRevision: revision, bytes: 10, key: `media/${revision}.mp3` },
    { url: "/uploads/items/icon.png?art=v1", source: "catalog", revision, originalRevision: revision, bytes: 10, key: `media/${revision}.png` }
  ] }));
  const app = express(); app.use(createCloudflareGameMediaRedirect(file)); app.use((_req, res) => res.sendStatus(204));
  const server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const [url, method] of [["/bgm/music.mp3", "GET"], ["/bgm/music.mp3?v=2", "HEAD"], [`/bgm/music.mp3?gameMediaRevision=${revision}`, "GET"], ["/uploads/items/icon.png?art=v1", "GET"]]) {
      const response = await fetch(base + url, { method, redirect: "manual" }); assert.equal(response.status, 307); assert(response.headers.get("location").startsWith(origin + "/media/")); assert.equal(response.headers.get("cache-control"), "no-store");
    }
    for (const url of ["/api/me/profile", "/api/private.png", "/auth/a.png", "/uploads/collection/private.png", "/bgm/missing.mp3", "/uploads/items/icon.png?art=v2", "/bgm/music.mp3?gameMediaRevision=old"]) assert.equal((await fetch(base + url, { redirect: "manual" })).status, 204);
    assert.equal((await fetch(base + "/bgm/music.mp3", { method: "POST" })).status, 204);
    console.log("PASS: old player image/audio URLs redirect to Cloudflare; exact item versions, GET/HEAD, stale hashes, API/auth/collection exclusions");
  } finally { await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
