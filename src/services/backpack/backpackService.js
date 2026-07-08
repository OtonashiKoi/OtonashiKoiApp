// 背包容量：依會員等級決定裝備格數上限。
// 只有「裝備(equipment)」佔格；可疊的素材/寶石/蛋/消耗品不佔格。
// 會員對應(config.js)：C=鯉民 / B=鯉長 / A=鯉市長。
const config = require("../../config");
const { getBotClient } = require("../../bot/runtimeContext");
const { serviceContext } = require("../../bot/runtimeContext");
const { AppError, ERROR_CODES } = require("../../shared/errors");

// 各等級裝備格上限（非會員 / E / D = 150）
const CAPACITY_BY_TIER = { C: 300, B: 500, A: 800, S: 1200, SS: 1500 };
const NON_MEMBER_CAP = 150;

// 花鑽永久擴充背包格：1 鑽 = +20 格，總容量硬上限 2000 格。
const MAX_CAPACITY = 2000;
const SLOTS_PER_PURCHASE = 20;
const DIAMOND_COST_PER_PURCHASE = 1;

/** 有效容量 = min(2000, 階級上限 + 已購買的永久格數)。 */
function effectiveCap(tierCap, bonusSlots) {
  return Math.min(MAX_CAPACITY, (Number(tierCap) || NON_MEMBER_CAP) + Math.max(0, Number(bonusSlots) || 0));
}

const TIER_LABEL = { C: "鯉民", B: "鯉長", A: "鯉市長", S: "S級", SS: "SS級" };

// 解析結果快取（避免每次都打 Discord），TTL 10 分鐘
const _cache = new Map(); // discordId -> { tier, cap, label, at }
const TTL_MS = 10 * 60 * 1000;

function capForTier(rank) {
  return CAPACITY_BY_TIER[rank] || NON_MEMBER_CAP;
}

/** 目前背包裡「裝備」數量（佔格數）。 */
function countEquipment(inventory) {
  if (!Array.isArray(inventory)) return 0;
  return inventory.filter((e) => e && e.itemType === "equipment").length;
}

/** 解析玩家的裝備格上限（含快取）。回傳 { tier, cap, label }。 */
async function resolveCapacity(discordId) {
  const now = Date.now();
  const hit = _cache.get(discordId);
  if (hit && (now - hit.at) < TTL_MS) return { tier: hit.tier, cap: hit.cap, label: hit.label };

  let tier = null;
  try {
    const client = getBotClient();
    const guildId = config.discord.guildId;
    if (client?.isReady?.() && guildId) {
      const guild = await client.guilds.fetch(guildId).catch(() => null);
      const member = guild ? await guild.members.fetch({ user: discordId, force: false }).catch(() => null) : null;
      if (member) {
        const roleIds = [...member.roles.cache.keys()];
        tier = await serviceContext.playerTierService.resolveHighestTier(roleIds).catch(() => null);
      }
    }
  } catch (_) { /* 解析失敗 → 當非會員 */ }

  const cap = capForTier(tier);
  const label = tier ? (TIER_LABEL[tier] || tier) : "非會員";
  _cache.set(discordId, { tier, cap, label, at: now });
  return { tier, cap, label };
}

/** 清除某人的快取（會員變動時可呼叫）。 */
function invalidate(discordId) { _cache.delete(discordId); }

/**
 * 解析有效容量（含花鑽購買的永久格）。回傳 { tier, tierCap, bonusSlots, cap, label, canBuyMore }。
 * @param {string} discordId
 * @param {object} [wallet] 若已在外部取得 wallet 可傳入，省一次查詢。
 */
async function resolveEffectiveCapacity(discordId, wallet = null) {
  const { tier, cap: tierCap, label } = await resolveCapacity(discordId);
  let bonus = Number(wallet?.bonusBackpackSlots) || 0;
  if (!wallet) {
    const w = await serviceContext.walletRepository.findByPlayerId(discordId).catch(() => null);
    bonus = Number(w?.bonusBackpackSlots) || 0;
  }
  const cap = effectiveCap(tierCap, bonus);
  return { tier, tierCap, bonusSlots: bonus, cap, label, canBuyMore: cap < MAX_CAPACITY };
}

/**
 * 花 1 鑽永久 +20 背包格（總上限 2000）。原子扣鑽防重複/防負。
 * @returns {Promise<{ capacity:number, bonusSlots:number, diamond:number, tier:string|null, tierCap:number, maxCapacity:number }>}
 */
async function purchaseSlots(discordId) {
  const walletRepo = serviceContext.walletRepository;
  const wallet = await walletRepo.findByPlayerId(discordId);
  if (!wallet) throw new AppError(ERROR_CODES.PLAYER_NOT_FOUND, "找不到錢包資料", 404);

  const { cap: tierCap, tier } = await resolveCapacity(discordId);
  const curBonus = Number(wallet.bonusBackpackSlots) || 0;
  if (effectiveCap(tierCap, curBonus) >= MAX_CAPACITY) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, `背包已達上限 ${MAX_CAPACITY} 格，無法再擴充`, 400);
  }
  if ((Number(wallet.diamond) || 0) < DIAMOND_COST_PER_PURCHASE) {
    throw new AppError(ERROR_CODES.INSUFFICIENT_FUNDS, "鑽石不足，擴充背包需要 1 顆鑽石", 400);
  }

  const updated = await walletRepo.purchaseBackpackSlots(discordId, DIAMOND_COST_PER_PURCHASE, SLOTS_PER_PURCHASE);
  if (!updated) throw new AppError(ERROR_CODES.INSUFFICIENT_FUNDS, "鑽石不足，擴充背包需要 1 顆鑽石", 400);

  const newBonus = Number(updated.bonusBackpackSlots) || 0;
  return {
    capacity: effectiveCap(tierCap, newBonus),
    bonusSlots: newBonus,
    diamond: Number(updated.diamond) || 0,
    tier,
    tierCap,
    maxCapacity: MAX_CAPACITY,
  };
}

module.exports = {
  CAPACITY_BY_TIER,
  NON_MEMBER_CAP,
  MAX_CAPACITY,
  SLOTS_PER_PURCHASE,
  DIAMOND_COST_PER_PURCHASE,
  capForTier,
  effectiveCap,
  countEquipment,
  resolveCapacity,
  resolveEffectiveCapacity,
  purchaseSlots,
  invalidate
};
