class TransactionService {
  constructor(playerService, transactionRepository) {
    this.playerService = playerService;
    this.transactionRepository = transactionRepository;
  }

  async listRecentByDiscordId(discordId, displayName, limit = 10) {
    const { player } = await this.playerService.ensurePlayer(discordId, displayName);
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 10));
    const transactions = await this.transactionRepository.listByPlayerId(player.discordId, safeLimit);
    return { player, transactions };
  }
}

module.exports = {
  TransactionService
};