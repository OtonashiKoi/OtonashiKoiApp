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
      async findByExternalId(platform, platformUserId) {
        return (await collection("players")).findOne({ [`externalIds.${platform}`]: platformUserId });
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
      },
      async listAll() {
        return (await collection("wallets")).find({}).toArray();
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
      },
      async listAll() {
        return (await collection("progress")).find({}).toArray();
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
      },
      async countAllByPlayer() {
        const agg = await (await collection("checkins")).aggregate([
          { $group: { _id: "$discordId", count: { $sum: 1 } } }
        ]).toArray();
        const counts = {};
        for (const row of agg) counts[row._id] = row.count;
        return counts;
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
    },
    battleConfigRepository: {
      async get() {
        const row = await (await collection("battleConfig")).findOne({ _id: "default" });
        return row?.value || null;
      },
      async save(config) {
        await (await collection("battleConfig")).updateOne(
          { _id: "default" },
          { $set: { value: config, updatedAt: new Date().toISOString() } },
          { upsert: true }
        );
        return config;
      }
    },
    weeklyQuestRepository: {
      async listQuests() {
        return (await collection("weeklyQuests")).find({}).sort({ createdAt: 1 }).toArray();
      },
      async findQuestById(id) {
        return (await collection("weeklyQuests")).findOne({ id }) || null;
      },
      async saveQuest(quest) {
        await (await collection("weeklyQuests")).updateOne(
          { id: quest.id },
          { $set: quest },
          { upsert: true }
        );
        return quest;
      },
      async deleteQuest(id) {
        await (await collection("weeklyQuests")).deleteOne({ id });
      },
      // weekLabel: "2026-W15"
      async getPlayerProgress(discordId, weekLabel) {
        const row = await (await collection("weeklyQuestProgress")).findOne({ discordId, weekLabel });
        return row?.progress || {};
      },
      async savePlayerProgress(discordId, weekLabel, progress) {
        await (await collection("weeklyQuestProgress")).updateOne(
          { discordId, weekLabel },
          { $set: { discordId, weekLabel, progress, updatedAt: new Date().toISOString() } },
          { upsert: true }
        );
      },
      async getAllProgressByWeek(weekLabel) {
        const rows = await (await collection("weeklyQuestProgress")).find({ weekLabel }).toArray();
        const result = {};
        for (const row of rows) result[row.discordId] = row.progress || {};
        return result;
      }
    },
    monsterRepository: {
      async findAll() {
        const monsters = await (await collection("monsters")).find({}).toArray();
        return monsters.sort((a, b) => a.seq - b.seq);
      },
      async findById(id) {
        return (await collection("monsters")).findOne({ id }) || null;
      },
      async save(monster) {
        await (await collection("monsters")).updateOne(
          { id: monster.id },
          { $set: monster },
          { upsert: true }
        );
        return monster;
      },
      async delete(id) {
        await (await collection("monsters")).deleteOne({ id });
      },
      async getState(zoneKey = "normal") {
        const row = await (await collection("monsterState")).findOne({ _id: zoneKey });
        if (!row && zoneKey === "normal") {
          // 向下相容：讀取舊 _id:"default" 的資料
          const legacy = await (await collection("monsterState")).findOne({ _id: "default" });
          return legacy?.value || { activeMonsterSeq: 1, currentHp: null, killCount: {} };
        }
        return row?.value || { activeMonsterSeq: 1, currentHp: null, killCount: {} };
      },
      async saveState(state, zoneKey = "normal") {
        await (await collection("monsterState")).updateOne(
          { _id: zoneKey },
          { $set: { value: state, updatedAt: new Date().toISOString() } },
          { upsert: true }
        );
        return state;
      },
      // 原子收付擊殺權：成功回 true，已被其他進程收付回 false
      // 若先前的 claim 超過 timeoutMs，允許重新 claim（回收無回應的鎖）
      async claimKill(zoneKey, monsterSeq, timeoutMs = 30 * 1000) {
        const col = await collection("monsterState");
        const now = new Date();
        const cutoff = new Date(Date.now() - timeoutMs);

        // 條件：同 zoneKey、activeMonsterSeq 相符，且 killClaimedSeq != monsterSeq
        // 或 killClaimedAt 早於 cutoff（表示前一次 claim 超時），或 killClaimedAt 不存在
        const q = {
          _id: zoneKey,
          "value.activeMonsterSeq": monsterSeq,
          $or: [
            { "value.killClaimedSeq": { $ne: monsterSeq } },
            { "value.killClaimedAt": { $lt: cutoff } },
            { "value.killClaimedAt": { $exists: false } }
          ]
        };

        const update = {
          $set: {
            "value.killClaimedSeq": monsterSeq,
            "value.killClaimedAt": now,
            "value.killClaimedBy": process.pid,
            updatedAt: now.toISOString()
          }
        };

        const result = await col.findOneAndUpdate(q, update, { returnDocument: 'after' });
        // 如果沒找到會回傳 { value: null }
        return !!(result && result.value);
      }
    },
    monsterEventRepository: {
      async findAll() {
        return (await collection("monsterEvents")).find({}).sort({ zone: 1, priority: 1, createdAt: 1 }).toArray();
      },
      async findById(id) {
        return (await collection("monsterEvents")).findOne({ id }) || null;
      },
      async save(event) {
        await (await collection("monsterEvents")).updateOne(
          { id: event.id },
          { $set: event },
          { upsert: true }
        );
        return event;
      },
      async delete(id) {
        await (await collection("monsterEvents")).deleteOne({ id });
      }
    }
  };
}

module.exports = {
  createMongoRepositories
};
