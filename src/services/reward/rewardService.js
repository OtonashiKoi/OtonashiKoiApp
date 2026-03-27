const { createTransactionLog } = require("../../domain/transaction/createTransactionLog");
const { AppError, ERROR_CODES } = require("../../shared/errors");
const { isValidCurrencySource } = require("../../shared/sources");

class RewardService {
  constructor(playerService, walletRepository, transactionRepository) {
    this.playerService = playerService;
    this.walletRepository = walletRepository;
    this.transactionRepository = transactionRepository;
  }

  async grantCurrency({ discordId, displayName, currencyType, amount, source, operator }) {
    if (!Number.isInteger(amount) || amount === 0) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "amount must be a non-zero integer", 400);
    }

    if (!["gold", "diamond"].includes(currencyType)) {
      throw new AppError(ERROR_CODES.UNSUPPORTED_CURRENCY, `Unsupported currency type: ${currencyType}`, 400);
    }

    if (!isValidCurrencySource(source)) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, `unsupported currency source: ${source}`, 400);
    }

    const { player, wallet } = await this.playerService.ensurePlayer(discordId, displayName);
    const nextWallet = { ...wallet, updatedAt: new Date().toISOString() };

    const currentBalance = currencyType === "diamond" ? nextWallet.diamond : nextWallet.gold;
    const nextBalance = currentBalance + amount;
    if (nextBalance < 0) {
      throw new AppError(ERROR_CODES.INSUFFICIENT_BALANCE, `${currencyType} balance is not enough`, 400);
    }

    if (currencyType === "diamond") {
      nextWallet.diamond = nextBalance;
    } else {
      nextWallet.gold = nextBalance;
    }

    const balanceAfter = currencyType === "diamond" ? nextWallet.diamond : nextWallet.gold;
    await this.walletRepository.save(nextWallet);

    const transaction = createTransactionLog({
      playerId: player.discordId,
      currencyType,
      amount,
      direction: amount >= 0 ? "credit" : "debit",
      source,
      sourceRef: "",
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