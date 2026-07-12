// 會員(Discord tier 身分組)變動追蹤
// ------------------------------------------------
// 掛在 Discord GuildMemberUpdate：比對成員在「tier 身分組」上的增減，
// 換算成最高等級的變化，寫進記錄層(streamRecordsService)。
//
// 註：Discord 身分組只能抓到「加入/掉會員/升降級」；「續約(renew)」因為身分組
//     一直掛著沒有離散事件，需靠 YouTube 會員 API 到期日比對，屬於後續增強。

const {
  diffTier,
  recordMembershipChange,
  touchMemberConfirmed,
  listMembershipStatuses
} = require("./streamRecordsService");

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

/**
 * 定期快照比對：掃描整個伺服器目前誰掛著「會員等級身分組」，和上次現況比對。
 * - 這次有、上次沒有 → 補記 join（含上線前就有的舊會員，一次補進來）
 * - 這次等級和上次不同 → 記 upgrade/downgrade
 * - 這次一樣 → 只更新「最後確認時間」，不灌 log
 * - 上次是會員、這次沒掃到（身分組被拔或退群） → 記 expire ← 這就是「用時間判斷到期」
 *
 * 完全不改動任何人的身分組，零風險；無論身分組是 bot 自動同步或手動發都適用。
 *
 * @param {import("discord.js").Guild} guild
 * @param {object} serviceContext 需含 playerTierService
 * @param {{ source?: string }} [opts]
 * @returns {Promise<object>} 本次比對摘要
 */
