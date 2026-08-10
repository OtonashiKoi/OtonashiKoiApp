"use strict";
/**
 * 職業徽章熟練度 —— 出戰一場給裝備中的徽章 +1，升級時回報給呼叫端（廣播用）。
 *
 * 為什麼獨立成 service：DC 戰鬥區與網頁兩個入口都要給熟練度，
 * 而寫入需要 progress 上鎖（與掉落/獎勵同一把鎖，避免同時出戰互相蓋寫）。
 * 設計見 docs/JOB_BADGE_SYSTEM_DESIGN.md、公式見 shared/jobBadgeLevel.js。
 */

const { withPlayerProgressLock } = require("../progress/progressLocks");
const { AppError, ERROR_CODES } = require("../../shared/errors");
const jobBadgeLevel = require("../../shared/jobBadgeLevel");

class JobBadgeService {
  constructor(progressRepository, itemRepository = null, walletRepository = null, rewardService = null) {
    this.progressRepository = progressRepository;
    this.itemRepository = itemRepository;     // 轉職：查二轉徽章原型
    this.walletRepository = walletRepository; // 轉職：扣金幣
    this.rewardService = rewardService;       // 有的話走台帳
  }

  /**
   * 出戰一場：給「身上裝備中的職業徽章」+1 熟練度。
   * 背包裡沒裝備的徽章不累積——熟練度是「用它打出來的」。
   *
   * @returns {Promise<null|{
   *   badgeName:string, itemId:string, leveled:boolean, from:number, to:number,
   *   atMax:boolean, reachedTransfer:boolean, progress:object
   * }>} 沒裝徽章時回 null
   */
  async grantBattleProficiency(discordId, amount = 1) {
    if (!discordId) return null;
    return withPlayerProgressLock(discordId, async () => {
      const progress = await this.progressRepository.findByPlayerId(discordId);
      const badge = progress?.equipment?.job_eq;
      if (!jobBadgeLevel.isJobBadgeEntry(badge)) return null;

      const beforeLevel = jobBadgeLevel.levelFromExp(badge.jobExp);
      const result = jobBadgeLevel.gainBattleExp(badge, amount);
      if (!result) return null;
      // 已滿級就不再寫檔（省一次 save；滿級後熟練度沒有意義）
      if (result.atMax && !result.leveled && beforeLevel >= jobBadgeLevel.MAX_JOB_LEVEL) return null;

      progress.updatedAt = new Date().toISOString();
      await this.progressRepository.save(progress);

      return {
        badgeName: badge.itemName || badge.name || "職業徽章",
        itemId: String(badge.itemId || badge.id || ""),
        leveled: result.leveled,
        from: result.from,
        to: result.to,
        atMax: result.atMax,
        // 這一場剛好把徽章推到可轉職（給呼叫端做提示用；**不廣播**——
        // 練滿只是解鎖任務，轉職成功才值得全服知道）
        reachedTransfer: result.leveled && result.to >= jobBadgeLevel.TRANSFER_LEVEL,
        progress: jobBadgeLevel.readBadgeProgress(badge),
      };
    });
  }

