"use strict";

const QUEST_CADENCES = ["onboarding", "job", "daily", "weekly"];
const QUEST_TYPES = {
  battle_count:      { label: "出戰次數",        unit: "次" },
  battle_with_sword: { label: "使用劍系出戰次數", unit: "次" },
  battle_with_axe:   { label: "使用斧系出戰次數", unit: "次" },
  battle_with_mace:  { label: "使用槌系出戰次數", unit: "次" },
  battle_with_dagger:{ label: "使用匕首出戰次數", unit: "次" },
  battle_with_staff: { label: "使用法杖出戰次數", unit: "次" },
  battle_with_bow:   { label: "使用弓出戰次數",   unit: "次" },
  battle_win:        { label: "戰鬥勝利次數",     unit: "次" },
  damage_total:      { label: "累計造成傷害",     unit: "點" },
  level_10_job_badge:{ label: "達成 Lv.10 並獲得職業徽章", unit: "項" },
  checkin_count:     { label: "打卡次數",        unit: "次" },
  stream_bind_count: { label: "直播綁定次數",     unit: "次" },
  equip_count:       { label: "裝備次數",        unit: "次" },
  enhance_count:     { label: "強化次數",        unit: "次" },
  combo_count:       { label: "成功連擊次數",     unit: "次" },
  dodge_count:       { label: "成功迴避次數",     unit: "次" },
  block_count:       { label: "成功格擋次數",     unit: "次" },
  stun_count:        { label: "成功擊暈次數",     unit: "次" },
  death_count:       { label: "角色死亡次數",     unit: "次" },
  burn_trigger_count:{ label: "成功觸發燃燒次數", unit: "次" },
  onboarding_complete_count: { label: "完成全部新手任務", unit: "項" },
  weekly_complete_count: { label: "完成全部每週任務", unit: "項" },
};

const CADENCE_ORDER = { onboarding: 1, job: 2, daily: 3, weekly: 4 };

function normalizeCadence(cadence) {
  return QUEST_CADENCES.includes(cadence) ? cadence : "weekly";
}

function resetPolicyByCadence(cadence) {
  if (cadence === "onboarding") return "once";
  if (cadence === "job") return "once";
  if (cadence === "daily") return "tw_daily";
  return "tw_weekly";
}

function getTWParts(date = new Date()) {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const partMap = {};
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== "literal") partMap[p.type] = p.value;
  }
  return {
    year: Number(partMap.year),
    month: Number(partMap.month),
    day: Number(partMap.day)
  };
}

