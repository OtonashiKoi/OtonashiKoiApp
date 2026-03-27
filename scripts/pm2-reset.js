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

const startCode = run("pm2", ["start", "ecosystem.config.cjs", "--only", processName]);
if (startCode !== 0) {
  process.exit(startCode);
}
