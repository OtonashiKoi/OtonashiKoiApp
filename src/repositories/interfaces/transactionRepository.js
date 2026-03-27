class TransactionRepository {
  async append() {
    throw new Error("append must be implemented");
  }

  async listByPlayerId() {
    throw new Error("listByPlayerId must be implemented");
  }
}

module.exports = {
  TransactionRepository
};