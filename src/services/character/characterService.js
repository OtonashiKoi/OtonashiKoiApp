"use strict";

const { createGameProgress } = require("../../domain/progress/createGameProgress");
const { AppError, ERROR_CODES } = require("../../shared/errors");
const { ALL_ZONE_KEYS } = require("../../shared/zones");
const { isMonsterBattleActive, isPkBattleActive, isTowerBattleActive } = require("../../shared/battlePresence");
const { isWebBattleActive } = require("../progress/battleLock");
const { withPlayerProgressLock } = require("../progress/progressLocks");
const {
  CHARACTER_SLOTS,
  resolveMembershipEntitlements,
  requiredTierForCharacterSlot,
  membershipTierLabel,
  characterSlotLockReason,
} = require("../../shared/membershipEntitlements");

// 只有角色養成與戰鬥狀態會隨人物切換。背包、圖鑑、寵物收藏、單人王每日限制、
// 劇情／一次性旗標、會員位階等帳號資產留在 progress 頂層共用，避免分身重複取得。
const CHARACTER_PROGRESS_KEYS = [
  "level", "levelReachedAt", "exp", "job", "jobLevel", "jobExp",
  "statusPoints", "attributes", "allocatedAttrs", "allocatedPoints",
  "equipment", "activeEffects", "activePreset", "equipPresets", "equipPresetNames",
  "pkRating", "pkWins", "pkLosses", "towerRecord",
  "activePetUuid",
  "bardScore", "bardStreak", "berserkGauge", "oniGauge", "sageGauge",
  "shadowGauge", "sniperGauge", "sunSpirit", "zoneCombo",
];

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function activeSlotOf(progress) {
  const slot = Number(progress?.activeCharacterSlot);
  return CHARACTER_SLOTS.includes(slot) ? slot : 1;
}

function takeCharacterSnapshot(progress) {
  const snapshot = {};
  for (const key of CHARACTER_PROGRESS_KEYS) {
    if (progress && progress[key] !== undefined) snapshot[key] = clone(progress[key]);
  }
  return snapshot;
}

function newCharacterSnapshot(playerId) {
  return takeCharacterSnapshot(createGameProgress(playerId));
}

function itemName(item) {
  return String(item?.itemName || item?.name || "").trim();
}

function summarizeCharacter(slot, snapshot, active = false) {
  if (!snapshot) return { slot, created: false, active: false };
  const equipment = snapshot.equipment && typeof snapshot.equipment === "object" ? snapshot.equipment : {};
  const job = itemName(equipment.job_eq) || String(snapshot.job || "新手");
  const title = itemName(equipment.title_eq) || null;
  const equippedNames = Object.entries(equipment)
    .filter(([key, value]) => !["job_eq", "title_eq", "anchor"].includes(key) && value)
    .map(([, value]) => itemName(value))
    .filter(Boolean);
  return {
    slot,
    created: true,
    active,
    level: Math.max(1, Number(snapshot.level) || 1),
    job,
    title,
    equipmentCount: equippedNames.length,
    equipmentNames: equippedNames.slice(0, 4),
  };
}

class CharacterService {
  constructor({ progressRepository, streamAccountBindingRepository, monsterService }) {
    this.progressRepository = progressRepository;
    this.streamAccountBindingRepository = streamAccountBindingRepository;
    this.monsterService = monsterService;
  }

  async _membershipEntitlements(discordId, progress) {
    const bindings = await this.streamAccountBindingRepository?.listByDiscordId?.(discordId).catch(() => []);
    return resolveMembershipEntitlements(progress, bindings || []);
  }

  async getState(discordId) {
    const progress = await this.progressRepository.findByPlayerId(discordId);
    if (!progress) throw new AppError(ERROR_CODES.NOT_FOUND, "找不到玩家角色資料。", 404);
    const activeSlot = activeSlotOf(progress);
    const stored = progress.characterSlots && typeof progress.characterSlots === "object"
      ? progress.characterSlots
      : {};
    const entitlements = await this._membershipEntitlements(discordId, progress);
    const slots = CHARACTER_SLOTS.map((slot) => {
      const snapshot = slot === activeSlot ? takeCharacterSnapshot(progress) : stored[String(slot)];
      const active = slot === activeSlot;
      const requiredTier = requiredTierForCharacterSlot(slot);
      const locked = !active && slot > entitlements.maxCharacterSlots;
      return {
        ...summarizeCharacter(slot, snapshot || null, active),
        locked,
        requiredTier,
        requiredTierLabel: requiredTier ? membershipTierLabel(requiredTier) : null,
        lockReason: locked ? characterSlotLockReason(slot) : null,
      };
    });
    return {
      enabled: true,
      testOnly: false,
      activeSlot,
      isMember: entitlements.isMember,
      membershipTier: entitlements.tier,
      membershipLabel: entitlements.label,
      maxCharacterSlots: entitlements.maxCharacterSlots,
      maxPresetSlots: entitlements.maxPresetSlots,
      slots,
    };
  }

