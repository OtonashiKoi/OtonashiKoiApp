"use strict";
/**
 * DB 自動備份排程（由 PM2 常駐）。
 * 自我校正：每 30 分檢查一次，距「最近一次自動備份」滿 6 小時就執行 db-backup.sh。
 * 這樣 PM2 重啟也不會漂移或重複備份；保留期(刪除 >12h)在 db-backup.sh 內處理。
 */
"use strict";
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const PROJECT_DIR = path.resolve(__dirname, "..");
const SCRIPT = path.join(__dirname, "db-backup.sh");
const BACKUP_ROOT = path.join(PROJECT_DIR, "backups");
const SIX_H = 6 * 60 * 60 * 1000;
const CHECK_INTERVAL = 30 * 60 * 1000; // 每 30 分檢查

let running = false;

function newestAutoBackupMs() {
  try {
    const dirs = fs.readdirSync(BACKUP_ROOT, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.startsWith("auto-"));
    let newest = 0;
    for (const d of dirs) {
      const m = fs.statSync(path.join(BACKUP_ROOT, d.name)).mtimeMs;
      if (m > newest) newest = m;
    }
    return newest; // 0 = 沒有任何自動備份
  } catch (_) {
    return 0;
  }
}

function runBackup() {
  if (running) return;
  running = true;
  execFile("/bin/sh", [SCRIPT], { cwd: PROJECT_DIR }, (err, stdout, stderr) => {
    running = false;
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
    if (err) console.error(`[backup-scheduler] ${new Date().toISOString()} 備份失敗: ${err.message}`);
  });
}

function tick() {
  const newest = newestAutoBackupMs();
  const due = newest === 0 || (Date.now() - newest) >= (SIX_H - 60_000);
  if (due) {
    console.log(`[backup-scheduler] ${new Date().toISOString()} 觸發備份（距上次 ${newest ? Math.round((Date.now() - newest) / 60000) + " 分" : "無紀錄"}）`);
    runBackup();
  }
}

console.log(`[backup-scheduler] 啟動：每 30 分檢查、滿 6 小時備份一次、保留 12 小時`);
tick();
setInterval(tick, CHECK_INTERVAL);
