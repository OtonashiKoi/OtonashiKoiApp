"use strict";

const { Routes } = require("discord-api-types/v10");
const { MessageFlags } = require("discord.js");
const config = require("../../config");
const { serviceContext, getBotClient } = require("../runtimeContext");
const { calcPlayerStats } = require("../../shared/combatStats");
const { mergeEquippedFromLibrary } = require("../../shared/effectEngine");
const { runPkCombat } = require("../../shared/pkCombat");
const { CURRENCY_SOURCES, EXP_SOURCES } = require("../../shared/sources");
const { isMonsterBattleActive, replacePkBattlePresence, isTowerBattleActive } = require("../../shared/battlePresence");
const { withPlayerProgressLock } = require("../../services/progress/progressLocks");
const { getPkArenaBracketByIndex, isLevelInPkArenaBracket, PK_RATING_DEFAULT, PK_RATING_MIN, calcRatingChange } = require("../../shared/pkArenaConfig");
const {
  BET_AMOUNT,
  ARENA_COUNT,
  createPkArenaPanelMessage,
  createPkBattleReportMessage,
} = require("../pkArenaView");

// ── 擂台狀態（記憶體，每台一個 slot） ───────────────────────
// slot: { challenger, defender, state, bets, betDeadline, firstAttacker, panelRef }
// challenger/defender: { discordId, name, stats }
// state: "empty" | "waiting" | "betting" | "fighting"
const arenaSlots = Array.from({ length: ARENA_COUNT }, () => null);
const arenaTimers = new Map();
let arenaWatchdogTimer = null;
const activeBattleLocks = new Set();
let arenaStateLoaded = false;
let arenaStateLoadPromise = null;
const PK_BET_WINDOW_MS = 60 * 1000;
const PK_WAIT_WINDOW_MS = 5 * 60 * 1000;
const PK_BATTLE_WATCHDOG_MS = 5 * 1000;
const PK_BATTLE_THREAD_TTL_MS = 30 * 60 * 1000;
const PK_BATTLE_POST_TTL_MS = 30 * 60 * 1000;
const PK_BATTLE_POST_TITLE_PREFIX = "PK｜";
const PK_BRACKET_REWARD_RATIO = 0.25;
const PK_REWARD_ITEM_IDS = {
  D: "72fde92d-e33f-42fb-8d86-2e811d03f84d",
  C: "556db9e1-b084-4b22-bab5-a66c2b586184",
  B: "8fdfa7d9-f0fa-4e6a-a291-703b1e354072",
};

// 主面板的 Message 引用（供更新用）
let panelMessage = null;
let persistedPanelChannelId = null;
let persistedPanelMessageId = null;

// ── 工具 ─────────────────────────────────────────────────────

function getArenaIndex(customId) {
  const m = customId.match(/^pk:join:(\d+)$/);
  return m ? parseInt(m[1], 10) - 1 : -1;
}

function getBetInfo(customId) {
  // pk:bet:<arenaIndex1based>:<side>
  const m = customId.match(/^pk:bet:(\d+):(challenger|defender|win|lose)$/);
  if (!m) return null;
  const side = m[2] === "win" ? "challenger" : m[2] === "lose" ? "defender" : m[2];
  return { arenaIdx: parseInt(m[1], 10) - 1, side };
}

function getBetSelectInfo(customId, values = []) {
  if (customId !== "pk:bet_select") return null;
  const rawValue = Array.isArray(values) ? values[0] : null;
  if (!rawValue) return null;
  const value = String(rawValue);
  const modern = value.match(/^pkbet:(\d+):([^:]+):([^:]+):(challenger|defender|win|lose)$/);
  if (modern) {
    const side = modern[4] === "win" ? "challenger" : modern[4] === "lose" ? "defender" : modern[4];
    return {
      arenaIdx: parseInt(modern[1], 10) - 1,
      targetDiscordId: modern[2],
      targetName: decodeURIComponent(modern[3] || ""),
      side
    };
  }
  const legacy = value.match(/^pkbet:(\d+):(challenger|defender|win|lose)$/);
  if (!legacy) return null;
  const side = legacy[2] === "win" ? "challenger" : legacy[2] === "lose" ? "defender" : legacy[2];
  return { arenaIdx: parseInt(legacy[1], 10) - 1, targetDiscordId: null, targetName: null, side };
}

function cloneSlot(slot) {
  return slot ? JSON.parse(JSON.stringify(slot)) : null;
}

function normalizeLoadedSlot(slot) {
  if (!slot || typeof slot !== "object") return null;
  return {
    ...slot,
    state: slot.state || "empty",
    challenger: slot.challenger || null,
    defender: slot.defender || null,
    bets: slot.bets && typeof slot.bets === "object" ? slot.bets : {},
    betDeadlineAt: Number(slot.betDeadlineAt ?? slot.betDeadline ?? 0) || null,
    waitDeadlineAt: Number(slot.waitDeadlineAt ?? slot.waitUntilAt ?? 0) || null,
    firstAttacker: slot.firstAttacker || null,
    battleStartedAt: Number(slot.battleStartedAt || 0) || null,
    betNoticeSent: Boolean(slot.betNoticeSent),
  };
}

function syncPkBattlePresence() {
  const ids = new Set();
  for (const slot of arenaSlots) {
    if (!slot || slot.state !== "fighting") continue;
    if (slot.challenger?.discordId) ids.add(slot.challenger.discordId);
    if (slot.defender?.discordId) ids.add(slot.defender.discordId);
  }
  replacePkBattlePresence([...ids]);
}

