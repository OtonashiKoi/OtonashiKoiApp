"use strict";

const { MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require("discord.js");
const { EFFECT_NAME_ZH } = require("../../shared/effectDisplayNames");

// 這些效果的 params.value 代表百分比（percent），顯示時會特別格式化
const PERCENT_EFFECT_KEYS = new Set([
  'gold_gain_up', 'exp_gain_up', 'drop_rate_up', 'rare_drop_rate_up', 'monster_reward_up', 'checkin_bonus_up', 'enhance_success_up', 'event_trigger_rate_up'
]);
const { CURRENCY_SOURCES, EXP_SOURCES } = require("../../shared/sources");
const { calcPlayerStats } = require("../../shared/combatStats");
const { isEffectConditionMet, collectEquipmentEffects, applyEffectInstances, decrementActiveEffects } = require("../../shared/effectEngine");

// 戰鬥 session 依 discordId 儲存（記憶體）
const activeSessions = new Map();

// 死亡冷卻記錄：key = discordId, value = { deathTime: timestamp, cooldownMs: 25000 }
const deathCooldowns = new Map();

// 擊殺結算互斥鎖（防止兩名玩家同時打死同一隻怪造成雙重結算）
// key: `${zoneKey}:${monsterSeq}`
const killInProgress = new Set();
const zoneEventTimers = new Map();
// track last chosen candidate per zone to avoid immediate repeats
const zoneLastChosen = new Map();

const BTN = {
  enterBattle: "monster-zone:enter-battle",
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

// 強化寶石 ID 對應表
const ENHANCE_GEM_IDS = {
  'D': '72fde92d-e33f-42fb-8d86-2e811d03f84d',
  'C': '556db9e1-b084-4b22-bab5-a66c2b586184',
  'B': '8fdfa7d9-f0fa-4e6a-a291-703b1e354072',
  'A': 'a6ae293d-52fc-4af5-8770-891ddf842e35'
};

function getServiceContext() {
  return require("../runtimeContext").serviceContext;
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
 * 根據掉落物品的品階，判斷是否應賦予強化寶石
 * 只有當玩家身上已經有該品階的裝備，且掉落的物品中也有該品階的裝備時，才賦予
 */
function getGemsToAwardFromDrops(droppedItems, progress) {
  const gemsToAward = new Set();
  const playerTiers = getPlayerEquippedTiers(progress);

  // 獲取掉落物品中的所有非消耗品的品階
  const droppedEquipmentTiers = new Set();
  for (const item of droppedItems) {
    if (item && item.itemType !== 'consumable' && item.tier) {
      const tier = String(item.tier || '').toUpperCase();
      droppedEquipmentTiers.add(tier);
    }
  }

  // 只有當玩家身上有該品階的裝備，且掉落的物品中也有時，才賦予
  for (const tier of droppedEquipmentTiers) {
    if (playerTiers.has(tier) && ENHANCE_GEM_IDS[tier]) {
      gemsToAward.add(ENHANCE_GEM_IDS[tier]);
    }
  }

  return Array.from(gemsToAward);
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
function featureKeyToZone(featureKey) {
  return featureKey === "monster_zone_mid" ? "mid" : "normal";
}
async function getZoneFromChannel(sc, channelId) {
  const layout = await sc.channelLayoutRepository.get();
  const binding = (layout?.discord?.bindings || []).find(
    (b) => b.channelId === channelId && b.featureKey?.startsWith("monster_zone")
  );
  if (!binding) return null;
  return featureKeyToZone(binding.featureKey);
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

async function _republishPanel(sc, zoneKey, monster, monsterHp, participantCount, damageMap = {}, activeEvent = null) {
  // 添加冷卻時間信息到 damageMap
  const damageMapWithCooldown = {};
  for (const [key, entry] of Object.entries(damageMap)) {
    const cooldownRemaining = getRemainingCooldown(key);
    damageMapWithCooldown[key] = {
      ...entry,
      cooldownRemaining: cooldownRemaining > 0 ? cooldownRemaining : 0
    };
  }

  const featureKey = zoneKey === "mid" ? "monster_zone_mid" : "monster_zone";
  const layout = await sc.channelLayoutRepository.get();
  const binding = (layout?.discord?.bindings || []).find((b) => b.featureKey === featureKey);
  if (binding?.channelId) {
    await sc.adminConsoleService.publishMonsterZonePanel(
      binding.channelId, monster, monsterHp, { participantCount, damageMap: damageMapWithCooldown, activeEvent }
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

    const zoneName = zoneKey === "mid" ? "中級戰鬥區" : "一般戰鬥區";
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

    // 中級區等級限制
    let cachedProgress = null;
    if (zoneKey === "mid") {
      cachedProgress = await sc.progressRepository.findByPlayerId(discordId);
      const playerLevel = cachedProgress?.level ?? 1;
      if (playerLevel < 10) {
        await interaction.editReply({ content: `🔒 **中級區**需要 **Lv.10** 以上才能進入！
目前等級：**Lv.${playerLevel}**` });
        return;
      }
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
    const monsterHp = state.currentHp != null ? state.currentHp : monster.calc.maxHp;

    const progress = cachedProgress ?? await sc.progressRepository.findByPlayerId(discordId);
    const attrs = progress?.attributes || { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 };
    const equipped = progress?.equipment || {};
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
      entryFee: monster.entryFee, timeoutId: null
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
      await sc.monsterService.saveState({ ...state, currentHp: monsterHp, participants: newParticipants, lastHitAt: new Date().toISOString() }, zoneKey);
      const layout = await sc.channelLayoutRepository.get();
      const featureKey = zoneKey === "mid" ? "monster_zone_mid" : "monster_zone";
      const binding = (layout?.discord?.bindings || []).find((b) => b.featureKey === featureKey);
      if (binding?.channelId) {
        sc.adminConsoleService
          .publishMonsterZonePanel(binding.channelId, monster, monsterHp, { participantCount: newParticipants.length, damageMap: state.damageMap || {} })
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

      session.monsterHp = battleState.currentHp != null ? battleState.currentHp : session.monsterMaxHp;

      // ── 自動跑完所有回合 ──
      // 蒐集當前參戰者中對 party 生效的 aura（由已在場的治療師等提供）
      const participants = Array.isArray(battleState.participants) ? battleState.participants : [];
      const partyEffects = [];
      await Promise.all(participants.map(async (pid) => {
        try {
          const prog = await sc.progressRepository.findByPlayerId(pid).catch(() => null);
          if (!prog) return;
          const equipped = prog.equipment || {};
          // 收集該玩家裝備中所有可能對隊伍生效的效果（passive/combat 等）
          const refs = collectEquipmentEffects(equipped, null, { equipped, inventory: prog.inventory || [] });
          for (const r of refs) {
            if (r && r.target === 'party') partyEffects.push(r);
          }
        } catch (e) {}
      }));

      // ── 治療師光環：若存在且不在 participants 中，疊加光環效果 ──
      const aura = battleState.activeHealerAura;
      if (aura && aura.effects && !participants.includes(aura.discordId)) {
        for (const e of aura.effects) {
          partyEffects.push(e);
        }
      }

      const currentProg = await sc.progressRepository.findByPlayerId(discordId).catch(() => null);
      const currentEquipped = (currentProg && currentProg.equipment) ? currentProg.equipment : {};

      const { runCombatLoop } = require("../../shared/combatLoop");
      const { outcome, roundLogs, totalDamage, finalMonsterHp, finalPlayerHp } =
        runCombatLoop(session.playerStats, session.monsterStats, session.monsterName, session.monsterHp, MAX_ROUNDS, { equipped: currentEquipped, inventory: currentProg?.inventory || [], partyEffects });
      session.monsterHp = finalMonsterHp;
      session.playerHp  = finalPlayerHp;
      const totalTaken = Math.max(0, (session.playerMaxHp || 0) - Math.max(0, finalPlayerHp));

      // ── 結算 ──
      let rewardLines = [];
      let embedTitle, embedColor;
      const currentParticipants = Array.isArray(battleState.participants) ? battleState.participants : [];

      if (outcome === "win") {
        session.monsterHp = 0;
        rewardLines = await handleMonsterKill({ discordId, displayName, session, monster, state: battleState, totalDamage, zoneKey });
        embedTitle = "🏆 勝利！";
        embedColor = 0xf1c40f;
      } else if (outcome === "lose") {
        session.monsterHp = Math.max(0, session.monsterHp);
        let damageMap = {};
        try {
          const freshState = await sc.monsterService.getState(zoneKey);
          const prev = freshState.damageMap || {};
          damageMap = {
            ...prev,
            [discordId]: {
              name: displayName,
              damage: (prev[discordId]?.damage || 0) + totalDamage,
              taken: (prev[discordId]?.taken || 0) + totalTaken,
            }
          };
          await sc.monsterService.saveState({ ...freshState, currentHp: session.monsterHp, damageMap, lastHitAt: new Date().toISOString() }, zoneKey);
        } catch (e) {
          await sc.monsterService.saveState({ ...battleState, currentHp: session.monsterHp, lastHitAt: new Date().toISOString() }, zoneKey);
        }

        // 記錄死亡冷卻
        recordDeathCooldown(discordId);

        embedTitle = "💀 戰鬥失敗";
        embedColor = 0x555555;
        rewardLines = [
          `你被 **${session.monsterName}** 擊倒了！`,
          session.entryFee > 0 ? `入場費 **${session.entryFee}** 🪙 已損失，下次加油！` : "下次加油！",
          `⏳ 冷卻中... 25 秒後可再次進場。`
        ];
        _republishPanel(sc, zoneKey, battleMonster, session.monsterHp, currentParticipants.length, damageMap).catch(() => {});
      } else {
        let damageMap = {};
        try {
          const freshState = await sc.monsterService.getState(zoneKey);
          const prev = freshState.damageMap || {};
          damageMap = {
            ...prev,
            [discordId]: {
              name: displayName,
              damage: (prev[discordId]?.damage || 0) + totalDamage,
              taken: (prev[discordId]?.taken || 0) + totalTaken,
            }
          };
          await sc.monsterService.saveState({ ...freshState, currentHp: session.monsterHp, damageMap, lastHitAt: new Date().toISOString() }, zoneKey);
        } catch (e) {
          await sc.monsterService.saveState({ ...battleState, currentHp: session.monsterHp, lastHitAt: new Date().toISOString() }, zoneKey);
        }
        embedTitle = "⏸️ 戰鬥超時";
        embedColor = 0x888888;
        rewardLines = [`超過 ${MAX_ROUNDS} 回合未分勝負，戰鬥中止。`];
        _republishPanel(sc, zoneKey, battleMonster, session.monsterHp, currentParticipants.length, damageMap).catch(() => {});
      }

      if (currentProg && Array.isArray(currentProg.activeEffects) && currentProg.activeEffects.length > 0) {
        const nextActiveEffects = decrementActiveEffects(currentProg.activeEffects, "battle", 1);
        if (nextActiveEffects.length !== currentProg.activeEffects.length) {
          currentProg.activeEffects = nextActiveEffects;
          currentProg.updatedAt = new Date().toISOString();
          await sc.progressRepository.save(currentProg);
        }
      }

      // 戰鬥已結算，但先保留 session 至顯示完畢才刪除，避免期間重複出戰
      if (activeSessions.has(discordId)) activeSessions.get(discordId).state = "displaying";

      // ── 逐步顯示回合（每 ROUNDS_PER_TICK 回合更新一次）──
      const delay = (ms) => new Promise((r) => setTimeout(r, ms));
      const MAX_DESC = 3800;
      const tickDelay = calculateTickDelay(session.playerStats?.agi ?? 1);

      for (let i = ROUNDS_PER_TICK; i < roundLogs.length; i += ROUNDS_PER_TICK) {
        const soFar = roundLogs.slice(0, i).join("\n\n");
        const truncated = soFar.length > MAX_DESC ? soFar.slice(0, MAX_DESC) + "\n…" : soFar;
        const progressEmbed = new EmbedBuilder()
          .setTitle(`⚔️ 戰鬥中 — 第 ${Math.min(i, roundLogs.length)} 回合`)
          .setDescription(truncated + "\n\n⏳ 戰鬥繼續中...")
          .setColor(0xe74c3c);
        await interaction.editReply({ embeds: [progressEmbed], components: [] });
        await delay(tickDelay);
      }

      // ── 最終結果 ──
      const logText = roundLogs.join("\n\n");
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

    session.monsterHp = state.currentHp != null ? state.currentHp : session.monsterMaxHp;

    // ── 自動跑完所有回合 ──
    // 蒐集當前參戰者中對 party 生效的 aura（由已在場的治療師等提供）
    const participants = Array.isArray(state.participants) ? state.participants : [];
    const partyEffects = [];
    await Promise.all(participants.map(async (pid) => {
      try {
        const prog = await sc.progressRepository.findByPlayerId(pid).catch(() => null);
        if (!prog) return;
        const equipped = prog.equipment || {};
        // 收集該玩家裝備中所有可能對隊伍生效的效果（passive/combat 等）
        const refs = collectEquipmentEffects(equipped, null, { equipped, inventory: prog.inventory || [] });
        for (const r of refs) {
          if (r && r.target === 'party') partyEffects.push(r);
        }
      } catch (e) {}
    }));

    // ── 治療師光環：若存在且不在 participants 中，疊加光環效果 ──
    const aura = state.activeHealerAura;
    if (aura && aura.effects && !participants.includes(aura.discordId)) {
      for (const e of aura.effects) {
        partyEffects.push(e);
      }
    }

    const currentProg = await sc.progressRepository.findByPlayerId(discordId).catch(() => null);
    const currentEquipped = (currentProg && currentProg.equipment) ? currentProg.equipment : {};

    const { runCombatLoop } = require("../../shared/combatLoop");
    const { outcome, roundLogs, totalDamage, finalMonsterHp, finalPlayerHp } =
      runCombatLoop(session.playerStats, session.monsterStats, session.monsterName, session.monsterHp, MAX_ROUNDS, { equipped: currentEquipped, inventory: currentProg?.inventory || [], partyEffects });
    session.monsterHp = finalMonsterHp;
    session.playerHp  = finalPlayerHp;
    const totalTaken = Math.max(0, (session.playerMaxHp || 0) - Math.max(0, finalPlayerHp));

    // ── 結算 ──
    let rewardLines = [];
    let embedTitle, embedColor;
    const currentParticipants = Array.isArray(state.participants) ? state.participants : [];

    if (outcome === "win") {
      session.monsterHp = 0;
      rewardLines = await handleMonsterKill({ discordId, displayName, session, monster, state, totalDamage, zoneKey });
      embedTitle = "🏆 勝利！";
      embedColor = 0xf1c40f;
    } else if (outcome === "lose") {
      session.monsterHp = Math.max(0, session.monsterHp);
      let damageMap = {};
      try {
        const freshState = await sc.monsterService.getState(zoneKey);
        const prev = freshState.damageMap || {};
        damageMap = {
          ...prev,
          [discordId]: {
            name: displayName,
            damage: (prev[discordId]?.damage || 0) + totalDamage,
            taken: (prev[discordId]?.taken || 0) + totalTaken,
          }
        };
        await sc.monsterService.saveState({ ...freshState, currentHp: session.monsterHp, damageMap, lastHitAt: new Date().toISOString() }, zoneKey);
      } catch (e) {
        await sc.monsterService.saveState({ ...state, currentHp: session.monsterHp, lastHitAt: new Date().toISOString() }, zoneKey);
      }

      // 記錄死亡冷卻
      recordDeathCooldown(discordId);

      embedTitle = "💀 戰鬥失敗";
      embedColor = 0x555555;
      rewardLines = [
        `你被 **${session.monsterName}** 擊倒了！`,
        session.entryFee > 0 ? `入場費 **${session.entryFee}** 🪙 已損失，下次加油！` : "下次加油！",
        `⏳ 冷卻中... 25 秒後可再次進場。`
      ];
      _republishPanel(sc, zoneKey, monster, session.monsterHp, currentParticipants.length, damageMap).catch(() => {});
    } else {
      let damageMap = {};
      try {
        const freshState = await sc.monsterService.getState(zoneKey);
        const prev = freshState.damageMap || {};
        damageMap = {
          ...prev,
          [discordId]: {
            name: displayName,
            damage: (prev[discordId]?.damage || 0) + totalDamage,
            taken: (prev[discordId]?.taken || 0) + totalTaken,
          }
        };
        await sc.monsterService.saveState({ ...freshState, currentHp: session.monsterHp, damageMap, lastHitAt: new Date().toISOString() }, zoneKey);
      } catch (e) {
        await sc.monsterService.saveState({ ...state, currentHp: session.monsterHp, lastHitAt: new Date().toISOString() }, zoneKey);
      }
      embedTitle = "⏸️ 戰鬥超時";
      embedColor = 0x888888;
      rewardLines = [`超過 ${MAX_ROUNDS} 回合未分勝負，戰鬥中止。`];
      _republishPanel(sc, zoneKey, monster, session.monsterHp, currentParticipants.length, damageMap).catch(() => {});
    }

    if (currentProg && Array.isArray(currentProg.activeEffects) && currentProg.activeEffects.length > 0) {
      const nextActiveEffects = decrementActiveEffects(currentProg.activeEffects, "battle", 1);
      if (nextActiveEffects.length !== currentProg.activeEffects.length) {
        currentProg.activeEffects = nextActiveEffects;
        currentProg.updatedAt = new Date().toISOString();
        await sc.progressRepository.save(currentProg);
      }
    }

    // 戰鬥已結算，但先保留 session 至顯示完畢才刪除，避免期間重複出戰
    if (activeSessions.has(discordId)) activeSessions.get(discordId).state = "displaying";

    // ── 逐步顯示回合（每 ROUNDS_PER_TICK 回合更新一次）──
    const delay = (ms) => new Promise((r) => setTimeout(r, ms));
    const MAX_DESC = 3800;
    const tickDelay = calculateTickDelay(session.playerStats?.agi ?? 1);

    for (let i = ROUNDS_PER_TICK; i < roundLogs.length; i += ROUNDS_PER_TICK) {
      const soFar = roundLogs.slice(0, i).join("\n\n");
      const truncated = soFar.length > MAX_DESC ? soFar.slice(0, MAX_DESC) + "\n…" : soFar;
      const progressEmbed = new EmbedBuilder()
        .setTitle(`⚔️ 戰鬥中 — 第 ${Math.min(i, roundLogs.length)} 回合`)
        .setDescription(truncated + "\n\n⏳ 戰鬥繼續中...")
        .setColor(0xe74c3c);
      await interaction.editReply({ embeds: [progressEmbed], components: [] });
      await delay(tickDelay);
    }

    // ── 最終結果 ──
    const logText = roundLogs.join("\n\n");
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
  const sc = getServiceContext();
  const rewardLines = [];

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

  // ── 依傷害比例計算每人分配量 ──
  const rawDmgMap = state.damageMap || {};
  // 合入本次擊殺者的傷害
  const mergedDmg = { ...rawDmgMap, [discordId]: { name: displayName, damage: (rawDmgMap[discordId]?.damage || 0) + totalDamage } };
  const totalDmgAll = participants.reduce((s, pid) => s + (mergedDmg[pid]?.damage || 0), 0);
  const dmgRatio = (pid) => totalDmgAll > 0 ? (mergedDmg[pid]?.damage || 0) / totalDmgAll : 1 / participants.length;

  // ── 不使用怪物等級做獎勵壓制 ──

  // 每位參戰者的獎勵紀錄（用來最後 DM 通知）
  const perPidRewards = {};
  participants.forEach(pid => { perPidRewards[pid] = { gold: 0, exp: 0, levelUps: 0, newLevel: 0, drops: [] }; });

  // 預載參戰者資料，用於個人化結算倍率（金幣 / EXP / 掉落）
  const progressCache = {};
  await Promise.all(participants.map(async (pid) => {
    const prog = await sc.progressRepository.findByPlayerId(pid).catch(() => null);
    if (prog) progressCache[pid] = prog;
  }));
  const rewardModsByPid = {};
  participants.forEach((pid) => {
    rewardModsByPid[pid] = buildRewardModifiers(progressCache[pid]);
  });

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

  if (effectiveExpReward > 0) {
    const expShares = {};
    for (const pid of participants) {
      expShares[pid] = Math.round(effectiveExpReward * expRatio.ratio(pid));
    }

    const myBaseShare = Math.max(1, expShares[discordId] || 1);
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
      } catch (e) { console.error(`[MonsterZone] grantExp failed for ${pid}`, e); }
    }

    const rawPct = Math.round(dmgRatio(discordId) * 100);
    const capPct = Math.round(expRatio.ratio(discordId) * 100);
    const pct = rawPct !== capPct ? `${capPct}%（原${rawPct}%，已截斷）` : `${capPct}%`;
    const partyNote = partyMult > 1 ? `　👥 ×${partyMult}（${participants.length}人）` : "";
    const modNote = myMod.expPct > 0 ? `，個人加成 +${Math.round(myMod.expPct)}%` : "";
    rewardLines.push(`⭐ EXP +${myShare}（傷害佔比 ${pct}%，共 ${effectiveExpReward}${partyMult > 1 ? ` 原${monster.expReward}` : ""}${modNote}）${partyNote}${killerLvLine}`);
  }

  // ── 道具掉落：從所有參戰者中抽一人，再骰各道具掉落率 ──
  // 規則：1. 從 participants 隨機抽出一位幸運者
  //        2. 幸運者對每個掉落項目各自骰 chance%
  //        3. 骰中的道具進入幸運者背包
  if (Array.isArray(monster.drops) && monster.drops.length > 0 && participants.length > 0) {
    // 抽幸運者
    const luckyIdx = Math.floor(Math.random() * participants.length);
    const luckyPid = participants[luckyIdx];
    const luckyProg = progressCache[luckyPid];
    const luckyMod = rewardModsByPid[luckyPid] || { dropMultiplier: 1, rareDropMultiplier: 1 };

    if (luckyProg) {
      if (!Array.isArray(luckyProg.inventory)) luckyProg.inventory = [];
      const droppedItems = [];
      const droppedItemObjects = [];

      for (const drop of monster.drops) {
        let item = await sc.itemRepository.findById(drop.itemId).catch(() => null);
        if (item) {
          const tier = String(item.tier || "").toUpperCase();
          const isRare = RARE_TIERS.has(tier);
          const chanceMult = luckyMod.dropMultiplier * (isRare ? luckyMod.rareDropMultiplier : 1);
          const finalChance = Math.min(100, Math.max(0, Number(drop.chance) * chanceMult));
          if (Math.random() * 100 < finalChance) {
            luckyProg.inventory.push({
              uuid: crypto.randomUUID(), itemId: item.id, itemName: item.name,
              itemEffect: item.effect || { type: "none", value: 0 },
              useEffects: item.useEffects || [],
              passiveEffects: item.passiveEffects || [],
              procEffects: item.procEffects || [],
              combatEffects: item.combatEffects || [],
              itemType: item.itemType || "consumable",
              imageUrl: item.imageUrl || null, imageThumbnailUrl: item.imageThumbnailUrl || null,
              equipSlot: item.equipSlot || null, equipStats: item.equipStats || null,
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

      // 根據掉落物品決定是否賦予強化寶石
      const gemIdsToAward = getGemsToAwardFromDrops(droppedItemObjects, luckyProg);
      const droppedGems = [];
      for (const gemId of gemIdsToAward) {
        const gemItem = await sc.itemRepository.findById(gemId).catch(() => null);
        if (gemItem) {
          luckyProg.inventory.push({
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
            source: "monster_drop_bonus_gem", sourceRef: monster.name,
            purchasedAt: new Date().toISOString()
          });
          droppedGems.push(gemItem.name);
        }
      }

      if (droppedItems.length > 0 || droppedGems.length > 0) {
        luckyProg.updatedAt = new Date().toISOString();
        await sc.progressRepository.save(luckyProg);
        const allDropped = [...droppedItems, ...droppedGems];
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
      for (const drop of monster.drops) {
        let item = await sc.itemRepository.findById(drop.itemId).catch(() => null);
        if (item) {
          const tier = String(item.tier || "").toUpperCase();
          const isRare = RARE_TIERS.has(tier);
          const chanceMult = bonusMod.dropMultiplier * (isRare ? bonusMod.rareDropMultiplier : 1);
          const finalChance = Math.min(100, Math.max(0, Number(drop.chance) * chanceMult));
          if (Math.random() * 100 < finalChance) {
            bonusProg.inventory.push({
              uuid: crypto.randomUUID(), itemId: item.id, itemName: item.name,
              itemEffect: item.effect || { type: "none", value: 0 },
              useEffects: item.useEffects || [],
              passiveEffects: item.passiveEffects || [],
              procEffects: item.procEffects || [],
              combatEffects: item.combatEffects || [],
              itemType: item.itemType || "consumable",
              imageUrl: item.imageUrl || null, imageThumbnailUrl: item.imageThumbnailUrl || null,
              equipSlot: item.equipSlot || null, equipStats: item.equipStats || null,
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
      // 根據掉落物品決定是否賦予強化寶石
      const bonusGemIds = getGemsToAwardFromDrops(bonusItemObjects, bonusProg);
      const bonusGems = [];
      for (const gemId of bonusGemIds) {
        const gemItem = await sc.itemRepository.findById(gemId).catch(() => null);
        if (gemItem) {
          bonusProg.inventory.push({
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
            source: "monster_drop_bonus_gem", sourceRef: monster.name,
            purchasedAt: new Date().toISOString()
          });
          bonusGems.push(gemItem.name);
        }
      }

      if (bonusItems.length > 0 || bonusGems.length > 0) {
        bonusProg.updatedAt = new Date().toISOString();
        await sc.progressRepository.save(bonusProg);
        const allBonusDropped = [...bonusItems, ...bonusGems];
        if (perPidRewards[bonusPid]) perPidRewards[bonusPid].drops = [...(perPidRewards[bonusPid].drops || []), ...allBonusDropped];
        const bonusName = bonusPid === discordId ? displayName : (mergedDmg[bonusPid]?.name || bonusPid);
        _announceDrops(sc, bonusPid, bonusName, monster.name, allBonusDropped, kind).catch(() => {});
      }
    }
  }

  // 擊殺數 + 推進下一隻怪物
  const newKillCount = { ...(state.killCount || {}), [monster.id]: ((state.killCount?.[monster.id] || 0) + 1) };
  // 取最新 state 以免多人並發時覆蓋其他人的 damageMap
  const freshState = await sc.monsterService.getState(zoneKey);
  const finalDamageMap = { ...(freshState.damageMap || {}), ...mergedDmg };

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

  // 通知非擊殺者參戰獎勵（DM，擊殺者已在戰鬥 embed 看到）
  _notifyKillRewards(monster.name, perPidRewards, discordId).catch(() => {});

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
  if (customId === BTN.enterBattle)     await handleEnterBattle(interaction);
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
  const zoneKey = binding && binding.featureKey === "monster_zone_mid" ? "mid" : "normal";

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
  const zoneKey = binding && binding.featureKey === "monster_zone_mid" ? "mid" : "normal";

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
  const zoneTheme = zoneKey === "mid"
    ? { label: "中級區", color: 0x7c3aed, emoji: "✦", tagline: "危險上升，獵物更強。" }
    : { label: "初級區", color: 0xe74c3c, emoji: "◆", tagline: "新手試煉，準備開打。" };

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
    await sc.monsterService.saveState(newState, zoneKey);
    _republishPanel(sc, zoneKey, next, next.calc.maxHp, 0, {}).catch(() => {});
    if (next.isBoss) _broadcastBossSpawn(sc, zoneKey, next).catch(() => {});

    // 嗆聲廣播
    const { getBotClient } = require("../runtimeContext");
    const client = getBotClient();
    if (!client?.isReady()) return;
    const layout = await sc.channelLayoutRepository.get();
    const bindings = layout?.discord?.bindings || [];
    const townBinding = bindings.find((b) => b.featureKey === "town_chat");
    const zoneFeature = zoneKey === "mid" ? "monster_zone_mid" : "monster_zone";
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
  for (const zoneKey of ["normal", "mid"]) {
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
  MAX_ROUNDS,
  _broadcastBossSpawn,
  activeSessions,
  startIdleRotateTimer
};
