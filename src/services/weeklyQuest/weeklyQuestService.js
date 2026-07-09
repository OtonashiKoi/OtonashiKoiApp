"use strict";

const QUEST_CADENCES = ["onboarding", "job", "daily", "weekly", "season"];
const QUEST_TYPES = {
  battle_count:      { label: "出戰次數",        unit: "次" },
  battle_with_sword: { label: "使用劍系出戰次數", unit: "次" },
  battle_with_axe:   { label: "使用斧系出戰次數", unit: "次" },
  battle_with_mace:  { label: "使用槌系出戰次數", unit: "次" },
  battle_with_dagger:{ label: "使用匕首出戰次數", unit: "次" },
  battle_with_staff: { label: "使用法杖出戰次數", unit: "次" },
  battle_with_bow:   { label: "使用弓出戰次數",   unit: "次" },
  battle_with_support_job: { label: "用輔助職業出戰次數", unit: "次" },
  battle_win:        { label: "戰鬥勝利次數",     unit: "次" },
  damage_total:      { label: "累計造成傷害",     unit: "點" },
  damage_taken:      { label: "累計承受傷害",     unit: "點" },
  heal_done:         { label: "累計回血量",       unit: "點" },
  checkin_streak:    { label: "連續簽到天數",     unit: "天" },
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
  kill_slime_king:   { label: "擊敗大史王 次數",     unit: "次" },
  kill_dragon_king:  { label: "擊敗古龍王(B) 次數", unit: "次" },
  kill_hellfang_king:{ label: "擊敗地獄狼牙王 次數", unit: "次" },
  enhance_a5_count:  { label: "A 裝強化至 +5 累積", unit: "件" },
};

const CADENCE_ORDER = { onboarding: 1, job: 2, daily: 3, weekly: 4, season: 5 };
const VALID_UNLOCK_ATTRS = ["str", "agi", "vit", "int", "dex", "luk"];

function normalizeUnlockAttributes(def = {}) {
  const raw = Array.isArray(def.unlockAttributes) && def.unlockAttributes.length > 0
    ? def.unlockAttributes
    : [
      def.unlockAttribute,
      def.unlockAttribute2
    ];
  const normalized = raw
    .map((attr) => String(attr || "").trim().toLowerCase())
    .filter((attr, index, arr) => VALID_UNLOCK_ATTRS.includes(attr) && arr.indexOf(attr) === index);
  return normalized;
}

function getUnlockAttributeTotal(quest, attributes = {}) {
  const unlockAttributes = Array.isArray(quest?.unlockAttributes) && quest.unlockAttributes.length > 0
    ? quest.unlockAttributes
    : normalizeUnlockAttributes(quest);
  return unlockAttributes.reduce((sum, attr) => sum + Number(attributes?.[attr] || 0), 0);
}

function normalizeCadence(cadence) {
  return QUEST_CADENCES.includes(cadence) ? cadence : "weekly";
}

function resetPolicyByCadence(cadence) {
  if (cadence === "onboarding") return "once";
  if (cadence === "job") return "once";
  if (cadence === "season") return "once";
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
  if (c === "season") return "season-v1";
  if (c === "daily") return currentDayLabel();
  return currentWeekLabel();
}

function isJobBadgeItemId(itemId) {
  return String(itemId || "").toLowerCase().startsWith("job_");
}

