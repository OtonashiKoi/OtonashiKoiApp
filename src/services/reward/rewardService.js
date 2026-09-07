const { AppError, ERROR_CODES } = require("../../shared/errors");
const { isValidCurrencySource } = require("../../shared/sources");

class RewardService {
  constructor(playerService, walletRepository, transactionRepository) {
    this.playerService = playerService;
    this.walletRepository = walletRepository;
    this.transactionRepository = transactionRepository;
  }

  async grantCurrency({ discordId, displayName, currencyType, amount, source, sourceRef = "", operator }) {
    if (!Number.isSafeInteger(amount) || amount === 0) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "amount must be a non-zero integer", 400);
    }

    if (!["gold", "diamond"].includes(currencyType)) {
      throw new AppError(ERROR_CODES.UNSUPPORTED_CURRENCY, `Unsupported currency type: ${currencyType}`, 400);
    }

    if (!isValidCurrencySource(source)) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, `unsupported currency source: ${source}`, 400);
    }

    const normalizedSourceRef = String(sourceRef || "").trim();
    const { player } = await this.playerService.ensurePlayer(discordId, displayName);
    if (typeof this.transactionRepository.grantCurrencyAtomic !== "function") {
      throw new Error("Currency settlement requires a transactional repository");
    }
    const result = await this.transactionRepository.grantCurrencyAtomic({
      playerId: player.discordId, currencyType, amount, source,
      sourceRef: normalizedSourceRef, operator
    });
    require("../../adapters/mongo/requestCache").clearCurrentCache();
    return { player, ...result };
  }
}

module.exports = {
  RewardService
};
