const os = require("os");
const path = require("path");

const isWindows = process.platform === "win32";

// cloudflared 安裝位置：Windows 走 winget，macOS 走 Homebrew
const cloudflaredBin = isWindows
  ? "C:\\Users\\appsk\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Cloudflare.cloudflared_Microsoft.Winget.Source_8wekyb3d8bbwe\\cloudflared.exe"
  : "/opt/homebrew/bin/cloudflared";
const cloudflaredConfig = path.join(os.homedir(), ".cloudflared", "config.yml");

module.exports = {
  apps: [
    {
      name: "equipmentGAME",
      script: "src/index.js",
      cwd: ".",
      autorestart: true,
      watch: false,
      max_restarts: 10,
      min_uptime: "10s",
      cron_restart: "0 18 * * *",
      env_file: ".env",
      env: {
        NODE_ENV: "production",
        STORAGE_DRIVER: "mongo",
        ENABLE_STARTUP_PANEL_REPUBLISH: "0"
      }
    },
    {
      // 對外 Cloudflare 具名通道（otonashikoi.org → localhost:5566）
      // 用一般使用者權限跑 `cloudflared tunnel run`，隨 PM2 與 server/bot 一起啟動。
      name: "cloudflared",
      script: cloudflaredBin,
      args: `--config ${cloudflaredConfig} tunnel run`,
      interpreter: "none",
      autorestart: true,
      watch: false,
      max_restarts: 10,
      min_uptime: "10s"
    }
  ]
};
