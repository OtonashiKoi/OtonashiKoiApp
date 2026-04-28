"use strict";

const { MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require("discord.js");
const { EFFECT_NAME_ZH } = require("../../shared/effectDisplayNames");
const { ALL_ZONE_KEYS, featureKeyToZone: _featureKeyToZone, zoneToFeatureKey, getZoneTheme, checkZoneLevelRequirementWithBinding } = require("../../shared/zones");

// 這些效果的 params.value 代表百分比（percent），顯示時會特別格式化
const PERCENT_EFFECT_KEYS = new Set([
  'gold_gain_up', 'exp_gain_up', 'drop_rate_up', 'rare_drop_rate_up', 'monster_reward_up', 'checkin_bonus_up', 'enhance_success_up', 'event_trigger_rate_up'
]);
const { CURRENCY_SOURCES, EXP_SOURCES } = require("../../shared/sources");
const { calcPlayerStats } = require("../../shared/combatStats");
const { isEffectConditionMet, collectEquipmentEffects, mergeEquippedFromLibrary, applyEffectInstances, decrementActiveEffects } = require("../../shared/effectEngine");

// 戰鬥 session 依 discordId 儲存（記憶體）
const activeSessions = new Map();

// 死亡冷卻記錄：key = discordId, value = { deathTime: timestamp, cooldownMs: 25000 }
const deathCooldowns = new Map();

// 擊殺結算互斥鎖（防止兩名玩家同時打死同一隻怪造成雙重結算）
// key: `${zoneKey}:${monsterSeq}`
const killInProgress = new Set();
const zoneEventTimers = new Map();
const worldBossTimeoutTimers = new Map();
// track last chosen candidate per zone to avoid immediate repeats
const zoneLastChosen = new Map();

// 排行榜去重：key = zoneKey, value = { lastPublishTime, lastDamageMap, pendingTimer }
// 防止戰鬥中頻繁編輯面板，最多 5 秒更新一次排行榜
const damageRankingDebounce = new Map();

const BTN = {
  enterBattle: "monster-zone:enter-battle",
  enterBattlePrefix: "monster-zone:enter-battle:",
  startFight:  "monster-zone:start-fight",
  deleteLog:   "monster-zone:delete-log"
};

const MAX_ROUNDS = 15;
const BATTLE_TIMEOUT_MS = 60 * 1000; // 1 分鐘未按開始戰鬥 → 視為逃跑
const ROUNDS_PER_TICK = 1;           // 每次更新顯示幾回合
const DEATH_COOLDOWN_MS = 25 * 1000; // 死亡冷卻時間：25 秒

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
const WORLD_BOSS_TARGET_PARTS = new Set(["head", "body", "legs"]);

function parseWorldBossTargetPart(customId) {
  const raw = String(customId || "");
  if (!raw.startsWith(BTN.enterBattlePrefix)) return "body";
  const part = raw.slice(BTN.enterBattlePrefix.length);
  return WORLD_BOSS_TARGET_PARTS.has(part) ? part : "body";
}

function getWorldBossTargetProfile(part) {
  if (part === "head") {
    return {
      label: "頭部",
      playerAtkMultiplier: 1.15,
      playerDexMultiplier: 0.9,
      note: "高風險高輸出（傷害較高、命中略降）"
    };
  }
  if (part === "legs") {
    return {
      label: "下盤",
      playerAtkMultiplier: 0.9,
      playerAgiBonus: 6,
      note: "壓制行動（傷害較低、速度較高）"
    };
  }
  return {
    label: "軀幹",
    playerAtkMultiplier: 1,
    note: "穩定輸出（命中與傷害均衡）"
  };
}

function applyWorldBossTargetToPlayerStats(playerStats, part) {
  const profile = getWorldBossTargetProfile(part);
  const next = { ...(playerStats || {}) };
  next.atk = Math.max(1, Math.round((next.atk || 0) * (profile.playerAtkMultiplier || 1)));
  if (profile.playerDexMultiplier != null) {
    next.dex = Math.max(1, Math.round((next.dex || 1) * profile.playerDexMultiplier));
  }
  if (profile.playerAgiBonus != null) {
    next.agi = Math.max(1, Math.round((next.agi || 1) + profile.playerAgiBonus));
  }
  return { stats: next, profile };
}

function createWorldBossPartHpTemplate(totalMaxHp = 0) {
  const maxHp = Math.max(1, Math.round(Number(totalMaxHp) || 1));
  const head = Math.max(1, Math.round(maxHp * 0.3));
  const body = Math.max(1, Math.round(maxHp * 0.4));
  const legs = Math.max(1, maxHp - head - body);
  return {
    head,
    body,
    legs
  };
}

function sumWorldBossPartHp(partsHp) {
  if (!partsHp || typeof partsHp !== "object") return 0;
  return ["head", "body", "legs"].reduce((sum, k) => sum + Math.max(0, Number(partsHp[k] || 0)), 0);
}

function isWorldBossAllPartsDefeated(partsHp) {
  if (!partsHp || typeof partsHp !== "object") return false;
  return ["head", "body", "legs"].every((k) => Number(partsHp[k] || 0) <= 0);
}

function ensureWorldBossPartState(state, monsterMaxHp) {
  const defaultMax = createWorldBossPartHpTemplate(monsterMaxHp);
  const currentMax = (state && state.worldBossPartsMaxHp && typeof state.worldBossPartsMaxHp === "object")
    ? {
      head: Math.max(1, Number(state.worldBossPartsMaxHp.head || defaultMax.head)),
      body: Math.max(1, Number(state.worldBossPartsMaxHp.body || defaultMax.body)),
      legs: Math.max(1, Number(state.worldBossPartsMaxHp.legs || defaultMax.legs))
    }
    : defaultMax;
  const hasCurrentHp = !!(state && state.worldBossPartsHp && typeof state.worldBossPartsHp === "object");
  const currentHp = hasCurrentHp
    ? {
      head: Math.max(0, Number(state.worldBossPartsHp.head || 0)),
      body: Math.max(0, Number(state.worldBossPartsHp.body || 0)),
      legs: Math.max(0, Number(state.worldBossPartsHp.legs || 0))
    }
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
  beginner: 'D', normal: 'D', mid: 'C', hard: 'B', elite: 'A'
};
// 參與獎勵寶石掉落率（依品階）
const GEM_PARTICIPATION_RATE = { D: 0.25, C: 0.15, B: 0.10, A: 0.05 };

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
  if (zoneKey !== "elite" || !sc.worldBossService || !monster?.isBoss) return { state, timedOut: false };
  const info = await sc.worldBossService.getConfigWithStatus().catch(() => null);
  if (!info?.status?.battleTimeoutReached) return { state, timedOut: false };
  const timer = worldBossTimeoutTimers.get(zoneKey);
  if (timer) {
    clearTimeout(timer);
    worldBossTimeoutTimers.delete(zoneKey);
  }
  const partState = ensureWorldBossPartState({}, monster.calc.maxHp);
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
  await sc.worldBossService.markBossFailedTimeout().catch(() => {});
  for (const [pid, session] of activeSessions.entries()) {
    if (session?.zoneKey === zoneKey && session?.monsterId === monster.id) {
      if (session.timeoutId) clearTimeout(session.timeoutId);
      activeSessions.delete(pid);
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
  if (zoneKey !== "elite" || !sc?.worldBossService || !monster?.isBoss) return;
  const info = await sc.worldBossService.getConfigWithStatus().catch(() => null);
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

async function recordQuestBattleProgress(sc, discordId, outcome, totalDamage, combatStats = null, weaponType = null) {
  const questService = sc?.questService || sc?.weeklyQuestService;
  if (!questService || typeof questService.recordProgress !== "function") return;

  await questService.recordProgress(discordId, "battle_count", 1);
  await questService.recordProgress(discordId, "damage_total", totalDamage);
  const weaponMetric = resolveWeaponQuestMetric(weaponType);
  if (weaponMetric) {
    await questService.recordProgress(discordId, weaponMetric, 1);
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
    pool[existingCardDropIndex] = {
      ...pool[existingCardDropIndex],
      chance: 1,
      source: pool[existingCardDropIndex].source || "monster_card"
    };
    return pool;
  }

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
function recordDeathCooldown(discordId) {
  deathCooldowns.set(discordId, {
    deathTime: Date.now(),
    cooldownMs: DEATH_COOLDOWN_MS
  });
}

/**
 * 獲取玩家的剩餘冷卻時間（秒）
 * @returns {number} 剩餘秒數，0 = 無冷卻
 */
function getRemainingCooldown(discordId) {
  const cooldown = deathCooldowns.get(discordId);
  if (!cooldown) return 0;

  const elapsedMs = Date.now() - cooldown.deathTime;
  const remainingMs = Math.max(0, cooldown.cooldownMs - elapsedMs);

  if (remainingMs <= 0) {
    deathCooldowns.delete(discordId);
    return 0;
  }

  return Math.ceil(remainingMs / 1000); // 向上取整秒數
}

/**
 * 檢查玩家是否在冷卻中
 */
function isInCooldown(discordId) {
  return getRemainingCooldown(discordId) > 0;
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

function buildRewardModifiers(progress) {
  const refs = collectRewardEffectRefs(progress);
  let expPct = 0;
  let goldPct = 0;
  let dropPct = 0;
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
      default:
        break;
    }
  }

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

// ──────────────────────────────────────────────
// 輔助：掉落裝備公告
// ──────────────────────────────────────────────
async function _notifyKillRewards(monsterName, perPidRewards, killerDiscordId) {
  try {
    const { getBotClient } = require("../runtimeContext");
    const sc = getServiceContext();
    const client = getBotClient();
    if (!client?.isReady()) return;
    for (const [pid, rewards] of Object.entries(perPidRewards)) {
      const lines = [];
      if (rewards.gold > 0) lines.push(`💰 金幣 **+${rewards.gold}**`);
      if (rewards.exp > 0) {
        let expLine = `⭐ EXP **+${rewards.exp}**`;
        if (rewards.levelUps > 0) expLine += `　✨ 升級 ${rewards.levelUps} 次！**Lv.${rewards.newLevel}**`;
        lines.push(expLine);
      }
      if (rewards.drops.length > 0) lines.push(`🎁 道具：**${rewards.drops.join("、")}**`);
      if (!lines.length) continue;
      const prefix = pid === killerDiscordId
        ? `⚔️ 你擊倒了 **${monsterName}**！獎勵結算：`
        : `⚔️ **${monsterName}** 已被擊倒，你的參戰獎勵：`;
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
const LEVEL_MILESTONES = new Set([10, 15]);
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
      if (lv === 10) {
        await channel.send(`🎉 恭喜 <@${discordId}> **${displayName}** 升上 **Lv.10**！踏入中級冒險者的行列！⚔️`);
      } else if (lv === 15) {
        await channel.send(`🌟 恭喜 <@${discordId}> **${displayName}** 達到 **Lv.15**！精英冒險者降臨！🔥`);
      }
    }
  } catch (_) {}
}

async function _announceDrops(sc, discordId, displayName, monsterName, droppedItems, kind = "fight") {
  try {
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
    const itemList = droppedItems.join("、");
    const taunt = pickTaunt(kind, monsterName);
    const tauntSuffix = taunt ? `　${taunt}` : '';
    if (kind === "bonus_10") {
      await channel.send(`🎊 **10人加碼** ${displayName} (<@${discordId}>) 從 **${monsterName}** 打到 **${itemList}**${tauntSuffix}`);
    } else if (kind === "bonus_15") {
      await channel.send(`🔥 **15人加碼** ${displayName} (<@${discordId}>) 從 **${monsterName}** 打到 **${itemList}**${tauntSuffix}`);
    } else if (kind === "bonus_20") {
      await channel.send(`🌟 **20人加碼** ${displayName} (<@${discordId}>) 從 **${monsterName}** 打到 **${itemList}**${tauntSuffix}`);
    } else if (kind === "group") {
      await channel.send(`🎁 ${displayName} (<@${discordId}>) 從 **${monsterName}** 打到 **${itemList}**${tauntSuffix}`);
    } else {
      await channel.send(`⚔️ ${displayName} (<@${discordId}>) 擊倒 **${monsterName}** 打到 **${itemList}**${tauntSuffix}`);
    }
  } catch (e) {
    // suppressed
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
    let partsHp = worldBossPartsHp;
    if (!partsHp && zoneKey === "elite" && monster?.isBoss) {
      const latest = await sc.monsterService.getState(zoneKey).catch(() => null);
      partsHp = latest?.worldBossPartsHp || null;
    }
    await sc.adminConsoleService.publishMonsterZonePanel(
      binding.channelId,
      monster,
      monsterHp,
      {
        participantCount,
        damageMap: damageMapWithCooldown,
        activeEvent,
        worldBossPartsHp: partsHp,
        fastUpdate: options.fastUpdate === true
      }
    );
  }
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
  if (nextMonster.isBoss) _broadcastBossSpawn(sc, zoneKey, nextMonster).catch(() => {});
  zoneEventTimers.delete(zoneKey);
  return true;
}

// BOSS 出場廣播：優先 town_chat，fallback monster_zone
async function _broadcastBossSpawn(sc, zoneKey, monster) {
  try {
    const { getBotClient } = require("../runtimeContext");
    const client = getBotClient();
    if (!client?.isReady()) {
      console.warn("[BOSS] bot not ready, skip broadcast");
      return;
    }

    const layout = await sc.channelLayoutRepository.get();
    const bindings = layout?.discord?.bindings || [];
    const binding = bindings.find((b) => b.featureKey === "town_chat" && b.enabled && b.channelId)
                 || bindings.find((b) => b.featureKey === "monster_zone" && b.enabled && b.channelId);
    if (!binding) {
      console.warn("[BOSS] no suitable channel binding found, skip broadcast");
      return;
    }

    const channel = await client.channels.fetch(binding.channelId).catch(() => null);
    if (!channel) {
      console.warn("[BOSS] channel fetch failed:", binding.channelId);
      return;
    }

    const zoneName = getZoneTheme(zoneKey).label + "戰鬥區";
    const { EmbedBuilder } = require("discord.js");
    const thumbUrl = (monster.imageThumbnailUrl || monster.imageUrl || "").startsWith("http")
      ? (monster.imageThumbnailUrl || monster.imageUrl)
      : null;
    const embed = new EmbedBuilder()
      .setColor(0xff4444)
      .setTitle(`⚠️ BOSS 登場！`)
      .setDescription(`**${zoneName}** 出現了強大的 BOSS！\n\n👹 **${monster.name}** 降臨！\n快去挑戰吧！`)
      .setFooter({ text: `Lv.${monster.level || "?"} · HP ${monster.calc?.maxHp || "?"}` })
      .setTimestamp();
    if (thumbUrl) embed.setThumbnail(thumbUrl);

    await channel.send({ embeds: [embed] });
    console.log(`[BOSS] broadcast sent for ${monster.name} in ${zoneKey}`);
  } catch (err) {
    console.error("[BOSS] broadcast error:", err);
  }
}

// ──────────────────────────────────────────────
// 出戰（入場）— 顯示準備畫面 + 開始戰鬥按鈕
// ──────────────────────────────────────────────
async function handleEnterBattle(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const sc = getServiceContext();
  const discordId = interaction.user.id;
  const displayName = interaction.member?.displayName || interaction.user.username;
  const selectedBossPart = parseWorldBossTargetPart(interaction.customId);
  const selectedBossPartProfile = getWorldBossTargetProfile(selectedBossPart);
  let idleSettleNotice = null;

  // 已有進行中的戰鬥，拒絕重複出戰
  if (activeSessions.has(discordId)) {
    const s = activeSessions.get(discordId);
    const msg = s.state === "displaying"
      ? "⚔️ 戰鬥結果顯示中，請等待完成後再出戰！"
      : "⚔️ 你已經在戰鬥中了！請先完成當前戰鬥。";
    await interaction.editReply({ content: msg });
    return;
  }

  try {
    // 偵測頻道對應的區域
    const zoneKey = await getZoneFromChannel(sc, interaction.channelId);
    if (!zoneKey) {
      await interaction.editReply({ content: "❌ 此頻道未設定為放怪區。" });
      return;
    }

    // 死亡冷卻檢查
    const cooldownRemaining = getRemainingCooldown(discordId);
    if (cooldownRemaining > 0) {
      await interaction.editReply({
        content: `⏳ 你還在冷卻中！請等待 **${cooldownRemaining}** 秒後再進場。`
      });
      return;
    }

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
    if (state?.activeEvent?.endsAt && Date.parse(state.activeEvent.endsAt) > Date.now()) {
      const remainSec = Math.max(1, Math.ceil((Date.parse(state.activeEvent.endsAt) - Date.now()) / 1000));
      await interaction.editReply({
        content: `Event in progress: ${state.activeEvent.name || "transition event"} (${remainSec}s remaining).`
      });
      return;
    }
    if (!monsters.length) {
      await interaction.editReply({ content: "❌ 目前沒有啟用中的怪物，請稍後再試。" });
      return;
    }
    let monster = monsters.find((m) => m.seq === state.activeMonsterSeq);
    if (!monster) {
      // state.activeMonsterSeq 與現有區域怪物不符（首次或狀態過期）→ 同步到第一隻
      monster = monsters[0];
      const initHp = monster.calc.maxHp;
      await sc.monsterService.saveState(
        { ...state, activeMonsterSeq: monster.seq, currentHp: initHp },
        zoneKey
      );
      state = { ...state, activeMonsterSeq: monster.seq, currentHp: initHp };
    }

    if (zoneKey === "elite" && sc.worldBossService) {
      const boss = monsters.find((m) => m.isBoss) || monster;
      if (boss && monster?.id !== boss.id) {
        const bossPartState = ensureWorldBossPartState({}, boss.calc.maxHp);
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

      const wb = await sc.worldBossService.getConfigWithStatus();
      if (!wb.config.enabled) {
        await interaction.editReply({ content: "🔒 世界BOSS目前未開放。" });
        return;
      }
      if (!wb.status.unlocked) {
        await interaction.editReply({
          content: `🔒 世界BOSS尚未解鎖：高級區每週需擊殺 ${wb.status.unlockTarget} 隻，目前 ${wb.status.hardKills} 隻（還差 ${wb.status.remainingUnlockKills} 隻）`
        });
        return;
      }
      if (wb.status.cooldownRemainingMs > 0) {
        await interaction.editReply({
          content: `⏳ 世界BOSS冷卻中，約 ${wb.status.cooldownRemainingMinutes} 分鐘後可再次挑戰。`
        });
        return;
      }

      const ensured = ensureWorldBossPartState(state, monster.calc.maxHp);
      if (ensured.changed) {
        state = { ...state, ...ensured };
        await sc.monsterService.saveState(state, zoneKey);
      } else {
        state = { ...state, ...ensured };
      }
    }

    const monsterHp = (zoneKey === "elite" && monster?.isBoss)
      ? Math.max(0, Number(state?.worldBossPartsHp?.[selectedBossPart] || 0))
      : (state.currentHp != null ? state.currentHp : monster.calc.maxHp);

    const progress = cachedProgress ?? await sc.progressRepository.findByPlayerId(discordId);
    const attrs = progress?.attributes || { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 };
    // 永遠從 DB 讀取最新 effects（不使用 snapshot 裡的舊值）
    const equipped = await mergeEquippedFromLibrary(progress?.equipment || {}, sc.itemRepository);
    const pStats = calcPlayerStats(attrs, equipped, progress?.activeEffects || [], progress?.inventory || []);

    // 入場費
    if (monster.entryFee > 0) {
      const wallet = await sc.walletRepository.findByPlayerId(discordId);
      const gold = wallet?.gold ?? 0;
      if (gold < monster.entryFee) {
        await interaction.editReply({
          content: `❌ 金幣不足！入場費需要 **${monster.entryFee}** 🪙，你目前有 **${gold}** 🪙。`
        });
        return;
      }
      await sc.rewardService.grantCurrency({
        discordId, displayName, currencyType: "gold",
        amount: -monster.entryFee, source: CURRENCY_SOURCES.MONSTER_ENTRY_FEE, operator: "monster_zone"
      });
    }

    // 建立 session（state: waiting）
    const session = {
      state: "waiting",
      zoneKey,
      monsterId: monster.id, monsterSeq: monster.seq, monsterName: monster.name,
      monsterMaxHp: monster.calc.maxHp, monsterHp, monsterStats: monster.calc,
      playerMaxHp: pStats.maxHp, playerHp: pStats.maxHp, playerStats: pStats,
      entryFee: monster.entryFee, timeoutId: null,
      worldBossTargetPart: selectedBossPart,
      worldBossTargetLabel: selectedBossPartProfile.label
    };

    // 1 分鐘未開始 → 自動逃跑
    session.timeoutId = setTimeout(async () => {
      const s = activeSessions.get(discordId);
      if (s && s.state === "waiting") {
        activeSessions.delete(discordId);
        const feeNote = session.entryFee > 0 ? `\n入場費 **${session.entryFee}** 🪙 已損失。` : "";
        interaction.editReply({
          content: `⏰ 超過 1 分鐘未開始戰鬥，已自動逃跑。${feeNote}`,
          embeds: [], components: []
        }).catch(() => {});
      }
    }, BATTLE_TIMEOUT_MS);

    activeSessions.set(discordId, session);

    // 加入參戰名單（去重）並更新面板
    const participants = Array.isArray(state.participants) ? state.participants : [];
    if (!participants.includes(discordId)) {
      const newParticipants = [...participants, discordId];
      if (zoneKey === "elite" && monster?.isBoss && participants.length === 0) {
        await sc.worldBossService?.startBossBattleIfNeeded().catch(() => {});
        await scheduleEliteWorldBossTimeout(sc, zoneKey, monster).catch(() => {});
      }
      await sc.monsterService.saveState({
        ...state,
        currentHp: (zoneKey === "elite" && monster?.isBoss) ? sumWorldBossPartHp(state.worldBossPartsHp) : monsterHp,
        participants: newParticipants,
        lastHitAt: new Date().toISOString()
      }, zoneKey);
      const layout = await sc.channelLayoutRepository.get();
      const featureKey = zoneToFeatureKey(zoneKey);
      const binding = (layout?.discord?.bindings || []).find((b) => b.featureKey === featureKey);
      if (binding?.channelId) {
        sc.adminConsoleService
          .publishMonsterZonePanel(binding.channelId, monster, (zoneKey === "elite" && monster?.isBoss ? state.currentHp : monsterHp), {
            participantCount: newParticipants.length,
            damageMap: state.damageMap || {},
            worldBossPartsHp: state.worldBossPartsHp || null
          })
          .catch(() => {});

      }
    }

    // 直接執行戰鬥（自動按下開始戰鬥）
    if (session.timeoutId) { clearTimeout(session.timeoutId); session.timeoutId = null; }
    session.state = "fighting";

    try {
      let battleState = await sc.monsterService.getState(zoneKey);
      await _resolveZoneEventIfExpired(sc, zoneKey);
      battleState = await sc.monsterService.getState(zoneKey);
      if (battleState?.activeEvent?.endsAt && Date.parse(battleState.activeEvent.endsAt) > Date.now()) {
        activeSessions.delete(discordId);
        await interaction.editReply({ content: "Event is in progress, battle is temporarily unavailable.", embeds: [], components: [] });
        return;
      }
      const monsters = await sc.monsterService.listMonsters({ includeDisabled: false, zone: zoneKey });
      const battleMonster = monsters.find((m) => m.id === session.monsterId);

      // 怪物已被別人打死
      if (!battleMonster || battleState.activeMonsterSeq !== session.monsterSeq) {
        activeSessions.delete(discordId);
        await interaction.editReply({
          embeds: [new EmbedBuilder()
            .setTitle("😮 怪物已被擊倒！")
            .setDescription("怪物已被其他玩家擊倒，下一隻怪物已上場。\n請重新點擊出戰按鈕！")
            .setColor(0xaaaaaa)],
          components: []
        });
        return;
      }

      const timeoutResult = await maybeHandleEliteWorldBossTimeout(sc, zoneKey, battleState, battleMonster);
      battleState = timeoutResult.state;
      if (timeoutResult.timedOut) {
        activeSessions.delete(discordId);
        await interaction.editReply({
          content: "⌛ 世界BOSS 挑戰超過 1 小時未擊殺，本輪已判定失敗。\n🔒 解鎖進度已重置，需重新擊殺 300 隻高級區怪物才能再次挑戰。",
          embeds: [],
          components: []
        });
        return;
      }

      if (zoneKey === "elite" && battleMonster?.isBoss) {
        const ensured = ensureWorldBossPartState(battleState, battleMonster.calc.maxHp);
        if (ensured.changed) {
          battleState = { ...battleState, ...ensured };
          await sc.monsterService.saveState(battleState, zoneKey);
        } else {
          battleState = { ...battleState, ...ensured };
        }
      }

      session.monsterHp = (zoneKey === "elite" && battleMonster?.isBoss)
        ? Math.max(0, Number(battleState?.worldBossPartsHp?.[session.worldBossTargetPart || "body"] || 0))
        : (battleState.currentHp != null ? battleState.currentHp : session.monsterMaxHp);

      if (zoneKey === "elite" && battleMonster?.isBoss && sc.worldBossService) {
        const wbCfg = await sc.worldBossService.getConfig();
        const hpPct = session.monsterMaxHp > 0 ? (session.monsterHp / session.monsterMaxHp) * 100 : 100;
        const phase = sc.worldBossService.resolvePhase(wbCfg, hpPct);
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
          const prog = await sc.progressRepository.findByPlayerId(pid).catch(() => null);
          if (!prog) return;
          // 永遠從 DB 讀取最新 effects（不使用 snapshot 裡的舊值）
          const equipped = await mergeEquippedFromLibrary(prog.equipment || {}, sc.itemRepository);
          const refs = collectEquipmentEffects(equipped, null, { equipped, inventory: prog.inventory || [] });
          const pidName = pid === discordId ? displayName : ((await sc.playerRepository.findByDiscordId(pid).catch(() => null))?.displayName || null);
          for (const r of refs) {
            if (r && r.target === 'party') partyEffects.push({ ...r, sourceName: pidName });
          }
        } catch (e) {}
      }));

      // ── 治療師光環：若存在且不在 participants 中，疊加光環效果 ──
      const aura = battleState.activeHealerAura;
      if (aura && aura.effects && !participants.includes(aura.discordId)) {
        for (const e of aura.effects) {
          partyEffects.push({ ...e, sourceName: aura.displayName || null });
        }
      }

      const currentProg = await sc.progressRepository.findByPlayerId(discordId).catch(() => null);
      // 永遠從 DB 讀取最新 effects（不使用 snapshot 裡的舊值）
      const currentEquipped = await mergeEquippedFromLibrary((currentProg && currentProg.equipment) ? currentProg.equipment : {}, sc.itemRepository);

      let battlePlayerStats = session.playerStats;
      let battleTargetNote = null;
      if (zoneKey === "elite" && battleMonster?.isBoss) {
        const adjusted = applyWorldBossTargetToPlayerStats(session.playerStats, session.worldBossTargetPart);
        battlePlayerStats = adjusted.stats;
        battleTargetNote = adjusted.profile?.note || null;
      }

      const { runCombatLoop } = require("../../shared/combatLoop");
      const { outcome, roundLogs, totalDamage, finalMonsterHp, finalPlayerHp, combatStats } =
        runCombatLoop(battlePlayerStats, session.monsterStats, session.monsterName, session.monsterHp, MAX_ROUNDS, {
          equipped: currentEquipped,
          inventory: currentProg?.inventory || [],
          partyEffects,
          monsterEquipped: battleMonster?.equipment || {},
          worldBossPhase: session.worldBossPhase || null
        });
      session.monsterHp = finalMonsterHp;
      session.playerHp  = finalPlayerHp;
      const totalTaken = Math.max(0, (session.playerMaxHp || 0) - Math.max(0, finalPlayerHp));
      let battleStateForSettlement = battleState;
      let allPartsDefeated = false;

      // ── 戰鬥結果立刻更新排行榜（不等結算完成）──
      const currentParticipants = Array.isArray(battleState.participants) ? battleState.participants : [];
      try {
        const freshState = await sc.monsterService.getState(zoneKey);
        const prev = freshState.damageMap || {};
        const updatedDamageMap = {
          ...prev,
          [discordId]: {
            name: displayName,
            damage: (prev[discordId]?.damage || 0) + totalDamage,
            taken: (prev[discordId]?.taken || 0) + totalTaken,
          }
        };
        let nextState = { ...freshState, currentHp: session.monsterHp, damageMap: updatedDamageMap, lastHitAt: new Date().toISOString() };
        if (zoneKey === "elite" && battleMonster?.isBoss) {
          const part = session.worldBossTargetPart || "body";
          const prevParts = ensureWorldBossPartState(freshState, battleMonster.calc.maxHp);
          const nextPartsHp = { ...prevParts.worldBossPartsHp, [part]: Math.max(0, Number(session.monsterHp || 0)) };
          nextState = {
            ...nextState,
            worldBossPartsHp: nextPartsHp,
            worldBossPartsMaxHp: prevParts.worldBossPartsMaxHp,
            currentHp: sumWorldBossPartHp(nextPartsHp)
          };
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
      } catch (e) {
        console.error("[monsterZoneHandlers] 排行榜更新失敗:", e.message);
      }

      // ── 結算 ──
      let rewardLines = [];
      let embedTitle, embedColor;

      if (outcome === "win") {
        if (zoneKey === "elite" && battleMonster?.isBoss && !allPartsDefeated) {
          embedTitle = "✅ 部位擊破";
          embedColor = 0x22c55e;
          rewardLines = ["目前僅擊破一個部位，需三部位全破才會結算世界王擊殺獎勵。"];
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
            currentHp: (zoneKey === "elite" && battleMonster?.isBoss)
              ? sumWorldBossPartHp(freshState.worldBossPartsHp)
              : session.monsterHp,
            lastHitAt: new Date().toISOString()
          }, zoneKey);
        } catch (e) {
          await sc.monsterService.saveState({
            ...battleState,
            currentHp: (zoneKey === "elite" && battleMonster?.isBoss)
              ? sumWorldBossPartHp(battleState.worldBossPartsHp)
              : session.monsterHp,
            lastHitAt: new Date().toISOString()
          }, zoneKey);
        }

        // 記錄死亡冷卻
        recordDeathCooldown(discordId);

        embedTitle = "💀 戰鬥失敗";
        embedColor = 0x555555;
        rewardLines = [
          `你被 **${session.monsterName}** 擊倒了！`,
          `你造成了 **${totalDamage}** 點傷害。`,
          session.entryFee > 0 ? `入場費 **${session.entryFee}** 🪙 已損失，下次加油！` : "下次加油！",
          `⏳ 冷卻中... 25 秒後可再次進場。`
        ];
      } else {
        // 排行榜已在戰鬥完成後立刻更新，此處只紀錄狀態
        try {
          const freshState = await sc.monsterService.getState(zoneKey);
          await sc.monsterService.saveState({
            ...freshState,
            currentHp: (zoneKey === "elite" && battleMonster?.isBoss)
              ? sumWorldBossPartHp(freshState.worldBossPartsHp)
              : session.monsterHp,
            lastHitAt: new Date().toISOString()
          }, zoneKey);
        } catch (e) {
          await sc.monsterService.saveState({
            ...battleState,
            currentHp: (zoneKey === "elite" && battleMonster?.isBoss)
              ? sumWorldBossPartHp(battleState.worldBossPartsHp)
              : session.monsterHp,
            lastHitAt: new Date().toISOString()
          }, zoneKey);
        }
        embedTitle = "⏸️ 戰鬥超時";
        embedColor = 0x888888;
        rewardLines = [`超過 ${MAX_ROUNDS} 回合未分勝負，戰鬥中止。\n你造成了 **${totalDamage}** 點傷害。`];
      }

      if (idleSettleNotice) {
        rewardLines = [idleSettleNotice, ...rewardLines];
      }
      if (zoneKey === "elite" && battleMonster?.isBoss) {
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
        await recordQuestBattleProgress(sc, discordId, outcome, totalDamage, combatStats, session.playerStats?.weaponType || null);
      } catch (e) {
        console.error("[Quest] recordProgress error:", e.message);
      }

      // 戰鬥已結算，但先保留 session 至顯示完畢才刪除，避免期間重複出戰
      if (activeSessions.has(discordId)) activeSessions.get(discordId).state = "displaying";

      // ── 逐步顯示回合（每 ROUNDS_PER_TICK 回合更新一次）──
      const delay = (ms) => new Promise((r) => setTimeout(r, ms));
      const MAX_DESC = 3800;
      const tickDelay = calculateTickDelay(session.playerStats?.agi ?? 1);
      const displayRoundLogs = compactAuraSourceNames(roundLogs);

      for (let i = ROUNDS_PER_TICK; i < displayRoundLogs.length; i += ROUNDS_PER_TICK) {
        const soFar = displayRoundLogs.slice(0, i).join("\n\n");
        const truncated = soFar.length > MAX_DESC ? soFar.slice(0, MAX_DESC) + "\n…" : soFar;
        const progressEmbed = new EmbedBuilder()
          .setTitle(`⚔️ 戰鬥中 — 第 ${Math.min(i, displayRoundLogs.length)} 回合`)
          .setDescription(truncated + "\n\n⏳ 戰鬥繼續中...")
          .setColor(0xe74c3c);
        await interaction.editReply({ embeds: [progressEmbed], components: [] });
        await delay(tickDelay);
      }

      // ── 最終結果 ──
      const logText = displayRoundLogs.join("\n\n");
      const displayLog = logText.length > MAX_DESC
        ? logText.slice(0, MAX_DESC) + "\n…（部分回合已省略）"
        : logText;
      const resultBlock = rewardLines.length > 0 ? "\n\n" + rewardLines.join("\n") : "";

      const embed = new EmbedBuilder()
        .setTitle(embedTitle)
        .setDescription(displayLog + resultBlock)
        .setColor(embedColor);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(BTN.deleteLog).setLabel("🗑️ 刪除紀錄").setStyle(ButtonStyle.Secondary)
      );

      await interaction.editReply({ embeds: [embed], components: [row] });
      activeSessions.delete(discordId);  // 顯示完畢才解除鎖定，允許下一場出戰
    } catch (err) {
      activeSessions.delete(discordId);
      await interaction.editReply({ content: "❌ 戰鬥發生錯誤，請稍後再試。", embeds: [], components: [] });
    }
  } catch (err) {
    await interaction.editReply({ content: "❌ 出戰失敗，請稍後再試。" });
  }
}

