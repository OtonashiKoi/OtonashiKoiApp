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
      env_file: ".env",
      env: {
        NODE_ENV: "production",
        STORAGE_DRIVER: "mongo"
      }
    },
    {
      name: "commentFetcher",
      script: "src/bot/commentFetcher.js",
      cwd: ".",
      autorestart: true,
      watch: false,
      max_restarts: 10,
      min_uptime: "10s",
      env_file: ".env",
      env: {
        NODE_ENV: "production"
      }
    }
    ,
    // 定期清除今日打卡紀錄：預設排程為台灣時間每天 23:59
    // 注意：PM2 的 cron_restart 使用主機的時區時間，如果主機時區不是 Asia/Taipei，請調整下面的 cron 字串為對應的時刻（或在主機上設定 TZ）。
    {
      name: "clear-today-checkins",
      script: "scripts/clear-today-checkins.js",
      interpreter: "node",
      cwd: ".",
      autorestart: false,
      watch: false,
      // 每天 23:59 執行（主機時區為台灣時區時）
      cron_restart: "59 23 * * *",
      env_file: ".env",
      env: {
        NODE_ENV: "production",
        // 使用 mongo 驅動以對接雲端 DB，請在 .env 或系統環境設定 MONGODB_URI 與 MONGODB_DB_NAME
        STORAGE_DRIVER: "mongo"
      }
    }
  ]
};
