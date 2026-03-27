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
}

module.exports = {
  JsonPlayerRepository
};