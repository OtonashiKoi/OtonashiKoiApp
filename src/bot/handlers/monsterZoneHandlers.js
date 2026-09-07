"use strict";

const { handleMonsterKill, getServiceContext, isWorldBossAllPartsDefeated, recordQuestForPlayersInBackground, killInProgress, collectRewardEffectRefs, buildRewardModifiers, toPct, toMultiplier, getDynamicGoldPoolFloor, GOLD_POOL_RULE_BY_ZONE, buildMonsterDropPool, isMonsterCardItem, calculateFinalDropChance, RARE_TIERS, toWebDrop, getParticipationGemTiers, ZONE_PARTICIPATION_GEM_TIER, getNextEnhanceGemTier, GEM_TIER_ORDER, ENHANCE_GEM_IDS, GEM_PARTICIPATION_RATE, GEM_PARTICIPATION_DOUBLE_DROP_RATE, tryStackGem, ensureWorldBossPartState, createWorldBossPartHpTemplate, HUTAO_PREVIEW_ZONE, HELLFANG_ZONE, DRAGON_KING_ZONE, TURTLE_ZONE, sumWorldBossPartHp, freshHellfangFields, worldBossTimeoutTimers, _awardWorldBossContributionChests, _resolveWorldBossChestId, WORLD_BOSS_CHEST_BY_MONSTER, _rankWorldBossChestContributors, _resolveWorldBossDisplayName, _worldBossSafeDisplayName, _worldBossChestCountForRank, _grantChestToPlayer, _buildChestEntry, buildPartyRewardSummary, pickWeightedNextMonster, zoneLastChosen, _scheduleZoneEventFinalize, zoneEventTimers, _resolveZoneEventIfExpired, BOSS_SPAWN_BROADCAST_ENABLED, _startMonsterTransition, monsterTransitionTimers, MONSTER_TRANSITION_MS, activeMonsterTransitions, _resolveExpiredMonsterTransition, _doIdleRotate, recordQuestBattleProgress, resolveWeaponQuestMetric, isSupportJobBadge, SUPPORT_JOB_KEYS, resolveJobBattleMetric, MAX_ROUNDS, getWorldBossPartKeys, getWorldBossTargetProfile, applyWorldBossTargetToPlayerStats, applyWorldBossTargetToMonster, applyDragonKingBreakWeaken, parseWorldBossTargetPart, BTN, WORLD_BOSS_TARGET_PARTS, hellfangPlayerSchool, hellfangDamageMult, hellfangAlivePartCount, HELLFANG_CORE_PLAYER_MULT, hellfangPartCurrentWeak, HELLFANG_PART_WEAKNESS, HELLFANG_WRONG_TYPE_MULT, hellfangPartAccrue, HELLFANG_FLIP_FRACTION, HELLFANG_FLIP_DURATION_MS, hellfangFlipLines, HELLFANG_PART_LABELS, getHellfangFlipRemainingMs, getWorldBossPartWeakness, hellfangBossPhaseMods, HELLFANG_FRENZY_DODGE_BONUS, HELLFANG_FRENZY_DMG_MULT, applyWorldBossPhaseModifiers } = require("../../services/battle/zoneBattleService");


const { MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require("discord.js");
const { EFFECT_NAME_ZH } = require("../../shared/effectDisplayNames");
const { buildItemEffectLines } = require("../../shared/itemEffectLines");
const { ALL_ZONE_KEYS, featureKeyToZone: _featureKeyToZone, zoneToFeatureKey, canPlayerAccessZone, shouldBroadcastZoneActivity, getZoneTheme, getZoneDefaultEntryFee, checkZoneLevelRequirementWithBinding } = require("../../shared/zones");
const { isWorldBossZone, WORLD_BOSS_ZONES } = require("../../services/worldBoss/worldBossService");

// 這些效果的 params.value 代表百分比（percent），顯示時會特別格式化
const PERCENT_EFFECT_KEYS = new Set([
  'gold_gain_up', 'exp_gain_up', 'drop_rate_up', 'rare_drop_rate_up', 'monster_reward_up', 'checkin_bonus_up', 'enhance_success_up', 'event_trigger_rate_up'
]);
const { CURRENCY_SOURCES, EXP_SOURCES } = require("../../shared/sources");
const { calcPlayerStats, isOnlyDTierEquipped } = require("../../shared/combatStats");
const { getEquipmentTierSetBonuses } = require("../../shared/equipmentTierSetBonuses");
const { isEffectConditionMet, collectEquipmentEffects, mergeEquippedFromLibrary, applyEffectInstances, decrementActiveEffects } = require("../../shared/effectEngine");
const { scaleSupportPartyEffect, filterActiveAuras } = require("../../shared/supportAuraScaling");
const { mergeContributorMaps, allocateDirectDamage, mirrorDamageToOtherParts } = require("../../shared/supportContribution");
const { isPkBattleActive, replaceMonsterBattlePresence, isTowerBattleActive } = require("../../shared/battlePresence");
const { isWebBattleActive } = require("../../services/progress/battleLock");
const { getDropBoostPct } = require("../../shared/pkArenaConfig");
const { withPlayerProgressLock } = require("../../services/progress/progressLocks");
const { getLeaderboardExcludedPlayerIds, filterDamageMapForLeaderboard, filterDamageMapForParticipants } = require("../../shared/leaderboardEligibility");
const { clearCurrentCache } = require("../../adapters/mongo/requestCache");
const { NpcOptionEffectError, processNpcOptionEffects } = require("./npcOptionEffects");
const { bestiaryRequirement, bestiaryBonusPct, bestiaryGainFromDamage } = require("../../shared/bestiary");
const { getWorldBossPartLabel } = require("../../shared/worldBossParts");
const config = require("../../config");
const {
  isDiscordRestProtected,
  isTransientDiscordNetworkError,
  markDiscordRestError,
  resetDiscordRestAgent
} = require("../discordRestRecovery");

// 戰鬥 session 依 discordId 儲存（記憶體）
const activeSessions = new Map();
const pendingBattleReservations = new Map();
const battleActionLocks = new Map();

// 戰鬥冷卻記錄：key = discordId, value = { availableAt: timestamp }
const battleCooldowns = new Map();
// 死亡冷卻記錄：key = discordId, value = { availableAt: timestamp }
const deathCooldowns = new Map();

// 擊殺結算互斥鎖（防止兩名玩家同時打死同一隻怪造成雙重結算）
// key: `${zoneKey}:${monsterSeq}`





// track last chosen candidate per zone to avoid immediate repeats

const announcementWebhookCache = new Map();

// 排行榜去重：key = zoneKey, value = { lastPublishTime, lastDamageMap, pendingTimer }
// 防止戰鬥中頻繁編輯面板，最多 5 秒更新一次排行榜
const damageRankingDebounce = new Map();

const COOLDOWN_MAP_PRUNE_INTERVAL_MS = 5 * 60 * 1000;
let cooldownMapPruneTimer = null;

// 任務計數不影響本場傷害、掉落或經驗；擊殺結算不可等它寫完才回戰報。
// WeeklyQuestService 內部會依玩家序列化，這裡只負責把附帶進度移出核心結算鏈。


function pruneCooldownMap(map, now = Date.now()) {
  for (const [discordId, cooldown] of map.entries()) {
    if (Number(cooldown?.availableAt || 0) <= now) {
      map.delete(discordId);
    }
  }
}

function startCooldownMapPruneTimer() {
  if (cooldownMapPruneTimer) return;
  cooldownMapPruneTimer = setInterval(() => {
    const now = Date.now();
    pruneCooldownMap(battleCooldowns, now);
    pruneCooldownMap(deathCooldowns, now);
  }, COOLDOWN_MAP_PRUNE_INTERVAL_MS);
  cooldownMapPruneTimer.unref?.();
}

startCooldownMapPruneTimer();

function getMonsterZoneDiagnostics() {
  const sessionStates = {};
  const now = Date.now();
  let displayingOverdue = 0;
  let maxDisplayAgeSec = 0;
  let maxDisplayOverdueSec = 0;
  let displayCleanupTimers = 0;
  for (const session of activeSessions.values()) {
    const state = session?.state || "unknown";
    sessionStates[state] = (sessionStates[state] || 0) + 1;
    if (state === "displaying") {
      const startedAt = Number(session?.displayStartedAt || 0);
      const endsAt = Number(session?.displayEndsAt || 0)
        || (Number(session?.displayStartedAt || 0) + Number(session?.displayDurationMs || 0));
      if (startedAt) maxDisplayAgeSec = Math.max(maxDisplayAgeSec, Math.round((now - startedAt) / 1000));
      if (endsAt && now > endsAt + DISPLAYING_SESSION_CLEANUP_GRACE_MS) {
        displayingOverdue += 1;
        maxDisplayOverdueSec = Math.max(maxDisplayOverdueSec, Math.round((now - endsAt) / 1000));
      }
      if (session?.displayCleanupTimeoutId) displayCleanupTimers += 1;
    }
  }
  return {
    activeSessions: activeSessions.size,
    sessionStates,
    displayingOverdue,
    maxDisplayAgeSec,
    maxDisplayOverdueSec,
    displayCleanupTimers,
    pendingBattleReservations: pendingBattleReservations.size,
    battleActionLocks: battleActionLocks.size,
    battleCooldowns: battleCooldowns.size,
    deathCooldowns: deathCooldowns.size,
    killInProgress: killInProgress.size,
    zoneEventTimers: zoneEventTimers.size,
    monsterTransitionTimers: monsterTransitionTimers.size,
    activeMonsterTransitions: activeMonsterTransitions.size,
    worldBossTimeoutTimers: worldBossTimeoutTimers.size,
    announcementWebhookCache: announcementWebhookCache.size,
    damageRankingDebounce: damageRankingDebounce.size
  };
}

async function getAnnouncementWebhook(channel, name = "OtonashiKoi Announcements") {
  if (!channel?.isTextBased?.()) return null;
  const cached = announcementWebhookCache.get(channel.id);
  if (cached) return cached;
  if (typeof channel.fetchWebhooks !== "function" || typeof channel.createWebhook !== "function") {
    return null;
  }

  const webhooks = await channel.fetchWebhooks();
  let webhook = webhooks.find((w) => w.name === name && w.owner?.id === channel.client?.user?.id);
  if (!webhook) {
    webhook = await channel.createWebhook({
      name,
      reason: "Game announcement relay"
    });
  }
  announcementWebhookCache.set(channel.id, webhook);
  return webhook;
}

async function sendAnnouncementWebhook(channel, content, options = {}) {
  if (isDiscordRestProtected()) return false;
  try {
    const webhook = await getAnnouncementWebhook(channel);
    if (!webhook) return false;
    await webhook.send({
      content,
      username: options.username || "音無樂園公告",
      allowedMentions: options.allowedMentions || { parse: [] }
    });
    return true;
  } catch (error) {
    announcementWebhookCache.delete(channel?.id);
    markDiscordRestError(error, options.context || "announcement webhook");
    console.warn(`[AnnouncementWebhook] send failed: ${error?.message || error}`);
    return false;
  }
}

function syncMonsterBattlePresence() {
  replaceMonsterBattlePresence([...activeSessions.keys()]);
}

function setMonsterSession(discordId, session) {
  activeSessions.set(discordId, session);
  syncMonsterBattlePresence();
}

function deleteMonsterSession(discordId) {
  const session = activeSessions.get(discordId);
  if (session?.displayCleanupTimeoutId) {
    clearTimeout(session.displayCleanupTimeoutId);
    session.displayCleanupTimeoutId = null;
  }
  const removed = activeSessions.delete(discordId);
  if (removed) syncMonsterBattlePresence();
  return removed;
}

function cancelMonsterSession(discordId, reason = "戰鬥已取消。") {
  const session = activeSessions.get(discordId);
  if (!session) return false;
  session.cancelled = true;
  session.cancelReason = reason;
  if (session.timeoutId) {
    clearTimeout(session.timeoutId);
    session.timeoutId = null;
  }
  pendingBattleReservations.delete(discordId);
  return deleteMonsterSession(discordId);
}

function scheduleDisplayingSessionCleanup(discordId, displayEndsAtMs) {
  const session = activeSessions.get(discordId);
  if (!session || session.state !== "displaying") return;
  if (session.displayCleanupTimeoutId) {
    clearTimeout(session.displayCleanupTimeoutId);
  }
  const dueMs = Math.max(1_000, Number(displayEndsAtMs || 0) - Date.now() + DISPLAYING_SESSION_CLEANUP_GRACE_MS);
  session.displayCleanupTimeoutId = setTimeout(() => {
    const live = activeSessions.get(discordId);
    if (!live || live.state !== "displaying") return;
    const endsAt = Number(live.displayEndsAt || 0)
      || (Number(live.displayStartedAt || 0) + Number(live.displayDurationMs || 0));
    if (endsAt && Date.now() < endsAt + DISPLAYING_SESSION_CLEANUP_GRACE_MS) return;
    console.warn(`[MonsterZone] cleared stale displaying session | player=${discordId} | zone=${live.zoneKey || "?"} | monster=${live.monsterName || "?"}`);
    deleteMonsterSession(discordId);
  }, dueMs);
  session.displayCleanupTimeoutId.unref?.();
}

function clearQueuedEliteWorldBossSessions(reason = "世界BOSS 已結束，本次排隊已取消，請重新排隊。") {
  let cleared = 0;
  for (const [pid, session] of activeSessions.entries()) {
    if (!session || !isWorldBossZone(session.zoneKey)) continue;
    if (!["starting", "waiting", "queued"].includes(session.state)) continue;
    if (cancelMonsterSession(pid, reason)) cleared += 1;
  }
  return cleared;
}




const BATTLE_TIMEOUT_MS = 60 * 1000; // 1 分鐘未按開始戰鬥 → 視為逃跑
const ROUNDS_PER_TICK = 1;           // 每次更新顯示 1 回合，維持逐回合戰報節奏
const DISCORD_REPLY_RETRY_DELAY_MS = 700;
const DISCORD_REPLY_TIMEOUT_MS = 8_000;
const DISPLAYING_SESSION_CLEANUP_GRACE_MS = 15_000;
   // 怪物轉場空窗：0.5 秒
const BATTLE_QUEUE_POLL_MS = 500;    // 排隊等待輪詢：0.5 秒
const DEATH_COOLDOWN_MS = 30 * 1000; // 死亡後固定冷卻 30 秒，不受 AGI／裝備影響
// 世界王冷卻若超過此秒數，就不要把玩家鎖在佇列裡空等（避免「被王關起來」長達一小時無法戰鬥）；
// 改為直接釋放並提示稍後再來。低於此值才維持短暫自動排隊（王即將重生，值得等）。
const WORLD_BOSS_QUEUE_RELEASE_MS = 90 * 1000;

// 金幣池採「怪物原始金幣」與「參戰人數保底」取高。
// 這能保留傷害占比，同時避免多人共鬥時每個人分到的金幣太薄。


// 低階區戰力同步：高階裝備仍可使用，但單次戰鬥有效輸出會被壓到該區合理範圍。
const ZONE_DAMAGE_SYNC_RULES = {
  beginner: { maxHpRatioPerBattle: 0.30 },
  normal: { maxHpRatioPerBattle: 0.45 }
};
const DAMAGE_SYNC_NOTICE = "套用戰力同步：高階裝備與效果會暫時壓制到該區合理範圍。";

// AGI 攻速機制：AGI 1→1500ms，AGI 40→500ms（上限），屬性上限 60
// 公式：delay = 1500 - ((min(agi, 40) - 1) / 39) * 1000
const calculateTickDelay = (agi = 1) => {
  const baseDelay = 1500;
  const minDelay  = 500;
  const capAgi    = 40;
  const capped = Math.min(Math.max(1, agi), capAgi);
  return Math.round(baseDelay - ((capped - 1) / (capAgi - 1)) * (baseDelay - minDelay));
};


// 古龍王巢穴採 4 部位(含龍翼)+ 破鱗削弱;其餘世界王維持 3 部位

 // 島島龜王（活動）：潮汐/海嘯在 shared/turtleTide.js

// 地獄狼牙王(牙狼)：5 部位(3物2法) + 部位翻面機制

// 牙狼五部位「原生弱點」(吃 100% 的流派)：法系(上軀幹/尾巴) vs 物理(頭/下軀幹/腿)

   // 打錯流派 → 最多 30%
   // 部位累積受創達 1/3 HP → 翻面(一生一次)
 // 翻面持續 10 分鐘(=600秒/「600間隙」)後復原
// 分階段(依存活部位數)：
//  剩 3~2 部位「狂亂閃避」→ 迴避大增 + 王攻擊減半；剩 1 部位「最終核心」→ 迴避/王攻回正常、物法皆可打但玩家傷害×0.7
  // 狂亂期迴避 +40(命中牠約 -24%)
    // 狂亂期王攻擊 ×0.5
   // 最終核心：玩家對它傷害 ×0.7(物法皆可、不再翻面)









// 依目標部位調整「怪物」：頭部技能率↑ / 軀幹防禦↑ / 尾巴攻擊↑
//   回傳調整後的 { monsterStats, monsterEquipped }（皆 clone，不動原物件）




// ═══ 牙狼(地獄狼牙王) 適應性傷害機制 純函式 ═══
// 玩家攻擊流派：法杖與骰子=法系，其餘(劍/斧/槌/匕/弓)=物理

// 牙狼「存活部位數」(HP>0)：分階段機制的依據

// 牙狼「王側」分階段修正(給戰鬥設定調 battleMonsterStats)：
//  剩 3~2 部位 → 狂亂：迴避 +40、王攻擊 ×0.5；其餘(5~4 或最終 1) → 正常。回 {dodgeBonus, dmgMult, phase}

// 世界王部位「當前弱點」類型(給面板顯示)：牙狼翻面窗口內回翻面弱點、否則原生；最終核心(剩1)→null(物法皆可)；其餘世界王 null

// 牙狼部位「翻面剩餘毫秒」(給面板倒數)：翻面中回剩餘 ms、否則 0

// 部位「當前弱點」(=吃 100% 的流派)：翻面窗口內→翻面弱點；否則→原生弱點

// 這場玩家對牙狼的傷害倍率：
//  最終核心(剩1部位)→物法皆可、但玩家傷害 ×0.7；否則→同流派 100%、不同流派最多 30%

// 戰後累積該部位受創(依玩家流派歸屬有效傷害)；達 1/3 HP 且尚未翻過 → 翻面：
// 抵禦你用比較多的那系(弱點變成另一種)10 分鐘、一生一次。回傳翻面事件或 null。

// 翻面事件的戰報文案


// 以下兩個改為「依 partsHp 實際部位」運作,自動支援 3 或 4 部位




// 古龍王破鱗削弱:依「已破壞部位」削弱 BOSS 攻擊面(不削防禦)。回傳 clone。
//   下盤破→普攻−20% / 龍翼破→技能傷害−15% / 軀幹破→技能發動率→30% / 頭部破→無




function applyZoneDamageSync(zoneKey, startMonsterHp, monsterMaxHp, rawDamage, rawFinalMonsterHp, rawOutcome) {
  const raw = Math.max(0, Math.round(Number(rawDamage || 0)));
  const startHp = Math.max(0, Math.round(Number(startMonsterHp || 0)));
  const rawFinalHp = Math.max(0, Math.round(Number(rawFinalMonsterHp ?? Math.max(0, startHp - raw))));
  const rule = ZONE_DAMAGE_SYNC_RULES[zoneKey];

  if (!rule || raw <= 0) {
    return {
      damage: raw,
      monsterHp: rawFinalHp,
      outcome: rawOutcome,
      applied: false,
      notice: null
    };
  }

  const maxHp = Math.max(1, Math.round(Number(monsterMaxHp || startHp || 1)));
  const cap = Math.max(1, Math.round(maxHp * Number(rule.maxHpRatioPerBattle || 1)));
  const damage = Math.min(raw, cap, startHp);
  const monsterHp = Math.max(0, startHp - damage);
  const outcome = rawOutcome === "lose" ? "lose" : (monsterHp <= 0 ? "win" : "timeout");
  const applied = damage < raw;

  return {
    damage,
    monsterHp,
    outcome,
    applied,
    notice: applied ? `${DAMAGE_SYNC_NOTICE} 本次有效傷害 ${damage} / 原始傷害 ${raw}。` : DAMAGE_SYNC_NOTICE
  };
}





const _staleTransitionLogAt = new Map();
const STALE_TRANSITION_LOG_THROTTLE_MS = 60_000;

function hasBlockingMonsterTransition(state, zoneKey) {
  const t = state?.activeTransition;
  if (t) {
    // 只有「尚未過期」的切換動畫才擋玩家；過期殘留(例如切換途中伺服器重啟→記憶體 timer 消失、
    // DB 的 transition 變孤兒)不再凍死整個領域。實際清除交給 _resolveExpiredMonsterTransition。
    const endAtMs = t.endsAt ? Date.parse(t.endsAt) : NaN;
    if (!Number.isFinite(endAtMs) || endAtMs > Date.now()) return true;
  }
  if (!activeMonsterTransitions.has(zoneKey)) return false;

  // DB 狀態是權威資料；若 DB 已經沒有 transition，記憶體殘留不能繼續卡玩家排隊。
  activeMonsterTransitions.delete(zoneKey);
  const timer = monsterTransitionTimers.get(zoneKey);
  if (timer) clearTimeout(timer);
  monsterTransitionTimers.delete(zoneKey);
  const now = Date.now();
  const lastAt = _staleTransitionLogAt.get(zoneKey) || 0;
  if (now - lastAt >= STALE_TRANSITION_LOG_THROTTLE_MS) {
    _staleTransitionLogAt.set(zoneKey, now);
    console.warn(`[MonsterTransition] cleared stale in-memory transition zone=${zoneKey}`);
  }
  return false;
}



// 世界王重生/換王時，牙狼翻面與累積欄位必須清空。
// 否則重生後滿血王會繼承上一輪的翻面狀態(hellfangFlipped=true 亦擋住重新翻面)，
// 使面板弱點與原生相反、玩家照攻略打卻打成錯流派(30%)→「滿血卻好怪、物理打法系部位反而高」。


// 強化寶石 ID 對應表

// 參與獎勵寶石：依區域決定品階

// 參與獎勵寶石掉落率（依品階）。S 石不進參與制，只由世界王/世界王寶箱產出。

// 先不啟用雙掉











// 光環來源顯示名：玩家 displayName 在 DB 多半被存成 Discord ID（純數字），
// 改用 <@id> mention，讓 Discord 在戰報 embed 內顯示真實暱稱（embed 內的 mention 不會發出通知/ping）。
function resolveAuraSourceName(name, discordId) {
  const trimmed = name == null ? "" : String(name).trim();
  if (!trimmed || /^\d{5,}$/.test(trimmed)) {
    return discordId ? `<@${discordId}>` : "隊友";
  }
  return trimmed;
}

function compactAuraSourceNames(roundLogs = []) {
  if (!Array.isArray(roundLogs)) return roundLogs;
  return roundLogs.map((roundLog) => {
    const lines = String(roundLog || "").split("\n");
    const entries = [];
    const byKey = new Map();

    for (const line of lines) {
      const match = line.match(/^(.*光環)（([^（）]+)）(.*)$/);
      if (!match) {
        entries.push({ type: "raw", line });
        continue;
      }

      const [, prefix, name, suffix] = match;
      const key = `${prefix}\u0000${suffix}`;
      const existing = byKey.get(key);
      if (existing) {
        if (!existing.names.includes(name)) existing.names.push(name);
        continue;
      }

      const entry = { type: "aura", prefix, suffix, names: [name] };
      byKey.set(key, entry);
      entries.push(entry);
    }

    return entries.map((entry) => {
      if (entry.type !== "aura") return entry.line;
      return `${entry.prefix}（${entry.names.join("、")}）${entry.suffix}`;
    }).join("\n");
  });
}

async function maybeHandleEliteWorldBossTimeout(sc, zoneKey, state, monster) {
  if (!isWorldBossZone(zoneKey) || !sc.worldBossServiceFor(zoneKey) || !monster?.isBoss) return { state, timedOut: false };
  const info = await sc.worldBossServiceFor(zoneKey).getConfigWithStatus().catch(() => null);
  if (!info?.status?.battleTimeoutReached) return { state, timedOut: false };
  const timer = worldBossTimeoutTimers.get(zoneKey);
  if (timer) {
    clearTimeout(timer);
    worldBossTimeoutTimers.delete(zoneKey);
  }
  const partState = ensureWorldBossPartState({}, monster.calc.maxHp, zoneKey);
  const resetState = {
    ...state,
    ...freshHellfangFields(), // 牙狼重生：清翻面/累積
    currentHp: partState.currentHp,
    worldBossPartsHp: partState.worldBossPartsHp,
    worldBossPartsMaxHp: partState.worldBossPartsMaxHp,
    participants: [],
    damageMap: {},
    // 保留上一輪傷害排行(超時失敗也算一輪結束)
    lastDamageMap: (state.damageMap && Object.keys(state.damageMap).length > 0) ? state.damageMap : (state.lastDamageMap || {}),
    lastParticipants: Array.isArray(state.participants) ? state.participants : [],
    lastHitAt: new Date().toISOString(),
    activeHealerAura: null,
    activeHealerAuras: [],
    activeEvent: null
  };
  await sc.monsterService.saveState(resetState, zoneKey);
  await sc.worldBossServiceFor(zoneKey).markBossFailedTimeout().catch(() => {});
  for (const [pid, session] of activeSessions.entries()) {
    if (session?.zoneKey === zoneKey && session?.monsterId === monster.id) {
      if (session.timeoutId) clearTimeout(session.timeoutId);
      deleteMonsterSession(pid);
    }
  }
  await _republishPanel(sc, zoneKey, monster, resetState.currentHp, 0, {}, null, resetState.worldBossPartsHp).catch(() => {});

  // 世界 Boss 退場嗆聲
  const BOSS_RETREAT_TAUNTS = [
    (name) => `😈 **${name}** 冷笑道：「30 分鐘都殺不了我？下次再來吧。」然後消失了。`,
    (name) => `💀 **${name}** 撤離了，留下一片廢墟和滿地的羞恥⋯`,
    (name) => `👑 **${name}** 傲慢地宣告：「你們不夠格。」一小時後再來挑戰。`,
    (name) => `🌑 **${name}** 緩緩退入黑暗——「我還會回來的。」`,
    (name) => `😤 **${name}** 拂袖而去：「雜魚就是雜魚，滾回去練等。」`,
  ];
  try {
    const { getBotClient } = require("../runtimeContext");
    const client = getBotClient();
    if (client?.isReady()) {
      const layout = await sc.channelLayoutRepository.get();
      const bindings = layout?.discord?.bindings || [];
      const townBinding = bindings.find((b) => b.featureKey === "town_chat");
      const zoneFeature = zoneToFeatureKey(zoneKey);
      const fallback = bindings.find((b) => b.featureKey === zoneFeature);
      const channelId = townBinding?.channelId || fallback?.channelId;
      if (channelId) {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (channel?.isTextBased?.()) {
          const taunt = BOSS_RETREAT_TAUNTS[Math.floor(Math.random() * BOSS_RETREAT_TAUNTS.length)];
          await channel.send(taunt(monster.name));
        }
      }
    }
  } catch (_) {}

  return { state: resetState, timedOut: true };
}

async function scheduleEliteWorldBossTimeout(sc, zoneKey, monster) {
  if (!isWorldBossZone(zoneKey) || !sc.worldBossServiceFor(zoneKey) || !monster?.isBoss) return;
  const info = await sc.worldBossServiceFor(zoneKey).getConfigWithStatus().catch(() => null);
  const remainingMs = Number(info?.status?.battleRemainingMs || 0);
  if (!info?.status?.battleStartedAt || remainingMs <= 0) return;

  const prev = worldBossTimeoutTimers.get(zoneKey);
  if (prev) clearTimeout(prev);

  const timer = setTimeout(async () => {
    try {
      const state = await sc.monsterService.getState(zoneKey);
      const monsters = await sc.monsterService.listMonsters({ includeDisabled: false, zone: zoneKey });
      const active = monsters.find((m) => m.seq === state.activeMonsterSeq) || monster;
      await maybeHandleEliteWorldBossTimeout(sc, zoneKey, state, active);
    } catch (error) {
      console.error("[WorldBoss] timeout handling failed:", error?.message || error);
    }
  }, Math.max(1000, remainingMs + 1000));

  worldBossTimeoutTimers.set(zoneKey, timer);
  timer.unref?.();
}



// 二轉試煉：裝備某一轉徽章出戰時要累積的指標（找不到對應職業回 null）


// 輔助職業(徽章)判定：治療師/軍師/詩人/結界師





/**
 * 獲取玩家身上已有的所有裝備品階
 */
function getPlayerEquippedTiers(progress) {
  if (!progress?.equipment || typeof progress.equipment !== 'object') return new Set();

  const equipped = progress.equipment;
  const tiers = new Set();

  // 檢查武器欄位 (weapon 和 shield)
  const weaponSlots = ['weapon', 'shield'];
  // 檢查防具欄位
  const armorSlots = ['head_top', 'head_mid', 'head_low', 'armor', 'garment', 'shoes', 'accessory_l', 'accessory_r'];

  const validSlots = [...weaponSlots, ...armorSlots];

  for (const slot of validSlots) {
    const item = equipped[slot];
    if (item && item.tier) {
      tiers.add(String(item.tier || '').toUpperCase());
    }
  }

  return tiers;
}

/**
 * 檢查玩家是否已擁有某件道具（背包 + 裝備欄）
 * @returns {boolean}
 */
function playerAlreadyOwnsItem(progress, itemId) {
  if (!itemId) return false;
  // 檢查背包
  if (Array.isArray(progress?.inventory)) {
    if (progress.inventory.some(i => i?.itemId === itemId)) return true;
  }
  // 檢查裝備欄
  if (progress?.equipment && typeof progress.equipment === 'object') {
    if (Object.values(progress.equipment).some(i => i?.itemId === itemId)) return true;
  }
  return false;
}





/**
 * 嘗試堆疊寶石到背包中的相同寶石上，如果成功回傳 true，否則回傳 false
 * @returns {boolean} 成功堆疊則回傳 true，否則 false
 */


function isMonsterZoneButton(customId) {
  return customId.startsWith("monster-zone:");
}

/**
 * 記錄玩家死亡冷卻
 */
function getBattleBaselineDurationMs(agi = 1, roundCount = MAX_ROUNDS) {
  return Math.max(1, calculateTickDelay(agi)) * Math.max(1, roundCount);
}

function recordDeathCooldown(discordId, availableAtMs) {
  deathCooldowns.set(discordId, {
    availableAt: Math.max(Date.now(), Math.round(Number(availableAtMs) || Date.now()))
  });
}

function recordBattleCooldown(discordId, availableAtMs) {
  battleCooldowns.set(discordId, {
    availableAt: Math.max(Date.now(), Math.round(Number(availableAtMs) || Date.now()))
  });
}

function getRemainingFromCooldownMap(map, discordId) {
  const cooldown = map.get(discordId);
  if (!cooldown) return 0;

  const remainingMs = Math.max(0, Number(cooldown.availableAt || 0) - Date.now());
  if (remainingMs <= 0) {
    map.delete(discordId);
    return 0;
  }

  return Math.ceil(remainingMs / 1000);
}

/**
 * 獲取玩家的剩餘冷卻時間（秒）
 * @returns {number} 剩餘秒數，0 = 無冷卻
 */
function getRemainingCooldown(discordId) {
  return Math.max(
    getRemainingFromCooldownMap(battleCooldowns, discordId),
    getRemainingFromCooldownMap(deathCooldowns, discordId)
  );
}

function getCooldownKind(discordId) {
  const battle = getRemainingFromCooldownMap(battleCooldowns, discordId);
  const death = getRemainingFromCooldownMap(deathCooldowns, discordId);
  if (death > battle) return "death";
  if (battle > 0) return "battle";
  return "none";
}

/**
 * 檢查玩家是否在冷卻中
 */
function isInCooldown(discordId) {
  return getRemainingCooldown(discordId) > 0;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function tryAcquireBattleActionLock(discordId) {
  if (battleActionLocks.has(discordId)) return false;
  battleActionLocks.set(discordId, Date.now());
  return true;
}

function releaseBattleActionLock(discordId) {
  battleActionLocks.delete(discordId);
}

function formatQueueSeconds(seconds) {
  const value = Math.max(1, Math.ceil(Number(seconds) || 0));
  return `${value} 秒`;
}

function getSessionPhaseState(session, discordId) {
  const cooldownRemaining = getRemainingCooldown(discordId);
  const cooldownKind = getCooldownKind(discordId);
  const fromEndsAt = (value) => {
    if (!value) return 0;
    const raw = typeof value === "number" ? value : Date.parse(value);
    const ms = Number.isFinite(raw) ? raw - Date.now() : 0;
    return ms > 0 ? Math.ceil(ms / 1000) : 0;
  };

  if (cooldownRemaining > 0) {
    return {
      key: cooldownKind === "death" ? "deathCooldown" : "battleCooldown",
      label: cooldownKind === "death" ? "死亡懲罰中" : "戰鬥冷卻中",
      countdownSeconds: cooldownRemaining,
      actionText: "會自動進場"
    };
  }

  if (!session || typeof session !== "object") {
    return {
      key: "idle",
      label: "待機中",
      countdownSeconds: 0,
      actionText: ""
    };
  }

  if (session.state === "displaying") {
    const displayEndsAt = Number.isFinite(Number(session.displayEndsAt))
      ? Number(session.displayEndsAt)
      : (Number.isFinite(Number(session.displayStartedAt)) && Number.isFinite(Number(session.displayDurationMs))
        ? Number(session.displayStartedAt) + Number(session.displayDurationMs)
        : 0);
    return {
      key: "displaying",
      label: "戰鬥結果顯示中",
      countdownSeconds: fromEndsAt(displayEndsAt) || 1,
      actionText: "會自動列隊下一場"
    };
  }

  if (session.state === "fighting") {
    const combatEndsAt = Number.isFinite(Number(session.combatEndsAt))
      ? Number(session.combatEndsAt)
      : (Number.isFinite(Number(session.battleStartedAt))
        ? Number(session.battleStartedAt) + getBattleBaselineDurationMs(session.playerStats?.agi ?? 1)
        : 0);
    return {
      key: "fighting",
      label: "戰鬥中",
      countdownSeconds: fromEndsAt(combatEndsAt) || 1,
      actionText: "會自動結算"
    };
  }

  if (session.state === "waiting" || session.state === "queued" || session.state === "starting") {
    return {
      key: session.state,
      label:
        session.state === "starting"
          ? "正在準備出戰"
          : session.state === "queued"
            ? "自動列隊中"
            : "等待開戰中",
      countdownSeconds: fromEndsAt(session.queueEndsAt) || 1,
      actionText: "會自動列隊下一場"
    };
  }

  return {
    key: "unknown",
    label: "列隊中",
    countdownSeconds: fromEndsAt(session.queueEndsAt) || fromEndsAt(session.displayEndsAt) || 1,
    actionText: "會自動列隊下一場"
  };
}

function buildBattleQueueNotice({
  cooldownRemaining = 0,
  waitingForTransition = false,
  waitingForSpawn = false,
  worldBossDisabled = false,
  worldBossCooldownRemainingMs = 0,
  countdownSeconds = 1
} = {}) {
  const secsText = formatQueueSeconds(countdownSeconds || cooldownRemaining || 1);
  if (worldBossDisabled) return `⏳ 世界BOSS目前未開放，已自動列隊等待下一場，約 ${secsText} 後再檢查。`;
  if (worldBossCooldownRemainingMs > 0) return `⏳ 世界BOSS冷卻中，約 ${formatQueueSeconds(Math.ceil(worldBossCooldownRemainingMs / 1000))} 後會自動再檢查。`;
  if (cooldownRemaining > 0) return `⏳ 你還在戰鬥冷卻中，約 ${secsText} 後會自動進場。`;
  if (waitingForTransition) return `⏳ 怪物正在轉場，約 ${secsText} 後會自動開戰。`;
  if (waitingForSpawn) return `⏳ 目前怪物已倒下，約 ${secsText} 後會自動等到下一隻出現。`;
  return `⏳ 已進入自動排隊，約 ${secsText} 後會再檢查一次戰鬥狀態。`;
}

function getSessionQueueCountdownSeconds(session, discordId) {
  return getSessionPhaseState(session, discordId).countdownSeconds;
}

async function getWorldBossQueueBlock(sc, zoneKey, monster) {
  if (!isWorldBossZone(zoneKey) || !monster?.isBoss || !sc.worldBossServiceFor(zoneKey)) {
    return null;
  }
  const wb = await sc.worldBossServiceFor(zoneKey).getConfigWithStatus().catch(() => null);
  if (!wb?.config?.enabled) {
    return { disabled: true, cooldownRemainingMs: 0, waitMs: BATTLE_QUEUE_POLL_MS };
  }
  const cooldownRemainingMs = Math.max(0, Number(wb?.status?.cooldownRemainingMs || 0));
  if (cooldownRemainingMs > 0) {
    return { disabled: false, cooldownRemainingMs, waitMs: cooldownRemainingMs };
  }
  return null;
}

async function isWorldBossClosedForWrite(sc, zoneKey, monster, state) {
  if (!isWorldBossZone(zoneKey) || !monster?.isBoss || !sc.worldBossServiceFor(zoneKey)) return false;
  const claimedAtMs = Date.parse(state?.killClaimedAt);
  if (
    Number(state?.killClaimedSeq) === Number(monster.seq) &&
    Number.isFinite(claimedAtMs) &&
    claimedAtMs > Date.now()
  ) {
    return true;
  }
  const wb = await sc.worldBossServiceFor(zoneKey).getConfigWithStatus().catch(() => null);
  return Boolean(wb?.status?.cooldownRemainingMs > 0 && !wb?.status?.battleStartedAt);
}

function isStaleMonsterBattleState(zoneKey, monster, state) {
  if (!monster || !state) return true;
  if (Number(state.activeMonsterSeq) !== Number(monster.seq)) return true;
  if (state.activeTransition || state.activeEvent) return true;
  const claimedAtMs = Date.parse(state.killClaimedAt);
  if (
    Number(state.killClaimedSeq) === Number(monster.seq) &&
    Number.isFinite(claimedAtMs) &&
    claimedAtMs > Date.now() - 30 * 1000
  ) {
    return true;
  }
  if (!isWorldBossZone(zoneKey) && Number(state.currentHp || 0) <= 0) return true;
  return false;
}

async function waitForBattleReady(sc, { discordId, zoneKey, interaction, session } = {}) {
  let noticeSent = false;
  while (true) {
    if (session) {
      const liveSession = activeSessions.get(discordId);
      if (session.cancelled || liveSession !== session) {
        const reason = session.cancelReason || "戰鬥排隊已取消，請重新排隊。";
        if (interaction) {
          await interaction.editReply({ content: reason, embeds: [], components: [] }).catch(() => {});
        }
        return { state: null, monster: null, blocked: true, cancelled: true };
      }
    }

    let state = await sc.monsterService.getState(zoneKey).catch(() => null);
    await _resolveZoneEventIfExpired(sc, zoneKey).catch(() => {});
    state = await sc.monsterService.getState(zoneKey).catch(() => null);

    let eventWaitMs = 0;
    if (state?.activeEvent?.endsAt) {
      const endsAtMs = Date.parse(state.activeEvent.endsAt);
      if (Number.isFinite(endsAtMs) && endsAtMs > Date.now()) {
        eventWaitMs = Math.max(0, endsAtMs - Date.now());
      }
    }

    await _resolveExpiredMonsterTransition(sc, zoneKey).catch(() => {});
    state = await sc.monsterService.getState(zoneKey).catch(() => null);

    const cooldownRemaining = getRemainingCooldown(discordId);
    const activeTransition = hasBlockingMonsterTransition(state, zoneKey);
    const monsters = await sc.monsterService.listMonsters({ includeDisabled: false, zone: zoneKey }).catch(() => []);
    const monster = monsters.find((m) => Number(m.seq) === Number(state?.activeMonsterSeq)) || null;
    const worldBossBlock = await getWorldBossQueueBlock(sc, zoneKey, monster);
    const waitingForSpawn = !monster || !state?.activeMonsterSeq || Number(state?.currentHp || 0) <= 0;

    // 世界王冷卻/未開放且等待過久：不要把玩家「關」在長佇列裡（最久會卡一小時且無法去別區戰鬥），
    // 直接釋放 session 並提示稍後再來。冷卻很短（王即將重生）才維持下方的短暫自動排隊。
    if (worldBossBlock) {
      const cdMs = Number(worldBossBlock.cooldownRemainingMs || 0);
      if (worldBossBlock.disabled || cdMs > WORLD_BOSS_QUEUE_RELEASE_MS) {
        if (interaction) {
          const msg = worldBossBlock.disabled
            ? "🛌 世界王目前未開放，可以先去其他怪物區戰鬥，開放後再回來挑戰。"
            : `🛌 世界王正在冷卻，約 ${formatQueueSeconds(Math.ceil(cdMs / 1000))} 後重生。\n期間請先去其他怪物區戰鬥，時間到再回來挑戰即可（不會把你卡在這裡）。`;
          await interaction.editReply({ content: msg, embeds: [], components: [] }).catch(() => {});
        }
        return { state: null, monster: null, blocked: true, worldBossCooldown: true };
      }
    }

    if (cooldownRemaining <= 0 && !activeTransition && !eventWaitMs && !worldBossBlock && monster && Number(state?.currentHp || 0) > 0) {
      return { state, monster, blocked: false };
    }

    const countdownSeconds = Math.max(
      cooldownRemaining,
      Math.ceil(eventWaitMs / 1000),
      worldBossBlock ? Math.ceil(Math.max(1000, worldBossBlock.waitMs || 0) / 1000) : 0,
      activeTransition ? Math.ceil(BATTLE_QUEUE_POLL_MS / 1000) : 0,
      waitingForSpawn ? Math.ceil(BATTLE_QUEUE_POLL_MS / 1000) : 0
    );
    const queueDeadlineMs = Math.max(
      cooldownRemaining > 0 ? cooldownRemaining * 1000 : 0,
      eventWaitMs || 0,
      worldBossBlock ? Math.max(1000, worldBossBlock.waitMs || 0) : 0,
      activeTransition ? BATTLE_QUEUE_POLL_MS : 0,
      waitingForSpawn ? BATTLE_QUEUE_POLL_MS : 0,
      BATTLE_QUEUE_POLL_MS
    );

    if (interaction && !noticeSent) {
      if (session && session.state !== "fighting") {
        session.state = "queued";
        session.queueEndsAt = Date.now() + Math.max(1000, queueDeadlineMs);
      }
      const notice = buildBattleQueueNotice({
        cooldownRemaining,
        waitingForTransition: activeTransition || eventWaitMs > 0,
        waitingForSpawn,
        worldBossDisabled: Boolean(worldBossBlock?.disabled),
        worldBossCooldownRemainingMs: Number(worldBossBlock?.cooldownRemainingMs || 0),
        countdownSeconds
      });
      await interaction.editReply({ content: notice, embeds: [], components: [] }).catch(() => {});
      noticeSent = true;
    }

    const waitMs = Math.max(
      100,
      Math.min(
        BATTLE_QUEUE_POLL_MS,
        cooldownRemaining > 0 ? cooldownRemaining * 1000 : BATTLE_QUEUE_POLL_MS,
        eventWaitMs > 0 ? eventWaitMs : BATTLE_QUEUE_POLL_MS,
        worldBossBlock ? Math.max(1000, worldBossBlock.waitMs || 0) : BATTLE_QUEUE_POLL_MS
      )
    );
    if (session && session.state !== "fighting") {
      session.queueEndsAt = Math.max(
        Number(session.queueEndsAt || 0),
        Date.now() + Math.max(1000, queueDeadlineMs)
      );
    }
    await sleep(waitMs);
  }
}

// 攻擊倍率常數已移至 src/shared/combatStats.js


function buildHpBar(hp, maxHp, fillEmoji = "🟥", emptyEmoji = "⬛", length = 10) {
  const filled = Math.round((Math.max(0, hp) / Math.max(1, maxHp)) * length);
  return fillEmoji.repeat(Math.max(0, filled)) + emptyEmoji.repeat(Math.max(0, length - filled));
}





/**
 * 格式化 Buff 消息為中文描述，包含數值與持續時間
 * 例如："✨ 你獲得 Buff：經驗加成　數值 10%（1.1x）　持續 10 回合"
 */
function formatBuffMessage(buffEffect) {
  const nameZh = EFFECT_NAME_ZH[buffEffect.key] || buffEffect.key;
  const rawVal = Number(buffEffect?.params?.value ?? buffEffect?.value ?? 0);

  let valueText = "";
  if (PERCENT_EFFECT_KEYS.has(buffEffect.key)) {
    // percent stored as e.g. 10 => +10%
    const pct = rawVal;
    const mult = (1 + pct / 100).toFixed(2);
    valueText = `數值 ${Math.round(pct * 100) / 100}%（${mult}x）`;
  } else {
    if (Number.isFinite(rawVal) && rawVal !== 0) valueText = `數值 ${rawVal}`;
  }

  const durationMode = (buffEffect?.duration?.mode) || "turns";
  const durationVal = Number(buffEffect?.duration?.value || 1);
  let durationText = "";
  if (durationMode === 'battle') durationText = '整場戰鬥';
  else if (durationMode === 'permanent') durationText = '永久';
  else if (durationMode === 'seconds') durationText = `${durationVal} 秒`;
  else durationText = `${durationVal} 回合`;

  const parts = [];
  parts.push(`✨ 你獲得 Buff：${nameZh}`);
  if (valueText) parts.push(valueText);
  if (durationText) parts.push(`持續 ${durationText}`);

  return parts.join('　');
}

// 將怪物自帶的 monsterCardSkill 包裝成 combatLoop 需要的 monsterEquipped 格式
function buildMonsterEquipped(monster) {
  const base = monster?.equipment || {};
  if (!monster?.monsterCardSkill) return base;
  return {
    ...base,
    special_1: {
      ...(base.special_1 || {}),
      monsterCardSkill: monster.monsterCardSkill,
      itemName: monster.name,
    },
  };
}







function getJobNameFromEquipped(equipped = {}) {
  const jobEq = equipped?.job_eq;
  if (!jobEq) return null;
  const id = String(jobEq?.itemId || jobEq?.id || "").toLowerCase();
  const name = String(jobEq?.itemName || jobEq?.name || "").toLowerCase();
  // ⭐ 一律走 jobAdvancement（唯一入口）：二轉徽章解析回一轉中文名
  try {
    const ja = require("../../shared/jobAdvancement");
    const zh = ja.jobDisplayName(ja.resolveJobKey({ itemId: id, itemName: name }));
    if (zh) return zh;
  } catch (_) { /* 讀不到就往下走原本的預設值 */ }
  return jobEq?.itemName || jobEq?.name || null;
}

function createBattleParticipantCache(sc, zone = null) {
  const cache = new Map();

  return {
    seed(pid, snapshot) {
      if (!pid) return;
      cache.set(pid, Promise.resolve(snapshot));
    },
    clear() {
      cache.clear();
    },
    async get(pid, displayNameFallback = null) {
      if (!pid) {
        return {
          progress: null,
          player: null,
          displayName: displayNameFallback || null,
          equipped: {},
          inventory: [],
          refs: []
        };
      }

      if (cache.has(pid)) {
        return cache.get(pid);
      }

      const pending = (async () => {
        const [progress, player] = await Promise.all([
          sc.progressRepository.findByPlayerId(pid).catch(() => null),
          sc.playerRepository.findByDiscordId(pid).catch(() => null)
        ]);

        const displayName = player?.displayName || displayNameFallback || null;
        const equipped = await mergeEquippedFromLibrary(progress?.equipment || {}, sc.itemRepository);
        // 狼系寵物戰鬥夥伴（多人參戰快取同樣注入,與單人一致）
        try {
          const petEntry = sc.petService?.buildPetCombatEntry?.(progress);
          if (petEntry) equipped.pet_companion = petEntry;
        } catch (_) { /* noop */ }
        const attrs = progress?.attributes || { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 };
        const inventory = Array.isArray(progress?.inventory) ? progress.inventory : [];
        const refs = collectEquipmentEffects(equipped, null, {
          equipped,
          inventory
        });
        const stats = calcPlayerStats(attrs, equipped, progress?.activeEffects || [], inventory, { pkRating: progress?.pkRating, zone, petStat: require("../../shared/petDex").statBonusOf(progress?.petDex) });

        return {
          progress,
          player,
          displayName,
          equipped,
          inventory,
          stats,
          refs
        };
      })();

      cache.set(pid, pending);
      const resolved = await pending;
      cache.set(pid, resolved);
      return resolved;
    }
  };
}

// ──────────────────────────────────────────────
// 輔助：掉落裝備公告
// ──────────────────────────────────────────────
async function _notifyKillRewards(monsterName, perPidRewards) {
  try {
    const { getBotClient } = require("../runtimeContext");
    const sc = getServiceContext();
    const client = getBotClient();
    if (!client?.isReady()) return;
    for (const [pid, rewards] of Object.entries(perPidRewards)) {
      if (rewards?._expGrantFailed) {
        console.warn(`[MonsterZone] skip reward DM for ${pid} because EXP was not committed`);
        continue;
      }
      const lines = [];
      if (rewards.gold > 0) lines.push(`💰 金幣 **+${rewards.gold}**`);
      if (rewards.exp > 0) {
        let expLine = `⭐ EXP **+${rewards.exp}**`;
        if (rewards.levelUps > 0) {
          const detailText = Array.isArray(rewards.levelUpDetails) && rewards.levelUpDetails.length
            ? rewards.levelUpDetails.map((lv) => `Lv.${lv.level}：${Array.isArray(lv.attrsZh) ? lv.attrsZh.join("、") : ""}`).join("；")
            : "";
          expLine += detailText
            ? `　✨ 升級 ${rewards.levelUps} 次！**Lv.${rewards.newLevel}**\n   ${detailText}`
            : `　✨ 升級 ${rewards.levelUps} 次！**Lv.${rewards.newLevel}**`;
        }
        lines.push(expLine);
      }
      if (rewards.drops.length > 0) lines.push(`🎁 道具：**${rewards.drops.join("、")}**`);
      if (rewards.bestiary) {
        const b = rewards.bestiary;
        const killsTxt = `${(Math.round(b.killsAfter * 10) / 10)}/${b.requirement} 隻`;
        lines.push(`📖 圖鑑：**${b.monsterName}** +${b.gainPct}%（累積 ${killsTxt}，對該怪傷害 +${Math.round(b.bonusPctAfter * 10) / 10}%）`);
      }
      if (Array.isArray(rewards.chestAwarded) && rewards.chestAwarded.length) {
        lines.push(`📦 世界王貢獻獎勵：**${rewards.chestAwarded.join("、")}**`);
      }
      if (!lines.length) continue;
      const prefix = `⚔️ **${monsterName}** 已被擊倒，你的參戰獎勵：`;
      try {
        const user = await client.users.fetch(pid);
        await user.send(`${prefix}\n${lines.join("\n")}`);
      } catch (_) { /* DM 關閉則跳過 */ }

      // 治療師專屬 DM：額外發送加成明細
      try {
        const { getMongoDb } = require("../../adapters/mongo/createMongoClient");
        const db = await getMongoDb();
        const prog = await db.collection("progress").findOne({ playerId: pid });
        const jobEq = prog?.equipment?.job_eq;
        const jobId = String(jobEq?.itemId || jobEq?.id || "").toLowerCase();
        const jobName = String(jobEq?.itemName || jobEq?.name || "").toLowerCase();
        if ((() => { try { return require("../../shared/jobAdvancement").resolveJobKey({ itemId: jobId, itemName: jobName }) === "healer"; } catch (_) { return false; } })()) {
          const goldBonus = rewards.gold > 0 ? Math.max(1, Math.round(rewards.gold / 11)) : 0;
          const expBonus  = rewards.exp  > 0 ? Math.max(1, Math.round(rewards.exp  / 11)) : 0;
          const parts = [];
          if (goldBonus > 0) parts.push(`+${goldBonus} 金幣`);
          if (expBonus  > 0) parts.push(`+${expBonus} EXP`);
          if (parts.length > 0) {
            const user = await client.users.fetch(pid);
            await user.send(`💚 **治療師加成**：${parts.join("、")}`);
          }
        }
      } catch (e) {
        // 忽略「無共同伺服器」或「DM 關閉」的正常情況
        if (!e.message?.includes("mutual guilds") && !e.message?.includes("Cannot send messages")) {
          console.error("[HealerCheck] error:", e.message);
        }
      }
    }
  } catch (e) {
    // suppressed
  }
}



const DROP_TAUNTS = {
  kill: [
    (n) => `${n}：「我只是滑倒！」`,
    (n) => `${n}：「暫時退場而已！」`,
    (n) => `${n}：「下次一定！」`,
    (n) => `${n}：「這不算輸！」`,
    (n) => `${n}：「我故意的啦……」`,
    (n) => `${n}：「嗚……我的寶貝。」`,
    (n) => `${n}：「你走著瞧！」`,
  ],
  group: [
    (n) => `${n}：「還好意思撿！」`,
    (n) => `${n}：「給我等著！」`,
    (n) => `${n}：「算了隨便。」`,
    (n) => `${n}：「趁我沒注意！」`,
    (n) => `${n}：「我看你幾個意思。」`,
    (n) => `${n}：「哼，大方送你的！」`,
    (n) => `${n}：「這是限量版你知道嗎！」`,
  ],
  bonus_10: [
    (n) => `${n}：「我不是故意掉的！」`,
    (n) => `${n}：「10個人欺負我！」`,
    (n) => `${n}：「人多了不起啊……確實。」`,
    (n) => `${n}：「這也太多人了吧！」`,
    (n) => `${n}：「好啦好啦，拿走！」`,
  ],
  bonus_15: [
    (n) => `${n}：「這群人是來搶劫的！」`,
    (n) => `${n}：「連逃跑的路都沒有。」`,
    (n) => `${n}：「下輩子再說！」`,
    (n) => `${n}：「15個人……太過分了。」`,
    (n) => `${n}：「算我倒霉。」`,
  ],
  bonus_20: [
    (n) => `${n}：「一無所有了……」`,
    (n) => `${n}：「我媽都哭了。」`,
    (n) => `${n}：「請善待我的遺物。」`,
    (n) => `${n}：「20個人，史詩級欺負。」`,
    (n) => `${n}：「帶走吧，都帶走吧。」`,
  ],
};

function pickTaunt(kind, monsterName) {
  if (process.env.DISABLE_TAUNTS === '1') return '';
  const pool = DROP_TAUNTS[kind] || DROP_TAUNTS.kill;
  return pool[Math.floor(Math.random() * pool.length)](monsterName);
}

// 等級里程碑廣播（10 / 15 等）
// 關鍵等級里程碑：對齊實際遊戲門檻（轉職 / 組隊爬塔 / 世界王 / 終局世界王）
const LEVEL_MILESTONE_MSG = {
  10: (m, n) => `🎉 恭喜 ${m} **${n}** 升上 **Lv.10**！已達**轉職門檻**——快去完成職業試煉、選定你的職業吧！⚔️`,
  30: (m, n) => `🗼 恭喜 ${m} **${n}** 升上 **Lv.30**！爬塔目前暫停開放，重新開放時會另行公告。`,
  40: (m, n) => `👑 恭喜 ${m} **${n}** 升上 **Lv.40**！三條路線開放，挑戰**大史王**吧！🔥`,
  50: (m, n) => `🐉 恭喜 ${m} **${n}** 升上 **Lv.50**！踏入終局——挑戰世界王 **古龍王 / 地獄狼牙王**！⚔️`,
};
const LEVEL_MILESTONES = new Set(Object.keys(LEVEL_MILESTONE_MSG).map(Number));
async function _announceLevelMilestone(sc, discordId, displayName, prevLevel, newLevel) {
  try {
    const hit = [];
    for (let lv = prevLevel + 1; lv <= newLevel; lv++) {
      if (LEVEL_MILESTONES.has(lv)) hit.push(lv);
    }
    if (hit.length === 0) return;

    const { getBotClient } = require("../runtimeContext");
    const client = getBotClient();
    if (!client?.isReady()) return;
    const layout = await sc.channelLayoutRepository.get();
    const allBindings = layout?.discord?.bindings || [];
    const binding = allBindings.find((b) => b.featureKey === "town_chat") ||
                    allBindings.find((b) => b.featureKey === "monster_zone");
    if (!binding?.channelId) return;
    const channel = await client.channels.fetch(binding.channelId).catch(() => null);
    if (!channel?.isTextBased?.()) return;

    for (const lv of hit) {
      const build = LEVEL_MILESTONE_MSG[lv];
      if (!build) continue;
      await sendAnnouncementWebhook(
        channel,
        build(`<@${discordId}>`, displayName),
        { allowedMentions: { users: [discordId] }, context: "level milestone webhook" }
      );
    }
  } catch (_) {}
}

async function _announceDrops(sc, discordId, displayName, monsterName, droppedItems, droppedItemObjects = [], kind = "fight", isWorldBossKill = false, zoneKey = null) {
  try {
    if (zoneKey && !shouldBroadcastZoneActivity(zoneKey)) return;
    const { getBotClient } = require("../runtimeContext");
    const client = getBotClient();
    if (!client?.isReady()) return;

    // 掉落公告改發到「廣播公告頻道」(broadcast)，不再洗聊天大廳(town_chat)
    const layout = await sc.channelLayoutRepository.get();
    const allBindings = layout?.discord?.bindings || [];
    const broadcastBinding = allBindings.find((b) => b.featureKey === "broadcast");
    const broadcastChannelId = broadcastBinding?.channelId || "1450062298076151952";
    if (broadcastChannelId) {
      const channel = await client.channels.fetch(broadcastChannelId).catch(() => null);
      if (channel?.isTextBased?.()) {
        const itemList = droppedItems.join("、");
        const taunt = pickTaunt(kind, monsterName);
        const tauntSuffix = taunt ? `　${taunt}` : '';
        let content = "";
        if (kind === "bonus_10") {
          content = `🎊 **10人加碼** ${displayName} (<@${discordId}>) 從 **${monsterName}** 打到 **${itemList}**${tauntSuffix}`;
        } else if (kind === "bonus_15") {
          content = `🔥 **15人加碼** ${displayName} (<@${discordId}>) 從 **${monsterName}** 打到 **${itemList}**${tauntSuffix}`;
        } else if (kind === "bonus_20") {
          content = `🌟 **20人加碼** ${displayName} (<@${discordId}>) 從 **${monsterName}** 打到 **${itemList}**${tauntSuffix}`;
        } else if (kind === "group") {
          content = `🎁 ${displayName} (<@${discordId}>) 從 **${monsterName}** 打到 **${itemList}**${tauntSuffix}`;
        } else {
          content = `⚔️ ${displayName} (<@${discordId}>) 擊倒 **${monsterName}** 打到 **${itemList}**${tauntSuffix}`;
        }
        await sendAnnouncementWebhook(channel, content, {
          allowedMentions: { users: [discordId] },
          context: "drop announcement webhook"
        });
      }
    }

    // （一般怪的稀有卡公告仍停用，避免洗頻）
    // 世界王卡：只有「世界王擊殺」掉到的怪物卡才顯眼廣播到聊天大廳＋DC城鎮頻道（比照寶箱/單人世界王）
    if (isWorldBossKill && Array.isArray(droppedItemObjects)) {
      const cardDrops = droppedItemObjects.filter((o) => o && o.monsterCardSkill);
      if (cardDrops.length > 0) {
        try {
          const tc = require("../../shared/announceTownChat");
          const who = await tc.resolveDiscordName(discordId).catch(() => (displayName || "某位勇者"));
          for (const o of cardDrops) {
            tc.announceTownChat(`🃏✨ **${who}** 討伐世界王 **${monsterName}**，打到了世界王卡【**${o.itemName}**】！稀有難得！`).catch(() => {});
          }
        } catch (_) { /* 公告失敗不影響掉落 */ }
      }
    }
  } catch (e) {
    console.error(`[Drop Announce] Unexpected error:`, e?.message || e);
  }
}

// ──────────────────────────────────────────────
// 輔助：重發公開面板
// ──────────────────────────────────────────────
// ─── Zone 輔助 ─────────────────────────────────
async function getZoneFromChannel(sc, channelId) {
  const layout = await sc.channelLayoutRepository.get();
  const binding = (layout?.discord?.bindings || []).find(
    (b) => b.channelId === channelId && b.featureKey?.startsWith("monster_zone")
  );
  if (!binding) return null;
  return _featureKeyToZone(binding.featureKey);
}



// 排行榜去重：戰鬥中最多 5 秒更新一次面板
// 邏輯：
// 1. 如果排行沒變，跳過
// 2. 如果排行有變但不足 5 秒，延迟到 5 秒後發佈
// 3. 如果距上次發佈超過 5 秒，立即發佈
// 4. 定時器到期時會無條件發佈一次（確保至少 5 秒更新）
async function _republishPanelWithRankingDebounce(sc, zoneKey, monster, monsterHp, participantCount, damageMap = {}, activeEvent = null, worldBossPartsHp = null, options = {}) {
  const now = Date.now();
  const debounce = damageRankingDebounce.get(zoneKey) || {};
  const lastPublishTime = debounce.lastPublishTime || 0;
  const lastDamageMap = debounce.lastDamageMap || {};
  let lastTimer = debounce.pendingTimer || null;

  // 比較排行榜是否真的改變
  const damageStr = JSON.stringify(Object.entries(damageMap).sort((a, b) => b[1].damage - a[1].damage));
  const lastDamageStr = JSON.stringify(Object.entries(lastDamageMap).sort((a, b) => b[1].damage - a[1].damage));
  const rankingChanged = damageStr !== lastDamageStr;

  // 如果排行沒變，直接跳過
  if (!rankingChanged) {
    return;
  }

  // 檢查是否距上次發佈超過 5 秒
  const timeSinceLastPublish = now - lastPublishTime;
  if (timeSinceLastPublish >= 5000) {
    // 超過 5 秒，立即發佈
    if (lastTimer) clearTimeout(lastTimer);
    await _republishPanel(sc, zoneKey, monster, monsterHp, participantCount, damageMap, activeEvent, worldBossPartsHp, options).catch(() => {});
    damageRankingDebounce.set(zoneKey, {
      lastPublishTime: Date.now(),
      lastDamageMap: damageMap,
      pendingTimer: null
    });
    return;
  }

  // 不足 5 秒，清除舊計時器，設定新的延遲計時器
  if (lastTimer) clearTimeout(lastTimer);
  const delayMs = 5000 - timeSinceLastPublish;
  const newTimer = setTimeout(() => {
    // 定時器到期時，無條件發佈一次（確保至少 5 秒內更新）
    _republishPanel(sc, zoneKey, monster, monsterHp, participantCount, damageMap, activeEvent, worldBossPartsHp, options).catch(() => {});
    damageRankingDebounce.set(zoneKey, {
      lastPublishTime: Date.now(),
      lastDamageMap: damageMap,
      pendingTimer: null
    });
  }, delayMs);

  // 更新 debounce 狀態（保留當前 damageMap 以便定時器使用）
  damageRankingDebounce.set(zoneKey, {
    lastPublishTime,
    lastDamageMap: damageMap,
    pendingTimer: newTimer
  });
}

async function _republishPanel(sc, zoneKey, monster, monsterHp, participantCount, damageMap = {}, activeEvent = null, worldBossPartsHp = null, options = {}) {
  const excludedIds = await getLeaderboardExcludedPlayerIds().catch(() => new Set());
  damageMap = filterDamageMapForLeaderboard(damageMap, excludedIds);
  // 添加冷卻時間信息到 damageMap
  const damageMapWithCooldown = {};
  for (const [key, entry] of Object.entries(damageMap)) {
    const cooldownRemaining = getRemainingCooldown(key);
    damageMapWithCooldown[key] = {
      ...entry,
      cooldownRemaining: cooldownRemaining > 0 ? cooldownRemaining : 0
    };
  }

  const featureKey = zoneToFeatureKey(zoneKey);
  const layout = await sc.channelLayoutRepository.get();
  const binding = (layout?.discord?.bindings || []).find((b) => b.featureKey === featureKey);
  if (binding?.channelId) {
    let activeTransition = options?.activeTransition || null;
    if (!activeTransition && !activeEvent) {
      const latestState = await sc.monsterService.getState(zoneKey).catch(() => null);
      activeTransition = latestState?.activeTransition || activeMonsterTransitions.get(zoneKey) || null;
    }
    let partsHp = worldBossPartsHp;
    let hellfangPartInfo = null;
    if (isWorldBossZone(zoneKey) && monster?.isBoss && (!partsHp || zoneKey === HELLFANG_ZONE)) {
      const latest = await sc.monsterService.getState(zoneKey).catch(() => null);
      if (!partsHp) partsHp = latest?.worldBossPartsHp || null;
      // 牙狼：每部位算「當前弱點(物/法)＋翻面倒數」給面板顯示
      if (zoneKey === HELLFANG_ZONE && latest) {
        hellfangPartInfo = {};
        const _now = Date.now();
        for (const p of getWorldBossPartKeys(zoneKey)) {
          hellfangPartInfo[p] = {
            weakZh: hellfangPartCurrentWeak(latest, p, _now) === "magic" ? "法" : "物",
            flipRemainMs: getHellfangFlipRemainingMs(latest, p, _now),
          };
        }
      }
    }
    // 巨神震擊（矮人戰士長）：世界王面板顯示暈眩條三態
    let bossStun = null;
    if (isWorldBossZone(zoneKey) && monster?.isBoss) {
      try {
        const _dsg = require("../../shared/dwarfStunGauge");
        bossStun = _dsg.view(await _dsg.read(_dsg.gaugeKeyForZone(zoneKey), zoneKey));
      } catch (_) { bossStun = null; }
    }
    return await sc.adminConsoleService.publishMonsterZonePanel(
      binding.channelId,
      monster,
      monsterHp,
      {
        participantCount,
        damageMap: damageMapWithCooldown,
        activeEvent,
        activeTransition,
        worldBossPartsHp: partsHp,
        hellfangPartInfo,
        bossStun,
        fastUpdate: options.fastUpdate === true,
        forcePublish: options.forcePublish === true
      }
    );
  }
  return null;
}





// BOSS 出場公告
async function _broadcastBossSpawn(sc, zoneKey, monster) {
  if (!BOSS_SPAWN_BROADCAST_ENABLED) return;
  try {
    const { getBotClient } = require("../runtimeContext");
    const client = getBotClient();
    if (!client?.isReady()) {
      return;
    }

    // 發送 BOSS 出場公告到通知頻道
    const notificationChannelId = "1498608950671839263";
    const notifChannel = await client.channels.fetch(notificationChannelId).catch((err) => {
      console.error(`[BOSS Announce] Failed to fetch notification channel ${notificationChannelId}:`, err?.message);
      return null;
    });
    if (notifChannel?.isTextBased?.()) {
      await notifChannel.send(`👑 BOSS出現  ${monster.name}`).catch((err) => {
        console.error("[BOSS Announce] Failed to send BOSS announcement:", err?.message);
      });
    } else {
      console.error(`[BOSS Announce] Notification channel ${notificationChannelId} not found or not text-based`);
    }
  } catch (err) {
    console.error("[BOSS Announce] Unexpected error:", err?.message || err);
  }
}

function isTransientDiscordError(err) {
  if (isTransientDiscordNetworkError(err)) return true;
  if (/Unknown interaction/i.test(err?.message || "")) return true;
  const code = err?.code || "";
  return code === "ENOTFOUND" || code === "ECONNREFUSED" || code === "DISCORD_REQUEST_TIMEOUT";
}

function buildCombatImportantHighlights(roundLogs = [], displayedText = "") {
  if (!Array.isArray(roundLogs) || roundLogs.length === 0) return "";
  const importantLines = [];
  for (const roundLog of roundLogs) {
    const lines = String(roundLog || "")
      .split("\n")
      .filter((line) => /中毒|淬毒|燒傷|流血|冰凍|擊暈|麻痺|詛咒|閃電|震盪/.test(line));
    importantLines.push(...lines);
  }
  const unique = [...new Set(importantLines)]
    .filter((line) => line && !String(displayedText || "").includes(line))
    .slice(-6);
  return unique.length ? `**── 重要狀態 ──**\n${unique.join("\n")}\n\n` : "";
}

function getBattleDisplayDurationMs(agi = 1, roundCount = MAX_ROUNDS) {
  return Math.max(1000, getBattleBaselineDurationMs(agi, Math.max(1, roundCount)));
}

async function displaySettledBattleResult({
  interaction,
  discordId,
  displayRoundLogs,
  rewardLines,
  embedTitle,
  embedColor,
  pendingDeathCooldown = false,
  playerAgi = 1
}) {
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  const MAX_DESC = 3800;
  const tickDelay = calculateTickDelay(playerAgi);

  // ── 逐回合更新（累積顯示，每回合 tickDelay 一次）──
  for (let i = ROUNDS_PER_TICK; i < displayRoundLogs.length; i += ROUNDS_PER_TICK) {
    const soFar = displayRoundLogs.slice(0, i).join("\n\n");
    const truncated = soFar.length > MAX_DESC ? soFar.slice(0, MAX_DESC) + "\n…" : soFar;
    const progressEmbed = new EmbedBuilder()
      .setTitle(`⚔️ 戰鬥中 — 第 ${Math.min(i, displayRoundLogs.length)} 回合`)
      .setDescription(truncated + "\n\n⏳ 戰鬥繼續中...")
      .setColor(0xe74c3c);
    await retryInteractionEditReply(interaction, { embeds: [progressEmbed], components: [] }, 1).catch(() => {});
    await delay(tickDelay);
  }

  if (pendingDeathCooldown) {
    const availableAt = Date.now() + DEATH_COOLDOWN_MS;
    recordDeathCooldown(discordId, availableAt);
    const remainingCooldown = getRemainingCooldown(discordId);
    rewardLines = rewardLines.map((line) => (
      /^⏳ (死亡懲罰|冷卻)/.test(line)
        ? (remainingCooldown > 0
          ? `⏳ 冷卻中... 約 ${remainingCooldown} 秒後可再次進場。`
          : "⏳ 冷卻即將結束，請稍後再試。")
        : line
    ));
  }

  const logText = displayRoundLogs.join("\n\n");
  const resultBlock = rewardLines.length > 0 ? "\n\n" + rewardLines.join("\n") : "";

  // Discord embed 描述上限 4096。之前 displayLog(最多 3800) + resultBlock 直接相接，
  // 世界王戰報回合多、結算/掉落又長時，合起來會超過 4096，導致「勝負＋掉落」結尾被吃掉。
  // 改為：先保留結算區(戰鬥結尾)的空間，回合 log 只填剩下的額度，確保結尾永遠看得到。
  const HARD_LIMIT = 4096;
  const SAFE_LIMIT = 4000;
  let resultPart = resultBlock;
  if (resultPart.length > 2400) resultPart = resultPart.slice(0, 2400) + "\n…（部分獎勵略）"; // 極端保護
  const logBudget = Math.max(300, SAFE_LIMIT - resultPart.length);

  let displayLog = logText.length > logBudget
    ? logText.slice(0, logBudget) + "\n…（部分回合已省略）"
    : logText;
  if (logText.length > logBudget) {
    const highlights = buildCombatImportantHighlights(displayRoundLogs, displayLog);
    if (highlights) {
      displayLog = (highlights + displayLog).slice(0, logBudget) + "\n…（部分回合已省略）";
    }
  }

  const embed = new EmbedBuilder()
    .setTitle(embedTitle)
    .setDescription((displayLog + resultPart).slice(0, HARD_LIMIT))
    .setColor(embedColor);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(BTN.deleteLog).setLabel("🗑️ 刪除紀錄").setStyle(ButtonStyle.Secondary)
  );

  try {
    await safeBattleResultReply(interaction, { embeds: [embed], components: [row] }, `⚔️ 戰鬥結算已完成：<@${discordId}>`);
  } catch (componentErr) {
    console.error("[monsterZoneHandlers] 編輯回覆失敗 (components):", componentErr.message);
    await safeBattleResultReply(interaction, { embeds: [embed], components: [] }, `⚔️ 戰鬥結算已完成：<@${discordId}>`).catch(() => {});
  } finally {
    displayRoundLogs.length = 0;
    rewardLines.length = 0;
  }
}

async function retryInteractionEditReply(interaction, payload, attempts = 2) {
  if (isDiscordRestProtected()) return false;

  let lastErr = null;
  const maxAttempts = Math.max(1, Number(attempts) || 1);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await withDiscordTimeout(
        interaction.editReply(payload),
        DISCORD_REPLY_TIMEOUT_MS,
        "interaction editReply timeout"
      );
      return true;
    } catch (err) {
      lastErr = err;
      markDiscordRestError(err, "interaction editReply");
      if (!isTransientDiscordError(err) || attempt >= maxAttempts) break;
      resetDiscordRestAgent(interaction.client, err?.code || err?.message || "reply retry");
      await sleep(DISCORD_REPLY_RETRY_DELAY_MS * attempt);
    }
  }
  throw lastErr;
}

