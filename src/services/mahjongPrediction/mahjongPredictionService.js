"use strict";

const {
  INITIAL_KOI_TICKETS,
  DAILY_KOI_TICKETS,
  BET_MIN,
  BET_MAX,
  DEFAULT_OPEN_SECONDS,
  MIN_OPEN_SECONDS,
  MAX_OPEN_SECONDS,
  PAYOUT_RATE,
  MARKET_TEMPLATES,
  getMarketTemplate,
  estimateOptionOdds,
} = require("./mahjongPredictionConfig");

function taipeiDayKey(now = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(now);
}

function boundedText(value, fallback, maxLength) {
  const text = String(value || "").trim();
  return (text || fallback).slice(0, maxLength);
}

function publicMarket(market, nowMs = Date.now()) {
  if (!market) return null;
  const effectiveStatus = market.status === "open" && Number(market.lockAtMs) <= nowMs ? "locked" : market.status;
  return {
    marketId: market.marketId,
    sequence: market.sequence,
    sessionLabel: market.sessionLabel,
    handLabel: market.handLabel,
    marketType: market.marketType,
    title: market.title,
    status: effectiveStatus,
    openedAt: market.openedAt,
    lockAtMs: market.lockAtMs,
    lockedAt: market.lockedAt || null,
    settledAt: market.settledAt || null,
    voidedAt: market.voidedAt || null,
    options: estimateOptionOdds(market),
    betCount: Number(market.betCount) || 0,
    totalStaked: Number(market.totalStaked) || 0,
    winningOptionId: market.winningOptionId || null,
    winningOptionLabel: market.winningOptionLabel || null,
    resultMeta: market.resultMeta || null,
    voidReason: market.voidReason || null,
    totalPayout: Number(market.totalPayout) || 0,
    houseTake: Number(market.houseTake) || 0,
  };
}

class MahjongPredictionService {
  constructor(repository) {
    this.repository = repository;
  }

  getConfig() {
    return {
      currency: { key: "koi_ticket", name: "戀雀券", icon: "🀄" },
      initialGrant: INITIAL_KOI_TICKETS,
      dailyGrant: DAILY_KOI_TICKETS,
      betMin: BET_MIN,
      betMax: BET_MAX,
      payoutRate: PAYOUT_RATE,
      defaultOpenSeconds: DEFAULT_OPEN_SECONDS,
      templates: Object.values(MARKET_TEMPLATES),
    };
  }

  async _currentMarket() {
    return this.repository.getCurrentMarket();
  }

  async getPlayerState({ playerId, displayName }) {
    const wallet = await this.repository.getWallet(playerId);
    const current = await this._currentMarket();
    const [myBet, recentMarkets, recentBets, transactions] = await Promise.all([
      current ? this.repository.findPlayerBet(current.marketId, playerId) : null,
      this.repository.listRecentMarkets(8),
      this.repository.listPlayerBets(playerId, 12),
      this.repository.listPlayerTransactions(playerId, 16),
    ]);
    const claimKey = taipeiDayKey();
    return {
      now: Date.now(),
      config: this.getConfig(),
      wallet: {
        activated: Boolean(wallet),
        balance: Number(wallet?.balance) || 0,
        lastDailyClaimKey: wallet?.lastDailyClaimKey || null,
        dailyClaimAvailable: Boolean(wallet) && wallet?.lastDailyClaimKey !== claimKey,
      },
      currentMarket: publicMarket(current),
      myBet,
      recentMarkets: recentMarkets.map((market) => publicMarket(market)),
      recentBets,
      transactions,
    };
  }

  async activateWallet({ playerId, displayName }) {
    const wallet = await this.repository.ensureWallet(playerId, displayName, INITIAL_KOI_TICKETS);
    return { activated: true, balance: wallet.balance, initialGrant: INITIAL_KOI_TICKETS };
  }

  async claimDaily({ playerId, displayName }) {
    await this.repository.ensureWallet(playerId, displayName, INITIAL_KOI_TICKETS);
    const wallet = await this.repository.claimDaily(playerId, displayName, taipeiDayKey(), DAILY_KOI_TICKETS);
    return { balance: wallet.balance, granted: DAILY_KOI_TICKETS, claimKey: wallet.lastDailyClaimKey };
  }

