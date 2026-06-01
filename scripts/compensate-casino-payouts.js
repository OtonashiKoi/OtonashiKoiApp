"use strict";
/**
 * 補發賭場「去重 bug」漏發的中獎金幣。
 *
 * 背景：舊版結算 sourceRef=`round:${roundId}`（全場共用），grantCurrency 的去重
 *       會把同一輪第二位以後的中獎者誤判為重複而跳過 → 沒入帳。
 *
 * 偵測：casinoBets 中 outcome=win 的下注（依 round+player 加總應得金額），
 *       若該 (round, player) 沒有對應的 casino:payout 交易 → 漏發。
 *
 * 補發：用正規 rewardService.grantCurrency，source=casino:payout、
 *       sourceRef=`round:${roundId}:${discordId}`（新格式、每人每輪唯一）。
 *       → 真入錢包 + 寫交易，且可重跑不重複（已補發者會被去重跳過）。
 *
 * 用法：
 *   node scripts/compensate-casino-payouts.js            # dry-run（只列出，不入帳）
 *   node scripts/compensate-casino-payouts.js --yes      # 實際補發
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const { createRepositories } = require("../src/repositories/createRepositories");
const { PlayerService } = require("../src/services/player/playerService");
const { RewardService } = require("../src/services/reward/rewardService");
const { CURRENCY_SOURCES } = require("../src/shared/sources");

async function main() {
  const apply = process.argv.includes("--yes") || process.argv.includes("-y");
  const db = await getMongoDb();

  // 1) 撈中獎下注，依 (round, player) 加總應得金額
  const wins = await db.collection("casinoBets")
    .find({ outcome: "win", payout: { $gt: 0 } }).toArray();
  const groups = new Map(); // `${roundId}|${discordId}` -> { roundId, discordId, name, owed }
  for (const b of wins) {
    const key = `${b.roundId}|${b.discordId}`;
    const g = groups.get(key) || { roundId: b.roundId, discordId: b.discordId, name: b.displayName || b.discordId, owed: 0 };
    g.owed += Number(b.payout) || 0;
    groups.set(key, g);
  }

  // 2) 過濾掉「已有對應 casino:payout 交易」的群組
  const owedGroups = [];
  for (const g of groups.values()) {
    const tx = await db.collection("transactions").findOne({
      source: CURRENCY_SOURCES.CASINO_PAYOUT,
      playerId: g.discordId,
      sourceRef: { $in: [`round:${g.roundId}`, `round:${g.roundId}:${g.discordId}`] }
    });
    if (!tx) owedGroups.push(g);
  }

  // 3) 彙總顯示
  const byPlayer = new Map();
  let total = 0;
  for (const g of owedGroups) {
    total += g.owed;
    const p = byPlayer.get(g.discordId) || { name: g.name, total: 0, rounds: [] };
    p.total += g.owed; p.rounds.push(`#${g.roundId}(+${g.owed})`);
    byPlayer.set(g.discordId, p);
  }

  console.log(`\n賭場漏發補發（${apply ? "實際執行" : "DRY-RUN"}）`);
  console.log("─".repeat(70));
  console.log(`漏發群組=${owedGroups.length}　玩家=${byPlayer.size}　總金額=${total} 金幣`);
  for (const [did, p] of byPlayer) {
    console.log(`  ${did} (${p.name}): +${p.total}　${p.rounds.join(" ")}`);
  }
  console.log("─".repeat(70));

  if (!apply) {
    console.log("DRY-RUN：未入帳。加 --yes 實際補發。");
    return;
  }

  // 4) 建 rewardService 並逐群組補發（idempotent：sourceRef 每人每輪唯一）
  const repos = createRepositories();
  const playerService = new PlayerService(repos.playerRepository, repos.walletRepository, repos.progressRepository);
  const rewardService = new RewardService(playerService, repos.walletRepository, repos.transactionRepository);

  let credited = 0, duplicated = 0, failed = 0, paidGold = 0;
  for (const g of owedGroups) {
    try {
      const r = await rewardService.grantCurrency({
        discordId: g.discordId,
        displayName: g.name,
        currencyType: "gold",
        amount: g.owed,
        source: CURRENCY_SOURCES.CASINO_PAYOUT,
        sourceRef: `round:${g.roundId}:${g.discordId}`,
        operator: "compensation:casino-dedup-bug"
      });
      if (r?.duplicated) { duplicated++; console.log(`  ⏭️  #${g.roundId} ${g.name} 已補過，跳過`); }
      else { credited++; paidGold += g.owed; console.log(`  ✅ #${g.roundId} ${g.name} +${g.owed}（餘額 ${r?.wallet?.gold}）`); }
    } catch (err) {
      failed++; console.log(`  ❌ #${g.roundId} ${g.name} 失敗：${err?.message || err}`);
    }
  }
  console.log("─".repeat(70));
  console.log(`完成：補發 ${credited} 筆（${paidGold} 金幣）／已存在 ${duplicated}／失敗 ${failed}`);
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