function withDiscordTimeout(promise, timeoutMs, message) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(message || "Discord request timeout");
      error.code = "DISCORD_REQUEST_TIMEOUT";
      reject(error);
    }, Math.max(1_000, Number(timeoutMs) || DISCORD_REPLY_TIMEOUT_MS));
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function safeBattleResultReply(interaction, payload, fallbackContent) {
  try {
    return await retryInteractionEditReply(interaction, payload, 3);
  } catch (err) {
    markDiscordRestError(err, "battle result reply");
    if (!isTransientDiscordError(err)) throw err;
    try {
      await withDiscordTimeout(
        interaction.followUp({
          flags: MessageFlags.Ephemeral,
          content: fallbackContent || "戰鬥結果已完成結算，但 Discord 回覆暫時不穩，已略過完整戰報顯示。",
        }),
        DISCORD_REPLY_TIMEOUT_MS,
        "interaction followUp timeout"
      );
    } catch (sendErr) {
      console.error("[monsterZoneHandlers] battle fallback followUp failed:", sendErr?.message || sendErr);
    }
    return false;
  }
}

// ──────────────────────────────────────────────
// 出戰（入場）— 顯示準備畫面 + 開始戰鬥按鈕
// ──────────────────────────────────────────────
// 人機驗證：把 guard/verify 的結果組成 Discord 回覆（題目按鈕 or 封鎖說明）
function buildHumanCheckReply(gate) {
  if (gate.kind === "challenge") {
    const row = new ActionRowBuilder().addComponents(
      ...gate.options.map((n, i) => new ButtonBuilder()
        .setCustomId(`${BTN.humanCheckPrefix}${gate.token}:${i}`)
        .setLabel(String(n))
        .setStyle(ButtonStyle.Secondary))
    );
    return {
      content: `🧩 **稍等一下**\n你已經連續遊玩很長一段時間了，請完成一次確認再繼續。\n\n${gate.prompt}\n-# 3 分鐘內作答；答對就能馬上繼續出戰。`,
      embeds: [],
      components: [row],
    };
  }
  const mins = Math.max(1, Math.ceil((Number(gate.untilMs) - Date.now()) / 60000));
  return {
    content: `⛔ **暫時無法出戰**\n人機驗證未通過，請 ${mins} 分鐘後再試。\n-# 若你是本人操作，休息一下再回來即可；重複未通過會拉長等待時間。`,
    embeds: [],
    components: [],
  };
}

