"use strict";
/**
 * 玩家賽季重置 CLI。
 * 規則唯一來源：src/services/admin/seasonResetService.js
 *
 * 預設 dry-run；APPLY=1 才會寫入。全體重置會連同怪物、世界王、PK/KDA、直播與通行證換季。
 * PLAYER_ID=<id> 只重置單一玩家，不切換全服 seasonKey。
 * KEEP_LEDGER=1 只供事故復原，保留任務與簽到紀錄。
 * SEASON_KEY=<key> 可指定全體重置後的通行證 seasonKey，未指定則自動產生。
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { closeMongoClient } = require("../src/adapters/mongo/createMongoClient");
const {
  seasonResetPlayer,
  seasonResetAllPlayers,
  buildSeasonResetBackup,
} = require("../src/services/admin/seasonResetService");
const { createRun, getRun } = require("../src/services/admin/seasonResetCoordinator");

const APPLY = process.env.APPLY === "1";
const PLAYER_ID = String(process.env.PLAYER_ID || "").trim() || null;
const KEEP_LEDGER = process.env.KEEP_LEDGER === "1";
const SEASON_KEY = String(process.env.SEASON_KEY || "").trim() || null;

function backupPath(label) {
  const dir = path.resolve(__dirname, "../backups");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(dir, `season-reset-${label}-${stamp}.json`);
}

function writeBackup(file, payload) {
  fs.writeFileSync(file, JSON.stringify(payload));
  console.log(`✅ 備份已寫入：${file}`);
}

async function resetOne() {
  const preview = await seasonResetPlayer(PLAYER_ID, { dryRun: true, keepLedger: KEEP_LEDGER });
  console.log(JSON.stringify(preview, null, 2));
  if (!APPLY) return preview;

  const backup = await buildSeasonResetBackup(PLAYER_ID);
  writeBackup(backupPath(PLAYER_ID), backup);
  return seasonResetPlayer(PLAYER_ID, { dryRun: false, keepLedger: KEEP_LEDGER });
}

async function resetAll() {
  if (!APPLY) return seasonResetAllPlayers({ dryRun: true, keepLedger: KEEP_LEDGER });
  const queued = await createRun({ seasonKey: SEASON_KEY, keepLedger: KEEP_LEDGER });
  console.log(`✅ 已建立安全背景工作：${queued._id}`);
  const terminal = new Set(["completed", "failed", "blocked"]);
  let run = queued;
  while (!terminal.has(run.status)) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    run = await getRun(queued._id);
    console.log(`進度：${run.status} ${run.processed || 0}/${run.total || "?"}`);
  }
  return run;
}

async function main() {
  console.log(`模式：${APPLY ? "🔴 APPLY（會寫入）" : "🟢 DRY-RUN（不寫入）"}`);
  console.log(`目標：${PLAYER_ID ? `單一玩家 ${PLAYER_ID}` : "全部玩家與全服賽季狀態"}`);
  if (KEEP_LEDGER) console.log("⚠️ KEEP_LEDGER=1：任務與簽到紀錄會保留（事故復原模式）");
  const summary = PLAYER_ID ? await resetOne() : await resetAll();
  console.log(JSON.stringify(summary, null, 2));
  if (!APPLY) console.log("⚠️ 目前只是預覽；確認後加 APPLY=1 重跑。");
}

main()
  .catch((error) => { console.error(`❌ ${error.message}`); process.exitCode = 1; })
  .finally(() => closeMongoClient().catch(() => {}));
