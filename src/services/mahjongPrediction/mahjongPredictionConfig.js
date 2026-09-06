"use strict";

const INITIAL_KOI_TICKETS = 10_000;
const DAILY_KOI_TICKETS = 1_000;
const BET_MIN = 100;
const BET_MAX = 5_000;
const DEFAULT_OPEN_SECONDS = 20;
const MIN_OPEN_SECONDS = 10;
const MAX_OPEN_SECONDS = 120;
const PAYOUT_RATE = 0.9;

const MARKET_TEMPLATES = Object.freeze({
  win: Object.freeze({
    type: "win",
    title: "本局音無恋能和牌嗎？",
    options: Object.freeze([
      Object.freeze({ id: "win", label: "能和牌", shortLabel: "能" }),
      Object.freeze({ id: "no_win", label: "不能和牌", shortLabel: "不能" }),
    ]),
  }),
  han: Object.freeze({
    type: "han",
    title: "本局最終和牌級別？",
    options: Object.freeze([
      Object.freeze({ id: "no_win", label: "未和牌", shortLabel: "未和" }),
      Object.freeze({ id: "han_1_2", label: "1–2 番", shortLabel: "1–2番" }),
      Object.freeze({ id: "han_3_4", label: "3–4 番", shortLabel: "3–4番" }),
      Object.freeze({ id: "mangan_plus", label: "滿貫以上", shortLabel: "滿貫+" }),
    ]),
  }),
});

function getMarketTemplate(type) {
  return MARKET_TEMPLATES[String(type || "").trim()] || null;
}

function estimateOptionOdds(market) {
  const pools = market?.pools || {};
  const total = Math.max(0, Number(market?.totalStaked) || 0);
  const payoutRate = Math.max(0, Math.min(1, Number(market?.payoutRate ?? PAYOUT_RATE)));
  return (market?.options || []).map((option) => {
    const pool = Math.max(0, Number(pools[option.id]) || 0);
    const losingPool = Math.max(0, total - pool);
    const odds = pool > 0 ? 1 + (losingPool * payoutRate) / pool : null;
    return {
      ...option,
      pool,
      sharePct: total > 0 ? Math.round((pool / total) * 10_000) / 100 : 0,
      estimatedOdds: odds == null ? null : Math.round(odds * 100) / 100,
    };
  });
}

function calculateSettlement(market, bets, winningOptionId) {
  const pools = market?.pools || {};
  const totalStaked = Math.max(0, Number(market?.totalStaked) || 0);
  const winningPool = Math.max(0, Number(pools[winningOptionId]) || 0);
  const losingPool = Math.max(0, totalStaked - winningPool);
  const payoutRate = Math.max(0, Math.min(1, Number(market?.payoutRate ?? PAYOUT_RATE)));
  let totalPayout = 0;

  const outcomes = (bets || []).map((bet) => {
    const won = bet.optionId === winningOptionId;
    const amount = Math.max(0, Math.floor(Number(bet.amount) || 0));
    const profit = won && winningPool > 0
      ? Math.floor((amount / winningPool) * losingPool * payoutRate)
      : 0;
    const payout = won ? amount + profit : 0;
    totalPayout += payout;
    return { ...bet, won, payout, profit };
  });

  return {
    outcomes,
    totalStaked,
    winningPool,
    losingPool,
    totalPayout,
    houseTake: Math.max(0, totalStaked - totalPayout),
  };
}

module.exports = {
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
  calculateSettlement,
};
