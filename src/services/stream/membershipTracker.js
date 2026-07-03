// 會員(Discord tier 身分組)變動追蹤
// ------------------------------------------------
// 掛在 Discord GuildMemberUpdate：比對成員在「tier 身分組」上的增減，
// 換算成最高等級的變化，寫進記錄層(streamRecordsService)。
//
// 註：Discord 身分組只能抓到「加入/掉會員/升降級」；「續約(renew)」因為身分組
//     一直掛著沒有離散事件，需靠 YouTube 會員 API 到期日比對，屬於後續增強。

const { diffTier, recordMembershipChange } = require("./streamRecordsService");

/**
 * @param {import("discord.js").GuildMember} oldMember
 * @param {import("discord.js").GuildMember} newMember
 * @param {object} serviceContext 需含 playerTierService
 */
async function trackMembershipChange(oldMember, newMember, serviceContext) {
  try {
    const playerTierService = serviceContext?.playerTierService;
    if (!playerTierService?.getTiers) return;

    const tiers = await playerTierService.getTiers();
    const allTierRoleIds = new Set();
    for (const rank of Object.keys(tiers || {})) {
      for (const id of (tiers[rank]?.roleIds || [])) allTierRoleIds.add(String(id));
    }
    // 尚未設定任何 tier 身分組 → 無從追蹤，直接跳過
    if (allTierRoleIds.size === 0) return;

    const oldRoleIds = oldMember?.roles?.cache ? [...oldMember.roles.cache.keys()] : [];
    const newRoleIds = newMember?.roles?.cache ? [...newMember.roles.cache.keys()] : [];

    // 只在乎「tier 身分組」有增減；其他一般身分組變動不記
    const addedTierRoleIds = newRoleIds.filter((id) => !oldRoleIds.includes(id) && allTierRoleIds.has(String(id)));
    const removedTierRoleIds = oldRoleIds.filter((id) => !newRoleIds.includes(id) && allTierRoleIds.has(String(id)));
    if (addedTierRoleIds.length === 0 && removedTierRoleIds.length === 0) return;

    const oldRank = await playerTierService.resolveHighestTier(oldRoleIds).catch(() => null);
    const newRank = await playerTierService.resolveHighestTier(newRoleIds).catch(() => null);
    const event = diffTier(oldRank, newRank) || "role_change"; // 同級增減也留一筆稽核

    const displayName = newMember?.displayName || newMember?.user?.username || newMember?.id || "";

    await recordMembershipChange({
      discordId: newMember?.id,
      displayName,
      event,
      fromTier: oldRank,
      toTier: newRank,
      fromLabel: oldRank ? (tiers[oldRank]?.label || null) : null,
      toLabel: newRank ? (tiers[newRank]?.label || null) : null,
      addedTierRoleIds,
      removedTierRoleIds,
      source: "discord_role"
    });

    console.log(`[Membership] ${displayName} ${event} ${oldRank || "無"}→${newRank || "無"}`);
  } catch (err) {
    console.warn("[Membership] trackMembershipChange 失敗：", err?.message || err);
  }
}

module.exports = { trackMembershipChange };