function clearArenaTimer(idx) {
  const timer = arenaTimers.get(idx);
  if (timer) clearTimeout(timer);
  arenaTimers.delete(idx);
}

function scheduleArenaBattle(idx, deadlineAt, recovered = false) {
  clearArenaTimer(idx);
  if (!deadlineAt) return;
  const delay = Math.max(0, deadlineAt - Date.now());
  const timer = setTimeout(() => {
    startBattle(idx, { recovered }).catch((err) => {
      console.warn(`[PK] battle start failed (${idx + 1}):`, err?.message || err);
    });
  }, delay);
  arenaTimers.set(idx, timer);
}

function getArenaStateSnapshot() {
  return {
    slots: arenaSlots.map((slot) => cloneSlot(slot)),
    panelChannelId: panelMessage?.channelId || persistedPanelChannelId || null,
    panelMessageId: panelMessage?.id || persistedPanelMessageId || null,
  };
}

async function saveArenaState() {
  syncPkBattlePresence();
  const repo = serviceContext.pkArenaRepository;
  if (!repo?.saveState) return;
  const snapshot = getArenaStateSnapshot();
  persistedPanelChannelId = snapshot.panelChannelId;
  persistedPanelMessageId = snapshot.panelMessageId;
  await repo.saveState(snapshot).catch((err) => {
    console.warn("[PK] save arena state failed:", err?.message || err);
  });
}

async function ensureArenaStateLoaded() {
  if (arenaStateLoaded) return;
  if (!arenaStateLoadPromise) {
    arenaStateLoadPromise = (async () => {
      const repo = serviceContext.pkArenaRepository;
      const state = repo?.getState ? await repo.getState().catch(() => null) : null;
      if (state && typeof state === "object") {
        persistedPanelChannelId = state.panelChannelId || null;
        persistedPanelMessageId = state.panelMessageId || null;
        const slots = Array.isArray(state.slots) ? state.slots : [];
        for (let i = 0; i < ARENA_COUNT; i++) {
          arenaSlots[i] = normalizeLoadedSlot(slots[i]);
        }
      }
      arenaStateLoaded = true;
    })().finally(() => {
      arenaStateLoadPromise = null;
    });
  }
  await arenaStateLoadPromise;
}

async function restorePkPanelMessage() {
  const client = getBotClient();
  if (!client?.isReady()) return null;

  if (panelMessage) return panelMessage;
  if (!persistedPanelChannelId) return null;

  const channel = await client.channels.fetch(persistedPanelChannelId).catch(() => null);
  if (!channel?.isTextBased()) return null;

  if (persistedPanelMessageId) {
    const restored = await channel.messages.fetch(persistedPanelMessageId).catch(() => null);
    if (restored) {
      panelMessage = restored;
      return panelMessage;
    }
  }

  const ranking = await fetchPkRanking(10).catch(() => []);
  panelMessage = await channel.send(createPkArenaPanelMessage(arenaSlots, ranking)).catch(() => null);
  if (panelMessage) {
    persistedPanelChannelId = panelMessage.channelId;
    persistedPanelMessageId = panelMessage.id;
    await saveArenaState();
  }
  return panelMessage;
}

async function restorePkArenaState() {
  await ensureArenaStateLoaded();
  syncPkBattlePresence();

  const cleanupResult = await cleanupPkBattleForumPosts().catch((err) => {
    console.warn("[PK] cleanup forum posts failed:", err?.message || err);
    return null;
  });
  if (cleanupResult) {
    console.log(`[PK] forum cleanup done: deleted=${cleanupResult.deleted}, skipped=${cleanupResult.skipped}`);
  }

  const client = getBotClient();
  if (client?.isReady()) {
    await restorePkPanelMessage().catch(() => null);
  }

  await kickExpiredWaitingSlots("restore");
  for (let i = 0; i < ARENA_COUNT; i++) {
    const slot = arenaSlots[i];
    if (!slot) continue;
    if (slot.state === "betting" && slot.betDeadlineAt) {
      scheduleArenaBattle(i, slot.betDeadlineAt, true);
      continue;
    }
    if (slot.state === "fighting") {
      setTimeout(() => {
        startBattle(i, { recovered: true }).catch((err) => {
          console.warn(`[PK] recovered fighting slot failed (${i + 1}):`, err?.message || err);
        });
      }, 0);
    }
  }

  await kickExpiredBettingSlots("restore");
  await refreshPanel();
}

async function fetchPkRanking(limit = 10) {
  try {
    return await serviceContext.progressRepository.findTopByPkRating(limit);
  } catch (_) {}
  return [];
}

async function refreshPanel() {
  if (!panelMessage) return;
  try {
    const ranking = await fetchPkRanking(10);
    await panelMessage.edit(createPkArenaPanelMessage(arenaSlots, ranking));
  } catch (_) {}
}

function buildPkMentionList(slot, betPayouts = []) {
  const ids = new Set();
  if (slot?.challenger?.discordId) ids.add(slot.challenger.discordId);
  if (slot?.defender?.discordId) ids.add(slot.defender.discordId);
  for (const bet of Object.values(slot?.bets || {})) {
    if (bet?.discordId) ids.add(bet.discordId);
  }
  const mentions = [...ids].map((id) => `<@${id}>`);
  return mentions.length > 0 ? mentions.join(" ") : "";
}

function collectPkMentionIds(slot) {
  return [...new Set([
    slot?.challenger?.discordId,
    slot?.defender?.discordId,
    ...Object.values(slot?.bets || {}).map((bet) => bet?.discordId).filter(Boolean)
  ].filter(Boolean))];
}

