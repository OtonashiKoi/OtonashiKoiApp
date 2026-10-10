"use strict";

const { WORLD_BOSS_CHEST_BY_MONSTER } = require("./zoneBattleState");
const { getLeaderboardExcludedPlayerIds, filterDamageMapForLeaderboard, filterDamageMapForParticipants } = require("../../shared/leaderboardEligibility");
const announceChestRanking = (...args) => require("./battlePresentation").announceChestRanking(...args);

function _resolveWorldBossChestId(monster, zoneKey) {
  return WORLD_BOSS_CHEST_BY_MONSTER[monster?.id]
    || (zoneKey === "elite" ? "chest-daishi-king"
      : zoneKey === "dragon_king_lair" ? "chest-dragon-king"
      : zoneKey === "hellfire_depths" ? "chest-hellfang-king"
      : zoneKey === "event_boss" ? "chest-island-turtle" : null);
}

function _buildChestEntry(chestItem, sourceMonsterId) {
  return {
    uuid: crypto.randomUUID(), itemId: chestItem.id, itemName: chestItem.name,
    itemEffect: chestItem.effect || { type: "none", value: 0 },
    useEffects: chestItem.useEffects || [], passiveEffects: [], procEffects: [], combatEffects: [],
    itemType: chestItem.itemType || "consumable",
    imageUrl: chestItem.imageUrl || null, imageThumbnailUrl: chestItem.imageThumbnailUrl || null,
    equipSlot: null, equipStats: {}, weaponType: null, isTwoHanded: false, atkStat: null,
    tier: chestItem.tier || null, monsterCardSkill: null, enhanceLevel: 0, stackCount: 1,
    source: "world_boss_contribution", sourceRef: sourceMonsterId || null,
    purchasedAt: new Date().toISOString(),
  };
}

async function _grantChestToPlayer(sc, pid, chestItem, sourceMonsterId) {
  const entry = _buildChestEntry(chestItem, sourceMonsterId);
  if (typeof sc.progressRepository.addOrStackInventoryItem === "function") {
    return sc.progressRepository
      .addOrStackInventoryItem(pid, chestItem.id, entry)
      .catch((e) => {
        console.error(`[WorldBossChest] atomic grant error pid=${pid}:`, e?.message || e);
        return { ok: false, uuid: null, stacked: false };
      });
  }
  // 後備：舊式 read-modify-write CAS（僅在 repository 未提供原子方法時走）
  for (let attempt = 0; attempt < 3; attempt++) {
    const prog = await sc.progressRepository.findByPlayerId(pid).catch(() => null);
    if (!prog) return { ok: false, uuid: null };
    const inv = Array.isArray(prog.inventory) ? prog.inventory.map((e) => ({ ...e })) : [];
    const existing = inv.find((e) => e.itemId === chestItem.id);
    let chestUuid;
    if (existing) {
      existing.stackCount = Math.max(1, Number(existing.stackCount) || 1) + 1;
      chestUuid = existing.uuid;
    } else {
      chestUuid = entry.uuid;
      inv.push({ ...entry });
    }
    const next = { ...prog, inventory: inv, updatedAt: new Date().toISOString() };
    let saved;
    if (typeof sc.progressRepository.saveIfUnchanged === "function") {
      saved = await sc.progressRepository.saveIfUnchanged(next, prog.updatedAt);
    } else {
      await sc.progressRepository.save(next); saved = true;
    }
    if (saved) return { ok: true, uuid: chestUuid };
  }
  return { ok: false, uuid: null };
}

function _worldBossChestCountForRank(rank, totalParticipants) {
  if (rank >= 4) return 1;
  const bonusCap = 4 - rank; // rank1→3, rank2→2, rank3→1
  const bonus = Math.max(0, Math.min(bonusCap, Math.floor((totalParticipants - (rank - 1)) / 3)));
  return 1 + bonus;
}

function _rankWorldBossChestContributors(entries) {
  return [...entries]
    .sort((a, b) => b.cScore - a.cScore
      || b.damage - a.damage
      || b.assist - a.assist
      || String(a.pid).localeCompare(String(b.pid)))
    .slice(0, 6);
}

function _worldBossSafeDisplayName(displayName, pid) {
  const name = String(displayName || "").trim();
  const id = String(pid || "");
  if (!name || name === id || /^\d{15,}$/.test(name) || /^玩家#\d+$/.test(name)) {
    return "某位勇者";
  }
  return name;
}

async function _resolveWorldBossDisplayName(displayName, pid) {
  const safeFallback = _worldBossSafeDisplayName(displayName, pid);
  if (safeFallback !== "某位勇者") return safeFallback;
  try {
    const { resolveDiscordName } = require("../../shared/announceTownChat");
    const discordName = await resolveDiscordName(pid);
    return _worldBossSafeDisplayName(discordName, pid);
  } catch (_) {
    return safeFallback;
  }
}

