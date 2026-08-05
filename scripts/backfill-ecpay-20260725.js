"use strict";
// 2026-07-25 綠界補發：玩家 553639946477371419（印魂ソウルカブ）三筆未發放
//   21:35:48 NT$500  TradeNo 2607252135487516  unbound(no-code-match)
//   22:24:49 NT$100  TradeNo 2607252224491907  mac_failed(checkmac-mismatch)
//   22:37:50 NT$100  TradeNo 2607252237502820  unbound(no-code-match)
// 使用者以綠界商家後台畫面核對訂單歸屬本人後指示補發。
// 走正式收單同一條 settleForPlayer 管線：sourceRef 冪等，重跑不會重複發。
require("dotenv").config();
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");
const { createServiceContext } = require("../src/services/createServiceContext");
const { settleForPlayer } = require("../src/services/payment/ecpayDonationService");

const DISCORD_ID = "553639946477371419";
const DISPLAY_NAME = "印魂ソウルカブ";
const ORDERS = [
  { tradeNo: "2607252135487516", twdAmount: 500 },
  { tradeNo: "2607252224491907", twdAmount: 100 },
  { tradeNo: "2607252237502820", twdAmount: 100 },
];

(async () => {
  const sc = createServiceContext();
  const db = await getMongoDb();

  for (const o of ORDERS) {
    const sourceRef = `ecpay:${o.tradeNo}`;
    const r = await settleForPlayer(
      { discordId: DISCORD_ID, displayName: DISPLAY_NAME, twdAmount: o.twdAmount, sourceRef },
      sc
    );
    console.log(`TradeNo ${o.tradeNo} NT$${o.twdAmount} →`, JSON.stringify(r));

    // 綠界原始收單記錄補註（best-effort；欄位名先探再更新）
    const raw = await db.collection("ecpayDonations").findOne({
      $or: [{ tradeNo: o.tradeNo }, { TradeNo: o.tradeNo }, { merchantTradeNo: o.tradeNo }]
    });
    if (raw) {
      await db.collection("ecpayDonations").updateOne(
        { _id: raw._id },
        { $set: { status: "manual_granted", backfillNote: `2026-07-25 使用者核對商家後台後指示補發 → ${DISCORD_ID}`, backfillAt: new Date().toISOString() } }
      );
      console.log(`  └ ecpayDonations 原始記錄已標記 manual_granted`);
    } else {
      console.log(`  └ ⚠️ ecpayDonations 找不到原始記錄（欄位名不符？不影響發放）`);
    }
  }

  // 結果驗證
  const led = await db.collection("donationLedger").findOne({ discordId: DISCORD_ID });
  console.log("台帳結果:", JSON.stringify({ pending: led?.pendingTwd, total: led?.totalTwd }));
  const wallet = await sc.walletRepository.findByPlayerId(DISCORD_ID);
  console.log("錢包鑽石:", wallet?.diamond);
  process.exit(0);
})().catch((e) => { console.error("補發失敗:", e); process.exit(1); });