function collectPkParticipantIds(slot) {
  return [...new Set([
    slot?.challenger?.discordId,
    slot?.defender?.discordId,
  ].filter(Boolean))];
}

function buildPkBattleNotice(slot) {
  const challMention = slot?.challenger?.discordId ? `<@${slot.challenger.discordId}>` : "挑戰者";
  const defMention = slot?.defender?.discordId ? `<@${slot.defender.discordId}>` : "應戰者";
  return {
    content: `💰 PK可以下注了 ${challMention} ⚔️ ${defMention}`,
    allowedMentions: {
      users: collectPkParticipantIds(slot),
      repliedUser: false,
    },
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findParticipantArenaIndex(discordId) {
  if (!discordId) return -1;
  return arenaSlots.findIndex((slot) => (
    slot?.challenger?.discordId === discordId ||
    slot?.defender?.discordId === discordId
  ));
}

function formatPkPostTime(date = new Date()) {
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date).replace(/\//g, "/");
}

function tryStackPkRewardItem(progress, itemId) {
  if (!itemId || !Array.isArray(progress?.inventory)) return false;
  const existing = progress.inventory.find((entry) => entry?.itemId === itemId);
  if (!existing) return false;
  if (!existing.stackCount) existing.stackCount = 1;
  existing.stackCount += 1;
  return true;
}

async function getPkBracketMonsterAverageReward(sc, bracket) {
  const monsters = await sc.monsterService.listMonsters({ includeDisabled: false }).catch(() => []);
  const list = monsters.filter((m) => {
    const level = Math.max(0, Number(m?.level || 0));
    if (m?.zone === "elite") return false;
    if (m?.isBoss) return false;
    if (level < bracket.minLevel) return false;
    if (bracket.maxLevel != null && level > bracket.maxLevel) return false;
    return true;
  });

  if (list.length === 0) {
    return { avgGold: 0, avgExp: 0, monsterCount: 0 };
  }

  const totalGold = list.reduce((sum, m) => sum + Math.max(0, Number(m.goldReward) || 0), 0);
  const totalExp = list.reduce((sum, m) => sum + Math.max(0, Number(m.expReward) || 0), 0);
  return {
    avgGold: Math.round(totalGold / list.length),
    avgExp: Math.round(totalExp / list.length),
    monsterCount: list.length
  };
}

async function grantPkRewardStone(sc, discordId, displayName, tier, amount) {
  const gemId = PK_REWARD_ITEM_IDS[tier];
  if (!gemId || amount <= 0) return false;

  return withPlayerProgressLock(discordId, async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const prog = await sc.progressRepository.findByPlayerId(discordId).catch(() => null);
      if (!prog) return false;
      const gemItem = await sc.itemRepository.findById(gemId).catch(() => null);
      if (!gemItem) return false;

      const nextProg = {
        ...prog,
        inventory: Array.isArray(prog.inventory)
          ? prog.inventory.map((entry) => ({ ...entry }))
          : []
      };

      for (let i = 0; i < amount; i++) {
        if (tryStackPkRewardItem(nextProg, gemItem.id)) continue;
        nextProg.inventory.push({
          uuid: require("crypto").randomUUID(),
          itemId: gemItem.id,
          itemName: gemItem.name,
          itemEffect: gemItem.effect || { type: "none", value: 0 },
          useEffects: gemItem.useEffects || [],
          passiveEffects: gemItem.passiveEffects || [],
          procEffects: gemItem.procEffects || [],
          combatEffects: gemItem.combatEffects || [],
          itemType: gemItem.itemType || "consumable",
          imageUrl: gemItem.imageUrl || null,
          imageThumbnailUrl: gemItem.imageThumbnailUrl || null,
          equipSlot: gemItem.equipSlot || null,
          equipStats: gemItem.equipStats || null,
          weaponType: gemItem.weaponType || null,
          isTwoHanded: gemItem.isTwoHanded || false,
          atkStat: gemItem.atkStat || null,
          tier: gemItem.tier || null,
          enhanceLevel: 0,
          stackCount: 1,
          source: "pk_battle_reward",
          sourceRef: displayName || null,
          purchasedAt: new Date().toISOString()
        });
      }

      nextProg.updatedAt = new Date().toISOString();
      const saved = typeof sc.progressRepository.saveIfUnchanged === "function"
        ? await sc.progressRepository.saveIfUnchanged(nextProg, prog.updatedAt)
        : (await sc.progressRepository.save(nextProg), true);
      if (saved) return true;
      await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
    }
    return false;
  });
}

async function updatePkRatings(sc, slot, result, challFirst) {
  const challId = slot.challenger?.discordId;
  const defId   = slot.defender?.discordId;
  if (!challId || !defId || result.winner === "draw") return;

  const [challProg, defProg] = await Promise.all([
    sc.progressRepository.findByPlayerId(challId).catch(() => null),
    sc.progressRepository.findByPlayerId(defId).catch(() => null),
  ]);
  if (!challProg || !defProg) return;

  const challRating = challProg.pkRating ?? PK_RATING_DEFAULT;
  const defRating   = defProg.pkRating   ?? PK_RATING_DEFAULT;

  // result.winner is "A" or "B"; A=challFirst player, B=second
  const challIsA = challFirst;
  const challWon = (result.winner === "A" && challIsA) || (result.winner === "B" && !challIsA);

  const challDelta = calcRatingChange(challRating, defRating, challWon);
  const defDelta   = calcRatingChange(defRating, challRating, !challWon);

  challProg.pkRating = Math.max(PK_RATING_MIN, challRating + challDelta);
  challProg.pkWins   = (challProg.pkWins   || 0) + (challWon ? 1 : 0);
  challProg.pkLosses = (challProg.pkLosses || 0) + (challWon ? 0 : 1);
  challProg.updatedAt = new Date().toISOString();

  defProg.pkRating = Math.max(PK_RATING_MIN, defRating + defDelta);
  defProg.pkWins   = (defProg.pkWins   || 0) + (challWon ? 0 : 1);
  defProg.pkLosses = (defProg.pkLosses || 0) + (challWon ? 1 : 0);
  defProg.updatedAt = new Date().toISOString();

  await Promise.all([
    sc.progressRepository.save(challProg).catch(() => {}),
    sc.progressRepository.save(defProg).catch(() => {}),
  ]);
}