  /**
   * ⚔️ 轉職：消耗「一轉徽章 ＋ 金幣」→ 換發二轉徽章（Lv1 重練）。
   *
   * 這是轉職的**唯一實作**，職業任務與（若日後啟用）劇情節點都呼叫這裡，
   * 避免兩套流程各自維護扣款/消耗/驗證而走鐘。
   *
   * @param {string} discordId
   * @param {string} t2BadgeId 要換發的二轉徽章 id
   * @param {object} opts { idempotencyKey?:string } 有給就寫進 progress.jobTransfers 做冪等
   */
  async transferJob(discordId, t2BadgeId, opts = {}) {
    const jobAdvancement = require("../../shared/jobAdvancement");
    const branch = jobAdvancement.getT2Branch(t2BadgeId);
    const baseKey = branch?.baseKey || null;
    const t1BadgeId = baseKey ? jobAdvancement.BASE_JOBS?.[baseKey]?.badgeId : null;
    if (!t1BadgeId) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "找不到對應的一轉職業", 400);
    // 本季不開放的分支：這是最後一道硬閘門。兩條轉職路徑（職業任務 weeklyQuestService、
    // 劇情節點 storyService.transferJobAtNode）都收斂到這個方法，擋在這裡就不會有漏網入口。
    if (jobAdvancement.isSeasonLockedT2(t2BadgeId)) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT,
        `${branch?.name || "這個職業"}本季尚未開放，敬請期待。`, 400);
    }

    const t2Item = this.itemRepository ? await this.itemRepository.findById(t2BadgeId).catch(() => null) : null;
    if (!t2Item) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "二轉徽章道具不存在", 400);

    return withPlayerProgressLock(discordId, async () => {
      const progress = await this.progressRepository.findByPlayerId(discordId);
      if (!progress) throw new AppError(ERROR_CODES.ITEM_NOT_FOUND, "找不到玩家進度", 404);

      const key = opts.idempotencyKey ? String(opts.idempotencyKey) : null;
      const done = progress.jobTransfers && typeof progress.jobTransfers === "object" ? { ...progress.jobTransfers } : {};
      if (key && done[key]) return { transferred: false, alreadyDone: true };

      // ① 一轉徽章（身上優先，其次背包）＋ 熟練度必須練滿
      const equipment = progress.equipment || {};
      const inventory = Array.isArray(progress.inventory) ? progress.inventory : (progress.inventory = []);
      const equippedIsT1 = String(equipment.job_eq?.itemId || "") === t1BadgeId;
      const invIdx = inventory.findIndex((e) => e && String(e.itemId || "") === t1BadgeId);
      const t1Entry = equippedIsT1 ? equipment.job_eq : (invIdx !== -1 ? inventory[invIdx] : null);
      if (!t1Entry) throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "你身上沒有這個職業的一轉徽章", 400);
      const t1Progress = jobBadgeLevel.readBadgeProgress(t1Entry);
      if (!t1Progress.canTransfer) {
        throw new AppError(ERROR_CODES.INVALID_ARGUMENT,
          `徽章熟練度不足（目前 Lv.${t1Progress.level}／需 Lv.${jobBadgeLevel.TRANSFER_LEVEL}）`, 400);
      }

      // ② 費用：依目前已持有的二轉徽章數遞增
      const ownedIds = [
        ...inventory.map((e) => String(e?.itemId || "")),
        ...Object.values(equipment).map((e) => String(e?.itemId || "")),
      ].filter(Boolean);
      const cost = jobAdvancement.transferCostFor(jobAdvancement.countOwnedT2(ownedIds));
      const wallet = this.walletRepository ? await this.walletRepository.findByPlayerId(discordId).catch(() => null) : null;
      const gold = Math.max(0, Number(wallet?.gold) || 0);
      if (gold < cost) {
        throw new AppError(ERROR_CODES.INVALID_ARGUMENT,
          `金幣不足：轉職需要 ${cost.toLocaleString()} 金，目前 ${gold.toLocaleString()} 金`, 400);
      }

      // ③ 扣款（有 rewardService 走台帳留紀錄）
      const displayName = progress.displayName || progress.playerName || discordId;
      if (this.rewardService?.grantCurrency) {
        await this.rewardService.grantCurrency({
          discordId, displayName, currencyType: "gold",
          amount: -Math.abs(cost), source: require("../../shared/sources").CURRENCY_SOURCES.JOB_TRANSFER, sourceRef: key ? `${discordId}:${key}` : "", operator: "quest:job-transfer",
        });
      } else if (this.walletRepository) {
        await this.walletRepository.save({ ...wallet, playerId: discordId, gold: gold - cost });
      } else {
        throw new AppError(ERROR_CODES.INTERNAL_ERROR, "缺少金幣扣款服務", 500);
      }

      // ④ 消耗一轉徽章（連同熟練度）
      if (equippedIsT1) {
        delete equipment.job_eq;
      } else {
        inventory.splice(invIdx, 1);

        // 一轉徽章也可以從背包遞交。若玩家此時正裝著另一個職業徽章，
        // 換上二轉徽章前必須先把原徽章退回背包，否則 job_eq 被覆蓋後整件會消失。
        if (equipment.job_eq) {
          inventory.push(equipment.job_eq);
          delete equipment.job_eq;
        }
      }

      // ⑤ 換發二轉徽章：Lv1 重練，直接裝上
      const crypto = require("crypto");
      const t2Entry = {
        uuid: crypto.randomUUID(),
        itemId: String(t2Item.id),
        itemName: t2Item.name,
        itemType: t2Item.itemType || "job_badge",
        equipSlot: t2Item.equipSlot || "job_eq",
        itemEffect: t2Item.effect || { type: "none", value: 0 },
        useEffects: t2Item.useEffects || [],
        passiveEffects: t2Item.passiveEffects || [],
        procEffects: t2Item.procEffects || [],
        combatEffects: t2Item.combatEffects || [],
        jobSkills: t2Item.jobSkills || [],
        imageUrl: t2Item.imageUrl || null,
        imageThumbnailUrl: t2Item.imageThumbnailUrl || null,
        tier: t2Item.tier || null,
        equipStats: t2Item.equipStats || null,
        enhanceLevel: 0,
        jobExp: 0,
        source: "job_transfer",
        purchasedAt: new Date().toISOString(),
      };
      progress.equipment = { ...equipment, job_eq: t2Entry };
      if (key) { done[key] = new Date().toISOString(); progress.jobTransfers = done; }
      progress.updatedAt = new Date().toISOString();
      await this.progressRepository.save(progress);

      // ⑥ 全服廣播
      try {
        const tc = require("../../shared/announceTownChat");
        const name = await tc.resolveDiscordName(discordId).catch(() => null);
        const who = name ? `**${name}**` : "有位冒險者";
        await tc.announceTownChat(`⚔️ ${who} 完成了二轉，成為 **${t2Item.name.replace(/徽章$/, "")}**！`);
      } catch (_) { /* 廣播失敗不影響轉職 */ }

      return {
        transferred: true,
        from: { itemId: t1BadgeId, name: t1Entry.itemName || t1BadgeId, level: t1Progress.level },
        to: { itemId: t2BadgeId, name: t2Item.name, level: 1 },
        cost, goldLeft: gold - cost,
      };
    });
  }

  /**
   * 轉職資格檢查（不扣任何東西）——給任務清單顯示「可解 / 還差什麼」用。
   * @returns {Promise<{eligible:boolean, reason:string|null, badgeLevel:number, cost:number, gold:number}>}
   */
  async checkTransferEligibility(discordId, t2BadgeId) {
    const jobAdvancement = require("../../shared/jobAdvancement");
    const branch = jobAdvancement.getT2Branch(t2BadgeId);
    const t1BadgeId = branch?.baseKey ? jobAdvancement.BASE_JOBS?.[branch.baseKey]?.badgeId : null;
    const out = { eligible: false, reason: null, badgeLevel: 0, cost: 0, gold: 0 };
    if (!t1BadgeId) { out.reason = "找不到對應的一轉職業"; return out; }

    const progress = await this.progressRepository.findByPlayerId(discordId).catch(() => null);
    if (!progress) { out.reason = "找不到玩家進度"; return out; }
    const equipment = progress.equipment || {};
    const inventory = Array.isArray(progress.inventory) ? progress.inventory : [];
    const t1Entry = String(equipment.job_eq?.itemId || "") === t1BadgeId
      ? equipment.job_eq
      : inventory.find((e) => e && String(e.itemId || "") === t1BadgeId);
    if (!t1Entry) { out.reason = "沒有這個職業的一轉徽章"; return out; }

    const bp = jobBadgeLevel.readBadgeProgress(t1Entry);
    out.badgeLevel = bp.level;
    const ownedIds = [
      ...inventory.map((e) => String(e?.itemId || "")),
      ...Object.values(equipment).map((e) => String(e?.itemId || "")),
    ].filter(Boolean);
    out.cost = jobAdvancement.transferCostFor(jobAdvancement.countOwnedT2(ownedIds));
    const wallet = this.walletRepository ? await this.walletRepository.findByPlayerId(discordId).catch(() => null) : null;
    out.gold = Math.max(0, Number(wallet?.gold) || 0);

    if (!bp.canTransfer) { out.reason = `徽章熟練度 Lv.${bp.level}／需 Lv.${jobBadgeLevel.TRANSFER_LEVEL}`; return out; }
    if (out.gold < out.cost) { out.reason = `金幣不足（需 ${out.cost.toLocaleString()}）`; return out; }
    out.eligible = true;
    return out;
  }

  /** 查詢玩家目前裝備中徽章的等級概況（給面板/API 用） */
  async getEquippedBadgeProgress(discordId) {
    const progress = await this.progressRepository.findByPlayerId(discordId).catch(() => null);
    const badge = progress?.equipment?.job_eq;
    if (!jobBadgeLevel.isJobBadgeEntry(badge)) return null;
    return {
      badgeName: badge.itemName || badge.name || "職業徽章",
      itemId: String(badge.itemId || badge.id || ""),
      ...jobBadgeLevel.readBadgeProgress(badge),
    };
  }
}

module.exports = { JobBadgeService };
