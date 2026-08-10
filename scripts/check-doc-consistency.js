#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const jobs = require("../src/shared/jobAdvancement");
const { calcPlayerStats } = require("../src/shared/combatStats");

const ROOT = path.resolve(__dirname, "..");
const failures = [];

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function requireText(rel, pattern, description) {
  const text = read(rel);
  if (!pattern.test(text)) failures.push(`${rel}: ${description}`);
}

function rejectText(rel, pattern, description) {
  const text = read(rel);
  if (pattern.test(text)) failures.push(`${rel}: ${description}`);
}

function checkLocalLinks(rel) {
  const text = read(rel);
  const baseDir = path.dirname(path.join(ROOT, rel));
  const links = [...text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map((match) => match[1].trim());
  for (const rawTarget of links) {
    if (!rawTarget || /^(?:https?:|mailto:|#)/i.test(rawTarget)) continue;
    const cleanTarget = decodeURIComponent(rawTarget.replace(/^<|>$/g, "").split("#")[0]);
    if (!cleanTarget) continue;
    const fullTarget = path.resolve(baseDir, cleanTarget);
    if (!fs.existsSync(fullTarget)) failures.push(`${rel}: 本機連結不存在：${rawTarget}`);
  }
}

const repositoryFactory = read("src/repositories/createRepositories.js");
if (!/return\s+createMongoRepositories\(\)/.test(repositoryFactory)) {
  failures.push("createRepositories.js 已不是 MongoDB-only，需同步權威文件與檢查器");
}

const towerSource = read("src/bot/handlers/towerHandlers.js");
const towerMatch = towerSource.match(/const\s+TOWER_ENABLED\s*=\s*(true|false)/);
if (!towerMatch) failures.push("找不到 TOWER_ENABLED 單一開關");
const towerEnabled = towerMatch?.[1] === "true";

const baseRows = Object.entries(jobs.BASE_JOBS);
const branchRows = Object.entries(jobs.T2_BRANCHES).flatMap(([baseKey, branches]) =>
  (branches || []).map((branch) => ({ baseKey, ...branch }))
);
const basesWithoutOpenBranch = baseRows
  .filter(([baseKey]) => !(jobs.T2_BRANCHES[baseKey] || []).some((branch) => branch?.seasonLocked !== true))
  .map(([, meta]) => meta.name);
const lockedNames = branchRows.filter((branch) => branch.seasonLocked === true).map((branch) => branch.name);

const baseVitStats = calcPlayerStats({ vit: 10 }, {}, []);
const buffedVitStats = calcPlayerStats({ vit: 10 }, {}, [{ key: "vit_up", params: { value: 2 } }]);
if (baseVitStats.maxHp !== 450 || buffedVitStats.maxHp !== 500) {
  failures.push(`HP 公式不同步：基礎 VIT10 應為 450 HP，VIT+2 後應為 500 HP；實際 ${baseVitStats.maxHp}/${buffedVitStats.maxHp}`);
}

if (basesWithoutOpenBranch.length) {
  failures.push(`沒有可用二轉的一轉職業：${basesWithoutOpenBranch.join("、")}`);
}

for (const rel of ["README.md", "PROJECT_FEATURES.md", "docs/SYSTEMS.md", "docs/README.md"]) {
  requireText(rel, /MongoDB[- ]only|僅使用 MongoDB|MongoDB only/i, "必須明確標示目前只使用 MongoDB");
  requireText(rel, new RegExp(`${baseRows.length}\\s*個一轉`), `必須寫明 ${baseRows.length} 個一轉`);
  requireText(rel, new RegExp(`${branchRows.length}\\s*條二轉`), `必須寫明 ${branchRows.length} 條二轉`);
  requireText(rel, new RegExp(`${lockedNames.length}\\s*條.*鎖定|鎖定.*${lockedNames.length}\\s*條`), `必須寫明 ${lockedNames.length} 條分支鎖定`);
  requireText(rel, towerEnabled ? /爬塔.{0,30}(開放|啟用)/s : /爬塔.{0,30}(暫停|關閉|停用)/s, "爬塔文件狀態必須符合 TOWER_ENABLED");
}

rejectText("README.md", /planned MongoDB|future Mongo|JSON development storage/i, "仍含舊的 JSON／未來 Mongo 描述");
rejectText("PROJECT_FEATURES.md", /可切換的儲存後端|STORAGE_DRIVER.*切換/i, "仍含已不存在的儲存層切換描述");
requireText("docs/CURRENT_GAME_STATUS.md", /<!-- GENERATED: CURRENT_GAME_STATUS -->/, "生成狀態文件缺少識別標記，請執行 npm run status:update");
requireText("docs/CURRENT_GAME_STATUS.md", new RegExp(`\\| 一轉 \\| ${baseRows.length} 個 \\|`), "生成快照的一轉數量與程式不符");
requireText("docs/CURRENT_GAME_STATUS.md", new RegExp(`\\| 二轉 \\| ${branchRows.length} 條；鎖定 ${lockedNames.length} 條 \\|`), "生成快照的二轉數量與程式不符");
requireText("src/services/weeklyQuest/weeklyQuestService.js", /title:\s*"賭徒試煉"[^\n]*enabled:\s*true/, "賭徒線上已開放，預設種子也必須啟用");
rejectText("docs/DEPLOYMENT_GUIDE.md", /^STORAGE_DRIVER=/m, "部署指南仍要求已廢除的 STORAGE_DRIVER");
rejectText("src/web/public/admin.combat-calculator.js", /vit\s*\*\s*15\s*\+\s*50/, "後台戰鬥計算器仍使用舊 HP 公式");

for (const rel of [
  "README.md",
  "PROJECT_FEATURES.md",
  "COMBAT_FORMULA.md",
  "docs/README.md",
  "docs/SYSTEMS.md",
  "docs/ARCHITECTURE.md",
  "docs/API_CONTRACT_V1_CORE10.md",
  "docs/CARD_EFFECTS_EDIT.md",
  "docs/DOCUMENT_SYNC_AUDIT.md",
  "docs/jobs/職業總覽.md",
]) {
  checkLocalLinks(rel);
}

if (failures.length) {
  console.error("❌ 文件一致性檢查失敗：");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`✅ 文件一致性通過：MongoDB-only；爬塔=${towerEnabled ? "開放" : "暫停"}；一轉=${baseRows.length}；二轉=${branchRows.length}；鎖定=${lockedNames.length}`);
