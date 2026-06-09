"use strict";
/**
 * 手動補發 6 月抖內鑽石(因抖內→鑽石管線在 6 月沒處理到)。
 * 與正常抖內流程一致:grantCurrency(currencyType=diamond, source=donation:reward) + 更新 donationLedger。
 * sourceRef 唯一 → grantCurrency 以 (source, sourceRef) 冪等,重跑不會重複發。
 * 本批:麻婆 NT$300→3 鑽、雪白之火 NT$100→1 鑽。(harkun ¥5000 待換匯與確認,不在此批)
 */
require("dotenv").config();

const GRANTS = [
  { discordId: "201822843799863296", name: "麻婆",     twd: 300, diamonds: 3, ref: "manual-donation:20260606:mapo:300" },
  { discordId: "289759663442886656", name: "雪白之火", twd: 100, diamonds: 1, ref: "manual-donation:20260606:xuebai:100" },
];

(async () => {
  const { createMongoRepositories } = require("../src/adapters/mongo/createMongoRepositories");
  const repos = await createMongoRepositories();
  const { createServiceContext } = require("../src/services/createServiceContext");
  const sc = await createServiceContext(repos);
  const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
  const db = await getMongoDb();

  for (const g of GRANTS) {
    const res = await sc.rewardService.grantCurrency({
      discordId: g.discordId,
      displayName: g.name,
      currencyType: "diamond",
      amount: g.diamonds,
      source: "donation:reward",
      sourceRef: g.ref,
      operator: "stream:donation:manual",
    });
    const dup = res?.duplicated ? "（重複，未重發）" : "";
    console.log(`${g.name} (${g.discordId}): +${g.diamonds} 鑽${dup}  balanceAfter=${res?.balanceAfter ?? "?"}`);

    // 同步 donationLedger(NT$ 皆為 100 整數倍 → pendingTwd 仍為 0)
    const now = new Date().toISOString();
    const ledger = await db.collection("donationLedger").findOne({ discordId: g.discordId }) || { pendingTwd: 0, totalTwd: 0, processedRefs: [] };
    const refs = Array.isArray(ledger.processedRefs) ? ledger.processedRefs : [];
    if (refs.includes(g.ref)) { console.log(`  台帳已含此 ref,略過。`); continue; }
    await db.collection("donationLedger").updateOne(
      { discordId: g.discordId },
      { $set: { discordId: g.discordId, pendingTwd: 0, totalTwd: (ledger.totalTwd || 0) + g.twd, processedRefs: [...refs, g.ref].slice(-200), updatedAt: now } },
      { upsert: true }
    );
    console.log(`  台帳 totalTwd: ${ledger.totalTwd || 0} → ${(ledger.totalTwd || 0) + g.twd}`);
  }

  // 驗證鑽石餘額
  console.log("\n=== 補發後鑽石餘額 ===");
  for (const g of GRANTS) {
    const w = await db.collection("wallets").findOne({ playerId: g.discordId }) || await db.collection("wallets").findOne({ discordId: g.discordId });
    const dia = w?.balances?.diamond ?? w?.diamond ?? "(查無錢包)";
    console.log(`  ${g.name} (${g.discordId}): diamond=${dia}`);
  }
  process.exit(0);
})().catch((e) => { console.error("失敗:", e); process.exit(1); });
