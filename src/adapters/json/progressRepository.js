const { ProgressRepository } = require("../../repositories/interfaces/progressRepository");
const { readStore, writeStore } = require("./jsonStore");

class JsonProgressRepository extends ProgressRepository {
  async findByPlayerId(playerId) {
    const data = await readStore();
    return data.progress[playerId] || null;
  }

  async save(progress) {
    const data = await readStore();
    data.progress[progress.playerId] = progress;
    await writeStore(data);
    return progress;
  }
}

module.exports = {
  JsonProgressRepository
};