async function handleHumanCheck(interaction) {
  const raw = String(interaction.customId || "").slice(BTN.humanCheckPrefix.length);
  const [token, idxRaw] = raw.split(":");
  const svc = require("../../services/humanCheck/humanCheckService");
  const result = await svc.verify(interaction.user.id, token, Number(idxRaw));
  if (result.ok) {
    await interaction.update({
      content: "✅ 確認完成，可以繼續出戰了。",
      embeds: [], components: [],
    }).catch(() => {});
    return;
  }
  if (result.kind === "none") {
    await interaction.update({
      content: "⚠️ 這題已經失效了，請重新按一次出戰。", embeds: [], components: [],
    }).catch(() => {});
    return;
  }
  const mins = Math.max(1, Math.ceil((Number(result.untilMs) - Date.now()) / 60000));
  const head = result.kind === "expired" ? "⌛ 超過作答時間" : "❌ 選錯了";
  await interaction.update({
    content: `${head}\n請 ${mins} 分鐘後再出戰。`, embeds: [], components: [],
  }).catch(() => {});
}

async function handleEnterBattle(interaction) {
  const discordId = interaction.user.id;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (isTowerBattleActive(discordId)) {
    await interaction.editReply({
      content: "❌ 你目前正在組隊攻塔，不能同時挑戰怪物。請先解散隊伍。"
    }).catch(() => {});
    return;
  }
  if (isPkBattleActive(discordId)) {
    await interaction.editReply({
      content: "❌ 你目前正在進行 PK，不能同時挑戰怪物。"
    }).catch(() => {});
    return;
  }
  // 跨 DC/網頁/裝置互斥：網頁正在戰鬥 → 擋下 DC 出戰
  if (isWebBattleActive(discordId)) {
    await interaction.editReply({
      content: "❌ 你正在網頁進行戰鬥，請先結束後再從 Discord 出戰。"
    }).catch(() => {});
    return;
  }
  // 背包已滿 → 不能出戰（與網頁一致；先擋下省得白付入場費）
  try {
    const bagFull = await require("../../services/backpack/backpackService").checkBackpackFullForBattle(discordId);
    if (bagFull) {
      await interaction.editReply({ content: bagFull.message }).catch(() => {});
      return;
    }
  } catch (_) { /* 檢查失敗不阻擋戰鬥 */ }
  // 續航偵測：連續遊玩過久 → 出戰前先過一題人機驗證（正常玩家幾乎不會遇到）
  {
    const gate = await require("../../services/humanCheck/humanCheckService").guard(discordId);
    if (!gate.ok) {
      await interaction.editReply(buildHumanCheckReply(gate)).catch(() => {});
      return;
    }
  }
  const sc = getServiceContext();
  const displayName = interaction.member?.displayName || interaction.user.username;
  const selectedBossPart = parseWorldBossTargetPart(interaction.customId);
  const selectedBossPartProfile = getWorldBossTargetProfile(selectedBossPart);
  let idleSettleNotice = null;
  let hasActiveSessionLock = false;

  // 已有進行中的戰鬥，拒絕重複出戰
  if (activeSessions.has(discordId)) {
    if (pendingBattleReservations.has(discordId)) {
      await interaction.editReply({
        content: "⏳ 你已經預約了一場戰鬥，最多只能再排 1 場，請等這一場跑完。"
      }).catch(() => {});
      return;
    }
    pendingBattleReservations.set(discordId, { requestedAt: Date.now() });
    const s = activeSessions.get(discordId);
    const phase = getSessionPhaseState(s, discordId);
    await interaction.editReply({
      content: `⏳ 你目前${phase.label}，已預約下一場，約 ${formatQueueSeconds(phase.countdownSeconds)} 後${phase.actionText}。`
    }).catch(() => {});
    try {
      const reservationExpiry = Date.now() + 5 * 60 * 1000; // 最多等 5 分鐘
      while (activeSessions.has(discordId) && Date.now() < reservationExpiry) {
        await sleep(BATTLE_QUEUE_POLL_MS);
      }
      if (activeSessions.has(discordId)) {
        // 超時強制清除卡住的 session
        deleteMonsterSession(discordId);
      }
    } finally {
      pendingBattleReservations.delete(discordId);
    }
    // 預約等待結束，清掉「已預約下一場」的訊息，讓玩家知道輪到他了
    await interaction.editReply({ content: "⚔️ 輪到你了，正在出戰...", embeds: [], components: [] }).catch(() => {});
  }

  setMonsterSession(discordId, { state: "starting", battleStartedAt: Date.now() });
  hasActiveSessionLock = true;

  try {
    // 偵測頻道對應的區域
    const zoneKey = await getZoneFromChannel(sc, interaction.channelId);
    if (!zoneKey) {
      await interaction.editReply({ content: "❌ 此頻道未設定為放怪區。" });
      return;
    }
    if (!canPlayerAccessZone(zoneKey, discordId)) {
      await interaction.editReply({ content: "❌ 找不到這個戰鬥區域。" });
      return;
    }
    const startingSession = activeSessions.get(discordId);
    if (startingSession) {
      startingSession.zoneKey = zoneKey;
    }

    // 死亡冷卻檢查：由 waitForBattleReady 統一轉成排隊等待
    const cooldownRemaining = getRemainingCooldown(discordId);

    // 等級限制檢查 — 優先讀 channel layout binding 的自訂限制
    let cachedProgress = null;
    {
      cachedProgress = await sc.progressRepository.findByPlayerId(discordId);
      const playerLevel = cachedProgress?.level ?? 1;
      const layout = await sc.channelLayoutRepository.get().catch(() => null);
      const featureKey = zoneToFeatureKey(zoneKey);
      const zoneBinding = (layout?.discord?.bindings || []).find((b) => b.featureKey === featureKey && b.enabled) || null;
      const levelError = checkZoneLevelRequirementWithBinding(zoneKey, playerLevel, zoneBinding);
      if (levelError) {
        await interaction.editReply({ content: `🔒 ${levelError}` });
        return;
      }
      // 主線閘門：DC 不鎖（依使用者要求，DC 玩家不需先到網頁看劇情才能行動；劇情僅在網頁引導、不擋 DC 進度）
    }

    // 若玩家正在掛機，進戰鬥時自動先結算一次並結束掛機
    try {
      const memberRoleIds = interaction.member?.roles?.cache?.map((r) => r.id) || [];
      const idleSummary = await sc.idleService?.settleDiscordSessionOnBattleStart(discordId, displayName, { memberRoleIds });
      if (idleSummary) {
        idleSettleNotice = `⏳ 已自動結算掛機（${idleSummary.zoneLabel}）：+${idleSummary.reward.gold} 金幣、+${idleSummary.reward.exp} EXP`;
        try {
          const { getBotClient } = require("../runtimeContext");
          const client = getBotClient();
          if (client?.isReady()) {
            const user = await client.users.fetch(discordId).catch(() => null);
            if (user) {
              const dailyLine = idleSummary.dailyLimitMinutes != null
                ? `\n非會員今日剩餘可領：${Math.max(0, Number(idleSummary.dailyRemainingMinutes || 0))} 分鐘`
                : `\n會員：今日可持續領取`;
              await user.send(
                `⏳ **掛機已自動結算**\n` +
                `區域：${idleSummary.zoneLabel}\n` +
                `原因：你已進入怪物區開始戰鬥\n` +
                `獲得：**${idleSummary.reward.gold} 金幣**、**${idleSummary.reward.exp} EXP**\n` +
                `掛機時長：${Math.max(0, Number(idleSummary.elapsedMinutes || 0))} 分鐘\n` +
                `可計算時長：${Math.max(0, Number(idleSummary.effectiveMinutes || 0))} 分鐘${dailyLine}`
              ).catch(() => {});
            }
          }
        } catch (_) {}
      }
    } catch (e) {
      console.warn("[Idle->Battle] auto settle failed:", e?.message || e);
    }

    let [state, monsters] = await Promise.all([
      sc.monsterService.getState(zoneKey),
      sc.monsterService.listMonsters({ includeDisabled: false, zone: zoneKey })
    ]);
    await _resolveZoneEventIfExpired(sc, zoneKey);
    state = await sc.monsterService.getState(zoneKey);
    if (await _resolveExpiredMonsterTransition(sc, zoneKey)) {
      state = await sc.monsterService.getState(zoneKey);
    }
    if (!isWorldBossZone(zoneKey) && Number(state?.currentHp || 0) <= 0 && !state?.activeEvent && !state?.activeTransition) {
      await _doIdleRotate(sc, zoneKey).catch(() => {});
      state = await sc.monsterService.getState(zoneKey);
      monsters = await sc.monsterService.listMonsters({ includeDisabled: false, zone: zoneKey });
    }

    const ready = await waitForBattleReady(sc, { discordId, zoneKey, interaction, session: activeSessions.get(discordId) });
    if (ready?.blocked) {
      deleteMonsterSession(discordId);
      return;
    }
    if (!ready?.monster || !ready?.state) {
      const queueSeconds = getSessionQueueCountdownSeconds(activeSessions.get(discordId), discordId);
      await interaction.editReply({ content: `⏳ 已自動列隊等待下一場戰鬥，約 ${formatQueueSeconds(queueSeconds)} 後再檢查。` }).catch(() => {});
      return;
    }
    state = ready.state;
    monsters = await sc.monsterService.listMonsters({ includeDisabled: false, zone: zoneKey });
    let monster = ready.monster;

    if (isWorldBossZone(zoneKey) && sc.worldBossServiceFor(zoneKey)) {
      const boss = monsters.find((m) => m.isBoss) || monster;
      if (boss && monster?.id !== boss.id) {
        const bossPartState = ensureWorldBossPartState({}, boss.calc.maxHp, zoneKey);
        const switched = {
          ...state,
          ...freshHellfangFields(), // 牙狼重生：清翻面/累積
          activeMonsterSeq: boss.seq,
          currentHp: bossPartState.currentHp,
          worldBossPartsHp: bossPartState.worldBossPartsHp,
          worldBossPartsMaxHp: bossPartState.worldBossPartsMaxHp,
          participants: [],
          damageMap: {},
          activeEvent: null
        };
        await sc.monsterService.saveState(switched, zoneKey);
        state = switched;
        monster = boss;
      }

      const timeoutResult = await maybeHandleEliteWorldBossTimeout(sc, zoneKey, state, monster);
      state = timeoutResult.state;
      if (timeoutResult.timedOut) {
        await interaction.editReply({
          content: "⌛ 世界BOSS 挑戰超過 1 小時未擊殺，本輪已判定失敗。\n🔒 解鎖進度已重置，需重新擊殺 300 隻高級區怪物才能再次挑戰。"
        });
        return;
      }

      const wb = await sc.worldBossServiceFor(zoneKey).getConfigWithStatus();
      if (!wb.config.enabled || wb.status.cooldownRemainingMs > 0) {
        const queuedReady = await waitForBattleReady(sc, { discordId, zoneKey, interaction, session: activeSessions.get(discordId) });
        if (!queuedReady?.monster || !queuedReady?.state) {
          deleteMonsterSession(discordId);
          return;
        }
        state = queuedReady.state;
        monster = queuedReady.monster;
      }

      const ensured = ensureWorldBossPartState(state, monster.calc.maxHp, zoneKey);
      if (ensured.changed) {
        state = { ...state, ...ensured };
        await sc.monsterService.saveState(state, zoneKey);
      } else {
        state = { ...state, ...ensured };
      }
    }

    const monsterHp = (isWorldBossZone(zoneKey) && monster?.isBoss)
      ? Math.max(0, Number(state?.worldBossPartsHp?.[selectedBossPart] || 0))
      : (state.currentHp != null ? state.currentHp : monster.calc.maxHp);

    const entryFee = Math.max(0, Number(monster?.entryFee ?? getZoneDefaultEntryFee(zoneKey)) || 0);

    let progress = cachedProgress ?? await sc.progressRepository.findByPlayerId(discordId);
    const attrs = progress?.attributes || { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 };
    // 永遠從 DB 讀取最新 effects（不使用 snapshot 裡的舊值）
    let equipped = await mergeEquippedFromLibrary(progress?.equipment || {}, sc.itemRepository);
    // 狼系寵物戰鬥夥伴：出戰寵物(有 combatPassives 且沒餓壞)以虛擬裝備注入
    try {
      const petEntry = sc.petService?.buildPetCombatEntry?.(progress);
      if (petEntry) equipped = { ...equipped, pet_companion: petEntry };
    } catch (_) { /* 寵物加成失敗不影響戰鬥 */ }
    const pStats = calcPlayerStats(attrs, equipped, progress?.activeEffects || [], progress?.inventory || [], { pkRating: progress?.pkRating, zone: zoneKey, petStat: require("../../shared/petDex").statBonusOf(progress?.petDex) });
    const participantCache = createBattleParticipantCache(sc, zoneKey);
    let currentSnapshot = {
      progress,
      player: null,
      displayName,
      equipped,
      inventory: Array.isArray(progress?.inventory) ? progress.inventory : [],
      stats: pStats,
      refs: collectEquipmentEffects(equipped, null, {
        equipped,
        inventory: Array.isArray(progress?.inventory) ? progress.inventory : []
      })
    };
    participantCache.seed(discordId, currentSnapshot);

    // 建立 session（state: waiting）
    const session = {
      state: "waiting",
      zoneKey,
      monsterId: monster.id, monsterSeq: monster.seq, monsterName: monster.name,
      monsterMaxHp: monster.calc.maxHp, monsterHp, monsterStats: monster.calc,
      playerMaxHp: pStats.maxHp, playerHp: pStats.maxHp, playerStats: pStats,
      entryFee, timeoutId: null,
      worldBossTargetPart: selectedBossPart,
      worldBossTargetLabel: selectedBossPartProfile.label
    };

    // 1 分鐘未開始 → 自動逃跑
    session.timeoutId = setTimeout(async () => {
      const s = activeSessions.get(discordId);
      if (s && s.state === "waiting") {
        deleteMonsterSession(discordId);
        const feeNote = session.entryFee > 0 ? `\n入場費 **${session.entryFee}** 🪙 已損失。` : "";
        interaction.editReply({
          content: `⏰ 超過 1 分鐘未開始戰鬥，已自動結束等待。${feeNote}`,
          embeds: [], components: []
        }).catch(() => {});
      }
    }, BATTLE_TIMEOUT_MS);

    setMonsterSession(discordId, session);

    const battleReady = await waitForBattleReady(sc, { discordId, zoneKey, interaction, session });
    if (battleReady.blocked) {
      deleteMonsterSession(discordId);
      return;
    }

    let battleState = battleReady.state;
    let battleMonster = battleReady.monster;

    if (isWorldBossZone(zoneKey) && sc.worldBossServiceFor(zoneKey)) {
      const boss = battleMonster?.isBoss ? battleMonster : (monsters.find((m) => m.isBoss) || battleMonster);
      if (boss && battleMonster?.id !== boss.id) {
        battleMonster = boss;
      }
      const ensured = ensureWorldBossPartState(battleState, battleMonster.calc.maxHp, zoneKey);
      if (ensured.changed) {
        battleState = { ...battleState, ...ensured };
        await sc.monsterService.saveState(battleState, zoneKey);
      } else {
        battleState = { ...battleState, ...ensured };
      }
    }

    session.monsterId = battleMonster.id;
    session.monsterSeq = battleMonster.seq;
    session.monsterName = battleMonster.name;
    session.monsterMaxHp = battleMonster.calc.maxHp;
    session.monsterHp = (isWorldBossZone(zoneKey) && battleMonster?.isBoss)
      ? Math.max(0, Number(battleState?.worldBossPartsHp?.[selectedBossPart] || 0))
      : (battleState.currentHp != null ? battleState.currentHp : battleMonster.calc.maxHp);
    session.monsterStats = battleMonster.calc;
    session.state = "fighting";
    session.battleStartedAt = Date.now();
    session.combatEndsAt = session.battleStartedAt + getBattleBaselineDurationMs(session.playerStats?.agi ?? 1);

    const battleEntryFee = Math.max(0, Number(battleMonster?.entryFee ?? getZoneDefaultEntryFee(zoneKey)) || 0);
    session.entryFee = battleEntryFee;
      if (battleEntryFee > 0) {
        const wallet = await sc.walletRepository.findByPlayerId(discordId).catch(() => ({ gold: 0 }));
        const goldOwned = Math.max(0, Number(wallet?.gold) || 0);
        if (goldOwned < battleEntryFee) {
        deleteMonsterSession(discordId);
        await interaction.editReply({
          content: `❌ 進入 **${battleMonster.name}** 需要 **${battleEntryFee}** 金幣，但你目前只有 **${goldOwned}** 金幣。`,
          embeds: [],
          components: []
        }).catch(() => {});
        return;
      }
      await sc.rewardService.grantCurrency({
        discordId,
        displayName,
        currencyType: "gold",
        amount: -battleEntryFee,
        source: CURRENCY_SOURCES.MONSTER_ENTRY_FEE,
        operator: "monster_zone:enter_battle"
      }).catch((err) => {
        throw err;
      });
    }

    // 加入參戰名單（去重）並更新面板
    const participants = Array.isArray(battleState.participants) ? battleState.participants : [];
    if (!participants.includes(discordId)) {
      const newParticipants = [...participants, discordId];
      if (isWorldBossZone(zoneKey) && battleMonster?.isBoss && participants.length === 0) {
        const startRes = await sc.worldBossServiceFor(zoneKey)?.startBossBattleIfNeeded().catch(() => null);
        await scheduleEliteWorldBossTimeout(sc, zoneKey, battleMonster).catch(() => {});
        // 世界王開打公告:只由「真正開戰(justStarted)」那一次發送,避免 web/DC 重複公告
        try {
          const { getBotClient } = require("../runtimeContext");
          const botClient = getBotClient();
          // 跨平台：DC 開王時也通知所有在線網頁玩家「誰開始挑戰世界王」
          if (startRes?.justStarted && shouldBroadcastZoneActivity(zoneKey)) {
            try { sc._broadcastWorldBossStart?.(battleMonster.name, displayName, discordId); } catch (_) {}
          }
          if (startRes?.justStarted && shouldBroadcastZoneActivity(zoneKey) && botClient?.isReady()) {
            const chatChannel = await botClient.channels.fetch("1498608950671839263").catch(() => null);
            if (chatChannel?.isTextBased?.()) {
              const alarmRoleId = config.discord?.worldBossAlarmRoleId;
              const alarmTag = alarmRoleId ? `\n<@&${alarmRoleId}> 世界王鬧鐘響囉！` : "";
              await chatChannel.send({
                content: `⚔️ **世界BOSS 挑戰開始！**\n**${displayName}** 率先向 **${battleMonster.name}** 發起挑戰！\n前往高級區加入戰鬥，30 分鐘內未擊殺視為失敗。${alarmTag}`,
                allowedMentions: alarmRoleId ? { roles: [alarmRoleId] } : { parse: [] }
              });
            }
          }
        } catch (e) {
          console.warn("[worldBoss] 公告發送失敗:", e?.message || e);
        }
      }
      await sc.monsterService.saveState({
        ...battleState,
        currentHp: (isWorldBossZone(zoneKey) && battleMonster?.isBoss) ? sumWorldBossPartHp(battleState.worldBossPartsHp) : session.monsterHp,
        participants: newParticipants,
        lastHitAt: new Date().toISOString()
      }, zoneKey);
      battleState = {
        ...battleState,
        currentHp: (isWorldBossZone(zoneKey) && battleMonster?.isBoss) ? sumWorldBossPartHp(battleState.worldBossPartsHp) : session.monsterHp,
        participants: newParticipants,
        lastHitAt: new Date().toISOString()
      };
      const layout = await sc.channelLayoutRepository.get();
      const featureKey = zoneToFeatureKey(zoneKey);
      const binding = (layout?.discord?.bindings || []).find((b) => b.featureKey === featureKey);
      if (binding?.channelId) {
        sc.adminConsoleService
          .publishMonsterZonePanel(binding.channelId, battleMonster, (isWorldBossZone(zoneKey) && battleMonster?.isBoss ? battleState.currentHp : session.monsterHp), {
            participantCount: newParticipants.length,
            damageMap: battleState.damageMap || {},
            worldBossPartsHp: battleState.worldBossPartsHp || null
          })
          .catch(() => {});

      }
    }

    // 直接執行戰鬥（自動按下開始戰鬥）
    if (session.timeoutId) { clearTimeout(session.timeoutId); session.timeoutId = null; }

    try {
      let battleState = await sc.monsterService.getState(zoneKey);
      await _resolveZoneEventIfExpired(sc, zoneKey);
      battleState = await sc.monsterService.getState(zoneKey);
      const monsters = await sc.monsterService.listMonsters({ includeDisabled: false, zone: zoneKey });
      let battleMonster = monsters.find((m) => m.id === session.monsterId);

      // 怪物已被別人打死：改成自動排隊等下一隻
      if (!battleMonster || battleState.activeMonsterSeq !== session.monsterSeq) {
        const queuedReady = await waitForBattleReady(sc, { discordId, zoneKey, interaction, session });
        if (!queuedReady?.monster || !queuedReady?.state) {
          deleteMonsterSession(discordId);
          return;
        }
        battleState = queuedReady.state;
        battleMonster = queuedReady.monster;
      }

      const timeoutResult = await maybeHandleEliteWorldBossTimeout(sc, zoneKey, battleState, battleMonster);
      battleState = timeoutResult.state;
      if (timeoutResult.timedOut) {
        deleteMonsterSession(discordId);
        await interaction.editReply({
          content: "⌛ 世界BOSS 挑戰超過 1 小時未擊殺，本輪已判定失敗。\n🔒 解鎖進度已重置，需重新擊殺 300 隻高級區怪物才能再次挑戰。",
          embeds: [],
          components: []
        });
        return;
      }

      if (isWorldBossZone(zoneKey) && battleMonster?.isBoss) {
        const ensured = ensureWorldBossPartState(battleState, battleMonster.calc.maxHp, zoneKey);
        if (ensured.changed) {
          battleState = { ...battleState, ...ensured };
          await sc.monsterService.saveState(battleState, zoneKey);
        } else {
          battleState = { ...battleState, ...ensured };
        }
      }

      session.monsterHp = (isWorldBossZone(zoneKey) && battleMonster?.isBoss)
        ? Math.max(0, Number(battleState?.worldBossPartsHp?.[session.worldBossTargetPart || "body"] || 0))
        : (battleState.currentHp != null ? battleState.currentHp : session.monsterMaxHp);
      if (isWorldBossZone(zoneKey) && battleMonster?.isBoss && session.monsterHp <= 0) {
        deleteMonsterSession(discordId);
        await interaction.editReply({
          content: `✅ ${session.worldBossTargetLabel || "這個部位"}已被擊破，請重新選擇尚未擊破的部位。`,
          embeds: [],
          components: []
        }).catch(() => {});
        return;
      }

      if (isWorldBossZone(zoneKey) && battleMonster?.isBoss && sc.worldBossServiceFor(zoneKey)) {
        const wbCfg = await sc.worldBossServiceFor(zoneKey).getConfig();
        const totalCurrentHp = sumWorldBossPartHp(battleState.worldBossPartsHp);
        const totalMaxHp = sumWorldBossPartHp(battleState.worldBossPartsMaxHp);
        const hpPct = totalMaxHp > 0 ? (totalCurrentHp / totalMaxHp) * 100 : 100;
        const phase = sc.worldBossServiceFor(zoneKey).resolvePhase(wbCfg, hpPct);
        session.worldBossPhase = phase;
        session.monsterStats = applyWorldBossPhaseModifiers(battleMonster.calc, phase);
      } else {
        session.worldBossPhase = null;
      }

      // ── 自動跑完所有回合 ──
      // 蒐集當前參戰者中對 party 生效的 aura（由已在場的治療師等提供）
      // 包含自己（discordId），確保治療師自身的光環也套用到自己
      const participants = Array.isArray(battleState.participants) ? battleState.participants : [];
      const allParticipantsWithSelf = [...new Set([...participants, discordId])];
      const partyEffects = [];
      await Promise.all(allParticipantsWithSelf.map(async (pid) => {
        try {
          const participant = await participantCache.get(pid, pid === discordId ? displayName : null);
          // 永遠從 DB 讀取最新 effects（不使用 snapshot 裡的舊值）
          let refs = participant.refs || [];
          // 聖靈師參戰者：精靈在場 → 其隊伍光環 ×2（progress 缺失時不翻倍，避免誤判）
          try {
            const _sspB = require("../../shared/sunSpirit");
            if (participant.progress && _sspB.hasSpirit(participant.equipped?.job_eq) && _sspB.read(participant.progress, zoneKey) > 0) {
              const _am2 = Number(require("../../shared/jobAdvancement").getSunSpirit(participant.equipped?.job_eq)?.auraMult) || 2;
              refs = refs.map((e) => (e && e.target === "party") ? ({
                ...e,
                value: e.value != null ? Number(e.value) * _am2 : e.value,
                params: { ...(e.params || {}), value: (Number(e.params?.value ?? e.value ?? 0)) * _am2 },
              }) : e);
            }
          } catch (_) { /* noop */ }
          // 吟遊詩人參戰者：演奏加持 → 隊伍光環 ×(1＋連奏×20%)（與網頁端同規則）
          try {
            const _bsB = require("../../shared/bardSong");
            if (participant.progress && _bsB.hasSong(participant.equipped?.job_eq)) {
              const _bm2 = _bsB.auraMult(_bsB.readStreak(participant.progress, zoneKey));
              if (_bm2 > 1) refs = refs.map((e) => (e && e.target === "party") ? ({
                ...e,
                value: e.value != null ? Number(e.value) * _bm2 : e.value,
                params: { ...(e.params || {}), value: (Number(e.params?.value ?? e.value ?? 0)) * _bm2 },
              }) : e);
            }
          } catch (_) { /* noop */ }
          const pidName = resolveAuraSourceName(
            participant.displayName || (pid === discordId ? displayName : null),
            pid
          );
          const pidJobName = getJobNameFromEquipped(participant.equipped);
          const pidJobId = String(participant.equipped?.job_eq?.itemId || participant.equipped?.job_eq?.id || "");
          // 神射手參戰者：合成掩護射擊（吃該參戰者當下的 ATK/爆擊）
          try {
            const _snP = require("../../shared/jobAdvancement").getSniper(participant.equipped?.job_eq);
            if (_snP) {
              refs = [...refs, {
                key: "support_shot", target: "party", trigger: "passive", chance: 100,
                params: { value: Number(_snP.supportShotPct) || 70, casterAtk: Math.round(participant.stats?.atk || 0), casterCrit: Math.round(participant.stats?.crit || 0) },
                srcItem: "神射手徽章", sourceDiscordId: pid,
                sourceJobId: pidJobId, sourceJobName: pidJobName || "神射手徽章",
              }];
            }
          } catch (_) { /* noop */ }
          for (const r of refs) {
            if (r && r.target === 'party') {
              const scaled = scaleSupportPartyEffect(r, {
                providerStats: participant.stats || {},
                jobName: pidJobName,
                equipped: participant.equipped || {},
                inventory: participant.inventory || [],
                zone: zoneKey,
              });
              // 光環標籤：優先標「來源道具」，沒有才標職業徽章（與網頁一致）
              partyEffects.push({ ...scaled, sourceName: pidName, sourceJobName: r.srcItem || pidJobName, sourceJobId: pidJobId, isSelfAura: pid === discordId, sourceDiscordId: pid });
            }
          }
        } catch (e) {}
      }));

      // ── 跨平台共通光環：本玩家若為輔助職（裝備帶 party 效果），寫入共享 activeHealerAuras 陣列
      //    （與網頁同格式），讓網頁/DC 其他玩家都吃得到；非輔助職則把自己從陣列移除。
      //    註：實際「取最高／不疊加」由 combatLoop 統一處理，這裡只負責維護提供者名單。──
      try {
        let selfRawParty = (currentSnapshot.refs || []).filter((r) => r && r.target === "party");
        // 聖靈師：精靈在場（依存檔血量%）→ 寫進共享狀態的光環值 ×2（與網頁同規則）
        try {
          const _sspA = require("../../shared/sunSpirit");
          if (_sspA.hasSpirit(currentSnapshot.equipped?.job_eq) && _sspA.read(currentSnapshot.progress, zoneKey) > 0) {
            const _am = Number(require("../../shared/jobAdvancement").getSunSpirit(currentSnapshot.equipped?.job_eq)?.auraMult) || 2;
            selfRawParty = selfRawParty.map((e) => ({
              ...e,
              value: e.value != null ? Number(e.value) * _am : e.value,
              params: { ...(e.params || {}), value: (Number(e.params?.value ?? e.value ?? 0)) * _am },
            }));
          }
        } catch (_) { /* 精靈判定失敗不影響光環 */ }
        // 吟遊詩人：演奏加持 → 寫進共享狀態的光環值 ×(1＋連奏×20%)（與網頁同規則）
        try {
          const _bsA = require("../../shared/bardSong");
          if (_bsA.hasSong(currentSnapshot.equipped?.job_eq)) {
            const _bm = _bsA.auraMult(_bsA.readStreak(currentSnapshot.progress, zoneKey));
            if (_bm > 1) selfRawParty = selfRawParty.map((e) => ({
              ...e,
              value: e.value != null ? Number(e.value) * _bm : e.value,
              params: { ...(e.params || {}), value: (Number(e.params?.value ?? e.value ?? 0)) * _bm },
            }));
          }
        } catch (_) { /* 演奏判定失敗不影響光環 */ }
        // 神射手：合成掩護射擊（傷害型光環）寫進共享狀態，與網頁同規則
        try {
          const _snC = require("../../shared/jobAdvancement").getSniper(currentSnapshot.equipped?.job_eq);
          if (_snC) {
            selfRawParty = [...selfRawParty, {
              key: "support_shot", target: "party", trigger: "passive", chance: 100,
              params: { value: Number(_snC.supportShotPct) || 70, casterAtk: Math.round(currentSnapshot.stats?.atk || 0), casterCrit: Math.round(currentSnapshot.stats?.crit || 0) },
              srcItem: "神射手徽章", sourceDiscordId: discordId,
            }];
          }
        } catch (_) { /* noop */ }
        const selfJobName = getJobNameFromEquipped(currentSnapshot.equipped);
        const selfJobId = String(currentSnapshot.equipped?.job_eq?.itemId || currentSnapshot.equipped?.job_eq?.id || "");
        const prevAurasRaw = Array.isArray(battleState.activeHealerAuras)
          ? battleState.activeHealerAuras
          : (battleState.activeHealerAura ? [{ ...battleState.activeHealerAura }] : []);
        // 過期剔除：提供者超過 3 分鐘沒在本區出戰＝離場（與網頁端同規則）
        const prevAuras = filterActiveAuras(prevAurasRaw);
        let nextAuras;
        if (selfRawParty.length > 0) {
          nextAuras = [...prevAuras.filter((a) => a && a.discordId !== discordId), { discordId, displayName, effects: selfRawParty, jobId: selfJobId, jobName: selfJobName || null, lastAt: Date.now() }];
        } else {
          nextAuras = prevAuras.filter((a) => a && a.discordId !== discordId);
        }
        // 與原始陣列比對：過期項被剔除時也要落地，狀態裡才不會殘留殭屍光環
        if (JSON.stringify(nextAuras) !== JSON.stringify(prevAurasRaw)) {
          battleState = { ...battleState, activeHealerAuras: nextAuras, activeHealerAura: null };
          await sc.monsterService.saveState(battleState, zoneKey).catch(() => {});
        }
      } catch (e) {}

      // ── 共鬥光環（跨平台）：讀 activeHealerAuras 陣列（含網頁玩家寫入的提供者），
      //    把不在本場 participants 內的提供者光環依其「當前數值」縮放後加入。
      //    是否疊加 → 否；最終由 combatLoop 對同一效果取最高。──
      // 過期剔除：只套用最近 3 分鐘內有出戰的提供者光環
      const zoneAuras = filterActiveAuras(Array.isArray(battleState.activeHealerAuras)
        ? battleState.activeHealerAuras
        : (battleState.activeHealerAura ? [battleState.activeHealerAura] : []));
      await Promise.all(zoneAuras.map(async (aura) => {
        try {
          if (!aura || !Array.isArray(aura.effects) || !aura.discordId) return;
          // 自己與已在場參戰者，前面 participant 迴圈已算過，避免重複收集
          if (aura.discordId === discordId || participants.includes(aura.discordId)) return;
          const provider = await participantCache.get(aura.discordId, aura.displayName || null);
          const auraJobName = aura.jobName || getJobNameFromEquipped(provider.equipped) || "輔助";
          const auraJobId = String(aura.jobId || provider.equipped?.job_eq?.itemId || provider.equipped?.job_eq?.id || "");
          const srcName = resolveAuraSourceName(aura.displayName || provider.displayName, aura.discordId);
          for (const r of aura.effects) {
            if (!r || r.target !== "party") continue;
            const scaled = scaleSupportPartyEffect(r, {
              providerStats: provider.stats || {},
              jobName: auraJobName,
              equipped: provider.equipped || {},
              inventory: provider.inventory || [],
              zone: zoneKey,
            });
            partyEffects.push({
              ...scaled,
              sourceName: srcName,
              sourceJobName: r.srcItem || auraJobName,
              sourceJobId: auraJobId,
              isSelfAura: false,
              sourceDiscordId: aura.discordId,
            });
          }
        } catch (e) {}
      }));

      let currentProg = currentSnapshot.progress;
      // 永遠從 DB 讀取最新 effects（不使用 snapshot 裡的舊值）
      let currentEquipped = currentSnapshot.equipped;
      const currentJobId = String(currentEquipped?.job_eq?.itemId || currentEquipped?.job_eq?.id || "");
      const currentJobName = getJobNameFromEquipped(currentEquipped);
      const _wd = require("../../shared/windDirection");
      const windDirectionOn = _wd.hasEffect(currentEquipped);
      const windDirectionBefore = windDirectionOn ? _wd.read(currentProg) : 0;

      let battlePlayerStats = session.playerStats;
      let battleMonsterStats = session.monsterStats;
      let battleMonsterEquipped = buildMonsterEquipped(battleMonster);
      let battleTargetNote = null;
      if (isWorldBossZone(zoneKey) && battleMonster?.isBoss) {
        const part = session.worldBossTargetPart;
        const adjP = applyWorldBossTargetToPlayerStats(session.playerStats, part, zoneKey);
        battlePlayerStats = adjP.stats;
        battleTargetNote = adjP.profile?.note || null;
        const adjM = applyWorldBossTargetToMonster(session.monsterStats, battleMonsterEquipped, part, zoneKey);
        battleMonsterStats = adjM.monsterStats;
        battleMonsterEquipped = adjM.monsterEquipped;
        // 古龍王:依「已破壞部位」套破鱗削弱(攻擊面;不削防禦)
        if (zoneKey === DRAGON_KING_ZONE) {
          const weakened = applyDragonKingBreakWeaken(battleMonsterStats, battleMonsterEquipped, battleState?.worldBossPartsHp);
          battleMonsterStats = weakened.monsterStats;
          battleMonsterEquipped = weakened.monsterEquipped;
        }
        // 牙狼分階段(王側)：剩 3~2 部位「狂亂」→ 迴避大增 + 王攻擊減半；最終核心/正常 → 不變
        if (zoneKey === HELLFANG_ZONE) {
          const ph = hellfangBossPhaseMods(battleState);
          if (ph.dodgeBonus || ph.dmgMult !== 1) {
            battleMonsterStats = {
              ...battleMonsterStats,
              dodge: Math.min(95, (Number(battleMonsterStats.dodge) || 0) + ph.dodgeBonus),
              finalDamageMultiplier: (Number(battleMonsterStats.finalDamageMultiplier) || 1) * ph.dmgMult
            };
          }
        }
      }

      const monsterHpBeforeBattle = session.monsterHp;
      // ── 牙狼部位弱點倍率(整場固定)：同流派×1、不同×0.3。直接乘進戰鬥每擊終傷，避免「原始傷害提早打死部位、
      //    結算×倍率後其實沒死」的收不掉bug。倍率在開戰算好、結算沿用同一值。 ──
      session.hellfangMult = 1;
      if (zoneKey === HELLFANG_ZONE && battleMonster?.isBoss) {
        const _part = session.worldBossTargetPart || "body";
        session.hellfangMult = hellfangDamageMult(battleState, _part, session.playerStats?.weaponType, Date.now()).mult;
      }
      const _dsg = require("../../shared/dwarfStunGauge");
      const _stunZoneOn = isWorldBossZone(zoneKey) && Boolean(battleMonster?.isBoss);
      const stunGaugeKey = _stunZoneOn ? _dsg.gaugeKeyForZone(zoneKey) : null;
      const _turtleNow = Date.now();
      const _turtleStunSync = zoneKey === TURTLE_ZONE && battleMonster?.isBoss
        ? await require("../../shared/turtleStunSync").reconcileTurtleCastFromStunGauge(battleState, zoneKey, _turtleNow)
        : null;
      const stunStateBefore = _turtleStunSync?.stunState || (stunGaugeKey ? await _dsg.read(stunGaugeKey, zoneKey).catch(() => null) : null);
      const teamStunOn = Boolean(stunStateBefore?.stunned);
      // ── 島島龜王（活動）：潮汐/海嘯修正——推進詠唱狀態機後取本場修正 ──
      session.turtleTsunami = false;
      session.turtleGaugeMult = 1;
      session.turtleTsunamiRound = null;
      if (zoneKey === TURTLE_ZONE && battleMonster?.isBoss) {
        const _tt = require("../../shared/turtleTide");
        const _part = session.worldBossTargetPart || "body";
        const _partsHp = battleState?.worldBossPartsHp || {};
        const _tpl = createWorldBossPartHpTemplate(battleMonster.calc.maxHp, zoneKey);
        const _totMax = Object.values(_tpl).reduce((s, v) => s + v, 0);
        const _totCur = getWorldBossPartKeys(zoneKey).reduce((s, k) => s + Math.max(0, Number(_partsHp[k] ?? _tpl[k]) || 0), 0);
        const _pct = _totMax > 0 ? (_totCur / _totMax) * 100 : 100;
        const _events = _tt.ensureCast(battleState, _pct, _turtleNow);
        if (_turtleStunSync?.repaired || _events.length) await sc.monsterService.saveState(battleState, zoneKey).catch(() => {});
        const _mods = _tt.battleMods(battleState, _part, _turtleNow);
        if (_mods.headBlocked) {
          deleteMonsterSession(discordId);
          await interaction.editReply({
            content: "🌊 漲潮中——龜首縮回殼裡打不到！等退潮再攻頭部（其他部位照常）。",
            embeds: [], components: []
          }).catch(() => {});
          return;
        }
        session.turtleTsunami = _mods.tsunami;
        session.hellfangMult = session.hellfangMult * _mods.mult; // 共用終傷通道（其他王不受影響）
        session.turtleForceHit = _mods.forceHitHead;
        session.turtleGaugeMult = Math.max(1, Number(_mods.gaugeMult) || 1);
        session.turtleTsunamiRound = _tt.tsunamiRoundForBattle(
          battleState,
          calculateTickDelay(session.playerStats?.agi ?? 1),
          _turtleNow
        );
      }
      // ── 怪物圖鑑：依玩家對「這隻怪」的累積擊殺，算出本場傷害加成 ──
      const _bestiaryIsWorldBoss = isWorldBossZone(zoneKey);
      const _bestiaryMonsterId = String(battleMonster?.id || battleMonster?._id || session.monsterName || "");
      const _bestiaryReq = bestiaryRequirement(battleMonster, _bestiaryIsWorldBoss);
      const _bestiaryKillsBefore = Number(currentProg?.bestiary?.[_bestiaryMonsterId]) || 0;
      let _bestiaryBonusPct = bestiaryBonusPct(_bestiaryKillsBefore, _bestiaryReq);
      // 知彼（兵聖）：圖鑑傷害加成 ×knowledgeMult（上限同步放大）
      let _bestiaryCapPct;
      try {
        const _sgK = require("../../shared/jobAdvancement").getSage(currentEquipped?.job_eq);
        if (_sgK) {
          const _km = Number(_sgK.knowledgeMult) || 2;
          _bestiaryBonusPct *= _km;
          _bestiaryCapPct = require("../../shared/bestiary").MAX_BONUS_PCT * _km;
        }
      } catch (_) { /* noop */ }
      // ── 區域連段（Zone COMBO）── 與網頁共用同一份狀態，DC 出戰一樣累積
      const _zc = require("../../shared/zoneCombo");
      const comboBefore = _zc.readCombo(currentProg, zoneKey);
      const comboBenefits = _zc.benefitsFromCombo(currentEquipped?.job_eq);
      const comboEffects = comboBenefits ? _zc.comboBuffs(comboBefore) : [];

      // ── 戰意集氣（狂戰士）── 與網頁共用；DC 沒有血祭按鈕，但集氣照累、滿氣照自動觸發
      const _bg = require("../../shared/berserkGauge");
      const _gaugeCfg = require("../../shared/jobAdvancement").getGauge(currentEquipped?.job_eq);
      const gaugeBefore = _gaugeCfg ? _bg.read(currentProg, _gaugeCfg) : 0;
      const gaugeFull = Boolean(_gaugeCfg && _bg.isFull(gaugeBefore, _gaugeCfg));
      const berserkEffects = gaugeFull ? _bg.buffs(_gaugeCfg) : [];
      // ── 連擊氣條（影舞者）── 與網頁共用同一份狀態，氣條照累、滿格照觸發
      const _sg = require("../../shared/shadowGauge");
      const shadowOn = _sg.hasGauge(currentEquipped?.job_eq);
      const shadowGridsBefore = shadowOn ? _sg.read(currentProg, zoneKey) : 0;
      // ── 氣力格（劍鬼）── 與網頁共用同一份狀態；氣條照累、滿格照自動斬
      const _og = require("../../shared/oniGauge");
      const oniOn = _og.hasGauge(currentEquipped?.job_eq);
      const oniGridsBefore = oniOn ? _og.read(currentProg, zoneKey) : 0;
      // ── 日之精靈（聖靈師）── 與網頁共用同一份狀態
      const _ssp = require("../../shared/sunSpirit");
      const spiritOn = _ssp.hasSpirit(currentEquipped?.job_eq);
      const spiritPctBefore = spiritOn ? _ssp.read(currentProg, zoneKey) : 0;
      // ── 震盪值（神射手）── 與網頁共用同一份狀態
      const _sng = require("../../shared/sniperGauge");
      const sniperOn = _sng.hasGauge(currentEquipped?.job_eq);
      const sniperGridsBefore = sniperOn ? _sng.read(currentProg, zoneKey) : 0;
      // 命運骰＋手氣（賭神）
      const _dgg = require("../../shared/diceGauge");
      const diceGodOn = _dgg.hasGauge(currentEquipped?.job_eq);
      const diceGridsBefore = diceGodOn ? _dgg.read(currentProg, zoneKey) : 0;
      const diceLuckBefore = diceGodOn ? _dgg.readLuck(currentProg) : 0;
      // ── 計謀值（兵聖）── 與網頁共用同一份狀態
      const _sag = require("../../shared/sageGauge");
      const sageOn = _sag.hasGauge(currentEquipped?.job_eq);
      const sageGridsBefore = sageOn ? _sag.read(currentProg, zoneKey) : 0;

      // ── 世界王暈眩條（矮人戰士長・巨神震擊）── 與網頁共用同一條
      // ── 區域冰凍值（元素師・凍霜）── DC 玩家也吃冰封窗口（DC 沒姿態鈕、走預設嵐暴 → 不累積，只受惠）
      const _zfg = require("../../shared/zoneFreezeGauge");
      const freezeStateBefore = await _zfg.read(_zfg.gaugeKeyForZone(zoneKey), zoneKey).catch(() => null);
      const zoneFrozenOn = Boolean(freezeStateBefore?.frozen);
      const teamControlContributors = mergeContributorMaps(
        teamStunOn ? stunStateBefore?.windowContributors : null,
        zoneFrozenOn ? freezeStateBefore?.windowContributors : null
      );

      // ── 區域聖域值（聖域師）── DC 玩家也吃聖域窗口（受傷減半＋回血）；聖域師在 DC 出戰也累積。
      //    使用者定案：DC 不發任何公告，效果照吃。
      const _scg = require("../../shared/sanctumGauge");
      const _dcSanctumKey = _scg.gaugeKeyForZone(zoneKey);
      const sanctumStateBefore = await _scg.read(_dcSanctumKey, zoneKey).catch(() => null);
      const zoneSanctumOn = Boolean(sanctumStateBefore?.sanctum);
      const _SANCTUM_DEF = require("../../shared/jobAdvancement").getSanctum({ itemId: "job_sanctum_t2_v1" });

      // DC 沒有姿態按鈕 → 一律走該職業的預設姿態（聖劍士=攻擊、元素師=嵐暴；非姿態職業=null 完全同現況）
      let dcStanceKey = null;
      try { dcStanceKey = require("../../shared/battleStance").resolveRequestedStance(currentEquipped, undefined); } catch (_) { dcStanceKey = null; }

      const { runCombatLoop } = require("../../shared/combatLoop");
      let combatResult =
        runCombatLoop(battlePlayerStats, battleMonsterStats, session.monsterName, monsterHpBeforeBattle, MAX_ROUNDS, {
          playerName: displayName,
          stance: dcStanceKey,
          teamStunRounds: (teamStunOn || zoneFrozenOn) ? 999 : 0,
          teamStunStyle: (!teamStunOn && zoneFrozenOn) ? "freeze" : undefined,
          teamControlContributors,
          playerLevel: currentProg?.level || 1,
          playerActiveEffects: [...comboEffects, ...berserkEffects],
          warGaugeCritBonus: gaugeFull ? _gaugeCfg.critRateBonus : 0,
          shadowGaugeGrids: shadowGridsBefore, // 連擊氣條（影舞者）
          oniGaugeGrids: oniGridsBefore,       // 氣力格（劍鬼）
          sunSpiritHpPct: spiritOn ? spiritPctBefore : undefined, // 日之精靈（聖靈師）
          sniperGaugeGrids: sniperGridsBefore, // 震盪值（神射手）
          sageGaugeGrids: sageGridsBefore,     // 計謀值（兵聖）
          diceGaugeGrids: diceGridsBefore,     // 命運骰（賭神）
          diceLuckStacks: diceLuckBefore,      // 手氣正旺（賭神）
          windDirectionStep: windDirectionBefore,
          zoneComboCount: comboBefore, // 劍鬼斬的倍率來源
          equipped: currentEquipped,
          inventory: currentProg?.inventory || [],
          partyEffects,
          monsterEquipped: battleMonsterEquipped,
          monsterIsBoss: Boolean(battleMonster?.isBoss),
          worldBossPhase: session.worldBossPhase || null,
          bestiaryBonusPct: _bestiaryBonusPct,
          bestiaryBonusCapPct: _bestiaryCapPct, // 知彼（兵聖）上限放大；一般職業使用圖鑑共用上限
          isWorldBoss: isWorldBossZone(zoneKey) && Boolean(battleMonster?.isBoss), // 世界王:玩家 DOT 也吃王 def%
          bossVulnMult: session.hellfangMult, // 牙狼弱點/龜王潮汐倍率:玩家每擊終傷×此值(其他戰鬥=1不影響)
          tsunamiDeath: session.turtleTsunami || false, // 海嘯（島島龜王）：出戰即死
          tsunamiDeathRound: session.turtleTsunamiRound || null, // 詠唱在本場途中完成也會直接命中
          forcePlayerHit: session.turtleForceHit || false, // 退潮打龜首必中
          zone: zoneKey, // 讓裝備的 zone 條件特效生效(例：S 龍系武器在龍族之領/龍王巢穴 +20%)
          monsterElement: battleMonster?.element || null, // 屬性相剋；怪物無 element 則不參與(現有怪皆是)
          monsterElementLevel: battleMonster?.element ? (battleMonster?.elementLevel || 1) : 0,
          // 聖域窗口（聖域師區域條滿）：本場受傷減免＋每回合回血（DC 玩家照吃、不公告）
          sanctuaryCutPct: zoneSanctumOn ? (Number(_SANCTUM_DEF?.sanctumDamageCutPct) || 50) : 0,
          sanctuaryHealPct: zoneSanctumOn ? (Number(_SANCTUM_DEF?.sanctumHealPct) || 3) : 0,
          sanctuaryContributors: zoneSanctumOn ? sanctumStateBefore?.windowContributors : null,
        });
      // 聖域師在 DC 出戰 → 累積聖域值（每場 +1；靜默，不公告）
      if (_scg.canKnock(currentEquipped?.job_eq)) {
        await _scg.knock(_dcSanctumKey, zoneKey, 1, displayName, Date.now(), discordId, currentJobId, currentJobName || "聖域師").catch(() => null);
      }
      const { roundLogs, finalPlayerHp } = combatResult;
      let combatStats = combatResult.combatStats;
      const zoneDamageSyncApplied = false;
      const syncResult = zoneDamageSyncApplied
        ? applyZoneDamageSync(
          zoneKey,
          monsterHpBeforeBattle,
          battleMonster?.calc?.maxHp || session.monsterStats?.maxHp,
          combatResult.totalDamage,
          combatResult.finalMonsterHp,
          combatResult.outcome
        )
        : {
          damage: Math.max(0, Math.round(Number(combatResult.totalDamage || 0))),
          monsterHp: Math.max(0, Math.round(Number(combatResult.finalMonsterHp ?? Math.max(0, monsterHpBeforeBattle - combatResult.totalDamage)))),
          outcome: combatResult.outcome,
          applied: false,
          notice: null
        };
      let outcome = syncResult.outcome;
      const totalDamage = syncResult.damage;
      session.monsterHp = syncResult.monsterHp;
      session.playerHp  = finalPlayerHp;
      const totalTaken = Math.max(0, (session.playerMaxHp || 0) - Math.max(0, finalPlayerHp));
      let battleStateForSettlement = battleState;
      let allPartsDefeated = false;
      let worldBossClosedBeforeWrite = false;
      let staleBattleBeforeWrite = false;

      // ── 戰鬥結果立刻更新排行榜（不等結算完成）──
      const currentParticipants = Array.isArray(battleState.participants) ? battleState.participants : [];
      try {
        const freshState = await sc.monsterService.getState(zoneKey);
        staleBattleBeforeWrite = isStaleMonsterBattleState(zoneKey, battleMonster, freshState);
        worldBossClosedBeforeWrite = await isWorldBossClosedForWrite(sc, zoneKey, battleMonster, freshState);
        if (staleBattleBeforeWrite || worldBossClosedBeforeWrite) {
          console.warn(`[MonsterZone] stale battle result skipped | player=${discordId} | zone=${zoneKey} | monster=${battleMonster?.name || "?"}`);
        } else {
        // 記錄 DC 玩家「目前在此區域戰鬥」的存在感(供網頁戰鬥畫面玩家氣泡;含 DC 玩家)
        try { require("../../services/realtime/battlePresence").touch(discordId, { name: displayName, level: currentProg?.level, zone: zoneKey, damage: totalDamage }); } catch (_) { /* noop */ }
        const prev = freshState.damageMap || {};
        // 掩護射擊歸戶：箭傷從出戰者的貢獻拆出、記給提供箭的神射手（與網頁同規則）
        const _supportSplit = allocateDirectDamage(
          totalDamage,
          combatResult?.totalDamage,
          combatResult?.combatStats?.supportShotBySource || {}
        );
        const _supportBySrc = _supportSplit.bySource;
        const _supportDamageBySource = {};
        const updatedDamageMap = {
          ...prev,
          [discordId]: {
            name: displayName,
            level: currentProg?.level || 1,
            damage: (prev[discordId]?.damage || 0) + _supportSplit.selfDamage,
            taken: (prev[discordId]?.taken || 0) + totalTaken,
            assist: Number(prev[discordId]?.assist) || 0,
          }
        };
        for (const [_srcId, _amt] of Object.entries(_supportBySrc)) {
          if (!_srcId || _srcId === discordId) continue;
          const _add = Math.max(0, Math.round(Number(_amt) || 0));
          if (_add <= 0) continue;
          const _auraName = (Array.isArray(freshState.activeHealerAuras)
            ? freshState.activeHealerAuras.find((a) => a && a.discordId === _srcId)?.displayName
            : null) || prev[_srcId]?.name || "神射手";
          const _job = combatResult?.combatStats?.supportShotBySourceJob?.[_srcId] || {};
          _supportDamageBySource[_srcId] = {
            amount: _add,
            jobId: _job.jobId || "job_sniper_t2_v1",
            jobName: _job.jobName || "神射手",
            displayName: _auraName,
          };
          const _prevEntry = updatedDamageMap[_srcId] || { name: _auraName, level: prev[_srcId]?.level || 1, damage: 0, taken: 0 };
          updatedDamageMap[_srcId] = { ..._prevEntry, name: _prevEntry.name || _auraName, damage: (_prevEntry.damage || 0) + _add };
        }
        const latestHp = Math.max(0, Number(freshState.currentHp ?? monsterHpBeforeBattle));
        const nextHp = Math.max(0, latestHp - totalDamage);
        session.monsterHp = nextHp;
        if (nextHp <= 0) outcome = "win";
        let nextState = { ...freshState, currentHp: nextHp, damageMap: updatedDamageMap, lastHitAt: new Date().toISOString() };
        let hellfangEventDC = null; // 牙狼適應性狀態變化(給DC戰報)
        if (isWorldBossZone(zoneKey) && battleMonster?.isBoss) {
          const part = session.worldBossTargetPart || "body";
          const prevParts = ensureWorldBossPartState(freshState, battleMonster.calc.maxHp, zoneKey);
          const latestPartHp = Math.max(0, Number(prevParts.worldBossPartsHp?.[part] || 0));
          // 牙狼(hellfire_depths)：倍率已在戰鬥每擊終傷套用(bossVulnMult)→totalDamage 即有效傷害，結算不再重複乘。
          const wbDamage = totalDamage;
          const nextPartHp = Math.max(0, latestPartHp - wbDamage);
          session.monsterHp = nextPartHp;
          if (nextPartHp <= 0) outcome = "win";
          const nextPartsHp = { ...prevParts.worldBossPartsHp, [part]: nextPartHp };
          // 元素師炎圈：Discord 與 Web／單人王相同，對其他尚存部位鏡射本場炎圈傷害。
          const mirror = mirrorDamageToOtherParts(nextPartsHp, part, combatResult?.combatStats?.fireCircleDamage);
          Object.assign(nextPartsHp, mirror.partsHp);
          const fcMirrorTotalDC = mirror.total;
          nextState = {
            ...nextState,
            worldBossPartsHp: nextPartsHp,
            worldBossPartsMaxHp: prevParts.worldBossPartsMaxHp,
            currentHp: sumWorldBossPartHp(nextPartsHp)
          };
          if (fcMirrorTotalDC > 0) {
            const selfEntry = nextState.damageMap[discordId];
            nextState.damageMap = {
              ...nextState.damageMap,
              [discordId]: { ...selfEntry, damage: (Number(selfEntry?.damage) || 0) + fcMirrorTotalDC },
            };
            roundLogs.push(`🔥 **炎圈**延燒全身——其他部位共受到 **${fcMirrorTotalDC.toLocaleString()}** 點灼燒！`);
          }
          if (zoneKey === HELLFANG_ZONE) {
            // 貢獻榜改用有效傷害(避免打錯流派的玻璃砲空刷排名)
            nextState.damageMap = { ...nextState.damageMap, [discordId]: { ...nextState.damageMap[discordId], damage: (prev[discordId]?.damage || 0) + _supportSplit.selfDamage + fcMirrorTotalDC } };
            // 翻面累積：依玩家流派歸屬本場有效傷害；該部位達 1/3 HP 首次觸發翻面(抵禦你用比較多的那系,10分,一生一次)
            const _partMax = Number(prevParts.worldBossPartsMaxHp?.[part]) || Number(battleMonster.calc.maxHp) || 0;
            hellfangEventDC = hellfangPartAccrue(nextState, part, _partMax, hellfangPlayerSchool(session.playerStats?.weaponType), wbDamage, Date.now());
            if (hellfangEventDC) { try { roundLogs.push(hellfangFlipLines(hellfangEventDC).join("\n")); } catch (_) { /* 戰報追加失敗不影響結算 */ } }
          }

          // 龜王 70%／40% 固定詠唱：本場扣血跨線後立刻寫入共用狀態。
          if (zoneKey === TURTLE_ZONE && nextState.currentHp > 0) {
            const turtleTotalMax = Object.values(prevParts.worldBossPartsMaxHp || {})
              .reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
            require("../../shared/turtleTide").ensureCast(
              nextState,
              turtleTotalMax > 0 ? (nextState.currentHp / turtleTotalMax) * 100 : 100,
              Date.now()
            );
          }
          allPartsDefeated = isWorldBossAllPartsDefeated(nextPartsHp);

          // ── KDA（附錄C v3）：本場 K/D 賽季累積＋助攻歸戶＋寶箱排名用的 spawn 助攻 ──
          try {
            const _al = combatResult?.assistLedger || {};
            // spawn 級助攻 → damageMap[src].assist（寶箱 C 排名用；與 damage 同一份結算路徑）
            const _creditSpawnAssist = (srcId, amt) => {
              const v = Math.max(0, Math.round(Number(amt) || 0));
              const id = String(srcId || "");
              if (!id || v <= 0 || id === discordId) return;
              const cur = nextState.damageMap[id] || { name: prev[id]?.name || id, level: prev[id]?.level || 1, damage: 0, taken: 0 };
              nextState.damageMap = { ...nextState.damageMap, [id]: { ...cur, assist: (Number(cur.assist) || 0) + v } };
            };
            for (const [_sid, _amt] of Object.entries(_al.bySource || {})) _creditSpawnAssist(_sid, _amt);
            // 賽季累積（非同步，失敗不影響結算）；quest＝賽季任務指標（撐滿15回合/抗性/傷害/助攻）
            let _resistPct = 0;
            try {
              _resistPct = require("../../shared/elementSystem")
                .getSameElementResist(currentEquipped || {}, battleMonster?.element || null).pct || 0;
            } catch (_) { /* 抗性算不出來就當 0 */ }
            require("../../services/kda/kdaService").recordBattle({
              discordId, displayName,
              damage: _supportSplit.selfDamage + fcMirrorTotalDC,
              died: outcome === "lose",
              battleJobId: currentJobId,
              battleJobName: currentJobName,
              damageBySource: _supportDamageBySource,
              assistBySource: _al.bySource || null,
              assistBySourceJob: _al.bySourceJob || null,
              quest: {
                questService: sc?.questService || sc?.weeklyQuestService,
                rounds: (combatResult?.nextRound || 2) - 1,
                resistPct: _resistPct,
              },
            }).catch(() => {});
          } catch (_) { /* KDA 記錄失敗不影響結算 */ }
        }
        await sc.monsterService.saveState(nextState, zoneKey);
        battleStateForSettlement = nextState;
        await _republishPanel(
          sc,
          zoneKey,
          battleMonster,
          nextState.currentHp,
          currentParticipants.length,
          updatedDamageMap,
          null,
          nextState.worldBossPartsHp || null,
          { fastUpdate: true }
        );
        // ── 怪物圖鑑累積：本場(對該怪造成傷害 / 該怪最大HP，最多算 1 隻)原子累加 ──
        session._bestiary = null; // 先清空,本場有累積才設(讓「每場通知」只反映本場)
        try {
          const _bMaxHp = Math.max(1, Number(battleMonster?.calc?.maxHp || session.monsterStats?.maxHp || monsterHpBeforeBattle || 1));
          const _bGain = bestiaryGainFromDamage(totalDamage, _bMaxHp);
          if (_bGain > 0 && _bestiaryMonsterId) {
            await sc.progressRepository.incrementFields(
              discordId,
              { ["bestiary." + _bestiaryMonsterId]: _bGain }
            );
            const _bTotalAfter = _bestiaryKillsBefore + _bGain;
            session._bestiary = {
              monsterName: session.monsterName || battleMonster?.name || "怪物",
              gainPct: Math.round(_bGain * 1000) / 10,
              killsAfter: _bTotalAfter,
              requirement: _bestiaryReq,
              bonusPctAfter: bestiaryBonusPct(_bTotalAfter, _bestiaryReq)
            };
          }
        } catch (e) {
          console.error("[Bestiary] credit failed:", e.message);
        }
        }
      } catch (e) {
        console.error("[monsterZoneHandlers] 排行榜更新失敗:", e.message);
      }

      // ── 結算 ──
      let rewardLines = [];
      let embedTitle, embedColor;
      let pendingDeathCooldown = false;

      if (staleBattleBeforeWrite || worldBossClosedBeforeWrite) {
        embedTitle = isWorldBossZone(zoneKey) && battleMonster?.isBoss ? "⏳ 世界BOSS 已結束" : "⏳ 怪物已更新";
        embedColor = 0x64748b;
        rewardLines = [isWorldBossZone(zoneKey) && battleMonster?.isBoss
          ? "世界BOSS 已被其他冒險者擊破並進入冷卻，本次排隊攻擊未寫入傷害，也不會重複結算獎勵。"
          : "這隻怪物已被其他冒險者擊破或正在轉場，本次排隊攻擊未寫入傷害，也不會重複結算獎勵。"];
      } else if (outcome === "win") {
        if (isWorldBossZone(zoneKey) && battleMonster?.isBoss && !allPartsDefeated) {
          embedTitle = "✅ 部位擊破";
          embedColor = 0x22c55e;
          rewardLines = ["目前僅擊破一個部位，需所有部位全破才會結算世界王擊殺獎勵。"];
        } else {
          session.monsterHp = 0;
          rewardLines = await handleMonsterKill({ discordId, displayName, session, monster, state: battleStateForSettlement, totalDamage, zoneKey });
          embedTitle = "🏆 勝利！";
          embedColor = 0xf1c40f;
        }
      } else if (outcome === "lose") {
        session.monsterHp = Math.max(0, session.monsterHp);
        // 排行榜已在戰鬥完成後立刻更新，此處只紀錄狀態
        try {
          const freshState = await sc.monsterService.getState(zoneKey);
          await sc.monsterService.saveState({
            ...freshState,
            currentHp: (isWorldBossZone(zoneKey) && battleMonster?.isBoss)
              ? sumWorldBossPartHp(freshState.worldBossPartsHp)
              : session.monsterHp,
            lastHitAt: new Date().toISOString()
          }, zoneKey);
        } catch (e) {
          await sc.monsterService.saveState({
            ...battleState,
            currentHp: (isWorldBossZone(zoneKey) && battleMonster?.isBoss)
              ? sumWorldBossPartHp(battleState.worldBossPartsHp)
              : session.monsterHp,
            lastHitAt: new Date().toISOString()
          }, zoneKey);
        }

        embedTitle = "💀 戰鬥失敗";
        embedColor = 0x555555;
        rewardLines = [
          `你被 **${session.monsterName}** 擊倒了！`,
          `你造成了 **${totalDamage}** 點傷害。`,
          session.entryFee > 0 ? `入場費 **${session.entryFee}** 🪙 已損失，下次加油！` : "下次加油！",
          `⏳ 死亡懲罰計時中...`
        ];
        pendingDeathCooldown = true;
      } else {
        // 排行榜已在戰鬥完成後立刻更新，此處只紀錄狀態
        try {
          const freshState = await sc.monsterService.getState(zoneKey);
          await sc.monsterService.saveState({
            ...freshState,
            currentHp: (isWorldBossZone(zoneKey) && battleMonster?.isBoss)
              ? sumWorldBossPartHp(freshState.worldBossPartsHp)
              : session.monsterHp,
            lastHitAt: new Date().toISOString()
          }, zoneKey);
        } catch (e) {
          await sc.monsterService.saveState({
            ...battleState,
            currentHp: (isWorldBossZone(zoneKey) && battleMonster?.isBoss)
              ? sumWorldBossPartHp(battleState.worldBossPartsHp)
              : session.monsterHp,
            lastHitAt: new Date().toISOString()
          }, zoneKey);
        }
        embedTitle = "⏸️ 戰鬥超時";
        embedColor = 0x888888;
        rewardLines = [`超過 ${MAX_ROUNDS} 回合未分勝負，戰鬥中止。\n你造成了 **${totalDamage}** 點傷害。`];
      }

      // 圖鑑點數每場戰鬥都會累積;非擊殺(部位擊破/超時/失敗)也顯示本場圖鑑增益,避免「有時有通知有時沒有」
      if (session._bestiary && embedTitle !== "🏆 勝利！") {
        const b = session._bestiary;
        rewardLines.push(`📖 圖鑑：**${b.monsterName}** +${b.gainPct}%（累積 ${Math.round(b.killsAfter * 10) / 10}/${b.requirement} 隻，對該怪傷害 +${Math.round(b.bonusPctAfter * 10) / 10}%）`);
      }

      if (idleSettleNotice) {
        rewardLines = [idleSettleNotice, ...rewardLines];
      }
      if (syncResult.notice) {
        rewardLines = [syncResult.notice, ...rewardLines];
      }
      if (isWorldBossZone(zoneKey) && battleMonster?.isBoss) {
        rewardLines = [`🎯 鎖定部位：${session.worldBossTargetLabel}${battleTargetNote ? `（${battleTargetNote}）` : ""}`, ...rewardLines];
      }

      // 區域連段 + activeEffects：只更新這兩個欄位，不做整份覆寫（見網頁端同段註解）
      if (currentProg) {
        // DC 端沒有「斬」的按鈕，但「不屈」死亡保護一樣生效
        const _fields = {
          zoneCombo: _zc.nextCombo(comboBefore, zoneKey, outcome, Date.now(), {
            hasDeathGuard: comboBenefits,
            diedOnce: _zc.readDiedOnce(currentProg, zoneKey),
          })
        };
        currentProg.zoneCombo = _fields.zoneCombo;
        // 戰意集氣（狂戰士）：每場 +1；滿氣開打的那場結束後清空重集
        if (_gaugeCfg) {
          _fields.berserkGauge = _bg.next(gaugeBefore, _gaugeCfg, { consumed: gaugeFull });
          currentProg.berserkGauge = _fields.berserkGauge;
        }
        // 連擊氣條（影舞者）：戰後氣量落地
        if (shadowOn) {
          _fields.shadowGauge = _sg.next(combatResult?.shadowGauge ?? shadowGridsBefore, zoneKey);
          currentProg.shadowGauge = _fields.shadowGauge;
        }
        // 氣力格（劍鬼）：戰後氣量落地
        if (oniOn) {
          _fields.oniGauge = _og.next(combatResult?.oniGauge ?? oniGridsBefore, zoneKey);
          currentProg.oniGauge = _fields.oniGauge;
        }
        // 日之精靈（聖靈師）：戰後血量落地
        if (spiritOn) {
          _fields.sunSpirit = _ssp.next(combatResult?.sunSpirit?.hpPct ?? spiritPctBefore, zoneKey);
          currentProg.sunSpirit = _fields.sunSpirit;
        }
        // 震盪值（神射手）：戰後格數落地
        if (sniperOn) {
          _fields.sniperGauge = _sng.next(combatResult?.sniperGauge ?? sniperGridsBefore, zoneKey);
          currentProg.sniperGauge = _fields.sniperGauge;
        }
        // 計謀值（兵聖）：戰後格數落地
        if (sageOn) {
          _fields.sageGauge = _sag.next(combatResult?.sageGauge ?? sageGridsBefore, zoneKey);
          currentProg.sageGauge = _fields.sageGauge;
        }
        // 命運骰＋手氣（賭神）：戰後格數與手氣層落地
        if (diceGodOn) {
          _fields.diceGauge = _dgg.next(combatResult?.diceGauge ?? diceGridsBefore, zoneKey);
          _fields.diceLuck = _dgg.nextLuck(combatResult?.diceLuck ?? diceLuckBefore);
          currentProg.diceGauge = _fields.diceGauge;
          currentProg.diceLuck = _fields.diceLuck;
        }
        if (windDirectionOn && combatResult?.windDirectionStep != null) {
          _fields.windDirectionStep = _wd.normalizeStep(combatResult.windDirectionStep);
          currentProg.windDirectionStep = _fields.windDirectionStep;
        }
        if (Array.isArray(currentProg.activeEffects) && currentProg.activeEffects.length > 0) {
          const nextActiveEffects = decrementActiveEffects(currentProg.activeEffects, "battle", 1);
          if (nextActiveEffects.length !== currentProg.activeEffects.length) {
            currentProg.activeEffects = nextActiveEffects;
            _fields.activeEffects = nextActiveEffects;
          }
        }
        await sc.progressRepository.updateFields(currentProg.playerId, _fields).catch(() => {});
      }

      // ── 敲世界王暈眩條（只有矮人戰士長敲得動）── 與網頁同一條、同規則
      if (stunGaugeKey && _dsg.canKnock(currentEquipped?.job_eq)) {
        const stunAmount = Math.floor((combatResult?.combatStats?.attackRounds || 0) * (Number(session.turtleGaugeMult) || 1));
        const _knock = await _dsg
          .knock(stunGaugeKey, zoneKey, stunAmount, displayName, Date.now(), discordId, currentJobId, currentJobName || "矮人戰士長")
          .catch(() => null);
        if (_knock?.triggered) {
          _dsg.announceStun({ byName: displayName, monsterName: session.monsterName });
          rewardLines.push(`⛰️ **巨神震擊**！你把 **${session.monsterName}** 敲暈了——全體 ${Math.round(_dsg.STUN_WINDOW_MS / 1000)} 秒免傷！`);
          // 島島龜王：巨神震擊把詠唱歸零，暈眩結束後從頭重跑，不開破綻。
          if (zoneKey === TURTLE_ZONE) {
            try {
              const _tt = require("../../shared/turtleTide");
              const _fs = await sc.monsterService.getState(zoneKey);
              if (_tt.resetCastAfterStun(_fs, `${displayName}（巨神震擊）`, _knock.stunnedUntil)) {
                await sc.monsterService.saveState(_fs, zoneKey).catch(() => {});
                rewardLines.push(`⏪ **海嘯詠唱歸零！** 暈眩結束後，龜王會從 0 重新計算完整詠唱條。`);
              }
            } catch (_) { /* 打斷失敗不影響戰鬥結算 */ }
          }
        } else if (_knock?.knocked > 0) {
          rewardLines.push(`🔨 暈眩值 +${_knock.knocked}（${_knock.gauge} / ${_knock.threshold}）`);
        }
      }
      try {
        await recordQuestBattleProgress(sc, discordId, outcome, totalDamage, combatStats, session.playerStats?.weaponType || null, zoneKey, currentProg?.equipment?.job_eq || null, combatResult?.damageTaken || 0, combatResult?.healDone || 0, combatResult?.lifestealDone || 0);
      } catch (e) {
        console.error("[Quest] recordProgress error:", e.message);
      }
      participantCache.clear();
      partyEffects.length = 0;
      if (currentProg) {
        currentProg.inventory = [];
        currentProg.equipment = {};
      }

      // 戰鬥已結算，但先保留 session 至顯示完畢才刪除，避免期間重複出戰
      if (activeSessions.has(discordId)) activeSessions.get(discordId).state = "displaying";

      const displayRoundLogs = compactAuraSourceNames(roundLogs);
      roundLogs.length = 0;
      // 用實際回合數而非 MAX_ROUNDS：快速戰鬥（1-3 回合）就不用等 22.5 秒
      const displayDelayMs = getBattleDisplayDurationMs(session.playerStats?.agi ?? 1, Math.max(1, displayRoundLogs.length));
      const displayStartedAt = Date.now();
      const displayEndsAt = displayStartedAt + displayDelayMs;
      const playerAgiForDisplay = session.playerStats?.agi ?? 1;
      if (activeSessions.has(discordId)) {
        const activeSession = activeSessions.get(discordId);
        activeSession.displayStartedAt = displayStartedAt;
        activeSession.displayDurationMs = displayDelayMs;
        activeSession.displayEndsAt = displayEndsAt;
      }
      recordBattleCooldown(discordId, displayEndsAt);
      scheduleDisplayingSessionCleanup(discordId, displayEndsAt);
      session.monsterStats = null;
      session.playerStats = { agi: playerAgiForDisplay };
      currentEquipped = null;
      currentProg = null;
      currentSnapshot = null;
      equipped = null;
      progress = null;
      battlePlayerStats = null;
      combatResult = null;
      combatStats = null;
      battleState = null;
      battleStateForSettlement = null;
      battleMonster = null;
      clearCurrentCache();

      await displaySettledBattleResult({
        interaction,
        discordId,
        displayRoundLogs,
        rewardLines,
        embedTitle,
        embedColor,
        pendingDeathCooldown,
        playerAgi: playerAgiForDisplay
      });
      deleteMonsterSession(discordId);  // 顯示完畢才解除鎖定，允許下一場出戰
    } catch (err) {
      const isTransient = isTransientDiscordError(err);
      const logFn = isTransient ? console.warn : console.error;
      logFn(
        `[monsterZoneHandlers] battle finalization error` +
        ` | player=${discordId}(${displayName})` +
        ` | zone=${zoneKey ?? "?"}` +
        ` | monster=${battleMonster?.name ?? "?"}` +
        ` | transient=${isTransient}` +
        ` | err=${err?.message || err}`
      );
      deleteMonsterSession(discordId);
      await safeBattleResultReply(
        interaction,
        { content: "❌ 戰鬥發生錯誤，請稍後再試。", embeds: [], components: [] },
        `❌ 戰鬥發生錯誤，請稍後再試。 <@${discordId}>`
      ).catch(() => {});
    }
  } catch (err) {
    console.error("[monsterZoneHandlers] battle start error:", err?.message || err);
    await safeBattleResultReply(
      interaction,
      { content: "❌ 出戰失敗，請稍後再試。" },
      `❌ 出戰失敗，請稍後再試。 <@${discordId}>`
    ).catch(() => {});
  } finally {
    if (hasActiveSessionLock && activeSessions.get(discordId)?.state === "starting") {
      deleteMonsterSession(discordId);
    }
    releaseBattleActionLock(discordId);
  }
}


