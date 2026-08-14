"use strict";

const fs = require("fs");
const path = require("path");

const APP_INDEX = path.resolve(__dirname, "../../web/public/app/index.html");
const STATE_FILE = path.resolve(__dirname, "../../../backups/runtime-force-reload.json");
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const EMPTY_STATE = Object.freeze({ targetBuild: "", reason: "", activeUntil: 0 });

let pending = { ...EMPTY_STATE };

function readPersisted() {
  try {
    const saved = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    return {
      targetBuild: String(saved?.targetBuild || ""),
      reason: String(saved?.reason || ""),
      activeUntil: Number(saved?.activeUntil || 0),
    };
  } catch (_) {
    return { targetBuild: "", reason: "", activeUntil: 0 };
  }
}

function persist(value) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  const temp = `${STATE_FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value), "utf8");
  fs.renameSync(temp, STATE_FILE);
}

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
  persist(pending);
  return { ...pending };
}

function deactivate() {
  pending = { ...EMPTY_STATE };
  persist(pending);
}

function getPendingFor(clientBuild = "") {
  if (!pending.activeUntil) pending = readPersisted();
  if (!pending.activeUntil || pending.activeUntil <= Date.now()) return null;
  const servedBuild = currentBuild();
  const targetBuild = pending.targetBuild || servedBuild;

  // 強制重整命令只能指向目前實際提供的 build。若命令建立後又部署了新版，
  // 舊 target 不可能再被載入；繼續補送只會讓新版頁面無限重整。
  if (targetBuild && servedBuild && targetBuild !== servedBuild) {
    deactivate();
    return null;
  }
  if (targetBuild && String(clientBuild || "") === targetBuild) return null;
  return { ...pending, targetBuild };
}

module.exports = { activate, deactivate, getPendingFor, currentBuild };
