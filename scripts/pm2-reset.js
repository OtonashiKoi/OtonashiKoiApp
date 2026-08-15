const { spawnSync } = require("node:child_process");

function run(command, args, options = {}) {
  const executable = process.platform === "win32" ? "npx.cmd" : "npx";
  const result = spawnSync(executable, args, {
    stdio: "inherit",
    shell: false,
    ...options
  });
  return result.status || 0;
}

const processName = "equipmentGAME";

// Ignore delete errors (e.g. process does not exist yet)
run("pm2", ["delete", processName]);

// PM2 已先用正常訊號關閉受管程序；這時才清理可能殘留、且不受 PM2 管理的舊程序。
// 不可在 delete/restart 前 kill -9，否則進行中的戰鬥雖已寫入，HTTP 結算回應會被直接切斷。
run("node", ["scripts/free-port.js"]);

const startCode = run("pm2", ["start", "ecosystem.config.cjs", "--only", processName]);
if (startCode !== 0) {
  process.exit(startCode);
}

// 確保對外 tunnel（otonashikoi.org）也活著；已在跑時 pm2 會報已存在，忽略即可
run("pm2", ["start", "ecosystem.config.cjs", "--only", "cloudflared"]);