// ──────────────────────────────────────────────
// 刪除戰鬥紀錄
// ──────────────────────────────────────────────
async function handleDeleteLog(interaction) {
  try {
    await interaction.deferUpdate();
    await interaction.deleteReply();
  } catch { /* 訊息可能已被刪除，忽略 */ }
}

// ──────────────────────────────────────────────
// 擊殺結算（發獎勵 + 推進怪物 + 重發面板）
// ──────────────────────────────────────────────
// ── 世界王貢獻寶箱 ───────────────────────────────────────────
// 怪物 → 對應寶箱 itemId


// 建一個寶箱背包項目（同款會堆疊，故 uuid 僅在「新項目」時生效）

// 發一個寶箱給玩家 → 回傳 { ok, uuid, stacked }（uuid 供網頁開箱用）
// 改用原子操作（$inc 疊加 / $push 新增），避免與玩家自身高頻存檔競態導致 CAS 失敗而「靜默吞箱」。

// 每個名次的寶箱數：1(保底) + ⌊(總參與人數 − (名次−1)) ÷ 3⌋，各名次分別封頂（1st→4箱/2nd→3箱/3rd→2箱），4~6名固定1箱。
// 名次越前起漲人數越早：1st滿3人就開始漲、2nd滿4人、3rd滿5人；封頂依名次遞減，維持 1st≥2nd≥3rd≥1 不會被追平。


