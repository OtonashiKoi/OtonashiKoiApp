"use strict";
/**
 * go-live.js — 一鍵開播腳本
 * 1. 啟動/重啟 PM2 伺服器
 * 2. 開啟 Cloudflare Tunnel，取得公開網址
 * 3. 更新前端 config、build、推上 GitHub Pages
 * 4. 印出玩家連結，保持 Tunnel 存活直到 Ctrl+C
 */

const { execSync, spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const ROOT = path.resolve(__dirname, "..");
const PLAYER_WEB = path.join(ROOT, "player-web");
const CONFIG_PATH = path.join(PLAYER_WEB, "src", "config.json");
const DOCS_DIR = path.join(ROOT, "docs");

// cloudflared 可能在 PATH 或 winget 安裝位置
const CF_WINGET = path.join(
  process.env.LOCALAPPDATA || "",
  "Microsoft\\WinGet\\Packages\\Cloudflare.cloudflared_Microsoft.Winget.Source_8wekyb3d8bbwe\\cloudflared.exe"
);

function log(msg) {
  const time = new Date().toLocaleTimeString("zh-TW");
  console.log(`[${time}] ${msg}`);
}

function findCloudflared() {
  try {
    execSync("cloudflared --version", { stdio: "pipe" });
    return "cloudflared";
  } catch {}
  if (fs.existsSync(CF_WINGET)) return CF_WINGET;
  throw new Error(
    "找不到 cloudflared，請先執行：winget install --id Cloudflare.cloudflared"
  );
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true });
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dest, name);
    fs.statSync(s).isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d);
  }
}

function startTunnel(cfPath) {
  return new Promise((resolve, reject) => {
    log("🌐 正在建立 Cloudflare Tunnel...");
    const proc = spawn(cfPath, ["tunnel", "--url", "http://localhost:5566"], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error("Tunnel 啟動超時（30 秒），請確認 5566 port 有在跑"));
    }, 30000);

    const onData = (chunk) => {
      const text = chunk.toString();
      const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match) {
        clearTimeout(timer);
        resolve({ url: match[0], proc });
      }
    };

    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
    proc.on("error", (err) => { clearTimeout(timer); reject(err); });
    proc.on("exit", (code) => {
      if (code !== 0 && code !== null) {
        clearTimeout(timer);
        reject(new Error(`cloudflared 異常退出，code=${code}`));
      }
    });
  });
}

async function main() {
  console.log("\n========================================");
  console.log("  ⚔️  Equipment Game — 一鍵開播腳本");
  console.log("========================================\n");

  // ── Step 1: PM2 ──────────────────────────────
  log("🚀 啟動 PM2 伺服器...");
  try {
    execSync("npx pm2 restart equipmentGAME --update-env", {
      cwd: ROOT,
      stdio: "inherit",
    });
  } catch {
    execSync("npx pm2 start ecosystem.config.cjs", {
      cwd: ROOT,
      stdio: "inherit",
    });
  }
  log("✅ PM2 已啟動\n");

  // ── Step 2: Cloudflare Tunnel ─────────────────
  const cfPath = findCloudflared();
  const { url, proc } = await startTunnel(cfPath);
  log(`✅ Tunnel 網址：${url}\n`);

  // ── Step 3: 更新 config.json ──────────────────
  log("📝 更新前端 API 設定...");
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  cfg.remoteApiUrl = url;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));

  // ── Step 4: Build 前端 ────────────────────────
  log("📦 Building 前端...");
  execSync("npm install --silent", { cwd: PLAYER_WEB, stdio: "inherit" });
  execSync("npm run build", { cwd: PLAYER_WEB, stdio: "inherit" });
  copyDir(path.join(PLAYER_WEB, "dist"), DOCS_DIR);
  log("✅ Build 完成\n");

  // ── Step 5: Git push ──────────────────────────
  log("🔼 推送到 GitHub...");
  execSync("git add docs/ player-web/src/config.json", { cwd: ROOT, stdio: "inherit" });
  try {
    execSync(`git commit -m "chore: go-live (API=${url})"`, {
      cwd: ROOT,
      stdio: "inherit",
    });
    execSync("git push", { cwd: ROOT, stdio: "inherit" });
    log("✅ 已推送到 GitHub\n");
  } catch {
    log("（無新變更，略過 commit）\n");
  }

  // ── 完成 ──────────────────────────────────────
  console.log("========================================");
  console.log("  🎉 開播完成！");
  console.log(`  玩家連結：https://otonashikoi.github.io/OtonashiKoiApp/`);
  console.log(`  API：${url}`);
  console.log("  ⚠️  請保持此視窗開著，關掉後 Tunnel 會中斷");
  console.log("  按 Ctrl+C 結束\n");

  // 保持 Tunnel 存活，並偵測異常斷線
  proc.stderr.on("data", (d) => {
    const t = d.toString();
    if (t.includes("ERR") || t.includes("error")) {
      process.stdout.write(`[Tunnel] ${t}`);
    }
  });

  proc.on("exit", () => {
    log("⚠️  Tunnel 已中斷，請重新執行 npm run go-live");
    process.exit(1);
  });

  process.on("SIGINT", () => {
    log("\n👋 結束中...");
    proc.kill();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(`\n❌ 錯誤：${err.message}`);
  process.exit(1);
});
