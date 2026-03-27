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
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