// ──────────────────────────────────────────────
// 開始戰鬥 — 自動跑完所有回合，顯示完整戰鬥紀錄
// ──────────────────────────────────────────────
async function handleStartFight(interaction) {
  await interaction.deferUpdate();
  const sc = getServiceContext();
  const discordId = interaction.user.id;
  const displayName = interaction.member?.displayName || interaction.user.username;
  const session = activeSessions.get(discordId);

  if (!session) {
    await interaction.editReply({ content: "❌ 找不到你的戰鬥紀錄，請重新出戰。", embeds: [], components: [] });
    return;
  }

  if (session.timeoutId) { clearTimeout(session.timeoutId); session.timeoutId = null; }
  session.state = "fighting";
  const zoneKey = session.zoneKey || "normal";

  try {
    let state = await sc.monsterService.getState(zoneKey);
    await _resolveZoneEventIfExpired(sc, zoneKey);
    state = await sc.monsterService.getState(zoneKey);
    if (state?.activeEvent?.endsAt && Date.parse(state.activeEvent.endsAt) > Date.now()) {
      activeSessions.delete(discordId);
      await interaction.editReply({ content: "Event is in progress, battle is temporarily unavailable.", embeds: [], components: [] });
      return;
    }
    const monsters = await sc.monsterService.listMonsters({ includeDisabled: false, zone: zoneKey });
    const monster = monsters.find((m) => m.id === session.monsterId);

    // 怪物已被別人打死
    if (!monster || state.activeMonsterSeq !== session.monsterSeq) {
      activeSessions.delete(discordId);
      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setTitle("😮 怪物已被擊倒！")
          .setDescription("怪物已被其他玩家擊倒，下一隻怪物已上場。\n請重新點擊出戰按鈕！")
          .setColor(0xaaaaaa)],
        components: []
      });
      return;
    }

    const timeoutResult = await maybeHandleEliteWorldBossTimeout(sc, zoneKey, state, monster);
    state = timeoutResult.state;
    if (timeoutResult.timedOut) {
      activeSessions.delete(discordId);
      await interaction.editReply({
        content: "⌛ 世界BOSS 挑戰超過 1 小時未擊殺，本輪已判定失敗。\n🔒 解鎖進度已重置，需重新擊殺 300 隻高級區怪物才能再次挑戰。",
        embeds: [],
        components: []
      });
      return;
    }

    if (zoneKey === "elite" && monster?.isBoss) {
      const ensured = ensureWorldBossPartState(state, monster.calc.maxHp);
      if (ensured.changed) {
        state = { ...state, ...ensured };
        await sc.monsterService.saveState(state, zoneKey);
      } else {
        state = { ...state, ...ensured };
      }
    }

    session.monsterHp = (zoneKey === "elite" && monster?.isBoss)
      ? Math.max(0, Number(state?.worldBossPartsHp?.[session.worldBossTargetPart || "body"] || 0))
      : (state.currentHp != null ? state.currentHp : session.monsterMaxHp);
    if (zoneKey === "elite" && monster?.isBoss && sc.worldBossService) {
      const wbCfg = await sc.worldBossService.getConfig();
      const hpPct = session.monsterMaxHp > 0 ? (session.monsterHp / session.monsterMaxHp) * 100 : 100;
      const phase = sc.worldBossService.resolvePhase(wbCfg, hpPct);
      session.worldBossPhase = phase;
      session.monsterStats = applyWorldBossPhaseModifiers(monster.calc, phase);
    } else {
      session.worldBossPhase = null;
    }

    // ── 自動跑完所有回合 ──
    // 蒐集當前參戰者中對 party 生效的 aura（由已在場的治療師等提供）
    const participants = Array.isArray(state.participants) ? state.participants : [];
    const allParticipantsWithSelf = [...new Set([...participants, discordId])];
    const partyEffects = [];
    await Promise.all(allParticipantsWithSelf.map(async (pid) => {
      try {
        const prog = await sc.progressRepository.findByPlayerId(pid).catch(() => null);
        if (!prog) return;
        // 永遠從 DB 讀取最新 effects（不使用 snapshot 裡的舊值）
        const equipped = await mergeEquippedFromLibrary(prog.equipment || {}, sc.itemRepository);
        const refs = collectEquipmentEffects(equipped, null, { equipped, inventory: prog.inventory || [] });
        const pidName = pid === discordId ? displayName : ((await sc.playerRepository.findByDiscordId(pid).catch(() => null))?.displayName || null);
        for (const r of refs) {
          if (r && r.target === 'party') partyEffects.push({ ...r, sourceName: pidName });
        }
      } catch (e) {}
    }));

    // ── 治療師光環：若存在且不在 participants 中，疊加光環效果 ──
    const aura = state.activeHealerAura;
    if (aura && aura.effects && !participants.includes(aura.discordId)) {
      for (const e of aura.effects) {
        partyEffects.push({ ...e, sourceName: aura.displayName || null });
      }
    }

    const currentProg = await sc.progressRepository.findByPlayerId(discordId).catch(() => null);
    // 永遠從 DB 讀取最新 effects（不使用 snapshot 裡的舊值）
    const currentEquipped = await mergeEquippedFromLibrary((currentProg && currentProg.equipment) ? currentProg.equipment : {}, sc.itemRepository);

    let battlePlayerStats = session.playerStats;
    let battleTargetNote = null;
    if (zoneKey === "elite" && monster?.isBoss) {
      const adjusted = applyWorldBossTargetToPlayerStats(session.playerStats, session.worldBossTargetPart || "body");
      battlePlayerStats = adjusted.stats;
      battleTargetNote = adjusted.profile?.note || null;
      session.worldBossTargetLabel = adjusted.profile?.label || session.worldBossTargetLabel || "軀幹";
    }

    const { runCombatLoop } = require("../../shared/combatLoop");
    const { outcome, roundLogs, totalDamage, finalMonsterHp, finalPlayerHp, combatStats } =
      runCombatLoop(battlePlayerStats, session.monsterStats, session.monsterName, session.monsterHp, MAX_ROUNDS, {
        equipped: currentEquipped,
        inventory: currentProg?.inventory || [],
        partyEffects,
        monsterEquipped: monster?.equipment || {},
        worldBossPhase: session.worldBossPhase || null
      });
    session.monsterHp = finalMonsterHp;
    session.playerHp  = finalPlayerHp;
    const totalTaken = Math.max(0, (session.playerMaxHp || 0) - Math.max(0, finalPlayerHp));
    const currentParticipants = Array.isArray(state.participants) ? state.participants : [];
    let stateForSettlement = state;
    let updatedDamageMap = {};
    let allPartsDefeated = false;

    // ── 戰鬥結果立刻更新排行榜（不等結算完成）──
    try {
      const freshState = await sc.monsterService.getState(zoneKey);
      const prev = freshState.damageMap || {};
      updatedDamageMap = {
        ...prev,
        [discordId]: {
          name: displayName,
          damage: (prev[discordId]?.damage || 0) + totalDamage,
          taken: (prev[discordId]?.taken || 0) + totalTaken,
        }
      };
      let nextState = { ...freshState, currentHp: session.monsterHp, damageMap: updatedDamageMap, lastHitAt: new Date().toISOString() };
      if (zoneKey === "elite" && monster?.isBoss) {
        const part = session.worldBossTargetPart || "body";
        const prevParts = ensureWorldBossPartState(freshState, monster.calc.maxHp);
        const nextPartsHp = { ...prevParts.worldBossPartsHp, [part]: Math.max(0, Number(session.monsterHp || 0)) };
        nextState = {
          ...nextState,
          worldBossPartsHp: nextPartsHp,
          worldBossPartsMaxHp: prevParts.worldBossPartsMaxHp,
          currentHp: sumWorldBossPartHp(nextPartsHp)
        };
        allPartsDefeated = isWorldBossAllPartsDefeated(nextPartsHp);
      }
      await sc.monsterService.saveState(nextState, zoneKey);
      stateForSettlement = nextState;
      await _republishPanel(
        sc,
        zoneKey,
        monster,
        nextState.currentHp,
        currentParticipants.length,
        updatedDamageMap,
        null,
        nextState.worldBossPartsHp || null,
        { fastUpdate: true }
      );
    } catch (e) {
      console.error("[monsterZoneHandlers] 排行榜更新失敗:", e.message);
    }

    // ── 結算 ──
    let rewardLines = [];
    let embedTitle, embedColor;

    if (outcome === "win") {
      if (zoneKey === "elite" && monster?.isBoss && !allPartsDefeated) {
        embedTitle = "✅ 部位擊破";
        embedColor = 0x22c55e;
        rewardLines = ["目前僅擊破一個部位，需三部位全破才會結算世界王擊殺獎勵。"];
      } else {
        session.monsterHp = 0;
        rewardLines = await handleMonsterKill({ discordId, displayName, session, monster, state: stateForSettlement, totalDamage, zoneKey });
        embedTitle = "🏆 勝利！";
        embedColor = 0xf1c40f;
      }
    } else if (outcome === "lose") {
      session.monsterHp = Math.max(0, session.monsterHp);

      // 記錄死亡冷卻
      recordDeathCooldown(discordId);

      embedTitle = "💀 戰鬥失敗";
      embedColor = 0x555555;
      rewardLines = [
        `你被 **${session.monsterName}** 擊倒了！`,
        `你造成了 **${totalDamage}** 點傷害。`,
        session.entryFee > 0 ? `入場費 **${session.entryFee}** 🪙 已損失，下次加油！` : "下次加油！",
        `⏳ 冷卻中... 25 秒後可再次進場。`
      ];
    } else {
      embedTitle = "⏸️ 戰鬥超時";
      embedColor = 0x888888;
      rewardLines = [`超過 ${MAX_ROUNDS} 回合未分勝負，戰鬥中止。\n你造成了 **${totalDamage}** 點傷害。`];
    }
    if (zoneKey === "elite" && monster?.isBoss) {
      rewardLines = [`🎯 鎖定部位：${session.worldBossTargetLabel || "軀幹"}${battleTargetNote ? `（${battleTargetNote}）` : ""}`, ...rewardLines];
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
      await recordQuestBattleProgress(sc, discordId, outcome, totalDamage, combatStats, session.playerStats?.weaponType || null);
    } catch (e) {
      console.error("[Quest] recordProgress error:", e.message);
    }

    // 戰鬥已結算，但先保留 session 至顯示完畢才刪除，避免期間重複出戰
    if (activeSessions.has(discordId)) activeSessions.get(discordId).state = "displaying";

    // ── 逐步顯示回合（每 ROUNDS_PER_TICK 回合更新一次）──
    const delay = (ms) => new Promise((r) => setTimeout(r, ms));
    const MAX_DESC = 3800;
    const tickDelay = calculateTickDelay(session.playerStats?.agi ?? 1);
    const displayRoundLogs = compactAuraSourceNames(roundLogs);

    for (let i = ROUNDS_PER_TICK; i < displayRoundLogs.length; i += ROUNDS_PER_TICK) {
      const soFar = displayRoundLogs.slice(0, i).join("\n\n");
      const truncated = soFar.length > MAX_DESC ? soFar.slice(0, MAX_DESC) + "\n…" : soFar;
      const progressEmbed = new EmbedBuilder()
        .setTitle(`⚔️ 戰鬥中 — 第 ${Math.min(i, displayRoundLogs.length)} 回合`)
        .setDescription(truncated + "\n\n⏳ 戰鬥繼續中...")
        .setColor(0xe74c3c);
      await interaction.editReply({ embeds: [progressEmbed], components: [] });
      await delay(tickDelay);
    }

    // ── 最終結果 ──
    const logText = displayRoundLogs.join("\n\n");
    const displayLog = logText.length > MAX_DESC
      ? logText.slice(0, MAX_DESC) + "\n…（部分回合已省略）"
      : logText;
    const resultBlock = rewardLines.length > 0 ? "\n\n" + rewardLines.join("\n") : "";

    const embed = new EmbedBuilder()
      .setTitle(embedTitle)
      .setDescription(displayLog + resultBlock)
      .setColor(embedColor);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(BTN.deleteLog).setLabel("🗑️ 刪除紀錄").setStyle(ButtonStyle.Secondary)
    );

    try {
      await interaction.editReply({ embeds: [embed], components: [row] });
    } catch (componentErr) {
      console.error("[monsterZoneHandlers] 編輯回覆失敗 (components):", componentErr.message);
      await interaction.editReply({ embeds: [embed], components: [] }).catch(() => {});
    }
    activeSessions.delete(discordId);  // 顯示完畢才解除鎖定，允許下一場出戰
  } catch (err) {
    activeSessions.delete(discordId);
    await interaction.editReply({ content: "❌ 戰鬥發生錯誤，請稍後再試。", embeds: [], components: [] });
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
async function handleMonsterKill({ discordId, displayName, session, monster, state, totalDamage = 0, zoneKey = "normal" }) {
  console.log(`[MonsterKill] called discordId=${discordId} monster=${monster?.name} zone=${zoneKey}`);
  const sc = getServiceContext();
  const rewardLines = [];

  if (zoneKey === "elite" && monster?.isBoss && !isWorldBossAllPartsDefeated(state?.worldBossPartsHp)) {
    rewardLines.push("目前僅擊破單一部位，世界王需三部位全破才會結算。");
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

  // 參戰名單（含擊殺者）
  const participants = [...new Set([...(Array.isArray(state.participants) ? state.participants : []), discordId])];

  if (zoneKey === "hard" && !monster?.isBoss && sc.worldBossService) {
    await sc.worldBossService.recordHardZoneKill(1).catch(() => {});
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
  // 合入本次擊殺者的傷害
  const mergedDmg = { ...rawDmgMap, [discordId]: { name: displayName, damage: (rawDmgMap[discordId]?.damage || 0) + totalDamage } };
  const totalDmgAll = participants.reduce((s, pid) => s + (mergedDmg[pid]?.damage || 0), 0);
  const dmgRatio = (pid) => totalDmgAll > 0 ? (mergedDmg[pid]?.damage || 0) / totalDmgAll : 1 / participants.length;

  // ── 不使用怪物等級做獎勵壓制 ──

  // 每位參戰者的獎勵紀錄（用來最後 DM 通知）
  const perPidRewards = {};
  participants.forEach(pid => { perPidRewards[pid] = { gold: 0, exp: 0, levelUps: 0, newLevel: 0, drops: [], healerGoldBonus: 0, healerExpBonus: 0, isHealer: false }; });

  // 預載參戰者資料，用於個人化結算倍率（金幣 / EXP / 掉落）
  const progressCache = {};
  await Promise.all(participants.map(async (pid) => {
    const prog = await sc.progressRepository.findByPlayerId(pid).catch(() => null);
    if (prog) progressCache[pid] = prog;
  }));
  const rewardModsByPid = {};
  await Promise.all(participants.map(async (pid) => {
    const prog = progressCache[pid];
    if (prog) {
      // 永遠從 DB 讀取最新 effects，確保獎勵加成使用最新設計值
      prog.equipment = await mergeEquippedFromLibrary(prog.equipment || {}, sc.itemRepository);
    }
    rewardModsByPid[pid] = buildRewardModifiers(prog);
  }));

  // ── 治療師徽章：治療師本人結算時額外 +10% 金幣與 EXP ──
  const healerBonusPids = new Set();
  for (const pid of participants) {
    const prog = progressCache[pid];
    if (!prog) continue;
    const jobEq = prog.equipment?.job_eq;
    if (!jobEq) continue;
    const jobId = String(jobEq.itemId || jobEq.id || "").toLowerCase();
    const jobName = String(jobEq.itemName || jobEq.name || "").toLowerCase();
    if (jobId.includes("healer") || jobName.includes("治療")) {
      healerBonusPids.add(pid);
      if (perPidRewards[pid]) perPidRewards[pid].isHealer = true;
      const mod = rewardModsByPid[pid];
      mod.goldPct    = (mod.goldPct    || 0) + 10;
      mod.expPct     = (mod.expPct     || 0) + 10;
      mod.goldMultiplier = toMultiplier(mod.goldPct);
      mod.expMultiplier  = toMultiplier(mod.expPct);
    }
  }

  // ── 金幣依比例分配 ──
  // 實際獎池 = max(goldReward, 參戰人數 × entryFee × 1.3)
  // 入場費回饋到獎池，保證參戰者平均小賺
  const entryFeePool = Math.round(participants.length * (monster.entryFee || 0) * 1.15);
  const effectiveGoldReward = Math.max(monster.goldReward || 0, entryFeePool);

  function buildCappedRatio(cap) {
    if (!cap || cap >= 1) {
      return { ratio: (pid) => dmgRatio(pid) };
    }
    const cappedRatios = {};
    let overflow = 0;
    for (const pid of participants) {
      const r = dmgRatio(pid);
      if (r > cap) { cappedRatios[pid] = cap; overflow += r - cap; }
      else { cappedRatios[pid] = r; }
    }
    const nonCappedTotal = participants.reduce((s, pid) => s + (cappedRatios[pid] < cap ? cappedRatios[pid] : 0), 0);
    if (overflow > 0 && nonCappedTotal > 0) {
      for (const pid of participants) {
        if (cappedRatios[pid] < cap) {
          cappedRatios[pid] += overflow * (cappedRatios[pid] / nonCappedTotal);
        }
      }
    }
    return { ratio: (pid) => cappedRatios[pid] ?? dmgRatio(pid) };
  }

  // 公平共鬥門檻：
  // 金幣：3 人以上才啟用 50% 上限
  // EXP：4 人以上才啟用 75% 上限（之後再套用組隊倍率）
  const goldRatio = buildCappedRatio(participants.length >= 3 ? 0.5 : 1);
  const expRatio = buildCappedRatio(participants.length >= 4 ? 0.75 : 1);

  let myBaseGoldShare = 0;
  if (effectiveGoldReward > 0) {
    const goldShares = {};
    for (const pid of participants) {
      goldShares[pid] = Math.round(effectiveGoldReward * goldRatio.ratio(pid));
    }

    for (const pid of participants) {
      const baseShare = Math.max(1, goldShares[pid] || 1);
      const mod = rewardModsByPid[pid] || { goldMultiplier: 1 };
      const share = Math.max(1, Math.round(baseShare * mod.goldMultiplier));
      try {
        await sc.rewardService.grantCurrency({
          discordId: pid, displayName: pid === discordId ? displayName : pid,
          currencyType: "gold", amount: share,
          source: CURRENCY_SOURCES.MONSTER_KILL_REWARD, operator: "monster_zone"
        });
        if (perPidRewards[pid]) perPidRewards[pid].gold = share;
      } catch (e) { console.error(`[MonsterZone] grantCurrency(gold) failed for ${pid}`, e); }
    }

    const myBaseShare = Math.max(1, goldShares[discordId] || 1);
    myBaseGoldShare = myBaseShare;
    const myMod = rewardModsByPid[discordId] || { goldMultiplier: 1, goldPct: 0 };
    const myShare = Math.max(1, Math.round(myBaseShare * myMod.goldMultiplier));
    const rawPct = Math.round(dmgRatio(discordId) * 100);
    const capPct = Math.round(goldRatio.ratio(discordId) * 100);
    const pct = rawPct !== capPct ? `${capPct}%（原${rawPct}%，已截斷）` : `${capPct}%`;
    const poolNote = entryFeePool > (monster.goldReward || 0) ? `（入場費加成）` : "";
    const modNote = myMod.goldPct > 0 ? `，個人加成 +${Math.round(myMod.goldPct)}%` : "";
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
    const expShares = {};
    for (const pid of participants) {
      expShares[pid] = Math.round(effectiveExpReward * expRatio.ratio(pid));
    }

    const myBaseShare = Math.max(1, expShares[discordId] || 1);
    myBaseExpShare = myBaseShare;
    const myMod = rewardModsByPid[discordId] || { expMultiplier: 1, expPct: 0 };
    const myShare = Math.max(1, Math.round(myBaseShare * myMod.expMultiplier));
    let killerLvLine = "";
    for (const pid of participants) {
      const baseShare = Math.max(1, expShares[pid] || 1);
      const mod = rewardModsByPid[pid] || { expMultiplier: 1 };
      const share = Math.max(1, Math.round(baseShare * mod.expMultiplier));
      try {
        const expResult = await sc.progressService.grantExp({
          discordId: pid, displayName: pid === discordId ? displayName : pid,
          amount: share, source: EXP_SOURCES.MONSTER_KILL
        });
        if (perPidRewards[pid]) {
          perPidRewards[pid].exp = share;
          if (expResult.levelUps > 0) {
            perPidRewards[pid].levelUps = expResult.levelUps;
            perPidRewards[pid].newLevel = expResult.progress?.level ?? 0;
          }
        }
        if (expResult.levelUps > 0) {
          const prevLevel = (expResult.progress?.level ?? 0) - expResult.levelUps;
          const pidName = pid === discordId ? displayName : (mergedDmg[pid]?.name || pid);
          _announceLevelMilestone(sc, pid, pidName, prevLevel, expResult.progress.level).catch(() => {});
        }
        if (pid === discordId && expResult.levelUps > 0) {
          killerLvLine = ` ✨ 升級 ${expResult.levelUps} 次！Lv.${expResult.progress.level}`;
        }
      } catch (e) {
        console.error(`[MonsterZone] grantExp failed for ${pid}`, e?.message || e);
        // 記錄失敗原因，幫助診斷 DM 通知與實際經驗值不符的問題
        if (!perPidRewards[pid]) perPidRewards[pid] = { gold: 0, exp: 0, levelUps: 0, newLevel: 0, drops: [] };
        perPidRewards[pid]._expGrantFailed = true;
      }
    }

    const rawPct = Math.round(dmgRatio(discordId) * 100);
    const capPct = Math.round(expRatio.ratio(discordId) * 100);
    const pct = rawPct !== capPct ? `${capPct}%（原${rawPct}%，已截斷）` : `${capPct}%`;
    const partyNote = partyMult > 1 ? `　👥 ×${partyMult}（${participants.length}人）` : "";
    const modNote = myMod.expPct > 0 ? `，個人加成 +${Math.round(myMod.expPct)}%` : "";
    rewardLines.push(`⭐ EXP +${myShare}（傷害佔比 ${pct}%，共 ${effectiveExpReward}${partyMult > 1 ? ` 原${monster.expReward}` : ""}${modNote}）${partyNote}${killerLvLine}`);
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
    const luckyProg = progressCache[luckyPid];
    const luckyMod = rewardModsByPid[luckyPid] || { dropMultiplier: 1, rareDropMultiplier: 1 };

    if (luckyProg) {
      if (!Array.isArray(luckyProg.inventory)) luckyProg.inventory = [];
      const droppedItems = [];
      const droppedItemObjects = [];

      for (const drop of monsterDropPool) {
        let item = await sc.itemRepository.findById(drop.itemId).catch(() => null);
        if (item) {
          const tier = String(item.tier || "").toUpperCase();
          const isRare = RARE_TIERS.has(tier);
          const chanceMult = luckyMod.dropMultiplier * (isRare ? luckyMod.rareDropMultiplier : 1);
          const finalChance = Math.min(100, Math.max(0, Number(drop.chance) * chanceMult));
          if (Math.random() * 100 < finalChance) {
            // 已擁有同件裝備 → 跳過（由參與獎勵機制補償）
            if (!isMonsterCardItem(item) && item.itemType !== 'consumable' && playerAlreadyOwnsItem(luckyProg, item.id)) {
              // skip duplicate
            } else {
              const equipStats = item.equipStats ? { ...item.equipStats } : {};

              luckyProg.inventory.push({
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
              });
              droppedItems.push(item.name);
              droppedItemObjects.push(item);
            }
          }
        }
      }

      if (droppedItems.length > 0) {
        luckyProg.updatedAt = new Date().toISOString();
        await sc.progressRepository.save(luckyProg);
        const allDropped = [...droppedItems];
        if (perPidRewards[luckyPid]) perPidRewards[luckyPid].drops = [...allDropped];
        const luckyName = luckyPid === discordId ? displayName : (mergedDmg[luckyPid]?.name || luckyPid);
        const isKiller = luckyPid === discordId;
        if (isKiller) {
          rewardLines.push(`🎁 道具掉落：${allDropped.join("、")}`);
          _announceDrops(sc, luckyPid, luckyName, monster.name, allDropped, "kill").catch(() => {});
        } else {
          _announceDrops(sc, luckyPid, luckyName, monster.name, allDropped, "group").catch(() => {});
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
          const tier = String(item.tier || "").toUpperCase();
          const isRare = RARE_TIERS.has(tier);
          const chanceMult = bonusMod.dropMultiplier * (isRare ? bonusMod.rareDropMultiplier : 1);
          const finalChance = Math.min(100, Math.max(0, Number(drop.chance) * chanceMult));
          if (Math.random() * 100 < finalChance) {
            // 已擁有同件裝備 → 跳過（由參與獎勵機制補償）
            if (!isMonsterCardItem(item) && item.itemType !== 'consumable' && playerAlreadyOwnsItem(bonusProg, item.id)) {
              // skip duplicate
            } else {
              const equipStats = item.equipStats ? { ...item.equipStats } : {};

              bonusProg.inventory.push({
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
                enhanceLevel: 0, source: "monster_drop_bonus", sourceRef: monster.name,
                purchasedAt: new Date().toISOString()
              });
              bonusItems.push(item.name);
              bonusItemObjects.push(item);
            }
          }
        }
      }
      if (bonusItems.length > 0) {
        bonusProg.updatedAt = new Date().toISOString();
        await sc.progressRepository.save(bonusProg);
        const allBonusDropped = [...bonusItems];
        if (perPidRewards[bonusPid]) perPidRewards[bonusPid].drops = [...(perPidRewards[bonusPid].drops || []), ...allBonusDropped];
        const bonusName = bonusPid === discordId ? displayName : (mergedDmg[bonusPid]?.name || bonusPid);
        _announceDrops(sc, bonusPid, bonusName, monster.name, allBonusDropped, kind).catch(() => {});
      }
    }
  }

  // ── 參與獎勵：每位參戰者有 5% 機率獲得該區域強化石（上限 C 階，DM 通知）──
  {
    const participationGemTier = ZONE_PARTICIPATION_GEM_TIER[zoneKey] || 'D';
    const participationGemId = ENHANCE_GEM_IDS[participationGemTier];
    if (participationGemId) {
      const gemItem = await sc.itemRepository.findById(participationGemId).catch(() => null);
      if (gemItem) {
        const participationRate = GEM_PARTICIPATION_RATE[participationGemTier] ?? 0.05;
        for (const pid of participants) {
          if (Math.random() >= participationRate) continue;
          const prog = progressCache[pid];
          if (!prog) continue;
          if (!Array.isArray(prog.inventory)) prog.inventory = [];
          if (!tryStackGem(prog, gemItem.id)) {
            prog.inventory.push({
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
          prog.updatedAt = new Date().toISOString();
          await sc.progressRepository.save(prog);
          if (perPidRewards[pid]) perPidRewards[pid].drops = [...(perPidRewards[pid].drops || []), gemItem.name];
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
  if (zoneKey === "elite" && monster?.isBoss && sc.worldBossService) {
    const resetParts = ensureWorldBossPartState({}, monster.calc.maxHp);
    const bossResetState = {
      ...freshState,
      currentHp: resetParts.currentHp,
      worldBossPartsHp: resetParts.worldBossPartsHp,
      worldBossPartsMaxHp: resetParts.worldBossPartsMaxHp,
      activeMonsterSeq: monster.seq,
      killCount: newKillCount,
      participants: [],
      damageMap: {},
      killClaimedSeq: null,
      activeHealerAura: null,
      activeEvent: null
    };
    await sc.monsterService.saveState(bossResetState, zoneKey);
    await sc.worldBossService.markBossKilled().catch(() => {});
    const timeoutTimer = worldBossTimeoutTimers.get(zoneKey);
    if (timeoutTimer) {
      clearTimeout(timeoutTimer);
      worldBossTimeoutTimers.delete(zoneKey);
    }
    _republishPanel(sc, zoneKey, monster, bossResetState.currentHp, 0, {}, null, bossResetState.worldBossPartsHp).catch(() => {});

    _notifyKillRewards(monster.name, perPidRewards, discordId).catch((e) => console.error("[NotifyKill] top-level error:", e?.message || e));

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
        killClaimedSeq: null,
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
      _republishPanel(sc, zoneKey, null, 0, 0, {}, eventState.activeEvent).catch(() => {});
      _scheduleZoneEventFinalize(sc, zoneKey, endsAt);
    } else {
      const pickedMonster = chosenMonster || nextMonster;
      zoneLastChosen.set(zoneKey, { type: "monster", id: pickedMonster?.id || monster.id });
      const newState = {
        ...freshState,
        currentHp: pickedMonster ? pickedMonster.calc.maxHp : 0,
        activeMonsterSeq: pickedMonster ? pickedMonster.seq : freshState.activeMonsterSeq,
        killCount: newKillCount,
        participants: [],
        damageMap: {},
        killClaimedSeq: null,
        activeHealerAura: null,
        activeEvent: null
      };
      await sc.monsterService.saveState(newState, zoneKey);

      if (pickedMonster) {
        _republishPanel(sc, zoneKey, pickedMonster, pickedMonster.calc.maxHp, 0, {}).catch(() => {});
        if (pickedMonster.isBoss) {
          console.log(`[BOSS] next monster "${pickedMonster.name}" is a boss, broadcasting...`);
          _broadcastBossSpawn(sc, zoneKey, pickedMonster).catch((e) => console.error("[BOSS] top-level catch:", e));
        }
      } else {
        _republishPanel(sc, zoneKey, null, 0, 0, finalDamageMap).catch(() => {});
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
        killClaimedSeq: null,
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
      _republishPanel(sc, zoneKey, null, 0, 0, {}, eventState.activeEvent).catch(() => {});
      _scheduleZoneEventFinalize(sc, zoneKey, endsAt);
    } else {
      const newState = {
        ...freshState,
        currentHp: nextMonster ? nextMonster.calc.maxHp : 0,
        activeMonsterSeq: nextMonster ? nextMonster.seq : freshState.activeMonsterSeq,
        killCount: newKillCount,
        participants: [],
        damageMap: {},
        killClaimedSeq: null,
        activeEvent: null
      };
      await sc.monsterService.saveState(newState, zoneKey);

      if (nextMonster) {
        _republishPanel(sc, zoneKey, nextMonster, nextMonster.calc.maxHp, 0, {}).catch(() => {});
        if (nextMonster.isBoss) {
          console.log(`[BOSS] next monster "${nextMonster.name}" is a boss, broadcasting...`);
          _broadcastBossSpawn(sc, zoneKey, nextMonster).catch((e) => console.error("[BOSS] top-level catch:", e));
        }
      } else {
        _republishPanel(sc, zoneKey, null, 0, 0, finalDamageMap).catch(() => {});
      }
    }
  }

  // 通知參戰獎勵（DM）
  _notifyKillRewards(monster.name, perPidRewards, discordId).catch((e) => console.error("[NotifyKill] top-level error:", e?.message || e));

  // 推送 SSE reward 事件給所有參戰者（web 端通知紀錄）
  try {
    const pushReward = sc._pushRewardToPlayer;
    if (typeof pushReward === "function") {
      for (const [pid, rewards] of Object.entries(perPidRewards)) {
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
  else if (customId === BTN.startFight) {
    // 已廢棄（戰鬥在 handleEnterBattle 中自動執行），但保留以防止錯誤
    await interaction.deferUpdate();
    await interaction.editReply({ content: "❌ 此操作已廢棄。請重新點擊進入戰鬥。", embeds: [], components: [] });
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
      const found = inv.find(it => (String(it.itemId || it.id) === String(wantId) || String(it.itemName || '').includes(wantId)) && (Number(it.enhanceLevel || it.enhance || 0) >= wantEnh));
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
      const idx = prog.inventory.findIndex(it => (String(it.itemId || it.id) === String(wantId) || String(it.itemName || '').includes(wantId)) && (Number(it.enhanceLevel || it.enhance || 0) >= wantEnh));
      if (idx === -1) {
        const itemObj = await sc.itemService.getItemById(wantId).catch(() => null);
        const displayName = itemObj ? itemObj.name : wantId;
        results.push(`你沒有我所需的 ${displayName}`);
      } else {
        const removed = prog.inventory.splice(idx, 1)[0];
        prog.updatedAt = new Date().toISOString();
        await sc.progressRepository.save(prog);
        results.push(`已移除 ${removed.itemName || removed.itemId || wantId}`);
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

    // 處理效果
    if (Array.isArray(option.effects) && option.effects.length > 0) {
      // TODO: 實裝效果系統（給 buff / item）
      responseMsg += "\n✨ 效果發動中...";
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
      console.log(`[IdleRotate] disabled by DISABLE_AUTO_ROTATE`);
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
    if (zoneKey === "elite" && next.isBoss && sc.worldBossService) {
      const partMax = createWorldBossPartHpTemplate(next.calc.maxHp);
      newState.worldBossPartsMaxHp = partMax;
      newState.worldBossPartsHp = { ...partMax };
      const wbState = await sc.worldBossService._getStateEnsured().catch(() => null);
      if (wbState?.battleStartedAt) {
        // 有人曾開戰但沒打完，視為失敗，重置解鎖進度
        await sc.worldBossService.markBossFailedTimeout().catch(() => {});
        console.log(`[IdleRotate] elite world boss failed — parts & unlock progress cleared`);
      } else {
        // 純閒置，只重置部位 HP，不動解鎖進度
        console.log(`[IdleRotate] elite world boss idle reset — parts HP only`);
      }
    }

    await sc.monsterService.saveState(newState, zoneKey);
    _republishPanel(sc, zoneKey, next, next.calc.maxHp, 0, {}).catch(() => {});
    // 精英區 Boss 由解鎖流程觸發廣播，idle rotate 不廣播
    if (next.isBoss && zoneKey !== "elite") _broadcastBossSpawn(sc, zoneKey, next).catch(() => {});

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
    console.log(`[IdleRotate] zone=${zoneKey} rotated from ${monster.name} → ${next.name}`);
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
  setInterval(checkIdleRotate, 60 * 1000); // 每分鐘檢查一次
  console.log("[IdleRotate] timer started (10min idle → auto rotate)");
}

async function refreshEliteWorldBossPanel() {
  try {
    const sc = getServiceContext();
    // 只有高級區有人在打時才刷新精英區世界BOSS面板
    const hardState = await sc.monsterService.getState("hard").catch(() => null);
    const hardParticipants = Array.isArray(hardState?.participants) ? hardState.participants : [];
    if (hardParticipants.length === 0) return;

    const eliteState = await sc.monsterService.getState("elite").catch(() => null);
    if (!eliteState?.currentMonster) return;

    const monster = eliteState.currentMonster;
    const monsterHp = eliteState.currentHp ?? monster.hp ?? 0;
    const damageMap = eliteState.damageMap || {};
    const participantCount = Array.isArray(eliteState.participants) ? eliteState.participants.length : 0;
    const activeEvent = eliteState.activeEvent || null;
    const worldBossPartsHp = eliteState.worldBossPartsHp || null;

    await _republishPanel(sc, "elite", monster, monsterHp, participantCount, damageMap, activeEvent, worldBossPartsHp);
  } catch (error) {
    console.warn(`[ElitePanel] auto-refresh failed: ${error?.message || error}`);
  }
}

module.exports = {
  handleMonsterZoneButton,
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
  activeSessions,
  startIdleRotateTimer,
  refreshEliteWorldBossPanel
};
