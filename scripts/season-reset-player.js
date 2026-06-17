"use strict";
// 回歸賽季重製:備份後重置玩家(只留鑽石/稱號/收藏)。用法:node scripts/season-reset-player.js <discordId> [--dry]
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { seasonResetPlayer, buildSeasonResetBackup } = require("../src/services/admin/seasonResetService");

(async () => {
  const discordId = process.argv[2];
  const dryRun = process.argv.includes("--dry");
  if (!discordId) { console.error("用法: node scripts/season-reset-player.js <discordId> [--dry]"); process.exit(1); }

  if (dryRun) {
    const s = await seasonResetPlayer(discordId, { dryRun: true });
    console.log("【DRY RUN】", JSON.stringify(s, null, 2));
    process.exit(0);
  }

  // 1) 備份
  const backup = await buildSeasonResetBackup(discordId);
  const dir = path.resolve(__dirname, "../backups");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `season-reset-${discordId}-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(backup, null, 2));
  console.log("✅ 備份已寫入:", file);

  // 2) 重製
  const summary = await seasonResetPlayer(discordId, { dryRun: false });
  console.log("✅ 回歸賽季重製完成:", JSON.stringify(summary, null, 2));
  process.exit(0);
})().catch((e) => { console.error("❌ 失敗:", e.message); process.exit(1); });
