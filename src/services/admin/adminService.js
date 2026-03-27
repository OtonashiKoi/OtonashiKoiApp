const { createAdminActionLog } = require("../../domain/audit/createAdminActionLog");
const { AppError, ERROR_CODES } = require("../../shared/errors");
const { CURRENCY_SOURCES, EXP_SOURCES } = require("../../shared/sources");

class AdminService {
  constructor(playerService, rewardService, transactionService, progressService, adminActionLogRepository) {
    this.playerService = playerService;
    this.rewardService = rewardService;
    this.transactionService = transactionService;
    this.progressService = progressService;
    this.adminActionLogRepository = adminActionLogRepository;
  }

  async grantCurrencyByAdmin({ adminId, targetDiscordId, displayName, currencyType, amount, reason }) {
    if (!adminId || !targetDiscordId) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "adminId and targetDiscordId are required", 400);
    }

    const rewardResult = await this.rewardService.grantCurrency({
      discordId: targetDiscordId,
      displayName,
      currencyType,
      amount,
      source: amount >= 0 ? CURRENCY_SOURCES.ADMIN_MANUAL_GRANT : CURRENCY_SOURCES.ADMIN_MANUAL_DEDUCT,
      operator: adminId
    });

    const actionLog = createAdminActionLog({
      adminId,
      targetPlayerId: targetDiscordId,
      actionType: "grant-currency",
      payload: { currencyType, amount, reason }
    });

    await this.adminActionLogRepository.append(actionLog);
    return { ...rewardResult, actionLog };
  }

  async grantExpByAdmin({ adminId, targetDiscordId, displayName, amount, reason }) {
    if (!adminId || !targetDiscordId) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "adminId and targetDiscordId are required", 400);
    }

    const progressResult = await this.progressService.grantExp({
      discordId: targetDiscordId,
      displayName,
      amount,
      source: EXP_SOURCES.ADMIN_MANUAL_GRANT_EXP
    });

    const actionLog = createAdminActionLog({
      adminId,
      targetPlayerId: targetDiscordId,
      actionType: "grant-exp",
      payload: { amount, reason, level: progressResult.progress.level }
    });

    await this.adminActionLogRepository.append(actionLog);
    return { ...progressResult, actionLog };
  }

  async getPlayerSnapshot(targetDiscordId, displayName) {
    const profile = await this.playerService.getProfile(targetDiscordId, displayName);
    const transactionSummary = await this.transactionService.listRecentByDiscordId(targetDiscordId, displayName, 10);
    return {
      ...profile,
      transactions: transactionSummary.transactions
    };
  }

  async listRecentAuditLogs(limit = 20) {
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
    return this.adminActionLogRepository.listRecent(safeLimit);
  }
}

module.exports = {
  AdminService
};