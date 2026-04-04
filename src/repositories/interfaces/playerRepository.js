class PlayerRepository {
  async findByDiscordId() {
    throw new Error("findByDiscordId must be implemented");
  }

  async save() {
    throw new Error("save must be implemented");
  }

  async listAll() {
    throw new Error("listAll must be implemented");
  }

  async findByExternalId() {
    throw new Error("findByExternalId must be implemented");
  }
}

module.exports = {
  PlayerRepository
};