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
      // 記憶體逼近上限就先乾淨重啟,趕在硬 OOM 崩潰前,避免程序死掉卡住
      max_memory_restart: "800M",
      // 提高重啟容忍度:避免短時間內幾次崩潰就被 PM2 放棄(造成服務一直躺著)
      max_restarts: 50,
      min_uptime: "10s",
      // 正常重啟先停止接新連線，最多保留 20 秒讓已進行中的戰鬥回應送完。
      kill_timeout: 20000,
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
