const crypto = require("crypto");
const { AppError, ERROR_CODES } = require("../../shared/errors");
const { CURRENCY_SOURCES, EXP_SOURCES } = require("../../shared/sources");
const { notifyPlayer } = require("../realtime/playerNotifyService");
const {
  ZONE_BY_KEY,
  featureKeyToZone,
  checkZoneLevelRequirementWithBinding
} = require("../../shared/zones");
const { isWorldBossZone } = require("../worldBoss/worldBossService");

// 掛機領取「專用」序列鎖：必須與 progress lock 分開。
// 領取流程內部會呼叫 grantExp（grantExp 本身會取得 progress lock），
// 若這裡也用同一把 progress lock 就會「重入死鎖」→ 領取永遠卡住領不出來。
const idleClaimLocks = new Map();
async function withIdleClaimLock(key, fn) {
  const currentLock = idleClaimLocks.get(key) || Promise.resolve();
  let releaseNext;
  const nextLock = new Promise((resolve) => { releaseNext = resolve; });
  const chainedLock = currentLock.then(() => nextLock);
  idleClaimLocks.set(key, chainedLock);
  try {
    await currentLock;
    return await fn();
  } finally {
    releaseNext();
    if (idleClaimLocks.get(key) === chainedLock) idleClaimLocks.delete(key);
  }
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function safeIso(input, fallback = null) {
  if (!input) return fallback;
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return fallback;
  return d.toISOString();
}

// 掛機收益 = 手動收益的 10%
const IDLE_REWARD_RATIO = 0.1;
const NON_MEMBER_DAILY_IDLE_LIMIT_MINUTES = 6 * 60;

class IdleService {
  constructor({
    idleRepository,
    playerService,
    progressRepository,
    playerTierService,
    rewardService,
    progressService,
    itemRepository,
    channelLayoutRepository,
    monsterService
  }) {
    this.idleRepository = idleRepository;
    this.playerService = playerService;
    this.progressRepository = progressRepository;
    this.playerTierService = playerTierService;
    this.rewardService = rewardService;
    this.progressService = progressService;
    this.itemRepository = itemRepository;
    this.channelLayoutRepository = channelLayoutRepository;
    this.monsterService = monsterService;
  }

  async _listMonsterZoneBindings() {
    const layout = await this.channelLayoutRepository.get().catch(() => null);
    const bindings = Array.isArray(layout?.discord?.bindings) ? layout.discord.bindings : [];
    return bindings.filter((b) => b?.enabled && b.featureKey?.startsWith("monster_zone"));
  }

  async _getMonsterZoneAverageReward(zoneKey) {
    const monsters = await this.monsterService.listMonsters({ includeDisabled: false, zone: zoneKey });
    const nonBossMonsters = Array.isArray(monsters)
      ? monsters.filter((m) => !m?.isBoss)
      : [];
    if (nonBossMonsters.length === 0) {
      return {
        zoneKey,
        monsterCount: 0,
        avgGold: 0,
        avgExp: 0
      };
    }

    const totalGold = nonBossMonsters.reduce((sum, m) => sum + Math.max(0, Number(m.goldReward) || 0), 0);
    const totalExp = nonBossMonsters.reduce((sum, m) => sum + Math.max(0, Number(m.expReward) || 0), 0);
    return {
      zoneKey,
      monsterCount: nonBossMonsters.length,
      avgGold: (totalGold / nonBossMonsters.length) * IDLE_REWARD_RATIO,
      avgExp: (totalExp / nonBossMonsters.length) * IDLE_REWARD_RATIO
    };
  }

  async _buildDiscordZoneOptions(level) {
    const zoneBindings = await this._listMonsterZoneBindings();
    const options = [];
    for (const binding of zoneBindings) {
      const zoneKey = featureKeyToZone(binding.featureKey);
      const zoneDef = ZONE_BY_KEY[zoneKey] || null;
      if (!zoneDef) continue;
      if (isWorldBossZone(zoneKey)) continue; // 世界王區不可掛機，只能掛一般怪物區
      const lockedReason = checkZoneLevelRequirementWithBinding(zoneKey, level, binding);
      const reward = await this._getMonsterZoneAverageReward(zoneKey);
      options.push({
        zoneKey,
        featureKey: binding.featureKey,
        label: zoneDef.label,
        emoji: zoneDef.emoji,
        minLevel: binding.minLevel != null ? binding.minLevel : zoneDef.minLevel,
        maxLevel: binding.maxLevel !== undefined ? binding.maxLevel : zoneDef.maxLevel,
        avgGold: reward.avgGold,
        avgExp: reward.avgExp,
        monsterCount: reward.monsterCount,
        available: !lockedReason,
        lockedReason: lockedReason || null
      });
    }
    return options.sort((a, b) => (Number(a.minLevel || 1) - Number(b.minLevel || 1)));
  }

  _computeDiscordSessionSummary(session, now = new Date()) {
    const startedAt = new Date(session.startedAt);
    const elapsedMinutes = Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / 60000));
    const effectiveMinutes = Math.min(elapsedMinutes, 12 * 60); // 最多 12 小時
    // 規則：前 5 分鐘為門檻；超過後改為連續時間比例計算（不再 5 分鐘跳點）
    const rewardFactor = effectiveMinutes >= 5 ? (effectiveMinutes / 5) : 0;
    const totalGold = Math.max(0, Math.round(rewardFactor * Number(session.avgGoldPerTick || 0)));
    const totalExp = Math.max(0, Math.round(rewardFactor * Number(session.avgExpPerTick || 0)));
    return {
      elapsedMinutes,
      effectiveMinutes,
      rewardFactor,
      totalGold,
      totalExp
    };
  }

  _getTaipeiDateKey(date = new Date()) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(date);
    const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    return `${map.year}-${map.month}-${map.day}`;
  }

  _normalizeDailyClaim(dailyClaim, dateKey) {
    const normalized = dailyClaim && typeof dailyClaim === "object" ? dailyClaim : {};
    if (normalized.dateKey !== dateKey) {
      return { dateKey, nonMemberClaimedMinutes: 0 };
    }
    return {
      dateKey,
      nonMemberClaimedMinutes: Math.max(0, Math.floor(Number(normalized.nonMemberClaimedMinutes) || 0))
    };
  }

  async _resolveMembership(discordId, memberRoleIds = []) {
    if (this.playerTierService?.resolveHighestTier && Array.isArray(memberRoleIds) && memberRoleIds.length > 0) {
      const tier = await this.playerTierService.resolveHighestTier(memberRoleIds).catch(() => null);
      if (tier) return { isMember: true, tier };
    }
    const progress = await this.progressRepository.findByPlayerId(discordId).catch(() => null);
    const tier = progress?.playerTier || null;
    return { isMember: !!tier, tier };
  }

  _applyDailyLimitToSummary(summary, dailyClaimInfo) {
    if (dailyClaimInfo.isMember) {
      return {
        ...summary,
        effectiveMinutesRaw: summary.effectiveMinutes,
        dailyLimitMinutes: null,
        dailyClaimedMinutesBefore: null,
        dailyClaimedMinutesAfter: null,
        dailyRemainingMinutes: null,
        dailyCapHit: false
      };
    }

    const used = Math.max(0, Number(dailyClaimInfo.nonMemberClaimedMinutes || 0));
    const remaining = Math.max(0, NON_MEMBER_DAILY_IDLE_LIMIT_MINUTES - used);
    const rawEffective = Math.max(0, Number(summary.effectiveMinutes || 0));
    const effectiveMinutes = Math.min(rawEffective, remaining);
    const ratio = rawEffective > 0 ? (effectiveMinutes / rawEffective) : 0;
    const totalGold = Math.max(0, Math.round((Number(summary.totalGold) || 0) * ratio));
    const totalExp = Math.max(0, Math.round((Number(summary.totalExp) || 0) * ratio));

    return {
      ...summary,
      effectiveMinutesRaw: rawEffective,
      effectiveMinutes,
      totalGold,
      totalExp,
      dailyLimitMinutes: NON_MEMBER_DAILY_IDLE_LIMIT_MINUTES,
      dailyClaimedMinutesBefore: used,
      dailyClaimedMinutesAfter: used + effectiveMinutes,
      dailyRemainingMinutes: Math.max(0, NON_MEMBER_DAILY_IDLE_LIMIT_MINUTES - (used + effectiveMinutes)),
      dailyCapHit: rawEffective > effectiveMinutes
    };
  }

  // 掛機累積到頂通知（剛到 12 小時上限發一次；旗標隨 idle state 落地避免重複）
  async _maybeNotifyIdleCap(discordId, state, session, elapsedMinutes, maxMinutes, sessionField) {
    try {
      if (!session || session.capNotified) return;
      const cap = Math.max(1, Number(maxMinutes) || 0);
      if (Number(elapsedMinutes || 0) < cap) return;
      session.capNotified = true;
      await this.idleRepository.savePlayerState(discordId, {
        ...state,
        playerId: discordId,
        [sessionField]: session,
        updatedAt: new Date().toISOString()
      });
      const capHours = Math.round((cap / 60) * 10) / 10;
      notifyPlayer(discordId, {
        type: "idle_cap",
        title: "掛機收益已滿",
        message: `掛機（${session.zoneLabel || session.zoneName || "掛機區"}）已累積滿 ${capHours} 小時上限，收益不再增加，記得領取結算！`,
        meta: { zoneKey: session.zoneKey || session.zoneId || null, maxMinutes: cap }
      });
    } catch (_) { /* 通知失敗不影響查詢 */ }
  }

  async getDiscordPanelStatus(discordId, displayName = "Player", options = {}) {
    const { progress } = await this.playerService.ensurePlayer(discordId, displayName);
    const level = Number(progress?.level || 1);
    const member = await this._resolveMembership(discordId, options.memberRoleIds || []);
    const now = new Date();
    const dateKey = this._getTaipeiDateKey(now);
    const state = await this.idleRepository.findPlayerState(discordId);
    const dailyClaim = this._normalizeDailyClaim(state?.dailyClaim, dateKey);
    const zones = await this._buildDiscordZoneOptions(level);
    const session = state?.discordSession || null;
    const baseSummary = session ? this._computeDiscordSessionSummary(session, now) : null;
    if (session && baseSummary) {
      await this._maybeNotifyIdleCap(
        discordId, state, session, baseSummary.elapsedMinutes,
        Number(session.maxMinutes) || 12 * 60, "discordSession"
      );
    }
    const sessionSummary = baseSummary ? this._applyDailyLimitToSummary(baseSummary, {
      isMember: member.isMember,
      nonMemberClaimedMinutes: dailyClaim.nonMemberClaimedMinutes
    }) : null;
    return {
      level,
      zones,
      discordSession: session,
      sessionSummary,
      membership: member,
      dailyClaim
    };
  }

  async startDiscordSession(discordId, displayName, zoneKey) {
    const { progress } = await this.playerService.ensurePlayer(discordId, displayName);
    const level = Number(progress?.level || 1);
    const state = (await this.idleRepository.findPlayerState(discordId)) || {};
    if (state.discordSession?.zoneKey) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "你目前已有進行中的掛機，請先結算或取消", 400);
    }

    const zones = await this._buildDiscordZoneOptions(level);
    const zone = zones.find((z) => z.zoneKey === zoneKey);
    if (!zone) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "掛機區不存在或未啟用", 400);
    }
    if (!zone.available) {
      throw new AppError(ERROR_CODES.FORBIDDEN, zone.lockedReason || "你目前無法進入此掛機區", 403);
    }

    const session = {
      sessionId: crypto.randomUUID(),
      mode: "monster_zone",
      zoneKey: zone.zoneKey,
      zoneLabel: zone.label,
      featureKey: zone.featureKey,
      startedAt: new Date().toISOString(),
      startedLevel: level,
      avgGoldPerTick: zone.avgGold,
      avgExpPerTick: zone.avgExp,
      tickMinutes: 5,
      maxMinutes: 12 * 60
    };

    await this.idleRepository.savePlayerState(discordId, {
      ...state,
      playerId: discordId,
      discordSession: session,
      updatedAt: new Date().toISOString()
    });

    return session;
  }

  async claimDiscordSession(discordId, displayName, reason = "manual_claim", options = {}) {
    await this.playerService.ensurePlayer(discordId, displayName);
    // 以掛機專用序列鎖包住整段「讀 session → 發獎 → 清 session」，避免雙擊重複領取
    // （不可用 progress lock，否則內部 grantExp 取同一把鎖會重入死鎖）
    return withIdleClaimLock(discordId, () => this._claimDiscordSessionLocked(discordId, displayName, reason, options));
  }

  async _claimDiscordSessionLocked(discordId, displayName, reason = "manual_claim", options = {}) {
    const state = await this.idleRepository.findPlayerState(discordId);
    const session = state?.discordSession || null;
    if (!session) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "目前沒有進行中的掛機", 400);
    }

    const member = await this._resolveMembership(discordId, options.memberRoleIds || []);
    const now = new Date();
    const dateKey = this._getTaipeiDateKey(now);
    const dailyClaim = this._normalizeDailyClaim(state?.dailyClaim, dateKey);
    const baseSummary = this._computeDiscordSessionSummary(session, now);
    const summary = this._applyDailyLimitToSummary(baseSummary, {
      isMember: member.isMember,
      nonMemberClaimedMinutes: dailyClaim.nonMemberClaimedMinutes
    });
    const reward = { gold: summary.totalGold, exp: summary.totalExp };
    // 全服 Buff（直播連動事件）：掛機金幣/經驗也吃全服加成
    try {
      const gb = require("../stream/globalBuffService").getActiveModifiers();
      if (gb.goldPct > 0) reward.gold = Math.round(reward.gold * (1 + gb.goldPct / 100));
      if (gb.expPct > 0) reward.exp = Math.round(reward.exp * (1 + gb.expPct / 100));
    } catch (_) { /* buff 服務未就緒不影響結算 */ }

    if (reward.gold > 0) {
      await this.rewardService.grantCurrency({
        discordId,
        displayName,
        currencyType: "gold",
        amount: reward.gold,
        source: CURRENCY_SOURCES.IDLE_REWARD,
        sourceRef: `idle:${discordId}:${session.startedAt}`,
        operator: "idle_zone"
      });
    }
    if (reward.exp > 0) {
      await this.progressService.grantExp({
        discordId,
        displayName,
        amount: reward.exp,
        source: EXP_SOURCES.IDLE_REWARD_EXP
      });
    }

    const endedAt = now.toISOString();
    const result = {
      reason,
      zoneKey: session.zoneKey,
      zoneLabel: session.zoneLabel,
      startedAt: session.startedAt,
      endedAt,
      elapsedMinutes: summary.elapsedMinutes,
      effectiveMinutes: summary.effectiveMinutes,
      effectiveMinutesRaw: summary.effectiveMinutesRaw ?? summary.effectiveMinutes,
      rewardFactor: summary.rewardFactor,
      reward,
      membership: member,
      dailyLimitMinutes: summary.dailyLimitMinutes,
      dailyClaimedMinutesBefore: summary.dailyClaimedMinutesBefore,
      dailyClaimedMinutesAfter: summary.dailyClaimedMinutesAfter,
      dailyRemainingMinutes: summary.dailyRemainingMinutes,
      dailyCapHit: summary.dailyCapHit
    };

    const nextDailyClaim = member.isMember
      ? dailyClaim
      : {
          dateKey,
          nonMemberClaimedMinutes: Math.max(0, summary.dailyClaimedMinutesAfter || 0)
        };

    await this.idleRepository.savePlayerState(discordId, {
      ...state,
      playerId: discordId,
      discordSession: null,
      lastClaimSummary: result,
      dailyClaim: nextDailyClaim,
      updatedAt: endedAt
    });

    return result;
  }

  async cancelDiscordSession(discordId, displayName) {
    await this.playerService.ensurePlayer(discordId, displayName);
    const state = await this.idleRepository.findPlayerState(discordId);
    const session = state?.discordSession || null;
    if (!session) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "目前沒有進行中的掛機", 400);
    }

    const summary = this._computeDiscordSessionSummary(session);
    const endedAt = new Date().toISOString();
    const result = {
      reason: "cancel",
      zoneKey: session.zoneKey,
      zoneLabel: session.zoneLabel,
      startedAt: session.startedAt,
      endedAt,
      elapsedMinutes: summary.elapsedMinutes,
      effectiveMinutes: summary.effectiveMinutes,
      rewardFactor: summary.rewardFactor,
      reward: { gold: 0, exp: 0 }
    };

    await this.idleRepository.savePlayerState(discordId, {
      ...state,
      playerId: discordId,
      discordSession: null,
      updatedAt: endedAt
    });

    return result;
  }

  async settleDiscordSessionOnBattleStart(discordId, displayName, options = {}) {
    const state = await this.idleRepository.findPlayerState(discordId);
    if (!state?.discordSession) return null;
    return this.claimDiscordSession(discordId, displayName, "battle_start", options);
  }

  async listZones({ includeDisabled = true } = {}) {
    const zones = await this.idleRepository.listZones();
    const normalized = zones.map((zone) => this._normalizeZone(zone));
    return normalized
      .filter((zone) => includeDisabled || zone.enabled)
      .sort((a, b) => {
        const sa = Number(a.sortOrder || 0);
        const sb = Number(b.sortOrder || 0);
        if (sa !== sb) return sa - sb;
        return String(a.name || "").localeCompare(String(b.name || ""), "zh-Hant");
      });
  }

  async getZoneById(zoneId) {
    const zone = await this.idleRepository.findZoneById(String(zoneId || "").trim());
    return zone ? this._normalizeZone(zone) : null;
  }

  async createZone(payload = {}) {
    const now = new Date().toISOString();
    const zone = this._normalizeZone({
      id: payload.id || `idle-zone-${crypto.randomUUID()}`,
      ...payload,
      createdAt: now,
      updatedAt: now
    });
    if (!zone.name) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "zone name is required", 400);
    }
    await this.idleRepository.saveZone(zone);
    return zone;
  }

  async updateZone(zoneId, payload = {}) {
    const current = await this.idleRepository.findZoneById(String(zoneId || "").trim());
    if (!current) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "idle zone not found", 404);
    }
    const merged = this._normalizeZone({
      ...current,
      ...payload,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString()
    });
    if (!merged.name) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "zone name is required", 400);
    }
    await this.idleRepository.saveZone(merged);
    return merged;
  }

  async deleteZone(zoneId) {
    const id = String(zoneId || "").trim();
    await this.idleRepository.deleteZone(id);
    return true;
  }

  async ensureDefaultZones() {
    const existing = await this.idleRepository.listZones();
    if (existing.length > 0) return { createdCount: 0 };
    const now = new Date().toISOString();
    const defaults = [
      {
        id: "idle-beginner-zone",
        name: "新手放置區",
        description: "對應新手怪物區，低壓力穩定成長。",
        enabled: true,
        sortOrder: 10,
        minLevel: 1,
        maxLevel: 3,
        minClaimMinutes: 5,
        maxDurationMinutes: 240,
        cooldownMinutes: 5,
        rewardTiers: [
          { minLevel: 1, maxLevel: 3, goldPerMinute: 8, expPerMinute: 6, drops: [] }
        ],
        createdAt: now,
        updatedAt: now
      },
      {
        id: "idle-normal-zone",
        name: "一般放置區",
        description: "對應一般怪物區，作為前期主力掛機區。",
        enabled: true,
        sortOrder: 20,
        minLevel: 1,
        maxLevel: 10,
        minClaimMinutes: 8,
        maxDurationMinutes: 360,
        cooldownMinutes: 8,
        rewardTiers: [
          { minLevel: 1, maxLevel: 5, goldPerMinute: 12, expPerMinute: 9, drops: [] },
          { minLevel: 6, maxLevel: 10, goldPerMinute: 14, expPerMinute: 11, drops: [] }
        ],
        createdAt: now,
        updatedAt: now
      },
      {
        id: "idle-mid-zone",
        name: "中級放置區",
        description: "對應中級怪物區，中期成長主區域。",
        enabled: true,
        sortOrder: 30,
        minLevel: 10,
        maxLevel: 25,
        minClaimMinutes: 10,
        maxDurationMinutes: 480,
        cooldownMinutes: 10,
        rewardTiers: [
          { minLevel: 10, maxLevel: 17, goldPerMinute: 20, expPerMinute: 15, drops: [] },
          { minLevel: 18, maxLevel: 25, goldPerMinute: 24, expPerMinute: 18, drops: [] }
        ],
        createdAt: now,
        updatedAt: now
      },
      {
        id: "idle-hard-zone",
        name: "高級放置區",
        description: "對應高級怪物區，提供高效率資源獲取。",
        enabled: true,
        sortOrder: 40,
        minLevel: 20,
        maxLevel: 40,
        minClaimMinutes: 12,
        maxDurationMinutes: 600,
        cooldownMinutes: 12,
        rewardTiers: [
          { minLevel: 20, maxLevel: 30, goldPerMinute: 30, expPerMinute: 23, drops: [] },
          { minLevel: 31, maxLevel: 40, goldPerMinute: 34, expPerMinute: 26, drops: [] }
        ],
        createdAt: now,
        updatedAt: now
      },
      {
        id: "idle-elite-zone",
        name: "精英放置區",
        description: "對應精英怪物區，適合高等玩家長時間掛機。",
        enabled: true,
        sortOrder: 50,
        minLevel: 30,
        maxLevel: 999,
        minClaimMinutes: 15,
        maxDurationMinutes: 720,
        cooldownMinutes: 15,
        rewardTiers: [
          { minLevel: 30, maxLevel: 45, goldPerMinute: 42, expPerMinute: 32, drops: [] },
          { minLevel: 46, maxLevel: 999, goldPerMinute: 48, expPerMinute: 37, drops: [] }
        ],
        createdAt: now,
        updatedAt: now
      }
    ];
    for (const zone of defaults) {
      await this.idleRepository.saveZone(this._normalizeZone(zone));
    }
    return { createdCount: defaults.length };
  }

  async getPlayerStatus(discordId, displayName = "Player") {
    const { progress } = await this.playerService.ensurePlayer(discordId, displayName);
    const level = Number(progress?.level || 1);
    const state = await this.idleRepository.findPlayerState(discordId);
    const zones = await this.listZones({ includeDisabled: false });
    const now = new Date();

    const zoneViews = zones.map((zone) => {
      const lockedReason = this._getZoneLockedReason(zone, level);
      const rewardTier = this._pickRewardTier(zone.rewardTiers, level);
      return {
        ...zone,
        rewardTier,
        available: !lockedReason,
        lockedReason
      };
    });

    let activeSession = null;
    if (state?.activeSession?.zoneId) {
      const activeZone = zones.find((z) => z.id === state.activeSession.zoneId) || null;
      if (activeZone) {
        const preview = this._computeClaimPreview({
          session: state.activeSession,
          zone: activeZone,
          playerLevel: level,
          now
        });
        await this._maybeNotifyIdleCap(
          discordId, state, state.activeSession, preview.elapsedMinutes,
          Math.max(1, Number(activeZone.maxDurationMinutes || 480)), "activeSession"
        );
        activeSession = {
          ...state.activeSession,
          zoneId: activeZone.id,
          zoneName: activeZone.name,
          ...preview
        };
      }
    }

    const cooldownUntil = safeIso(state?.cooldownUntil);
    const cooldownRemainingSeconds = cooldownUntil
      ? Math.max(0, Math.ceil((new Date(cooldownUntil).getTime() - now.getTime()) / 1000))
      : 0;

    return {
      level,
      zones: zoneViews,
      activeSession,
      cooldownUntil,
      cooldownRemainingSeconds,
      lastClaimSummary: state?.lastClaimSummary || null
    };
  }

  async startSession(discordId, displayName, zoneId) {
    const zone = await this.getZoneById(zoneId);
    if (!zone || !zone.enabled) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "放置區不存在或已停用", 400);
    }
    const { progress } = await this.playerService.ensurePlayer(discordId, displayName);
    const level = Number(progress?.level || 1);

    const lockedReason = this._getZoneLockedReason(zone, level);
    if (lockedReason) {
      throw new AppError(ERROR_CODES.FORBIDDEN, lockedReason, 403);
    }

    const state = (await this.idleRepository.findPlayerState(discordId)) || {};
    if (state.activeSession?.zoneId) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "你目前已有進行中的掛機任務", 400);
    }

    const cooldownUntil = safeIso(state.cooldownUntil);
    if (cooldownUntil && new Date(cooldownUntil).getTime() > Date.now()) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "冷卻中，請稍後再開始掛機", 400);
    }

    const startedAt = new Date().toISOString();
    const session = {
      sessionId: crypto.randomUUID(),
      zoneId: zone.id,
      zoneName: zone.name,
      startedAt,
      startedLevel: level,
      startedBy: displayName || discordId
    };

    await this.idleRepository.savePlayerState(discordId, {
      playerId: discordId,
      activeSession: session,
      cooldownUntil: null,
      lastClaimSummary: state.lastClaimSummary || null,
      updatedAt: new Date().toISOString()
    });

    return {
      session,
      zone
    };
  }

  async claimSession(discordId, displayName, opts = {}) {
    // 以掛機專用序列鎖包住整段結算，避免雙擊重複領取掉落/金幣
    // （不可用 progress lock，否則內部 grantExp 取同一把鎖會重入死鎖）
    return withIdleClaimLock(discordId, () => this._claimSessionLocked(discordId, displayName, opts));
  }

  async _claimSessionLocked(discordId, displayName, { force = false } = {}) {
    const state = await this.idleRepository.findPlayerState(discordId);
    if (!state?.activeSession?.zoneId) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "目前沒有進行中的掛機任務", 400);
    }

    const { progress } = await this.playerService.ensurePlayer(discordId, displayName);
    const level = Number(progress?.level || 1);
    const zone = await this.getZoneById(state.activeSession.zoneId);
    if (!zone) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "掛機區資料不存在，無法結算", 400);
    }

    const now = new Date();
    const preview = this._computeClaimPreview({
      session: state.activeSession,
      zone,
      playerLevel: level,
      now
    });

    const minClaimMinutes = Number(zone.minClaimMinutes || 0);
    if (!force && preview.effectiveMinutes < minClaimMinutes) {
      throw new AppError(
        ERROR_CODES.INVALID_ARGUMENT,
        `至少需要掛機 ${minClaimMinutes} 分鐘才可領取`,
        400
      );
    }

    const reward = {
      gold: Math.max(0, Math.round(preview.effectiveMinutes * preview.rewardTier.goldPerMinute)),
      exp: Math.max(0, Math.round(preview.effectiveMinutes * preview.rewardTier.expPerMinute)),
      items: []
    };
    // 全服 Buff（直播連動事件）：網頁掛機金幣/經驗也吃全服加成
    try {
      const gb = require("../stream/globalBuffService").getActiveModifiers();
      if (gb.goldPct > 0) reward.gold = Math.round(reward.gold * (1 + gb.goldPct / 100));
      if (gb.expPct > 0) reward.exp = Math.round(reward.exp * (1 + gb.expPct / 100));
    } catch (_) { /* buff 服務未就緒不影響結算 */ }

    const droppedItems = await this._rollAndGrantDrops({
      discordId,
      effectiveMinutes: preview.effectiveMinutes,
      drops: preview.rewardTier.drops || []
    });
    reward.items = droppedItems;

    if (reward.gold > 0) {
      await this.rewardService.grantCurrency({
        discordId,
        displayName,
        currencyType: "gold",
        amount: reward.gold,
        source: CURRENCY_SOURCES.IDLE_REWARD,
        sourceRef: `idle:${discordId}:${state.activeSession.startedAt}`,
        operator: "idle_zone"
      });
    }

    if (reward.exp > 0) {
      await this.progressService.grantExp({
        discordId,
        displayName,
        amount: reward.exp,
        source: EXP_SOURCES.IDLE_REWARD_EXP
      });
    }

    const cooldownUntil = new Date(
      now.getTime() + Math.max(0, Number(zone.cooldownMinutes || 0)) * 60 * 1000
    ).toISOString();

    const summary = {
      zoneId: zone.id,
      zoneName: zone.name,
      startedAt: state.activeSession.startedAt,
      claimedAt: now.toISOString(),
      elapsedMinutes: preview.elapsedMinutes,
      effectiveMinutes: preview.effectiveMinutes,
      reward,
      rewardTier: preview.rewardTier
    };

    await this.idleRepository.savePlayerState(discordId, {
      playerId: discordId,
      activeSession: null,
      cooldownUntil,
      lastClaimSummary: summary,
      updatedAt: new Date().toISOString()
    });

    return {
      summary,
      cooldownUntil
    };
  }

  async cancelSession(discordId) {
    const state = await this.idleRepository.findPlayerState(discordId);
    if (!state?.activeSession?.zoneId) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "目前沒有進行中的掛機任務", 400);
    }
    await this.idleRepository.savePlayerState(discordId, {
      playerId: discordId,
      activeSession: null,
      cooldownUntil: null,
      lastClaimSummary: state.lastClaimSummary || null,
      updatedAt: new Date().toISOString()
    });
    return { canceled: true };
  }

  _normalizeZone(zone = {}) {
    const normalizedRewardTiers = Array.isArray(zone.rewardTiers) && zone.rewardTiers.length
      ? zone.rewardTiers.map((tier) => this._normalizeRewardTier(tier))
      : [this._normalizeRewardTier({ minLevel: 1, maxLevel: 999, goldPerMinute: 10, expPerMinute: 8, drops: [] })];

    normalizedRewardTiers.sort((a, b) => a.minLevel - b.minLevel || a.maxLevel - b.maxLevel);

    return {
      id: String(zone.id || "").trim(),
      name: String(zone.name || "").trim(),
      description: String(zone.description || "").trim(),
      enabled: zone.enabled !== false,
      sortOrder: Math.max(0, Math.floor(toNumber(zone.sortOrder, 0))),
      minLevel: Math.max(1, Math.floor(toNumber(zone.minLevel, 1))),
      maxLevel: Math.max(1, Math.floor(toNumber(zone.maxLevel, 999))),
      minClaimMinutes: Math.max(0, Math.floor(toNumber(zone.minClaimMinutes, 5))),
      maxDurationMinutes: Math.max(1, Math.floor(toNumber(zone.maxDurationMinutes, 480))),
      cooldownMinutes: Math.max(0, Math.floor(toNumber(zone.cooldownMinutes, 10))),
      rewardTiers: normalizedRewardTiers,
      createdAt: safeIso(zone.createdAt, new Date().toISOString()),
      updatedAt: safeIso(zone.updatedAt, new Date().toISOString())
    };
  }

  _normalizeRewardTier(tier = {}) {
    const minLevel = Math.max(1, Math.floor(toNumber(tier.minLevel, 1)));
    const maxLevel = Math.max(minLevel, Math.floor(toNumber(tier.maxLevel, 999)));
    const drops = Array.isArray(tier.drops) ? tier.drops : [];

    return {
      minLevel,
      maxLevel,
      goldPerMinute: Math.max(0, toNumber(tier.goldPerMinute, 0)),
      expPerMinute: Math.max(0, toNumber(tier.expPerMinute, 0)),
      drops: drops
        .map((drop) => ({
          itemId: String(drop?.itemId || "").trim(),
          chancePercent: clamp(toNumber(drop?.chancePercent, 0), 0, 100),
          rollEveryMinutes: Math.max(1, Math.floor(toNumber(drop?.rollEveryMinutes, 60))),
          maxCount: Math.max(1, Math.floor(toNumber(drop?.maxCount, 1)))
        }))
        .filter((drop) => drop.itemId)
    };
  }

  _pickRewardTier(tiers, level) {
    const lv = Math.max(1, Math.floor(toNumber(level, 1)));
    const arr = Array.isArray(tiers) ? tiers : [];
    if (!arr.length) {
      return this._normalizeRewardTier({ minLevel: 1, maxLevel: 999, goldPerMinute: 0, expPerMinute: 0, drops: [] });
    }
    const hit = arr.find((tier) => lv >= tier.minLevel && lv <= tier.maxLevel);
    return hit || arr[arr.length - 1];
  }

  _getZoneLockedReason(zone, level) {
    if (!zone.enabled) return "此放置區目前未開放";
    if (level < zone.minLevel) return `需要等級 ${zone.minLevel} 才能進入`;
    if (level > zone.maxLevel) return `此放置區上限等級為 ${zone.maxLevel}`;
    return null;
  }

  _computeClaimPreview({ session, zone, playerLevel, now = new Date() }) {
    const startedAtIso = safeIso(session?.startedAt, new Date().toISOString());
    const startedAt = new Date(startedAtIso);
    const elapsedMinutes = Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / 60000));
    const effectiveMinutes = Math.min(elapsedMinutes, Math.max(1, Number(zone.maxDurationMinutes || 480)));
    const rewardTier = this._pickRewardTier(zone.rewardTiers, playerLevel);
    return {
      startedAt: startedAtIso,
      elapsedMinutes,
      effectiveMinutes,
      rewardTier
    };
  }

  async _rollAndGrantDrops({ discordId, effectiveMinutes, drops }) {
    if (!Array.isArray(drops) || !drops.length || effectiveMinutes <= 0) return [];

    const progress = await this.progressRepository.findByPlayerId(discordId);
    if (!progress) return [];
    if (!Array.isArray(progress.inventory)) progress.inventory = [];

    const granted = [];
    const grantedByItemId = {};

    for (const drop of drops) {
      const itemId = String(drop.itemId || "").trim();
      if (!itemId) continue;
      const chancePercent = clamp(toNumber(drop.chancePercent, 0), 0, 100);
      if (chancePercent <= 0) continue;

      const rollEveryMinutes = Math.max(1, Math.floor(toNumber(drop.rollEveryMinutes, 60)));
      const maxCount = Math.max(1, Math.floor(toNumber(drop.maxCount, 1)));
      const rolls = Math.max(1, Math.floor(effectiveMinutes / rollEveryMinutes));

      let hits = 0;
      for (let i = 0; i < rolls; i += 1) {
        if (Math.random() * 100 < chancePercent) hits += 1;
        if (hits >= maxCount) break;
      }
      if (hits <= 0) continue;

      const item = await this.itemRepository.findById(itemId);
      if (!item) continue;

      const take = Math.min(hits, maxCount);
      grantedByItemId[itemId] = (grantedByItemId[itemId] || 0) + take;
      for (let i = 0; i < take; i += 1) {
        progress.inventory.push({
          uuid: crypto.randomUUID(),
          itemId: item.id,
          itemName: item.name,
          itemEffect: item.effect || { type: "none", value: 0 },
          useEffects: item.useEffects || [],
          passiveEffects: item.passiveEffects || [],
          procEffects: item.procEffects || [],
          combatEffects: item.combatEffects || [],
          itemType: item.itemType || "consumable",
          imageUrl: item.imageUrl || null,
          imageThumbnailUrl: item.imageThumbnailUrl || null,
          equipSlot: item.equipSlot || null,
          equipStats: item.equipStats || null,
          weaponType: item.weaponType || null,
          isTwoHanded: item.isTwoHanded || false,
          tier: item.tier || null,
          source: "idle_zone",
          obtainedAt: new Date().toISOString()
        });
      }
    }

    if (!Object.keys(grantedByItemId).length) return [];
    progress.updatedAt = new Date().toISOString();
    await this.progressRepository.save(progress);

    for (const [itemId, count] of Object.entries(grantedByItemId)) {
      const item = await this.itemRepository.findById(itemId);
      if (!item) continue;
      granted.push({
        itemId,
        itemName: item.name,
        count
      });
    }

    return granted;
  }
}

module.exports = {
  IdleService
};
