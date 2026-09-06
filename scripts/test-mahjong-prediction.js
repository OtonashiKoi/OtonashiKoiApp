"use strict";

const assert = require("assert");
const jwt = require("jsonwebtoken");
const { calculateSettlement, estimateOptionOdds } = require("../src/services/mahjongPrediction/mahjongPredictionConfig");
const { MahjongPredictionService, taipeiDayKey, publicMarket } = require("../src/services/mahjongPrediction/mahjongPredictionService");
const { deriveMahjongJwtSecret } = require("../src/api/routes/mahjongPredictionRoutes");

function market(overrides = {}) {
  return {
    marketId: "m1", sequence: 1, sessionLabel: "測試直播", handLabel: "東1局",
    marketType: "win", title: "本局能和牌嗎？", status: "open",
    options: [{ id: "win", label: "能和牌" }, { id: "no_win", label: "不能和牌" }],
    pools: { win: 1_000, no_win: 2_000 }, totalStaked: 3_000, betCount: 2,
    lockAtMs: Date.now() + 20_000, ...overrides,
  };
}

async function main() {
  const gameSecret = "test-game-secret";
  const koiSecret = deriveMahjongJwtSecret(gameSecret);
  const koiToken = jwt.sign({ discordId: "koi-player", scope: "mahjong_prediction" }, koiSecret);
  const gameToken = jwt.sign({ discordId: "game-player" }, gameSecret);
  assert.strictEqual(jwt.verify(koiToken, koiSecret).scope, "mahjong_prediction");
  assert.throws(() => jwt.verify(koiToken, gameSecret), /invalid signature/,
    "戀雀 token 不得通過音無樂園的 JWT 驗證");
  assert.throws(() => jwt.verify(gameToken, koiSecret), /invalid signature/,
    "音無樂園 token 不得通過戀雀預測的 JWT 驗證");

  const settlement = calculateSettlement(market(), [
    { betId: "b1", optionId: "win", amount: 1_000 },
    { betId: "b2", optionId: "no_win", amount: 2_000 },
  ], "win");
  assert.deepStrictEqual(settlement.outcomes.map((row) => row.payout), [2_800, 0]);
  assert.strictEqual(settlement.houseTake, 200, "落選池應回收 10%");

  const onlyWinner = calculateSettlement(
    market({ pools: { win: 1_000, no_win: 0 }, totalStaked: 1_000 }),
    [{ betId: "b1", optionId: "win", amount: 1_000 }],
    "win"
  );
  assert.strictEqual(onlyWinner.outcomes[0].payout, 1_000, "沒有落選池時只退回本金");
  assert.strictEqual(onlyWinner.houseTake, 0);

  const splitWinners = calculateSettlement(
    market({ pools: { win: 300, no_win: 700 }, totalStaked: 1_000 }),
    [
      { betId: "b1", optionId: "win", amount: 100 },
      { betId: "b2", optionId: "win", amount: 200 },
      { betId: "b3", optionId: "no_win", amount: 700 },
    ],
    "win"
  );
  assert.deepStrictEqual(splitWinners.outcomes.map((row) => row.payout), [310, 620, 0]);
  assert.strictEqual(splitWinners.totalPayout + splitWinners.houseTake, splitWinners.totalStaked, "派彩與回收合計必須守恆");

  const odds = estimateOptionOdds(market());
  assert.strictEqual(odds[0].estimatedOdds, 2.8);
  assert.strictEqual(odds[1].estimatedOdds, 1.45);
  assert.strictEqual(taipeiDayKey(new Date("2026-09-04T16:30:00Z")), "2026-09-05");
  assert.strictEqual(publicMarket(market({ lockAtMs: Date.now() - 1 })).status, "locked", "倒數到期後公開狀態應自動封盤");

  const calls = [];
  const repo = {
    async getCurrentMarket() { return null; },
    async createMarket(doc) { calls.push(doc); return market({ ...doc, marketId: "created", sequence: 2, pools: Object.fromEntries(doc.options.map((o) => [o.id, 0])), totalStaked: 0, betCount: 0 }); },
  };
  const service = new MahjongPredictionService(repo);
  const created = await service.createMarket({ marketType: "han", handLabel: "南2局 1本場", openSeconds: 30 });
  assert.strictEqual(created.options.length, 4);
  assert.strictEqual(calls[0].handLabel, "南2局 1本場");
  assert.ok(calls[0].lockAtMs > Date.now());

  await assert.rejects(() => service.createMarket({ marketType: "unknown" }), /盤口類型/);
  await assert.rejects(() => service.createMarket({ marketType: "win", openSeconds: 5 }), /10～120/);
  await assert.rejects(() => service.placeBet({ playerId: "p", marketId: "m", optionId: "win", amount: 99 }), /100～5,000/);

  console.log("mahjong prediction: auth isolation, payout, odds, date, validation and market templates passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