async function grantPkBracketRewards(sc, slot, result, arenaIdx) {
  const rewards = [];
  const bracket = getPkArenaBracketByIndex(arenaIdx);
  const avgReward = await getPkBracketMonsterAverageReward(sc, bracket);
  const rewardGold = Math.max(0, Math.round(avgReward.avgGold * PK_BRACKET_REWARD_RATIO));
  const rewardExp = Math.max(0, Math.round(avgReward.avgExp * PK_BRACKET_REWARD_RATIO));
  const stoneDropRate = Math.max(0, Math.min(1, Number(bracket.stoneDropRate ?? 0)));

  for (const participant of [slot?.challenger, slot?.defender]) {
    if (!participant?.discordId) continue;
    const displayName = participant.name || participant.discordId;

    if (rewardGold > 0) {
      await sc.rewardService.grantCurrency({
        discordId: participant.discordId,
        displayName,
        currencyType: "gold",
        amount: rewardGold,
        source: CURRENCY_SOURCES.PK_BATTLE_REWARD,
        operator: "pk:battle_reward",
      }).catch(() => {});
    }

    if (rewardExp > 0) {
      await sc.progressService.grantExp({
        discordId: participant.discordId,
        displayName,
        amount: rewardExp,
        source: EXP_SOURCES.PK_BATTLE_REWARD_EXP,
      }).catch(() => {});
    }

    if (stoneDropRate > 0 && Math.random() < stoneDropRate) {
      const gotStone = await grantPkRewardStone(sc, participant.discordId, displayName, bracket.key, bracket.stoneCount).catch(() => false);
      if (gotStone) {
        rewards.push(`🎁 **${displayName}** 獲得 ${bracket.key}級強化石 x${bracket.stoneCount}`);
      }
    }
  }

  const bracketName = bracket.label;
  if (rewardGold > 0 || rewardExp > 0) {
    const rewardParts = [`EXP +${rewardExp}`];
    if (rewardGold > 0) rewardParts.push(`金幣 +${rewardGold}`);
    rewards.unshift(`🎁 **PK區間獎勵（${bracketName}）**：每位參賽者 ${rewardParts.join("、")}`);
  } else {
    rewards.unshift(`🎁 **PK區間獎勵（${bracketName}）**：固定獎勵為強化石，實際掉落如下。`);
  }

  return { rewards, bracket, avgReward };
}

async function getPkReportTargetChannel() {
  const client = getBotClient();
  if (!client?.isReady()) return null;
  const channelId = config.discord.pkArenaForumChannelId || panelMessage?.channelId || config.discord.pkArenaReportChannelId;
  if (!channelId) return null;
  return client.channels.fetch(channelId).catch(() => null);
}

async function getPkStartNoticeTargetChannel() {
  const client = getBotClient();
  if (!client?.isReady()) return null;
  const channelId = config.discord.pkArenaStartNoticeChannelId;
  if (!channelId) return null;
  return client.channels.fetch(channelId).catch(() => null);
}

async function sendPkBattleNotice(slot) {
  const targetChannel = await getPkStartNoticeTargetChannel();
  if (!targetChannel?.isTextBased?.()) return null;
  const payload = buildPkBattleNotice(slot);
  return targetChannel.send(payload).catch(() => null);
}

function isPkBattleForumPost(thread) {
  return /^PK\s*[｜|]/.test(String(thread?.name || "").trim());
}

async function collectPkForumThreads(channel) {
  const threads = new Map();
  const client = channel?.client;
  const guild = channel?.guild;
  const addRawThreads = (rawThreads) => {
    if (!rawThreads || !Array.isArray(rawThreads.threads)) return;
    for (const raw of rawThreads.threads) {
      if (!raw?.id || raw.parent_id !== channel.id) continue;
      const thread = client?.channels?._add?.(raw, guild, { cache: true });
      if (thread?.id) threads.set(thread.id, thread);
    }
  };

  const activeThreads = await guild?.channels?.rawFetchGuildActiveThreads?.().catch(() => null);
  addRawThreads(activeThreads);

  let before = null;
  for (let page = 0; page < 5; page++) {
    const query = new URLSearchParams({ limit: "100" });
    if (before) query.set("before", before);
    const archived = await client?.rest?.get?.(Routes.channelThreads(channel.id, "public"), { query }).catch(() => null);
    if (!archived) break;
    addRawThreads(archived);
    const archivedIds = Array.isArray(archived.threads) ? archived.threads : [];
    if (archivedIds.length === 0) break;
    const archivedTimes = archivedIds
      .map((thread) => Number(new Date(thread?.archive_timestamp || thread?.created_at || 0)))
      .filter((ts) => Number.isFinite(ts) && ts > 0)
      .sort((a, b) => a - b);
    before = archivedTimes.length > 0 ? new Date(archivedTimes[0]).toISOString() : null;
    if (!before) break;
  }

  if (threads.size === 0 && channel?.messages?.fetch) {
    let before = null;
    for (let page = 0; page < 5; page++) {
      const messages = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) }).catch(() => null);
      if (!messages || messages.size === 0) break;
      const ordered = [...messages.values()].sort((a, b) => b.createdTimestamp - a.createdTimestamp);
      for (const message of ordered) {
        if (!message?.id || !message.hasThread) continue;
        const thread = message.thread || await client?.channels?.fetch?.(message.id).catch(() => null);
        if (thread?.id) threads.set(thread.id, thread);
      }
      before = ordered[ordered.length - 1]?.id || null;
      if (!before) break;
    }
  }

  return [...threads.values()];
}

