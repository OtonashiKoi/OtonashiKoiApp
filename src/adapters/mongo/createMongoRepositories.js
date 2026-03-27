const { getMongoDb } = require("./createMongoClient");

function createMongoRepositories() {
  const collection = async (name) => (await getMongoDb()).collection(name);

  return {
    accessControlRepository: {
      async get() {
        const row = await (await collection("accessControl")).findOne({ _id: "default" });
        return row?.value || {
          discord: { adminRoleIds: [], adminUserIds: [], playerRoleIds: [], playerUserIds: [] }
        };
      },
      async save(accessControl) {
        await (await collection("accessControl")).updateOne(
          { _id: "default" },
          { $set: { value: accessControl, updatedAt: new Date().toISOString() } },
          { upsert: true }
        );
        return accessControl;
      }
    },
    channelLayoutRepository: {
      async get() {
        const row = await (await collection("channelLayout")).findOne({ _id: "default" });
        return row?.value || { discord: { bindings: [] } };
      },
      async save(channelLayout) {
        await (await collection("channelLayout")).updateOne(
          { _id: "default" },
          { $set: { value: channelLayout, updatedAt: new Date().toISOString() } },
          { upsert: true }
        );
        return channelLayout;
      }
    },
    playerRepository: {
      async findByDiscordId(discordId) {
        return (await collection("players")).findOne({ discordId });
      },
      async save(player) {
        await (await collection("players")).updateOne(
          { discordId: player.discordId },
          { $set: player },
          { upsert: true }
        );
        return player;
      },
      async listAll() {
        return (await collection("players")).find({}).toArray();
      }
    },
    walletRepository: {
      async findByPlayerId(playerId) {
        return (await collection("wallets")).findOne({ playerId });
      },
      async save(wallet) {
        await (await collection("wallets")).updateOne(
          { playerId: wallet.playerId },
          { $set: wallet },
          { upsert: true }
        );
        return wallet;
      }
    },
    progressRepository: {
      async findByPlayerId(playerId) {
        return (await collection("progress")).findOne({ playerId });
      },
      async save(progress) {
        await (await collection("progress")).updateOne(
          { playerId: progress.playerId },
          { $set: progress },
          { upsert: true }
        );
        return progress;
      }
    },
    transactionRepository: {
      async append(transaction) {
        await (await collection("transactions")).insertOne(transaction);
        return transaction;
      },
      async listByPlayerId(playerId, limit = 20) {
        return (await collection("transactions"))
          .find({ playerId })
          .sort({ createdAt: -1 })
          .limit(limit)
          .toArray();
      }
    },
    adminActionLogRepository: {
      async append(entry) {
        await (await collection("adminActionLogs")).insertOne(entry);
        return entry;
      },
      async listRecent(limit = 20) {
        return (await collection("adminActionLogs"))
          .find({})
          .sort({ createdAt: -1 })
          .limit(limit)
          .toArray();
      }
    }
  };
}

module.exports = {
  createMongoRepositories
};