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
    // 傳入的 displayName 是不是「純數字 Discord ID / 等於 ID」的無效名(網頁登入常只帶 ID)。
    // 這種名字不得覆蓋掉已存在的真實暱稱，否則會把排行榜等處的真名一直降級回數字。
    const incomingIsIdLike = !displayName || String(displayName) === String(discordId) || /^\d{15,}$/.test(String(displayName));
    if (!player) {
      player = createPlayer(discordId, displayName);
      saves.push(this.playerRepository.save(player));
    } else if (displayName && player.displayName !== displayName) {
      // 現有名已是真名、而傳入的是 ID-like → 保留現有真名(防降級)；其餘情況照常更新。
      const currentIsIdLike = !player.displayName || String(player.displayName) === String(discordId) || /^\d{15,}$/.test(String(player.displayName));
      if (!(incomingIsIdLike && !currentIsIdLike)) {
        player.displayName = displayName;
        player.name = displayName;
        saves.push(this.playerRepository.save(player));
      }
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