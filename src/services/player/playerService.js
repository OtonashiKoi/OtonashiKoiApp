const { createPlayer } = require("../../domain/player/createPlayer");
const { createGameProgress } = require("../../domain/progress/createGameProgress");
const { createWallet } = require("../../domain/wallet/createWallet");

class PlayerService {
  constructor(playerRepository, walletRepository, progressRepository) {
    this.playerRepository = playerRepository;
    this.walletRepository = walletRepository;
    this.progressRepository = progressRepository;
  }

  async ensurePlayer(discordId, displayName) {
    let player = await this.playerRepository.findByDiscordId(discordId);
    if (!player) {
      player = createPlayer(discordId, displayName);
      await this.playerRepository.save(player);
    }

    let wallet = await this.walletRepository.findByPlayerId(discordId);
    if (!wallet) {
      wallet = createWallet(discordId);
      await this.walletRepository.save(wallet);
    }

    let progress = await this.progressRepository.findByPlayerId(discordId);
    if (!progress) {
      progress = createGameProgress(discordId);
      await this.progressRepository.save(progress);
    }

    return { player, wallet, progress };
  }

  async getProfile(discordId, displayName) {
    const { player, wallet, progress } = await this.ensurePlayer(discordId, displayName);
    return { player, wallet, progress };
  }
}

module.exports = {
  PlayerService
};