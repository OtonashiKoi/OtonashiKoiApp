// 背包容量：依會員等級決定裝備格數上限。
// 只有「裝備(equipment)」佔格；可疊的素材/寶石/蛋/消耗品不佔格。
// 會員對應(config.js)：C=鯉民 / B=鯉長 / A=鯉市長。
const config = require("../../config");
const { getBotClient } = require("../../bot/runtimeContext");
const { serviceContext } = require("../../bot/runtimeContext");

// 各等級裝備格上限（非會員 / E / D = 150）
const CAPACITY_BY_TIER = { C: 300, B: 500, A: 800, S: 1200, SS: 1500 };
const NON_MEMBER_CAP = 150;

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

module.exports = {
  CAPACITY_BY_TIER,
  NON_MEMBER_CAP,
  capForTier,
  countEquipment,
  resolveCapacity,
  invalidate
};