// 寶箱排名只看本王戰鬥貢獻 C = 傷害 + 0.7×助攻；入場費不參與排名。
// 同分時依實際傷害、助攻、玩家 ID 依序決勝，避免依物件寫入順序產生不透明結果。


// 世界王公告不得顯示 Discord ID。若名稱缺失、等於 ID、本身是長數字，
// 或只能取得匿名的「玩家#末四碼」，一律顯示「某位勇者」。




// 結算：本王戰鬥貢獻前 6 名，依名次領 1~4 箱不等（見 _worldBossChestCountForRank）


// 把掉落道具物件壓成網頁版需要的精簡欄位（漂浮氣泡 + 詳細視窗用）




// ──────────────────────────────────────────────
// 主路由
// ──────────────────────────────────────────────
async function handleMonsterZoneButton(interaction) {
  const { customId } = interaction;
  if (!isMonsterZoneButton(customId)) return false;
  if (String(customId).startsWith(BTN.humanCheckPrefix)) {
    await handleHumanCheck(interaction);
  }
  else if (customId === BTN.enterBattle || String(customId).startsWith(BTN.enterBattlePrefix)) {
    await handleEnterBattle(interaction);
  }
  else if (customId === BTN.deleteLog)  await handleDeleteLog(interaction);
  return true;
}

