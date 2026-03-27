class WalletRepository {
  async findByPlayerId() {
    throw new Error("findByPlayerId must be implemented");
  }

  async save() {
    throw new Error("save must be implemented");
  }
}

module.exports = {
  WalletRepository
};