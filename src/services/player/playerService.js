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
    let [player, wallet, progress] = await Promise.all([
      this.playerRepository.findByDiscordId(discordId),
      this.walletRepository.findByPlayerId(discordId),
      this.progressRepository.findByPlayerId(discordId),
    ]);

    const saves = [];
    if (!player) {
      player = createPlayer(discordId, displayName);
      saves.push(this.playerRepository.save(player));
    }
    if (!wallet) {
      wallet = createWallet(discordId);
      saves.push(this.walletRepository.save(wallet));
    }
    if (!progress) {
      progress = createGameProgress(discordId);
      saves.push(this.progressRepository.save(progress));
    }
    if (saves.length > 0) await Promise.all(saves);

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