class WeeklyQuestService {
  constructor(weeklyQuestRepository, playerService, options = {}) {
    this.repo = weeklyQuestRepository;
    this.playerService = playerService;
    // 用來判定「實際已綁定直播 / 已打卡」,讓對應新手任務反映真實狀態(不只靠事件計數)
    this.streamAccountBindingRepository = options.streamAccountBindingRepository || null;
    this.checkinRepository = options.checkinRepository || null;
    this.itemRepository = options.itemRepository || null; // 解析獎勵道具名稱用
    this._rewardItemNameCache = null;
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
    const unlockAttributes = normalizeUnlockAttributes(def);
    const unlockAttribute = unlockAttributes[0] || null;
    const unlockAttribute2 = unlockAttributes[1] || null;
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
      unlockAttributes,
      unlockAttribute,
      unlockAttribute2,
      unlockAttributeMin: Math.max(0, Number(def?.unlockAttributeMin || 0)),
      // 隱藏 gate：玩家必須「全部擁有」這些 itemId(背包或已裝備)才看得到/才累積。
      // 用於「集齊全部輔助職徽章才解鎖的隱藏賽季任務」。
      unlockRequireItemIds: Array.isArray(def?.unlockRequireItemIds)
        ? def.unlockRequireItemIds.map((v) => String(v || "").trim()).filter(Boolean)
        : [],
      // 錨點隱藏任務 gate：累積進度達 N 才現身(解鎖後重數)、本季有斗內、連續簽到達 N 天
      unlockProgressAtLeast: Math.max(0, Number(def?.unlockProgressAtLeast || 0)),
      unlockRequireSeasonDonation: Boolean(def?.unlockRequireSeasonDonation),
      unlockCheckinStreak: Math.max(0, Number(def?.unlockCheckinStreak || 0)),
      hideIfRewardOwned: def?.hideIfRewardOwned !== false,
      claimOnce: Boolean(def?.claimOnce)
    };
  }

  // 玩家是否「全部擁有」quest.unlockRequireItemIds（背包 ∪ 已裝備）
  _hasAllRequiredItems(quest, context) {
    const need = Array.isArray(quest?.unlockRequireItemIds) ? quest.unlockRequireItemIds : [];
    if (need.length === 0) return true;
    const inv = context?.inventoryItemIds instanceof Set ? context.inventoryItemIds : new Set();
    const eq = context?.equippedItemIds instanceof Set ? context.equippedItemIds : new Set();
    return need.every((id) => inv.has(id) || eq.has(id));
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

    // 實際狀態:是否已綁定直播 / 是否曾打卡(讓對應新手任務反映真實狀態)
    let hasStreamBinding = false;
    let hasCheckin = false;
    if (this.streamAccountBindingRepository?.listByDiscordId) {
      try {
        const bindings = await this.streamAccountBindingRepository.listByDiscordId(discordId);
        hasStreamBinding = Array.isArray(bindings) && bindings.length > 0;
      } catch (_) { /* ignore */ }
    }
    if (this.checkinRepository?.findLastByDiscordId) {
      try {
        const last = await this.checkinRepository.findLastByDiscordId(discordId);
        hasCheckin = Boolean(last);
      } catch (_) { /* ignore */ }
    }

    // 錨點任務 gate 資料：本季斗內(donationLedger 累積>0)、連續簽到天數(由近期簽到算)
    let hasSeasonDonation = false;
    let checkinStreak = 0;
    try {
      const { getMongoDb } = require("../../adapters/mongo/createMongoClient");
      const db = await getMongoDb();
      const led = await db.collection("donationLedger").findOne({ discordId: String(discordId) }, { projection: { totalTwd: 1 } });
      hasSeasonDonation = Number(led?.totalTwd || 0) > 0;
    } catch (_) { /* ignore */ }
    if (this.checkinRepository?.listRecentByDiscordId) {
      try {
        const recent = await this.checkinRepository.listRecentByDiscordId(discordId, 60);
        const twDay = (t) => { const d = new Date(t); return Number.isNaN(d.getTime()) ? null : new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10); };
        const days = [...new Set((recent || []).map((c) => twDay(c.occurredAt || c.createdAt || c.at)).filter(Boolean))].sort().reverse();
        if (days.length) {
          checkinStreak = 1;
          for (let i = 1; i < days.length; i++) {
            const prev = Date.parse(days[i - 1] + "T00:00:00Z");
            const cur = Date.parse(days[i] + "T00:00:00Z");
            if (prev - cur === 86400000) checkinStreak++; else break;
          }
        }
      } catch (_) { /* ignore */ }
    }

      return {
        level,
        attributes,
        equipment,
        inventory,
        hasStreamBinding,
        hasCheckin,
        hasSeasonDonation,
        checkinStreak,
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
    if (!this._hasAllRequiredItems(quest, context)) return false;
    if (Array.isArray(quest.unlockWeaponTypes) && quest.unlockWeaponTypes.length > 0) {
      const weaponType = String(context?.weaponType || "");
      if (!quest.unlockWeaponTypes.includes(weaponType)) return false;
    }
    if ((quest.unlockAttributes && quest.unlockAttributes.length > 0) || quest.unlockAttribute) {
      const total = getUnlockAttributeTotal(quest, context?.attributes || {});
      if (!(total > Number(quest.unlockAttributeMin || 0))) return false;
    }
    return true;
  }

  _isQuestVisibleForPlayer(quest, context) {
    if (!quest?.enabled) return false;
    const level = Number(context?.level || 1);
    if (quest.levelLimit && quest.levelLimit > level) return false;
    if (quest.unlockLevel && level < Number(quest.unlockLevel || 0)) return false;
    // 隱藏 gate：未集齊指定道具(如全部輔助職徽章) → 這任務完全不顯示
    if (!this._hasAllRequiredItems(quest, context)) return false;

    if ((quest.unlockAttributes && quest.unlockAttributes.length > 0) || quest.unlockAttribute) {
      const total = getUnlockAttributeTotal(quest, context?.attributes || {});
      if (!(total > Number(quest.unlockAttributeMin || 0))) return false;
    }

    return true;
  }

  // 錨點隱藏任務綜合解鎖判定：既有 gate(等級/屬性/道具) + 累積進度門檻 / 本季斗內 / 連續簽到
  //   current = 該任務的「原始累積值」(未做解鎖後重數的偏移)
  _isQuestUnlocked(quest, current, context) {
    if (!this._isQuestVisibleForPlayer(quest, context)) return false;
    if (quest.unlockRequireSeasonDonation && !context?.hasSeasonDonation) return false;
    if (Number(quest.unlockProgressAtLeast) > 0 && Number(current || 0) < Number(quest.unlockProgressAtLeast)) return false;
    if (Number(quest.unlockCheckinStreak) > 0 && Number(context?.checkinStreak || 0) < Number(quest.unlockCheckinStreak)) return false;
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
    // 時間管理大師：進度＝目前連續簽到天數（靜態，不靠戰鬥累積）
    if (quest.type === "checkin_streak") {
      return { current: Number(context?.checkinStreak || 0), target: Math.max(1, Number(quest.target || 1)) };
    }
    if (quest.type === "level_10_job_badge") {
      const level = Number(context?.level || 1);
      const hasJobBadge = Boolean(context?.hasJobBadge);
      return {
        current: level >= 10 && hasJobBadge ? 1 : 0,
        target: 1
      };
    }
    // 新手任務「完成直播綁定 / 完成 1 次打卡」:以「實際是否已綁定/已打卡」為準,
    // 避免已綁定/已打卡的玩家因事件計數沒累積而卡在進行中(只覆蓋 onboarding 的單次任務)
    if (quest.cadence === "onboarding" && Number(quest.target || 1) <= 1) {
      if (quest.type === "stream_bind_count") {
        return { current: context?.hasStreamBinding ? 1 : 0, target: 1 };
      }
      if (quest.type === "checkin_count") {
        return { current: context?.hasCheckin ? 1 : 0, target: 1 };
      }
    }
    return null;
  }

  // 解析獎勵道具 id → 名稱(快取一份 id→name,避免每次都掃全表)
  async _attachRewardItemNames(defs) {
    const ids = [...new Set(defs.map((d) => d.rewardItemId).filter(Boolean).map(String))];
    if (ids.length === 0 || !this.itemRepository?.findAll) return defs;
    if (!this._rewardItemNameCache) {
      try {
        const all = await this.itemRepository.findAll();
        this._rewardItemNameCache = new Map((all || []).map((it) => [String(it.id), it.name || it.itemName || null]));
      } catch (_) { this._rewardItemNameCache = new Map(); }
    }
    return defs.map((d) => (d.rewardItemId
      ? { ...d, rewardItemName: this._rewardItemNameCache.get(String(d.rewardItemId)) || null }
      : d));
  }

  async listDefinitions(cadence = "all") {
    const all = (await this.repo.listQuests()).map((q) => this._normalizeDefinition(q));
    const enriched = await this._attachRewardItemNames(all);
    if (cadence && cadence !== "all") {
      const c = normalizeCadence(cadence);
      return this._sortDefinitions(enriched.filter((q) => q.cadence === c));
    }
    return this._sortDefinitions(enriched);
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
      unlockAttributes: fields?.unlockAttributes || [],
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
      unlockAttributes: fields?.unlockAttributes !== undefined ? fields.unlockAttributes : (quest.unlockAttributes || []),
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
    // 職業任務:未達解鎖條件也保留(前端顯示為鎖定灰色),其餘 cadence 維持原本「未解鎖就隱藏」
    const defs = allDefs.filter((q) => {
      if (!q?.enabled) return false;
      if (this._isQuestVisibleForPlayer(q, context)) return true;
      return c === "job";
    });
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
      // 鎖定資訊:職業任務未達 Lv/屬性條件時 locked=true,前端顯示灰色「Lv.N 解鎖」,不可領取/累積
      const locked = !this._isQuestUnlocked(quest, current, context);
      // 解鎖後重數：目標其實是 2X，任務頁只顯示「解鎖後的進度」(current−門檻)/(target−門檻)
      const thr = Number(quest.unlockProgressAtLeast || 0);
      const dispCurrent = thr > 0 ? Math.max(0, current - thr) : current;
      const dispTarget = thr > 0 ? Math.max(1, target - thr) : target;
      let unlockHint = null;
      if (locked) {
        if (quest.unlockLevel) unlockHint = `Lv.${quest.unlockLevel} 解鎖`;
        else if (quest.unlockRequireSeasonDonation) unlockHint = "本季斗內後解鎖";
        else if (quest.unlockCheckinStreak) unlockHint = `連續簽到 ${quest.unlockCheckinStreak} 天解鎖`;
        else if (thr > 0) unlockHint = "隱藏任務（達成條件後現身）";
        else unlockHint = "尚未解鎖";
      }
      return {
        cadence: c,
        periodKey,
        quest,
        current: dispCurrent,
        target: dispTarget, // 動態 target（完成型任務 = 基礎任務總數）；前端顯示分母用,別再用 quest.target
        claimed: Boolean(p.claimed || (quest.claimOnce && p.claimedOnce)),
        done: locked ? false : current >= target,
        locked,
        unlockLevel: Number(quest.unlockLevel || 0),
        unlockHint
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

  async claimReward(discordId, questId, grantFn = null) {
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
      // 錨點隱藏任務 gate：未解鎖(進度門檻/本季斗內/連續簽到) → 不可領取（防以 questId 直接領）
      const _rawForGate = this._resolveStaticQuestProgress(quest, context)?.current ?? Number(p.current || 0);
      if (!this._isQuestUnlocked(quest, _rawForGate, context)) throw new Error("任務尚未解鎖");
      if (quest.type === "onboarding_complete_count" || quest.type === "weekly_complete_count") {
        const targetCadence = quest.cadence === "weekly" ? "weekly" : "onboarding";
        const cadenceDefs = (await this.listDefinitions(targetCadence))
          .filter((q) => this._isQuestVisibleForPlayer(q, context) || Boolean((playerPeriod[q.id] || {}).claimed));
        const completion = this._computeCompletionProgress(cadenceDefs, playerPeriod, quest.type);
        if (completion.current < completion.target) throw new Error("任務尚未完成");
        p.current = completion.current;
      } else {
        // 有「實際狀態」型進度(等級+徽章 / 已綁定 / 已打卡)就以它為準,否則看累積計數
        const staticProgress = this._resolveStaticQuestProgress(quest, context);
        if (staticProgress) {
          p.current = staticProgress.current;
          if (p.current < staticProgress.target) throw new Error("任務尚未完成");
        } else if (Number(p.current || 0) < Number(quest.target || 1)) {
          throw new Error("任務尚未完成");
        }
      }
      if (p.claimed || (quest.claimOnce && p.claimedOnce)) throw new Error("獎勵已領取");

      const reward = {
        questTitle: quest.title,
        gold: Number(quest.rewardGold || 0),
        exp: Number(quest.rewardExp || 0),
        diamond: 0,
        rewardItemId: quest.rewardItemId || null,
        rewardItems: Array.isArray(quest.rewardItems) ? quest.rewardItems : [],
        cadence: quest.cadence,
        periodKey
      };

      // 先發獎（仍在鎖內、標記 claimed 之前）：發獎失敗就不標記，玩家可重新領取，避免領了卻沒拿到獎勵
      if (typeof grantFn === "function") {
        await grantFn(reward);
      }

      p.claimed = true;
      if (quest.claimOnce) {
        p.claimedOnce = true;
        p.claimedAt = p.claimedAt || new Date().toISOString();
      }
      playerPeriod[questId] = p;
      await this.repo.savePlayerProgress(discordId, periodKey, playerPeriod, quest.cadence);

      // 領到傳說錨點 → 聊天大廳廣播（每件錨點各自一句台詞）
      const ANCHOR_INFO = {
        "s-legend-bond":    { name: "繫絆・共鳴之鏈",       flavor: "羈絆化為力量，輔助者的證明！" },
        "s-legend-burst":   { name: "驟・先機之刃",         flavor: "先手制敵，鋒芒畢露！" },
        "s-legend-linger":  { name: "滯・後勢之刃",         flavor: "後發制人，越戰越強！" },
        "s-legend-dice":    { name: "骰・命運之輪",         flavor: "命運眷顧，孤注一擲！" },
        "s-legend-endure":  { name: "沒苦硬吃",             flavor: "硬撐到底，痛過才知強！" },
        "s-legend-saint":   { name: "聖人就是比拳頭大小",   flavor: "以拳傳道，聖人降臨！" },
        "s-legend-thirst":  { name: "對鮮血的渴望",         flavor: "浸透鮮血，嗜血成性！" },
        "s-legend-timelord":{ name: "時間管理大師",         flavor: "掌控時間者，加冕於此！" },
      };
      const _anchorInfo = reward.rewardItemId && ANCHOR_INFO[reward.rewardItemId];
      if (_anchorInfo) {
        const tc = require("../../shared/announceTownChat");
        const who = await tc.resolveDiscordName(discordId).catch(() => "某位勇者");
        tc.announceTownChat(
          `🔱✨ **${who}** 完成了隱藏試煉「${quest.title}」，獲得傳說錨點【**${_anchorInfo.name}**】！${_anchorInfo.flavor}`
        ).catch(() => {});
      }

      return reward;
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
      { cadence: "job", title: "劍士試煉", description: "出現條件：Lv.10，基礎 STR + DEX > 10。進度武器：單手劍或雙手劍；使用指定武器出戰 10 次才會累積。獎勵：500 金幣與劍士徽章。", type: "battle_with_sword", target: 10, rewardGold: 500, rewardExp: 0, rewardDiamond: 0, rewardItemId: "job_swordsman_v1", sortOrder: 10, groupKey: "job_seed_v1", unlockLevel: 10, unlockWeaponTypes: ["sword_1h", "sword_2h"], unlockAttributes: ["str", "dex"], unlockAttributeMin: 10, hideIfRewardOwned: true },
      { cadence: "job", title: "戰士試煉", description: "出現條件：Lv.10，基礎 STR + VIT > 10。進度武器：單手斧或雙手斧；使用指定武器出戰 10 次才會累積。獎勵：500 金幣與戰士徽章。", type: "battle_with_axe", target: 10, rewardGold: 500, rewardExp: 0, rewardDiamond: 0, rewardItemId: "job_warrior_v1", sortOrder: 20, groupKey: "job_seed_v1", unlockLevel: 10, unlockWeaponTypes: ["axe_1h", "axe_2h"], unlockAttributes: ["str", "vit"], unlockAttributeMin: 10, hideIfRewardOwned: true },
      { cadence: "job", title: "矮人戰士試煉", description: "出現條件：Lv.10，基礎 VIT + STR > 10。進度武器：單手槌或雙手槌；使用指定武器出戰 10 次才會累積。獎勵：500 金幣與矮人戰士徽章。", type: "battle_with_mace", target: 10, rewardGold: 500, rewardExp: 0, rewardDiamond: 0, rewardItemId: "job_dwarf_warrior_v1", sortOrder: 30, groupKey: "job_seed_v1", unlockLevel: 10, unlockWeaponTypes: ["mace_1h", "mace_2h"], unlockAttributes: ["vit", "str"], unlockAttributeMin: 10, hideIfRewardOwned: true },
      { cadence: "job", title: "盜賊試煉", description: "出現條件：Lv.10，基礎 AGI + DEX > 10。進度武器：匕首；使用指定武器出戰 10 次才會累積。獎勵：500 金幣與盜賊徽章。", type: "battle_with_dagger", target: 10, rewardGold: 500, rewardExp: 0, rewardDiamond: 0, rewardItemId: "job_rogue_v1", sortOrder: 40, groupKey: "job_seed_v1", unlockLevel: 10, unlockWeaponTypes: ["dagger"], unlockAttributes: ["agi", "dex"], unlockAttributeMin: 10, hideIfRewardOwned: true },
      { cadence: "job", title: "法師試煉", description: "出現條件：Lv.10，基礎 INT + AGI > 10。進度武器：雙手法杖；使用指定武器出戰 10 次才會累積。獎勵：500 金幣與法師徽章。", type: "battle_with_staff", target: 10, rewardGold: 500, rewardExp: 0, rewardDiamond: 0, rewardItemId: "job_mage_v1", sortOrder: 50, groupKey: "job_seed_v1", unlockLevel: 10, unlockWeaponTypes: ["staff_2h"], unlockAttributes: ["int", "agi"], unlockAttributeMin: 10, hideIfRewardOwned: true },
      { cadence: "job", title: "治療師試煉", description: "出現條件：Lv.10，基礎 INT + VIT > 10。進度武器：單手法杖；使用指定武器出戰 10 次才會累積。獎勵：500 金幣與治療師徽章。", type: "battle_with_staff", target: 10, rewardGold: 500, rewardExp: 0, rewardDiamond: 0, rewardItemId: "job_healer_v1", sortOrder: 60, groupKey: "job_seed_v1", unlockLevel: 10, unlockWeaponTypes: ["staff_1h"], unlockAttributes: ["int", "vit"], unlockAttributeMin: 10, hideIfRewardOwned: true },
      { cadence: "job", title: "弓箭手試煉", description: "出現條件：Lv.10，基礎 DEX + AGI > 10。進度武器：弓；使用指定武器出戰 10 次才會累積。獎勵：500 金幣與弓箭手徽章。", type: "battle_with_bow", target: 10, rewardGold: 500, rewardExp: 0, rewardDiamond: 0, rewardItemId: "job_archer_v1", sortOrder: 70, groupKey: "job_seed_v1", unlockLevel: 10, unlockWeaponTypes: ["bow"], unlockAttributes: ["dex", "agi"], unlockAttributeMin: 10, hideIfRewardOwned: true },
      { cadence: "job", title: "軍師試煉", description: "出現條件：Lv.10，基礎 AGI + INT + DEX > 10。進度武器：單手劍；使用指定武器出戰 10 次才會累積。獎勵：500 金幣與軍師徽章。", type: "battle_with_sword", target: 10, rewardGold: 500, rewardExp: 0, rewardDiamond: 0, rewardItemId: "job_tactician_v1", sortOrder: 80, groupKey: "job_seed_v1", unlockLevel: 10, unlockWeaponTypes: ["sword_1h"], unlockAttributes: ["agi", "int", "dex"], unlockAttributeMin: 10, hideIfRewardOwned: true },
      { cadence: "job", title: "詩人試煉", description: "出現條件：Lv.10，基礎 DEX + AGI + LUK > 10。進度武器：弓；使用指定武器出戰 10 次才會累積。獎勵：500 金幣與詩人徽章。", type: "battle_with_bow", target: 10, rewardGold: 500, rewardExp: 0, rewardDiamond: 0, rewardItemId: "job_bard_v1", sortOrder: 90, groupKey: "job_seed_v1", unlockLevel: 10, unlockWeaponTypes: ["bow"], unlockAttributes: ["dex", "agi", "luk"], unlockAttributeMin: 10, hideIfRewardOwned: true },
      { cadence: "job", title: "結界師試煉", description: "出現條件：Lv.10，基礎 INT + VIT + DEX > 10。進度武器：單手法杖或雙手法杖；使用指定武器出戰 10 次才會累積。獎勵：500 金幣與結界師徽章。", type: "battle_with_staff", target: 10, rewardGold: 500, rewardExp: 0, rewardDiamond: 0, rewardItemId: "job_barrier_mage_v1", sortOrder: 100, groupKey: "job_seed_v1", unlockLevel: 10, unlockWeaponTypes: ["staff_1h", "staff_2h"], unlockAttributes: ["int", "vit", "dex"], unlockAttributeMin: 10, hideIfRewardOwned: true },

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
