const { TransactionRepository } = require("../../repositories/interfaces/transactionRepository");
const { readStore, writeStore } = require("./jsonStore");

class JsonTransactionRepository extends TransactionRepository {
  async append(transaction) {
    const data = await readStore();
    data.transactions.push(transaction);
    await writeStore(data);
    return transaction;
  }

  async listByPlayerId(playerId, limit = 20) {
    const data = await readStore();
    return data.transactions
      .filter((entry) => entry.playerId === playerId)
      .slice(-limit)
      .reverse();
  }
}

module.exports = {
  JsonTransactionRepository
};