async function _awardWorldBossContributionChests(sc, zoneKey, monster, damageMap, perPidRewards, participantIds = null) {
  try {
    const chestId = _resolveWorldBossChestId(monster, zoneKey);
    if (!chestId) return;
    const chestItem = await sc.itemRepository.findById(chestId).catch(() => null);
    if (!chestItem) { console.warn(`[WorldBossChest] chest item ${chestId} not found`); return; }

    // KDA（附錄C 八）：傷害名次換成「貢獻分 C」名次——C = 傷害 + 0.7×助攻（damageMap.assist，
    // 由各入口結算時從 assistLedger 累進）。輔助職靠光環/治療也分得到王箱。
    const { A_WEIGHT } = require("../../services/kda/kdaService");
    const excludedIds = await getLeaderboardExcludedPlayerIds();
    const eligibleDamageMap = filterDamageMapForParticipants(
      filterDamageMapForLeaderboard(damageMap || {}, excludedIds),
      participantIds
    );
    const entries = Object.entries(eligibleDamageMap).map(([pid, d]) => ({
      pid, name: d?.name || pid, damage: Number(d?.damage) || 0, assist: Number(d?.assist) || 0,
    })).map((e) => ({ ...e, cScore: e.damage + A_WEIGHT * e.assist }))
      .filter((e) => e.cScore > 0);
    if (entries.length === 0) return;

    const totalParticipants = entries.length;
    const ranked = _rankWorldBossChestContributors(entries);

    const mark = (pid) => {
      if (perPidRewards && perPidRewards[pid]) {
        perPidRewards[pid].chestAwarded = perPidRewards[pid].chestAwarded || [];
        perPidRewards[pid].chestAwarded.push(chestItem.name);
      }
    };
    const granted = [];       // { name, count }
    const grantedWinners = []; // { pid, name, uuid }（推播用，每箱各一筆）
    const auditRows = [];      // 每位得主的發箱結果（成功/失敗，含應得箱數）

    for (let i = 0; i < ranked.length; i++) {
      const w = ranked[i];
      const displayName = await _resolveWorldBossDisplayName(w.name, w.pid);
      const rank = i + 1;
      const boxCount = _worldBossChestCountForRank(rank, totalParticipants);
      let successCount = 0;
      for (let n = 0; n < boxCount; n++) {
        const r = await _grantChestToPlayer(sc, w.pid, chestItem, monster?.id);
        if (r.ok) { successCount++; grantedWinners.push({ pid: w.pid, name: displayName, uuid: r.uuid }); }
        else console.error(`[WorldBossChest] grant FAILED pid=${w.pid} name=${w.name} chest=${chestItem.id}`);
      }
      auditRows.push({
        pid: w.pid, name: displayName, rank, damage: w.damage, assist: w.assist || 0,
        cScore: Math.round(w.cScore || 0), boxCount, successCount,
      });
      if (successCount > 0) { granted.push({ name: displayName, count: successCount }); mark(w.pid); }
    }

    // 持久化發箱稽核 log（成功/失敗都記）→ 日後「沒拿到箱子」爭議可直接查 worldBossChestGrants
    try {
      const { getMongoDb } = require("../../adapters/mongo/createMongoClient");
      const db = await getMongoDb();
      await db.collection("worldBossChestGrants").insertOne({
        ts: new Date(), zoneKey, monsterId: monster?.id || null, monsterName: monster?.name || null,
        chestId: chestItem.id, chestName: chestItem.name,
        totalParticipants,
        grantedCount: auditRows.reduce((s, a) => s + a.successCount, 0),
        failedCount: auditRows.reduce((s, a) => s + (a.boxCount - a.successCount), 0),
        winners: auditRows,
      });
    } catch (e) {
      console.error("[WorldBossChest] audit log write failed:", e?.message || e);
    }

    if (!granted.length) return;

    // 推播給每位獲箱者 → 網頁不論在哪都彈出「世界王寶箱」視窗（可當下開啟或先收進背包）
    try {
      const { playerEventBus } = require("../../services/realtime/playerEventBus");
      for (const w of grantedWinners) {
        playerEventBus.emit(String(w.pid), {
          type: "world_boss_chest",
          data: {
            chestUuid: w.uuid,
            chestItemId: chestItem.id,
            chestName: chestItem.name,
            chestImage: chestItem.imageUrl || chestItem.imageThumbnailUrl || null,
            chestTier: chestItem.tier || null,
            bossName: monster?.name || "世界王",
            ts: new Date().toISOString()
          }
        });
      }
    } catch (_) { /* 推播失敗不影響發箱 */ }

    const rankLine = granted.map((g, i) => `${i + 1}. ${g.name}${g.count > 1 ? ` ×${g.count}` : ""}`).join("　");
    const lines = [
      `🎁 **${monster.name}** 討伐結算！`,
      `🏆 整體貢獻度前 ${granted.length} 名，各獲得 **${chestItem.name}**：`,
      rankLine,
    ];
    try {
      await announceChestRanking(lines);
    } catch (_) { /* 公告失敗不影響發箱 */ }
  } catch (e) {
    console.error("[WorldBossChest] award failed:", e?.message || e);
  }
}
module.exports = { _resolveWorldBossChestId, _buildChestEntry, _grantChestToPlayer, _worldBossChestCountForRank, _rankWorldBossChestContributors, _worldBossSafeDisplayName, _resolveWorldBossDisplayName, _awardWorldBossContributionChests };
