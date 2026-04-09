const { ProgressRepository } = require("../../repositories/interfaces/progressRepository");
const { readStore, updateStore } = require("./jsonStore");

class JsonProgressRepository extends ProgressRepository {
  async findByPlayerId(playerId) {
    const data = await readStore();
    return data.progress[playerId] || null;
  }

  async save(progress) {
    await updateStore((store) => {
      store.progress[progress.playerId] = progress;
      return store;
    });
    return progress;
  }

  async listAll() {
    const data = await readStore();
    return Object.values(data.progress || {});
  }
}

module.exports = {
  JsonProgressRepository
};