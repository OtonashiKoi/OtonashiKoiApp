"use strict";

const fs = require("fs");
const path = require("path");
const { finished } = require("stream/promises");

/**
 * 串流式 NDJSON 備份：一次只保留一位玩家在記憶體，避免全服交易紀錄累積成
 * 巨型陣列。每行都是可獨立解析的紀錄，最後一行 manifest 才代表備份完整。
 */
function createSeasonResetBackupWriter({ backupDir, runId, seasonKey }) {
  const dir = path.resolve(backupDir);
  const safeRunId = String(runId).replace(/[^a-zA-Z0-9_-]/g, "-");
  const basePath = path.join(dir, `season-reset-${safeRunId}.ndjson`);
  let finalPath = basePath;
  let partialPath = `${finalPath}.partial`;
  // 中斷留下的 .partial 不覆寫也不刪除；續跑改寫 retry 檔，保留事故稽核證據。
  if (!fs.existsSync(basePath)) {
    let retry = 0;
    while (fs.existsSync(partialPath) || fs.existsSync(finalPath)) {
      retry += 1;
      finalPath = path.join(dir, `season-reset-${safeRunId}-retry${retry}.ndjson`);
      partialPath = `${finalPath}.partial`;
    }
  }
  let stream = null;
  let playerCount = 0;

  const writeLine = (value) => new Promise((resolve, reject) => {
    const line = `${JSON.stringify(value)}\n`;
    stream.write(line, (error) => error ? reject(error) : resolve());
  });

  return {
    finalPath,
    partialPath,
    async begin() {
      await fs.promises.mkdir(dir, { recursive: true });
      stream = fs.createWriteStream(partialPath, { flags: "wx", encoding: "utf8" });
      await writeLine({ kind: "season-reset-backup-header", version: 2, runId, seasonKey, startedAt: new Date().toISOString() });
    },
    async writePlayer(player) {
      if (!stream) throw new Error("backup writer 尚未 begin");
      await writeLine({ kind: "player", data: player });
      playerCount += 1;
    },
    async writeTransaction(playerId, transaction) {
      await writeLine({ kind: "transaction", playerId: String(playerId), data: transaction });
    },
    async writeGlobals(globals) {
      await writeLine({ kind: "globals", data: globals });
    },
    async finish() {
      await writeLine({ kind: "manifest", complete: true, playerCount, finishedAt: new Date().toISOString() });
      stream.end();
      await finished(stream);
      await fs.promises.rename(partialPath, finalPath);
      return { path: finalPath, playerCount };
    },
    async abort(error) {
      if (stream && !stream.destroyed) {
        stream.end();
        await finished(stream).catch(() => {});
      }
      return { path: partialPath, playerCount, error: String(error?.message || error || "aborted") };
    },
  };
}

module.exports = { createSeasonResetBackupWriter };
