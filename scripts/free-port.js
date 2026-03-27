const { spawnSync } = require("node:child_process");

const port = Number(process.env.API_PORT || 5566);

function run(command, args) {
  const executable = process.platform === "win32" ? `${command}.cmd` : command;
  return spawnSync(executable, args, {
    encoding: "utf8",
    shell: false
  });
}

function parseWindowsPids(stdout, targetPort) {
  const lines = String(stdout || "").split(/\r?\n/);
  const pids = new Set();

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (!line.includes(`:${targetPort}`)) continue;
    if (!/LISTENING/i.test(line)) continue;

    const parts = line.split(/\s+/);
    const pid = Number(parts[parts.length - 1]);
    if (Number.isInteger(pid) && pid > 0) {
      pids.add(pid);
    }
  }

  return [...pids];
}

function parseUnixPids(stdout) {
  return String(stdout || "")
    .split(/\r?\n/)
    .map((x) => Number(x.trim()))
    .filter((x) => Number.isInteger(x) && x > 0);
}

function findPidsUsingPort(targetPort) {
  if (process.platform === "win32") {
    const result = run("netstat", ["-ano", "-p", "tcp"]);
    return parseWindowsPids(result.stdout, targetPort);
  }

  const result = run("lsof", ["-ti", `tcp:${targetPort}`]);
  return parseUnixPids(result.stdout);
}

function killPid(pid) {
  if (process.platform === "win32") {
    run("taskkill", ["/PID", String(pid), "/F"]);
    return;
  }

  run("kill", ["-9", String(pid)]);
}

const pids = findPidsUsingPort(port);

if (pids.length === 0) {
  process.exit(0);
}

for (const pid of pids) {
  killPid(pid);
}

console.log(`[free-port] Released port ${port} from PID(s): ${pids.join(", ")}`);