// 判斷是否為事件選項按鈕（customId 範例："monster-event:choose:<eventId>:<optionId>")
function isMonsterEventButton(customId) {
  return String(customId || "").startsWith("monster-event:choose:");
}

// 處理玩家在事件面板上點選某個選項
async function handleMonsterEventChoice(interaction) {
  await interaction.deferReply({ flags: 64 }).catch(() => {});
  const sc = getServiceContext();
  const parts = String(interaction.customId || "").split(":");
  if (parts.length < 4) {
    await interaction.editReply({ content: "無效的操作。" }).catch(() => {});
    return;
  }
  const eventId = parts[2];
  const optionId = parts[3];

  // 嘗試判斷 zoneKey：先透過 panelMessageId 對照 binding，找不到再用 channelId 推斷
  const layout = await sc.channelLayoutRepository.get().catch(() => ({}));
  const bindings = layout?.discord?.bindings || [];
  let binding = bindings.find((b) => String(b.panelMessageId || "") === String(interaction.message?.id || "") && b.featureKey && b.featureKey.startsWith("monster_zone"));
  if (!binding) {
    binding = bindings.find((b) => String(b.channelId || "") === String(interaction.channelId || "") && b.featureKey && b.featureKey.startsWith("monster_zone"));
  }
  const zoneKey = _featureKeyToZone(binding?.featureKey);

  const state = await sc.monsterService.getState(zoneKey).catch(() => null);
  const ae = state?.activeEvent;
  if (!ae || ae.id !== eventId) {
    await interaction.editReply({ content: "事件已結束或不可互動。" }).catch(() => {});
    return;
  }
  const endAtMs = Date.parse(ae.endsAt || "");
  if (!Number.isFinite(endAtMs) || endAtMs <= Date.now()) {
    await interaction.editReply({ content: "事件已結束。" }).catch(() => {});
    return;
  }

  const discordId = interaction.user.id;
  // 每個玩家整個事件只能選一次（防止重複領獎）
  if (ae.selections && ae.selections[discordId]) {
    await interaction.editReply({ content: "你已經選過此事件的選項，無法再次選擇。" }).catch(() => {});
    return;
  }
  // 取得完整事件（若 activeEvent 沒有 nodes，從 service 拿）
  let fullEvent = ae;
  if (!Array.isArray(ae.nodes) || !ae.nodes.length) {
    try { fullEvent = await sc.monsterEventService.getEventById(eventId); } catch (_) { fullEvent = ae; }
  }
  const startNode = Array.isArray(fullEvent.nodes) && fullEvent.nodes.length ? (fullEvent.nodes.find((n) => n.id === "start") || fullEvent.nodes[0]) : { options: [] };
  const option = (startNode.options || []).find((o) => o.id === optionId);
  if (!option) {
    await interaction.editReply({ content: "選項不存在或已失效。" }).catch(() => {});
    return;
  }

  // 檢查玩家進度與錢包
  let progress = await sc.progressRepository.findByPlayerId(discordId).catch(() => null);
  const wallet = await sc.walletRepository.findByPlayerId(discordId).catch(() => ({ gold: 0, diamond: 0 }));
  const effectContext = { equipped: progress?.equipment || {}, inventory: Array.isArray(progress?.inventory) ? progress.inventory : [] };
  const optionEffects = Array.isArray(option.effects) ? option.effects : [];

  // 檢查選項層級的條件（例如 option.condition），若不符合則阻擋選擇
  if (option.condition && !isEffectConditionMet({ condition: option.condition }, effectContext)) {
    await interaction.editReply({ content: "你不符合該選項的條件，無法選擇。" }).catch(() => {});
    return;
  }

  // 驗證條件與計算總成本
  let totalGoldCost = 0;
  let totalDiamondCost = 0;
  // 檢查需移除的道具需求（take_item）
  const takeItemRequirements = [];
  for (const eff of optionEffects) {
    if (eff.type === "grant_currency") {
      const amt = Number(eff.payload?.amount || 0);
      const currency = eff.payload?.currencyType || "gold";
      if (amt < 0) {
        if (currency === "gold") totalGoldCost += -amt;
        else if (currency === "diamond") totalDiamondCost += -amt;
      }
    }
    if (!isEffectConditionMet(eff, effectContext)) {
      await interaction.editReply({ content: "你不符合該選項的條件，無法選擇。" }).catch(() => {});
      return;
    }
  }

  // 處理 take_item 需求檢查（確保玩家有該道具且強化等級足夠）
  for (const eff of optionEffects) {
    if (eff.type === 'take_item') {
      const wantId = eff.payload?.itemId;
      const wantEnh = Number(eff.payload?.enhanceLevel || 0);
      if (!wantId) continue;
      const inv = Array.isArray(progress?.inventory) ? progress.inventory : [];
      const found = inv.find(it => String(it.itemId || it.id) === String(wantId) && (Number(it.enhanceLevel || it.enhance || 0) >= wantEnh));
      if (!found) {
        const itemObj = await sc.itemService.getItemById(wantId).catch(() => null);
        const displayName = itemObj ? itemObj.name : wantId;
        await interaction.editReply({ content: `你沒有我所需的 ${displayName}` }).catch(() => {});
        return;
      }
      takeItemRequirements.push({ wantId, wantEnh });
    }
  }

  if ((wallet?.gold || 0) < totalGoldCost) {
    await interaction.editReply({ content: "金幣不足，無法選擇此選項。" }).catch(() => {});
    return;
  }
  if ((wallet?.diamond || 0) < totalDiamondCost) {
    await interaction.editReply({ content: "鑽石不足，無法選擇此選項。" }).catch(() => {});
    return;
  }

  // 執行 effects（支援 grant_currency / grant_item / grant_equipment / grant_buff）
  const results = [];
  const hasBuffEffect = optionEffects.some((eff) => eff.type === "grant_buff" && eff?.payload?.effect?.key);
  if (hasBuffEffect && !progress) {
    await sc.playerService.ensurePlayer(discordId, interaction.member?.displayName || interaction.user.username || discordId).catch(() => {});
    progress = await sc.progressRepository.findByPlayerId(discordId).catch(() => null);
  }
  for (const eff of optionEffects) {
    // 支援移除道具（交換）
    if (eff.type === 'take_item') {
      const wantId = eff.payload?.itemId;
      const wantEnh = Number(eff.payload?.enhanceLevel || 0);
      let prog = progress;
      if (!prog) {
        await sc.playerService.ensurePlayer(discordId, interaction.member?.displayName || interaction.user.username || discordId).catch(() => {});
        prog = await sc.progressRepository.findByPlayerId(discordId).catch(() => null);
      }
      if (!Array.isArray(prog.inventory)) prog.inventory = [];
      const wantQty = Math.max(1, Number(eff.payload?.count ?? eff.payload?.qty ?? 1));
      const idx = prog.inventory.findIndex(it => String(it.itemId || it.id) === String(wantId) && (Number(it.enhanceLevel || it.enhance || 0) >= wantEnh));
      if (idx === -1) {
        const itemObj = await sc.itemService.getItemById(wantId).catch(() => null);
        const displayName = itemObj ? itemObj.name : wantId;
        results.push(`你沒有我所需的 ${displayName}`);
      } else {
        const entry = prog.inventory[idx];
        const stackCount = Number(entry.stackCount || 1);
        // 堆疊型只扣需求數量，不可整疊刪除
        if (stackCount > wantQty) {
          prog.inventory[idx] = { ...entry, stackCount: stackCount - wantQty };
        } else {
          prog.inventory.splice(idx, 1);
        }
        prog.updatedAt = new Date().toISOString();
        await sc.progressRepository.save(prog);
        results.push(`已移除 ${entry.itemName || entry.itemId || wantId}${wantQty > 1 ? ` ×${wantQty}` : ""}`);
      }
      continue;
    }
    if (eff.type === "grant_currency") {
      try {
        await sc.rewardService.grantCurrency({
          discordId,
          displayName: interaction.member?.displayName || interaction.user.username || discordId,
          currencyType: eff.payload?.currencyType || "gold",
          amount: Number(eff.payload?.amount || 0),
          source: CURRENCY_SOURCES.SHOP_PURCHASE,
          operator: "npc_event"
        });
        results.push(`貨幣 ${eff.payload?.currencyType || 'gold'} ${eff.payload?.amount}`);
      } catch (e) {
        await interaction.editReply({ content: `處理貨幣失敗：${e?.message || e}` }).catch(() => {});
        return;
      }
    } else if (eff.type === "grant_item" || eff.type === "grant_equipment") {
      const itemId = eff.payload?.itemId;
      if (!itemId) continue;
      const item = await sc.itemService.getItemById(itemId).catch(() => null);
      if (!item) {
        results.push(`道具 ${itemId} 不存在`);
        continue;
      }
      // 確保玩家存在 progress
      let prog = progress;
      if (!prog) {
        await sc.playerService.ensurePlayer(discordId, interaction.member?.displayName || interaction.user.username || discordId).catch(() => {});
        prog = await sc.progressRepository.findByPlayerId(discordId).catch(() => null);
      }
      if (!Array.isArray(prog.inventory)) prog.inventory = [];
      prog.inventory.push({
        uuid: require("crypto").randomUUID(),
        itemId: item.id, itemName: item.name,
        itemEffect: item.effect || { type: "none", value: 0 },
        useEffects: item.useEffects || [], passiveEffects: item.passiveEffects || [], procEffects: item.procEffects || [], combatEffects: item.combatEffects || [],
        itemType: item.itemType || "consumable",
        imageUrl: item.imageUrl || null, imageThumbnailUrl: item.imageThumbnailUrl || null,
        equipSlot: item.equipSlot || null, equipStats: item.equipStats || null,
        weaponType: item.weaponType || null, isTwoHanded: item.isTwoHanded || false,
        atkStat: item.atkStat || null, tier: item.tier || null,
        enhanceLevel: Number(eff.payload?.enhanceLevel || 0),
        purchasedAt: new Date().toISOString()
      });
      prog.updatedAt = new Date().toISOString();
      await sc.progressRepository.save(prog).catch((err) => {
        console.error(`[NPC Event] Failed to save item grant for ${discordId}:`, err);
      });
      results.push(`獲得 ${item.name}`);
    } else if (eff.type === "grant_buff") {
      const buffEffect = eff?.payload?.effect;
      if (!buffEffect || !buffEffect.key) {
        results.push("Buff 效果未設定");
        continue;
      }
      if (!progress) {
        results.push(`Buff ${buffEffect.key} 無法套用（找不到玩家進度）`);
        continue;
      }
      if (!Array.isArray(progress.activeEffects)) progress.activeEffects = [];
      progress.activeEffects = applyEffectInstances(
        progress.activeEffects,
        [buffEffect],
        { sourceType: "npc_event", sourceId: eventId || optionId },
        effectContext
      );
      progress.updatedAt = new Date().toISOString();
      await sc.progressRepository.save(progress).catch((err) => {
        console.error(`[NPC Event] Failed to save Buff for ${discordId}:`, err);
      });
      results.push(formatBuffMessage(buffEffect));

      // 嘗試發送中文 DM 給玩家，告知獲得的 Buff（若使用者關閉 DM 則忽略）
      try {
        const { getBotClient } = require("../runtimeContext");
        const client = getBotClient();
        if (client?.isReady && client.isReady()) {
          const user = await client.users.fetch(discordId).catch(() => null);
          if (user) {
            const buffMessage = formatBuffMessage(buffEffect);
            await user.send(buffMessage).catch(() => {});
          }
        }
      } catch (e) {
        // 忽略 DM 發送錯誤
      }
    } else {
      results.push(`效果 ${eff.type || 'unknown'} 未實作`);
    }
  }

  // 紀錄玩家選擇
  const nextState = { ...state };
  nextState.activeEvent = { ...nextState.activeEvent, selections: { ...(nextState.activeEvent?.selections || {}), [discordId]: { optionId, selectedAt: new Date().toISOString() } } };
  await sc.monsterService.saveState(nextState, zoneKey).catch((err) => {
    console.error(`[NPC Event] Failed to save player selection for ${discordId}:`, err);
  });

  const replyLines = [];
  if (option.npcReply) replyLines.push(option.npcReply);
  if (results.length) replyLines.push(`已執行：${results.join('，')}`);
  await interaction.editReply({ content: replyLines.join('\n') || '已選擇', flags: MessageFlags.Ephemeral }).catch(() => {});
}

// 判斷是否為顯示個人化選項按鈕（customId 範例："monster-event:personal:<eventId>")
function isMonsterEventPersonalButton(customId) {
  return String(customId || "").startsWith("monster-event:personal:");
}

// 處理玩家要求顯示個人化選項（回覆 ephemeral 面板）
async function handleMonsterEventPersonal(interaction) {
  await interaction.deferReply({ flags: 64 }).catch(() => {});
  const sc = getServiceContext();
  const parts = String(interaction.customId || "").split(":");
  if (parts.length < 3) {
    await interaction.editReply({ content: "無效的操作。" }).catch(() => {});
    return;
  }
  const eventId = parts[2];

  // 判斷 zoneKey 如同選項處理
  const layout = await sc.channelLayoutRepository.get().catch(() => ({}));
  const bindings = layout?.discord?.bindings || [];
  let binding = bindings.find((b) => String(b.panelMessageId || "") === String(interaction.message?.id || "") && b.featureKey && b.featureKey.startsWith("monster_zone"));
  if (!binding) {
    binding = bindings.find((b) => String(b.channelId || "") === String(interaction.channelId || "") && b.featureKey && b.featureKey.startsWith("monster_zone"));
  }
  const zoneKey = _featureKeyToZone(binding?.featureKey);

  const state = await sc.monsterService.getState(zoneKey).catch(() => null);
  const ae = state?.activeEvent;
  if (!ae || ae.id !== eventId) {
    await interaction.editReply({ content: "事件已結束或不可互動。" }).catch(() => {});
    return;
  }

  // 取得完整事件
  let fullEvent = ae;
  if (!Array.isArray(ae.nodes) || !ae.nodes.length) {
    try { fullEvent = await sc.monsterEventService.getEventById(eventId); } catch (_) { fullEvent = ae; }
  }

  // 取得玩家進度以建 viewerContext
  const discordId = interaction.user.id;
  const progress = await sc.progressRepository.findByPlayerId(discordId).catch(() => null);
  const viewerContext = { equipped: progress?.equipment || {}, inventory: Array.isArray(progress?.inventory) ? progress.inventory : [] };

  // 使用 createEventPanelMessage 產生個人化面板內容（只會包含符合條件的選項）
  const { createEventPanelMessage } = require("../monsterZoneView");
  const zoneTheme = getZoneTheme(zoneKey);

  try {
    const panel = await createEventPanelMessage(ae, zoneTheme, zoneKey, { viewerContext });
    await interaction.editReply(panel).catch(async () => {
      await interaction.editReply({ content: '顯示個人化選項失敗' }).catch(() => {});
    });
  } catch (e) {
    await interaction.editReply({ content: '顯示個人化選項失敗' }).catch(() => {});
  }
}

