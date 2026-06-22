const { randomUUID } = require("crypto");
const { getMongoDb } = require("./createMongoClient");
const { mergeEquippedFromLibrary } = require("../../shared/effectEngine");
const { createStreamAccountBindingRepository } = require("../streamBindings/createStreamAccountBindingRepository");
const { createCreatorTokenRepository } = require("../creatorTokens/createCreatorTokenRepository");
const { normalizeEnhanceGemStacks } = require("../../shared/inventoryStacking");
const { slimProgressForStorage } = require("../../shared/inventoryStorage");

function emitRealtimeInvalidate(type, discordId) {
  if (!discordId) return;
  try {
    // lazy require 避免循環依賴
    const { playerEventBus } = require("../../services/realtime/playerEventBus");
    if (type === "progress") {
      playerEventBus.invalidateProfile(discordId, "progress_changed");
      playerEventBus.invalidateInventory(discordId);
    } else if (type === "wallet") {
      playerEventBus.invalidateProfile(discordId, "wallet_changed");
    } else if (type === "binding") {
      playerEventBus.invalidateBindings(discordId);
      playerEventBus.invalidateProfile(discordId, "binding_changed");
    }
  } catch (_) {
    // event bus not available（例如測試環境）→ 安靜忽略
  }
}

function createMongoRepositories() {
  const collection = async (name) => (await getMongoDb()).collection(name);
  const normalizeLowLevelJobBadge = (progress) => {
    if (!progress || typeof progress !== "object") return progress;
    const level = Math.max(1, Number(progress.level) || 1);
    if (level >= 10) return progress;

    const equipment = progress.equipment;
    if (!equipment || typeof equipment !== "object") return progress;
    const jobEq = equipment.job_eq;
    if (!jobEq) return progress;

    const nextInventory = Array.isArray(progress.inventory) ? [...progress.inventory] : [];
    nextInventory.push(jobEq);

    return {
      ...progress,
      equipment: {
        ...equipment,
        job_eq: null
      },
      inventory: nextInventory
    };
  };

  const normalizeProgressItemEntry = (entry) => {
    if (!entry || typeof entry !== "object") return entry;
    const itemName = String(entry.itemName || entry.name || entry.itemId || entry.uuid || "未知道具");
    const itemId = entry.itemId || entry.id || null;
    return {
      ...entry,
      uuid: entry.uuid || randomUUID(),
      itemId,
      itemName,
      name: entry.name || itemName
    };
  };

  const normalizeProgressItemEntries = (progress) => {
    if (!progress || typeof progress !== "object") return progress;

    const nextInventory = Array.isArray(progress.inventory)
      ? progress.inventory.map((entry) => normalizeProgressItemEntry(entry))
      : progress.inventory;

    const equipment = progress.equipment && typeof progress.equipment === "object"
      ? Object.fromEntries(
        Object.entries(progress.equipment).map(([slot, entry]) => [slot, normalizeProgressItemEntry(entry)])
      )
      : progress.equipment;

    return {
      ...progress,
      inventory: nextInventory,
      equipment
    };
  };

  const normalizeProgressDocument = (progress) => normalizeProgressItemEntries(normalizeLowLevelJobBadge(progress));
  const normalizeProgressDocumentWithGemStacks = (progress) => {
    const normalized = normalizeProgressDocument(progress);
    if (!normalized || typeof normalized !== "object") return normalized;
    return {
      ...normalized,
      inventory: normalizeEnhanceGemStacks(normalized.inventory)
    };
  };

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
        // 格式容錯：OneComme 直播留言帶「tw-/yt-」前綴，網頁 OAuth 綁定存純 ID（無前綴），
        // 兩種格式必須互相比對得到，否則網頁綁定的人在直播打卡/抖內會配對不到（靜默失敗）。
        const raw = String(platformUserId || "").trim();
        if (!raw) return null;
        const bare = raw.replace(/^(tw-|twitch-|yt-|youtube-)/i, "");
        const idCandidates = [...new Set(
          [raw, bare, `tw-${bare}`, `twitch-${bare}`, `yt-${bare}`, `youtube-${bare}`].filter(Boolean)
        )];
        // 來源沒報平台（unknown）時，twitch / youtube 都試；同一 bare id 跨平台不可能撞號，無誤判風險。
        const platformCandidates = (platform && platform !== "unknown") ? [platform] : ["twitch", "youtube"];
        for (const p of platformCandidates) {
          for (const id of idCandidates) {
            const binding = await repos.streamAccountBindingRepository.findByPlatformAndUserId(p, id).catch(() => null);
            if (binding?.discordId) {
              const matched = await repos.playerRepository.findByDiscordId(binding.discordId);
              if (matched) return matched;
            }
          }
        }
        // 後備：舊資料把外部 ID 內嵌在玩家文件 externalIds.<platform>
        for (const p of platformCandidates) {
          const m = await (await collection("players")).findOne({ [`externalIds.${p}`]: { $in: idCandidates } });
          if (m) return m;
        }
        return null;
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
    streamAccountBindingRepository: createStreamAccountBindingRepository({ collection }),
    creatorTokenRepository: createCreatorTokenRepository({ collection }),
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
        emitRealtimeInvalidate("wallet", wallet.playerId);
        return wallet;
      },
      // 原子增減餘額：避免併發 read-modify-write 造成餘額覆寫遺失。
      // 扣款（amount<0）以 $gte 條件守住餘額，不足則回傳 null（不會扣成負數）。
      // 註：mongodb driver v6 的 findOneAndUpdate 直接回傳文件（或 null），不再包在 { value } 內。
      async incBalance(playerId, currencyType, amount) {
        const field = currencyType === "diamond" ? "diamond" : "gold";
        const col = await collection("wallets");
        const filter = amount < 0
          ? { playerId, [field]: { $gte: -amount } }
          : { playerId };
        const updated = await col.findOneAndUpdate(
          filter,
          { $inc: { [field]: amount }, $set: { updatedAt: new Date().toISOString() } },
          { returnDocument: "after" }
        );
        if (!updated) return null; // 找不到錢包或餘額不足
        emitRealtimeInvalidate("wallet", playerId);
        return updated;
      },
      async listAll() {
        return (await collection("wallets")).find({}).toArray();
      }
    },
    progressRepository: {
      async findByPlayerId(playerId) {
        const progress = await (await collection("progress")).findOne({ playerId });
        if (!progress) return progress;
        const normalized = normalizeProgressDocumentWithGemStacks(progress);
        if (normalized?.equipment) {
          // 永遠從 DB 讀取最新 effects，所有呼叫方自動拿到最新設計值
          normalized.equipment = await mergeEquippedFromLibrary(normalized.equipment, repos.itemRepository).catch(() => normalized.equipment);
        }
        return normalized;
      },
      async save(progress) {
        // 儲存前瘦身 inventory(去除可從道具庫還原的肥欄位),避免 progress 文件撐爆 16MB
        progress = slimProgressForStorage(normalizeProgressDocumentWithGemStacks(progress));
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
            emitRealtimeInvalidate("progress", progress.playerId);
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
        progress = slimProgressForStorage(normalizeProgressDocumentWithGemStacks(progress));
        const now = new Date().toISOString();
        const filter = prevUpdatedAt
          ? { playerId: progress.playerId, updatedAt: prevUpdatedAt }
          : { playerId: progress.playerId };
        const result = await (await collection("progress")).updateOne(
          filter,
          { $set: { ...progress, updatedAt: now } },
          { upsert: false }
        );
        if (result.matchedCount > 0) {
          emitRealtimeInvalidate("progress", progress.playerId);
        }
        return result.matchedCount > 0;
      },
      // 只更新 PK 相關欄位，避免覆蓋玩家的 inventory/equipped 等資料
      async updatePkStats(playerId, { pkRating, pkWins, pkLosses }) {
        const now = new Date().toISOString();
        await (await collection("progress")).updateOne(
          { playerId },
          { $set: { pkRating, pkWins, pkLosses, updatedAt: now } },
          { upsert: false }
        );
        emitRealtimeInvalidate("progress", playerId);
      },
      async listAll() {
        return (await collection("progress")).find({}).toArray();
      },
      async findTopByPkRating(limit = 10) {
        return (await collection("progress")).aggregate([
          { $match: { level: { $gte: 30 }, $or: [{ pkWins: { $gt: 0 } }, { pkLosses: { $gt: 0 } }] } },
          { $sort: { pkRating: -1 } },
          { $limit: limit },
          { $lookup: { from: "players", localField: "playerId", foreignField: "discordId", as: "_player" } },
          { $project: {
            playerId: 1,
            displayName: { $ifNull: [{ $arrayElemAt: ["$_player.displayName", 0] }, "$playerId"] },
            pkRating: 1, pkWins: 1, pkLosses: 1, level: 1,
            jobName: {
              $ifNull: [
                "$equipment.job_eq.itemName",
                { $ifNull: ["$equipment.job_eq.name", ""] }
              ]
            }
          }}
        ]).toArray();
      },
      async findTopByTowerRecord(limit = 10) {
        return (await collection("progress"))
          .find({ "towerRecord.bestFloor": { $exists: true, $gt: 0 } })
          .sort({
            "towerRecord.bestFloor": -1,
            "towerRecord.bestProgressDamagePct": -1,
            "towerRecord.bestProgressDamage": -1,
            "towerRecord.bestAt": 1
          })
          .limit(limit)
          .project({ playerId: 1, displayName: 1, towerRecord: 1 })
          .toArray();
      },
      async findRecentTowerRuns(limit = 5) {
        return (await collection("progress"))
          .aggregate([
            { $match: { "towerRecord.lastAt": { $exists: true } } },
            { $sort: { "towerRecord.lastAt": -1 } },
            {
              $group: {
                _id: { $ifNull: ["$towerRecord.lastRunId", "$playerId"] },
                doc: { $first: "$$ROOT" }
              }
            },
            { $replaceRoot: { newRoot: "$doc" } },
            { $sort: { "towerRecord.lastAt": -1 } },
            { $limit: limit },
            { $project: { playerId: 1, displayName: 1, towerRecord: 1 } }
          ])
          .toArray();
      }
    },
    transactionRepository: {
      async append(transaction) {
        await (await collection("transactions")).insertOne(transaction);
        return transaction;
      },
      async findBySourceAndRef(source, sourceRef) {
        if (!source || !sourceRef) return null;
        return (await collection("transactions")).findOne({ source, sourceRef });
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
      async findLastByPlatformUserId(platform, platformUserId) {
        if (!platform || !platformUserId) return null;
        const results = await (await collection("checkins"))
          .find({ platform, platformUserId })
          .sort({ occurredAt: -1 })
          .limit(1)
          .toArray();
        return results[0] || null;
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
    shopClaimRepository: {
      async findByDiscordOrIdentityAndItem({ discordId = null, identityKeys = [], itemId }) {
        const keys = Array.isArray(identityKeys) ? identityKeys.filter(Boolean) : [];
        const query = { itemId };
        if (discordId && keys.length) {
          query.$or = [
            { discordId },
            { identityKeys: { $in: keys } }
          ];
        } else if (discordId) {
          query.discordId = discordId;
        } else if (keys.length) {
          query.identityKeys = { $in: keys };
        } else {
          return null;
        }
        return (await collection("shopClaims")).findOne(query) || null;
      },
      async listByIdentityKeys(identityKeys) {
        const keys = Array.isArray(identityKeys) ? identityKeys.filter(Boolean) : [];
        if (!keys.length) return [];
        return (await collection("shopClaims"))
          .find({ identityKeys: { $in: keys } })
          .sort({ claimedAt: -1 })
          .toArray();
      },
      async listByPlayerId(playerId) {
        return (await collection("shopClaims"))
          .find({ playerId })
          .sort({ claimedAt: -1 })
          .toArray();
      },
      async listRecent(limit = 100) {
        return (await collection("shopClaims"))
          .find({})
          .sort({ claimedAt: -1 })
          .limit(limit)
          .toArray();
      },
      async saveClaim(claim) {
        await (await collection("shopClaims")).updateOne(
          { discordId: claim.discordId, itemId: claim.itemId },
          { $set: claim },
          { upsert: true }
        );
        return claim;
      }
    },
    itemRepository: {
      async findAll() {
        return (await collection("items")).find({}).toArray();
      },
      async findById(id) {
        return (await collection("items")).findOne({ id }) || null;
      },
      async findByMonsterCardOf(monsterCardOf) {
        if (!monsterCardOf) return [];
        return (await collection("items")).find({ monsterCardOf }).toArray();
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
      // bossKey 區分多隻世界王（default = 大史王；其餘如 dragon_king）
      async getConfig(bossKey = "default") {
        const row = await (await collection("worldBossConfig")).findOne({ _id: bossKey });
        return row?.value || null;
      },
      async saveConfig(config, bossKey = "default") {
        await (await collection("worldBossConfig")).updateOne(
          { _id: bossKey },
          { $set: { value: config, updatedAt: new Date().toISOString() } },
          { upsert: true }
        );
        return config;
      },
      async getState(bossKey = "default") {
        const row = await (await collection("worldBossState")).findOne({ _id: bossKey });
        return row?.value || null;
      },
      async saveState(state, bossKey = "default") {
        await (await collection("worldBossState")).updateOne(
          { _id: bossKey },
          { $set: { value: state, updatedAt: new Date().toISOString() } },
          { upsert: true }
        );
        return state;
      }
    },
    pkArenaRepository: {
      async getState() {
        const row = await (await collection("pkArenaState")).findOne({ _id: "default" });
        return row?.value || null;
      },
      async saveState(state) {
        await (await collection("pkArenaState")).updateOne(
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
    petRepository: {
      // 寵物「種類定義」collection（像 monsters 的設計表，非玩家實例）
      async findAll() {
        const pets = await (await collection("pets")).find({ id: { $exists: true } }).toArray();
        return pets.sort((a, b) => (a.seq || 0) - (b.seq || 0));
      },
      async findById(id) {
        return (await collection("pets")).findOne({ id }) || null;
      },
      async save(pet) {
        await (await collection("pets")).updateOne(
          { id: pet.id },
          { $set: pet },
          { upsert: true }
        );
        return pet;
      },
      async delete(id) {
        await (await collection("pets")).deleteOne({ id });
      },
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
          $and: [
            {
              $or: [
                { "value.activeTransition": { $exists: false } },
                { "value.activeTransition": null }
              ]
            },
            {
              $or: [
                { "value.activeEvent": { $exists: false } },
                { "value.activeEvent": null }
              ]
            }
          ],
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
    },
    towerSessionRepository: {
      async save(session) {
        await (await collection("towerSessions")).replaceOne(
          { threadId: session.threadId },
          session,
          { upsert: true }
        );
      },
      async findAll() {
        return (await collection("towerSessions")).find({}).toArray();
      },
      async delete(threadId) {
        await (await collection("towerSessions")).deleteOne({ threadId });
      }
    },
    inviteCodeRepository: {
      async findByInviterId(inviterId) {
        return (await collection("inviteCodes")).findOne({ inviterId }) || null;
      },
      async findByCode(code) {
        return (await collection("inviteCodes")).findOne({ code }) || null;
      },
      async findAllUsedBy(playerId) {
        return (await collection("inviteCodes")).findOne({ "uses.usedBy": playerId }) || null;
      },
      async save(doc) {
        await (await collection("inviteCodes")).replaceOne(
          { inviterId: doc.inviterId },
          doc,
          { upsert: true }
        );
      }
    },
    casinoRepository: {
      async getState() {
        const row = await (await collection("casinoState")).findOne({ _id: "default" });
        return row || null;
      },
      async saveState(state) {
        const { _id, ...rest } = state;
        await (await collection("casinoState")).updateOne(
          { _id: "default" },
          { $set: { ...rest, updatedAt: new Date().toISOString() } },
          { upsert: true }
        );
      },
      async transitionStatus(roundId, fromStatus, toStatus) {
        const result = await (await collection("casinoState")).updateOne(
          { _id: "default", "currentRound.roundId": roundId, "currentRound.status": fromStatus },
          { $set: { "currentRound.status": toStatus, updatedAt: new Date().toISOString() } }
        );
        return result.matchedCount > 0;
      },
      async incrementRoundTotals(roundId, color, amount) {
        await (await collection("casinoState")).updateOne(
          { _id: "default", "currentRound.roundId": roundId },
          {
            $inc: {
              [`currentRound.totals.${color}`]: amount,
              "currentRound.betCount": 1,
            },
            $set: { updatedAt: new Date().toISOString() }
          }
        );
      },
      async appendBet(bet) {
        const doc = { ...bet, _id: undefined, createdAt: new Date(bet.placedAt || Date.now()).toISOString() };
        delete doc._id;
        const result = await (await collection("casinoBets")).insertOne(doc);
        return result.insertedId;
      },
      async updateBetOutcome(betId, { outcome, payout, dropKey }) {
        if (!betId) return;
        await (await collection("casinoBets")).updateOne(
          { _id: betId },
          { $set: { outcome, payout, dropKey, settledAt: new Date().toISOString() } }
        );
      },
      async listBetsByRound(roundId) {
        return (await collection("casinoBets")).find({ roundId }).toArray();
      },
      async listBetsByRoundAndPlayer(roundId, discordId) {
        return (await collection("casinoBets")).find({ roundId, discordId }).toArray();
      },
      async appendRound(round) {
        await (await collection("casinoRounds")).updateOne(
          { roundId: round.roundId },
          // expireAt：賭場局紀錄保留 30 天後由 TTL 索引自動刪除，防無限膨脹(每天約 700 筆)。
          { $set: { ...round, createdAt: new Date().toISOString(), expireAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) } },
          { upsert: true }
        );
      },
      async listRecentRounds(limit = 10) {
        return (await collection("casinoRounds")).find({}).sort({ roundId: -1 }).limit(limit).toArray();
      },
      async pushRecentResult(result) {
        await (await collection("casinoState")).updateOne(
          { _id: "default" },
          {
            $push: { recentResults: { $each: [result], $slice: -10 } },
            $set: { updatedAt: new Date().toISOString() }
          },
          { upsert: true }
        );
      },
      async getPlayerStats(discordId, since = null) {
        const match = { discordId };
        if (since) match.createdAt = { $gte: since };
        const agg = await (await collection("casinoBets")).aggregate([
          { $match: match },
          { $group: {
            _id: null,
            totalBet: { $sum: "$amount" },
            totalPay: { $sum: { $ifNull: ["$payout", 0] } },
            wins: { $sum: { $cond: [{ $eq: ["$outcome", "win"] }, 1, 0] } },
            count: { $sum: 1 }
          } }
        ]).toArray();
        return agg[0] || { totalBet: 0, totalPay: 0, wins: 0, count: 0 };
      },
      async getDailyStats(date = new Date()) {
        const start = new Date(date); start.setHours(0, 0, 0, 0);
        const end = new Date(start); end.setDate(end.getDate() + 1);
        const agg = await (await collection("casinoRounds")).aggregate([
          { $match: { createdAt: { $gte: start.toISOString(), $lt: end.toISOString() } } },
          { $group: {
            _id: null,
            totalBet: { $sum: "$totalBet" },
            totalPayout: { $sum: "$totalPayout" },
            houseProfit: { $sum: "$houseProfit" },
            rounds: { $sum: 1 }
          } }
        ]).toArray();
        return agg[0] || { totalBet: 0, totalPayout: 0, houseProfit: 0, rounds: 0 };
      }
    }
  };

  return repos;
}

module.exports = {
  createMongoRepositories
};
