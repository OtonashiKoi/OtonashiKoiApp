"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

async function main() {
  const sharp = require("sharp");
  const webp = await sharp(Buffer.from('<svg width="32" height="32"><rect width="32" height="32" fill="red"/></svg>')).resize(16, 16).webp().toBuffer();
  assert.equal((await sharp(webp).metadata()).width, 16);
  const XLSX = require("xlsx"); const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet([{ player: "音無恋", level: 50 }]), "測試");
  const exported = XLSX.write(book, { type: "buffer", bookType: "xlsx" });
  assert.deepEqual(XLSX.utils.sheet_to_json(XLSX.read(exported).Sheets["測試"]), [{ player: "音無恋", level: 50 }]);
  const express = require("express"), multer = require("multer");
  const app = express();
  app.post("/upload", multer({ storage: multer.memoryStorage(), limits: { fileSize: 64 } }).single("image"), (req, res) => res.json({ size: req.file.size }));
  app.use((error, _req, res, _next) => res.status(413).json({ code: error.code }));
  app.get("/ping", (_req, res) => res.json({ ok: true }));
  const server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    const form = new FormData(); form.append("image", new Blob(["valid-image-test"]), "test.png");
    assert.equal((await fetch(`${url}/upload`, { method: "POST", body: form })).status, 200);
    const tooLarge = new FormData(); tooLarge.append("image", new Blob([Buffer.alloc(65)]), "large.png");
    const denied = await fetch(`${url}/upload`, { method: "POST", body: tooLarge });
    assert.equal(denied.status, 413); assert.equal((await denied.json()).code, "LIMIT_FILE_SIZE");
    assert.equal((await require("axios").get(`${url}/ping`)).data.ok, true);
    assert.equal((await fetch(`${url}/ping`)).status, 200);
  } finally { await new Promise(resolve => server.close(resolve)); }
  const pm2Require = require("node:module").createRequire(require.resolve("pm2/package.json"));
  assert.equal(pm2Require("js-yaml").load("apps:\n  - name: test\n    watch: false").apps[0].watch, false);
  const { Address4, Address6 } = pm2Require("ip-address");
  assert.equal(Address4.isValid("127.0.0.1"), true); assert.equal(Address6.isValid("::1"), true);
  assert.equal(typeof pm2Require("basic-ftp").Client, "function");
  const chokidar = pm2Require("chokidar");
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "koi-dependency-watch-"));
  const watcher = chokidar.watch(temp, { ignoreInitial: true });
  try {
    await new Promise((resolve, reject) => { watcher.once("ready", resolve); watcher.once("error", reject); });
    const event = new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error("watch event missing")), 3000);
      watcher.once("add", file => { clearTimeout(timer); resolve(file); }); });
    const file = path.join(temp, "fixture.txt"); await fs.writeFile(file, "test"); assert.equal(await event, file);
  } finally { await watcher.close(); await fs.rm(temp, { recursive: true }); }
  console.log("PASS: Sharp SVG/WebP, SheetJS Excel export, Multer upload/limit, tunnel Axios request, PM2 YAML/IP/FTP and watcher compatibility");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
