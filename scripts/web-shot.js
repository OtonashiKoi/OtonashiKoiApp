"use strict";
/**
 * 開發用：截 game.html 任一區塊的畫面，讓 AI 能實際看到 UI。
 * 用法：
 *   node scripts/web-shot.js --section=inventory --device=mobile --id=575308041109372930 --out=tmp/inv.png
 * 參數：
 *   --section  要看的區塊 id（home/inventory/equip/enhance/zones/tower/pk/casino/pet/shop/auction/chat/quests/checkin/invite/txn/worldboss）
 *   --device   desktop（預設）| mobile
 *   --id       mock 登入的 discordId（預設測試帳號）
 *   --base     API/網站 base（預設 http://localhost:5566）
 *   --out      輸出 png 路徑（預設 tmp/shot.png）
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : def;
}

(async () => {
  const base = arg("base", "http://localhost:5566");
  const section = arg("section", "home");
  const device = arg("device", "desktop");
  const id = arg("id", "");
  const out = arg("out", "tmp/shot.png");
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });

  // mock 登入拿 token
  const res = await fetch(`${base}/api/auth/discord`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: "mock:" + id }),
  });
  const j = await res.json();
  const token = j?.data?.token;
  if (!token) { console.error("登入失敗：", JSON.stringify(j)); process.exit(1); }

  const viewport = device === "mobile"
    ? { width: 390, height: 844 }
    : { width: 1280, height: 860 };

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: device === "mobile" });
  await ctx.addInitScript((tok) => { try { localStorage.setItem("eg_token", tok); } catch (_) {} }, token);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.error("[pageerror]", e.message));

  await page.goto(`${base}/game.html`, { waitUntil: "networkidle" });
  await page.waitForSelector("#app.ready", { timeout: 15000 }).catch(() => {});
  if (section && section !== "home") {
    await page.evaluate((s) => window.route && window.route(s), section);
  }
  await page.waitForTimeout(1100);
  await page.screenshot({ path: out, fullPage: device !== "mobile" });
  await browser.close();
  console.log("OK ->", out, `(${device}, section=${section})`);
})().catch((e) => { console.error(e); process.exit(1); });
