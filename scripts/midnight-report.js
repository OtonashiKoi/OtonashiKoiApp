#!/usr/bin/env node
/**
 * scripts/midnight-report.js
 *
 * 一鍵：
 *   1. pm2 stop all（可用 --keep-server 跳過）
 *   2. 連 local MongoDB（讀 .env 的 MONGODB_URI / MONGODB_DB_NAME）
 *   3. 撈：
 *        - PVP 前 20 名（progress.pkRating desc）
 *        - 爬塔前 20 名（progress.towerRecord.bestFloor desc）
 *        - 2 等以上玩家清單（progress.level >= 2）
 *   4. 輸出 Markdown 到 docs/reports/<YYYY-MM-DD>-midnight-report.md
 *
 * 用法：
 *   node scripts/midnight-report.js               # 預設：停服 + 撈名單 + 輸出
 *   node scripts/midnight-report.js --keep-server # 不要 pm2 stop，只撈名單
 *   node scripts/midnight-report.js --top 20      # 指定 PVP/爬塔取前幾名（預設 20）
 */

"use strict";

const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

// 載入 .env（不依賴 dotenv 套件，自己解析以避免相依性）
function loadDotEnv() {
  const envPath = path.resolve(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    const key = m[1];
    let value = m[2];
    if (value.startsWith("#")) continue;
    // 去掉行尾註解（簡單版）
    value = value.replace(/\s+#.*$/, "");
    // 去掉外層引號
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv();

const argv = process.argv.slice(2);
const keepServer = argv.includes("--keep-server");
const topArgIdx = argv.indexOf("--top");
const TOP_N = topArgIdx >= 0 ? Math.max(1, parseInt(argv[topArgIdx + 1], 10) || 20) : 20;

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/equipmentGame";
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || "equipmentGame";

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return {
    iso: d.toISOString(),
    local: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
    dateOnly: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  };
}

function runCmd(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { shell: process.platform === "win32" });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (err) => resolve({ code: -1, stdout, stderr: `${stderr}\n[spawn error] ${err.message}` }));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function stopPm2() {
  console.log("[1/4] pm2 stop all ...");
  const stop = await runCmd("pm2", ["stop", "all"]);
  console.log("  pm2 stop all exit:", stop.code);
  if (stop.stdout) console.log(stop.stdout.trim());
  if (stop.stderr) console.log(stop.stderr.trim());

  const status = await runCmd("pm2", ["status"]);
  console.log("  pm2 status exit:", status.code);
  if (status.stdout) console.log(status.stdout.trim());

  return {
    stop: { code: stop.code, stdout: stop.stdout, stderr: stop.stderr },
    status: { code: status.code, stdout: status.stdout, stderr: status.stderr }
  };
}

function safe(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") return value;
  return String(value);
}

function escapeMd(text) {
  return safe(text).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function formatDate(value) {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return safe(value);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function fetchData() {
  const { MongoClient } = require(path.resolve(__dirname, "..", "node_modules", "mongodb"));
  const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  await client.connect();
  const db = client.db(MONGODB_DB_NAME);
  const progress = db.collection("progress");

  // PVP 前 N 名（沿用 src/adapters/mongo/createMongoRepositories.js findTopByPkRating 的條件）
  const pvpTop = await progress.aggregate([
    { $match: { $or: [{ pkWins: { $gt: 0 } }, { pkLosses: { $gt: 0 } }, { pkRating: { $exists: true, $ne: null } }] } },
    { $sort: { pkRating: -1, level: -1 } },
    { $limit: TOP_N },
    {
      $lookup: {
        from: "players",
        localField: "playerId",
        foreignField: "discordId",
        as: "_player"
      }
    },
    {
      $project: {
        _id: 0,
        playerId: 1,
        displayName: {
          $ifNull: [
            { $arrayElemAt: ["$_player.displayName", 0] },
            { $ifNull: ["$displayName", "$playerId"] }
          ]
        },
        pkRating: 1,
        pkWins: 1,
        pkLosses: 1,
        level: 1,
        jobName: {
          $ifNull: [
            "$equipment.job_eq.itemName",
            { $ifNull: ["$equipment.job_eq.name", ""] }
          ]
        }
      }
    }
  ]).toArray();

  // 爬塔前 N 名
  const towerTop = await progress.aggregate([
    { $match: { "towerRecord.bestFloor": { $exists: true, $gt: 0 } } },
    {
      $sort: {
        "towerRecord.bestFloor": -1,
        "towerRecord.bestProgressDamagePct": -1,
        "towerRecord.bestProgressDamage": -1,
        "towerRecord.bestAt": 1
      }
    },
    { $limit: TOP_N },
    {
      $lookup: {
        from: "players",
        localField: "playerId",
        foreignField: "discordId",
        as: "_player"
      }
    },
    {
      $project: {
        _id: 0,
        playerId: 1,
        displayName: {
          $ifNull: [
            { $arrayElemAt: ["$_player.displayName", 0] },
            { $ifNull: ["$displayName", "$playerId"] }
          ]
        },
        level: 1,
        bestFloor: "$towerRecord.bestFloor",
        bestAt: "$towerRecord.bestAt",
        bestProgressDamage: "$towerRecord.bestProgressDamage",
        jobName: {
          $ifNull: [
            "$equipment.job_eq.itemName",
            { $ifNull: ["$equipment.job_eq.name", ""] }
          ]
        }
      }
    }
  ]).toArray();

  // 2 等以上玩家清單
  const lv2plus = await progress.aggregate([
    { $match: { level: { $gte: 2 } } },
    { $sort: { level: -1, exp: -1, updatedAt: -1 } },
    {
      $lookup: {
        from: "players",
        localField: "playerId",
        foreignField: "discordId",
        as: "_player"
      }
    },
    {
      $project: {
        _id: 0,
        playerId: 1,
        displayName: {
          $ifNull: [
            { $arrayElemAt: ["$_player.displayName", 0] },
            { $ifNull: ["$displayName", "$playerId"] }
          ]
        },
        level: 1,
        exp: 1,
        pkRating: 1,
        updatedAt: 1,
        jobName: {
          $ifNull: [
            "$equipment.job_eq.itemName",
            { $ifNull: ["$equipment.job_eq.name", ""] }
          ]
        }
      }
    }
  ]).toArray();

  const totals = {
    players: await db.collection("players").countDocuments(),
    progress: await progress.countDocuments(),
    lv2plus: lv2plus.length
  };

  await client.close();
  return { pvpTop, towerTop, lv2plus, totals };
}

function buildMarkdown({ pm2Result, data, ts }) {
  const lines = [];
  lines.push(`# ${ts.dateOnly} 凌晨例行報告`);
  lines.push("");
  lines.push(`- 產生時間：${ts.local}`);
  lines.push(`- 資料庫：\`${MONGODB_DB_NAME}\` @ \`${MONGODB_URI.replace(/:\/\/[^@]*@/, "://***:***@")}\``);
  lines.push("");

  lines.push("## 一、伺服器關閉狀態");
  if (!pm2Result) {
    lines.push("- 未執行 pm2 stop（使用了 `--keep-server`）。");
  } else {
    lines.push(`- 執行 \`pm2 stop all\`，exit code = ${pm2Result.stop.code}`);
    if (pm2Result.stop.stdout && pm2Result.stop.stdout.trim()) {
      lines.push("");
      lines.push("```");
      lines.push(pm2Result.stop.stdout.trim());
      lines.push("```");
    }
    if (pm2Result.stop.stderr && pm2Result.stop.stderr.trim()) {
      lines.push("");
      lines.push("stderr：");
      lines.push("```");
      lines.push(pm2Result.stop.stderr.trim());
      lines.push("```");
    }
    lines.push("");
    lines.push(`- 執行 \`pm2 status\`，exit code = ${pm2Result.status.code}`);
    if (pm2Result.status.stdout && pm2Result.status.stdout.trim()) {
      lines.push("");
      lines.push("```");
      lines.push(pm2Result.status.stdout.trim());
      lines.push("```");
    }
  }
  lines.push("");

  lines.push(`## 二、PVP 排行榜（前 ${TOP_N} 名）`);
  if (data.pvpTop.length === 0) {
    lines.push("- （無資料）");
  } else {
    lines.push("| 名次 | 暱稱 | 玩家 ID | 職業 | 等級 | PVP 分數 | 戰績 |");
    lines.push("|---:|---|---|---|---:|---:|---|");
    data.pvpTop.forEach((row, idx) => {
      const wins = Number(row.pkWins || 0);
      const losses = Number(row.pkLosses || 0);
      lines.push([
        idx + 1,
        escapeMd(row.displayName),
        escapeMd(row.playerId),
        escapeMd(row.jobName),
        row.level ?? "",
        row.pkRating ?? "",
        `${wins} 勝 / ${losses} 敗`
      ].map((c) => ` ${c} `).join("|").replace(/^/, "|").replace(/$/, "|"));
    });
  }
  lines.push("");

  lines.push(`## 三、爬塔排行榜（前 ${TOP_N} 名）`);
  if (data.towerTop.length === 0) {
    lines.push("- （無資料）");
  } else {
    lines.push("| 名次 | 暱稱 | 玩家 ID | 職業 | 等級 | 最高樓層 | 紀錄時間 |");
    lines.push("|---:|---|---|---|---:|---:|---|");
    data.towerTop.forEach((row, idx) => {
      lines.push([
        idx + 1,
        escapeMd(row.displayName),
        escapeMd(row.playerId),
        escapeMd(row.jobName),
        row.level ?? "",
        row.bestFloor ?? "",
        formatDate(row.bestAt)
      ].map((c) => ` ${c} `).join("|").replace(/^/, "|").replace(/$/, "|"));
    });
  }
  lines.push("");

  lines.push(`## 四、2 等以上玩家清單（共 ${data.lv2plus.length} 位）`);
  if (data.lv2plus.length === 0) {
    lines.push("- （無資料）");
  } else {
    lines.push("| 暱稱 | 玩家 ID | 等級 | 職業 | PVP 分數 | 最後更新 |");
    lines.push("|---|---|---:|---|---:|---|");
    data.lv2plus.forEach((row) => {
      lines.push([
        escapeMd(row.displayName),
        escapeMd(row.playerId),
        row.level ?? "",
        escapeMd(row.jobName),
        row.pkRating ?? "",
        formatDate(row.updatedAt)
      ].map((c) => ` ${c} `).join("|").replace(/^/, "|").replace(/$/, "|"));
    });
  }
  lines.push("");

  lines.push("## 五、資料統計");
  lines.push(`- players collection 筆數：${data.totals.players}`);
  lines.push(`- progress collection 筆數：${data.totals.progress}`);
  lines.push(`- 2 等以上玩家：${data.totals.lv2plus}`);
  lines.push("");

  lines.push("---");
  lines.push("");
  lines.push("> 重啟服務請執行 `npm run pm2:reset`。");

  return lines.join("\n");
}

(async () => {
  const ts = nowStamp();
  let pm2Result = null;
  try {
    if (!keepServer) {
      pm2Result = await stopPm2();
    } else {
      console.log("[1/4] --keep-server 指定，跳過 pm2 stop all");
    }

    console.log("[2/4] 連 MongoDB 撈名單...");
    const data = await fetchData();
    console.log(`  PVP 前 N: ${data.pvpTop.length} 筆`);
    console.log(`  爬塔前 N: ${data.towerTop.length} 筆`);
    console.log(`  Lv2+: ${data.lv2plus.length} 筆`);

    console.log("[3/4] 產出 Markdown 報告...");
    const reportsDir = path.resolve(__dirname, "..", "docs", "reports");
    fs.mkdirSync(reportsDir, { recursive: true });
    const outPath = path.join(reportsDir, `${ts.dateOnly}-midnight-report.md`);
    const md = buildMarkdown({ pm2Result, data, ts });
    fs.writeFileSync(outPath, md, "utf8");

    console.log("[4/4] 完成");
    console.log("");
    console.log(`報告檔案：${outPath}`);
    if (!keepServer) {
      console.log("提醒：要重啟服務時請手動執行 `npm run pm2:reset`。");
    }
  } catch (err) {
    console.error("[ERROR]", err.stack || err.message || err);
    process.exitCode = 1;
  }
})();
