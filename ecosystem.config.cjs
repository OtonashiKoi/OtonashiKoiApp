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
    // ...existing code...
    // 每小時同步本地 DB → 雲端備份
    {
      name: "db-sync-to-cloud",
      script: "scripts/db-sync-scheduler.js",
      interpreter: "node",
      cwd: ".",
      autorestart: true,
      watch: false,
      max_restarts: 5,
      min_uptime: "10s",
      env_file: ".env",
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
