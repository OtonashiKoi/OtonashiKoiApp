const { createTransactionLog } = require("../../domain/transaction/createTransactionLog");
const { AppError, ERROR_CODES } = require("../../shared/errors");
const { isValidCurrencySource } = require("../../shared/sources");

class RewardService {
  constructor(playerService, walletRepository, transactionRepository) {
    this.playerService = playerService;
    this.walletRepository = walletRepository;
    this.transactionRepository = transactionRepository;
  }

  async grantCurrency({ discordId, displayName, currencyType, amount, source, sourceRef = "", operator }) {
    if (!Number.isInteger(amount) || amount === 0) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "amount must be a non-zero integer", 400);
    }

    if (!["gold", "diamond"].includes(currencyType)) {
      throw new AppError(ERROR_CODES.UNSUPPORTED_CURRENCY, `Unsupported currency type: ${currencyType}`, 400);
    }

    if (!isValidCurrencySource(source)) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, `unsupported currency source: ${source}`, 400);
    }

    const normalizedSourceRef = String(sourceRef || "").trim();
    if (normalizedSourceRef && typeof this.transactionRepository?.findBySourceAndRef === "function") {
      const existingTransaction = await this.transactionRepository.findBySourceAndRef(source, normalizedSourceRef);
      if (existingTransaction) {
        const { player, wallet } = await this.playerService.ensurePlayer(discordId, displayName);
        return { player, wallet, transaction: existingTransaction, duplicated: true };
      }
    }

    const { player, wallet } = await this.playerService.ensurePlayer(discordId, displayName);

    let nextWallet;
    let balanceAfter;
    if (typeof this.walletRepository.incBalance === "function") {
      // 原子增減餘額，避免併發 read-modify-write 造成餘額覆寫遺失
      const updated = await this.walletRepository.incBalance(player.discordId, currencyType, amount);
      if (!updated) {
        // 扣款時餘額不足（原子條件未命中）
        throw new AppError(ERROR_CODES.INSUFFICIENT_BALANCE, `${currencyType} balance is not enough`, 400);
      }
      nextWallet = updated;
      balanceAfter = currencyType === "diamond" ? updated.diamond : updated.gold;
    } else {
      // 後備：repository 無原子方法時退回 read-modify-write
      nextWallet = { ...wallet, updatedAt: new Date().toISOString() };
      const currentBalance = currencyType === "diamond" ? nextWallet.diamond : nextWallet.gold;
      const nextBalance = currentBalance + amount;
      if (amount < 0 && nextBalance < 0) {
        throw new AppError(ERROR_CODES.INSUFFICIENT_BALANCE, `${currencyType} balance is not enough`, 400);
      }
      if (currencyType === "diamond") {
        nextWallet.diamond = nextBalance;
      } else {
        nextWallet.gold = nextBalance;
      }
      balanceAfter = currencyType === "diamond" ? nextWallet.diamond : nextWallet.gold;
      await this.walletRepository.save(nextWallet);
    }

    const transaction = createTransactionLog({
      playerId: player.discordId,
      currencyType,
      amount,
      direction: amount >= 0 ? "credit" : "debit",
      source,
      sourceRef: normalizedSourceRef,
      balanceAfter,
      operator
    });

    await this.transactionRepository.append(transaction);
    return { player, wallet: nextWallet, transaction };
  }
}

module.exports = {
  RewardService
};