async function cleanupPkBattleForumPosts() {
  const client = getBotClient();
  if (!client?.isReady()) return { deleted: 0, skipped: 0 };

  const forumChannelId = config.discord.pkArenaForumChannelId;
  if (!forumChannelId) return { deleted: 0, skipped: 0 };

  const channel = await client.channels.fetch(forumChannelId).catch(() => null);
  if (!channel?.isThreadOnly?.()) return { deleted: 0, skipped: 0 };

  const cutoff = Date.now() - PK_BATTLE_POST_TTL_MS;
  let deleted = 0;
  let skipped = 0;
  const threads = await collectPkForumThreads(channel);
  if (threads.length === 0) return { deleted, skipped };

  for (const thread of threads) {
    if (!thread?.id || !isPkBattleForumPost(thread)) {
      skipped += 1;
      continue;
    }

    const starterMessage = thread.message || await thread.fetchStarterMessage().catch(() => null);
    const createdAt = Number(thread.createdTimestamp || starterMessage?.createdTimestamp || 0);
    if (!createdAt || createdAt > cutoff) continue;

    await thread.delete("PK battle forum post auto cleanup").catch(async () => {
      await starterMessage?.delete?.("PK battle forum post auto cleanup").catch(() => {});
    });
    deleted += 1;
  }

  return { deleted, skipped };
}

async function sendPkBattleThread(slot, result, betPayouts = [], battleRewards = []) {
  const client = getBotClient();
  const targetChannel = await getPkReportTargetChannel();
  if (!client?.isReady() || !targetChannel) return null;

  const challName = slot?.challenger?.name || "挑戰者";
  const defName = slot?.defender?.name || "應戰者";
  const timeLabel = formatPkPostTime();
  const threadName = `PK｜${challName} vs ${defName} | ${timeLabel}`.slice(0, 100);
  const mentionLine = buildPkMentionList(slot, betPayouts);
  const threadIntro = mentionLine || null;

  try {
    const isForumChannel = typeof targetChannel.isThreadOnly === "function" && targetChannel.isThreadOnly();
    const thread = (isForumChannel && targetChannel.threads?.create)
      ? await targetChannel.threads.create({
        name: threadName,
        autoArchiveDuration: 60,
        reason: "PK battle report",
        message: {
          content: threadIntro || " ",
          allowedMentions: { users: collectPkMentionIds(slot), repliedUser: false }
        }
      })
      : (panelMessage?.startThread
        ? await panelMessage.startThread({
          name: threadName,
          autoArchiveDuration: 60,
          reason: "PK battle report"
        })
        : await targetChannel.threads.create({
          name: threadName,
          autoArchiveDuration: 60,
          reason: "PK battle report"
        }));

    const allowedMentions = { users: collectPkMentionIds(slot), repliedUser: false };
    if (threadIntro && !isForumChannel) {
      await thread.send({ content: threadIntro, allowedMentions });
    }

    for (const roundLog of Array.isArray(result?.roundLogs) ? result.roundLogs : []) {
      if (!roundLog) continue;
      const chunks = String(roundLog).match(/[\s\S]{1,1800}/g) || [];
      for (const chunk of chunks) {
        await thread.send({ content: chunk, allowedMentions });
        await sleep(350);
      }
    }

    const reportMsg = createPkBattleReportMessage(slot, result, betPayouts, battleRewards, { includeRoundLogs: false });
    await thread.send({ ...reportMsg, allowedMentions });
    setTimeout(() => {
      thread.delete("PK battle report auto cleanup").catch(() => {});
    }, PK_BATTLE_THREAD_TTL_MS);
    return thread;
  } catch (err) {
    console.warn("[PK] thread send failed:", {
      message: err?.message,
      code: err?.code,
      status: err?.status,
      rawError: err?.rawError,
      errors: err?.rawError?.errors || err?.errors,
    });
    try {
      const allowedMentions = { users: collectPkMentionIds(slot), repliedUser: false };
      if (threadIntro) {
        await targetChannel.send({ content: threadIntro, allowedMentions });
      }
      for (const roundLog of Array.isArray(result?.roundLogs) ? result.roundLogs : []) {
        if (!roundLog) continue;
        const chunks = String(roundLog).match(/[\s\S]{1,1800}/g) || [];
        for (const chunk of chunks) {
          await targetChannel.send({ content: chunk, allowedMentions });
          await sleep(350);
        }
      }
      const reportMsg = createPkBattleReportMessage(slot, result, betPayouts, battleRewards, { includeRoundLogs: false });
      await targetChannel.send({ ...reportMsg, allowedMentions });
    } catch (_) {}
    return null;
  }
}

