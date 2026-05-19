"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..", "..");
const LOG_DIR = path.join(ROOT_DIR, "logs");
const AUDIT_FILE = path.join(LOG_DIR, "restart-audit.jsonl");
const STATE_FILE = path.join(LOG_DIR, "restart-state.json");

let installed = false;
let currentStart = null;

function ensureLogDir() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

function nowTaipeiText() {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(new Date());
}

function safeReadJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_) {
    return null;
  }
}

function writeJson(file, data) {
  ensureLogDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function appendAudit(event, data = {}) {
  ensureLogDir();
  const record = {
    ts: nowIso(),
    localTs: nowTaipeiText(),
    event,
    app: process.env.name || process.env.pm_exec_path || "equipmentGAME",
    pid: process.pid,
    pm_id: process.env.pm_id ?? null,
    node_env: process.env.NODE_ENV || null,
    ...data
  };
  fs.appendFileSync(AUDIT_FILE, `${JSON.stringify(record)}\n`);
  return record;
}

function classifyStartReason(previousState) {
  if (!previousState) return "first_observed_start";
  if (previousState.status === "graceful_shutdown") {
    return `after_${previousState.reason || "graceful_shutdown"}`;
  }
  if (previousState.status === "bootstrap_failed") return "after_bootstrap_failed";
  if (previousState.status === "fatal_error") return "after_fatal_error";
  if (previousState.status === "running") return "previous_process_disappeared_or_forced_restart";
  return `after_${previousState.status || "unknown"}`;
}

function getPm2Snapshot() {
  return {
    restart_time: process.env.restart_time ?? process.env.pm_restart_time ?? null,
    max_memory_restart: process.env.max_memory_restart ?? null,
    cron_restart: process.env.cron_restart ?? null,
    exec_mode: process.env.exec_mode ?? null,
    node_app_instance: process.env.NODE_APP_INSTANCE ?? null
  };
}

function markState(status, extra = {}) {
  const uptimeMs = currentStart?.startedAtMs ? Date.now() - currentStart.startedAtMs : null;
  writeJson(STATE_FILE, {
    status,
    reason: extra.reason || null,
    startedAt: currentStart?.startedAt || null,
    stoppedAt: nowIso(),
    uptimeMs,
    pid: process.pid,
    pm_id: process.env.pm_id ?? null,
    ...extra
  });
}

function installRestartAudit() {
  if (installed) return;
  installed = true;

  const previousState = safeReadJson(STATE_FILE);
  currentStart = {
    startedAt: nowIso(),
    startedAtMs: Date.now()
  };

  const startReason = classifyStartReason(previousState);
  writeJson(STATE_FILE, {
    status: "running",
    startedAt: currentStart.startedAt,
    pid: process.pid,
    pm_id: process.env.pm_id ?? null,
    startReason,
    previousState
  });

  const startRecord = appendAudit("process_start", {
    reason: startReason,
    previousState,
    pm2: getPm2Snapshot(),
    argv: process.argv.slice(0, 4),
    node: process.version
  });
  console.log(`[RestartAudit] start recorded reason=${startRecord.reason} file=${AUDIT_FILE}`);

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      appendAudit("process_signal", { reason: signal, uptimeMs: Date.now() - currentStart.startedAtMs });
      markState("graceful_shutdown", { reason: signal });
      process.kill(process.pid, signal);
    });
  }

  process.once("uncaughtException", (error) => {
    appendAudit("uncaught_exception", {
      reason: error?.name || "uncaughtException",
      message: error?.message || String(error),
      stack: error?.stack || null,
      uptimeMs: Date.now() - currentStart.startedAtMs
    });
    markState("fatal_error", {
      reason: "uncaught_exception",
      message: error?.message || String(error)
    });
    console.error(error);
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    appendAudit("unhandled_rejection", {
      reason: reason?.name || "unhandledRejection",
      message: reason?.message || String(reason),
      stack: reason?.stack || null,
      uptimeMs: Date.now() - currentStart.startedAtMs
    });
  });
}

function markBootstrapFailure(error) {
  appendAudit("bootstrap_failed", {
    reason: error?.name || "bootstrap_failed",
    message: error?.message || String(error),
    stack: error?.stack || null,
    uptimeMs: currentStart?.startedAtMs ? Date.now() - currentStart.startedAtMs : null
  });
  markState("bootstrap_failed", {
    reason: error?.name || "bootstrap_failed",
    message: error?.message || String(error)
  });
}

module.exports = {
  installRestartAudit,
  markBootstrapFailure,
  AUDIT_FILE,
  STATE_FILE
};
