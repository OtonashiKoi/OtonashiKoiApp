const { AppError, ERROR_CODES } = require("../../shared/errors");
const { expToNextLevel, MAX_LEVEL } = require("../../shared/progression");
const { isValidExpSource } = require("../../shared/sources");

const ATTR_KEYS = ["str", "agi", "vit", "int", "dex", "luk"];
const CAS_MAX_RETRIES = 8;

// 玩家級別的操作鎖，防止同一玩家的並發 grantExp 導致 CAS 衝突
const playerExpLocks = new Map();

class ProgressService {
  constructor(playerService, progressRepository) {
    this.playerService = playerService;
    this.progressRepository = progressRepository;
  }

  // 獲取或建立玩家的鎖
  _getExpLock(discordId) {
    if (!playerExpLocks.has(discordId)) {
      playerExpLocks.set(discordId, Promise.resolve());
    }
    return playerExpLocks.get(discordId);
  }

  // 使用鎖執行 grantExp，確保同一玩家的操作序列化
  async _withExpLock(discordId, fn) {
    const currentLock = this._getExpLock(discordId);
    const newLock = currentLock.then(fn).catch(e => { throw e; });
    playerExpLocks.set(discordId, newLock);
    return newLock;
  }

  async grantExp({ discordId, displayName, amount, source }) {
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "exp amount must be a positive integer", 400);
    }
    if (!isValidExpSource(source)) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, `unsupported exp source: ${source}`, 400);
    }

    // 使用玩家級別的鎖序列化操作，防止並發的 CAS 衝突
    return this._withExpLock(discordId, async () => {
      return await this._grantExpInternal({ discordId, displayName, amount, source });
    });
  }

  async _grantExpInternal({ discordId, displayName, amount, source }) {
    // CAS 重試：讀取 → 計算 → 條件寫入（只在 updatedAt 未變時才寫）
    // 若被其他寫入搶先，重新讀取最新狀態再試，確保屬性絕對不會重複給
    for (let attempt = 0; attempt < CAS_MAX_RETRIES; attempt++) {
      const { player, progress } = await this.playerService.ensurePlayer(discordId, displayName);
      const prevUpdatedAt = progress.updatedAt;

      // ⚠️ 關鍵：必須深拷貝 attributes，否則 next.attributes[key]++ 會污染快取裡的原物件
      // 導致 CAS 重試時讀到的 progress.attributes 已經被前一輪加過，造成屬性點重複累加
      const next = {
        ...progress,
        attributes: { ...(progress.attributes || { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 }) }
      };
      next.exp = (next.exp || 0) + amount;

      let levelUps = 0;
      while (next.level < MAX_LEVEL && next.exp >= expToNextLevel(next.level)) {
        next.exp -= expToNextLevel(next.level);
        next.level += 1;
        levelUps += 1;
        // 升級自動隨機 +1 兩次（各自獨立抽屬性）
        for (let i = 0; i < 2; i++) {
          const randKey = ATTR_KEYS[Math.floor(Math.random() * ATTR_KEYS.length)];
          next.attributes[randKey] = (next.attributes[randKey] || 1) + 1;
        }
      }
      if (next.level >= MAX_LEVEL) next.exp = 0;
      next.updatedAt = new Date().toISOString();

      const saved = await this.progressRepository.saveIfUnchanged(next, prevUpdatedAt);
      if (saved) return { player, progress: next, levelUps };

      // 文件已被其他操作修改，等一下重試
      if (attempt < CAS_MAX_RETRIES - 1) {
        await new Promise(r => setTimeout(r, 10 * (attempt + 1)));
        console.warn(`[grantExp] CAS retry ${attempt + 1} for ${discordId}`);
      }
    }
    throw new AppError(ERROR_CODES.INTERNAL_ERROR, `grantExp CAS failed after ${CAS_MAX_RETRIES} retries for ${discordId}`, 500);
  }

  async allocateAttribute({ discordId, attribute, amount = 1 }) {
    // 驗證 attribute key（不需要讀取 DB 就能確認）
    if (!ATTR_KEYS.includes(attribute)) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, `invalid attribute: ${attribute}`, 400);
    }

    // CAS 重試：確保 statusPoints 扣除與屬性增加的原子性
    for (let attempt = 0; attempt < CAS_MAX_RETRIES; attempt++) {
      const progress = await this.progressRepository.findByPlayerId(discordId);
      if (!progress) {
        throw new AppError(ERROR_CODES.NOT_FOUND, `progress not found for player: ${discordId}`, 404);
      }

      if (!progress.attributes) {
        progress.attributes = { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 };
      }

      if ((progress.statusPoints || 0) < amount) {
        throw new AppError(ERROR_CODES.PRECONDITION_FAILED, "insufficient status points", 400);
      }

      const prevUpdatedAt = progress.updatedAt;
      const next = { ...progress, attributes: { ...progress.attributes } };
      next.statusPoints = (next.statusPoints || 0) - amount;
      next.attributes[attribute] = (next.attributes[attribute] || 1) + amount;
      next.updatedAt = new Date().toISOString();

      const saved = await this.progressRepository.saveIfUnchanged(next, prevUpdatedAt);
      if (saved) return next;

      if (attempt < CAS_MAX_RETRIES - 1) {
        await new Promise(r => setTimeout(r, 10 * (attempt + 1)));
        console.warn(`[allocateAttribute] CAS retry ${attempt + 1} for ${discordId}`);
      }
    }
    throw new AppError(ERROR_CODES.INTERNAL_ERROR, `allocateAttribute CAS failed after ${CAS_MAX_RETRIES} retries for ${discordId}`, 500);
  }
}

module.exports = {
  ProgressService
};