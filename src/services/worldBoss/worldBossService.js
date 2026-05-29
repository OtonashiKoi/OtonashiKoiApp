"use strict";

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

function currentWeekLabelTW() {
  return toIsoWeekLabelFromTWDate(getTWParts(new Date()));
}

function toNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

const DEFAULT_CONFIG = {
  enabled: true,
  targetZone: "ancient_city_deep",
  weeklyUnlockKillTarget: 300,
  battleTimeLimitMinutes: 60,
  respawnCooldownMinutes: 60,
  eliteZoneKey: "elite",
  phaseConfig: [
    { phase: 1, hpBelowPercent: 70, atkMultiplier: 1.0, defMultiplier: 1.0, agiBonus: 0, note: "第一階段" },
    { phase: 2, hpBelowPercent: 40, atkMultiplier: 1.2, defMultiplier: 1.1, agiBonus: 0, note: "第二階段" },
    { phase: 3, hpBelowPercent: 0, atkMultiplier: 1.4, defMultiplier: 1.2, agiBonus: 35, note: "第三階段" }
  ]
};

function normalizePhaseList(list) {
  const source = Array.isArray(list) && list.length ? list : DEFAULT_CONFIG.phaseConfig;
  const normalized = source
    .map((p, idx) => ({
      phase: Math.max(1, Math.floor(toNum(p?.phase, idx + 1))),
      hpBelowPercent: Math.max(0, Math.min(100, toNum(p?.hpBelowPercent, idx === 0 ? 70 : idx === 1 ? 40 : 0))),
      atkMultiplier: Math.max(0.1, toNum(p?.atkMultiplier, 1)),
      defMultiplier: Math.max(0.1, toNum(p?.defMultiplier, 1)),
      agiBonus: Math.max(0, Math.floor(toNum(p?.agiBonus, idx === 2 ? 35 : 0))),
      note: String(p?.note || "").trim()
    }))
    .sort((a, b) => b.hpBelowPercent - a.hpBelowPercent);
  return normalized.slice(0, 3);
}

function normalizeConfig(input = {}) {
  return {
    enabled: input.enabled !== false,
    targetZone: String(input.targetZone || DEFAULT_CONFIG.targetZone),
    weeklyUnlockKillTarget: Math.max(1, Math.floor(toNum(input.weeklyUnlockKillTarget, DEFAULT_CONFIG.weeklyUnlockKillTarget))),
    battleTimeLimitMinutes: Math.max(1, Math.floor(toNum(input.battleTimeLimitMinutes, DEFAULT_CONFIG.battleTimeLimitMinutes))),
    respawnCooldownMinutes: Math.max(0, Math.floor(toNum(input.respawnCooldownMinutes, DEFAULT_CONFIG.respawnCooldownMinutes))),
    eliteZoneKey: String(input.eliteZoneKey || DEFAULT_CONFIG.eliteZoneKey),
    phaseConfig: normalizePhaseList(input.phaseConfig)
  };
}

function defaultStateForWeek(weekKey) {
  return {
    weekKey,
    hardKills: 0,
    unlockedAt: null,
    lastKilledAt: null,
    battleStartedAt: null,
    lastFailedAt: null
  };
}

class WorldBossService {
  constructor(worldBossRepository) {
    this.repo = worldBossRepository;
  }

  async getConfig() {
    const stored = await this.repo.getConfig();
    return normalizeConfig(stored || {});
  }

  async saveConfig(payload = {}) {
    const current = await this.getConfig();
    const merged = normalizeConfig({ ...current, ...(payload || {}) });
    await this.repo.saveConfig(merged);
    return merged;
  }

  async _getStateEnsured() {
    const weekKey = currentWeekLabelTW();
    const raw = (await this.repo.getState()) || defaultStateForWeek(weekKey);
    if (raw.weekKey !== weekKey) {
      const reset = defaultStateForWeek(weekKey);
      await this.repo.saveState(reset);
      return reset;
    }
    return {
      ...defaultStateForWeek(weekKey),
      ...raw
    };
  }

