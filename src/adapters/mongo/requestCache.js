/**
 * 請求層級記憶體快取
 *
 * 在同一個非同步調用鏈（tick）內，對同一個 playerId 的重複讀取
 * 直接從記憶體回傳，跳過 MongoDB round-trip。
 * 寫入時同步更新快取，確保同一請求內後續讀取拿到最新值。
 *
 * 使用 AsyncLocalStorage 隔離每個請求的快取範圍，
 * 不同玩家、不同請求之間完全獨立，不會互相污染。
 */

const { AsyncLocalStorage } = require("async_hooks");

const storage = new AsyncLocalStorage();

/**
 * 在一個有快取的 context 中執行 fn。
 * Bot 指令、API 路由的 handler 都應該包在這裡面。
 * 若沒有 context（未包裝），快取自動 bypass，行為與原本相同。
 */
function runWithCache(fn) {
  return storage.run(new Map(), fn);
}

/**
 * 包裝 progressRepository，加上請求層級快取。
 */
function withProgressCache(repo) {
  return {
    async findByPlayerId(playerId) {
      const store = storage.getStore();
      if (!store) return repo.findByPlayerId(playerId);

      const key = `progress:${playerId}`;
      if (store.has(key)) return store.get(key);

      const result = await repo.findByPlayerId(playerId);
      store.set(key, result);
      return result;
    },
    async save(progress) {
      const result = await repo.save(progress);
      // 寫入後同步更新快取，後續讀取拿到最新值
      const store = storage.getStore();
      if (store) store.set(`progress:${progress.playerId}`, result);
      return result;
    },
    async saveIfUnchanged(progress, prevUpdatedAt) {
      const saved = await repo.saveIfUnchanged(progress, prevUpdatedAt);
      // 不論成功失敗都清快取：成功時下次讀拿到新值；失敗時下次重試讀到 DB 的最新狀態
      // 否則重試會一直讀到同個 stale 物件，CAS 永遠失敗
      const store = storage.getStore();
      if (store) store.delete(`progress:${progress.playerId}`);
      return saved;
    },
    async listAll() {
      return repo.listAll();
    }
  };
}

/**
 * 包裝 walletRepository，加上請求層級快取。
 */
function withWalletCache(repo) {
  return {
    async findByPlayerId(playerId) {
      const store = storage.getStore();
      if (!store) return repo.findByPlayerId(playerId);

      const key = `wallet:${playerId}`;
      if (store.has(key)) return store.get(key);

      const result = await repo.findByPlayerId(playerId);
      store.set(key, result);
      return result;
    },
    async save(wallet) {
      const result = await repo.save(wallet);
      const store = storage.getStore();
      if (store) store.set(`wallet:${wallet.playerId}`, result);
      return result;
    },
    async listAll() {
      return repo.listAll();
    }
  };
}

/**
 * 包裝 playerRepository，加上請求層級快取。
 */
function withPlayerCache(repo) {
  return {
    async findByDiscordId(discordId) {
      const store = storage.getStore();
      if (!store) return repo.findByDiscordId(discordId);

      const key = `player:${discordId}`;
      if (store.has(key)) return store.get(key);

      const result = await repo.findByDiscordId(discordId);
      store.set(key, result);
      return result;
    },
    async findByExternalId(platform, platformUserId) {
      return repo.findByExternalId(platform, platformUserId);
    },
    async save(player) {
      const result = await repo.save(player);
      const store = storage.getStore();
      if (store) store.set(`player:${player.discordId}`, result);
      return result;
    },
    async listAll() {
      return repo.listAll();
    }
  };
}

module.exports = { runWithCache, withProgressCache, withWalletCache, withPlayerCache };