async function kickExpiredBettingSlots(trigger = "watchdog") {
  await ensureArenaStateLoaded();

  const now = Date.now();
  const expiredIndices = [];

  for (let i = 0; i < ARENA_COUNT; i++) {
    const slot = arenaSlots[i];
    if (!slot || slot.state !== "betting" || !slot.betDeadlineAt) continue;
    if (slot.betDeadlineAt > now) continue;
    expiredIndices.push(i);
  }

  for (const idx of expiredIndices) {
    if (activeBattleLocks.has(idx)) continue;
    startBattle(idx, { recovered: false }).catch((err) => {
      console.warn(`[PK] ${trigger} battle kick failed (${idx + 1}):`, err?.message || err);
    });
  }

  return expiredIndices.length;
}

async function kickExpiredWaitingSlots(trigger = "watchdog") {
  await ensureArenaStateLoaded();

  const now = Date.now();
  const expiredIndices = [];

  for (let i = 0; i < ARENA_COUNT; i++) {
    const slot = arenaSlots[i];
    if (!slot || slot.state !== "waiting" || !slot.challenger || !slot.waitDeadlineAt) continue;
    if (slot.waitDeadlineAt > now) continue;
    expiredIndices.push(i);
  }

  if (expiredIndices.length === 0) return 0;

  for (const idx of expiredIndices) {
    const slot = arenaSlots[idx];
    if (!slot || slot.state !== "waiting") continue;
    arenaSlots[idx] = null;
  }

  syncPkBattlePresence();
  await saveArenaState();
  await refreshPanel();

  console.log(`[PK] ${trigger} waiting slot cleanup: ${expiredIndices.length}`);
  return expiredIndices.length;
}

async function loadPlayerData(discordId) {
  const sc = serviceContext;
  const progress = await sc.progressRepository.findByPlayerId(discordId).catch(() => null);
  if (!progress) return null;
  const attrs    = progress.attributes || { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 };
  const equipped = await mergeEquippedFromLibrary(progress.equipment || {}, sc.itemRepository);
  const inventory     = Array.isArray(progress.inventory) ? progress.inventory : [];
  const activeEffects = Array.isArray(progress.activeEffects) ? progress.activeEffects : [];
  const pStats   = calcPlayerStats(attrs, equipped, activeEffects, inventory);
  return { stats: pStats, equipped, inventory, activeEffects, level: Math.max(1, Number(progress.level || 1)) };
}

function getDisplayName(interaction) {
  return interaction.member?.displayName || interaction.user.globalName || interaction.user.username;
}

// ── 入場 ─────────────────────────────────────────────────────
async function handleJoin(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await ensureArenaStateLoaded();

  const sc   = serviceContext;
  const discordId = interaction.user.id;
  const name  = getDisplayName(interaction);
  const idx   = getArenaIndex(interaction.customId);

  if (idx < 0 || idx >= ARENA_COUNT) {
    await interaction.editReply({ content: "❌ 無效的擂台。" });
    return;
  }

  if (isTowerBattleActive(discordId)) {
    await interaction.editReply({ content: "❌ 你目前正在組隊攻塔，不能同時參與 PK。請先解散隊伍。" });
    return;
  }
  if (isMonsterBattleActive(discordId)) {
    await interaction.editReply({ content: "❌ 你目前正在打怪，不能同時參與 PK。" });
    return;
  }

  await kickExpiredWaitingSlots("join");
  const slot = arenaSlots[idx];

  // 已有兩人或戰鬥中
  if (slot && (slot.state === "fighting" || slot.state === "betting" || (slot.challenger && slot.defender))) {
    await interaction.editReply({ content: "❌ 此擂台已滿員，請選其他擂台。" });
    return;
  }

  // 同一玩家同時只能存在於一個擂台
  const existingArenaIdx = findParticipantArenaIndex(discordId);
  if (existingArenaIdx >= 0 && existingArenaIdx !== idx) {
    await interaction.editReply({ content: `⚠️ 你已在**擂台 ${existingArenaIdx + 1}** 參與 PK，請先結束這場再進入其他擂台。` });
    return;
  }

  // 同一玩家不能重複加入同一擂台
  if (slot?.challenger?.discordId === discordId) {
    await interaction.editReply({ content: "⚠️ 你已在此擂台等待對手，請稍候。" });
    return;
  }

  // 確認玩家已存在
  const player = await sc.playerRepository.findByDiscordId(discordId).catch(() => null);
  if (!player) {
    await interaction.editReply({ content: "❌ 找不到你的玩家資料，請先建立角色。" });
    return;
  }

  // 讀取戰鬥數值（含完整裝備、庫存、activeEffects）
  const pData = await loadPlayerData(discordId);
  if (!pData) {
    await interaction.editReply({ content: "❌ 無法讀取你的戰鬥數值，請稍後再試。" });
    return;
  }

  const participant = {
    discordId,
    name,
    level: pData.level,
    stats: pData.stats,
    opts: { equipped: pData.equipped, inventory: pData.inventory, activeEffects: pData.activeEffects }
  };
  const bracket = getPkArenaBracketByIndex(idx);
  if (!isLevelInPkArenaBracket(pData.level, bracket)) {
    const rangeText = bracket.maxLevel != null
      ? `Lv.${bracket.minLevel}～${bracket.maxLevel}`
      : `Lv.${bracket.minLevel}以上`;
    const validArenas = bracket.maxLevel != null
      ? bracket.minLevel <= 10
        ? "①②"
        : "③④"
      : "⑤⑥⑦";
    await interaction.editReply({ content: `⚠️ 你的等級為 **Lv.${pData.level}**，只能進入 **${rangeText}** 的擂台。請改點 **${validArenas}**。` });
    return;
  }

  if (!slot || !slot.challenger) {
    // 第一人進場 → 挑戰者
    arenaSlots[idx] = {
      state: "waiting",
      challenger: participant,
      defender:   null,
      bets:       {},
      betDeadlineAt: null,
      waitDeadlineAt: Date.now() + PK_WAIT_WINDOW_MS,
      firstAttacker: null,
      battleStartedAt: null,
    };
    syncPkBattlePresence();
    await interaction.editReply({ content: `✅ 你已進入**擂台 ${idx + 1}**，等待對手應戰中…` });
  } else {
    // 第二人進場 → 應戰者，開始下注倒數
    const challName = slot.challenger.name;
    arenaSlots[idx] = {
      ...slot,
      state:       "betting",
      defender:    participant,
      betDeadlineAt: Date.now() + PK_BET_WINDOW_MS,
      waitDeadlineAt: null,
      firstAttacker: Math.random() < 0.5 ? "challenger" : "defender",
      battleStartedAt: null,
      betNoticeSent: false,
    };
    syncPkBattlePresence();
    await interaction.editReply({
      content: `✅ 你已應戰 **${challName}** 於**擂台 ${idx + 1}**！\n⏳ 下注倒數 **1 分鐘**開始，其他玩家可押注誰會贏。`
    });

    // 1 分鐘後自動開打（以絕對時間儲存，重啟後可重建）
    scheduleArenaBattle(idx, arenaSlots[idx].betDeadlineAt);

    try {
      await sendPkBattleNotice(arenaSlots[idx]);
      arenaSlots[idx].betNoticeSent = true;
    } catch (_) {}
  }

  await saveArenaState();
  await refreshPanel();
}