// ──────────────────────────────────────────────
// NPC 對話互動
// ──────────────────────────────────────────────
function isNpcDialogButton(customId) {
  return String(customId || "").startsWith("npc_dialog:");
}

async function handleNpcDialog(interaction) {
  const parts = String(interaction.customId || "").split(":");
  if (parts.length < 5) {
    await interaction.deferUpdate();
    return;
  }

  const [, npcId, nodeId, optionId, discordId] = parts;
  const sc = getServiceContext();

  try {
    await interaction.deferUpdate();

    // 只有點按鈕的人能互動
    if (interaction.user.id !== discordId) {
      await interaction.followUp({ content: "只有該玩家可以互動", ephemeral: true }).catch(() => {});
      return;
    }

    const npc = await sc.npcService.getNpcById(npcId);
    if (!npc) {
      await interaction.followUp({ content: "❌ NPC 不存在", ephemeral: true }).catch(() => {});
      return;
    }

    const currentNode = npc.nodes.find(n => n.id === nodeId);
    if (!currentNode) {
      await interaction.followUp({ content: "❌ 對話節點不存在", ephemeral: true }).catch(() => {});
      return;
    }

    const option = currentNode.options.find(o => o.id === optionId);
    if (!option) {
      await interaction.followUp({ content: "❌ 選項不存在", ephemeral: true }).catch(() => {});
      return;
    }

    // 顯示 NPC 的回覆
    const reply = option.npcReply || "...";
    let responseMsg = `🎤 **${npc.name}**：${reply}`;

    // 處理效果（與怪物事件相同 schema：{ type, payload }），先完整驗證再執行。
    if (Array.isArray(option.effects) && option.effects.length > 0) {
      const dispName = interaction.member?.displayName || interaction.user.username || discordId;
      let effectResults;
      try {
        effectResults = await processNpcOptionEffects({
          serviceContext: sc,
          discordId,
          displayName: dispName,
          option,
          formatBuffMessage,
        });
      } catch (effectError) {
        if (!(effectError instanceof NpcOptionEffectError)) throw effectError;
        await interaction.followUp({ content: `❌ ${effectError.userMessage}`, ephemeral: true }).catch(() => {});
        return;
      }
      if (effectResults.length) responseMsg += `\n✨ ${effectResults.join("，")}`;
    }

    // 決定是否繼續對話
    const nextNodeId = option.nextNodeId;
    const nextNode = nextNodeId ? npc.nodes.find(n => n.id === nextNodeId) : null;

    if (nextNode) {
      // 繼續到下一個節點
      const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
      const buttons = [];
      const optionsSlice = nextNode.options.slice(0, 5);
      for (let i = 0; i < optionsSlice.length; i++) {
        const opt = optionsSlice[i];
        buttons.push(
          new ButtonBuilder()
            .setCustomId(`npc_dialog:${npcId}:${nextNode.id}:${opt.id}:${discordId}`)
            .setLabel(opt.label.slice(0, 80))
            .setStyle(ButtonStyle.Primary)
        );
      }
      const components = buttons.length > 0 ? [new ActionRowBuilder().addComponents(buttons)] : [];
      responseMsg += `\n\n**${nextNode.text}**`;

      await interaction.editReply({
        content: responseMsg,
        components
      }).catch(() => {});
    } else {
      // 對話結束
      await interaction.editReply({
        content: responseMsg + "\n\n✅ 對話結束",
        components: []
      }).catch(() => {});
    }
  } catch (e) {
    console.error("[NPC Dialog] Error:", e);
    await interaction.followUp({ content: "❌ 互動失敗", ephemeral: true }).catch(() => {});
  }
}

// ──────────────────────────────────────────────
// 閒置自動換怪
// ──────────────────────────────────────────────
const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 分鐘
const IDLE_TAUNTS = [
  (name) => `😴 ${name} 等到睡著了，換下一位！`,
  (name) => `🥱 沒人敢打 **${name}**？膽小鬼！換一隻好了。`,
  (name) => `💤 **${name}** 打哈欠：「有沒有勇者？算了自己走了。」`,
  (name) => `🚶 ${name} 閒得發慌，自己溜了。`,
  (name) => `😤 ${name} 大喊：「你們是木頭嗎！？」然後憤而離去。`,
  (name) => `🫠 **${name}** 等得花都謝了，換下一隻吧。`,
  (name) => `👻 ${name} 消失了⋯沒人知道牠去哪。`,
];



async function checkIdleRotate() {
  const sc = getServiceContext();
  const now = Date.now();
  for (const zoneKey of ALL_ZONE_KEYS) {
    try {
      const state = await sc.monsterService.getState(zoneKey);
      if (state?.activeEvent?.endsAt) {
        const resolved = await _resolveZoneEventIfExpired(sc, zoneKey).catch(() => false);
        if (!resolved) continue;
      }
      const allMonsters = await sc.monsterService.listMonsters({ includeDisabled: false, zone: zoneKey });
      if (!allMonsters.length) continue;
      // 有進行中戰鬥不換
      const hasActive = [...activeSessions.values()].some(s => s.zoneKey === zoneKey);
      if (hasActive) continue;
      const lastHit = state.lastHitAt ? new Date(state.lastHitAt).getTime() : 0;
      if (now - lastHit >= IDLE_TIMEOUT_MS) {
        await _doIdleRotate(sc, zoneKey);
      }
    } catch (_) {}
  }
}

function startIdleRotateTimer() {
  // 預設關閉閒置自動換怪；要啟用需明確設定 ENABLE_IDLE_ROTATE=1
  if (process.env.ENABLE_IDLE_ROTATE !== "1") {
    console.log("[IdleRotate] timer disabled; monsters only rotate on player activity");
    return;
  }
  setInterval(checkIdleRotate, 60 * 1000); // 每分鐘檢查一次
}

// 刷新單一世界王 zone 面板；回傳 true 代表面板確實被重發/編輯成功（含逃跑轉場已處理）。
// opts.force=true 時走強制排隊發布，不會因 layout mutex 忙碌而靜默跳過。
async function refreshWorldBossPanelForZone(sc, zoneKey, opts = {}) {
  if (await _resolveExpiredMonsterTransition(sc, zoneKey)) return true;
  let zoneState = await sc.monsterService.getState(zoneKey).catch(() => null);
  const monsters = await sc.monsterService.listMonsters({ includeDisabled: false, zone: zoneKey }).catch(() => []);
  const monster = monsters.find((m) => Number(m.seq) === Number(zoneState?.activeMonsterSeq))
    || monsters.find((m) => m.isBoss)
    || null;
  if (monster?.isBoss) {
    const timeoutResult = await maybeHandleEliteWorldBossTimeout(sc, zoneKey, zoneState || {}, monster);
    if (timeoutResult?.timedOut) {
      zoneState = timeoutResult.state;
    } else {
      await scheduleEliteWorldBossTimeout(sc, zoneKey, monster).catch(() => {});
    }
  }
  const monsterHp = monster ? (zoneState?.currentHp ?? monster.calc?.maxHp ?? 0) : null;
  const damageMap = zoneState?.damageMap || {};
  const participantCount = Array.isArray(zoneState?.participants) ? zoneState.participants.length : 0;
  const activeEvent = zoneState?.activeEvent || null;
  const worldBossPartsHp = zoneState?.worldBossPartsHp || null;
  const activeTransition = zoneState?.activeTransition || null;

  const res = await _republishPanel(sc, zoneKey, monster, monsterHp, participantCount, damageMap, activeEvent, worldBossPartsHp, { activeTransition, forcePublish: opts.force === true });
  return res?.published === true;
}

async function refreshEliteWorldBossPanel(opts = {}) {
  const sc = getServiceContext();
  // 輪詢所有世界王 zone（大史王=elite、龍王=dragon_king_lair…）
  for (const zoneKey of Object.keys(WORLD_BOSS_ZONES)) {
    try {
      await refreshWorldBossPanelForZone(sc, zoneKey, opts);
    } catch (error) {
      console.warn(`[WorldBossPanel] auto-refresh failed (${zoneKey}): ${error?.message || error}`);
    }
  }
}

async function refreshMonsterZonePanels() {
  try {
    const sc = getServiceContext();
    const layout = await sc.channelLayoutRepository.get().catch(() => ({}));
    const bindings = Array.isArray(layout?.discord?.bindings) ? layout.discord.bindings : [];
    const targetBindings = bindings.filter((binding) => {
      return binding?.enabled && binding?.channelId && String(binding.featureKey || "").startsWith("monster_zone") && binding.featureKey !== "monster_zone_elite";
    });

    for (const binding of targetBindings) {
      try {
        const zoneKey = _featureKeyToZone(binding.featureKey);
        if (await _resolveExpiredMonsterTransition(sc, zoneKey)) continue;
        const state = await sc.monsterService.getState(zoneKey).catch(() => null);
        const hasDeadState = Number(state?.currentHp || 0) <= 0 && !state?.activeTransition && !state?.activeEvent;
        if (hasDeadState && !isWorldBossZone(zoneKey)) {
          await _doIdleRotate(sc, zoneKey).catch(() => {});
        }
        const freshState = hasDeadState ? await sc.monsterService.getState(zoneKey).catch(() => null) : state;
        const monsters = await sc.monsterService.listMonsters({ includeDisabled: true, zone: zoneKey }).catch(() => []);
        let monster = freshState?.currentMonster || monsters.find((m) => m.seq === freshState?.activeMonsterSeq) || null;
        if (!monster && monsters.length > 0) monster = monsters[0];
        const monsterHp = freshState?.currentHp != null ? freshState.currentHp : (monster?.calc?.maxHp ?? null);
        const participantCount = Array.isArray(freshState?.participants) ? freshState.participants.length : 0;
        const damageMap = freshState?.damageMap || {};
        const activeEvent = freshState?.activeEvent || null;
        const worldBossPartsHp = freshState?.worldBossPartsHp || null;
        const activeTransition = freshState?.activeTransition || null;
        await _republishPanel(sc, zoneKey, monster, monsterHp, participantCount, damageMap, activeEvent, worldBossPartsHp, { fastUpdate: true, activeTransition });
      } catch (error) {
        console.warn(`[MonsterPanel] auto-refresh failed for ${binding.featureKey} (${binding.channelId}): ${error?.message || error}`);
      }
    }
  } catch (error) {
    console.warn(`[MonsterPanel] auto-refresh failed: ${error?.message || error}`);
  }
}

// 世界王重生監看：每 3 分檢查狀態，僅在「逃跑/重生/開戰」變化時刷新面板。
// refreshEliteWorldBossPanel 已含逃跑判定、計時器重建、面板重發，所以變化時呼叫即可。
const worldBossPanelSig = new Map();
let worldBossWatcherTimer = null;
async function worldBossRespawnTick() {
  const sc = getServiceContext();
  if (!sc) return;
  for (const zoneKey of Object.keys(WORLD_BOSS_ZONES)) {
    try {
      const svc = sc.worldBossServiceFor?.(zoneKey);
      if (!svc) continue;
      const info = await svc.getConfigWithStatus().catch(() => null);
      const st = info?.status;
      if (!st) continue;

      // ── 自癒：偵測「部位全破但沒結算就卡死」──
      //   根因：擊殺時 saveState(部位全0) 與 handleMonsterKill(結算) 非原子；中間被打斷(重啟/崩潰/例外)
      //   就會「已存全0卻沒結算」。舊版直接重生滿血，會把本輪參戰、傷害與寶箱資格全部吃掉。
      //   新版保留原 state，改由最高貢獻者代表補做同一套 handleMonsterKill；若仍失敗就維持全破狀態重試，
      //   絕不清空 damageMap/participants 或直接補滿血。
      try {
        const heal = await sc.monsterService.getState(zoneKey).catch(() => null);
        if (heal && isWorldBossAllPartsDefeated(heal.worldBossPartsHp)) {
          const lastHit = heal.lastHitAt ? Date.parse(heal.lastHitAt) : 0;
          const staleMs = Date.now() - (Number.isFinite(lastHit) ? lastHit : 0);
          if (staleMs > 90 * 1000 && !(Number(st.cooldownRemainingMs) > 0)) {
            const mons = await sc.monsterService.listMonsters({ includeDisabled: true, zone: zoneKey }).catch(() => []);
            const boss = mons.find((m) => m.seq === heal.activeMonsterSeq) || mons.find((m) => m.isBoss) || mons[0];
            const ranked = Object.entries(heal.damageMap || {})
              .sort(([, a], [, b]) => (Number(b?.damage) || 0) - (Number(a?.damage) || 0));
            const recoveryPid = ranked[0]?.[0] || (Array.isArray(heal.participants) ? heal.participants[0] : null);
            const recoveryName = ranked[0]?.[1]?.name || recoveryPid || "世界王補結算";
            if (boss && recoveryPid) {
              console.warn(`[WorldBoss自癒] ${zoneKey} 偵測到全破未結算(靜止 ${Math.round(staleMs / 1000)} 秒) → 保留本輪資料並補做擊殺結算`);
              await handleMonsterKill({
                discordId: recoveryPid,
                displayName: recoveryName,
                session: { monsterName: boss.name, monsterMaxHp: boss.calc?.maxHp, entryFee: boss.entryFee ?? getZoneDefaultEntryFee(zoneKey) },
                monster: boss,
                state: heal,
                totalDamage: 0,
                zoneKey
              });
              const after = await svc.getConfigWithStatus().catch(() => null);
              if (Number(after?.status?.cooldownRemainingMs) > 0) {
                worldBossPanelSig.delete(zoneKey);
                console.warn(`[WorldBoss自癒] ${zoneKey} 補結算完成，已進入冷卻且保留本輪獎勵資格`);
              } else {
                console.error(`[WorldBoss自癒] ${zoneKey} 補結算未取得擊殺權；保留全破狀態，下輪繼續重試`);
              }
            } else {
              console.error(`[WorldBoss自癒] ${zoneKey} 全破但缺少可用的王或參戰者；保留原狀，不得重生清資料`);
            }
            continue; // 不論補結算成敗，都不可落入舊的滿血重生或常規刷新
          }
        }
      } catch (e) { console.warn(`[WorldBoss自癒] ${zoneKey} 檢查失敗:`, e?.message || e); }

      const sig = `${!!st.canChallenge}|${!!st.battleTimeoutReached}|${!!st.battleStartedAt}`;
      const prevSig = worldBossPanelSig.get(zoneKey) || null;
      if (prevSig === sig) continue;
      // 狀態有變（例如冷卻結束 canChallenge:false→true）→ 強制刷新該 zone 面板。
      // 關鍵：只有「確實刷新成功」才記住簽章；若被忙碌跳過或編輯失敗，保留舊簽章，下一輪自動重試，
      // 避免冷卻結束時的那一次刷新被靜默吞掉後面板永遠卡在「冷卻中」。
      const ok = await refreshWorldBossPanelForZone(sc, zoneKey, { force: true })
        .catch((e) => { console.warn(`[WorldBossWatcher] 刷新失敗 (${zoneKey}):`, e?.message || e); return false; });
      if (ok) {
        worldBossPanelSig.set(zoneKey, sig);
        // 世界王重生（冷卻結束 canChallenge:false→true）→ 廣播網頁通知。
        // prevSig 為 null（剛啟動）不發，避免每次重啟都誤報重生。
        if (prevSig && prevSig.split("|")[0] === "false" && st.canChallenge) {
          try {
            const { notifyAllPlayers } = require("../../services/realtime/playerNotifyService");
            const bossName = info?.config?.bossName || "世界王";
            notifyAllPlayers({
              type: "worldboss_respawn",
              title: "世界王出現",
              message: `${bossName} 已重生，快來挑戰！`,
              meta: { zoneKey, bossName }
            });
          } catch (_) { /* 通知失敗不影響面板刷新 */ }
        }
      }
    } catch (_) { /* 單一 zone 失敗不影響其他 */ }
  }
}
function startWorldBossRespawnWatcher() {
  if (worldBossWatcherTimer) return;
  worldBossRespawnTick().catch(() => {});
  worldBossWatcherTimer = setInterval(() => worldBossRespawnTick().catch(() => {}), 3 * 60 * 1000);
  worldBossWatcherTimer.unref?.();
  console.log("[WorldBossWatcher] 啟動：每 3 分檢查世界王逃跑/重生並刷新面板");
}

// 卡住面板修復：只處理「轉場過期沒收尾」或「死了沒換怪」的 zone，
// 並只在實際換了怪時才重發面板（健康的 zone 完全不動，避免 Discord PATCH 洗版）。
// 解決：PM2 重載丟失記憶體 setTimeout 後，怪物被打死但面板卡在死怪不換的狀況。
let monsterPanelSweepTimer = null;
async function sweepStuckMonsterPanels() {
  const sc = getServiceContext();
  if (!sc) return;
  const layout = await sc.channelLayoutRepository.get().catch(() => ({}));
  const bindings = Array.isArray(layout?.discord?.bindings) ? layout.discord.bindings : [];
  const targets = bindings.filter((b) => b?.enabled && b?.channelId
    && String(b.featureKey || "").startsWith("monster_zone") && b.featureKey !== "monster_zone_elite");
  for (const binding of targets) {
    try {
      const zoneKey = _featureKeyToZone(binding.featureKey);
      if (isWorldBossZone(zoneKey)) continue; // 世界王有自己的 watcher
      // 1) 轉場過期沒收尾 → 收尾並換下一隻
      let changed = await _resolveExpiredMonsterTransition(sc, zoneKey).catch(() => false);
      // 2) 死了(currentHp<=0)但沒有進行中的轉場/事件 → 直接換下一隻
      const state = await sc.monsterService.getState(zoneKey).catch(() => null);
      const deadNoTransition = Number(state?.currentHp || 0) <= 0 && !state?.activeTransition && !state?.activeEvent;
      if (deadNoTransition) {
        await _doIdleRotate(sc, zoneKey).catch(() => {});
        changed = true;
      }
      if (!changed) continue; // 健康 zone：完全不動面板
      const fresh = await sc.monsterService.getState(zoneKey).catch(() => null);
      const monsters = await sc.monsterService.listMonsters({ includeDisabled: true, zone: zoneKey }).catch(() => []);
      const monster = fresh?.currentMonster
        || monsters.find((m) => m.seq === fresh?.activeMonsterSeq)
        || (monsters.length ? monsters[0] : null);
      const monsterHp = fresh?.currentHp != null ? fresh.currentHp : (monster?.calc?.maxHp ?? null);
      await _republishPanel(sc, zoneKey, monster, monsterHp,
        Array.isArray(fresh?.participants) ? fresh.participants.length : 0,
        fresh?.damageMap || {}, fresh?.activeEvent || null,
        fresh?.worldBossPartsHp || null,
        { fastUpdate: true, activeTransition: fresh?.activeTransition || null }
      ).catch(() => {});
      console.log(`[MonsterSweep] 修復卡住面板 zone=${zoneKey}`);
    } catch (_) { /* 單一 zone 失敗不影響其他 */ }
  }
}
function startMonsterPanelSweep() {
  if (monsterPanelSweepTimer) return;
  const sec = Math.max(20, Number.parseInt(process.env.MONSTER_PANEL_SWEEP_SECONDS || "45", 10) || 45);
  sweepStuckMonsterPanels().catch(() => {});
  monsterPanelSweepTimer = setInterval(() => sweepStuckMonsterPanels().catch(() => {}), sec * 1000);
  monsterPanelSweepTimer.unref?.();
  console.log(`[MonsterSweep] 卡住面板自動修復已啟動（每 ${sec}s，只動需要換怪的 zone）`);
}

module.exports = {
  // 平衡測試用（scripts/lib/simWorldBoss.js）：讓模擬器能套上與線上完全相同的部位/破鱗修正
  applyWorldBossTargetToPlayerStats,
  applyWorldBossTargetToMonster,
  applyDragonKingBreakWeaken,
  applyWorldBossPhaseModifiers,
  handleMonsterZoneButton,
  startWorldBossRespawnWatcher,
  startMonsterPanelSweep,
  sweepStuckMonsterPanels,
  isMonsterZoneButton,
  isMonsterEventButton,
  isMonsterEventPersonalButton,
  handleMonsterEventChoice,
  handleMonsterEventPersonal,
  isNpcDialogButton,
  handleNpcDialog,
  handleMonsterKill,
  _republishPanel,
  _republishPanelWithRankingDebounce,
  MAX_ROUNDS,
  _broadcastBossSpawn,
  _doIdleRotate,
  activeSessions,
  getMonsterZoneDiagnostics,
  _recordQuestBattleProgress: recordQuestBattleProgress,
  _resolveExpiredMonsterTransition,
  _rankWorldBossChestContributors,
  _worldBossChestCountForRank,
  _worldBossSafeDisplayName,
  hellfangPlayerSchool, hellfangDamageMult, hellfangPartAccrue, hellfangFlipLines, hellfangPartCurrentWeak, getHellfangFlipRemainingMs, getWorldBossPartWeakness, hellfangBossPhaseMods, hellfangAlivePartCount,
  startIdleRotateTimer,
  refreshEliteWorldBossPanel,
  refreshMonsterZonePanels,
  // ── 世界王部位戰鬥（純函式）：給網頁端 quick-battle / status 還原 DC 邏輯用 ──
  getWorldBossPartKeys,
  getWorldBossTargetProfile,
  applyWorldBossTargetToPlayerStats,
  applyWorldBossTargetToMonster,
  applyDragonKingBreakWeaken,
  ensureWorldBossPartState,
  sumWorldBossPartHp,
  isWorldBossAllPartsDefeated,
  createWorldBossPartHpTemplate,
  parseWorldBossTargetPart,
  DRAGON_KING_ZONE
};

function notifyHealerBonus(pid, monsterName, parts) {
  const client = require("../runtimeContext").getBotClient();
  if (client?.isReady()) void client.users.fetch(pid).then(user => user.send(`💚 **治療師加成**（${monsterName}）：${parts.join("、")}`)).catch(() => {});
}
async function announceChestRanking(lines) {
  const client = require("../runtimeContext").getBotClient();
  if (!client?.isReady?.()) return;
  const channel = await client.channels.fetch("1498608950671839263").catch(() => null);
  if (channel?.isTextBased?.()) await channel.send(lines.join("\n")).catch(() => {});
}
async function announceIdleRotate(sc, zoneKey, monster) {
  const client = require("../runtimeContext").getBotClient();
  if (!client?.isReady() || process.env.DISABLE_TAUNTS === '1') return;
  const layout = await sc.channelLayoutRepository.get();
  const bindings = layout?.discord?.bindings || [];
  const channelId = (bindings.find(b => b.featureKey === "town_chat") || bindings.find(b => b.featureKey === zoneToFeatureKey(zoneKey)))?.channelId;
  if (!channelId) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (channel?.isTextBased?.()) await channel.send(IDLE_TAUNTS[Math.floor(Math.random() * IDLE_TAUNTS.length)](monster.name));
}
require("../../services/battle/battlePresentation").configureBattlePresentation({ _republishPanel, _republishPanelWithRankingDebounce, _announceLevelMilestone, _announceDrops, _notifyKillRewards, clearQueuedEliteWorldBossSessions, _broadcastBossSpawn, notifyHealerBonus, announceChestRanking, announceIdleRotate });
