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
    },
    checkinRepository: {
      async save(checkin) {
        await (await collection("checkins")).insertOne(checkin);
        return checkin;
      },
      async findLastByDiscordId(discordId) {
        const results = await (await collection("checkins"))
          .find({ discordId })
          .sort({ occurredAt: -1 })
          .limit(1)
          .toArray();
        return results[0] || null;
      },
      async listByDiscordId(discordId) {
        return (await collection("checkins")).find({ discordId }).toArray();
      }
    },
    shopRepository: {
      async findAll() {
        return (await collection("shopItems")).find({}).toArray();
      },
      async findById(id) {
        return (await collection("shopItems")).findOne({ id }) || null;
      },
      async save(item) {
        await (await collection("shopItems")).updateOne(
          { id: item.id },
          { $set: item },
          { upsert: true }
        );
        return item;
      },
      async delete(id) {
        await (await collection("shopItems")).deleteOne({ id });
      }
    },
    itemRepository: {
      async findAll() {
        return (await collection("items")).find({}).toArray();
      },
      async findById(id) {
        return (await collection("items")).findOne({ id }) || null;
      },
      async save(item) {
        await (await collection("items")).updateOne(
          { id: item.id },
          { $set: item },
          { upsert: true }
        );
        return item;
      },
      async delete(id) {
        await (await collection("items")).deleteOne({ id });
      }
    },
    playerTierRepository: {
      async getAll() {
        const TIER_RANKS = ["E", "D", "C", "B", "A", "S", "SS"];
        const row = await (await collection("playerTiers")).findOne({ _id: "default" });
        const stored = row?.value || {};
        const result = {};
        for (const rank of TIER_RANKS) {
          result[rank] = stored[rank] || { label: `${rank}級`, roleIds: [] };
          if (!Array.isArray(result[rank].roleIds)) result[rank].roleIds = [];
        }
        return result;
      },
      async save(tiers) {
        const TIER_RANKS = ["E", "D", "C", "B", "A", "S", "SS"];
        const normalized = {};
        for (const rank of TIER_RANKS) {
          const t = tiers[rank] || {};
          normalized[rank] = {
            label: typeof t.label === "string" && t.label.trim() ? t.label.trim() : `${rank}級`,
            roleIds: Array.isArray(t.roleIds) ? t.roleIds.map(String).filter(Boolean) : []
          };
        }
        await (await collection("playerTiers")).updateOne(
          { _id: "default" },
          { $set: { value: normalized, updatedAt: new Date().toISOString() } },
          { upsert: true }
        );
        return normalized;
      }
    }
  };
}

module.exports = {
  createMongoRepositories
};