// ── 下注 ─────────────────────────────────────────────────────
async function handleBetRequest(interaction, betInfo) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await ensureArenaStateLoaded();

  const sc        = serviceContext;
  const discordId = interaction.user.id;

  if (!betInfo) {
    await interaction.editReply({ content: "❌ 無效的下注請求。" });
    return;
  }

  const { arenaIdx, side } = betInfo;
  const slot = arenaSlots[arenaIdx];

  if (!slot || slot.state !== "betting") {
    await interaction.editReply({ content: "❌ 此擂台目前不在下注階段。" });
    return;
  }

  if (isMonsterBattleActive(discordId)) {
    await interaction.editReply({ content: "❌ 你目前正在打怪，不能同時參與 PK。" });
    return;
  }

  // 參賽者不能下注自己的場
  if (slot.challenger?.discordId === discordId || slot.defender?.discordId === discordId) {
    await interaction.editReply({ content: "❌ 參賽者不能對自己的場次下注。" });
    return;
  }

  // 同一玩家同一擂台只能下注一次
  if (slot.bets[discordId]) {
    await interaction.editReply({ content: "⚠️ 你已對此場下注，每場只能押一次。" });
    return;
  }

  // 扣金幣
  const wallet = await sc.walletRepository.findByPlayerId(discordId).catch(() => null);
  if (!wallet || (wallet.gold ?? 0) < BET_AMOUNT) {
    await interaction.editReply({ content: `❌ 金幣不足，下注需要 **${BET_AMOUNT}** 🪙。` });
    return;
  }

  try {
    await sc.rewardService.grantCurrency({
      discordId,
      displayName: getDisplayName(interaction),
      currencyType: "gold",
      amount: -BET_AMOUNT,
      source: CURRENCY_SOURCES.PK_BET,
      operator: "pk:bet",
    });
  } catch (_) {
    await interaction.editReply({ content: "❌ 扣款失敗，請稍後再試。" });
    return;
  }

  const targetSide = side === "challenger" ? "challenger" : "defender";
  const target = targetSide === "challenger" ? slot.challenger : slot.defender;
  const targetName = betInfo.targetName || target?.name || (targetSide === "challenger" ? slot.challenger?.name : slot.defender?.name) || "對手";
  const targetDiscordId = target?.discordId || betInfo.targetDiscordId || null;

  slot.bets[discordId] = {
    discordId,
    side: targetSide,
    targetDiscordId,
    targetName,
    amount: BET_AMOUNT,
    name: getDisplayName(interaction),
  };
  syncPkBattlePresence();
  await saveArenaState();

  await interaction.editReply({ content: `✅ 已押注 **${BET_AMOUNT}** 🪙 → **${targetName}** 獲勝！` });

  await refreshPanel();
}

async function handleBet(interaction) {
  const betInfo = getBetInfo(interaction.customId);
  await handleBetRequest(interaction, betInfo);
}

async function handleBetSelect(interaction) {
  const betInfo = getBetSelectInfo(interaction.customId, interaction.values);
  await handleBetRequest(interaction, betInfo);
}

