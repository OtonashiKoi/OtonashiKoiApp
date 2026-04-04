const { PlayerRepository } = require("../../repositories/interfaces/playerRepository");
const { readStore, writeStore } = require("./jsonStore");

class JsonPlayerRepository extends PlayerRepository {
  async findByDiscordId(discordId) {
    const data = await readStore();
    return data.players[discordId] || null;
  }

  async save(player) {
    const data = await readStore();
    data.players[player.discordId] = player;
    await writeStore(data);
    return player;
  }

  async listAll() {
    const data = await readStore();
    return Object.values(data.players || {});
  }

  /** 依外部平台 ID 查找玩家，platform 如 'youtube'/'twitch' */
  async findByExternalId(platform, platformUserId) {
    const data = await readStore();
    return Object.values(data.players || {}).find(
      (p) => p.externalIds && p.externalIds[platform] === platformUserId
    ) || null;
  }
}

module.exports = {
  JsonPlayerRepository
};