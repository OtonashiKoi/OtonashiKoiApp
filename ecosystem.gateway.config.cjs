const path = require("node:path");
const os = require("node:os");
module.exports = { apps: [{
  name: "equipmentGateway",
  script: "src/api/runtimeGateway.js",
  cwd: __dirname,
  exec_mode: "fork",
  instances: 1,
  watch: false,
  autorestart: true,
  env: { NODE_ENV: "production", GAME_GATEWAY_PORT: "5568", GAME_ORIGIN_PORT: "5566",
    GAME_GATEWAY_SOCKET: path.join(os.homedir(), ".otonashikoi-runtime", "gateway.sock") },
}] };
