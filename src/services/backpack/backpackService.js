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

// 會員位階由低到高；用來在多個來源間取「最高位階」。E/D 不算會員(→150)。
const TIER_ORDER = ["E", "D", "C", "B", "A", "S", "SS"];
function higherTier(a, b) {
  const ia = TIER_ORDER.indexOf(a || ""); const ib = TIER_ORDER.indexOf(b || "");
  return ib > ia ? b : a;
}
function highestTier(list) {
  let best = null;
  for (const t of list) { if (t && TIER_ORDER.includes(t)) best = higherTier(best, t); }
  return best;
}

// 解析結果快取（避免每次都查 DB / 打 Discord），TTL 10 分鐘。
const _cache = new Map(); // discordId -> { tier, cap, label, at }
const TTL_MS = 10 * 60 * 1000;

function capForTier(rank) {
  return CAPACITY_BY_TIER[rank] || NON_MEMBER_CAP;
}

// 佔背包容量的「主要穿戴裝備」槽位；卡片(special)/錨點/職業徽章/稱號等收藏‧功能格不佔容量。
const CAPACITY_GEAR_SLOTS = new Set([
  "head_top", "head_mid", "head_low", "armor", "weapon", "shield",
  "garment", "shoes", "accessory_l", "accessory_r"
]);
/** 這件是否佔背包容量（只有主要穿戴裝備算；卡片/錨點/徽章/稱號、素材/寶石/蛋等不算）。 */
function countsTowardCapacity(e) {
  if (!e || e.itemType !== "equipment") return false;
  const slot = String(e.equipSlot || "");
  if (slot.startsWith("special") || slot === "anchor" || slot === "job_eq" || slot === "title_eq") return false;
  if (e.isNpcCard || e.monsterCardOf || e.monsterCardSkill) return false; // 卡片保險判定
  return CAPACITY_GEAR_SLOTS.has(slot) || (!slot); // 有槽位就依清單；無槽位的舊資料保守算佔格
}

/** 目前背包裡「佔格裝備」數量。 */
function countEquipment(inventory) {
  if (!Array.isArray(inventory)) return 0;
  return inventory.filter(countsTowardCapacity).length;
}

/**
 * 解析玩家的裝備格上限（含快取）。回傳 { tier, cap, label }。
 * 依據＝「設定頁確認的綁定會員位階」為主（streamAccountBindings.playerTierAtLink / linkedSupportAtLink），
 * 這是最可靠、玩家自己看得到的來源。另外把 progress.playerTier 與即時 Discord 身分組也納入，
 * 三者取「最高位階」——只加不減，不會因為某一路暫時抓不到就把會員背包縮回 150。
 */
