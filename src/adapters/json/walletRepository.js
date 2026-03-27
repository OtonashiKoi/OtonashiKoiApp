const { WalletRepository } = require("../../repositories/interfaces/walletRepository");
const { readStore, writeStore } = require("./jsonStore");

class JsonWalletRepository extends WalletRepository {
  async findByPlayerId(playerId) {
    const data = await readStore();
    return data.wallets[playerId] || null;
  }

  async save(wallet) {
    const data = await readStore();
    data.wallets[wallet.playerId] = wallet;
    await writeStore(data);
    return wallet;
  }
}

module.exports = {
  JsonWalletRepository
};