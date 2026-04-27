const { getMongoDb } = require("./createMongoClient");
const { withProgressCache, withWalletCache, withPlayerCache } = require("./requestCache");
const { mergeEquippedFromLibrary } = require("../../shared/effectEngine");

function createMongoRepositories() {
  const collection = async (name) => (await getMongoDb()).collection(name);

  const repos = {
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
        const progress = await (await collection("progress")).findOne({ playerId });
        if (progress?.equipment) {
          // 永遠從 DB 讀取最新 effects，所有呼叫方自動拿到最新設計值
          progress.equipment = await mergeEquippedFromLibrary(progress.equipment, repos.itemRepository).catch(() => progress.equipment);
        }
        return progress;
      },
      async save(progress) {
        let lastError = null;
        const maxRetries = 5;  // 增加重試次數

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            const result = await (await collection("progress")).updateOne(
              { playerId: progress.playerId },
              { $set: { ...progress, updatedAt: new Date().toISOString() } },
              { upsert: true }
            );

            if (result.matchedCount === 0 && result.upsertedCount === 0) {
              console.warn(`[ProgressRepository] Save had no effect for ${progress.playerId}`);
            }
            // 成功保存時記錄
            if (attempt > 1) {
              console.info(`[ProgressRepository] Save succeeded for ${progress.playerId} on attempt ${attempt}`);
            }
            return progress;
          } catch (err) {
            lastError = err;
            const isLastAttempt = attempt === maxRetries;
            console.error(`[ProgressRepository] Save failed for ${progress.playerId} (attempt ${attempt}/${maxRetries}):`, err.message);

            if (!isLastAttempt) {
              // 指數退避：10ms、20ms、40ms、80ms、160ms
              const delay = Math.pow(2, attempt) * 10;
              await new Promise(r => setTimeout(r, delay));
              continue;
            }
          }
        }

        // 重試多次仍失敗，拋出錯誤
        console.error(`[ProgressRepository] CRITICAL: Failed to save progress for ${progress.playerId} after ${maxRetries} attempts. Data loss risk!`, lastError);
        throw lastError;
      },
      // CAS 寫入：只有 updatedAt 未被別人改過才成功，回傳是否成功
      async saveIfUnchanged(progress, prevUpdatedAt) {
        const now = new Date().toISOString();
        const filter = prevUpdatedAt
          ? { playerId: progress.playerId, updatedAt: prevUpdatedAt }
          : { playerId: progress.playerId };
        const result = await (await collection("progress")).updateOne(
          filter,
          { $set: { ...progress, updatedAt: now } },
          { upsert: false }
        );
        return result.matchedCount > 0;
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
    effectDefinitionRepository: {
      async get() {
        const row = await (await collection("effectDefinitions")).findOne({ _id: "default" });
        return row?.value || null;
      },
      async save(config) {
        await (await collection("effectDefinitions")).updateOne(
          { _id: "default" },
          { $set: { value: config, updatedAt: new Date().toISOString() } },
          { upsert: true }
        );
        return config;
      }
    },
    worldBossRepository: {
      async getConfig() {
        const row = await (await collection("worldBossConfig")).findOne({ _id: "default" });
        return row?.value || null;
      },
      async saveConfig(config) {
        await (await collection("worldBossConfig")).updateOne(
          { _id: "default" },
          { $set: { value: config, updatedAt: new Date().toISOString() } },
          { upsert: true }
        );
        return config;
      },
      async getState() {
        const row = await (await collection("worldBossState")).findOne({ _id: "default" });
        return row?.value || null;
      },
      async saveState(state) {
        await (await collection("worldBossState")).updateOne(
          { _id: "default" },
          { $set: { value: state, updatedAt: new Date().toISOString() } },
          { upsert: true }
        );
        return state;
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
      async getPlayerProgress(discordId, periodKey, cadence = "weekly") {
        // 新格式：discordId + cadence + periodKey
        const modern = await (await collection("weeklyQuestProgress")).findOne({ discordId, cadence, periodKey });
        if (modern?.progress) return modern.progress;

        // 舊格式相容：weekly 使用 weekLabel
        if (cadence === "weekly") {
          const legacy = await (await collection("weeklyQuestProgress")).findOne({ discordId, weekLabel: periodKey });
          if (legacy?.progress) return legacy.progress;
        }
        return {};
      },
      async savePlayerProgress(discordId, periodKey, progress, cadence = "weekly") {
        await (await collection("weeklyQuestProgress")).updateOne(
          { discordId, cadence, periodKey },
          { $set: {
            discordId,
            cadence,
            periodKey,
            // 保留舊欄位以維持相容（weekly 才需要）
            weekLabel: cadence === "weekly" ? periodKey : null,
            progress,
            updatedAt: new Date().toISOString()
          } },
          { upsert: true }
        );
      },
      async getAllProgressByPeriod(periodKey, cadence = "weekly") {
        const col = await collection("weeklyQuestProgress");
        const rows = await col.find({ cadence, periodKey }).toArray();
        const result = {};
        for (const row of rows) result[row.discordId] = row.progress || {};

        // weekly 相容：若是舊資料只有 weekLabel，補讀一次
        if (cadence === "weekly") {
          const legacyRows = await col.find({ weekLabel: periodKey, $or: [{ cadence: { $exists: false } }, { cadence: null }] }).toArray();
          for (const row of legacyRows) {
            if (!result[row.discordId]) result[row.discordId] = row.progress || {};
          }
        }
        return result;
      },
      async getAllProgressByWeek(weekLabel) {
        const rows = await (await collection("weeklyQuestProgress")).find({ weekLabel }).toArray();
        const result = {};
        for (const row of rows) result[row.discordId] = row.progress || {};
        return result;
      }
    },
    idleRepository: {
      async listZones() {
        return (await collection("idleZones")).find({}).toArray();
      },
      async findZoneById(id) {
        return (await collection("idleZones")).findOne({ id }) || null;
      },
      async saveZone(zone) {
        await (await collection("idleZones")).updateOne(
          { id: zone.id },
          { $set: zone },
          { upsert: true }
        );
        return zone;
      },
      async deleteZone(id) {
        await (await collection("idleZones")).deleteOne({ id });
      },
      async findPlayerState(playerId) {
        return (await collection("idlePlayerStates")).findOne({ playerId }) || null;
      },
      async savePlayerState(playerId, state) {
        const nextState = {
          ...state,
          playerId,
          updatedAt: new Date().toISOString()
        };
        await (await collection("idlePlayerStates")).updateOne(
          { playerId },
          { $set: nextState },
          { upsert: true }
        );
        return nextState;
      }
    },
    monsterRepository: {
      async findAll() {
        // 只回傳實際的怪物文件（具有 id 欄位），state 文件使用 _id 儲存，不會被此查詢回傳
        const monsters = await (await collection("monsters")).find({ id: { $exists: true } }).toArray();
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
        // 1) 優先讀取 monsters collection 內嵌的 state 文件（_id: `monsterState:${zoneKey}`），
        // 2) 若不存在則回退到舊的 monsterState collection（維持相容性）
        const stateDocId = `monsterState:${zoneKey}`;
        const stateRow = await (await collection("monsters")).findOne({ _id: stateDocId });
        if (stateRow && stateRow.value) return stateRow.value;

        const row = await (await collection("monsterState")).findOne({ _id: zoneKey });
        if (!row && zoneKey === "normal") {
          // 向下相容：讀取舊 _id:"default" 的資料
          const legacy = await (await collection("monsterState")).findOne({ _id: "default" });
          return legacy?.value || { activeMonsterSeq: 1, currentHp: null, killCount: {} };
        }
        return row?.value || { activeMonsterSeq: 1, currentHp: null, killCount: {} };
      },
      async saveState(state, zoneKey = "normal") {
        const stateDocId = `monsterState:${zoneKey}`;
        // 同步寫入 monsters collection（作為合併模式）與 legacy monsterState collection（維持相容性）
        try {
          await (await collection("monsters")).updateOne(
            { _id: stateDocId },
            { $set: { value: state, updatedAt: new Date().toISOString() } },
            { upsert: true }
          );
        } catch (e) {
          // 忽略寫入 monsters collection 的錯誤，接著嘗試寫入 legacy collection
        }
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
        // 為了保留原有的原子操作語意，claim 仍在 legacy monsterState collection 上執行
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

  // 套用請求層級快取：同一請求內的重複讀取直接從記憶體回傳
  repos.playerRepository = withPlayerCache(repos.playerRepository);
  repos.walletRepository = withWalletCache(repos.walletRepository);
  repos.progressRepository = withProgressCache(repos.progressRepository);

  return repos;
}

module.exports = {
  createMongoRepositories
};