  _assertNotBattling(discordId) {
    if (isMonsterBattleActive(discordId) || isWebBattleActive(discordId)) {
      throw new AppError(ERROR_CODES.PRECONDITION_FAILED, "戰鬥進行中，請等本場戰鬥結束後再切換人物。", 409);
    }
    if (isPkBattleActive(discordId)) {
      throw new AppError(ERROR_CODES.PRECONDITION_FAILED, "PK 對戰進行中，暫時不能切換人物。", 409);
    }
    if (isTowerBattleActive(discordId)) {
      throw new AppError(ERROR_CODES.PRECONDITION_FAILED, "爬塔挑戰進行中，暫時不能切換人物。", 409);
    }
  }

  async _clearBattleAuras(discordId) {
    if (!this.monsterService) return;
    for (const zoneKey of ALL_ZONE_KEYS) {
      const state = await this.monsterService.getState(zoneKey).catch(() => null);
      if (!state) continue;
      const before = Array.isArray(state.activeHealerAuras)
        ? state.activeHealerAuras
        : (state.activeHealerAura ? [state.activeHealerAura] : []);
      const after = before.filter((aura) => String(aura?.discordId || "") !== String(discordId));
      const legacyMatched = String(state.activeHealerAura?.discordId || "") === String(discordId);
      if (after.length === before.length && !legacyMatched) continue;
      await this.monsterService.saveState({
        ...state,
        activeHealerAuras: after,
        activeHealerAura: null,
      }, zoneKey).catch(() => {});
    }
  }

  async switchCharacter(discordId, requestedSlot) {
    const targetSlot = Number(requestedSlot);
    if (!CHARACTER_SLOTS.includes(targetSlot)) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "人物欄位必須是 1、2、3、4 或 5。", 400);
    }
    this._assertNotBattling(discordId);

    const result = await withPlayerProgressLock(discordId, async () => {
      const progress = await this.progressRepository.findByPlayerId(discordId);
      if (!progress) throw new AppError(ERROR_CODES.NOT_FOUND, "找不到玩家角色資料。", 404);
      const currentSlot = activeSlotOf(progress);
      if (currentSlot === targetSlot) return { changed: false };

      const entitlements = await this._membershipEntitlements(discordId, progress);
      if (targetSlot > entitlements.maxCharacterSlots) {
        throw new AppError(ERROR_CODES.FORBIDDEN, characterSlotLockReason(targetSlot), 403);
      }

      const characterSlots = clone(progress.characterSlots || {});
      characterSlots[String(currentSlot)] = takeCharacterSnapshot(progress);

      let targetSnapshot = characterSlots[String(targetSlot)] || null;
      let created = false;
      if (!targetSnapshot) {
        if (targetSlot === 1) {
          throw new AppError(ERROR_CODES.NOT_FOUND, "角色 1 資料不存在，請聯絡管理員。", 404);
        }
        targetSnapshot = newCharacterSnapshot(discordId);
        characterSlots[String(targetSlot)] = clone(targetSnapshot);
        created = true;
      }

      // 直接在 repository 讀出的物件上更新，保留不可列舉的背包基準戳記；
      // save() 因此能確認背包未變，不會在切角瞬間覆蓋並發取得的新掉落。
      const next = progress;
      next.activeCharacterSlot = targetSlot;
      next.characterSlots = characterSlots;
      for (const key of CHARACTER_PROGRESS_KEYS) {
        next[key] = targetSnapshot[key] !== undefined ? clone(targetSnapshot[key]) : null;
      }
      // 舊人物快照可能建立於裝備方案功能之前；切入時補齊空結構，不改動既有 A～C 資料。
      if (!next.activePreset) next.activePreset = "A";
      if (!next.equipPresets || typeof next.equipPresets !== "object") next.equipPresets = {};
      if (!next.equipPresetNames || typeof next.equipPresetNames !== "object") next.equipPresetNames = {};
      // 共用背包始終沿用切換前的帳號背包；任何角色身上的裝備只存在各自快照。
      next.inventory = progress.inventory;
      next.updatedAt = new Date().toISOString();
      await this.progressRepository.save(next);
      return { changed: true, created, previousSlot: currentSlot };
    });

    if (result.changed) await this._clearBattleAuras(discordId);
    return { ...(await this.getState(discordId)), ...result };
  }
}

module.exports = {
  CharacterService,
  CHARACTER_SLOTS,
  CHARACTER_PROGRESS_KEYS,
  activeSlotOf,
  takeCharacterSnapshot,
  summarizeCharacter,
};