  _buildStatus(config, state, now = Date.now()) {
    const unlockTarget = 0;
    const hardKills = Math.max(0, Number(state.hardKills || 0));
    const unlocked = true;
    const lastKilledAtMs = state.lastKilledAt ? Date.parse(state.lastKilledAt) : NaN;
    const cooldownMs = Math.max(0, Number(config.respawnCooldownMinutes || 0) * 60 * 1000);
    const cooldownRemainingMs = Number.isFinite(lastKilledAtMs)
      ? Math.max(0, (lastKilledAtMs + cooldownMs) - now)
      : 0;

    const battleStartedAtMs = state.battleStartedAt ? Date.parse(state.battleStartedAt) : NaN;
    const battleLimitMs = Math.max(1, Number(config.battleTimeLimitMinutes || 60)) * 60 * 1000;
    const battleRemainingMs = Number.isFinite(battleStartedAtMs)
      ? Math.max(0, (battleStartedAtMs + battleLimitMs) - now)
      : 0;
    const battleTimeoutReached = Number.isFinite(battleStartedAtMs) && battleRemainingMs <= 0;

    return {
      weekKey: state.weekKey,
      hardKills,
      unlockTarget,
      remainingUnlockKills: Math.max(0, unlockTarget - hardKills),
      unlocked,
      cooldownRemainingMs,
      cooldownRemainingMinutes: Math.ceil(cooldownRemainingMs / 60000),
      battleStartedAt: state.battleStartedAt || null,
      battleRemainingMs,
      battleRemainingMinutes: Math.ceil(battleRemainingMs / 60000),
      battleTimeoutReached,
      canChallenge: config.enabled && cooldownRemainingMs <= 0
    };
  }

  async getConfigWithStatus() {
    const [config, state] = await Promise.all([this.getConfig(), this._getStateEnsured()]);
    return {
      config,
      state,
      status: this._buildStatus(config, state, Date.now())
    };
  }

  async recordHardZoneKill(count = 1) {
    const [config, state] = await Promise.all([this.getConfig(), this._getStateEnsured()]);
    const next = { ...state, hardKills: Math.max(0, Number(state.hardKills || 0) + Math.max(1, Math.floor(toNum(count, 1)))) };
    await this.repo.saveState(next);
    return {
      state: next,
      status: this._buildStatus(config, next, Date.now())
    };
  }

  async startBossBattleIfNeeded() {
    const [config, state] = await Promise.all([this.getConfig(), this._getStateEnsured()]);
    if (!state.battleStartedAt) {
      state.battleStartedAt = new Date().toISOString();
      await this.repo.saveState(state);
    }
    return {
      state,
      status: this._buildStatus(config, state, Date.now())
    };
  }

  async markBossKilled() {
    const [config, state] = await Promise.all([this.getConfig(), this._getStateEnsured()]);
    const nowIso = new Date().toISOString();
    state.lastKilledAt = nowIso;
    state.battleStartedAt = null;
    await this.repo.saveState(state);
    return {
      state,
      status: this._buildStatus(config, state, Date.now())
    };
  }

  async markBossFailedTimeout() {
    const [config, state] = await Promise.all([this.getConfig(), this._getStateEnsured()]);
    const nowIso = new Date().toISOString();
    state.battleStartedAt = null;
    state.lastFailedAt = nowIso;
    state.lastKilledAt = nowIso; // 觸發冷卻計時，讓 boss 隔一段時間才再出現
    await this.repo.saveState(state);
    return {
      state,
      status: this._buildStatus(config, state, Date.now())
    };
  }

  resolvePhase(configOrPhaseList, hpPercent) {
    const phaseList = Array.isArray(configOrPhaseList)
      ? normalizePhaseList(configOrPhaseList)
      : normalizePhaseList(configOrPhaseList?.phaseConfig || []);
    const pct = Math.max(0, Math.min(100, Number(hpPercent || 0)));
    let chosen = phaseList[phaseList.length - 1] || { phase: 1, hpBelowPercent: 0, atkMultiplier: 1, defMultiplier: 1 };
    for (const phase of phaseList) {
      if (pct <= phase.hpBelowPercent) {
        chosen = phase;
      }
    }
    return chosen;
  }
}

module.exports = {
  WorldBossService,
  normalizeConfig,
  currentWeekLabelTW
};