async function resolveCapacity(discordId) {
  const now = Date.now();
  const hit = _cache.get(discordId);
  if (hit && (now - hit.at) < TTL_MS) return { tier: hit.tier, cap: hit.cap, label: hit.label };

  const tiers = [];

  // 1) 綁定會員位階（設定頁「✓會員 / 會員位階」的來源；確定有綁定即認列）
  try {
    const binds = await serviceContext.streamAccountBindingRepository.listByDiscordId(discordId).catch(() => []);
    for (const b of binds || []) {
      const isMember = Boolean(b.linkedSupportAtLink) || Boolean(b.playerTierAtLink);
      if (isMember) tiers.push(b.playerTierAtLink || "C"); // 是會員但未帶明確位階 → 至少最低會員階 C
    }
  } catch (_) { /* 綁定讀取失敗 → 略過此來源 */ }

  // 2) 遊戲記錄的會員位階
  try {
    const prog = await serviceContext.progressRepository.findByPlayerId(discordId).catch(() => null);
    if (prog?.playerTier) tiers.push(prog.playerTier);
  } catch (_) { /* 略過 */ }

  // 3) 即時 Discord 身分組（有查到就加分；失敗完全不影響上面兩個來源）
  try {
    const client = getBotClient();
    const guildId = config.discord.guildId;
    if (client?.isReady?.() && guildId) {
      const guild = await client.guilds.fetch(guildId).catch(() => null);
      if (guild) {
        const { fetchGuildMemberSafe } = require("../../shared/discordMemberFetch");
        const member = await fetchGuildMemberSafe(guild, discordId, { force: false }).catch(() => null);
        if (member) {
          const roleTier = await serviceContext.playerTierService.resolveHighestTier([...member.roles.cache.keys()]).catch(() => null);
          if (roleTier) tiers.push(roleTier);
        }
      }
    }
  } catch (_) { /* 略過 */ }

  const tier = highestTier(tiers);
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
  let w = wallet;
  if (!w) w = await serviceContext.walletRepository.findByPlayerId(discordId).catch(() => null);
  const bonus = Number(w?.bonusBackpackSlots) || 0;   // 花鑽永久格
  const season = Number(w?.seasonBackpackSlots) || 0; // 賽季格（圖鑑券等，換季清零）
  const cap = effectiveCap(tierCap, bonus + season);
  return { tier, tierCap, bonusSlots: bonus, seasonSlots: season, cap, label, canBuyMore: cap < MAX_CAPACITY };
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
  const curSeason = Number(wallet.seasonBackpackSlots) || 0;
  if (effectiveCap(tierCap, curBonus + curSeason) >= MAX_CAPACITY) {
    throw new AppError(ERROR_CODES.INVALID_ARGUMENT, `背包已達上限 ${MAX_CAPACITY} 格，無法再擴充`, 400);
  }
  if ((Number(wallet.diamond) || 0) < DIAMOND_COST_PER_PURCHASE) {
    throw new AppError(ERROR_CODES.INSUFFICIENT_FUNDS, "鑽石不足，擴充背包需要 1 顆鑽石", 400);
  }

  const updated = await walletRepo.purchaseBackpackSlots(discordId, DIAMOND_COST_PER_PURCHASE, SLOTS_PER_PURCHASE);
  if (!updated) throw new AppError(ERROR_CODES.INSUFFICIENT_FUNDS, "鑽石不足，擴充背包需要 1 顆鑽石", 400);

  const newBonus = Number(updated.bonusBackpackSlots) || 0;
  return {
    capacity: effectiveCap(tierCap, newBonus + curSeason),
    bonusSlots: newBonus,
    diamond: Number(updated.diamond) || 0,
    tier,
    tierCap,
    maxCapacity: MAX_CAPACITY,
  };
}

/**
 * 純發放背包格（不扣鑽；消耗品/獎勵用）。自動封頂到 MAX_CAPACITY。
 * @returns {Promise<{ capacity:number, bonusSlots:number, added:number, maxCapacity:number }>}
 */
async function grantSlots(discordId, slots = SLOTS_PER_PURCHASE) {
  const walletRepo = serviceContext.walletRepository;
  const wallet = await walletRepo.findByPlayerId(discordId);
  if (!wallet) throw new AppError(ERROR_CODES.PLAYER_NOT_FOUND, "找不到錢包資料", 404);
  const { cap: tierCap } = await resolveCapacity(discordId);
  const curBonus = Number(wallet.bonusBackpackSlots) || 0;
  const curSeason = Number(wallet.seasonBackpackSlots) || 0;
  const curCap = effectiveCap(tierCap, curBonus + curSeason);
  const room = Math.max(0, MAX_CAPACITY - curCap);
  const add = Math.max(0, Math.min(Number(slots) || 0, room));
  if (add <= 0) {
    return { capacity: curCap, seasonSlots: curSeason, added: 0, maxCapacity: MAX_CAPACITY };
  }
  const updated = await walletRepo.grantBackpackSlots(discordId, add); // 加到賽季格
  const newSeason = Number(updated?.seasonBackpackSlots) || (curSeason + add);
  invalidate(discordId);
  return { capacity: effectiveCap(tierCap, curBonus + newSeason), seasonSlots: newSeason, added: add, maxCapacity: MAX_CAPACITY };
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
  countsTowardCapacity,
  grantSlots,
  resolveCapacity,
  resolveEffectiveCapacity,
  purchaseSlots,
  invalidate
};
