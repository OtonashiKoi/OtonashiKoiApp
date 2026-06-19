// 測試站（staging）PM2 設定 —— 與正式站並存於同一台機器
// 重點：
//   - port 5577（正式站 5566，互不干擾）
//   - API_ONLY=1：不登入 Discord bot、不註冊 slash 指令（避免搶正式站的唯一 bot token）
//   - MONGODB_DB_NAME=equipmentGame_test：獨立測試資料庫（不碰正式玩家資料）
//   - STAGING_ONLY_ADMIN_SS=1：登入只放行 管理員 / SS 階（見 playerAppRoutes /api/auth/discord）
//   - STAGING_EXTRA_ALLOW：額外白名單 discordId（逗號分隔），保險用
// 機密（MONGODB_URI / JWT_SECRET / DISCORD_CLIENT_*）沿用同目錄 .env，env 區塊只覆寫 staging 專屬值。

module.exports = {
  apps: [
    {
      name: "equipmentGAME-staging",
      script: "src/index.js",
      cwd: __dirname,
      autorestart: true,
      watch: false,
      max_memory_restart: "600M",
      max_restarts: 50,
      min_uptime: "10s",
      env_file: ".env",
      env: {
        NODE_ENV: "production",
        STORAGE_DRIVER: "mongo",
        API_PORT: "5577",
        API_ONLY: "1",
        MONGODB_DB_NAME: "equipmentGame_test",
        STAGING_ONLY_ADMIN_SS: "1",
        STAGING_EXTRA_ALLOW: "865264891991425055",
        ENABLE_STARTUP_PANEL_REPUBLISH: "0"
      }
    }
  ]
};
