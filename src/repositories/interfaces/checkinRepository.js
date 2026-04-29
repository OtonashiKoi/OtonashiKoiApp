class CheckinRepository {
  async save() {
    throw new Error("save must be implemented");
  }

  async findLastByDiscordId() {
    throw new Error("findLastByDiscordId must be implemented");
  }

  async listByDiscordId() {
    throw new Error("listByDiscordId must be implemented");
  }

  async findLastByPlatformUserId() {
    throw new Error("findLastByPlatformUserId must be implemented");
  }
}

module.exports = {
  CheckinRepository
};
