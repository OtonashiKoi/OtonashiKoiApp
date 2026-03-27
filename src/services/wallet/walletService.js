class WalletService {
  constructor(playerService, walletRepository) {
    this.playerService = playerService;
    this.walletRepository = walletRepository;
  }

  async getWalletByDiscordId(discordId, displayName) {
    const { player } = await this.playerService.ensurePlayer(discordId, displayName);
    const wallet = await this.walletRepository.findByPlayerId(player.discordId);
    return { player, wallet };
  }
}

module.exports = {
  WalletService
};