// ── 開戰 ─────────────────────────────────────────────────────
async function startBattle(idx, { recovered = false } = {}) {
  await ensureArenaStateLoaded();
  if (activeBattleLocks.has(idx)) return;
  activeBattleLocks.add(idx);
  clearArenaTimer(idx);

  const slot = arenaSlots[idx];
  try {
    if (!slot || (slot.state !== "betting" && !(recovered && slot.state === "fighting"))) return;

    arenaSlots[idx] = {
      ...slot,
      state: "fighting",
      battleStartedAt: slot.battleStartedAt || Date.now(),
    };
    syncPkBattlePresence();
    await saveArenaState();
    await refreshPanel();

    const sc = serviceContext;

    // 先攻方決定
    const challFirst = slot.firstAttacker === "challenger";
    const aName   = challFirst ? slot.challenger.name   : slot.defender.name;
    const bName   = challFirst ? slot.defender.name     : slot.challenger.name;
    const aStats  = challFirst ? slot.challenger.stats  : slot.defender.stats;
    const bStats  = challFirst ? slot.defender.stats    : slot.challenger.stats;
    const aOpts   = challFirst ? slot.challenger.opts   : slot.defender.opts;
    const bOpts   = challFirst ? slot.defender.opts     : slot.challenger.opts;

    const result = runPkCombat(aStats, aOpts, aName, bStats, bOpts, bName, 15);

    // ── 下注結算 ─────────────────────────────────────────────
    const betPayouts = [];
    const winningSide =
      result.winner === "A"
        ? (challFirst ? "challenger" : "defender")
        : result.winner === "B"
          ? (challFirst ? "defender" : "challenger")
          : null; // 平局

    const winnerPot = Object.values(slot.bets).reduce((s, b) => s + b.amount, 0);
    const winnerBetters = Object.entries(slot.bets).filter(([, b]) => b.side === winningSide);

    for (const [bid, bet] of Object.entries(slot.bets)) {
    if (!winningSide) {
      // 平局退還
      await sc.rewardService.grantCurrency({
        discordId: bid, displayName: bet.name,
        currencyType: "gold", amount: BET_AMOUNT,
        source: CURRENCY_SOURCES.PK_BET_REFUND, operator: "pk:bet_refund",
      }).catch(() => {});
      betPayouts.push(`↩️ **${bet.name}** 退還 ${BET_AMOUNT} 🪙（平局）`);
    } else if (bet.side === winningSide) {
      // 均分彩池
      const share = winnerBetters.length > 0 ? Math.floor(winnerPot / winnerBetters.length) : 0;
      if (share > 0) {
        await sc.rewardService.grantCurrency({
          discordId: bid, displayName: bet.name,
          currencyType: "gold", amount: share,
          source: CURRENCY_SOURCES.PK_BET_WIN, operator: "pk:bet_win",
        }).catch(() => {});
        betPayouts.push(`🏆 **${bet.name}** 獲得 ${share} 🪙`);
      }
      } else {
        betPayouts.push(`💸 **${bet.name}** 下注失敗，損失 ${bet.amount} 🪙`);
      }
    }

    const battleRewardResult = await grantPkBracketRewards(sc, slot, result, idx).catch((err) => {
      console.warn("[PK] battle reward grant failed:", err?.message || err);
      return { rewards: [] };
    });

    // ── Rating 更新 ───────────────────────────────────────────
    await updatePkRatings(sc, slot, result, challFirst).catch((err) => {
      console.warn("[PK] rating update failed:", err?.message || err);
    });

    // ── 發布戰報 ─────────────────────────────────────────────
    try {
      await sendPkBattleThread(slot, result, betPayouts, battleRewardResult.rewards || []);
    } catch (_) {}

    // 清空擂台
    arenaSlots[idx] = null;
    syncPkBattlePresence();
    await saveArenaState();
    await refreshPanel();
  } finally {
    activeBattleLocks.delete(idx);
  }
}

// ── 重整面板 ─────────────────────────────────────────────────
async function handleRefresh(interaction) {
  await ensureArenaStateLoaded();
  const ranking = await fetchPkRanking(10);
  await interaction.update(createPkArenaPanelMessage(arenaSlots, ranking));
}

// ── 發布面板（指令用） ────────────────────────────────────────
async function publishPkArenaPanel(interaction) {
  await ensureArenaStateLoaded();
  const ranking = await fetchPkRanking(10);
  const msg = createPkArenaPanelMessage(arenaSlots, ranking);
  await interaction.reply(msg);
  panelMessage = await interaction.fetchReply();
  persistedPanelChannelId = panelMessage?.channelId || persistedPanelChannelId;
  persistedPanelMessageId = panelMessage?.id || persistedPanelMessageId;
  await saveArenaState();
}

// ── 路由判斷 ─────────────────────────────────────────────────
function isPkArenaButton(customId) {
  return typeof customId === "string" && customId.startsWith("pk:");
}

function isPkArenaSelectMenu(customId) {
  return customId === "pk:bet_select";
}

async function handlePkArenaButton(interaction) {
  if (interaction.customId === "pk:refresh") {
    await handleRefresh(interaction);
    return;
  }
  if (interaction.customId.startsWith("pk:join:")) {
    await handleJoin(interaction);
    return;
  }
  if (interaction.customId.startsWith("pk:bet:")) {
    await handleBet(interaction);
    return;
  }
}

async function handlePkArenaSelectMenu(interaction) {
  if (interaction.customId === "pk:bet_select") {
    await handleBetSelect(interaction);
  }
}

async function initPkArenaState() {
  await restorePkArenaState();
  if (arenaWatchdogTimer) clearInterval(arenaWatchdogTimer);
  arenaWatchdogTimer = setInterval(() => {
    kickExpiredWaitingSlots("watchdog").catch((err) => {
      console.warn("[PK] waiting watchdog error:", err?.message || err);
    });
    kickExpiredBettingSlots("watchdog").catch((err) => {
      console.warn("[PK] watchdog error:", err?.message || err);
    });
  }, PK_BATTLE_WATCHDOG_MS);
}

module.exports = {
  isPkArenaButton,
  isPkArenaSelectMenu,
  handlePkArenaButton,
  handlePkArenaSelectMenu,
  publishPkArenaPanel,
  initPkArenaState,
};