async function reconcileMembership(guild, serviceContext, opts = {}) {
  const source = opts.source || "reconcile";
  try {
    const playerTierService = serviceContext?.playerTierService;
    if (!guild || !playerTierService?.getTiers) return { skipped: true, reason: "no-guild-or-service" };

    const tiers = await playerTierService.getTiers();
    const allTierRoleIds = new Set();
    for (const rank of Object.keys(tiers || {})) {
      for (const id of (tiers[rank]?.roleIds || [])) allTierRoleIds.add(String(id));
    }
    if (allTierRoleIds.size === 0) return { skipped: true, reason: "no-tier-roles" };

    await guild.members.fetch();

    // 上次的「會員名單」，用來比對誰掉了
    const prevActive = await listMembershipStatuses({ activeOnly: true, limit: 5000 });
    const prevMap = new Map(prevActive.map((s) => [String(s.discordId), s]));

    const seen = new Set();
    let currentMembers = 0, joins = 0, changes = 0, touched = 0, expiries = 0;

    for (const member of guild.members.cache.values()) {
      if (member.user?.bot) continue;
      const roleIds = [...member.roles.cache.keys()];
      if (!roleIds.some((id) => allTierRoleIds.has(String(id)))) continue;
      const rank = await playerTierService.resolveHighestTier(roleIds).catch(() => null);
      if (!rank) continue;

      currentMembers += 1;
      seen.add(member.id);
      const displayName = member.displayName || member.user?.username || member.id;
      const prev = prevMap.get(String(member.id));

      if (!prev || !prev.isMember) {
        await recordMembershipChange({
          discordId: member.id, displayName, event: "join",
          fromTier: prev?.currentTier || null, toTier: rank,
          fromLabel: prev?.currentLabel || null, toLabel: tiers[rank]?.label || null, source
        });
        joins += 1;
      } else if (prev.currentTier !== rank) {
        const ev = diffTier(prev.currentTier, rank) || "role_change";
        await recordMembershipChange({
          discordId: member.id, displayName, event: ev,
          fromTier: prev.currentTier, toTier: rank,
          fromLabel: prev.currentLabel || null, toLabel: tiers[rank]?.label || null, source
        });
        changes += 1;
      } else {
        await touchMemberConfirmed({ discordId: member.id, displayName, tier: rank, label: tiers[rank]?.label || null });
        touched += 1;
      }
    }

    // 上次是會員、這次沒掃到 → 到期
    // 防呆：批次 guild.members.fetch() 若因 Discord 限流/不完整回傳過少成員，會把一堆現任會員誤判「到期」，
    //       下次又「回鍋」→ 到期↔回鍋來回跳、tier 一直歸零害背包容量掉。
    //   (1) 掃到的成員數比上次會員名單還少 → 批次明顯壞掉，整輪不判到期。
    //   (2) 逐一「單獨強制抓一次」二次確認：還有會員身分組→補確認不判；確定退群/拔組才判到期；抓失敗(限流)保守略過。
    // 用「寬限期」避免限流/批次不完整誤判：最近 EXPIRE_GRACE_MS 內確認過的會員，單次沒掃到不判到期。
    // （不逐一 force-fetch——那會打爆已被 Discord 限流的 /guilds/:id/members/:id 單一成員路由，反而更慘。）
    const EXPIRE_GRACE_MS = 6 * 60 * 60 * 1000; // 6 小時
    const nowMs = Date.now();
    if (guild.members.cache.size < prevActive.length) {
      console.warn(`[Membership] 批次成員不完整(掃到${guild.members.cache.size}<會員${prevActive.length})，本輪跳過到期判定`);
    } else {
      // 二次確認上限：只對「批次沒掃到」的少數人單獨強制抓，避免整批壞掉時打爆單一成員路由
      const MAX_FORCE_RECHECK = 30;
      let forceRechecks = 0;
      for (const s of prevActive) {
        if (seen.has(String(s.discordId))) continue;
        const lastConf = s.lastMemberConfirmedAt ? Date.parse(s.lastMemberConfirmedAt) : 0;
        // 最近才確認過會員 → 這次沒掃到多半是批次/限流問題，先不判到期（等連續 6h 都沒掃到才算真到期）
        if (lastConf && nowMs - lastConf < EXPIRE_GRACE_MS) continue;
        // 二次確認：批次 guild.members.fetch() 會系統性漏掉部分成員（同幾位反覆被誤判到期，且因永遠沒被掃到→
        //   lastMemberConfirmedAt 永不刷新→寬限期一過就每輪都到期）。判到期前對這少數人單獨強制抓一次：
        //   仍掛著 tier 身分組 → 補確認+刷新時間戳(必要時補記升降級)、不判到期；
        //   確定沒有 tier 身分組/退群 → 才真判到期；抓失敗(限流/未知) → 保守略過不判。
        if (forceRechecks < MAX_FORCE_RECHECK) {
          forceRechecks += 1;
          const fresh = await guild.members.fetch({ user: String(s.discordId), force: true }).catch(() => null);
          if (!fresh) continue; // 抓不到(限流/暫時性) → 不判到期
          const freshRoleIds = [...fresh.roles.cache.keys()];
          if (freshRoleIds.some((id) => allTierRoleIds.has(String(id)))) {
            // 其實還是會員，批次漏掉而已 → 補確認、刷新 lastMemberConfirmedAt，不判到期
            const freshRank = await playerTierService.resolveHighestTier(freshRoleIds).catch(() => null);
            if (freshRank) {
              await touchMemberConfirmed({ discordId: s.discordId, displayName: s.displayName, tier: freshRank, label: tiers[freshRank]?.label || null });
              if (s.currentTier !== freshRank) {
                await recordMembershipChange({
                  discordId: s.discordId, displayName: s.displayName, event: diffTier(s.currentTier, freshRank) || "role_change",
                  fromTier: s.currentTier, toTier: freshRank, fromLabel: s.currentLabel || null, toLabel: tiers[freshRank]?.label || null, source
                });
              }
              continue;
            }
          }
          // fresh 抓到了、且確定沒有 tier 身分組 → 往下真判到期
        } else {
          continue; // 超過二次確認上限 → 本輪保守不判(等下輪)
        }
        await recordMembershipChange({
          discordId: s.discordId, displayName: s.displayName, event: "expire",
          fromTier: s.currentTier, toTier: null, fromLabel: s.currentLabel || null, source
        });
        expiries += 1;
      }
    }

    const summary = { scanned: guild.members.cache.size, currentMembers, joins, changes, touched, expiries, at: new Date().toISOString() };
    console.log("[Membership] reconcile 完成：", JSON.stringify(summary));
    return summary;
  } catch (err) {
    console.warn("[Membership] reconcileMembership 失敗：", err?.message || err);
    return { error: err?.message || String(err) };
  }
}

module.exports = { trackMembershipChange, reconcileMembership };
