"use strict";
/**
 * 補發：紫魔-k4w 7/25 兩筆 SC（NT$30 + NT$75）。
 *
 * 背景：被「小額 SC 黑洞」（diamondAmount<=0 提前 return，B20 已修）吞掉、完全沒記錄。
 * 幣別曾疑為外幣，使用者確認為台幣（YT SC 色階門檻是按幣別設的：NT$30=青色/NT$75=綠色，吻合）。
 * sourceRef 用原始留言 id（與正式 YT 流程同格式）→ 冪等，重跑不重複發。
 *
 * 流程完全鏡射 streamHandlers 的已綁定斗內：台帳累積 → 滿百發鑽 → 記錄 → SC條 → 全服buff。
 * （buff 觸發現在安全：donationBuffTrigger 已加 refreshBuffCache，腳本程序不會再蓋掉大 buff）
 */
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const { createServiceContext } = require("../src/services/createServiceContext");
const { recordDonationEvent } = require("../src/services/stream/streamRecordsService");
const { CURRENCY_SOURCES } = require("../src/shared/sources");

const DISCORD_ID = "1200087356150120540";
const DISPLAY_NAME = "@紫魔-k4w";
const DONATIONS = [
  { twd: 30, sourceRef: "youtube:yt-ChwKGkNKN2kySjdfN1pVREZSckN3Z1FkaFF3M3Jn", at: "2026-07-25T14:03:40Z" },
  { twd: 75, sourceRef: "youtube:yt-ChwKGkNLNncwOExfN1pVREZRVEl3Z1FkM3ZJZVln", at: "2026-07-25T14:04:55Z" },
];

(async () => {
  const sc = createServiceContext();
  const db = await getMongoDb();

  for (const d of DONATIONS) {
    const ledger = await db.collection("donationLedger").findOne({ discordId: DISCORD_ID })
      || { pendingTwd: 0, totalTwd: 0, processedRefs: [] };
    const refs = Array.isArray(ledger.processedRefs) ? ledger.processedRefs : [];
    if (refs.includes(d.sourceRef)) { console.log(`⏭ 已處理過，略過：NT$${d.twd}`); continue; }

    const donation = { twdAmount: d.twd, sourceRef: d.sourceRef, platform: "youtube", platformUserId: "yt-UC6ZD--AhCY1_GC-LCkyA12Q", displayName: DISPLAY_NAME };
    // 全服事件（同正式流程：先觸發再結算）
    try { await require("../src/services/stream/donationBuffTrigger").maybeTriggerDonationBuff(donation, { discordId: DISCORD_ID, displayName: DISPLAY_NAME }, sc); } catch (_) {}
    try { await require("../src/services/stream/scBarService").addDonation(d.twd, { discordId: DISCORD_ID, displayName: DISPLAY_NAME }, sc); } catch (_) {}

    const newPendingRaw = (ledger.pendingTwd || 0) + d.twd;
    const grant = Math.floor(newPendingRaw / 100);
    const newPending = newPendingRaw % 100;
    if (grant > 0) {
      await sc.rewardService.grantCurrency({
        discordId: DISCORD_ID, displayName: DISPLAY_NAME, currencyType: "diamond", amount: grant,
        source: CURRENCY_SOURCES.DONATION_REWARD, sourceRef: d.sourceRef, operator: "stream:donation-backfill",
      });
    }
    await db.collection("donationLedger").updateOne(
      { discordId: DISCORD_ID },
      { $set: { discordId: DISCORD_ID, pendingTwd: newPending, totalTwd: (ledger.totalTwd || 0) + d.twd, processedRefs: [...refs, d.sourceRef].slice(-200), updatedAt: new Date().toISOString() } },
      { upsert: true }
    );
    await recordDonationEvent({
      sourceRef: d.sourceRef, platform: "youtube", platformUserId: "yt-UC6ZD--AhCY1_GC-LCkyA12Q",
      displayName: DISPLAY_NAME, twdAmount: d.twd, currency: "TWD", discordId: DISCORD_ID, bound: true,
      diamondsGranted: grant, pendingAfter: newPending,
      note: grant > 0 ? "granted(backfill:B20小額黑洞)" : "accumulate(backfill:B20小額黑洞)",
    }).catch(() => {});
    console.log(`✅ NT$${d.twd} → 發鑽 ${grant}、零頭 ${newPending}（原始時間 ${d.at}）`);
  }

  const led = await db.collection("donationLedger").findOne({ discordId: DISCORD_ID });
  const wallet = await sc.walletRepository.findByPlayerId(DISCORD_ID);
  console.log("台帳:", JSON.stringify({ pending: led?.pendingTwd, total: led?.totalTwd }), "| 錢包鑽石:", wallet?.diamond);
  process.exit(0);
})().catch((e) => { console.error("補發失敗:", e); process.exit(1); });
