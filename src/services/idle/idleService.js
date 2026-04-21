const crypto = require("crypto");
const { AppError, ERROR_CODES } = require("../../shared/errors");
const { CURRENCY_SOURCES, EXP_SOURCES } = require("../../shared/sources");
const {
  ZONE_BY_KEY,
  featureKeyToZone,
  checkZoneLevelRequirementWithBinding
} = require("../../shared/zones");

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

class IdleService {
  constructor({
    idleRepository,
    playerService,
    progressRepository,
    rewardService,
    progressService,
    itemRepository,
    channelLayoutRepository,
    monsterService
  }) {
    this.idleRepository = idleRepository;
    this.playerService = playerService;
    this.progressRepository = progressRepository;
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
    if (!Array.isArray(monsters) || monsters.length === 0) {
      return {
        zoneKey,
        monsterCount: 0,
        avgGold: 0,
        avgExp: 0
      };
    }

    const totalGold = monsters.reduce((sum, m) => sum + Math.max(0, Number(m.goldReward) || 0), 0);
    const totalExp = monsters.reduce((sum, m) => sum + Math.max(0, Number(m.expReward) || 0), 0);
    return {
      zoneKey,
      monsterCount: monsters.length,
      avgGold: totalGold / monsters.length,
      avgExp: totalExp / monsters.length
    };
  }

  async _buildDiscordZoneOptions(level) {
    const zoneBindings = await this._listMonsterZoneBindings();
    const options = [];
    for (const binding of zoneBindings) {
      const zoneKey = featureKeyToZone(binding.featureKey);
      const zoneDef = ZONE_BY_KEY[zoneKey] || null;
      if (!zoneDef) continue;
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

  async getDiscordPanelStatus(discordId, displayName = "Player") {
    const { progress } = await this.playerService.ensurePlayer(discordId, displayName);
    const level = Number(progress?.level || 1);
    const state = await this.idleRepository.findPlayerState(discordId);
    const zones = await this._buildDiscordZoneOptions(level);
    const session = state?.discordSession || null;
    const sessionSummary = session ? this._computeDiscordSessionSummary(session) : null;
    return {
      level,
      zones,
      discordSession: session,
      sessionSummary
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

  async claimDiscordSession(discordId, displayName, reason = "manual_claim") {
    await this.playerService.ensurePlayer(discordId, displayName);
    const state = await this.idleRepository.findPlayerState(discordId);
    const session = state?.discordSession || null;
    if (!session) {
      throw new AppError(ERROR_CODES.INVALID_ARGUMENT, "目前沒有進行中的掛機", 400);
    }

    const summary = this._computeDiscordSessionSummary(session);
    const reward = { gold: summary.totalGold, exp: summary.totalExp };

    if (reward.gold > 0) {
      await this.rewardService.grantCurrency({
        discordId,
        displayName,
        currencyType: "gold",
        amount: reward.gold,
        source: CURRENCY_SOURCES.IDLE_REWARD,
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

    const endedAt = new Date().toISOString();
    const result = {
      reason,
      zoneKey: session.zoneKey,
      zoneLabel: session.zoneLabel,
      startedAt: session.startedAt,
      endedAt,
      elapsedMinutes: summary.elapsedMinutes,
      effectiveMinutes: summary.effectiveMinutes,
      rewardFactor: summary.rewardFactor,
      reward
    };

    await this.idleRepository.savePlayerState(discordId, {
      ...state,
      playerId: discordId,
      discordSession: null,
      lastClaimSummary: result,
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

  async settleDiscordSessionOnBattleStart(discordId, displayName) {
    const state = await this.idleRepository.findPlayerState(discordId);
    if (!state?.discordSession) return null;
    return this.claimDiscordSession(discordId, displayName, "battle_start");
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

  async claimSession(discordId, displayName, { force = false } = {}) {
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
