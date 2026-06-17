const { AppError, ERROR_CODES } = require("../../shared/errors");
const { expToNextLevel, MAX_LEVEL } = require("../../shared/progression");
const { isValidExpSource } = require("../../shared/sources");
const { withPlayerProgressLock } = require("./progressLocks");

const ATTR_KEYS = ["str", "agi", "vit", "int", "dex", "luk"];
const ATTR_LABEL_ZH = {
  str: "力量 STR",
  agi: "敏捷 AGI",
  vit: "體質 VIT",
  int: "智力 INT",
  dex: "靈巧 DEX",
  luk: "幸運 LUK"
};
const CAS_MAX_RETRIES = 8;

class ProgressService {
  constructor(playerService, progressRepository) {
    this.playerService = playerService;
    this.progressRepository = progressRepository;
  }

  async _saveProgressWithFallback(progress, prevUpdatedAt) {
    if (typeof this.progressRepository?.saveIfUnchanged === "function") {
      return this.progressRepository.saveIfUnchanged(progress, prevUpdatedAt);
    }

    if (typeof this.progressRepository?.save === "function") {
      console.warn("[grantExp] progressRepository.saveIfUnchanged missing, falling back to save()");
      await this.progressRepository.save(progress);
      return true;
    }

    throw new AppError(ERROR_CODES.INTERNAL_ERROR, "progressRepository does not support save/saveIfUnchanged", 500);
  }

  async grantExp({ discordId, displayName, amount, source }) {
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "exp amount must be a positive integer", 400);
    }
    if (!isValidExpSource(source)) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, `unsupported exp source: ${source}`, 400);
    }

    // 使用玩家級別的鎖序列化操作，防止並發的 CAS 衝突
    return withPlayerProgressLock(discordId, async () => {
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
      const levelUpDetails = [];
      while (next.level < MAX_LEVEL && next.exp >= expToNextLevel(next.level)) {
        next.exp -= expToNextLevel(next.level);
        next.level += 1;
        levelUps += 1;
        const gainedAttrs = [];
        // 升級自動隨機 +1 兩次（各自獨立抽屬性）
        for (let i = 0; i < 2; i++) {
          const randKey = ATTR_KEYS[Math.floor(Math.random() * ATTR_KEYS.length)];
          next.attributes[randKey] = (next.attributes[randKey] || 1) + 1;
          gainedAttrs.push(randKey);
        }
        levelUpDetails.push({
          level: next.level,
          attrs: gainedAttrs,
          attrsZh: gainedAttrs.map((key) => ATTR_LABEL_ZH[key] || key.toUpperCase())
        });
      }
      if (next.level >= MAX_LEVEL) next.exp = 0;
      next.updatedAt = new Date().toISOString();

      const saved = await this._saveProgressWithFallback(next, prevUpdatedAt);
      if (saved) {
        // 升級 → 透過玩家事件 bus 推播,讓網頁不論在哪個畫面都能彈出升級視窗
        if (levelUps > 0) {
          try {
            const { playerEventBus } = require("../realtime/playerEventBus");
            const prevLevel = next.level - levelUps;
            // 彙總本次升級總共加了哪些屬性(跨多級累加)
            const gained = {};
            for (const lv of levelUpDetails) {
              for (const key of (lv.attrs || [])) gained[key] = (gained[key] || 0) + 1;
            }
            playerEventBus.emit(String(discordId), {
              type: "level_up",
              data: {
                prevLevel,
                newLevel: next.level,
                levelUps,
                attributes: { ...next.attributes },
                gained,
                gainedZh: Object.entries(gained).map(([key, n]) => ({
                  key,
                  label: ATTR_LABEL_ZH[key] || key.toUpperCase(),
                  amount: n
                })),
                attributesZh: ATTR_KEYS.map((key) => ({
                  key,
                  label: ATTR_LABEL_ZH[key] || key.toUpperCase(),
                  value: next.attributes[key] || 0,
                  gained: gained[key] || 0
                })),
                ts: new Date().toISOString()
              }
            });
          } catch (_) { /* 推播失敗不影響經驗結算 */ }
        }
        return { player, progress: next, levelUps, levelUpDetails };
      }

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
    return withPlayerProgressLock(discordId, async () => {
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

        const saved = await this._saveProgressWithFallback(next, prevUpdatedAt);
        if (saved) return next;

        if (attempt < CAS_MAX_RETRIES - 1) {
          await new Promise(r => setTimeout(r, 10 * (attempt + 1)));
          console.warn(`[allocateAttribute] CAS retry ${attempt + 1} for ${discordId}`);
        }
      }
      throw new AppError(ERROR_CODES.INTERNAL_ERROR, `allocateAttribute CAS failed after ${CAS_MAX_RETRIES} retries for ${discordId}`, 500);
    });
  }
}

module.exports = {
  ProgressService
};
