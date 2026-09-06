"use strict";

const { randomUUID } = require("crypto");
const { withMongoTransaction } = require("./createMongoClient");
const { calculateSettlement } = require("../../services/mahjongPrediction/mahjongPredictionConfig");

function duplicateBetError() {
  const error = new Error("本盤你已經投注，封盤前也不能重複下注。");
  error.code = "DUPLICATE_BET";
  return error;
}

function createMahjongPredictionRepository({ collection }) {
  return {
    async ensureWallet(playerId, displayName, initialBalance) {
      return withMongoTransaction(async (db, session) => {
        const now = new Date().toISOString();
        const result = await db.collection("mahjongPredictionWallets").updateOne(
          { playerId },
          {
            $setOnInsert: {
              playerId,
              balance: initialBalance,
              createdAt: now,
              initialGrantAt: now,
              lastDailyClaimKey: null,
            },
            $set: { displayName: displayName || playerId, updatedAt: now },
          },
          { upsert: true, session }
        );
        if (result.upsertedCount > 0) {
          await db.collection("mahjongPredictionTransactions").insertOne({
            transactionId: randomUUID(),
            playerId,
            displayName: displayName || playerId,
            amount: initialBalance,
            balanceBefore: 0,
            balanceAfter: initialBalance,
            type: "initial_grant",
            label: "首次領取戀雀券",
            sourceRef: `initial:${playerId}`,
            createdAt: now,
          }, { session });
        }
        return db.collection("mahjongPredictionWallets").findOne({ playerId }, { session });
      });
    },

    async claimDaily(playerId, displayName, claimKey, amount) {
      return withMongoTransaction(async (db, session) => {
        const now = new Date().toISOString();
        const wallet = await db.collection("mahjongPredictionWallets").findOneAndUpdate(
          { playerId, lastDailyClaimKey: { $ne: claimKey } },
          {
            $inc: { balance: amount },
            $set: { displayName: displayName || playerId, lastDailyClaimKey: claimKey, lastDailyClaimAt: now, updatedAt: now },
          },
          { returnDocument: "after", session }
        );
        if (!wallet) throw new Error("今天已經領過每日戀雀券。");
        await db.collection("mahjongPredictionTransactions").insertOne({
          transactionId: randomUUID(), playerId, displayName: displayName || playerId,
          amount, balanceBefore: wallet.balance - amount, balanceAfter: wallet.balance,
          type: "daily_grant", label: "每日戀雀券", sourceRef: `daily:${claimKey}:${playerId}`, createdAt: now,
        }, { session });
        return wallet;
      });
    },

    async getWallet(playerId) {
      return (await collection("mahjongPredictionWallets")).findOne({ playerId });
    },

    async getState() {
      return (await collection("mahjongPredictionState")).findOne({ _id: "default" });
    },

    async getCurrentMarket() {
      const state = await this.getState();
      if (!state?.currentMarketId) return null;
      return (await collection("mahjongPredictionMarkets")).findOne({ marketId: state.currentMarketId });
    },

    async createMarket(market) {
      return withMongoTransaction(async (db, session) => {
        const active = await db.collection("mahjongPredictionMarkets").findOne(
          { status: { $in: ["open", "locked"] } },
          { session }
        );
        if (active) throw new Error("目前仍有尚未結算的盤口，請先結算或作廢。");
        const now = new Date().toISOString();
        const state = await db.collection("mahjongPredictionState").findOneAndUpdate(
          { _id: "default" },
          {
            $inc: { nextSequence: 1 },
            $set: { enabled: true, sessionLabel: market.sessionLabel || "雀魂直播", updatedAt: now },
            $setOnInsert: { createdAt: now },
          },
          { upsert: true, returnDocument: "after", session }
        );
        const doc = {
          ...market,
          marketId: randomUUID(),
          sequence: Number(state?.nextSequence) || 1,
          status: "open",
          pools: Object.fromEntries(market.options.map((option) => [option.id, 0])),
          betCount: 0,
          totalStaked: 0,
          openedAt: now,
          createdAt: now,
          updatedAt: now,
        };
        await db.collection("mahjongPredictionMarkets").insertOne(doc, { session });
        await db.collection("mahjongPredictionState").updateOne(
          { _id: "default" },
          { $set: { currentMarketId: doc.marketId, updatedAt: now } },
          { session }
        );
        return doc;
      });
    },

    async lockMarket(marketId, reason = "manual") {
      const now = new Date().toISOString();
      const market = await (await collection("mahjongPredictionMarkets")).findOneAndUpdate(
        { marketId, status: "open" },
        { $set: { status: "locked", lockReason: reason, lockedAt: now, updatedAt: now } },
        { returnDocument: "after" }
      );
      if (market) return market;
      const existing = await (await collection("mahjongPredictionMarkets")).findOne({ marketId });
      if (existing?.status === "locked") return existing;
      throw new Error("盤口已經結算、作廢或不存在。");
    },

    async placeBet({ marketId, playerId, displayName, optionId, amount }) {
      try {
        return await withMongoTransaction(async (db, session) => {
          const nowMs = Date.now();
          const now = new Date(nowMs).toISOString();
          const market = await db.collection("mahjongPredictionMarkets").findOne(
            { marketId, status: "open", lockAtMs: { $gt: nowMs } },
            { session }
          );
          if (!market) throw new Error("本盤已封盤，請等待下一盤。");
          if (!(market.options || []).some((option) => option.id === optionId)) throw new Error("無效的投注選項。");

          const bet = {
            betId: randomUUID(), marketId, marketSequence: market.sequence,
            playerId, displayName: displayName || playerId, optionId, amount,
            status: "placed", placedAt: now, createdAt: now, updatedAt: now,
          };
          await db.collection("mahjongPredictionBets").insertOne(bet, { session });
          const wallet = await db.collection("mahjongPredictionWallets").findOneAndUpdate(
            { playerId, balance: { $gte: amount } },
            { $inc: { balance: -amount }, $set: { updatedAt: now } },
            { returnDocument: "after", session }
          );
          if (!wallet) throw new Error("戀雀券不足。");

          const marketUpdate = await db.collection("mahjongPredictionMarkets").updateOne(
            { marketId, status: "open", lockAtMs: { $gt: nowMs } },
            {
              $inc: { [`pools.${optionId}`]: amount, totalStaked: amount, betCount: 1 },
              $set: { updatedAt: now },
            },
            { session }
          );
          if (!marketUpdate.matchedCount) throw new Error("本盤剛剛已封盤，投注未成立。");

          await db.collection("mahjongPredictionTransactions").insertOne({
            transactionId: randomUUID(), playerId, displayName: displayName || playerId,
            amount: -amount, balanceBefore: wallet.balance + amount, balanceAfter: wallet.balance,
            type: "bet", label: `第 ${market.sequence} 盤投注`, marketId, betId: bet.betId,
            sourceRef: `bet:${bet.betId}`, createdAt: now,
          }, { session });
          return { bet, wallet, marketSequence: market.sequence };
        });
      } catch (error) {
        if (error?.code === 11000) throw duplicateBetError();
        throw error;
      }
    },

    async settleMarket({ marketId, winningOptionId, resultMeta }) {
      return withMongoTransaction(async (db, session) => {
        const market = await db.collection("mahjongPredictionMarkets").findOne({ marketId }, { session });
        if (!market) throw new Error("找不到盤口。");
        if (market.status === "settled") {
          if (market.winningOptionId === winningOptionId) return market;
          throw new Error("盤口已經用不同結果結算，不能重複修改。");
        }
        if (!["open", "locked"].includes(market.status)) throw new Error("這個盤口目前不能結算。");
        if (!(market.options || []).some((option) => option.id === winningOptionId)) throw new Error("無效的結算選項。");
        const bets = await db.collection("mahjongPredictionBets").find({ marketId, status: "placed" }, { session }).toArray();
        const summary = calculateSettlement(market, bets, winningOptionId);
        const now = new Date().toISOString();

        for (const outcome of summary.outcomes) {
          if (outcome.payout > 0) {
            const wallet = await db.collection("mahjongPredictionWallets").findOneAndUpdate(
              { playerId: outcome.playerId },
              { $inc: { balance: outcome.payout }, $set: { updatedAt: now } },
              { returnDocument: "after", session }
            );
            if (!wallet) throw new Error(`找不到玩家 ${outcome.playerId} 的戀雀券錢包。`);
            await db.collection("mahjongPredictionTransactions").insertOne({
              transactionId: randomUUID(), playerId: outcome.playerId, displayName: outcome.displayName,
              amount: outcome.payout, balanceBefore: wallet.balance - outcome.payout, balanceAfter: wallet.balance,
              type: "payout", label: `第 ${market.sequence} 盤派彩`, marketId, betId: outcome.betId,
              sourceRef: `payout:${outcome.betId}`, createdAt: now,
            }, { session });
          }
          await db.collection("mahjongPredictionBets").updateOne(
            { betId: outcome.betId, status: "placed" },
            { $set: { status: outcome.won ? "won" : "lost", payout: outcome.payout, profit: outcome.profit, settledAt: now, updatedAt: now } },
            { session }
          );
        }

        const winningOption = market.options.find((option) => option.id === winningOptionId);
        const result = await db.collection("mahjongPredictionMarkets").findOneAndUpdate(
          { marketId, status: { $in: ["open", "locked"] } },
          { $set: {
            status: "settled", winningOptionId, winningOptionLabel: winningOption.label,
            resultMeta: resultMeta || {}, settledAt: now, updatedAt: now,
            totalPayout: summary.totalPayout, houseTake: summary.houseTake,
          } },
          { returnDocument: "after", session }
        );
        if (!result) throw new Error("盤口在結算期間已被其他操作更新。");
        return { ...result, settlementSummary: summary };
      });
    },

    async voidMarket({ marketId, reason }) {
      return withMongoTransaction(async (db, session) => {
        const market = await db.collection("mahjongPredictionMarkets").findOne({ marketId }, { session });
        if (!market) throw new Error("找不到盤口。");
        if (market.status === "void") return market;
        if (!["open", "locked"].includes(market.status)) throw new Error("已結算的盤口不能作廢。");
        const bets = await db.collection("mahjongPredictionBets").find({ marketId, status: "placed" }, { session }).toArray();
        const now = new Date().toISOString();
        for (const bet of bets) {
          const wallet = await db.collection("mahjongPredictionWallets").findOneAndUpdate(
            { playerId: bet.playerId },
            { $inc: { balance: bet.amount }, $set: { updatedAt: now } },
            { returnDocument: "after", session }
          );
          if (!wallet) throw new Error(`找不到玩家 ${bet.playerId} 的戀雀券錢包。`);
          await db.collection("mahjongPredictionTransactions").insertOne({
            transactionId: randomUUID(), playerId: bet.playerId, displayName: bet.displayName,
            amount: bet.amount, balanceBefore: wallet.balance - bet.amount, balanceAfter: wallet.balance,
            type: "refund", label: `第 ${market.sequence} 盤作廢退款`, marketId, betId: bet.betId,
            sourceRef: `refund:${bet.betId}`, createdAt: now,
          }, { session });
          await db.collection("mahjongPredictionBets").updateOne(
            { betId: bet.betId, status: "placed" },
            { $set: { status: "refunded", payout: bet.amount, settledAt: now, updatedAt: now } },
            { session }
          );
        }
        return db.collection("mahjongPredictionMarkets").findOneAndUpdate(
          { marketId, status: { $in: ["open", "locked"] } },
          { $set: { status: "void", voidReason: reason, voidedAt: now, updatedAt: now, totalPayout: market.totalStaked || 0, houseTake: 0 } },
          { returnDocument: "after", session }
        );
      });
    },

    async listRecentMarkets(limit = 10) {
      return (await collection("mahjongPredictionMarkets")).find({ status: { $in: ["settled", "void"] } })
        .sort({ sequence: -1 }).limit(limit).toArray();
    },

    async listPlayerBets(playerId, limit = 20) {
      return (await collection("mahjongPredictionBets")).find({ playerId }).sort({ placedAt: -1 }).limit(limit).toArray();
    },

    async findPlayerBet(marketId, playerId) {
      if (!marketId) return null;
      return (await collection("mahjongPredictionBets")).findOne({ marketId, playerId });
    },

    async listPlayerTransactions(playerId, limit = 20) {
      return (await collection("mahjongPredictionTransactions")).find({ playerId }).sort({ createdAt: -1 }).limit(limit).toArray();
    },

    async getAdminStats() {
      const [walletStats, betStats] = await Promise.all([
        (await collection("mahjongPredictionWallets")).aggregate([{ $group: { _id: null, wallets: { $sum: 1 }, circulation: { $sum: "$balance" } } }]).toArray(),
        (await collection("mahjongPredictionBets")).aggregate([{ $group: { _id: null, bets: { $sum: 1 }, totalStaked: { $sum: "$amount" } } }]).toArray(),
      ]);
      return { wallets: walletStats[0]?.wallets || 0, circulation: walletStats[0]?.circulation || 0, bets: betStats[0]?.bets || 0, totalStaked: betStats[0]?.totalStaked || 0 };
    },
  };
}

module.exports = { createMahjongPredictionRepository };