  async placeBet({ playerId, displayName, marketId, optionId, amount }) {
    const intAmount = Math.floor(Number(amount));
    if (!Number.isFinite(intAmount) || intAmount < BET_MIN || intAmount > BET_MAX) {
      throw new Error(`每注需為 ${BET_MIN.toLocaleString("zh-TW")}～${BET_MAX.toLocaleString("zh-TW")} 張戀雀券。`);
    }
    if (!marketId || !optionId) throw new Error("請選擇目前盤口與投注選項。");
    await this.repository.ensureWallet(playerId, displayName, INITIAL_KOI_TICKETS);
    const result = await this.repository.placeBet({ marketId, playerId, displayName, optionId, amount: intAmount });
    return { bet: result.bet, balance: result.wallet.balance, marketSequence: result.marketSequence };
  }

  async getAdminState() {
    const current = await this._currentMarket();
    const [recentMarkets, stats] = await Promise.all([
      this.repository.listRecentMarkets(20),
      this.repository.getAdminStats(),
    ]);
    return {
      now: Date.now(),
      config: this.getConfig(),
      currentMarket: publicMarket(current),
      recentMarkets: recentMarkets.map((market) => publicMarket(market)),
      stats,
      overlayUrl: "/static/mahjong-prediction-overlay.html",
      playerPath: "/mahjong-live",
    };
  }

  async createMarket(input = {}) {
    const template = getMarketTemplate(input.marketType);
    if (!template) throw new Error("盤口類型需為『是否和牌』或『和牌級別』。");
    const openSeconds = Math.floor(Number(input.openSeconds) || DEFAULT_OPEN_SECONDS);
    if (openSeconds < MIN_OPEN_SECONDS || openSeconds > MAX_OPEN_SECONDS) {
      throw new Error(`開盤秒數需介於 ${MIN_OPEN_SECONDS}～${MAX_OPEN_SECONDS} 秒。`);
    }
    const sessionLabel = boundedText(input.sessionLabel, "雀魂直播", 40);
    const handLabel = boundedText(input.handLabel, "本局", 40);
    const title = boundedText(input.title, template.title, 80);
    const nowMs = Date.now();
    const market = await this.repository.createMarket({
      sessionLabel,
      handLabel,
      marketType: template.type,
      title,
      options: template.options.map((option) => ({ ...option })),
      payoutRate: PAYOUT_RATE,
      openSeconds,
      lockAtMs: nowMs + openSeconds * 1000,
    });
    return publicMarket(market);
  }

  async lockCurrentMarket() {
    const current = await this.repository.getCurrentMarket();
    if (!current) throw new Error("目前沒有盤口。");
    return publicMarket(await this.repository.lockMarket(current.marketId, "manual"));
  }

  async settleCurrentMarket(input = {}) {
    const current = await this.repository.getCurrentMarket();
    if (!current) throw new Error("目前沒有盤口。");
    const winningOptionId = String(input.winningOptionId || "").trim();
    if (!(current.options || []).some((option) => option.id === winningOptionId)) throw new Error("請選擇正確的結算結果。");
    const han = input.han == null || input.han === "" ? null : Math.floor(Number(input.han));
    if (han != null && (!Number.isFinite(han) || han < 0 || han > 99)) throw new Error("番數需為 0～99。");
    const market = await this.repository.settleMarket({
      marketId: current.marketId,
      winningOptionId,
      resultMeta: { han, note: boundedText(input.note, "", 120) },
    });
    return publicMarket(market);
  }

  async voidCurrentMarket(input = {}) {
    const current = await this.repository.getCurrentMarket();
    if (!current) throw new Error("目前沒有盤口。");
    const reason = boundedText(input.reason, "主播作廢並全額退款", 120);
    return publicMarket(await this.repository.voidMarket({ marketId: current.marketId, reason }));
  }

  async getOverlayState() {
    const current = await this._currentMarket();
    const recent = await this.repository.listRecentMarkets(1);
    return {
      now: Date.now(),
      currency: this.getConfig().currency,
      currentMarket: publicMarket(current),
      lastResult: recent[0] ? publicMarket(recent[0]) : null,
    };
  }
}

module.exports = { MahjongPredictionService, taipeiDayKey, publicMarket };
