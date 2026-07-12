"use strict";

const { MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require("discord.js");
const { EFFECT_NAME_ZH } = require("../../shared/effectDisplayNames");
const { buildItemEffectLines } = require("../../shared/itemEffectLines");
const { ALL_ZONE_KEYS, featureKeyToZone: _featureKeyToZone, zoneToFeatureKey, getZoneTheme, getZoneDefaultEntryFee, checkZoneLevelRequirementWithBinding } = require("../../shared/zones");
const { isWorldBossZone, WORLD_BOSS_ZONES } = require("../../services/worldBoss/worldBossService");

// 這些效果的 params.value 代表百分比（percent），顯示時會特別格式化
const PERCENT_EFFECT_KEYS = new Set([
  'gold_gain_up', 'exp_gain_up', 'drop_rate_up', 'rare_drop_rate_up', 'monster_reward_up', 'checkin_bonus_up', 'enhance_success_up', 'event_trigger_rate_up'
]);
const { CURRENCY_SOURCES, EXP_SOURCES } = require("../../shared/sources");
const { calcPlayerStats, isOnlyDTierEquipped } = require("../../shared/combatStats");
const { getEquipmentTierSetBonuses } = require("../../shared/equipmentTierSetBonuses");
const { isEffectConditionMet, collectEquipmentEffects, mergeEquippedFromLibrary, applyEffectInstances, decrementActiveEffects } = require("../../shared/effectEngine");
const { scaleSupportPartyEffect } = require("../../shared/supportAuraScaling");
const { isPkBattleActive, replaceMonsterBattlePresence, isTowerBattleActive } = require("../../shared/battlePresence");
const { isWebBattleActive } = require("../../services/progress/battleLock");
const { getDropBoostPct } = require("../../shared/pkArenaConfig");
const { withPlayerProgressLock } = require("../../services/progress/progressLocks");
const { clearCurrentCache } = require("../../adapters/mongo/requestCache");
const { bestiaryRequirement, bestiaryBonusPct, bestiaryGainFromDamage } = require("../../shared/bestiary");
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
const killInProgress = new Set();
const zoneEventTimers = new Map();
const monsterTransitionTimers = new Map();
const activeMonsterTransitions = new Map();
const worldBossTimeoutTimers = new Map();
// track last chosen candidate per zone to avoid immediate repeats
const zoneLastChosen = new Map();
const announcementWebhookCache = new Map();

// 排行榜去重：key = zoneKey, value = { lastPublishTime, lastDamageMap, pendingTimer }
// 防止戰鬥中頻繁編輯面板，最多 5 秒更新一次排行榜
const damageRankingDebounce = new Map();
const BOSS_SPAWN_BROADCAST_ENABLED = false;
const COOLDOWN_MAP_PRUNE_INTERVAL_MS = 5 * 60 * 1000;
let cooldownMapPruneTimer = null;

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

const BTN = {
  enterBattle: "monster-zone:enter-battle",
  enterBattlePrefix: "monster-zone:enter-battle:",
  deleteLog:   "monster-zone:delete-log"
};

const MAX_ROUNDS = 15;
const BATTLE_TIMEOUT_MS = 60 * 1000; // 1 分鐘未按開始戰鬥 → 視為逃跑
const ROUNDS_PER_TICK = 1;           // 每次更新顯示 1 回合，維持逐回合戰報節奏
const DISCORD_REPLY_RETRY_DELAY_MS = 700;
const DISCORD_REPLY_TIMEOUT_MS = 8_000;
const DISPLAYING_SESSION_CLEANUP_GRACE_MS = 15_000;
const MONSTER_TRANSITION_MS = 500;   // 怪物轉場空窗：0.5 秒
const BATTLE_QUEUE_POLL_MS = 500;    // 排隊等待輪詢：0.5 秒
const DEATH_EXTRA_COOLDOWN_MS = 10 * 1000; // 死亡額外冷卻：在 15 回合基準時間外再加 10 秒
// 世界王冷卻若超過此秒數，就不要把玩家鎖在佇列裡空等（避免「被王關起來」長達一小時無法戰鬥）；
// 改為直接釋放並提示稍後再來。低於此值才維持短暫自動排隊（王即將重生，值得等）。
const WORLD_BOSS_QUEUE_RELEASE_MS = 90 * 1000;

// 金幣池採「怪物原始金幣」與「參戰人數保底」取高。
// 這能保留傷害占比，同時避免多人共鬥時每個人分到的金幣太薄。
const GOLD_POOL_RULE_BY_ZONE = {
  beginner: { minPerPlayer: 80 },
  normal: { minPerPlayer: 220 },
  mid: { minPerPlayer: 650 },
  hard: { minPerPlayer: 1200 },
  elite: { minPerPlayer: 6000 }
};

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
const RARE_TIERS = new Set(["A", "S", "SS", "SSR", "UR"]);
const WORLD_BOSS_TARGET_PARTS = new Set(["head", "body", "legs", "wings", "upper_body", "lower_body", "tail"]);
// 古龍王巢穴採 4 部位(含龍翼)+ 破鱗削弱;其餘世界王維持 3 部位
const DRAGON_KING_ZONE = "dragon_king_lair";
// 地獄狼牙王(牙狼)：5 部位 + 部位傷害類型弱點 + 適應性狀態
const HELLFANG_ZONE = "hellfire_depths";
// 牙狼五部位弱點：物理(頭/尾/腿) vs 法系(上/下軀幹)；打對流派全額、打錯 ×0.2
const HELLFANG_PART_WEAKNESS = { head: "physical", upper_body: "magic", lower_body: "magic", tail: "physical", legs: "physical" };
const HELLFANG_WRONG_TYPE_MULT = 0.2;   // 打錯流派 → 傷害 ×0.2
const HELLFANG_ADAPT_MULT = 0.1;        // 被適應的流派 → 傷害 ×0.1
const HELLFANG_ADAPT_THRESHOLD = 1 / 3; // 某流派佔比 ≥1/3 且為當下主力 → 適應該流派
const HELLFANG_ADAPT_DURATION_MS = 10 * 60 * 1000; // 適應持續 10 分鐘
const HELLFANG_PART_LABELS = { head: "頭部", upper_body: "上軀幹", lower_body: "下軀幹", tail: "尾巴", legs: "腿部" };
function getWorldBossPartKeys(zoneKey) {
  if (zoneKey === HELLFANG_ZONE) return ["head", "upper_body", "lower_body", "tail", "legs"];
  return zoneKey === DRAGON_KING_ZONE ? ["head", "body", "wings", "legs"] : ["head", "body", "legs"];
}

function parseWorldBossTargetPart(customId) {
  const raw = String(customId || "");
  if (!raw.startsWith(BTN.enterBattlePrefix)) return "body";
  const part = raw.slice(BTN.enterBattlePrefix.length);
  return WORLD_BOSS_TARGET_PARTS.has(part) ? part : "body";
}

function getWorldBossTargetProfile(part, zoneKey = null) {
  // 古龍王:採破鱗削弱(破部位永久削弱),攻擊當下不另加難度,只回部位標籤
  if (zoneKey === DRAGON_KING_ZONE || part === "wings") {
    const labels = { head: "頭部", body: "軀幹", wings: "龍翼", legs: "下盤" };
    return { label: labels[part] || "軀幹" };
  }
  if (part === "head") {
    // 頭部：怪物技能發動率提高（高風險，技能更常觸發）
    return {
      label: "頭部",
      monsterSkillChanceBonus: 25,   // 怪物卡技能觸發率 +25%
      note: "⚠️ 怪物技能發動率大幅提高（高風險）"
    };
  }
  if (part === "legs") {
    // 下盤/尾巴：怪物攻擊更兇，終傷 ×1.3
    return {
      label: "下盤",
      monsterDamageMult: 1.3,        // 怪物終傷 ×1.3
      note: "⚠️ 怪物攻擊更兇（你受到的傷害 ×1.3）"
    };
  }
  // 軀幹：防禦更高，且你的傷害被削減
  return {
    label: "軀幹",
    monsterFlatDefMult: 1.6,         // 固定防禦提高（不受 75% 上限限制）
    playerAtkMultiplier: 0.8,        // 玩家傷害 -20%（實際透過 atk 折減，確實生效）
    note: "🛡️ 防禦極高、你的傷害被削減"
  };
}

function applyWorldBossTargetToPlayerStats(playerStats, part, zoneKey = null) {
  const profile = getWorldBossTargetProfile(part, zoneKey);
  const next = { ...(playerStats || {}) };
  if (profile.playerAtkMultiplier != null) {
    next.atk = Math.max(1, Math.round((next.atk || 0) * profile.playerAtkMultiplier));
  }
  if (profile.playerDexMultiplier != null) {
    next.dex = Math.max(1, Math.round((next.dex || 1) * profile.playerDexMultiplier));
  }
  if (profile.playerAgiBonus != null) {
    next.agi = Math.max(1, Math.round((next.agi || 1) + profile.playerAgiBonus));
  }
  return { stats: next, profile };
}

// 依目標部位調整「怪物」：頭部技能率↑ / 軀幹防禦↑ / 尾巴攻擊↑
//   回傳調整後的 { monsterStats, monsterEquipped }（皆 clone，不動原物件）
function applyWorldBossTargetToMonster(monsterStats, monsterEquipped, part, zoneKey = null) {
  const profile = getWorldBossTargetProfile(part, zoneKey);
  const mStats = { ...(monsterStats || {}) };
  let mEquip = monsterEquipped || {};

  if (profile.monsterFlatDefMult) {
    mStats.flatDef = Math.max(0, Math.round((Number(mStats.flatDef) || 0) * profile.monsterFlatDefMult));
  }
  if (profile.monsterDamageMult) {
    mStats.atk = Math.max(1, Math.round((Number(mStats.atk) || 1) * profile.monsterDamageMult));
  }
  if (profile.monsterSkillChanceBonus) {
    // clone special_1 卡，提高 monsterCardSkill.chance
    mEquip = { ...mEquip };
    const card = mEquip.special_1;
    if (card && card.monsterCardSkill) {
      const skill = { ...card.monsterCardSkill };
      skill.chance = Math.min(100, (Number(skill.chance) || 30) + profile.monsterSkillChanceBonus);
      mEquip.special_1 = { ...card, monsterCardSkill: skill, cardProcChance: skill.chance };
    }
  }
  return { monsterStats: mStats, monsterEquipped: mEquip, profile };
}

function createWorldBossPartHpTemplate(totalMaxHp = 0, zoneKey = null) {
  const maxHp = Math.max(1, Math.round(Number(totalMaxHp) || 1));
  if (zoneKey === HELLFANG_ZONE) {
    // 牙狼 5 部位：頭 20% / 上軀幹 20% / 下軀幹 20% / 尾巴 15% / 腿 25%
    const head = Math.max(1, Math.round(maxHp * 0.20));
    const upper_body = Math.max(1, Math.round(maxHp * 0.20));
    const lower_body = Math.max(1, Math.round(maxHp * 0.20));
    const tail = Math.max(1, Math.round(maxHp * 0.15));
    const legs = Math.max(1, maxHp - head - upper_body - lower_body - tail);
    return { head, upper_body, lower_body, tail, legs };
  }
  if (zoneKey === DRAGON_KING_ZONE) {
    // 古龍王 4 部位:頭 30% / 軀幹 30% / 龍翼 20% / 下盤 20%
    const head = Math.max(1, Math.round(maxHp * 0.3));
    const body = Math.max(1, Math.round(maxHp * 0.3));
    const wings = Math.max(1, Math.round(maxHp * 0.2));
    const legs = Math.max(1, maxHp - head - body - wings);
    return { head, body, wings, legs };
  }
  const head = Math.max(1, Math.round(maxHp * 0.3));
  const body = Math.max(1, Math.round(maxHp * 0.4));
  const legs = Math.max(1, maxHp - head - body);
  return { head, body, legs };
}

// ═══ 牙狼(地獄狼牙王) 適應性傷害機制 純函式 ═══
// 玩家攻擊流派：法杖=法系，其餘(劍/斧/槌/匕/弓)=物理
function hellfangPlayerSchool(weaponType) {
  return String(weaponType || "").startsWith("staff") ? "magic" : "physical";
}
// 世界王部位弱點類型(給前端顯示)：牙狼各部位 physical/magic；其餘世界王 null
function getWorldBossPartWeakness(zoneKey, partKey) {
  if (zoneKey === HELLFANG_ZONE) return HELLFANG_PART_WEAKNESS[partKey] || null;
  return null;
}
// 這場玩家對牙狼的傷害倍率＝部位弱點 × 適應狀態
//  - 打對部位弱點流派 ×1、打錯 ×0.2
//  - 打到「當下被適應的流派」再 ×0.1
function hellfangDamageMult(state, part, weaponType, now = Date.now()) {
  const school = hellfangPlayerSchool(weaponType);
  const weakness = HELLFANG_PART_WEAKNESS[part] || null;
  const weakMult = (weakness && school === weakness) ? 1 : HELLFANG_WRONG_TYPE_MULT;
  const adaptUntil = state?.hellfangAdaptUntil ? Date.parse(state.hellfangAdaptUntil) : 0;
  const adapted = (Number.isFinite(adaptUntil) && now < adaptUntil) ? state.hellfangAdaptSchool : null;
  const adaptMult = (adapted && adapted === school) ? HELLFANG_ADAPT_MULT : 1;
  return { school, weakness, adapted, weakMult, adaptMult, mult: weakMult * adaptMult };
}
// 戰後更新適應狀態：記錄本場流派傷害(衰減式滾動→以當下為主)、動態切換為當下主力流派。
// 回傳文案事件 {type:'enter'|'switch', school} 或 null。
function hellfangUpdateAdaptation(state, school, rawDamage, now = Date.now()) {
  if (!state) return null;
  const DECAY = 0.6; // 舊紀錄每場衰減 → 讓「當下」主導
  let phys = (Number(state.hellfangDmgPhys) || 0) * DECAY;
  let magic = (Number(state.hellfangDmgMagic) || 0) * DECAY;
  const dmg = Math.max(0, Number(rawDamage) || 0);
  if (school === "magic") magic += dmg; else phys += dmg;
  state.hellfangDmgPhys = phys;
  state.hellfangDmgMagic = magic;
  const total = phys + magic;
  const adaptUntilPrev = state.hellfangAdaptUntil ? Date.parse(state.hellfangAdaptUntil) : 0;
  const prevAdapt = (Number.isFinite(adaptUntilPrev) && now < adaptUntilPrev) ? state.hellfangAdaptSchool : null;
  let event = null;
  if (total > 0) {
    const dom = phys >= magic ? "physical" : "magic";
    const share = Math.max(phys, magic) / total;
    if (share >= HELLFANG_ADAPT_THRESHOLD) {
      state.hellfangAdaptSchool = dom;
      state.hellfangAdaptUntil = new Date(now + HELLFANG_ADAPT_DURATION_MS).toISOString();
      if (prevAdapt !== dom) event = { type: prevAdapt ? "switch" : "enter", school: dom };
    }
  }
  return event;
}
// 適應性狀態的戰報文案
function hellfangAdaptLines(event) {
  if (!event) return [];
  const zh = event.school === "magic" ? "法術" : "物理";
  const cover = event.school === "magic" ? "魔紋覆體" : "皮肉硬化";
  if (event.type === "switch") return [`🔁 地獄狼牙王重新適應了攻勢——這次改為抵禦${zh}傷害！（${zh}傷害大幅降低，10 分鐘）`];
  return [`⚠️ 地獄狼牙王進入【適應性狀態】——${cover}抵禦${zh}！${zh}傷害大幅降低（10 分鐘）`];
}

// 以下兩個改為「依 partsHp 實際部位」運作,自動支援 3 或 4 部位
function sumWorldBossPartHp(partsHp) {
  if (!partsHp || typeof partsHp !== "object") return 0;
  return Object.keys(partsHp).reduce((sum, k) => sum + Math.max(0, Number(partsHp[k] || 0)), 0);
}

function isWorldBossAllPartsDefeated(partsHp) {
  if (!partsHp || typeof partsHp !== "object") return false;
  const keys = Object.keys(partsHp);
  if (keys.length === 0) return false;
  return keys.every((k) => Number(partsHp[k] || 0) <= 0);
}

// 古龍王破鱗削弱:依「已破壞部位」削弱 BOSS 攻擊面(不削防禦)。回傳 clone。
//   下盤破→普攻−20% / 龍翼破→技能傷害−15% / 軀幹破→技能發動率→30% / 頭部破→無
function applyDragonKingBreakWeaken(monsterStats, monsterEquipped, partsHp) {
  const mStats = { ...(monsterStats || {}) };
  let mEquip = monsterEquipped || {};
  const broken = (k) => Number((partsHp || {})[k] ?? 1) <= 0;

  if (broken("legs")) {
    mStats.atk = Math.max(1, Math.round((Number(mStats.atk) || 1) * 0.8)); // 普攻 −20%
  }
  const card = mEquip.special_1;
  if ((broken("wings") || broken("body")) && card && card.monsterCardSkill) {
    mEquip = { ...mEquip };
    const skill = { ...card.monsterCardSkill };
    if (broken("body")) {
      skill.chance = Math.min(Number(skill.chance) || 50, 30); // 發動率 → 30%
    }
    if (broken("wings") && Array.isArray(skill.procEffects)) {
      // 技能傷害 −15%(雷擊 value × 0.85)
      skill.procEffects = skill.procEffects.map((pe) =>
        pe && pe.key === "lightning"
          ? { ...pe, params: { ...(pe.params || {}), value: Math.max(1, Math.round((Number(pe.params?.value) || 0) * 0.85)) } }
          : pe
      );
    }
    mEquip.special_1 = { ...card, monsterCardSkill: skill, cardProcChance: skill.chance };
  }
  return { monsterStats: mStats, monsterEquipped: mEquip };
}

function getDynamicGoldPoolFloor(zoneKey, participantCount) {
  const zoneRule = GOLD_POOL_RULE_BY_ZONE[zoneKey];
  if (!zoneRule) return 0;
  const minPerPlayer = Number(zoneRule.minPerPlayer || 0);
  if (minPerPlayer <= 0) return 0;
  return Math.round(Math.max(1, participantCount) * minPerPlayer);
}

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

async function _startMonsterTransition(sc, zoneKey, nextMonster, freshState, { sourceMonsterName = null, sourceMonsterSeq = null } = {}) {
  if (!nextMonster) return null;

  const prevTimer = monsterTransitionTimers.get(zoneKey);
  if (prevTimer) clearTimeout(prevTimer);

  const transitionId = require("crypto").randomUUID();
  const diceRoll = Math.floor(Math.random() * 100) + 1;
  const startedAt = new Date().toISOString();
  const endsAt = new Date(Date.now() + MONSTER_TRANSITION_MS).toISOString();

  const transitionState = {
    ...freshState,
    currentHp: 0,
    activeMonsterSeq: freshState?.activeMonsterSeq ?? nextMonster.seq,
    killCount: freshState?.killCount || {},
    participants: [],
    damageMap: {},
    killClaimedSeq: sourceMonsterSeq ?? freshState?.activeMonsterSeq ?? nextMonster.seq,
    killClaimedAt: new Date(),
    activeHealerAura: null,
    activeEvent: null,
    activeTransition: {
      id: transitionId,
      kind: "monster_switch",
      startedAt,
      endsAt,
      diceRoll,
      nextMonsterSeq: nextMonster.seq,
      nextMonsterName: nextMonster.name,
      sourceMonsterName
    }
  };

  activeMonsterTransitions.set(zoneKey, transitionState.activeTransition);
  await sc.monsterService.saveState(transitionState, zoneKey);
  await _republishPanel(
    sc,
    zoneKey,
    null,
    0,
    0,
    {},
    null,
    null,
    { activeTransition: transitionState.activeTransition }
  ).catch(() => {});

  const timer = setTimeout(async () => {
    try {
      const latestState = await sc.monsterService.getState(zoneKey).catch(() => null);
      if (latestState?.activeTransition?.id !== transitionId) return;

      const nextState = {
        ...latestState,
        currentHp: nextMonster.calc.maxHp,
        activeMonsterSeq: nextMonster.seq,
        killCount: latestState?.killCount || transitionState.killCount || {},
        participants: [],
        damageMap: {},
        killClaimedSeq: nextMonster.seq === (sourceMonsterSeq ?? latestState?.activeMonsterSeq) ? null : (latestState?.killClaimedSeq ?? sourceMonsterSeq ?? transitionState.killClaimedSeq ?? null),
        killClaimedAt: nextMonster.seq === (sourceMonsterSeq ?? latestState?.activeMonsterSeq) ? null : (latestState?.killClaimedAt ?? transitionState.killClaimedAt ?? null),
        activeHealerAura: null,
        activeEvent: null,
        activeTransition: null,
        lastHitAt: new Date().toISOString()
      };

      let worldBossPartsHp = null;
      if (isWorldBossZone(zoneKey) && nextMonster?.isBoss) {
        const partState = ensureWorldBossPartState({}, nextMonster.calc.maxHp, zoneKey);
        nextState.currentHp = partState.currentHp;
        nextState.worldBossPartsHp = partState.worldBossPartsHp;
        nextState.worldBossPartsMaxHp = partState.worldBossPartsMaxHp;
        worldBossPartsHp = partState.worldBossPartsHp;
      }

      await sc.monsterService.saveState(nextState, zoneKey);
      await _republishPanel(
        sc,
        zoneKey,
        nextMonster,
        nextState.currentHp,
        0,
        {},
        null,
        worldBossPartsHp
      ).catch(() => {});

      if (nextMonster.isBoss && !isWorldBossZone(zoneKey) && BOSS_SPAWN_BROADCAST_ENABLED) {
        _broadcastBossSpawn(sc, zoneKey, nextMonster).catch(() => {});
      }
      } catch (e) {
        console.error(`[MonsterTransition] finalize failed zone=${zoneKey}:`, e?.message || e);
      } finally {
        const current = monsterTransitionTimers.get(zoneKey);
        if (current) clearTimeout(current);
        monsterTransitionTimers.delete(zoneKey);
        const currentTransition = activeMonsterTransitions.get(zoneKey);
        if (currentTransition?.id === transitionId) {
          activeMonsterTransitions.delete(zoneKey);
        }
      }
  }, MONSTER_TRANSITION_MS);

  monsterTransitionTimers.set(zoneKey, timer);
  return transitionState.activeTransition;
}

async function _resolveExpiredMonsterTransition(sc, zoneKey) {
  const state = await sc.monsterService.getState(zoneKey).catch(() => null);
  const transition = state?.activeTransition || null;
  if (!transition && activeMonsterTransitions.has(zoneKey)) {
    activeMonsterTransitions.delete(zoneKey);
    const timer = monsterTransitionTimers.get(zoneKey);
    if (timer) clearTimeout(timer);
    monsterTransitionTimers.delete(zoneKey);
  }
  if (!transition || !transition.endsAt) return false;

  const endAtMs = Date.parse(transition.endsAt);
  if (!Number.isFinite(endAtMs) || endAtMs > Date.now()) return false;

  const allMonsters = await sc.monsterService.listMonsters({ includeDisabled: false, zone: zoneKey }).catch(() => []);
  if (!allMonsters.length) {
    const cleared = {
      ...state,
      currentHp: 0,
      participants: [],
      damageMap: {},
      killClaimedSeq: null,
      activeEvent: null,
      activeTransition: null,
      lastHitAt: new Date().toISOString()
    };
    await sc.monsterService.saveState(cleared, zoneKey);
    return true;
  }

  let nextMonster = allMonsters.find((m) => Number(m.seq) === Number(transition.nextMonsterSeq));
  if (!nextMonster) {
    nextMonster = allMonsters.find((m) => Number(m.seq) === Number(state?.activeMonsterSeq)) || allMonsters[0];
  }
  if (!nextMonster) return false;

  const nextState = {
    ...state,
    activeMonsterSeq: nextMonster.seq,
    currentHp: nextMonster.calc.maxHp,
    participants: [],
    damageMap: {},
    killClaimedSeq: null,
    activeEvent: null,
    activeTransition: null,
    lastHitAt: new Date().toISOString()
  };

  let worldBossPartsHp = null;
  if (isWorldBossZone(zoneKey) && nextMonster?.isBoss) {
    const partState = ensureWorldBossPartState({}, nextMonster.calc.maxHp, zoneKey);
    nextState.currentHp = partState.currentHp;
    nextState.worldBossPartsHp = partState.worldBossPartsHp;
    nextState.worldBossPartsMaxHp = partState.worldBossPartsMaxHp;
    worldBossPartsHp = partState.worldBossPartsHp;
  }

  await sc.monsterService.saveState(nextState, zoneKey);
  await _republishPanel(
    sc,
    zoneKey,
    nextMonster,
    nextState.currentHp,
    0,
    {},
    null,
    worldBossPartsHp
  ).catch(() => {});

  if (nextMonster.isBoss && !isWorldBossZone(zoneKey) && BOSS_SPAWN_BROADCAST_ENABLED) {
    _broadcastBossSpawn(sc, zoneKey, nextMonster).catch(() => {});
  }

  return true;
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

function ensureWorldBossPartState(state, monsterMaxHp, zoneKey = null) {
  const defaultMax = createWorldBossPartHpTemplate(monsterMaxHp, zoneKey);
  const hasCurrentHp = !!(state && state.worldBossPartsHp && typeof state.worldBossPartsHp === "object" && Object.keys(state.worldBossPartsHp).length);
  // 部位清單:沿用既有 state(自動支援 3 / 4 部位),否則用該區模板
  const keys = hasCurrentHp ? Object.keys(state.worldBossPartsHp) : Object.keys(defaultMax);
  const maxSrc = (state && state.worldBossPartsMaxHp && typeof state.worldBossPartsMaxHp === "object") ? state.worldBossPartsMaxHp : null;
  const currentMax = Object.fromEntries(keys.map((k) => [k, Math.max(1, Number((maxSrc && maxSrc[k]) || defaultMax[k] || 1))]));
  const currentHp = hasCurrentHp
    ? Object.fromEntries(keys.map((k) => [k, Math.max(0, Number(state.worldBossPartsHp[k] || 0))]))
    : { ...currentMax };

  const totalHp = sumWorldBossPartHp(currentHp);
  const changed = !hasCurrentHp || !state?.worldBossPartsMaxHp || Number(state?.currentHp) !== totalHp;
  return {
    worldBossPartsHp: currentHp,
    worldBossPartsMaxHp: currentMax,
    currentHp: totalHp,
    changed
  };
}

// 強化寶石 ID 對應表
const ENHANCE_GEM_IDS = {
  'D': '72fde92d-e33f-42fb-8d86-2e811d03f84d',
  'C': '556db9e1-b084-4b22-bab5-a66c2b586184',
  'B': '8fdfa7d9-f0fa-4e6a-a291-703b1e354072',
  'A': 'a6ae293d-52fc-4af5-8770-891ddf842e35'
};
// 參與獎勵寶石：依區域決定品階
const ZONE_PARTICIPATION_GEM_TIER = {
  beginner: 'D', normal: 'D', mid: 'C', hard: 'B', elite: 'A',
  ancient_city: 'B',
  // A 階三區(40開放)統一給 A 石：秘銀(深處)/龍鱗(龍族)/焚獄(火焰)
  ancient_city_deep: 'A', dragon_realm: 'A', hellfire: 'A',
  dragon_king_lair: 'A', hellfire_depths: 'A'
};
// 參與獎勵寶石掉落率（依品階）。S 石不進參與制，只由世界王/世界王寶箱產出。
const GEM_PARTICIPATION_RATE = { D: 0.20, C: 0.20, B: 0.12, A: 0.06 };
// 先不啟用雙掉
const GEM_PARTICIPATION_DOUBLE_DROP_RATE = {};
const GEM_TIER_ORDER = ["D", "C", "B", "A"];

function getNextEnhanceGemTier(tier) {
  const normalized = String(tier || "").toUpperCase();
  const idx = GEM_TIER_ORDER.indexOf(normalized);
  if (idx < 0 || idx >= GEM_TIER_ORDER.length - 1) return null;
  return GEM_TIER_ORDER[idx + 1];
}

function getParticipationGemTiers(zoneKey, monster) {
  const baseTier = ZONE_PARTICIPATION_GEM_TIER[zoneKey] || "D";
  const tiers = [baseTier];
  if (monster?.isBoss) {
    const nextTier = getNextEnhanceGemTier(baseTier);
    if (nextTier) tiers.push(nextTier);
  }
  return tiers;
}

function getServiceContext() {
  return require("../runtimeContext").serviceContext;
}

function applyWorldBossPhaseModifiers(monsterStats, phase) {
  if (!monsterStats || !phase) return monsterStats;
  return {
    ...monsterStats,
    atk: Math.max(1, Math.round((monsterStats.atk || 0) * Math.max(0.1, Number(phase.atkMultiplier || 1)))),
    def: Math.max(0, Math.min(75, (monsterStats.def || 0) * Math.max(0.1, Number(phase.defMultiplier || 1))))
  };
}

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
    currentHp: partState.currentHp,
    worldBossPartsHp: partState.worldBossPartsHp,
    worldBossPartsMaxHp: partState.worldBossPartsMaxHp,
    participants: [],
    damageMap: {},
    lastHitAt: new Date().toISOString(),
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

function resolveWeaponQuestMetric(weaponType = "") {
  const wt = String(weaponType || "");
  if (wt === "sword_1h" || wt === "sword_2h") return "battle_with_sword";
  if (wt === "axe_1h" || wt === "axe_2h") return "battle_with_axe";
  if (wt === "mace_1h" || wt === "mace_2h") return "battle_with_mace";
  if (wt === "dagger") return "battle_with_dagger";
  if (wt === "staff_1h" || wt === "staff_2h") return "battle_with_staff";
  if (wt === "bow") return "battle_with_bow";
  return null;
}

// 輔助職業(徽章)判定：治療師/軍師/詩人/結界師
const SUPPORT_JOB_KEYS = new Set(["healer", "tactician", "bard", "barrier_mage"]);
function isSupportJobBadge(jobEq) {
  if (!jobEq) return false;
  try {
    const { getSupportJobKey } = require("../../shared/supportAuraScaling");
    const key = getSupportJobKey({ jobKey: jobEq.itemId || jobEq.id, jobName: jobEq.itemName || jobEq.name });
    return SUPPORT_JOB_KEYS.has(key);
  } catch (_) { return false; }
}

async function recordQuestBattleProgress(sc, discordId, outcome, totalDamage, combatStats = null, weaponType = null, zoneKey = null, jobEq = null, damageTaken = 0, healDone = 0) {
  // 通行證點數：打怪(非落敗)依地圖階級加點
  if (outcome !== "lose" && sc?.passService?.addPointsForKill) {
    const PASS_TIER = { beginner: "D", normal: "D", mid: "C", ancient_city: "B", ancient_city_deep: "A", dragon_realm: "A", hellfire: "A", elite: "A", dragon_king_lair: "S", hellfire_depths: "S" };
    sc.passService.addPointsForKill(discordId, PASS_TIER[zoneKey] || "D").catch(() => {});
  }
  const questService = sc?.questService || sc?.weeklyQuestService;
  if (!questService || typeof questService.recordProgress !== "function") return;

  await questService.recordProgress(discordId, "battle_count", 1);
  await questService.recordProgress(discordId, "damage_total", totalDamage);
  // 錨點隱藏任務指標：承受傷害(沒苦硬吃)、回血量(聖人)
  if (Number(damageTaken) > 0) await questService.recordProgress(discordId, "damage_taken", Math.round(Number(damageTaken)));
  if (Number(healDone) > 0) await questService.recordProgress(discordId, "heal_done", Math.round(Number(healDone)));
  const weaponMetric = resolveWeaponQuestMetric(weaponType);
  if (weaponMetric) {
    await questService.recordProgress(discordId, weaponMetric, 1);
  }
  // 用輔助職業(徽章)出戰 → 記錄一場（供隱藏賽季任務「共鳴之鏈」用）
  if (isSupportJobBadge(jobEq)) {
    await questService.recordProgress(discordId, "battle_with_support_job", 1);
  }
  if (outcome === "lose") {
    await questService.recordProgress(discordId, "death_count", 1);
  }

  if (!combatStats) return;
  if (combatStats.comboCount > 0) await questService.recordProgress(discordId, "combo_count", combatStats.comboCount);
  if (combatStats.dodgeCount > 0) await questService.recordProgress(discordId, "dodge_count", combatStats.dodgeCount);
  if (combatStats.blockCount > 0) await questService.recordProgress(discordId, "block_count", combatStats.blockCount);
  if (combatStats.stunCount > 0) await questService.recordProgress(discordId, "stun_count", combatStats.stunCount);
  if (combatStats.burnTriggerCount > 0) await questService.recordProgress(discordId, "burn_trigger_count", combatStats.burnTriggerCount);
}

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

function isMonsterCardItem(item) {
  return !!(
    item &&
    (
      item.equipSlot === "special" ||
      item.slotType === "special_1" ||
      item.monsterCardOf ||
      item.monsterCardSkill
    )
  );
}

async function buildMonsterDropPool(sc, monster) {
  const pool = Array.isArray(monster?.drops) ? [...monster.drops] : [];
  const cardItemId = monster?.equipment?.special_1?.itemId || monster?.equipment?.special_1?.id || null;
  if (!cardItemId) return pool;

  const card = await sc.itemRepository.findById(cardItemId).catch(() => null);
  if (!card || !isMonsterCardItem(card)) return pool;

  const existingCardDropIndex = pool.findIndex((drop) => drop?.itemId === cardItemId);
  if (existingCardDropIndex >= 0) {
    // 卡片已列在掉落表 → 掉率統一寫死 1%（覆蓋 DB 值），補上來源標記
    pool[existingCardDropIndex] = {
      ...pool[existingCardDropIndex],
      chance: 1,
      source: pool[existingCardDropIndex].source || "monster_card"
    };
    return pool;
  }

  // 掉落表沒列到卡片 → 補一個 1% 保底，讓卡片可掉出
  pool.push({
    itemId: card.id,
    chance: 1,
    source: "monster_card"
  });
  return pool;
}

/**
 * 嘗試堆疊寶石到背包中的相同寶石上，如果成功回傳 true，否則回傳 false
 * @returns {boolean} 成功堆疊則回傳 true，否則 false
 */
function tryStackGem(progress, gemItemId) {
  if (!gemItemId || !Array.isArray(progress?.inventory)) return false;

  // 查找背包中相同 itemId 的寶石
  const existingGem = progress.inventory.find(i => i?.itemId === gemItemId);
  if (existingGem) {
    // 初始化 stackCount 如果還沒有
    if (!existingGem.stackCount) existingGem.stackCount = 1;
    existingGem.stackCount += 1;
    return true;
  }
  return false;
}

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

function toPct(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return num;
}

function toMultiplier(percent) {
  return Math.max(0, 1 + percent / 100);
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

function collectRewardEffectRefs(progress) {
  const refs = [];
  const equipped = progress?.equipment || {};
  const effectContext = {
    equipped,
    inventory: Array.isArray(progress?.inventory) ? progress.inventory : []
  };
  for (const entry of Object.values(equipped)) {
    if (!entry || typeof entry !== "object") continue;
    if (Array.isArray(entry.passiveEffects)) refs.push(...entry.passiveEffects);
    if (Array.isArray(entry.combatEffects)) refs.push(...entry.combatEffects);
  }
  if (Array.isArray(progress?.activeEffects)) refs.push(...progress.activeEffects);
  return refs.filter((effect) => (
    effect &&
    typeof effect === "object" &&
    effect.key &&
    isEffectConditionMet(effect, effectContext)
  ));
}

function buildRewardModifiers(progress, partyRefs = []) {
  const refs = [
    ...collectRewardEffectRefs(progress),
    ...(Array.isArray(partyRefs) ? partyRefs : [])
  ];
  const tierSetBonuses = getEquipmentTierSetBonuses(progress?.equipment || {});
  const luk = Number(progress?.attributes?.luk ?? 0);
  let expPct = 0;
  let goldPct = 0;
  let dropPct = luk * 0.1;  // LUK 每點 +0.1% 掉落率
  let rareDropPct = 0;

  for (const effect of refs) {
    const value = toPct(effect?.params?.value ?? effect?.value ?? 0);
    switch (effect.key) {
      case "exp_gain_up":
        expPct += value;
        break;
      case "gold_gain_up":
        goldPct += value;
        break;
      case "drop_rate_up":
        dropPct += value;
        break;
      case "rare_drop_rate_up":
        rareDropPct += value;
        break;
      case "monster_reward_up":
        expPct += value;
        goldPct += value;
        dropPct += value;
        break;
      case "party_exp_gain_up":
        expPct += value;
        break;
      case "party_gold_gain_up":
        goldPct += value;
        break;
      default:
        break;
    }
  }

  expPct += tierSetBonuses.expPct;
  goldPct += tierSetBonuses.goldPct;
  dropPct += tierSetBonuses.dropPct;
  dropPct += getDropBoostPct(Number(progress?.pkRating ?? 0));

  // 全服 Buff（直播連動事件）：疊加到個人加成上。
  // 此處是所有戰鬥獎勵的共用 chokepoint（Discord 打怪 / 網頁 quick-battle / 世界王都經過），
  // 且回傳的 dropPct 會被 calculateFinalDropChance 使用，故金幣/經驗/掉寶一次覆蓋。
  try {
    const gb = require("../../services/stream/globalBuffService").getActiveModifiers();
    expPct += gb.expPct;
    goldPct += gb.goldPct;
    dropPct += gb.dropPct;
  } catch (_) { /* buff 服務未就緒不影響結算 */ }

  return {
    expPct,
    goldPct,
    dropPct,
    rareDropPct,
    expMultiplier: toMultiplier(expPct),
    goldMultiplier: toMultiplier(goldPct),
    dropMultiplier: toMultiplier(dropPct),
    rareDropMultiplier: toMultiplier(rareDropPct)
  };
}

function calculateFinalDropChance(baseChance, rewardMod = {}, item = null) {
  const base = Math.min(100, Math.max(0, Number(baseChance) || 0));
  if (base <= 0) return 0;

  const tier = String(item?.tier || "").toUpperCase();
  const isRare = RARE_TIERS.has(tier);
  const bonusPct = (Number(rewardMod.dropPct) || 0) + (isRare ? (Number(rewardMod.rareDropPct) || 0) : 0);
  return Math.min(100, Math.max(0, base * toMultiplier(bonusPct)));
}

function getJobNameFromEquipped(equipped = {}) {
  const jobEq = equipped?.job_eq;
  if (!jobEq) return null;
  const id = String(jobEq?.itemId || jobEq?.id || "").toLowerCase();
  const name = String(jobEq?.itemName || jobEq?.name || "").toLowerCase();
  if (id.includes("barrier_mage") || name.includes("結界")) return "結界師";
  if (id.includes("dwarf") || name.includes("矮人")) return "矮人戰士";
  if (id.includes("swordsman") || name.includes("劍士")) return "劍士";
  if (id.includes("warrior") || name.includes("戰士")) return "戰士";
  if (id.includes("archer") || name.includes("弓箭手")) return "弓箭手";
  if (id.includes("tactician") || name.includes("軍師")) return "軍師";
  if (id.includes("bard") || name.includes("詩人")) return "詩人";
  if (id.includes("healer") || name.includes("治療")) return "治療師";
  if (id.includes("mage") || name.includes("法師")) return "法師";
  if (id.includes("rogue") || name.includes("盜賊")) return "盜賊";
  return jobEq?.itemName || jobEq?.name || null;
}

function createBattleParticipantCache(sc) {
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
        const stats = calcPlayerStats(attrs, equipped, progress?.activeEffects || [], inventory, { pkRating: progress?.pkRating, petStat: require("../../shared/petDex").statBonusOf(progress?.petDex) });

        return {
          progress,
          player,
          displayName,
          equipped,
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
        if (jobId.includes("healer") || jobName.includes("治療")) {
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

function buildPartyRewardSummary(perPidRewards = {}, damageMap = {}, options = {}) {
  const limit = Math.max(1, Number(options.limit) || 12);
  const entries = Object.entries(perPidRewards)
    .filter(([, rewards]) => rewards && (rewards.gold > 0 || rewards.exp > 0 || rewards.drops?.length || rewards._expGrantFailed))
    .sort((a, b) => {
      const dmgA = Number(damageMap?.[a[0]]?.damage || 0);
      const dmgB = Number(damageMap?.[b[0]]?.damage || 0);
      return dmgB - dmgA;
    });

  if (!entries.length) return [];

  const lines = entries.slice(0, limit).map(([pid, rewards]) => {
    const name = damageMap?.[pid]?.name || pid;
    const parts = [];
    if (rewards.gold > 0) parts.push(`金幣 +${rewards.gold}`);
    if (rewards._expGrantFailed) parts.push("EXP 未寫入");
    else if (rewards.exp > 0) parts.push(`EXP +${rewards.exp}`);
    if (rewards.levelUps > 0) parts.push(`升級到 Lv.${rewards.newLevel}`);
    if (Array.isArray(rewards.drops) && rewards.drops.length > 0) {
      parts.push(`道具 ${rewards.drops.join("、")}`);
    }
    return `・${name}：${parts.join("、") || "無獎勵"}`;
  });

  if (entries.length > limit) {
    lines.push(`・其餘 ${entries.length - limit} 人略`);
  }
  return ["👥 **全體參戰獎勵**", ...lines];
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
  30: (m, n) => `🗼 恭喜 ${m} **${n}** 升上 **Lv.30**！**組隊爬塔**開放——揪隊挑戰六人攻塔！🤝`,
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

async function _announceDrops(sc, discordId, displayName, monsterName, droppedItems, droppedItemObjects = [], kind = "fight") {
  try {
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

    // （已移除）原本會把稀有卡掉落公告 🃏 發到通知頻道 1498608950671839263（town/general chat），依需求停用。
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

function pickWeightedNextMonster(monsters, currentMonsterId = null) {
  if (!Array.isArray(monsters) || monsters.length === 0) return null;
  const pool = monsters.filter((m) => m.id !== currentMonsterId || monsters.length === 1);
  if (!pool.length) return null;
  const totalWeight = pool.reduce((s, m) => s + (m.spawnRate || 10), 0);
  let r = Math.random() * Math.max(1, totalWeight);
  let selected = pool[pool.length - 1];
  for (const m of pool) {
    r -= (m.spawnRate || 10);
    if (r <= 0) {
      selected = m;
      break;
    }
  }
  return selected || null;
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
    if (!partsHp && isWorldBossZone(zoneKey) && monster?.isBoss) {
      const latest = await sc.monsterService.getState(zoneKey).catch(() => null);
      partsHp = latest?.worldBossPartsHp || null;
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
        fastUpdate: options.fastUpdate === true,
        forcePublish: options.forcePublish === true
      }
    );
  }
  return null;
}

function _scheduleZoneEventFinalize(sc, zoneKey, endsAt) {
  if (!endsAt) return;
  const dueMs = Math.max(1000, Date.parse(endsAt) - Date.now() + 300);
  const prev = zoneEventTimers.get(zoneKey);
  if (prev) clearTimeout(prev);
  const timer = setTimeout(() => {
    _resolveZoneEventIfExpired(sc, zoneKey).catch((error) => {
      console.error(`[MonsterZone] resolve event failed zone=${zoneKey}`, error);
    });
  }, dueMs);
  zoneEventTimers.set(zoneKey, timer);
}

async function _resolveZoneEventIfExpired(sc, zoneKey) {
  const state = await sc.monsterService.getState(zoneKey);
  const activeEvent = state?.activeEvent;
  if (!activeEvent) return false;

  // 如果沒有 endsAt 或解析失敗，強制清除（防止事件卡住）
  if (!activeEvent.endsAt) {
    console.warn(`[NPC Event] Event has no endsAt, forcing cleanup: ${activeEvent.name || 'unknown'}`);
    const allMonsters = await sc.monsterService.listMonsters({ includeDisabled: false, zone: zoneKey });
    if (allMonsters.length) {
      const current = allMonsters.find((m) => m.seq === state.activeMonsterSeq) || allMonsters[0];
      const nextMonster = pickWeightedNextMonster(allMonsters, current.id);
      await sc.monsterService.saveState(
        {
          ...state,
          activeMonsterSeq: nextMonster.seq,
          currentHp: nextMonster.calc.maxHp,
          participants: [],
          damageMap: {},
          killClaimedSeq: null,
          activeEvent: null,
          lastHitAt: new Date().toISOString()
        },
        zoneKey
      );
      _republishPanel(sc, zoneKey, nextMonster, nextMonster.calc.maxHp, 0, {}, null).catch(() => {});
      zoneEventTimers.delete(zoneKey);
      return true;
    }
    return false;
  }

  const endAtMs = Date.parse(activeEvent.endsAt);
  if (!Number.isFinite(endAtMs)) {
    console.error(`[NPC Event] Invalid endsAt format: ${activeEvent.endsAt}, forcing cleanup`);
    // 時間格式無效，強制清除
    await sc.monsterService.saveState({ ...state, activeEvent: null }, zoneKey);
    zoneEventTimers.delete(zoneKey);
    return true;
  }
  if (endAtMs > Date.now()) return false;

  const allMonsters = await sc.monsterService.listMonsters({ includeDisabled: false, zone: zoneKey });
  if (!allMonsters.length) return false;

  let nextMonster = allMonsters.find((m) => m.seq === Number(activeEvent.pendingMonsterSeq));
  if (!nextMonster) {
    const current = allMonsters.find((m) => m.seq === state.activeMonsterSeq) || null;
    nextMonster = pickWeightedNextMonster(allMonsters, current?.id || null);
  }
  if (!nextMonster) return false;

  const nextState = {
    ...state,
    activeMonsterSeq: nextMonster.seq,
    currentHp: nextMonster.calc.maxHp,
    participants: [],
    damageMap: {},
    killClaimedSeq: null,
    lastHitAt: new Date().toISOString(),
    activeEvent: null
  };
  await sc.monsterService.saveState(nextState, zoneKey);
  _republishPanel(sc, zoneKey, nextMonster, nextMonster.calc.maxHp, 0, {}, null).catch(() => {});
  if (nextMonster.isBoss && BOSS_SPAWN_BROADCAST_ENABLED) _broadcastBossSpawn(sc, zoneKey, nextMonster).catch(() => {});
  zoneEventTimers.delete(zoneKey);
  return true;
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
  battleStartedAt = Date.now(),
  playerAgi = 1,
  deathCooldownMult = 1
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
    // 時間管理大師：死亡延長時間 ×deathCooldownMult（例 3 倍）
    const _deathDur = (getBattleBaselineDurationMs(playerAgi ?? 1) + DEATH_EXTRA_COOLDOWN_MS) * Math.max(1, Number(deathCooldownMult) || 1);
    const availableAt = Number(battleStartedAt || Date.now()) + _deathDur;
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
      // 主線閘門：未看完該區主線 → DC 也不能刷（引導去網頁看劇情），與網頁同規則
      try {
        const storyGate = await sc.storyService?.checkZoneStoryGate(cachedProgress, zoneKey);
        if (storyGate) {
          await interaction.editReply({ content: `📖 需先到網頁版閱讀主線「${storyGate.chapterTitle}」，才能在此區域行動。` });
          return;
        }
      } catch (e) {
        console.warn("[Story] DC zone gate check failed:", e?.message || e);
      }
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

      const ensured = ensureWorldBossPartState(state, monster.calc.maxHp);
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
    const participantCache = createBattleParticipantCache(sc);
    let currentSnapshot = {
      progress,
      player: null,
      displayName,
      equipped,
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
      const ensured = ensureWorldBossPartState(battleState, battleMonster.calc.maxHp);
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
          if (startRes?.justStarted) {
            try { sc._broadcastWorldBossStart?.(battleMonster.name, displayName, discordId); } catch (_) {}
          }
          if (startRes?.justStarted && botClient?.isReady()) {
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
        const ensured = ensureWorldBossPartState(battleState, battleMonster.calc.maxHp);
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
        const hpPct = session.monsterMaxHp > 0 ? (session.monsterHp / session.monsterMaxHp) * 100 : 100;
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
          const refs = participant.refs || [];
          const pidName = resolveAuraSourceName(
            participant.displayName || (pid === discordId ? displayName : null),
            pid
          );
          const pidJobName = getJobNameFromEquipped(participant.equipped);
          for (const r of refs) {
            if (r && r.target === 'party') {
              const scaled = scaleSupportPartyEffect(r, {
                providerStats: participant.stats || {},
                jobName: pidJobName,
                equipped: participant.equipped || {}
              });
              partyEffects.push({ ...scaled, sourceName: pidName, sourceJobName: pidJobName, isSelfAura: pid === discordId });
            }
          }
        } catch (e) {}
      }));

      // ── 跨平台共通光環：本玩家若為輔助職（裝備帶 party 效果），寫入共享 activeHealerAuras 陣列
      //    （與網頁同格式），讓網頁/DC 其他玩家都吃得到；非輔助職則把自己從陣列移除。
      //    註：實際「取最高／不疊加」由 combatLoop 統一處理，這裡只負責維護提供者名單。──
      try {
        const selfRawParty = (currentSnapshot.refs || []).filter((r) => r && r.target === "party");
        const selfJobName = getJobNameFromEquipped(currentSnapshot.equipped);
        const prevAuras = Array.isArray(battleState.activeHealerAuras)
          ? battleState.activeHealerAuras
          : (battleState.activeHealerAura ? [{ ...battleState.activeHealerAura }] : []);
        let nextAuras;
        if (selfRawParty.length > 0) {
          nextAuras = [...prevAuras.filter((a) => a && a.discordId !== discordId), { discordId, displayName, effects: selfRawParty, jobName: selfJobName || null }];
        } else {
          nextAuras = prevAuras.filter((a) => a && a.discordId !== discordId);
        }
        if (JSON.stringify(nextAuras) !== JSON.stringify(prevAuras)) {
          battleState = { ...battleState, activeHealerAuras: nextAuras, activeHealerAura: null };
          await sc.monsterService.saveState(battleState, zoneKey).catch(() => {});
        }
      } catch (e) {}

      // ── 共鬥光環（跨平台）：讀 activeHealerAuras 陣列（含網頁玩家寫入的提供者），
      //    把不在本場 participants 內的提供者光環依其「當前數值」縮放後加入。
      //    是否疊加 → 否；最終由 combatLoop 對同一效果取最高。──
      const zoneAuras = Array.isArray(battleState.activeHealerAuras)
        ? battleState.activeHealerAuras
        : (battleState.activeHealerAura ? [battleState.activeHealerAura] : []);
      await Promise.all(zoneAuras.map(async (aura) => {
        try {
          if (!aura || !Array.isArray(aura.effects) || !aura.discordId) return;
          // 自己與已在場參戰者，前面 participant 迴圈已算過，避免重複收集
          if (aura.discordId === discordId || participants.includes(aura.discordId)) return;
          const provider = await participantCache.get(aura.discordId, aura.displayName || null);
          const auraJobName = aura.jobName || getJobNameFromEquipped(provider.equipped) || "輔助";
          const srcName = resolveAuraSourceName(aura.displayName || provider.displayName, aura.discordId);
          for (const r of aura.effects) {
            if (!r || r.target !== "party") continue;
            const scaled = scaleSupportPartyEffect(r, {
              providerStats: provider.stats || {},
              jobName: auraJobName,
              equipped: provider.equipped || {}
            });
            partyEffects.push({ ...scaled, sourceName: srcName, sourceJobName: auraJobName });
          }
        } catch (e) {}
      }));

      let currentProg = currentSnapshot.progress;
      // 永遠從 DB 讀取最新 effects（不使用 snapshot 裡的舊值）
      let currentEquipped = currentSnapshot.equipped;

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
      }

      const monsterHpBeforeBattle = session.monsterHp;
      // ── 怪物圖鑑：依玩家對「這隻怪」的累積擊殺,算出本場傷害加成(最高 +25%) ──
      const _bestiaryIsWorldBoss = isWorldBossZone(zoneKey);
      const _bestiaryMonsterId = String(battleMonster?.id || battleMonster?._id || session.monsterName || "");
      const _bestiaryReq = bestiaryRequirement(battleMonster, _bestiaryIsWorldBoss);
      const _bestiaryKillsBefore = Number(currentProg?.bestiary?.[_bestiaryMonsterId]) || 0;
      const _bestiaryBonusPct = bestiaryBonusPct(_bestiaryKillsBefore, _bestiaryReq);
      const { runCombatLoop } = require("../../shared/combatLoop");
      let combatResult =
        runCombatLoop(battlePlayerStats, battleMonsterStats, session.monsterName, monsterHpBeforeBattle, MAX_ROUNDS, {
          playerName: displayName,
          playerLevel: currentProg?.level || 1,
          equipped: currentEquipped,
          inventory: currentProg?.inventory || [],
          partyEffects,
          monsterEquipped: battleMonsterEquipped,
          monsterIsBoss: Boolean(battleMonster?.isBoss),
          worldBossPhase: session.worldBossPhase || null,
          bestiaryBonusPct: _bestiaryBonusPct,
          isWorldBoss: isWorldBossZone(zoneKey) && Boolean(battleMonster?.isBoss), // 世界王:玩家 DOT 也吃王 def%
          zone: zoneKey // 讓裝備的 zone 條件特效生效(例：S 龍系武器在龍族之領/龍王巢穴 +20%)
        });
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
        const updatedDamageMap = {
          ...prev,
          [discordId]: {
            name: displayName,
            level: currentProg?.level || 1,
            damage: (prev[discordId]?.damage || 0) + totalDamage,
            taken: (prev[discordId]?.taken || 0) + totalTaken,
            // 世界王貢獻寶箱：累計本王出戰花的入場費（花錢排名依據）
            spent: (prev[discordId]?.spent || 0) + (Number(session.entryFee) || 0),
          }
        };
        const latestHp = Math.max(0, Number(freshState.currentHp ?? monsterHpBeforeBattle));
        const nextHp = Math.max(0, latestHp - totalDamage);
        session.monsterHp = nextHp;
        if (nextHp <= 0) outcome = "win";
        let nextState = { ...freshState, currentHp: nextHp, damageMap: updatedDamageMap, lastHitAt: new Date().toISOString() };
        let hellfangEventDC = null; // 牙狼適應性狀態變化(給DC戰報)
        if (isWorldBossZone(zoneKey) && battleMonster?.isBoss) {
          const part = session.worldBossTargetPart || "body";
          const prevParts = ensureWorldBossPartState(freshState, battleMonster.calc.maxHp);
          const latestPartHp = Math.max(0, Number(prevParts.worldBossPartsHp?.[part] || 0));
          // 牙狼(hellfire_depths)適應性傷害：本場傷害 ×(部位弱點×適應)；其餘世界王照原樣
          let wbDamage = totalDamage;
          if (zoneKey === HELLFANG_ZONE) {
            const _hf = hellfangDamageMult(freshState, part, session.playerStats?.weaponType, Date.now());
            wbDamage = Math.max(0, Math.round(totalDamage * _hf.mult));
          }
          const nextPartHp = Math.max(0, latestPartHp - wbDamage);
          session.monsterHp = nextPartHp;
          if (nextPartHp <= 0) outcome = "win";
          const nextPartsHp = { ...prevParts.worldBossPartsHp, [part]: nextPartHp };
          nextState = {
            ...nextState,
            worldBossPartsHp: nextPartsHp,
            worldBossPartsMaxHp: prevParts.worldBossPartsMaxHp,
            currentHp: sumWorldBossPartHp(nextPartsHp)
          };
          // 牙狼：貢獻榜改用有效傷害(避免被適應的玻璃砲空刷排名)＋以原始傷害更新適應狀態
          if (zoneKey === HELLFANG_ZONE) {
            nextState.damageMap = { ...nextState.damageMap, [discordId]: { ...nextState.damageMap[discordId], damage: (prev[discordId]?.damage || 0) + wbDamage } };
            hellfangEventDC = hellfangUpdateAdaptation(nextState, hellfangPlayerSchool(session.playerStats?.weaponType), totalDamage, Date.now());
          }
          allPartsDefeated = isWorldBossAllPartsDefeated(nextPartsHp);
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
            const { getMongoDb } = require("../../adapters/mongo/createMongoClient");
            const _db = await getMongoDb();
            await _db.collection("progress").updateOne(
              { playerId: discordId },
              { $inc: { ["bestiary." + _bestiaryMonsterId]: _bGain } }
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

      if (currentProg && Array.isArray(currentProg.activeEffects) && currentProg.activeEffects.length > 0) {
        const nextActiveEffects = decrementActiveEffects(currentProg.activeEffects, "battle", 1);
        if (nextActiveEffects.length !== currentProg.activeEffects.length) {
          currentProg.activeEffects = nextActiveEffects;
          currentProg.updatedAt = new Date().toISOString();
          await sc.progressRepository.save(currentProg);
        }
      }
      try {
        await recordQuestBattleProgress(sc, discordId, outcome, totalDamage, combatStats, session.playerStats?.weaponType || null, zoneKey, currentProg?.equipment?.job_eq || null, combatResult?.damageTaken || 0, combatResult?.healDone || 0);
      } catch (e) {
        console.error("[Quest] recordProgress error:", e.message);
      }
      participantCache.clear();
      partyEffects.length = 0;
      // 時間管理大師：死亡延長時間 ×3（需在清空 equipment 前先擷取）
      const _deathCdMult = (currentProg?.equipment?.anchor?.itemId === "s-legend-timelord") ? 3 : 1;
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
      const battleStartedAtForDisplay = Number(session.battleStartedAt || displayStartedAt);
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
        battleStartedAt: battleStartedAtForDisplay,
        playerAgi: playerAgiForDisplay,
        deathCooldownMult: _deathCdMult
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
const WORLD_BOSS_CHEST_BY_MONSTER = {
  "elite-daishi-king": "chest-daishi-king",
  "dragon-king-boss": "chest-dragon-king",
  "0393acee-9851-4bcb-a8f5-fdb60a9968f1": "chest-hellfang-king", // 地獄狼牙王
};
function _resolveWorldBossChestId(monster, zoneKey) {
  return WORLD_BOSS_CHEST_BY_MONSTER[monster?.id]
    || (zoneKey === "elite" ? "chest-daishi-king"
      : zoneKey === "dragon_king_lair" ? "chest-dragon-king"
      : zoneKey === "hellfire_depths" ? "chest-hellfang-king" : null);
}
// 建一個寶箱背包項目（同款會堆疊，故 uuid 僅在「新項目」時生效）
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
// 發一個寶箱給玩家 → 回傳 { ok, uuid, stacked }（uuid 供網頁開箱用）
// 改用原子操作（$inc 疊加 / $push 新增），避免與玩家自身高頻存檔競態導致 CAS 失敗而「靜默吞箱」。
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
// 結算：傷害前3 + 花費(入場費)前3（排除已在傷害前3者，往下遞補）= 最多 6 位不同的人各得 1 箱
async function _awardWorldBossContributionChests(sc, zoneKey, monster, damageMap, perPidRewards) {
  try {
    const chestId = _resolveWorldBossChestId(monster, zoneKey);
    if (!chestId) return;
    const chestItem = await sc.itemRepository.findById(chestId).catch(() => null);
    if (!chestItem) { console.warn(`[WorldBossChest] chest item ${chestId} not found`); return; }

    const entries = Object.entries(damageMap || {}).map(([pid, d]) => ({
      pid, name: d?.name || pid, damage: Number(d?.damage) || 0, spent: Number(d?.spent) || 0,
    }));
    const dmgRank = entries.filter((e) => e.damage > 0).sort((a, b) => b.damage - a.damage).slice(0, 3);
    const dmgWinners = new Set(dmgRank.map((e) => e.pid));
    const spendRank = entries.filter((e) => e.spent > 0 && !dmgWinners.has(e.pid)).sort((a, b) => b.spent - a.spent).slice(0, 3);

    // 選人不變(傷害前3 + 花費前3遞補)，但對外只呈現「整體貢獻度前6名」單一清單
    const mark = (pid) => {
      if (perPidRewards && perPidRewards[pid]) {
        perPidRewards[pid].chestAwarded = perPidRewards[pid].chestAwarded || [];
        perPidRewards[pid].chestAwarded.push(chestItem.name);
      }
    };
    const granted = [];
    const grantedWinners = []; // { pid, name, uuid }
    const auditRows = [];      // 每位得主的發箱結果（成功/失敗）
    for (const w of [...dmgRank, ...spendRank]) {
      const r = await _grantChestToPlayer(sc, w.pid, chestItem, monster?.id);
      auditRows.push({ pid: w.pid, name: w.name, damage: w.damage, spent: w.spent, ok: !!r.ok, uuid: r.uuid || null, stacked: !!r.stacked });
      if (r.ok) {
        granted.push(w.name); grantedWinners.push({ pid: w.pid, name: w.name, uuid: r.uuid }); mark(w.pid);
      } else {
        console.error(`[WorldBossChest] grant FAILED pid=${w.pid} name=${w.name} chest=${chestItem.id}`);
      }
    }

    // 持久化發箱稽核 log（成功/失敗都記）→ 日後「沒拿到箱子」爭議可直接查 worldBossChestGrants
    try {
      const { getMongoDb } = require("../../adapters/mongo/createMongoClient");
      const db = await getMongoDb();
      await db.collection("worldBossChestGrants").insertOne({
        ts: new Date(), zoneKey, monsterId: monster?.id || null, monsterName: monster?.name || null,
        chestId: chestItem.id, chestName: chestItem.name,
        grantedCount: auditRows.filter((a) => a.ok).length,
        failedCount: auditRows.filter((a) => !a.ok).length,
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

    const rankLine = granted.map((n, i) => `${i + 1}. ${n}`).join("　");
    const lines = [
      `🎁 **${monster.name}** 討伐結算！`,
      `🏆 整體貢獻度前 ${granted.length} 名，各獲得 **${chestItem.name}**：`,
      rankLine,
    ];
    try {
      const { getBotClient } = require("../runtimeContext");
      const client = getBotClient();
      if (client?.isReady?.()) {
        const channel = await client.channels.fetch("1498608950671839263").catch(() => null);
        if (channel?.isTextBased?.()) await channel.send(lines.join("\n")).catch(() => {});
      }
    } catch (_) { /* 公告失敗不影響發箱 */ }
  } catch (e) {
    console.error("[WorldBossChest] award failed:", e?.message || e);
  }
}

// 把掉落道具物件壓成網頁版需要的精簡欄位（漂浮氣泡 + 詳細視窗用）
function toWebDrop(o) {
  if (!o) return null;
  return {
    uuid: o.uuid,
    itemId: o.itemId,
    name: o.itemName,
    image: o.imageThumbnailUrl || o.imageUrl || null,
    imageUrl: o.imageUrl || null,
    tier: o.tier || null,
    itemType: o.itemType || null,
    equipSlot: o.equipSlot || null,
    equipStats: o.equipStats || {},
    weaponType: o.weaponType || null,
    isTwoHanded: !!o.isTwoHanded,
    effect: o.itemEffect || null,
    useEffects: o.useEffects || [],
    passiveEffects: o.passiveEffects || [],
    procEffects: o.procEffects || [],
    combatEffects: o.combatEffects || [],
    monsterCardSkill: o.monsterCardSkill || null,
    // 卡片技能 + 裝備特效的中文說明列（給網頁掉落氣泡詳細視窗顯示，與背包同格式）
    effectLines: buildItemEffectLines(o),
    source: o.source || "monster_drop",
    sourceRef: o.sourceRef || null,
  };
}

async function handleMonsterKill({ discordId, displayName, session, monster, state, totalDamage = 0, zoneKey = "normal" }) {
  const sc = getServiceContext();
  const rewardLines = [];

  // 擊敗古龍王(B)（dragon_king_lair 世界王全破）→ 記錄屠龍任務進度
  // 有參與就算一隻：所有參戰者(含補刀者)各 +1，不是只記最後補刀的人
  if (zoneKey === "dragon_king_lair" && monster?.isBoss && isWorldBossAllPartsDefeated(state?.worldBossPartsHp)) {
    try {
      const qs = sc?.questService || sc?.weeklyQuestService;
      if (qs?.recordProgress) {
        // 參與者 = 對本王造成過傷害的人(damageMap) + 排隊參戰名單 + 補刀者
        const slayers = [...new Set([
          ...(state?.damageMap ? Object.keys(state.damageMap) : []),
          ...(Array.isArray(state?.participants) ? state.participants : []),
          discordId,
        ].filter(Boolean))];
        for (const pid of slayers) {
          await qs.recordProgress(pid, "kill_dragon_king", 1);
        }
      }
    } catch (e) { console.error("[Quest] kill_dragon_king record error:", e.message); }
  }

  // 擊敗大史王（elite 世界王全破）→ 記錄屠史任務進度（比照古龍王：所有參戰者各 +1）
  if (zoneKey === "elite" && monster?.isBoss && isWorldBossAllPartsDefeated(state?.worldBossPartsHp)) {
    try {
      const qs = sc?.questService || sc?.weeklyQuestService;
      if (qs?.recordProgress) {
        const slayers = [...new Set([
          ...(state?.damageMap ? Object.keys(state.damageMap) : []),
          ...(Array.isArray(state?.participants) ? state.participants : []),
          discordId,
        ].filter(Boolean))];
        for (const pid of slayers) {
          await qs.recordProgress(pid, "kill_slime_king", 1);
        }
      }
    } catch (e) { console.error("[Quest] kill_slime_king record error:", e.message); }
  }

  // 擊敗地獄狼牙王（hellfire_depths 世界王全破）→ 記錄屠狼任務進度（比照古龍王：所有參戰者各 +1）
  if (zoneKey === "hellfire_depths" && monster?.isBoss && isWorldBossAllPartsDefeated(state?.worldBossPartsHp)) {
    try {
      const qs = sc?.questService || sc?.weeklyQuestService;
      if (qs?.recordProgress) {
        const slayers = [...new Set([
          ...(state?.damageMap ? Object.keys(state.damageMap) : []),
          ...(Array.isArray(state?.participants) ? state.participants : []),
          discordId,
        ].filter(Boolean))];
        for (const pid of slayers) {
          await qs.recordProgress(pid, "kill_hellfang_king", 1);
        }
      }
    } catch (e) { console.error("[Quest] kill_hellfang_king record error:", e.message); }
  }

  if (isWorldBossZone(zoneKey) && monster?.isBoss && !isWorldBossAllPartsDefeated(state?.worldBossPartsHp)) {
    rewardLines.push("目前僅擊破單一部位，世界王需所有部位全破才會結算。");
    return rewardLines;
  }

  // ── 並發雙殺防護：同一隻怪只允許一次結算 ──
  const killKey = `${zoneKey}:${monster.seq}`;
  try {
    if (killInProgress.has(killKey)) {
      // 另一位玩家已在結算中，此次擊殺視為無效，不重複發獎
      return rewardLines;
    }
    killInProgress.add(killKey);
  } catch (e) {
    return rewardLines;
  }

  try {
  // DB 層原子收付擊殺權（防止 PM2 雙進程重載期間雙重結算）
  const claimed = await sc.monsterRepository.claimKill(zoneKey, monster.seq);
  if (!claimed) {
    return rewardLines;
  }

  // 參戰名單（含本次打到尾段的玩家）
  const participants = [...new Set([...(Array.isArray(state.participants) ? state.participants : []), discordId])];

  // 世界王解鎖累計：原 hard 區拆成古城/古城深處，兩區擊殺都算
  if ((zoneKey === "ancient_city" || zoneKey === "ancient_city_deep") && !monster?.isBoss && sc.worldBossServiceFor(zoneKey)) {
    await sc.worldBossServiceFor(zoneKey).recordHardZoneKill(1).catch(() => {});
  }

  // 任務勝利判定：怪物被擊殺時，全參戰者都算 1 次勝利。
  // 這裡統一寫入，確保 Discord/Web 兩條戰鬥流程規則一致。
  try {
    const questService = sc.questService || sc.weeklyQuestService;
    if (questService && typeof questService.recordProgress === "function") {
      await Promise.allSettled(
        participants.map((pid) => questService.recordProgress(pid, "battle_win", 1))
      );
    }
  } catch (_) {
    // ignore quest write failures; reward settlement must continue
  }

  // ── 依傷害比例計算每人分配量 ──
  const rawDmgMap = state.damageMap || {};
  // 合入本次尾段傷害
  const mergedDmg = { ...rawDmgMap, [discordId]: { name: displayName, damage: (rawDmgMap[discordId]?.damage || 0) + totalDamage } };
  const battleHpBasis = Math.max(1, Number(monster?.calc?.maxHp || session.monsterMaxHp || 1));
  const dmgRatio = (pid) => Math.min(1, Math.max(0, (mergedDmg[pid]?.damage || 0) / battleHpBasis));

  // ── 不使用怪物等級做獎勵壓制 ──

  // 每位參戰者的獎勵紀錄（用來最後 DM 通知）
  const perPidRewards = {};
  participants.forEach(pid => { perPidRewards[pid] = { gold: 0, exp: 0, levelUps: 0, newLevel: 0, drops: [], healerGoldBonus: 0, healerExpBonus: 0, isHealer: false }; });
  // 圖鑑：本次出手者(discordId)的「本場累積%」掛到他的獎勵紀錄,擊殺 DM 會顯示
  if (session && session._bestiary && perPidRewards[discordId]) {
    perPidRewards[discordId].bestiary = session._bestiary;
  }
  const canSendRewardNotice = (pid) => !perPidRewards[pid]?._expGrantFailed;

  // 預載參戰者資料，用於個人化結算倍率（金幣 / EXP / 掉落）
  const progressCache = {};
  await Promise.all(participants.map(async (pid) => {
    const prog = await sc.progressRepository.findByPlayerId(pid).catch(() => null);
    if (prog) progressCache[pid] = prog;
  }));
  await Promise.all(participants.map(async (pid) => {
    const prog = progressCache[pid];
    if (prog) {
      // 永遠從 DB 讀取最新 effects，確保光環與獎勵加成使用最新設計值
      prog.equipment = await mergeEquippedFromLibrary(prog.equipment || {}, sc.itemRepository);
    }
  }));
  const rewardModsByPid = {};
  const partyRewardEffects = [];
  for (const pid of participants) {
    const prog = progressCache[pid];
    if (!prog) continue;
    for (const effect of collectRewardEffectRefs(prog)) {
      if (effect?.target === "party") partyRewardEffects.push({ ...effect, sourcePlayerId: pid });
    }
  }
  const activeAura = state?.activeHealerAura;
  if (activeAura?.effects && !participants.includes(activeAura.discordId)) {
    for (const effect of activeAura.effects) {
      if (effect?.target === "party") partyRewardEffects.push({ ...effect, sourcePlayerId: activeAura.discordId });
    }
  }
  await Promise.all(participants.map(async (pid) => {
    const prog = progressCache[pid];
    rewardModsByPid[pid] = buildRewardModifiers(prog, partyRewardEffects);
  }));

  // ── 光環職業（治療師/軍師/詩人/結界師）本人結算時額外 +10% 金幣、EXP、掉落率 +5% ──
  const AURA_JOB_IDS = ["healer", "tactician", "bard", "barrier_mage"];
  const AURA_JOB_NAMES = ["治療", "軍師", "詩人", "結界"];
  const healerBonusPids = new Set();
  for (const pid of participants) {
    const prog = progressCache[pid];
    if (!prog) continue;
    const jobEq = prog.equipment?.job_eq;
    if (!jobEq) continue;
    const jobId = String(jobEq.itemId || jobEq.id || "").toLowerCase();
    const jobName = String(jobEq.itemName || jobEq.name || "").toLowerCase();
    const isAuraJob = AURA_JOB_IDS.some(k => jobId.includes(k)) || AURA_JOB_NAMES.some(k => jobName.includes(k));
    if (isAuraJob) {
      healerBonusPids.add(pid);
      if (perPidRewards[pid]) perPidRewards[pid].isHealer = true;
      const mod = rewardModsByPid[pid];
      mod.goldPct    = (mod.goldPct    || 0) + 10;
      mod.expPct     = (mod.expPct     || 0) + 10;
      mod.dropPct    = (mod.dropPct    || 0) + 5;
      mod.goldMultiplier = toMultiplier(mod.goldPct);
      mod.expMultiplier  = toMultiplier(mod.expPct);
      mod.dropMultiplier = toMultiplier(mod.dropPct);
    }
  }

  // ── 耕作疲勞：一般區域連續打怪滿6h → 該玩家經驗/金幣 ×0.2（世界王不算）。每位參戰者各自算。
  const _isWorldBossKill = isWorldBossZone(zoneKey) && Boolean(monster?.isBoss);
  const fatigueMultByPid = {};
  if (!_isWorldBossKill) {
    const farmFatigue = require("../../services/farmFatigue/farmFatigueService");
    const _now = Date.now();
    for (const pid of participants) {
      fatigueMultByPid[pid] = await farmFatigue.applyAndGetMultiplier(pid, _now).catch(() => 1);
    }
  }
  const fatMul = (pid) => fatigueMultByPid[pid] ?? 1;
  if (fatMul(discordId) < 1) rewardLines.push("🥱 連續耕作已滿 6 小時，經驗/金幣暫時 −80%（停打一般區域 30 分鐘即恢復）");

  // ── 金幣依比例分配 ──
  // 依玩家各自對「怪物完整血量」的傷害比例結算
  const dynamicGoldPool = getDynamicGoldPoolFloor(zoneKey, participants.length);
  const effectiveGoldReward = Math.max(monster.goldReward || 0, dynamicGoldPool);

  let myBaseGoldShare = 0;
  if (effectiveGoldReward > 0) {
    for (const pid of participants) {
      const baseShare = Math.max(1, Math.round(effectiveGoldReward * dmgRatio(pid)));
      const mod = rewardModsByPid[pid] || { goldMultiplier: 1 };
      const share = Math.max(1, Math.round(baseShare * mod.goldMultiplier * fatMul(pid)));
      try {
        await sc.rewardService.grantCurrency({
          discordId: pid, displayName: pid === discordId ? displayName : pid,
          currencyType: "gold", amount: share,
          source: CURRENCY_SOURCES.MONSTER_KILL_REWARD, operator: "monster_zone",
          // 不可用以 monster.seq 為基礎的 sourceRef：seq 會隨怪物輪替重複出現，
          // 重複擊殺同一隻怪會被誤判為重複交易而「不發金幣」。
          // 一次性結算已由 claimKill(DB 原子) + killInProgress 保證，無需 sourceRef。
        });
        if (perPidRewards[pid]) perPidRewards[pid].gold = share;
      } catch (e) {
        console.error(`[MonsterZone] grantCurrency(gold) failed for ${pid}`, e);
        if (perPidRewards[pid]) perPidRewards[pid]._goldGrantFailed = true;
      }
    }

    const myBaseShare = Math.max(1, Math.round(effectiveGoldReward * dmgRatio(discordId)));
    myBaseGoldShare = myBaseShare;
    const myMod = rewardModsByPid[discordId] || { goldMultiplier: 1, goldPct: 0 };
    const myShare = Math.max(1, Math.round(myBaseShare * myMod.goldMultiplier * fatMul(discordId)));
    const pct = `${Math.round(dmgRatio(discordId) * 100)}%`;
    const poolNote = dynamicGoldPool > (monster.goldReward || 0) ? `（動態金幣池）` : "";
    const modNote = myMod.goldPct > 0 ? `，個人加成 +${Math.round(myMod.goldPct)}%` : "";
    rewardLines.push(`你造成了 **${totalDamage}** 點傷害。`);
    rewardLines.push(`💰 金幣 +${myShare}（傷害佔比 ${pct}，共 ${effectiveGoldReward}${poolNote}${modNote}）`);
  }

  // ── EXP 依比例分配（含組隊倍率）──
  // 組隊倍率：人多共鬥獎勵更多，封頂 ×3.5
  // 組隊倍率公式：1~2人=×1.0，3人起平滑無上限增加
  // mult = 1 + (n-2)^0.7 × 0.6，人越多總池越大但每人平均遞減，不會爆量
  const n = participants.length;
  const partyMult = n <= 2 ? 1.0 : +(1 + Math.pow(n - 2, 0.7) * 0.6).toFixed(2);
  const effectiveExpReward = Math.round(monster.expReward * partyMult);

  let myBaseExpShare = 0;
  if (effectiveExpReward > 0) {
    const myBaseShare = Math.max(1, Math.round(effectiveExpReward * dmgRatio(discordId)));
    myBaseExpShare = myBaseShare;
    const myMod = rewardModsByPid[discordId] || { expMultiplier: 1, expPct: 0 };
    const myShare = Math.max(1, Math.round(myBaseShare * myMod.expMultiplier * fatMul(discordId)));
    let killerLvLine = "";
    let killerOverflowGold = 0; // 滿等溢出經驗轉的金幣（給戰報顯示）
    for (const pid of participants) {
      const baseShare = Math.max(1, Math.round(effectiveExpReward * dmgRatio(pid)));
      const mod = rewardModsByPid[pid] || { expMultiplier: 1 };
      const share = Math.max(1, Math.round(baseShare * mod.expMultiplier * fatMul(pid)));
      try {
        const expResult = await sc.progressService.grantExp({
          discordId: pid, displayName: pid === discordId ? displayName : pid,
          amount: share, source: EXP_SOURCES.MONSTER_KILL
        });
        if (perPidRewards[pid]) {
          perPidRewards[pid].exp = share;
          perPidRewards[pid].overflowGold = Number(expResult.overflowGold) || 0; // 滿等溢出→金幣(給網頁戰報)
          if (expResult.levelUps > 0) {
            perPidRewards[pid].levelUps = expResult.levelUps;
            perPidRewards[pid].newLevel = expResult.progress?.level ?? 0;
            perPidRewards[pid].levelUpDetails = expResult.levelUpDetails || [];
          }
        }
        if (pid === discordId) killerOverflowGold = Number(expResult.overflowGold) || 0;
        if (expResult.levelUps > 0) {
          const prevLevel = (expResult.progress?.level ?? 0) - expResult.levelUps;
          const pidName = pid === discordId ? displayName : (mergedDmg[pid]?.name || pid);
          _announceLevelMilestone(sc, pid, pidName, prevLevel, expResult.progress.level).catch(() => {});
        }
        if (pid === discordId && expResult.levelUps > 0) {
          const detailText = Array.isArray(expResult.levelUpDetails) && expResult.levelUpDetails.length
            ? expResult.levelUpDetails.map((lv) => `Lv.${lv.level}：${Array.isArray(lv.attrsZh) ? lv.attrsZh.join("、") : ""}`).join("；")
            : "";
          killerLvLine = detailText
            ? ` ✨ 升級 ${expResult.levelUps} 次！Lv.${expResult.progress.level}\n   ${detailText}`
            : ` ✨ 升級 ${expResult.levelUps} 次！Lv.${expResult.progress.level}`;
        }
      } catch (e) {
        console.error(`[MonsterZone] grantExp failed for ${pid}`, e?.message || e);
        // 記錄失敗原因，幫助診斷 DM 通知與實際經驗值不符的問題
        if (!perPidRewards[pid]) perPidRewards[pid] = { gold: 0, exp: 0, levelUps: 0, newLevel: 0, drops: [] };
        perPidRewards[pid]._expGrantFailed = true;
      }
    }

    const pct = `${Math.round(dmgRatio(discordId) * 100)}%`;
    const partyNote = partyMult > 1 ? `　👥 ×${partyMult}（${participants.length}人）` : "";
    const modNote = myMod.expPct > 0 ? `，個人加成 +${Math.round(myMod.expPct)}%` : "";
    if (canSendRewardNotice(discordId)) {
      rewardLines.push(`⭐ EXP +${myShare}（傷害佔比 ${pct}，共 ${effectiveExpReward}${partyMult > 1 ? ` 原${monster.expReward}` : ""}${modNote}）${partyNote}${killerLvLine}`);
      if (killerOverflowGold > 0) {
        rewardLines.push(`💰 已滿等，溢出經驗轉為 ${killerOverflowGold} 金幣`);
      }
    } else {
      console.warn(`[MonsterZone] skip EXP line for ${discordId} because EXP was not committed`);
    }
  }

  // ── 治療師徽章結算特別顯示 + 專屬 DM ──
  // 用實際已發出的 gold/exp 反推加成數值（10% / 1.1 = 原始base × 0.1）
  for (const hpid of healerBonusPids) {
    const r = perPidRewards[hpid];
    if (!r) continue;
    // 實際發出的是 base * 1.1，所以加成 = 實際發出 / 1.1 * 0.1 = 實際發出 / 11
    r.healerGoldBonus = r.gold > 0 ? Math.max(1, Math.round(r.gold / 11)) : 0;
    r.healerExpBonus  = r.exp  > 0 ? Math.max(1, Math.round(r.exp  / 11)) : 0;

    // 治療師專屬 DM（在這裡直接發，gold/exp 值都已確定）
    const parts = [];
    if (r.healerGoldBonus > 0) parts.push(`+${r.healerGoldBonus} 金幣`);
    if (r.healerExpBonus  > 0) parts.push(`+${r.healerExpBonus} EXP`);
    if (parts.length > 0) {
      try {
        const { getBotClient } = require("../runtimeContext");
        const client = getBotClient();
        if (client?.isReady()) {
          const user = await client.users.fetch(hpid);
          await user.send(`💚 **治療師加成**（${monster.name}）：${parts.join("、")}`);
        }
      } catch (_) {}
    }
  }
  if (healerBonusPids.has(discordId)) {
    const r = perPidRewards[discordId];
    const parts = [];
    if (r?.healerGoldBonus > 0) parts.push(`+${r.healerGoldBonus} 金幣`);
    if (r?.healerExpBonus  > 0) parts.push(`+${r.healerExpBonus} EXP`);
    if (parts.length > 0) {
      rewardLines.push(`💚 **治療師加成**：${parts.join("、")}`);
    }
  }

  const monsterDropPool = await buildMonsterDropPool(sc, monster);

  // ── 道具掉落：從所有參戰者中抽一人，再骰各道具掉落率 ──
  // 規則：1. 從 participants 隨機抽出一位幸運者
  //        2. 幸運者對每個掉落項目各自骰 chance%
  //        3. 骰中的道具進入幸運者背包
  if (monsterDropPool.length > 0 && participants.length > 0) {
    // 抽幸運者
    const luckyIdx = Math.floor(Math.random() * participants.length);
    const luckyPid = participants[luckyIdx];
    const luckyMod = rewardModsByPid[luckyPid] || { dropMultiplier: 1, rareDropMultiplier: 1 };

    if (luckyPid) {
      const droppedItems = [];
      const droppedItemObjects = [];

      for (const drop of monsterDropPool) {
        let item = await sc.itemRepository.findById(drop.itemId).catch(() => null);
        if (item) {
          const finalChance = calculateFinalDropChance(drop.chance, luckyMod, item);
          if (Math.random() * 100 < finalChance) {
            const equipStats = item.equipStats ? { ...item.equipStats } : {};
            droppedItems.push(item.name);
            const droppedEntry = {
              uuid: crypto.randomUUID(), itemId: item.id, itemName: item.name,
              itemEffect: item.effect || { type: "none", value: 0 },
              useEffects: item.useEffects || [],
              passiveEffects: item.passiveEffects || [],
              procEffects: item.procEffects || [],
              combatEffects: item.combatEffects || [],
              itemType: item.itemType || "consumable",
              imageUrl: item.imageUrl || null, imageThumbnailUrl: item.imageThumbnailUrl || null,
              equipSlot: item.equipSlot || null, equipStats,
              weaponType: item.weaponType || null, isTwoHanded: item.isTwoHanded || false,
              atkStat: item.atkStat || null, tier: item.tier || null, monsterCardSkill: item.monsterCardSkill || null,
              enhanceLevel: 0, source: "monster_drop", sourceRef: monster.name,
              purchasedAt: new Date().toISOString()
            };
            // 獲得瞬間骰附魔（只骰一次，寫進 droppedItemObjects 後續 retry 不會重骰）
            try { require("../../services/enchant/enchantService").rollForEntry(droppedEntry); } catch (_) { /* noop */ }
            droppedItemObjects.push(droppedEntry);
          }
        }
      }

      if (droppedItems.length > 0) {
        // 背包容量：裝備滿了就不再撿多出來的裝備（素材/寶石/蛋照收），依會員等級決定上限
        let equipCap = Infinity;
        try { equipCap = (await require("../../services/backpack/backpackService").resolveEffectiveCapacity(luckyPid)).cap; } catch (_) { /* 解析失敗不擋 */ }
        const skippedByFullBag = [];
        let savedDrop = false;
        for (let attempt = 0; attempt < 3 && !savedDrop; attempt++) {
          const latestLuckyProg = await sc.progressRepository.findByPlayerId(luckyPid);
          if (!latestLuckyProg) break;

          const nextLuckyProg = {
            ...latestLuckyProg,
            inventory: Array.isArray(latestLuckyProg.inventory)
              ? latestLuckyProg.inventory.map((entry) => ({ ...entry }))
              : []
          };
          // 依容量過濾：只有「主要穿戴裝備」佔格、超上限就跳過；卡片/錨點/徽章/稱號、素材/寶石/蛋不受限
          const countsCap = require("../../services/backpack/backpackService").countsTowardCapacity;
          let room = Math.max(0, equipCap - nextLuckyProg.inventory.filter(countsCap).length);
          const toAdd = [];
          for (const entry of droppedItemObjects) {
            if (countsCap(entry)) {
              if (room > 0) { toAdd.push(entry); room -= 1; }
              else if (attempt === 0) skippedByFullBag.push(entry.itemName);
            } else {
              toAdd.push(entry); // 卡片/收藏/素材照收，不佔容量
            }
          }
          nextLuckyProg.inventory.push(...toAdd.map((entry) => ({ ...entry })));
          nextLuckyProg.updatedAt = new Date().toISOString();

          if (typeof sc.progressRepository.saveIfUnchanged === "function") {
            savedDrop = await sc.progressRepository.saveIfUnchanged(nextLuckyProg, latestLuckyProg.updatedAt);
          } else if (typeof sc.progressRepository.save === "function") {
            await sc.progressRepository.save(nextLuckyProg);
            savedDrop = true;
          }

          if (!savedDrop && attempt < 2) {
            await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
          }
        }

        if (savedDrop) {
          const allDropped = [...droppedItems];
          const allDroppedObjects = [...droppedItemObjects];
          if (perPidRewards[luckyPid]) perPidRewards[luckyPid].drops = [...allDropped];
          const luckyName = luckyPid === discordId ? displayName : (mergedDmg[luckyPid]?.name || luckyPid);
          const isKiller = luckyPid === discordId;
          if (canSendRewardNotice(luckyPid)) {
            if (isKiller) {
              rewardLines.push(`🎁 道具掉落：${allDropped.join("、")}`);
              if (skippedByFullBag.length > 0) {
                rewardLines.push(`⚠️ 背包已滿，未拾取裝備：${skippedByFullBag.join("、")}（整理背包或升級會員可擴充上限）`);
              }
              // 結構化掉落（給網頁版漂浮道具氣泡 + 詳細視窗用）
              rewardLines._drops = [...(rewardLines._drops || []), ...allDroppedObjects.map(toWebDrop)];
              _announceDrops(sc, luckyPid, luckyName, monster.name, allDropped, allDroppedObjects, "kill").catch(() => {});
            } else {
              _announceDrops(sc, luckyPid, luckyName, monster.name, allDropped, allDroppedObjects, "group").catch(() => {});
            }
          } else {
            console.warn(`[MonsterZone] skip drop DM for ${luckyPid} because EXP was not committed`);
          }
        } else {
          console.warn(`[MonsterZone] drop save failed for ${luckyPid}, item drop announcement skipped to avoid stale overwrite`);
        }
      }
    }

    // 人數加碼掉落：10/15/20 人各額外抽一位，台詞不同
    const BONUS_MILESTONES = [
      { threshold: 10, kind: "bonus_10" },
      { threshold: 15, kind: "bonus_15" },
      { threshold: 20, kind: "bonus_20" },
    ];
    const usedBonusPids = new Set([luckyPid]);
    for (const { threshold, kind } of BONUS_MILESTONES) {
      if (participants.length < threshold) break;
      const bonusPool = participants.filter(pid => !usedBonusPids.has(pid));
      const bonusPid = bonusPool.length > 0
        ? bonusPool[Math.floor(Math.random() * bonusPool.length)]
        : [...usedBonusPids][0];
      usedBonusPids.add(bonusPid);
      const bonusProg = progressCache[bonusPid];
      const bonusMod = rewardModsByPid[bonusPid] || { dropMultiplier: 1, rareDropMultiplier: 1 };
      if (!bonusProg) continue;
      if (!Array.isArray(bonusProg.inventory)) bonusProg.inventory = [];
      const bonusItems = [];
      const bonusItemObjects = [];
      for (const drop of monsterDropPool) {
        let item = await sc.itemRepository.findById(drop.itemId).catch(() => null);
        if (item) {
          const finalChance = calculateFinalDropChance(drop.chance, bonusMod, item);
          if (Math.random() * 100 < finalChance) {
            {
              const equipStats = item.equipStats ? { ...item.equipStats } : {};
              const dropEntry = {
                uuid: crypto.randomUUID(),
                itemId: item.id,
                itemName: item.name,
                itemEffect: item.effect || { type: "none", value: 0 },
                useEffects: item.useEffects || [],
                passiveEffects: item.passiveEffects || [],
                procEffects: item.procEffects || [],
                combatEffects: item.combatEffects || [],
                itemType: item.itemType || "consumable",
                imageUrl: item.imageUrl || null,
                imageThumbnailUrl: item.imageThumbnailUrl || null,
                equipSlot: item.equipSlot || null,
                equipStats,
                weaponType: item.weaponType || null,
                isTwoHanded: item.isTwoHanded || false,
                atkStat: item.atkStat || null,
                tier: item.tier || null,
                monsterCardSkill: item.monsterCardSkill || null,
                enhanceLevel: 0,
                source: "monster_drop_bonus",
                sourceRef: monster.name,
                purchasedAt: new Date().toISOString()
              };

              bonusProg.inventory.push({ ...dropEntry });
              bonusItems.push(item.name);
              bonusItemObjects.push(dropEntry);
            }
          }
        }
      }
      if (bonusItems.length > 0) {
        let savedBonus = false;
        for (let attempt = 0; attempt < 3 && !savedBonus; attempt++) {
          const latestBonusProg = await sc.progressRepository.findByPlayerId(bonusPid);
          if (!latestBonusProg) break;
          const nextBonusProg = {
            ...latestBonusProg,
            inventory: Array.isArray(latestBonusProg.inventory)
              ? latestBonusProg.inventory.map((entry) => ({ ...entry }))
              : []
          };
          nextBonusProg.inventory.push(...bonusItemObjects.map((entry) => ({ ...entry })));
          nextBonusProg.updatedAt = new Date().toISOString();

          if (typeof sc.progressRepository.saveIfUnchanged === "function") {
            savedBonus = await sc.progressRepository.saveIfUnchanged(nextBonusProg, latestBonusProg.updatedAt);
          } else if (typeof sc.progressRepository.save === "function") {
            await sc.progressRepository.save(nextBonusProg);
            savedBonus = true;
          }

          if (!savedBonus && attempt < 2) {
            await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
          }
        }
        if (!savedBonus) continue;
        const allBonusDropped = [...bonusItems];
        const allBonusDroppedObjects = [...bonusItemObjects];
        if (perPidRewards[bonusPid]) perPidRewards[bonusPid].drops = [...(perPidRewards[bonusPid].drops || []), ...allBonusDropped];
        const bonusName = bonusPid === discordId ? displayName : (mergedDmg[bonusPid]?.name || bonusPid);
        if (canSendRewardNotice(bonusPid)) {
          _announceDrops(sc, bonusPid, bonusName, monster.name, allBonusDropped, allBonusDroppedObjects, kind).catch(() => {});
        } else {
          console.warn(`[MonsterZone] skip bonus drop DM for ${bonusPid} because EXP was not committed`);
        }
      }
    }
  }

  // ── 參與獎勵：每位參戰者有機率獲得該區域強化石（DM 通知）──
  {
    const participationGemTiers = getParticipationGemTiers(zoneKey, monster);
    const participationGemConfigs = participationGemTiers
      .map((gemTier) => {
        const participationGemId = ENHANCE_GEM_IDS[gemTier];
        return participationGemId ? { gemTier, participationGemId } : null;
      })
      .filter(Boolean);

    if (participationGemConfigs.length > 0) {
      const participationGemItems = [];
      for (const cfg of participationGemConfigs) {
        const gemItem = await sc.itemRepository.findById(cfg.participationGemId).catch(() => null);
        if (!gemItem) continue;
        participationGemItems.push({
          tier: cfg.gemTier,
          item: gemItem,
          participationRate: GEM_PARTICIPATION_RATE[cfg.gemTier] ?? 0.05,
          doubleDropRate: GEM_PARTICIPATION_DOUBLE_DROP_RATE[cfg.gemTier] ?? 0
        });
      }

      for (const pid of participants) {
        const triggeredGemDrops = [];
        const pidDropPct = rewardModsByPid[pid]?.dropPct ?? 0;
        for (const cfg of participationGemItems) {
          const effectiveRate = Math.min(1, cfg.participationRate + pidDropPct / 100);
          if (Math.random() >= effectiveRate) continue;
          const dropCount = Math.random() < cfg.doubleDropRate ? 2 : 1;
          for (let i = 0; i < dropCount; i++) {
            triggeredGemDrops.push(cfg.item);
          }
        }
        if (triggeredGemDrops.length === 0) continue;

        let savedGem = false;
        for (let attempt = 0; attempt < 3 && !savedGem; attempt++) {
          const latestProg = await sc.progressRepository.findByPlayerId(pid);
          if (!latestProg) break;
          const nextProg = {
            ...latestProg,
            inventory: Array.isArray(latestProg.inventory)
              ? latestProg.inventory.map((entry) => ({ ...entry }))
              : []
          };
          for (const gemItem of triggeredGemDrops) {
            if (tryStackGem(nextProg, gemItem.id)) continue;
            nextProg.inventory.push({
              uuid: crypto.randomUUID(), itemId: gemItem.id, itemName: gemItem.name,
              itemEffect: gemItem.effect || { type: "none", value: 0 },
              useEffects: gemItem.useEffects || [],
              passiveEffects: gemItem.passiveEffects || [],
              procEffects: gemItem.procEffects || [],
              combatEffects: gemItem.combatEffects || [],
              itemType: gemItem.itemType || "consumable",
              imageUrl: gemItem.imageUrl || null, imageThumbnailUrl: gemItem.imageThumbnailUrl || null,
              equipSlot: gemItem.equipSlot || null, equipStats: gemItem.equipStats || null,
              weaponType: gemItem.weaponType || null, isTwoHanded: gemItem.isTwoHanded || false,
              atkStat: gemItem.atkStat || null, tier: gemItem.tier || null, enhanceLevel: 0,
              stackCount: 1,
              source: "monster_participation_gem", sourceRef: monster.name,
              purchasedAt: new Date().toISOString()
            });
          }
          nextProg.updatedAt = new Date().toISOString();
          if (typeof sc.progressRepository.saveIfUnchanged === "function") {
            savedGem = await sc.progressRepository.saveIfUnchanged(nextProg, latestProg.updatedAt);
          } else if (typeof sc.progressRepository.save === "function") {
            await sc.progressRepository.save(nextProg);
            savedGem = true;
          }
          if (!savedGem && attempt < 2) {
            await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
          }
        }
        if (!savedGem) continue;
        if (perPidRewards[pid]) {
          perPidRewards[pid].drops = [...(perPidRewards[pid].drops || []), ...triggeredGemDrops.map((gemItem) => gemItem.name)];
        }
      }
    }
  }

  // 擊殺數 + 推進下一隻怪物
  const newKillCount = { ...(state.killCount || {}), [monster.id]: ((state.killCount?.[monster.id] || 0) + 1) };
  // 取最新 state 以免多人並發時覆蓋其他人的 damageMap
  const freshState = await sc.monsterService.getState(zoneKey);
  const finalDamageMap = { ...(freshState.damageMap || {}), ...mergedDmg };

  // 世界 BOSS（精英區）擊殺後：同一隻進入冷卻，不切下一隻
  if (isWorldBossZone(zoneKey) && monster?.isBoss && sc.worldBossServiceFor(zoneKey)) {
    const resetParts = ensureWorldBossPartState({}, monster.calc.maxHp, zoneKey);
    const wbConfig = await sc.worldBossServiceFor(zoneKey).getConfig().catch(() => null);
    const bossLockMs = Math.max(1, Number(wbConfig?.respawnCooldownMinutes || 60)) * 60 * 1000;
    const bossLockUntil = new Date(Date.now() + bossLockMs + 15 * 1000);
    const bossResetState = {
      ...freshState,
      currentHp: resetParts.currentHp,
      worldBossPartsHp: resetParts.worldBossPartsHp,
      worldBossPartsMaxHp: resetParts.worldBossPartsMaxHp,
      activeMonsterSeq: monster.seq,
      killCount: newKillCount,
      participants: [],
      damageMap: {},
      killClaimedSeq: monster.seq,
      killClaimedAt: bossLockUntil,
      killClaimedBy: "elite-boss-cooldown",
      activeHealerAura: null,
      activeEvent: null
    };
    await sc.monsterService.saveState(bossResetState, zoneKey);
    await sc.worldBossServiceFor(zoneKey).markBossKilled().catch(() => {});
    const clearedQueued = clearQueuedEliteWorldBossSessions();
    if (clearedQueued > 0) {
      console.log(`[WorldBoss] cleared queued elite sessions after kill: ${clearedQueued}`);
    }
    const timeoutTimer = worldBossTimeoutTimers.get(zoneKey);
    if (timeoutTimer) {
      clearTimeout(timeoutTimer);
      worldBossTimeoutTimers.delete(zoneKey);
    }
    _republishPanel(sc, zoneKey, monster, bossResetState.currentHp, 0, {}, null, bossResetState.worldBossPartsHp).catch(() => {});

    // 世界王貢獻寶箱：傷害前3 + 入場費花費前3（遞補）= 最多 6 人各得 1 箱
    await _awardWorldBossContributionChests(sc, zoneKey, monster, freshState.damageMap, perPidRewards);

    rewardLines.push(...buildPartyRewardSummary(perPidRewards, mergedDmg));
    _notifyKillRewards(monster.name, perPidRewards).catch((e) => console.error("[NotifyKill] top-level error:", e?.message || e));

    try {
      const pushReward = sc._pushRewardToPlayer;
      if (typeof pushReward === "function") {
        for (const [pid, rewards] of Object.entries(perPidRewards)) {
          if (!rewards.gold && !rewards.exp && !rewards.drops?.length) continue;
          pushReward(pid, {
            monsterName: monster.name,
            gold: rewards.gold,
            exp: rewards.exp,
            levelUps: rewards.levelUps,
            newLevel: rewards.newLevel,
            drops: rewards.drops
          });
        }
      }
    } catch (_) {}

    const myReward = perPidRewards[discordId] || { gold: 0, exp: 0, levelUps: 0, newLevel: 0, drops: [] };
    rewardLines._summary = {
      gold: myReward.gold,
      exp: myReward.exp,
      levelUps: myReward.levelUps,
      newLevel: myReward.newLevel,
      drops: myReward.drops
    };
    return rewardLines;
  }

  const allMonsters = await sc.monsterService.listMonsters({ includeDisabled: false, zone: zoneKey });
  const nextMonster = pickWeightedNextMonster(allMonsters, monster.id);
  const npcMappingsSource = Array.isArray(freshState.npcMappings) ? freshState.npcMappings : [];
  const allEvents = npcMappingsSource.length
    ? await sc.monsterEventService.listEvents({ zone: zoneKey, includeDisabled: true }).catch(() => [])
    : [];
  const mappingPool = [];
  for (const [index, mp] of npcMappingsSource.entries()) {
    if (mp.triggerMonsterSeq != null && Number(mp.triggerMonsterSeq) !== Number(monster.seq)) continue;
    const tpl = allEvents.find((e) => e.id === mp.eventId) || null;
    if (!tpl) continue;
    mappingPool.push({
      id: mp.eventId || null,
      chance: Number(mp.chance) || 0,
      order: Number.isFinite(Number(mp.order)) ? Number(mp.order) : index,
      triggerMonsterSeq: mp.triggerMonsterSeq == null ? null : Number(mp.triggerMonsterSeq),
      template: tpl
    });
  }

  if (mappingPool.length > 0) {
    const sortedNpcPool = mappingPool.sort((a, b) => a.order - b.order);
    const lastChosen = zoneLastChosen.get(zoneKey) || null;
    let monsterPool = allMonsters.filter((m) => m.id !== monster.id || allMonsters.length === 1);
    let eventPool = sortedNpcPool;
    const monsterWeights = monsterPool.map((m) => Number(m.spawnRate) || 10);
    if (lastChosen) {
      const lastType = lastChosen.type;
      const lastId = lastChosen.id;
      const filteredMonsterPool = monsterPool.filter((m) => !(lastType === "monster" && m.id === lastId));
      const filteredEventPool = eventPool.filter((e) => !(lastType === "event" && e.id === lastId));
      if (filteredMonsterPool.length || filteredEventPool.length) {
        monsterPool = filteredMonsterPool.length ? filteredMonsterPool : monsterPool;
        eventPool = filteredEventPool.length ? filteredEventPool : eventPool;
      }
    }
    const eventWeights = eventPool.map((e) => Number(e.chance) || 0);
    const totalMonsterWeight = monsterWeights.reduce((s, v) => s + v, 0);
    const totalEventWeight = eventWeights.reduce((s, v) => s + v, 0);
    const totalWeight = totalMonsterWeight + totalEventWeight;
    let chosenEvent = null;
    let chosenMonster = null;
    if (totalWeight <= 0) {
      chosenMonster = nextMonster;
    } else {
      let r = Math.random() * totalWeight;
      for (let i = 0; i < monsterPool.length; i++) {
        r -= monsterWeights[i] || 0;
        if (r <= 0) {
          chosenMonster = monsterPool[i];
          break;
        }
      }
      if (!chosenMonster) {
        for (let j = 0; j < eventPool.length; j++) {
          r -= eventWeights[j] || 0;
          if (r <= 0) {
            chosenEvent = eventPool[j];
            break;
          }
        }
      }
    }

    if (chosenEvent) {
      zoneLastChosen.set(zoneKey, { type: "event", id: chosenEvent.id });
      const pendingMonster = nextMonster;
      const tpl = chosenEvent.template || null;
      const startedAt = new Date().toISOString();
      const endsAt = new Date(Date.now() + ((tpl && tpl.durationSec) || 12) * 1000).toISOString();
      const eventState = {
        ...freshState,
        killCount: newKillCount,
        participants: [],
        damageMap: {},
        killClaimedSeq: monster.seq,
        killClaimedAt: new Date(),
        currentHp: 0,
        activeHealerAura: null,
        activeEvent: {
          id: chosenEvent.id,
          name: tpl ? tpl.name : chosenEvent.id,
          message: tpl ? tpl.message : null,
          startedAt,
          endsAt,
          pendingMonsterSeq: pendingMonster ? pendingMonster.seq : null,
          nodes: (tpl && tpl.nodes) || [],
          npc: (tpl && tpl.npc) || null
        }
      };
      await sc.monsterService.saveState(eventState, zoneKey);
      await _republishPanel(sc, zoneKey, null, 0, 0, {}, eventState.activeEvent).catch((e) => console.error("[Panel] NPC event publish failed:", e?.message || e));
      _scheduleZoneEventFinalize(sc, zoneKey, endsAt);
    } else {
      const pickedMonster = chosenMonster || nextMonster;
      zoneLastChosen.set(zoneKey, { type: "monster", id: pickedMonster?.id || monster.id });
      if (pickedMonster) {
        const transitionState = {
          ...freshState,
          killCount: newKillCount
        };
        await _startMonsterTransition(sc, zoneKey, pickedMonster, transitionState, {
          sourceMonsterName: monster.name,
          sourceMonsterSeq: monster.seq
        });
      } else {
        const newState = {
          ...freshState,
          currentHp: 0,
          activeMonsterSeq: freshState.activeMonsterSeq,
          killCount: newKillCount,
          participants: [],
          damageMap: {},
          killClaimedSeq: monster.seq,
          killClaimedAt: new Date(),
          activeHealerAura: null,
          activeEvent: null,
          activeTransition: null
        };
        await sc.monsterService.saveState(newState, zoneKey);
        await _republishPanel(sc, zoneKey, null, 0, 0, finalDamageMap).catch((e) => console.error("[Panel] empty state publish failed:", e?.message || e));
      }
    }
  } else {
    const matchedEvent = await sc.monsterEventService.pickEventForTransition({
      zone: zoneKey,
      defeatedMonsterSeq: monster.seq
    }).catch(() => null);
    if (matchedEvent && nextMonster) {
      const startedAt = new Date().toISOString();
      const endsAt = new Date(Date.now() + (matchedEvent.durationSec || 12) * 1000).toISOString();
      const eventState = {
        ...freshState,
        killCount: newKillCount,
        participants: [],
        damageMap: {},
        killClaimedSeq: monster.seq,
        killClaimedAt: new Date(),
        currentHp: 0,
        activeEvent: {
          id: matchedEvent.id,
          name: matchedEvent.name,
          message: matchedEvent.message,
          startedAt,
          endsAt,
          pendingMonsterSeq: nextMonster.seq,
          // 保留 nodes 與 npc 以便在面板與互動處理時使用
          nodes: matchedEvent.nodes || [],
          npc: matchedEvent.npc || null
        }
      };
      await sc.monsterService.saveState(eventState, zoneKey);
      await _republishPanel(sc, zoneKey, null, 0, 0, {}, eventState.activeEvent).catch((e) => console.error("[Panel] NPC event publish failed:", e?.message || e));
      _scheduleZoneEventFinalize(sc, zoneKey, endsAt);
    } else {
      if (nextMonster) {
        const transitionState = {
          ...freshState,
          killCount: newKillCount
        };
        await _startMonsterTransition(sc, zoneKey, nextMonster, transitionState, {
          sourceMonsterName: monster.name,
          sourceMonsterSeq: monster.seq
        });
      } else {
        const newState = {
          ...freshState,
          currentHp: 0,
          activeMonsterSeq: freshState.activeMonsterSeq,
          killCount: newKillCount,
          participants: [],
          damageMap: {},
          killClaimedSeq: monster.seq,
          killClaimedAt: new Date(),
          activeEvent: null,
          activeTransition: null
        };
        await sc.monsterService.saveState(newState, zoneKey);
        await _republishPanel(sc, zoneKey, null, 0, 0, finalDamageMap).catch((e) => console.error("[Panel] empty state publish failed:", e?.message || e));
      }
    }
  }

  // 通知參戰獎勵（DM）
  rewardLines.push(...buildPartyRewardSummary(perPidRewards, mergedDmg));
  _notifyKillRewards(monster.name, perPidRewards).catch((e) => console.error("[NotifyKill] top-level error:", e?.message || e));

  // 推送 SSE reward 事件給所有參戰者（web 端通知紀錄）
  try {
    const pushReward = sc._pushRewardToPlayer;
    if (typeof pushReward === "function") {
      for (const [pid, rewards] of Object.entries(perPidRewards)) {
        if (rewards?._expGrantFailed) continue;
        if (!rewards.gold && !rewards.exp && !rewards.drops?.length) continue;
        pushReward(pid, {
          monsterName: monster.name,
          gold:     rewards.gold,
          exp:      rewards.exp,
          levelUps: rewards.levelUps,
          newLevel: rewards.newLevel,
          drops:    rewards.drops,
        });
      }
    }
  } catch (_) {}

  // 回傳結構化摘要供 web API 使用
  const myReward = perPidRewards[discordId] || { gold: 0, exp: 0, levelUps: 0, newLevel: 0, drops: [] };
  rewardLines._summary = {
    gold:     myReward.gold,
    exp:      myReward.exp,
    levelUps: myReward.levelUps,
    newLevel: myReward.newLevel,
    drops:    myReward.drops,
  };

  return rewardLines;
  } finally {
    killInProgress.delete(killKey);
  }
}

// ──────────────────────────────────────────────
// 主路由
// ──────────────────────────────────────────────
async function handleMonsterZoneButton(interaction) {
  const { customId } = interaction;
  if (!isMonsterZoneButton(customId)) return false;
  if (customId === BTN.enterBattle || String(customId).startsWith(BTN.enterBattlePrefix)) {
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

    // 處理效果（與怪物事件相同 schema：{ type, payload }），只回報實際發生的結果
    if (Array.isArray(option.effects) && option.effects.length > 0) {
      const dispName = interaction.member?.displayName || interaction.user.username || discordId;
      const effectResults = [];
      for (const eff of option.effects) {
        try {
          if (eff.type === "grant_currency") {
            const amount = Number(eff.payload?.amount || 0);
            const currencyType = eff.payload?.currencyType || "gold";
            if (Number.isInteger(amount) && amount !== 0) {
              await sc.rewardService.grantCurrency({
                discordId, displayName: dispName, currencyType, amount,
                source: CURRENCY_SOURCES.SHOP_PURCHASE, operator: "npc_dialog"
              });
              effectResults.push(`${currencyType === "diamond" ? "💎" : "🪙"} ${amount > 0 ? "+" : ""}${amount}`);
            }
          } else if (eff.type === "grant_item" || eff.type === "grant_equipment") {
            const itemId = eff.payload?.itemId;
            const item = itemId ? await sc.itemService.getItemById(itemId).catch(() => null) : null;
            if (!item) { effectResults.push(`道具 ${itemId || "?"} 不存在`); continue; }
            await sc.playerService.ensurePlayer(discordId, dispName).catch(() => {});
            const prog = await sc.progressRepository.findByPlayerId(discordId).catch(() => null);
            if (prog) {
              if (!Array.isArray(prog.inventory)) prog.inventory = [];
              prog.inventory.push({
                uuid: require("crypto").randomUUID(),
                itemId: item.id, itemName: item.name,
                itemEffect: item.effect || { type: "none", value: 0 },
                useEffects: item.useEffects || [], passiveEffects: item.passiveEffects || [],
                procEffects: item.procEffects || [], combatEffects: item.combatEffects || [],
                itemType: item.itemType || "consumable",
                imageUrl: item.imageUrl || null, imageThumbnailUrl: item.imageThumbnailUrl || null,
                equipSlot: item.equipSlot || null, equipStats: item.equipStats || null,
                weaponType: item.weaponType || null, isTwoHanded: item.isTwoHanded || false,
                atkStat: item.atkStat || null, tier: item.tier || null,
                enhanceLevel: Number(eff.payload?.enhanceLevel || 0),
                purchasedAt: new Date().toISOString()
              });
              prog.updatedAt = new Date().toISOString();
              await sc.progressRepository.save(prog);
              effectResults.push(`獲得 ${item.name}`);
            }
          } else {
            console.warn(`[NPC Dialog] 未實作的效果類型：${eff.type}`);
            effectResults.push(`效果 ${eff.type || "unknown"} 未實作`);
          }
        } catch (e) {
          console.error(`[NPC Dialog] 效果處理失敗 (${eff.type}):`, e?.message || e);
          effectResults.push(`效果 ${eff.type || "unknown"} 處理失敗`);
        }
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

async function _doIdleRotate(sc, zoneKey) {
  try {
    if (process.env.DISABLE_AUTO_ROTATE === '1') {
      return;
    }
    let state = await sc.monsterService.getState(zoneKey);
    await _resolveZoneEventIfExpired(sc, zoneKey).catch(() => {});
    state = await sc.monsterService.getState(zoneKey);
    if (state?.activeEvent?.endsAt && Date.parse(state.activeEvent.endsAt) > Date.now()) return;
    const allMonsters = await sc.monsterService.listMonsters({ includeDisabled: false, zone: zoneKey });
    const monster = allMonsters.find((m) => m.seq === state.activeMonsterSeq);
    if (!monster) return;

    const next = pickWeightedNextMonster(allMonsters, monster.id);
    if (!next) return;

    const newState = {
      ...state,
      currentHp: next.calc.maxHp,
      activeMonsterSeq: next.seq,
      participants: [],
      damageMap: {},
      killClaimedSeq: null,
      lastHitAt: new Date().toISOString(),
      activeEvent: null,
    };

    // 精英區世界 Boss idle：重置三部位 HP
    // 只有「有人開戰但超時」才重置解鎖進度，純閒置不重置
    if (isWorldBossZone(zoneKey) && next.isBoss && sc.worldBossServiceFor(zoneKey)) {
      const partMax = createWorldBossPartHpTemplate(next.calc.maxHp, zoneKey);
      newState.worldBossPartsMaxHp = partMax;
      newState.worldBossPartsHp = { ...partMax };
      const wbState = await sc.worldBossServiceFor(zoneKey)._getStateEnsured().catch(() => null);
      if (wbState?.battleStartedAt) {
        // 有人曾開戰但沒打完，視為失敗，重置解鎖進度
        await sc.worldBossServiceFor(zoneKey).markBossFailedTimeout().catch(() => {});
      } else {
        // 純閒置，只重置部位 HP，不動解鎖進度
      }
    }

    await sc.monsterService.saveState(newState, zoneKey);
    _republishPanel(sc, zoneKey, next, next.calc.maxHp, 0, {}).catch(() => {});
    // 精英區 Boss 由解鎖流程觸發廣播，idle rotate 不廣播
  if (next.isBoss && !isWorldBossZone(zoneKey) && BOSS_SPAWN_BROADCAST_ENABLED) _broadcastBossSpawn(sc, zoneKey, next).catch(() => {});

    // 嗆聲廣播
    const { getBotClient } = require("../runtimeContext");
    const client = getBotClient();
    if (!client?.isReady()) return;
    const layout = await sc.channelLayoutRepository.get();
    const bindings = layout?.discord?.bindings || [];
    const townBinding = bindings.find((b) => b.featureKey === "town_chat");
    const zoneFeature = zoneToFeatureKey(zoneKey);
    const fallback = bindings.find((b) => b.featureKey === zoneFeature);
    const channelId = townBinding?.channelId || fallback?.channelId;
    if (!channelId) return;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased?.()) return;
    if (process.env.DISABLE_TAUNTS !== '1') {
      const taunt = IDLE_TAUNTS[Math.floor(Math.random() * IDLE_TAUNTS.length)];
      await channel.send(taunt(monster.name));
    }
  } catch (e) {
    console.error(`[IdleRotate] zone=${zoneKey} error:`, e.message);
  }
}

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
  _resolveExpiredMonsterTransition,
  hellfangPlayerSchool, hellfangDamageMult, hellfangUpdateAdaptation, hellfangAdaptLines, getWorldBossPartWeakness,
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
