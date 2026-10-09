"use strict";
const assert = require("node:assert/strict");
const express = require("express");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { setGameMediaCacheHeaders } = require("../src/api/gameMediaCache");

(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "game-media-cache-"));
  for (const name of ["music.m4a", "image.webp", "index.html", "manifest.json", "game-images-sw.js"]) await fs.writeFile(path.join(directory, name), "fixture");
  const app = express();
  app.use(express.static(directory, { setHeaders(res, file) { if (!setGameMediaCacheHeaders(res, file)) res.setHeader("Cache-Control", "no-store"); } }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const name of ["music.m4a", "image.webp"]) {
      const regular = await fetch(`${origin}/${name}`);
      assert.equal(regular.status, 200);
      assert.match(regular.headers.get("Cache-Control"), /s-maxage=86400/);
      const versioned = await fetch(`${origin}/${name}?gameMediaRevision=${"a".repeat(64)}`);
      assert.match(versioned.headers.get("Cache-Control"), /s-maxage=31536000, immutable/);
      const malformed = await fetch(`${origin}/${name}?gameMediaRevision=invalid`);
      assert(!malformed.headers.get("Cache-Control").includes("immutable"));
    }
    for (const name of ["index.html", "manifest.json", "game-images-sw.js"]) {
      const response = await fetch(`${origin}/${name}?gameMediaRevision=${"a".repeat(64)}`);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
    }
    console.log("PASS: public music/image CDN TTL, versioned immutable media, invalid versions, HTML/manifest/worker remain uncached");
  } finally { await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
