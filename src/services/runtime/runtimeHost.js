"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { randomUUID } = require("node:crypto");

// A machine-local marker must not travel with a release or shared database.
// If it is unavailable, retain the conservative expiry-based lease behavior.
function localRuntimeHostId() {
  const file = path.join(os.homedir(), ".otonashikoi-runtime-host-id");
  try {
    try { fs.writeFileSync(file, randomUUID(), { flag: "wx", mode: 0o600 }); }
    catch (error) { if (error.code !== "EEXIST") throw error; }
    const value = fs.readFileSync(file, "utf8").trim();
    return /^[a-f0-9-]{36}$/.test(value) ? value : null;
  } catch (_) { return null; }
}

function isLocalProcessDead(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return false; }
  catch (error) { return error.code === "ESRCH"; }
}
module.exports = { localRuntimeHostId, isLocalProcessDead };
