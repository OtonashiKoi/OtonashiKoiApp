// 冒煙測試：開一輪 → 模擬下注 → 結算 → 驗證 DB 紀錄
require("dotenv").config();
const { createServiceContext } = require("../src/services/createServiceContext");
const { getMongoDb } = require("../src/adapters/mongo/createMongoClient");

(async () => {
  const ctx = createServiceContext();
  const casino = ctx.casinoService;
  const db = await getMongoDb();

  // 清掉前測殘留
  await db.collection("casinoState").deleteMany({});
  await db.collection("casinoBets").deleteMany({ discordId: { $in: ["smoke_alice", "smoke_bob"] } });

  // 先確保兩個測試玩家有錢
  for (const id of ["smoke_alice", "smoke_bob"]) {
    await ctx.playerService.ensurePlayer(id, id);
    const w = await ctx.walletRepository.findByPlayerId(id);
    await ctx.walletRepository.save({ ...w, gold: 100000 });
  }

  // 啟動服務 → 開第一輪
  await casino.start();
  let round = await casino.getCurrentRound();
  console.log("開盤：", { roundId: round.roundId, status: round.status, startedAt: new Date(round.startedAt).toISOString(), endAt: new Date(round.endAt).toISOString() });

  // 兩個玩家下注
  await casino.placeBet({ discordId: "smoke_alice", displayName: "Alice", color: "yellow", amount: 1000 });
  await casino.placeBet({ discordId: "smoke_bob",   displayName: "Bob",   color: "purple", amount: 10000 });
  console.log("下注完成");

  // 訂閱結算事件
  const settled = new Promise((resolve) => {
    casino.subscribe((event, payload) => {
      console.log(`[event:${event}]`, JSON.stringify(payload).slice(0, 300));
      if (event === "round:settled") resolve(payload);
    });
  });

  // 強制把 lockedAt/endAt 拉到現在 → tick 觸發結算
  round = await casino.getCurrentRound();
  await db.collection("casinoState").updateOne(
    { _id: "default" },
    { $set: { "currentRound.lockedAt": Date.now() - 100, "currentRound.endAt": Date.now() - 50 } }
  );

  const result = await Promise.race([
    settled,
    new Promise((_, rej) => setTimeout(() => rej(new Error("結算超時")), 5000))
  ]);
  console.log("\n=== 結算結果 ===");
  console.log(JSON.stringify(result, null, 2).slice(0, 1500));

  // 驗證 DB 紀錄
  const bets = await db.collection("casinoBets").find({ roundId: round.roundId }).toArray();
  console.log(`\nDB 內 bets (${bets.length}):`);
  for (const b of bets) console.log(`  ${b.discordId} ${b.color} ${b.amount} → ${b.outcome} payout=${b.payout} drop=${b.dropKey || "-"}`);
  const roundDoc = await db.collection("casinoRounds").findOne({ roundId: round.roundId });
  console.log("\nDB 內 round:", roundDoc);

  // 檢查錢包
  for (const id of ["smoke_alice", "smoke_bob"]) {
    const w = await ctx.walletRepository.findByPlayerId(id);
    console.log(`${id} 結算後金幣: ${w.gold}`);
  }

  casino.stop();
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