function currentDayLabel() {
  const p = getTWParts(new Date());
  return `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function toIsoWeekLabelFromTWDate({ year, month, day }) {
  const date = new Date(Date.UTC(year, month - 1, day));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const isoYear = date.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((date - firstThursday) / 604800000);
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

function currentWeekLabel() {
  return toIsoWeekLabelFromTWDate(getTWParts(new Date()));
}

function resolvePeriodKey(cadence) {
  const c = normalizeCadence(cadence);
  if (c === "onboarding") return "onboarding-v1";
  if (c === "job") return "job-v1";
  if (c === "daily") return currentDayLabel();
  return currentWeekLabel();
}

function isJobBadgeItemId(itemId) {
  return String(itemId || "").toLowerCase().startsWith("job_");
}

class WeeklyQuestService {
  constructor(weeklyQuestRepository, playerService) {
    this.repo = weeklyQuestRepository;
    this.playerService = playerService;
    this.claimLocks = new Set();
  }

  _sortDefinitions(list) {
    return [...list].sort((a, b) => {
      const ao = CADENCE_ORDER[normalizeCadence(a?.cadence)] || 99;
      const bo = CADENCE_ORDER[normalizeCadence(b?.cadence)] || 99;
      if (ao !== bo) return ao - bo;
      const as = Number(a?.sortOrder || 0);
      const bs = Number(b?.sortOrder || 0);
      if (as !== bs) return as - bs;
      return String(a?.createdAt || "").localeCompare(String(b?.createdAt || ""));
    });
  }

  _normalizeDefinition(def) {
    const cadence = normalizeCadence(def?.cadence || "weekly");
    const unlockWeaponTypes = Array.isArray(def?.unlockWeaponTypes)
      ? def.unlockWeaponTypes.map((v) => String(v || "").trim()).filter(Boolean)
      : (typeof def?.unlockWeaponTypes === "string"
        ? String(def.unlockWeaponTypes).split(",").map((v) => v.trim()).filter(Boolean)
        : []);
    const VALID_ATTRS = ["str", "agi", "vit", "int", "dex", "luk"];
    const unlockAttribute = def?.unlockAttribute ? String(def.unlockAttribute).trim().toLowerCase() : null;
    const unlockAttribute2 = def?.unlockAttribute2 ? String(def.unlockAttribute2).trim().toLowerCase() : null;
    return {
      ...def,
      cadence,
      resetPolicy: def?.resetPolicy || resetPolicyByCadence(cadence),
      sortOrder: Number(def?.sortOrder || 0),
      groupKey: String(def?.groupKey || "core"),
      levelLimit: Math.max(0, Number(def?.levelLimit || 0)),
      enabled: def?.enabled !== false,
      unlockLevel: Math.max(0, Number(def?.unlockLevel || 0)),
      unlockWeaponTypes,
      unlockAttribute: VALID_ATTRS.includes(unlockAttribute) ? unlockAttribute : null,
      unlockAttribute2: VALID_ATTRS.includes(unlockAttribute2) ? unlockAttribute2 : null,
      unlockAttributeMin: Math.max(0, Number(def?.unlockAttributeMin || 0)),
      hideIfRewardOwned: def?.hideIfRewardOwned !== false,
      claimOnce: Boolean(def?.claimOnce)
    };
  }

  async _getPlayerLevel(discordId) {
    let playerLevel = 1;
    try {
      const profile = await this.playerService.getProfile(discordId, discordId);
      playerLevel = profile?.progress?.level || 1;
    } catch (_) {
      // ignore
    }
    return playerLevel;
  }

  async _getPlayerQuestContext(discordId) {
    let level = 1;
    let attributes = { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 };
    let equipment = {};
    let inventory = [];

    try {
      const profile = await this.playerService.getProfile(discordId, discordId);
      const progress = profile?.progress || {};
      level = Number(progress.level || 1);
      attributes = { ...attributes, ...(progress.attributes || {}) };
      equipment = progress.equipment || {};
      inventory = Array.isArray(progress.inventory) ? progress.inventory : [];
    } catch (_) {
      // ignore
    }

      return {
        level,
        attributes,
        equipment,
        inventory,
        weaponType: equipment?.weapon?.weaponType || null,
        inventoryItemIds: new Set(
          (Array.isArray(inventory) ? inventory : [])
            .map((item) => item?.itemId ? String(item.itemId) : null)
            .filter(Boolean)
        ),
        equippedItemIds: new Set(
          Object.values(equipment || {})
            .map((item) => item?.itemId ? String(item.itemId) : null)
            .filter(Boolean)
        ),
        hasJobBadge: [
          ...(Array.isArray(inventory) ? inventory : []),
          ...Object.values(equipment || {})
        ].some((item) => isJobBadgeItemId(item?.itemId))
    };
  }

  // 用於 recordProgress：只判斷「行為條件是否符合」（武器/屬性/等級）
  // 不檢查 hideIfRewardOwned —— 玩家透過商店或活動取得 reward 不該阻止任務進度累積
  _canAccrueProgress(quest, context) {
    if (!quest?.enabled) return false;
    const level = Number(context?.level || 1);
    if (quest.levelLimit && quest.levelLimit > level) return false;
    if (quest.unlockLevel && level < Number(quest.unlockLevel || 0)) return false;
    if (Array.isArray(quest.unlockWeaponTypes) && quest.unlockWeaponTypes.length > 0) {
      const weaponType = String(context?.weaponType || "");
      if (!quest.unlockWeaponTypes.includes(weaponType)) return false;
    }
    if (quest.unlockAttribute) {
      const val1 = Number(context?.attributes?.[quest.unlockAttribute] || 0);
      const val2 = quest.unlockAttribute2 ? Number(context?.attributes?.[quest.unlockAttribute2] || 0) : 0;
      const total = quest.unlockAttribute2 ? val1 + val2 : val1;
      if (!(total > Number(quest.unlockAttributeMin || 0))) return false;
    }
    return true;
  }

  _isQuestVisibleForPlayer(quest, context) {
    if (!quest?.enabled) return false;
    const level = Number(context?.level || 1);
    if (quest.levelLimit && quest.levelLimit > level) return false;
    if (quest.unlockLevel && level < Number(quest.unlockLevel || 0)) return false;

      if (
        quest.hideIfRewardOwned &&
        quest.rewardItemId &&
        (
          context?.equippedItemIds?.has(String(quest.rewardItemId)) ||
          context?.inventoryItemIds?.has(String(quest.rewardItemId))
        )
      ) {
        return false;
      }

    if (quest.unlockAttribute) {
      const val1 = Number(context?.attributes?.[quest.unlockAttribute] || 0);
      const val2 = quest.unlockAttribute2 ? Number(context?.attributes?.[quest.unlockAttribute2] || 0) : 0;
      const total = quest.unlockAttribute2 ? val1 + val2 : val1;
      if (!(total > Number(quest.unlockAttributeMin || 0))) return false;
    }

    return true;
  }

  _computeCompletionProgress(defs, playerPeriod, completionType) {
    const baseDefs = defs.filter((q) => q.type !== completionType);
    const doneOrClaimedBase = baseDefs.filter((q) => {
      const p = playerPeriod[q.id] || { current: 0, claimed: false };
      const current = Number(p.current || 0);
      return Boolean(p.claimed) || current >= Number(q.target || 1);
    }).length;
    return {
      current: doneOrClaimedBase,
      target: baseDefs.length
    };
  }

  _resolveStaticQuestProgress(quest, context) {
    if (!quest?.enabled) return null;
    if (quest.type === "level_10_job_badge") {
      const level = Number(context?.level || 1);
      const hasJobBadge = Boolean(context?.hasJobBadge);
      return {
        current: level >= 10 && hasJobBadge ? 1 : 0,
        target: 1
      };
    }
    return null;
  }

  async listDefinitions(cadence = "all") {
    const all = (await this.repo.listQuests()).map((q) => this._normalizeDefinition(q));
    if (cadence && cadence !== "all") {
      const c = normalizeCadence(cadence);
      return this._sortDefinitions(all.filter((q) => q.cadence === c));
    }
    return this._sortDefinitions(all);
  }

  // legacy-compatible
  async listQuests() {
    return this.listDefinitions("weekly");
  }

  async createDefinition(fields) {
    const cadence = normalizeCadence(fields?.cadence || "weekly");
    const quest = this._normalizeDefinition({
      id: crypto.randomUUID(),
      title: String(fields?.title || "").trim() || "新任務",
      description: String(fields?.description || "").trim(),
      type: QUEST_TYPES[fields?.type] ? fields.type : "battle_count",
      target: Math.max(1, Number(fields?.target) || 1),
      rewardGold: Math.max(0, Number(fields?.rewardGold) || 0),
      rewardExp: Math.max(0, Number(fields?.rewardExp) || 0),
      rewardDiamond: 0,
      rewardItemId: fields?.rewardItemId || null,
      enabled: fields?.enabled !== false,
      levelLimit: Math.max(0, Number(fields?.levelLimit) || 0),
      cadence,
      resetPolicy: fields?.resetPolicy || resetPolicyByCadence(cadence),
      sortOrder: Number(fields?.sortOrder || 0),
      unlockLevel: Math.max(0, Number(fields?.unlockLevel || 0)),
      unlockWeaponTypes: fields?.unlockWeaponTypes || [],
      unlockAttribute: fields?.unlockAttribute || null,
      unlockAttribute2: fields?.unlockAttribute2 || null,
      unlockAttributeMin: Math.max(0, Number(fields?.unlockAttributeMin || 0)),
      hideIfRewardOwned: fields?.hideIfRewardOwned !== false,
      claimOnce: Boolean(fields?.claimOnce),
      groupKey: String(fields?.groupKey || "core"),
      createdAt: new Date().toISOString()
    });
    return this.repo.saveQuest(quest);
  }

  // legacy-compatible
  async createQuest(fields) {
    return this.createDefinition({ cadence: "weekly", ...fields });
  }

  async updateDefinition(id, fields) {
    const quest = await this.repo.findQuestById(id);
    if (!quest) throw new Error("任務不存在");

    const next = this._normalizeDefinition({
      ...quest,
      title: fields?.title !== undefined ? (String(fields.title).trim() || quest.title) : quest.title,
      description: fields?.description !== undefined ? String(fields.description).trim() : quest.description,
      type: fields?.type !== undefined && QUEST_TYPES[fields.type] ? fields.type : quest.type,
      target: fields?.target !== undefined ? Math.max(1, Number(fields.target) || 1) : quest.target,
      rewardGold: fields?.rewardGold !== undefined ? Math.max(0, Number(fields.rewardGold) || 0) : quest.rewardGold,
      rewardExp: fields?.rewardExp !== undefined ? Math.max(0, Number(fields.rewardExp) || 0) : Number(quest.rewardExp || 0),
      rewardDiamond: 0,
      rewardItemId: fields?.rewardItemId !== undefined ? (fields.rewardItemId || null) : quest.rewardItemId,
      enabled: fields?.enabled !== undefined ? Boolean(fields.enabled) : quest.enabled,
      levelLimit: fields?.levelLimit !== undefined ? Math.max(0, Number(fields.levelLimit) || 0) : quest.levelLimit,
      cadence: fields?.cadence !== undefined ? normalizeCadence(fields.cadence) : normalizeCadence(quest.cadence),
      resetPolicy: fields?.resetPolicy !== undefined ? String(fields.resetPolicy || "") : quest.resetPolicy,
      sortOrder: fields?.sortOrder !== undefined ? Number(fields.sortOrder || 0) : Number(quest.sortOrder || 0),
      unlockLevel: fields?.unlockLevel !== undefined ? Math.max(0, Number(fields.unlockLevel) || 0) : Number(quest.unlockLevel || 0),
      unlockWeaponTypes: fields?.unlockWeaponTypes !== undefined ? fields.unlockWeaponTypes : (quest.unlockWeaponTypes || []),
      unlockAttribute: fields?.unlockAttribute !== undefined ? (fields.unlockAttribute || null) : (quest.unlockAttribute || null),
      unlockAttribute2: fields?.unlockAttribute2 !== undefined ? (fields.unlockAttribute2 || null) : (quest.unlockAttribute2 || null),
      unlockAttributeMin: fields?.unlockAttributeMin !== undefined ? Math.max(0, Number(fields.unlockAttributeMin) || 0) : Number(quest.unlockAttributeMin || 0),
      hideIfRewardOwned: fields?.hideIfRewardOwned !== undefined ? Boolean(fields.hideIfRewardOwned) : quest.hideIfRewardOwned !== false,
      claimOnce: fields?.claimOnce !== undefined ? Boolean(fields.claimOnce) : Boolean(quest.claimOnce),
      groupKey: fields?.groupKey !== undefined ? String(fields.groupKey || "core") : String(quest.groupKey || "core")
    });
    if (!next.resetPolicy) next.resetPolicy = resetPolicyByCadence(next.cadence);
    return this.repo.saveQuest(next);
  }

  // legacy-compatible
  async updateQuest(id, fields) {
    return this.updateDefinition(id, { cadence: "weekly", ...fields });
  }

  async deleteDefinition(id) {
    await this.repo.deleteQuest(id);
  }

  // legacy-compatible
  async deleteQuest(id) {
    await this.deleteDefinition(id);
  }

  async _getProgressByCadence(discordId, cadence) {
    const c = normalizeCadence(cadence);
    const periodKey = resolvePeriodKey(c);
    const allDefs = await this.listDefinitions(c);
    const context = await this._getPlayerQuestContext(discordId);
    const playerLevel = context.level;
    const defs = allDefs.filter((q) => this._isQuestVisibleForPlayer(q, context));
    const playerPeriod = await this.repo.getPlayerProgress(discordId, periodKey, c);
    const completionByType = {};
    if (c === "onboarding" && defs.some((q) => q.type === "onboarding_complete_count")) {
      completionByType.onboarding_complete_count = this._computeCompletionProgress(defs, playerPeriod, "onboarding_complete_count");
    }
    if (c === "weekly" && defs.some((q) => q.type === "weekly_complete_count")) {
      completionByType.weekly_complete_count = this._computeCompletionProgress(defs, playerPeriod, "weekly_complete_count");
    }
    return defs.map((quest) => {
      const p = playerPeriod[quest.id] || { current: 0, claimed: false };
      const completion = completionByType[quest.type] || null;
      const staticProgress = this._resolveStaticQuestProgress(quest, context);
      const current = staticProgress
        ? staticProgress.current
        : completion
          ? completion.current
          : Number(p.current || 0);
      const target = staticProgress
        ? staticProgress.target
        : completion
          ? completion.target
          : Number(quest.target || 1);
      return {
        cadence: c,
        periodKey,
        quest,
        current,
        claimed: Boolean(p.claimed || (quest.claimOnce && p.claimedOnce)),
        done: current >= target
      };
    });
  }

  async getPlayerProgress(discordId, cadence = "weekly") {
    if (cadence === "all") {
      const all = [];
      for (const c of QUEST_CADENCES) {
        const rows = await this._getProgressByCadence(discordId, c);
        all.push(...rows);
      }
      return this._sortDefinitions(all.map((r) => r.quest)).map((quest) => all.find((r) => r.quest.id === quest.id));
    }
    return this._getProgressByCadence(discordId, cadence);
  }

  async recordProgress(discordId, type, amount = 1) {
    const inc = Math.max(0, Number(amount) || 0);
    if (!inc) return;
    const context = await this._getPlayerQuestContext(discordId);
    const playerLevel = context.level;

    for (const cadence of QUEST_CADENCES) {
      const allDefs = await this.listDefinitions(cadence);
      const defs = allDefs.filter((q) => (
        q.enabled &&
        q.type === type &&
        this._canAccrueProgress(q, context)
      ));
      if (!defs.length) continue;

      const periodKey = resolvePeriodKey(cadence);
      const playerPeriod = await this.repo.getPlayerProgress(discordId, periodKey, cadence);
      for (const q of defs) {
        if (!playerPeriod[q.id]) playerPeriod[q.id] = { current: 0, claimed: false };
        if (!playerPeriod[q.id].claimed && !playerPeriod[q.id].claimedOnce) {
          playerPeriod[q.id].current = Math.min(Number(q.target || 1), Number(playerPeriod[q.id].current || 0) + inc);
        }
      }
      await this.repo.savePlayerProgress(discordId, periodKey, playerPeriod, cadence);
    }
  }

  async claimReward(discordId, questId) {
    const allDefs = await this.listDefinitions("all");
    const quest = allDefs.find((q) => q.id === questId && q.enabled);
    if (!quest) throw new Error("任務不存在或未啟用");

    const playerLevel = await this._getPlayerLevel(discordId);
    if (quest.levelLimit && quest.levelLimit > playerLevel) throw new Error("等級不足");

    const periodKey = resolvePeriodKey(quest.cadence);
    const lockKey = `${discordId}:${quest.cadence}:${periodKey}:${questId}`;
    if (this.claimLocks.has(lockKey)) throw new Error("獎勵領取中，請稍後再試");

    this.claimLocks.add(lockKey);
    try {
      const playerPeriod = await this.repo.getPlayerProgress(discordId, periodKey, quest.cadence);
      const p = playerPeriod[questId] || { current: 0, claimed: false };
      const context = await this._getPlayerQuestContext(discordId);
      if (quest.type === "onboarding_complete_count" || quest.type === "weekly_complete_count") {
        const targetCadence = quest.cadence === "weekly" ? "weekly" : "onboarding";
        const cadenceDefs = (await this.listDefinitions(targetCadence))
          .filter((q) => this._isQuestVisibleForPlayer(q, context) || Boolean((playerPeriod[q.id] || {}).claimed));
        const completion = this._computeCompletionProgress(cadenceDefs, playerPeriod, quest.type);
        if (completion.current < completion.target) throw new Error("任務尚未完成");
        p.current = completion.current;
      } else if (quest.type === "level_10_job_badge") {
        const staticProgress = this._resolveStaticQuestProgress(quest, context);
        p.current = staticProgress?.current || 0;
        if (p.current < Number(quest.target || 1)) throw new Error("任務尚未完成");
      } else if (Number(p.current || 0) < Number(quest.target || 1)) {
        throw new Error("任務尚未完成");
      }
      if (p.claimed || (quest.claimOnce && p.claimedOnce)) throw new Error("獎勵已領取");

      p.claimed = true;
      if (quest.claimOnce) {
        p.claimedOnce = true;
        p.claimedAt = p.claimedAt || new Date().toISOString();
      }
      playerPeriod[questId] = p;
      await this.repo.savePlayerProgress(discordId, periodKey, playerPeriod, quest.cadence);

      return {
        questTitle: quest.title,
        gold: Number(quest.rewardGold || 0),
        exp: Number(quest.rewardExp || 0),
        diamond: 0,
        rewardItemId: quest.rewardItemId || null,
        cadence: quest.cadence,
        periodKey
      };
    } finally {
      this.claimLocks.delete(lockKey);
    }
  }

  async getSummary(cadence = "weekly", periodKey = null) {
    const c = normalizeCadence(cadence);
    const pk = periodKey || resolvePeriodKey(c);
    const quests = await this.listDefinitions(c);
    const allProgress = await this.repo.getAllProgressByPeriod(pk, c);
    const result = {};
    for (const [pid, playerPeriod] of Object.entries(allProgress)) {
      result[pid] = {};
      for (const q of quests) {
        const p = playerPeriod[q.id] || { current: 0, claimed: false };
        result[pid][q.id] = {
          current: Number(p.current || 0),
          claimed: Boolean(p.claimed),
          done: Number(p.current || 0) >= Number(q.target || 1)
        };
      }
    }
    return { cadence: c, periodKey: pk, quests, progress: result };
  }

  // legacy-compatible
  async getWeekSummary(weekLabel = null) {
    const wl = weekLabel || currentWeekLabel();
    const summary = await this.getSummary("weekly", wl);
    return {
      weekLabel: summary.periodKey,
      quests: summary.quests,
      progress: summary.progress
    };
  }

  async ensureDefaultSeeds() {
    const defaults = [
      // onboarding (16)
      { cadence: "onboarding", title: "完成直播綁定", description: "先完成直播綁定，讓系統認得你的直播帳號。", type: "stream_bind_count", target: 1, rewardGold: 200, rewardExp: 80, rewardDiamond: 0, rewardItemId: "7bdf0277-dcd5-4173-b3ff-d93ccaa9e293", sortOrder: 10, groupKey: "seed_v1" },
      { cadence: "onboarding", title: "首次出戰", description: "進入任一戰鬥完成 1 次出戰即可。", type: "battle_count", target: 1, rewardGold: 120, rewardExp: 60, rewardDiamond: 0, rewardItemId: "a56bd609-cf0b-4924-b724-891f221fc0b9", sortOrder: 20, groupKey: "seed_v1" },
      { cadence: "onboarding", title: "首次勝利", description: "用任一武器打贏 1 場戰鬥即可。", type: "battle_win", target: 1, rewardGold: 180, rewardExp: 90, rewardDiamond: 0, rewardItemId: "4a7c2dd6-1d33-4613-a5aa-913924d12eed", sortOrder: 30, groupKey: "seed_v1" },
      { cadence: "onboarding", title: "累計造成 500 傷害", description: "持續出戰、累積輸出，總傷害達到 500 即可。", type: "damage_total", target: 500, rewardGold: 200, rewardExp: 100, rewardDiamond: 0, rewardItemId: "ee883bee-93c6-450d-b196-754d3e345d2a", sortOrder: 40, groupKey: "seed_v1" },
      { cadence: "onboarding", title: "完成 1 次打卡", description: "到打卡功能完成 1 次打卡即可。", type: "checkin_count", target: 1, rewardGold: 150, rewardExp: 60, rewardDiamond: 0, rewardItemId: "8c9ac7c4-e00d-44fb-9582-8c68b99c2357", sortOrder: 50, groupKey: "seed_v1" },
      { cadence: "onboarding", title: "裝備任一裝備 1 次", description: "任意裝備一件裝備即可完成。", type: "equip_count", target: 1, rewardGold: 200, rewardExp: 90, rewardDiamond: 0, rewardItemId: "4885e098-3624-4c6c-9eb9-e4b27c2fb5ab", sortOrder: 60, groupKey: "seed_v1" },
      { cadence: "onboarding", title: "完成 1 次強化", description: "對任一裝備進行 1 次強化即可。", type: "enhance_count", target: 1, rewardGold: 240, rewardExp: 120, rewardDiamond: 0, rewardItemId: "912125cb-6738-4694-9657-81e7f6a5c2da", sortOrder: 70, groupKey: "seed_v1" },
      { cadence: "onboarding", title: "出戰 10 次", description: "重複出戰累積到 10 次即可。", type: "battle_count", target: 10, rewardGold: 400, rewardExp: 160, rewardDiamond: 0, rewardItemId: "ce6f0608-2750-47b4-aa26-14d9c1aa0f4c", sortOrder: 80, groupKey: "seed_v1" },
      { cadence: "onboarding", title: "成功連擊3次", description: "建議使用匕首，連擊率最高；搭配高 AGI 會更容易累積連擊。", type: "combo_count", target: 3, rewardGold: 220, rewardExp: 100, rewardDiamond: 0, rewardItemId: "421196aa-83e4-4f2e-82f6-dc05077b115a", sortOrder: 90, groupKey: "seed_v1" },
      { cadence: "onboarding", title: "成功迴避3次", description: "提升 AGI，或使用弓這類偏閃躲的配置來提高迴避機會。", type: "dodge_count", target: 3, rewardGold: 220, rewardExp: 100, rewardDiamond: 0, rewardItemId: "d95a76a8-79ab-4dc7-ab07-82a39dbb5912", sortOrder: 100, groupKey: "seed_v1" },
      { cadence: "onboarding", title: "成功格擋3次", description: "裝備盾牌即可格擋；若想兼顧格擋後反擊，建議單手劍 + 盾。", type: "block_count", target: 3, rewardGold: 220, rewardExp: 100, rewardDiamond: 0, rewardItemId: "6da9f4e6-aac1-4088-9000-7111fd4926b0", sortOrder: 110, groupKey: "seed_v1" },
      { cadence: "onboarding", title: "成功擊暈3次", description: "建議使用槌類武器，尤其是雙手槌，擊暈機率更高。", type: "stun_count", target: 3, rewardGold: 260, rewardExp: 120, rewardDiamond: 0, rewardItemId: "2fcf7576-4e74-4280-b1e6-0d7da7b58dda", sortOrder: 120, groupKey: "seed_v1" },
      { cadence: "onboarding", title: "角色死亡3次", description: "在戰鬥中累積死亡 3 次即可。", type: "death_count", target: 3, rewardGold: 260, rewardExp: 120, rewardDiamond: 0, rewardItemId: "33d319ec-cb62-4826-8bcc-82a6fe52b8fa", sortOrder: 130, groupKey: "seed_v1" },
      { cadence: "onboarding", title: "達成 Lv.10 並獲得職業徽章", description: "升到 Lv.10，並獲得任一職業徽章即可完成。", type: "level_10_job_badge", target: 1, rewardGold: 300, rewardExp: 150, rewardDiamond: 0, rewardItemId: null, sortOrder: 140, groupKey: "seed_v1", claimOnce: true },
      { cadence: "onboarding", title: "成功連擊20次", description: "同樣建議用匕首，配合高 AGI 與持續輸出，較容易把連擊堆高。", type: "combo_count", target: 20, rewardGold: 500, rewardExp: 220, rewardDiamond: 0, rewardItemId: "44bda7cc-5b9e-4ce1-95cc-c4a7a413d8cf", sortOrder: 150, groupKey: "seed_v1" },
      { cadence: "onboarding", title: "完成全部新手任務", description: "完成前面所有新手任務後，再回來領取最終獎勵。", type: "onboarding_complete_count", target: 1, rewardGold: 0, rewardExp: 0, rewardDiamond: 0, rewardItemId: "87b281be-b175-40a0-8044-0accc88a0ee0", sortOrder: 160, groupKey: "seed_v1" },

      // job (10)
      { cadence: "job", title: "劍士試煉", description: "出現條件：Lv.10，基礎 STR > 10。進度武器：單手劍或雙手劍；使用指定武器出戰 10 次才會累積。獎勵：500 金幣與劍士徽章。", type: "battle_with_sword", target: 10, rewardGold: 500, rewardExp: 0, rewardDiamond: 0, rewardItemId: "job_swordsman_v1", sortOrder: 10, groupKey: "job_seed_v1", unlockLevel: 10, unlockWeaponTypes: ["sword_1h", "sword_2h"], unlockAttribute: "str", unlockAttributeMin: 10, hideIfRewardOwned: true },
      { cadence: "job", title: "戰士試煉", description: "出現條件：Lv.10，基礎 STR > 10。進度武器：單手斧或雙手斧；使用指定武器出戰 10 次才會累積。獎勵：500 金幣與戰士徽章。", type: "battle_with_axe", target: 10, rewardGold: 500, rewardExp: 0, rewardDiamond: 0, rewardItemId: "job_warrior_v1", sortOrder: 20, groupKey: "job_seed_v1", unlockLevel: 10, unlockWeaponTypes: ["axe_1h", "axe_2h"], unlockAttribute: "str", unlockAttributeMin: 10, hideIfRewardOwned: true },
      { cadence: "job", title: "矮人戰士試煉", description: "出現條件：Lv.10，基礎 VIT > 10。進度武器：單手槌或雙手槌；使用指定武器出戰 10 次才會累積。獎勵：500 金幣與矮人戰士徽章。", type: "battle_with_mace", target: 10, rewardGold: 500, rewardExp: 0, rewardDiamond: 0, rewardItemId: "job_dwarf_warrior_v1", sortOrder: 30, groupKey: "job_seed_v1", unlockLevel: 10, unlockWeaponTypes: ["mace_1h", "mace_2h"], unlockAttribute: "vit", unlockAttributeMin: 10, hideIfRewardOwned: true },
      { cadence: "job", title: "盜賊試煉", description: "出現條件：Lv.10，基礎 AGI > 10。進度武器：匕首；使用指定武器出戰 10 次才會累積。獎勵：500 金幣與盜賊徽章。", type: "battle_with_dagger", target: 10, rewardGold: 500, rewardExp: 0, rewardDiamond: 0, rewardItemId: "job_rogue_v1", sortOrder: 40, groupKey: "job_seed_v1", unlockLevel: 10, unlockWeaponTypes: ["dagger"], unlockAttribute: "agi", unlockAttributeMin: 10, hideIfRewardOwned: true },
      { cadence: "job", title: "法師試煉", description: "出現條件：Lv.10，基礎 INT > 10。進度武器：雙手法杖；使用指定武器出戰 10 次才會累積。獎勵：500 金幣與法師徽章。", type: "battle_with_staff", target: 10, rewardGold: 500, rewardExp: 0, rewardDiamond: 0, rewardItemId: "job_mage_v1", sortOrder: 50, groupKey: "job_seed_v1", unlockLevel: 10, unlockWeaponTypes: ["staff_2h"], unlockAttribute: "int", unlockAttributeMin: 10, hideIfRewardOwned: true },
      { cadence: "job", title: "治療師試煉", description: "出現條件：Lv.10，基礎 INT > 10。進度武器：單手法杖；使用指定武器出戰 10 次才會累積。獎勵：500 金幣與治療師徽章。", type: "battle_with_staff", target: 10, rewardGold: 500, rewardExp: 0, rewardDiamond: 0, rewardItemId: "job_healer_v1", sortOrder: 60, groupKey: "job_seed_v1", unlockLevel: 10, unlockWeaponTypes: ["staff_1h"], unlockAttribute: "int", unlockAttributeMin: 10, hideIfRewardOwned: true },
      { cadence: "job", title: "弓箭手試煉", description: "出現條件：Lv.10，基礎 DEX > 10。進度武器：弓；使用指定武器出戰 10 次才會累積。獎勵：500 金幣與弓箭手徽章。", type: "battle_with_bow", target: 10, rewardGold: 500, rewardExp: 0, rewardDiamond: 0, rewardItemId: "job_archer_v1", sortOrder: 70, groupKey: "job_seed_v1", unlockLevel: 10, unlockWeaponTypes: ["bow"], unlockAttribute: "dex", unlockAttributeMin: 10, hideIfRewardOwned: true },
      { cadence: "job", title: "軍師試煉", description: "出現條件：Lv.10，基礎 AGI > 10。進度武器：單手劍；使用指定武器出戰 10 次才會累積。獎勵：500 金幣與軍師徽章。", type: "battle_with_sword", target: 10, rewardGold: 500, rewardExp: 0, rewardDiamond: 0, rewardItemId: "job_tactician_v1", sortOrder: 80, groupKey: "job_seed_v1", unlockLevel: 10, unlockWeaponTypes: ["sword_1h"], unlockAttribute: "agi", unlockAttributeMin: 10, hideIfRewardOwned: true },
      { cadence: "job", title: "詩人試煉", description: "出現條件：Lv.10，基礎 DEX > 10。進度武器：弓；使用指定武器出戰 10 次才會累積。獎勵：500 金幣與詩人徽章。", type: "battle_with_bow", target: 10, rewardGold: 500, rewardExp: 0, rewardDiamond: 0, rewardItemId: "job_bard_v1", sortOrder: 90, groupKey: "job_seed_v1", unlockLevel: 10, unlockWeaponTypes: ["bow"], unlockAttribute: "dex", unlockAttributeMin: 10, hideIfRewardOwned: true },
      { cadence: "job", title: "結界師試煉", description: "出現條件：Lv.10，基礎 INT > 10。進度武器：單手法杖或雙手法杖；使用指定武器出戰 10 次才會累積。獎勵：500 金幣與結界師徽章。", type: "battle_with_staff", target: 10, rewardGold: 500, rewardExp: 0, rewardDiamond: 0, rewardItemId: "job_barrier_mage_v1", sortOrder: 100, groupKey: "job_seed_v1", unlockLevel: 10, unlockWeaponTypes: ["staff_1h", "staff_2h"], unlockAttribute: "int", unlockAttributeMin: 10, hideIfRewardOwned: true },

      // daily (4)
      { cadence: "daily", title: "每日出戰 5 次", type: "battle_count", target: 5, rewardGold: 250, rewardExp: 120, rewardDiamond: 0, sortOrder: 10, groupKey: "seed_v1" },
      { cadence: "daily", title: "每日贏得 3 場", type: "battle_win", target: 3, rewardGold: 300, rewardExp: 140, rewardDiamond: 0, sortOrder: 20, groupKey: "seed_v1" },
      { cadence: "daily", title: "每日累計 3000 傷害", type: "damage_total", target: 3000, rewardGold: 320, rewardExp: 160, rewardDiamond: 0, sortOrder: 30, groupKey: "seed_v1" },
      { cadence: "daily", title: "每日完成打卡", type: "checkin_count", target: 1, rewardGold: 180, rewardExp: 100, rewardDiamond: 0, sortOrder: 40, groupKey: "seed_v1" },

      // weekly (6)
      { cadence: "weekly", title: "每週出戰 30 次", type: "battle_count", target: 30, rewardGold: 1200, rewardExp: 500, rewardDiamond: 0, sortOrder: 10, groupKey: "seed_v1" },
      { cadence: "weekly", title: "每週贏得 20 場", type: "battle_win", target: 20, rewardGold: 1500, rewardExp: 700, rewardDiamond: 0, rewardItemId: null, sortOrder: 20, groupKey: "seed_v1" },
      { cadence: "weekly", title: "每週累計 50000 傷害", type: "damage_total", target: 50000, rewardGold: 1800, rewardExp: 900, rewardDiamond: 0, sortOrder: 30, groupKey: "seed_v1" },
      { cadence: "weekly", title: "每週完成 5 次打卡", type: "checkin_count", target: 5, rewardGold: 1000, rewardExp: 420, rewardDiamond: 0, sortOrder: 40, groupKey: "seed_v1" },
      { cadence: "weekly", title: "每週裝備 10 次", type: "equip_count", target: 10, rewardGold: 1200, rewardExp: 600, rewardDiamond: 0, sortOrder: 50, groupKey: "seed_v1" },
      { cadence: "weekly", title: "每週完成 3 次強化", type: "enhance_count", target: 3, rewardGold: 1400, rewardExp: 700, rewardDiamond: 0, sortOrder: 60, groupKey: "seed_v1" },
      { cadence: "weekly", title: "完成全部每週任務", type: "weekly_complete_count", target: 1, rewardGold: 0, rewardExp: 0, rewardDiamond: 0, rewardItemId: "87b281be-b175-40a0-8044-0accc88a0ee0", sortOrder: 70, groupKey: "seed_v1" }
    ];

    const existing = await this.listDefinitions("all");
    const existingMap = new Map(existing.map((q) => [`${q.cadence}|${q.title}|${q.type}`, q]));
    const created = [];
    for (const def of defaults) {
      const key = `${def.cadence}|${def.title}|${def.type}`;
      const existingQuest = existingMap.get(key) || null;
      if (existingQuest) {
        if (def.claimOnce && !existingQuest.claimOnce) {
          await this.updateDefinition(existingQuest.id, { claimOnce: true });
        }
        continue;
      }
      const row = await this.createDefinition({
        ...def,
        enabled: true,
        levelLimit: 0,
        resetPolicy: resetPolicyByCadence(def.cadence)
      });
      created.push(row);
    }
    return { createdCount: created.length, created };
  }
}

module.exports = {
  WeeklyQuestService,
  QUEST_TYPES,
  QUEST_CADENCES,
  normalizeCadence,
  resolvePeriodKey,
  currentDayLabel,
  currentWeekLabel
};
