"use strict";

const fs = require("fs");
const path = require("path");

const APP_INDEX = path.resolve(__dirname, "../../web/public/app/index.html");
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

let pending = { targetBuild: "", reason: "", activeUntil: 0 };

function currentBuild() {
  try {
    const html = fs.readFileSync(APP_INDEX, "utf8");
    return html.match(/<script[^>]+type=["']module["'][^>]+src=["']([^"']+)["']/i)?.[1] || "";
  } catch (_) {
    return "";
  }
}

function activate(reason = "admin_broadcast", ttlMs = DEFAULT_TTL_MS) {
  pending = {
    targetBuild: currentBuild(),
    reason: String(reason || "admin_broadcast"),
    activeUntil: Date.now() + Math.max(60_000, Number(ttlMs) || DEFAULT_TTL_MS),
  };
  return { ...pending };
}

function getPendingFor(clientBuild = "") {
  if (!pending.activeUntil || pending.activeUntil <= Date.now()) return null;
  const targetBuild = pending.targetBuild || currentBuild();
  if (targetBuild && String(clientBuild || "") === targetBuild) return null;
  return { ...pending, targetBuild };
}

module.exports = { activate, getPendingFor, currentBuild };
