const { randomUUID } = require("crypto");
const { getMongoDb } = require("./createMongoClient");
const { mergeEquippedFromLibrary } = require("../../shared/effectEngine");
const { createStreamAccountBindingRepository } = require("../streamBindings/createStreamAccountBindingRepository");
const { createCreatorTokenRepository } = require("../creatorTokens/createCreatorTokenRepository");
const { normalizeEnhanceGemStacks } = require("../../shared/inventoryStacking");
const { slimProgressForStorage, slimInventoryEntry, slimInventoryArray } = require("../../shared/inventoryStorage");
const seasonState = require("../../services/access/seasonStateStore");
const maintenance = require("../../services/access/maintenanceStore");
const { saveActiveMonsterState } = require("./saveActiveMonsterState");

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
  seasonState.ensureLoaded().catch(() => {});
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

  /**
   * 背包基準戳記：讀取當下把「背包簽章 + uuid 集合」掛成不可列舉屬性。
   * save() 靠它分辨兩件事：
   *   1. 這次呼叫到底有沒有動背包 → 沒動就完全不寫 inventory 欄位
   *   2. 就算有動，哪些 entry 是「讀取之後才被別的流程原子塞進來的」→ 合併保留
   * 這是「獎勵憑空消失」的源頭修法——不再依賴每個呼叫點自律。
   */
  const INV_BASELINE_KEY = "__invBaseline";
  const stampInventoryBaseline = (doc) => {
    if (!doc || typeof doc !== "object") return doc;
    try {
      const slim = slimInventoryArray(Array.isArray(doc.inventory) ? doc.inventory : []);
      const uuids = [];
      const scByUuid = {}; // uuid → 讀取當下的堆疊數（消耗品競態合併用）
      for (const e of slim) {
        if (!e || !e.uuid) continue;
        const u = String(e.uuid);
        uuids.push(u);
        scByUuid[u] = Math.max(1, Number(e.stackCount) || 1);
      }
      Object.defineProperty(doc, INV_BASELINE_KEY, {
        value: { sig: JSON.stringify(slim), uuids, scByUuid, seasonKey: String(doc.seasonKey || "legacy") },
        enumerable: false,
        writable: true,
        configurable: true
      });
    } catch (_) {
      // 戳記失敗 → save() 自動退回舊的整份覆寫路徑，行為不變
    }
    return doc;
  };

  /**
   * 背包差異合併：呼叫方的版本為準（刪除/改裝生效），但把「讀取之後」
   * 別的流程原子塞進來的東西補回來：
   *   - DB 有、基準沒有的 uuid → 讀取後新增的 entry（新掉落/寶箱）→ 保留
   *   - 同 uuid 的堆疊數比基準多 → 讀取後被 $inc 疊加（同款消耗品）→ 差額加回
   *   - 呼叫方刪光了某 entry 但期間又被疊了 N 個 → 以差額重建 entry
   */
  const mergeInventories = (outInv, dbInv, baseline) => {
    const db = Array.isArray(dbInv) ? dbInv : [];
    const base = baseline && baseline.scByUuid ? baseline.scByUuid : {};
    const known = new Set(baseline && baseline.uuids ? baseline.uuids : []);
    const outUuids = new Set();
    for (const e of outInv) if (e && e.uuid) outUuids.add(String(e.uuid));

    const dbByUuid = new Map();
    for (const d of db) if (d && d.uuid) dbByUuid.set(String(d.uuid), d);

    const merged = outInv.map((o) => {
      if (!o || !o.uuid) return o;
      const u = String(o.uuid);
      const d = dbByUuid.get(u);
      // 基準裡沒有 → 呼叫方自己新增的 entry，以呼叫方為準
      if (!d || !(u in base)) return o;
      const dSc = Math.max(1, Number(d.stackCount) || 1);
      const delta = dSc - base[u];
      if (delta > 0) {
        // 讀取後被別的流程疊加了 delta 個 → 加回呼叫方的版本上
        return { ...o, stackCount: Math.max(1, Number(o.stackCount) || 1) + delta };
      }
      return o;
    });

    for (const d of db) {
      if (!d || !d.uuid) continue; // 無 uuid 的舊資料視為已由呼叫方版本涵蓋
      const u = String(d.uuid);
      if (outUuids.has(u)) continue;
      if (!known.has(u)) {
        // 讀取後才出現的新 entry（原子發放）→ 保留
        merged.push(d);
        continue;
      }
      // 呼叫方刪掉的 entry；但若期間又被疊加過，差額不能跟著陪葬
      const dSc = Math.max(1, Number(d.stackCount) || 1);
      if (u in base && dSc > base[u]) {
        merged.push({ ...d, stackCount: dSc - base[u] });
      }
    }
    return merged;
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
        if (maintenance.isStrict()) throw new Error("SEASON_RESET_WRITE_LOCKED");
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
        // 鑽石是跨季資產，外部斗內仍可入帳；金幣屬賽季資產，嚴格維護時拒寫。
        if (field === "gold" && maintenance.isStrict()) return null;
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
      // 原子購買背包格：條件扣 diamondCost 顆鑽（$gte 守餘額）並加 slotsAdd 格永久背包格。
      // 鑽石不足 → 回傳 null（不會扣成負數，也不會加格）。
      async purchaseBackpackSlots(playerId, diamondCost, slotsAdd) {
        if (maintenance.isStrict()) return null;
        const col = await collection("wallets");
        const updated = await col.findOneAndUpdate(
          { playerId, diamond: { $gte: diamondCost } },
          { $inc: { diamond: -diamondCost, bonusBackpackSlots: slotsAdd }, $set: { updatedAt: new Date().toISOString() } },
          { returnDocument: "after" }
        );
        if (!updated) return null; // 鑽石不足
        emitRealtimeInvalidate("wallet", playerId);
        return updated;
      },
      // 純發放「賽季背包格」（不扣鑽，供消耗品/圖鑑獎勵用；換季會清零，與花鑽的永久格分開）
      async grantBackpackSlots(playerId, slotsAdd) {
        if (maintenance.isStrict()) return null;
        const col = await collection("wallets");
        const updated = await col.findOneAndUpdate(
          { playerId },
          { $inc: { seasonBackpackSlots: Math.max(0, Number(slotsAdd) || 0) }, $set: { updatedAt: new Date().toISOString() } },
          { returnDocument: "after" }
        );
        if (updated) emitRealtimeInvalidate("wallet", playerId);
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
        if (!progress.seasonKey) progress.seasonKey = seasonState.LEGACY_KEY;
        const normalized = normalizeProgressDocumentWithGemStacks(progress);
        if (normalized?.equipment) {
          // 永遠從 DB 讀取最新 effects，所有呼叫方自動拿到最新設計值
          normalized.equipment = await mergeEquippedFromLibrary(normalized.equipment, repos.itemRepository).catch(() => normalized.equipment);
        }
        return stampInventoryBaseline(normalized);
      },
      /**
       * 原子分配自主屬性點，只讀寫六維、可用點數與自主配點紀錄。
       * 避免為了加 1 點而載入、合併裝備並回寫整份大型 progress 文件。
       */
      async allocateAttributePoints(playerId, attribute, amount, options = {}) {
        if (maintenance.isStrict()) {
          const error = new Error("SEASON_RESET_WRITE_LOCKED");
          error.code = "SEASON_RESET_WRITE_LOCKED";
          throw error;
        }

        const key = String(attribute || "");
        const points = Number(amount);
        if (!/^[a-z]+$/.test(key) || !Number.isInteger(points) || points <= 0) {
          return { ok: false, reason: "invalid_argument" };
        }

        const expectedSeasonKey = String(options.expectedSeasonKey || seasonState.getActiveKey());
        const baseFilter = seasonState.progressFilter(playerId, expectedSeasonKey);
        const coll = await collection("progress");
        const now = new Date().toISOString();
        const updated = await coll.findOneAndUpdate(
          { ...baseFilter, statusPoints: { $gte: points } },
          [{
            $set: {
              statusPoints: { $subtract: [{ $ifNull: ["$statusPoints", 0] }, points] },
              [`attributes.${key}`]: { $add: [{ $ifNull: [`$attributes.${key}`, 1] }, points] },
              [`allocatedAttrs.${key}`]: { $add: [{ $ifNull: [`$allocatedAttrs.${key}`, 0] }, points] },
              updatedAt: now,
            },
          }],
          {
            returnDocument: "after",
            projection: {
              _id: 0,
              playerId: 1,
              seasonKey: 1,
              attributes: 1,
              allocatedAttrs: 1,
              statusPoints: 1,
              updatedAt: 1,
            },
          },
        );

        if (updated) {
          emitRealtimeInvalidate("progress", String(playerId));
          return { ok: true, progress: updated };
        }

        // 原子條件未命中時只做小欄位查詢，用來區分角色不存在與點數不足。
        const state = await coll.findOne(baseFilter, { projection: { _id: 1, statusPoints: 1 } });
        if (!state) return { ok: false, reason: "not_found" };
        return { ok: false, reason: "insufficient", statusPoints: Number(state.statusPoints) || 0 };
      },
      async save(progress) {
        if (maintenance.isStrict()) {
          const error = new Error("SEASON_RESET_WRITE_LOCKED");
          error.code = "SEASON_RESET_WRITE_LOCKED";
          throw error;
        }
        // 🔬 臨時偵錯（jobExp 被洗掉事故，用完即拆）：抓「寫入的裝備徽章沒帶 jobExp」的呼叫堆疊
        try {
          if (String(progress?.playerId) === "1043389715577049138") {
            const _je = progress?.equipment?.job_eq;
            console.log("[jobExpProbe] save playerId=…9138 jobExp=" + (_je ? (_je.jobExp ?? "∅") : "無徽章")
              + " stack=" + new Error().stack.split("\n").slice(2, 6).map(l => l.trim()).join(" ← "));
          }
        } catch (_) {}
        // 讀取當下的背包基準（findByPlayerId 蓋的戳記）；沒有就走舊路徑
        const baseline = progress ? progress[INV_BASELINE_KEY] : null;
        // 儲存前瘦身 inventory(去除可從道具庫還原的肥欄位),避免 progress 文件撐爆 16MB
        progress = slimProgressForStorage(normalizeProgressDocumentWithGemStacks(progress));
        const expectedSeasonKey = String(progress.seasonKey || baseline?.seasonKey || seasonState.getActiveKey());
        progress.seasonKey = expectedSeasonKey;
        const guarded = (extra = {}) => ({ ...seasonState.progressFilter(progress.playerId, expectedSeasonKey), ...extra });
        const outInv = Array.isArray(progress.inventory) ? progress.inventory : [];
        // 呼叫方這次到底有沒有動背包？（簽章比對讀取當下 vs 現在）
        const invUntouched = Boolean(baseline && typeof baseline.sig === "string"
          && baseline.sig === JSON.stringify(outInv));
        let lastError = null;
        const maxRetries = 5;  // 增加重試次數

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            const coll = await collection("progress");
            const now = new Date().toISOString();
            let result;

            if (baseline && invUntouched) {
              // ① 背包沒動 → 完全不寫 inventory 欄位。
              //    期間被原子塞進來的獎勵（世界王寶箱/掉落/拍賣到貨…）原封不動。
              const { inventory: _omit, ...rest } = progress;
              result = await coll.updateOne(
                guarded(),
                { $set: { ...rest, updatedAt: now } },
                { upsert: false }
              );
            } else if (baseline) {
              // ② 背包有動 → 讀最新背包做差異合併，CAS 寫回（updatedAt 沒被
              //    別人改過才成功）；失敗就重讀重合併，確保競態發放不被吃掉。
              const { inventory: _omit, ...rest } = progress;
              let casOk = false;
              let casMatched = false;
              for (let casTry = 0; casTry < 5; casTry++) {
                const cur = await coll.findOne(
                  guarded(),
                  { projection: { inventory: 1, updatedAt: 1, seasonKey: 1 } }
                );
                if (!cur) break; // 文件不見了 → 交給下方 fallback
                casMatched = true;
                const merged = mergeInventories(outInv, cur.inventory, baseline);
                const cas = await coll.updateOne(
                  guarded({ updatedAt: cur.updatedAt }),
                  { $set: { ...rest, inventory: merged, updatedAt: now } },
                  { upsert: false }
                );
                if (cas.matchedCount > 0) { casOk = true; break; }
              }
              if (casMatched && !casOk) {
                // CAS 連續失敗（極高併發）→ 最後一次用剛讀到的最新狀態直接寫，
                // 仍然是合併後的結果，不是呼叫方的整份舊資料
                const cur = await coll.findOne(
                  guarded(),
                  { projection: { inventory: 1 } }
                );
                const merged = mergeInventories(outInv, cur ? cur.inventory : [], baseline);
                const forced = await coll.updateOne(
                  guarded(),
                  { $set: { ...rest, inventory: merged, updatedAt: now } },
                  { upsert: false }
                );
                casOk = forced.matchedCount > 0;
                console.warn(`[ProgressRepository] Inventory merge CAS exhausted for ${progress.playerId}, forced write`);
              }
              result = { matchedCount: casOk ? 1 : 0, upsertedCount: 0 };
            } else {
              // ③ 沒有基準（新建文件、或經過序列化丟失戳記）→ 舊行為：整份覆寫
              result = await coll.updateOne(
                guarded(),
                { $set: { ...progress, updatedAt: now } },
                { upsert: true }
              );
            }

            // 有基準卻寫不到，通常代表換季已切換；禁止用 upsert 復活舊存檔。
            if (baseline && result.matchedCount === 0) {
              const error = new Error(`STALE_SEASON_WRITE:${progress.playerId}:${expectedSeasonKey}`);
              error.code = "STALE_SEASON_WRITE";
              throw error;
            }

            if (result.matchedCount === 0 && result.upsertedCount === 0) {
              console.warn(`[ProgressRepository] Save had no effect for ${progress.playerId}`);
            }
            // 成功保存時記錄
            if (attempt > 1) {
              console.info(`[ProgressRepository] Save succeeded for ${progress.playerId} on attempt ${attempt}`);
            }
            emitRealtimeInvalidate("progress", progress.playerId);
            // 回傳物件蓋上新的基準：之後若再拿同一份來 save，比對基準是「這次存進去的版本」
            return stampInventoryBaseline(progress);
          } catch (err) {
            lastError = err;
            const isLastAttempt = attempt === maxRetries;
            console.error(`[ProgressRepository] Save failed for ${progress.playerId} (attempt ${attempt}/${maxRetries}):`, err.message);

            if (err?.code === "STALE_SEASON_WRITE") throw err;
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
      /**
       * 只更新指定欄位（不碰 inventory / equipment 等）。
       *
       * 為什麼需要這個：save() 是 `$set: {...整份 progress}`，會把讀取當下的
       * inventory 整個寫回去。若在「讀取 → 運算 → 寫回」這段期間有別的流程
       * 原子塞了東西進背包（世界王寶箱、掉落、拍賣到貨…），那次整份覆寫就會
       * 把它抹掉——這是獎勵憑空消失的主因。
       * 只改單一小欄位時一律用這個，不要用 save()。
       */
      async updateFields(playerId, fields, options = {}) {
        if (maintenance.isStrict()) return false;
        if (!playerId || !fields || typeof fields !== "object") return false;
        const expectedSeasonKey = String(options.expectedSeasonKey || seasonState.getActiveKey());
        const result = await (await collection("progress")).updateOne(
          seasonState.progressFilter(playerId, expectedSeasonKey),
          { $set: { ...fields, updatedAt: new Date().toISOString() } },
          { upsert: false }
        );
        if (result.matchedCount > 0) emitRealtimeInvalidate("progress", String(playerId));
        return result.matchedCount > 0;
      },
      async incrementFields(playerId, increments, options = {}) {
        if (maintenance.isStrict()) return false;
        if (!playerId || !increments || typeof increments !== "object") return false;
        const expectedSeasonKey = String(options.expectedSeasonKey || seasonState.getActiveKey());
        const result = await (await collection("progress")).updateOne(
          seasonState.progressFilter(playerId, expectedSeasonKey),
          { $inc: increments, $set: { updatedAt: new Date().toISOString() } },
          { upsert: false }
        );
        if (result.matchedCount > 0) emitRealtimeInvalidate("progress", String(playerId));
        return result.matchedCount > 0;
      },
      // CAS 寫入：只有 updatedAt 未被別人改過才成功，回傳是否成功
      async saveIfUnchanged(progress, prevUpdatedAt) {
        if (maintenance.isStrict()) {
          const error = new Error("SEASON_RESET_WRITE_LOCKED");
          error.code = "SEASON_RESET_WRITE_LOCKED";
          throw error;
        }
        // 🔬 臨時偵錯（jobExp 被洗掉，用完即拆）
        try {
          if (String(progress?.playerId) === "1043389715577049138") {
            const _je = progress?.equipment?.job_eq;
            console.log("[jobExpProbe] saveIfUnchanged jobExp=" + (_je ? (_je.jobExp ?? "∅") : "無徽章")
              + " stack=" + new Error().stack.split("\n").slice(2, 6).map(l => l.trim()).join(" ← "));
          }
        } catch (_) {}
        progress = slimProgressForStorage(normalizeProgressDocumentWithGemStacks(progress));
        const expectedSeasonKey = String(progress.seasonKey || seasonState.getActiveKey());
        progress.seasonKey = expectedSeasonKey;
        const now = new Date().toISOString();
        const filter = prevUpdatedAt
          ? { ...seasonState.progressFilter(progress.playerId, expectedSeasonKey), updatedAt: prevUpdatedAt }
          : seasonState.progressFilter(progress.playerId, expectedSeasonKey);
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
        if (maintenance.isStrict()) return false;
        const now = new Date().toISOString();
        await (await collection("progress")).updateOne(
          seasonState.progressFilter(playerId),
          { $set: { pkRating, pkWins, pkLosses, updatedAt: now } },
          { upsert: false }
        );
        emitRealtimeInvalidate("progress", playerId);
      },
      // 原子化「加一個道具進背包」：同款 itemId 疊加 stackCount，否則 $push 新項目。
      // 不走 read-modify-write 整包背包，避免與玩家自身高頻存檔(刷怪/結算)競態，
      // 杜絕 CAS 失敗造成的「靜默吞箱」。回傳 { ok, uuid, stacked }。
      async addOrStackInventoryItem(playerId, itemId, newEntry) {
        if (maintenance.isStrict()) return { ok: false, uuid: null, stacked: false, reason: "season_reset_locked" };
        const coll = await collection("progress");
        const baseFilter = seasonState.progressFilter(playerId);
        const slimEntry = slimInventoryEntry(newEntry);

        // 只有「真正可堆疊」的道具(消耗品/寵物蛋，含寶石與寶箱)才併進既有 entry。
        // 裝備與怪物卡每一件都有自己的附魔／強化值，一旦被 $inc 併成 stackCount 會出三個問題：
        //   ① 新那件的附魔/強化被整個丟掉（只留最早那件的數值）
        //   ② 前端 groupStacks 只算 entry 數 → 玩家覺得「打到卻沒進背包」
        //   ③ _uuids 只有一個 → 分解/賣出一次就刪掉整疊（回報:分解一件消失兩件）
        // 2026-07 玩家(漢格/宇田川冰/Eric Huang)回報的根因，見 CHANGELOG #177。
        const _type = String(newEntry?.itemType || "");
        const _slot = String(newEntry?.equipSlot || "");
        const _isCard = Boolean(newEntry?.monsterCardSkill || newEntry?.monsterCardOf)
          || _type === "monster_card" || _slot.startsWith("special");
        const _stackable = !_isCard && (_type === "consumable" || _type === "pet_egg");

        if (!_stackable) {
          // 裝備/卡片：一律新增獨立 entry（保住各自的附魔與 uuid）
          const push = await coll.updateOne(
            baseFilter,
            { $push: { inventory: slimEntry }, $set: { updatedAt: new Date().toISOString() } },
            { upsert: false }
          );
          if (push.matchedCount > 0) {
            emitRealtimeInvalidate("progress", playerId);
            return { ok: true, uuid: newEntry.uuid, stacked: false };
          }
          return { ok: false, uuid: null, stacked: false };
        }

        for (let attempt = 0; attempt < 4; attempt++) {
          const now = new Date().toISOString();
          // 1) 已有同款 → 原子 +1。positional projection 不能搭 after，取 before 即可
          //    （堆疊不改 uuid，before 的 uuid 與 after 相同）
          const inc = await coll.findOneAndUpdate(
            { ...baseFilter, "inventory.itemId": itemId },
            { $inc: { "inventory.$.stackCount": 1 }, $set: { updatedAt: now } },
            { projection: { "inventory.$": 1 }, returnDocument: "before" }
          );
          const incDoc = inc && (inc.value !== undefined ? inc.value : inc);
          if (incDoc && Array.isArray(incDoc.inventory) && incDoc.inventory[0]) {
            emitRealtimeInvalidate("progress", playerId);
            return { ok: true, uuid: incDoc.inventory[0].uuid || newEntry.uuid, stacked: true };
          }
          // 2) 沒有同款 → 原子 $push（$ne 防併發重複插入；玩家不存在則 matched 0）
          //    必須顯式帶 stackCount，否則下次 $inc 在「沒有這個欄位」的 entry 上只會得到 1（0+1）
          //    → 第二個消耗品(例如世界王寶箱)會被吃掉。
          const push = await coll.updateOne(
            { ...baseFilter, "inventory.itemId": { $ne: itemId } },
            {
              $push: { inventory: { ...slimEntry, stackCount: Math.max(1, Number(newEntry?.stackCount) || 1) } },
              $set: { updatedAt: now }
            },
            { upsert: false }
          );
          if (push.matchedCount > 0) {
            emitRealtimeInvalidate("progress", playerId);
            return { ok: true, uuid: newEntry.uuid, stacked: false };
          }
          // matched 0：玩家不存在 → 直接失敗；否則是併發剛插入同款 → 下一輪回到疊加分支
          const exists = await coll.countDocuments(baseFilter, { limit: 1 });
          if (!exists) return { ok: false, uuid: null, stacked: false };
        }
        return { ok: false, uuid: null, stacked: false };
      },
      async listAll() {
        return (await collection("progress")).find({}).toArray();
      },
      async findTopByPkRating(limit = 10) {
        return (await collection("progress")).aggregate([
          { $match: {
            level: { $gte: 30 },
            excludeFromLeaderboards: { $ne: true },
            isTestAccount: { $ne: true },
            $or: [{ pkWins: { $gt: 0 } }, { pkLosses: { $gt: 0 } }]
          } },
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
          .find({
            "towerRecord.bestFloor": { $exists: true, $gt: 0 },
            excludeFromLeaderboards: { $ne: true },
            isTestAccount: { $ne: true }
          })
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
      // 近期簽到（新→舊，限筆數）：連續簽到天數計算用（時間管理大師等 checkin_streak 任務）
      async listRecentByDiscordId(discordId, limit = 60) {
        return (await collection("checkins"))
          .find({ discordId })
          .sort({ occurredAt: -1 })
          .limit(Number(limit) || 60)
          .toArray();
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
    // 周邊（實體商品）品項：與虛擬商店分離，含雙價(現金/鑽石)、實體庫存
    merchItemRepository: {
      async findAll() {
        return (await collection("merchItems")).find({}).sort({ sortOrder: 1, createdAt: 1 }).toArray();
      },
      async findById(id) {
        return (await collection("merchItems")).findOne({ id }) || null;
      },
      async save(item) {
        await (await collection("merchItems")).updateOne({ id: item.id }, { $set: item }, { upsert: true });
        return item;
      },
      async delete(id) {
        await (await collection("merchItems")).deleteOne({ id });
      }
    },
    // 周邊訂單：收件資訊(PII) + 付款/出貨狀態
    merchOrderRepository: {
      async findByOrderNo(orderNo) {
        return (await collection("merchOrders")).findOne({ orderNo }) || null;
      },
      async findByMerchantTradeNo(merchantTradeNo) {
        return (await collection("merchOrders")).findOne({ "ecpay.merchantTradeNo": merchantTradeNo }) || null;
      },
      async save(order) {
        await (await collection("merchOrders")).updateOne({ orderNo: order.orderNo }, { $set: order }, { upsert: true });
        return order;
      },
      async listByDiscordId(discordId, limit = 50) {
        return (await collection("merchOrders")).find({ discordId }).sort({ createdAt: -1 }).limit(limit).toArray();
      },
      async listAll({ status = null, limit = 500 } = {}) {
        const q = status ? { status } : {};
        return (await collection("merchOrders")).find(q).sort({ createdAt: -1 }).limit(limit).toArray();
      }
    },
    craftingRepository: require("./crafting/createCraftingRepository").createCraftingRepository({ emitRealtimeInvalidate }),
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
        if (maintenance.isStrict()) throw Object.assign(new Error("SEASON_RESET_WRITE_LOCKED"), { code: "SEASON_RESET_WRITE_LOCKED" });
        await (await collection("worldBossState")).updateOne(
          { _id: bossKey },
          { $set: { value: state, updatedAt: new Date().toISOString() } },
          { upsert: true }
        );
        return state;
      }
    },
    worldBossEventRepository: {
      async get(bossKey) {
        const row = await (await collection("worldBossEventState")).findOne({ _id: String(bossKey) });
        return row?.value || null;
      },
      async save(state, bossKey) {
        if (maintenance.isStrict()) throw Object.assign(new Error("SEASON_RESET_WRITE_LOCKED"), { code: "SEASON_RESET_WRITE_LOCKED" });
        await (await collection("worldBossEventState")).updateOne(
          { _id: String(bossKey) },
          { $set: { value: state, updatedAt: new Date().toISOString() } },
          { upsert: true }
        );
        return state;
      },
      async submitAnswer({ bossKey, quizId, discordId, answer, now = Date.now() }) {
        if (maintenance.isStrict()) throw Object.assign(new Error("SEASON_RESET_WRITE_LOCKED"), { code: "SEASON_RESET_WRITE_LOCKED" });
        const field = `value.quiz.answers.${String(discordId)}`;
        const result = await (await collection("worldBossEventState")).updateOne(
          {
            _id: String(bossKey),
            "value.quiz.id": String(quizId),
            "value.quiz.status": "active",
            "value.quiz.endsAt": { $gt: Number(now) },
          },
          { $set: { [field]: answer, updatedAt: new Date().toISOString() } }
        );
        if (!result.matchedCount) {
          throw Object.assign(new Error("答題已結束。"), { code: "HUTAO_QUIZ_CLOSED" });
        }
        return true;
      },
    },
    pkArenaRepository: {
      async getState() {
        const row = await (await collection("pkArenaState")).findOne({ _id: "default" });
        return row?.value || null;
      },
      async saveState(state) {
        if (maintenance.isStrict()) throw Object.assign(new Error("SEASON_RESET_WRITE_LOCKED"), { code: "SEASON_RESET_WRITE_LOCKED" });
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
        if (maintenance.isStrict()) {
          const error = new Error("SEASON_RESET_WRITE_LOCKED");
          error.code = "SEASON_RESET_WRITE_LOCKED";
          throw error;
        }
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
      async saveStateIfActiveMonster(state, zoneKey = "normal", expectedMonsterSeq, expectedCurrentHp = null) {
        if (maintenance.isStrict()) return false;
        return saveActiveMonsterState({ collection, state, zoneKey, expectedMonsterSeq, expectedCurrentHp });
      },
      // 原子收付擊殺權：成功回 true，已被其他進程收付回 false
      // 若先前的 claim 超過 timeoutMs，允許重新 claim（回收無回應的鎖）
      async claimKill(zoneKey, monsterSeq, timeoutMs = 30 * 1000) {
        if (maintenance.isStrict()) return false;
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
        if (maintenance.isStrict()) throw Object.assign(new Error("SEASON_RESET_WRITE_LOCKED"), { code: "SEASON_RESET_WRITE_LOCKED" });
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
    },
    // 主線故事：章節（storyChapters）+ NPC（storyNpcs）
    storyRepository: {
      async listChapters() {
        return (await collection("storyChapters")).find({}).toArray();
      },
      async findChapterById(id) {
        return (await collection("storyChapters")).findOne({ id }) || null;
      },
      async saveChapter(doc) {
        const { _id, ...rest } = doc;
        await (await collection("storyChapters")).updateOne({ id: doc.id }, { $set: rest }, { upsert: true });
        return doc;
      },
      async deleteChapter(id) {
        await (await collection("storyChapters")).deleteOne({ id });
      },
      async listNpcs() {
        return (await collection("storyNpcs")).find({}).toArray();
      },
      async findNpcById(id) {
        return (await collection("storyNpcs")).findOne({ id }) || null;
      },
      async saveNpc(doc) {
        const { _id, ...rest } = doc;
        await (await collection("storyNpcs")).updateOne({ id: doc.id }, { $set: rest }, { upsert: true });
        return doc;
      },
      async deleteNpc(id) {
        await (await collection("storyNpcs")).deleteOne({ id });
      }
    }
  };

  return repos;
}

module.exports = {
  createMongoRepositories
};
