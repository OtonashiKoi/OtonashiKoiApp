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
const { getPkArenaBracketByIndex, isLevelInPkArenaBracket, PK_RATING_DEFAULT, PK_RATING_MIN, calcRatingChange, getBossBoostPct, getDropBoostPct, formatPkBetOdds } = require("../../shared/pkArenaConfig");
const {
  BET_AMOUNT,
  BET_AMOUNTS,
  formatGold,
  getSlotBetOdds,
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
const PK_TOP_GHOST_MATCH_CHANCE = 0.35;
const PK_TOP_GHOST_POOL_SIZE = 3;
const PK_TOP_RANK_ANNOUNCE_CHANNEL_ID = "1450062298076151952";
const PK_WINNER_BET_DIVIDEND_RATE = 0.05;
const PK_REWARD_ITEM_IDS = {
  D: "72fde92d-e33f-42fb-8d86-2e811d03f84d",
  C: "556db9e1-b084-4b22-bab5-a66c2b586184",
  B: "8fdfa7d9-f0fa-4e6a-a291-703b1e354072",
};
const PK_DISPLAY_NAME_CACHE_TTL_MS = 10 * 60 * 1000;

// 主面板的 Message 引用（供更新用）
let panelMessage = null;
let persistedPanelChannelId = null;
let persistedPanelMessageId = null;
const pkDisplayNameCache = new Map();
let pkQueue = [];
let pkTopGhostCursor = 0;
let pkRuntimePruneTimer = null;

// ── 工具 ─────────────────────────────────────────────────────

function prunePkDisplayNameCache(now = Date.now()) {
  for (const [id, cached] of pkDisplayNameCache.entries()) {
    if (!cached?.expiresAt || cached.expiresAt <= now) {
      pkDisplayNameCache.delete(id);
    }
  }
}

function startPkRuntimePruneTimer() {
  if (pkRuntimePruneTimer) return;
  pkRuntimePruneTimer = setInterval(() => prunePkDisplayNameCache(), 5 * 60 * 1000);
  pkRuntimePruneTimer.unref?.();
}

function schedulePkBattleThreadCleanup(channelId, threadId) {
  if (!channelId || !threadId) return;
  setTimeout(async () => {
    const client = getBotClient();
    if (!client?.isReady()) return;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    const thread = await channel?.threads?.fetch(threadId).catch(() => null);
    await thread?.delete?.("PK battle report auto cleanup").catch(() => {});
  }, PK_BATTLE_THREAD_TTL_MS).unref?.();
}

function getPkArenaDiagnostics() {
  let activeSlots = 0;
  let totalBets = 0;
  const slotStates = {};
  for (const slot of arenaSlots) {
    if (!slot) continue;
    activeSlots += 1;
    const state = slot.state || "unknown";
    slotStates[state] = (slotStates[state] || 0) + 1;
    totalBets += Object.keys(slot.bets || {}).length;
  }
  return {
    activeSlots,
    slotStates,
    arenaTimers: arenaTimers.size,
    activeBattleLocks: activeBattleLocks.size,
    pkQueue: pkQueue.length,
    pkDisplayNameCache: pkDisplayNameCache.size,
    totalBets,
    hasPanelMessage: Boolean(panelMessage)
  };
}

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
  const idMatch = String(customId || "").match(/^pk:bet_select(?::(\d+))?$/);
  if (!idMatch) return null;
  const amount = Number(idMatch[1] || BET_AMOUNT);
  const rawValue = Array.isArray(values) ? values[0] : null;
  if (!rawValue) return null;
  const value = String(rawValue);
  // 新格式（無名字）: pkbet:<idx>:<discordId>:<side>
  const compact = value.match(/^pkbet:(\d+):([^:]+):(challenger|defender|win|lose)$/);
  if (compact) {
    const side = compact[3] === "win" ? "challenger" : compact[3] === "lose" ? "defender" : compact[3];
    return { arenaIdx: parseInt(compact[1], 10) - 1, targetDiscordId: compact[2], targetName: null, side, amount };
  }
  // 舊格式（含名字）: pkbet:<idx>:<discordId>:<encodedName>:<side>
  const legacy = value.match(/^pkbet:(\d+):([^:]+):([^:]+):(challenger|defender|win|lose)$/);
  if (legacy) {
    const side = legacy[4] === "win" ? "challenger" : legacy[4] === "lose" ? "defender" : legacy[4];
    return { arenaIdx: parseInt(legacy[1], 10) - 1, targetDiscordId: legacy[2], targetName: decodeURIComponent(legacy[3] || ""), side, amount };
  }
  return null;
}

function normalizePkBetAmount(amount) {
  const value = Math.floor(Number(amount) || BET_AMOUNT);
  return BET_AMOUNTS.includes(value) ? value : BET_AMOUNT;
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

function normalizeQueueEntry(entry) {
  if (!entry || typeof entry !== "object" || !entry.discordId) return null;
  return {
    discordId: String(entry.discordId),
    name: entry.name || entry.displayName || String(entry.discordId),
    level: Math.max(1, Number(entry.level || 1)),
    queuedAt: Number(entry.queuedAt || Date.now())
  };
}

function syncPkBattlePresence() {
  const ids = new Set();
  for (const slot of arenaSlots) {
    if (!slot || !["betting", "fighting"].includes(slot.state)) continue;
    if (slot.challenger?.discordId && !slot.challenger?.isGhost) ids.add(slot.challenger.discordId);
    if (slot.defender?.discordId && !slot.defender?.isGhost) ids.add(slot.defender.discordId);
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
    queue: pkQueue.map((entry) => ({ ...entry })),
    topGhostCursor: pkTopGhostCursor,
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
          const loadedSlot = normalizeLoadedSlot(slots[i]);
          if (loadedSlot?.state === "waiting" && loadedSlot.challenger?.discordId) {
            pkQueue.push(normalizeQueueEntry({
              discordId: loadedSlot.challenger.discordId,
              name: loadedSlot.challenger.name,
              level: loadedSlot.challenger.level,
              queuedAt: loadedSlot.waitDeadlineAt ? loadedSlot.waitDeadlineAt - PK_WAIT_WINDOW_MS : Date.now()
            }));
            arenaSlots[i] = null;
          } else {
            arenaSlots[i] = loadedSlot;
          }
        }
        pkQueue.push(...(Array.isArray(state.queue) ? state.queue.map(normalizeQueueEntry).filter(Boolean) : []));
        pkQueue = dedupePkQueue(pkQueue);
        pkTopGhostCursor = Math.max(0, Number(state.topGhostCursor || 0)) % PK_TOP_GHOST_POOL_SIZE;
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

  const targetChannelId = persistedPanelChannelId || config.discord.pkArenaReportChannelId;
  if (!targetChannelId) return null;

  const channel = await client.channels.fetch(targetChannelId).catch(() => null);
  if (!channel?.isTextBased()) return null;

  if (persistedPanelMessageId) {
    const restored = await channel.messages.fetch(persistedPanelMessageId).catch(() => null);
    if (restored) {
      panelMessage = restored;
      return panelMessage;
    }
  }

  const ranking = await fetchPkRanking(10).catch(() => []);
  panelMessage = await channel.send(createPkArenaPanelMessage(arenaSlots, ranking, pkQueue)).catch(() => null);
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
  await tryMatchPkQueue("restore").catch((err) => {
    console.warn("[PK] restore queue match failed:", err?.message || err);
  });
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
    const ranking = await serviceContext.progressRepository.findTopByPkRating(limit);
    return await hydratePkRankingDisplayNames(ranking);
  } catch (_) {}
  return [];
}

async function tryMatchPkQueue(trigger = "queue") {
  await ensureArenaStateLoaded();
  pkQueue = dedupePkQueue(pkQueue);
  let matched = 0;

  while (pkQueue.length >= 1) {
    const idx = findEmptyArenaIndex();
    if (idx < 0) break;

    const eligible = [];
    for (const entry of pkQueue) {
      const id = entry.discordId;
      if (findParticipantArenaIndex(id) >= 0) continue;
      if (isTowerBattleActive(id) || isMonsterBattleActive(id)) continue;
      const data = await loadPlayerData(id).catch(() => null);
      if (!data) continue;
      const bracket = getPkArenaBracketByIndex(idx);
      if (!isLevelInPkArenaBracket(data.level, bracket)) continue;
      eligible.push({ entry, data });
    }

    if (eligible.length < 1) break;

    const topPkIds = await fetchTopPkPlayerIds().catch(() => new Set());
    const shuffledEligible = shuffleEntries(eligible);
    const realTopEligible = shuffledEligible.filter((entry) => topPkIds.has(String(entry.entry.discordId)));
    const first = realTopEligible[0] || shuffledEligible[0];
    let second = null;
    const shouldUseGhost = realTopEligible.length === 0 && Math.random() < PK_TOP_GHOST_MATCH_CHANCE;
    if (shouldUseGhost) {
      second = await pickTopPkGhostOpponent(first.entry.discordId, idx).catch(() => null);
    }
    if (!second) {
      second = shuffledEligible.find((entry) => entry.entry.discordId !== first.entry.discordId) || null;
    }
    if (!second) break;

    const firstIsChallenger = Math.random() < 0.5;
    const challengerSource = firstIsChallenger ? first : second;
    const defenderSource = firstIsChallenger ? second : first;

    function toParticipant(source) {
      return {
        discordId: source.entry.discordId,
        name: source.entry.name,
        level: source.data.level,
        rating: source.data.rating,
        isGhost: Boolean(source.isGhost),
        stats: source.data.stats,
        opts: {
          equipped: source.data.equipped,
          inventory: source.data.inventory,
          activeEffects: source.data.activeEffects,
          level: source.data.level || 1,
        }
      };
    }

    arenaSlots[idx] = {
      state: "betting",
      challenger: toParticipant(challengerSource),
      defender: toParticipant(defenderSource),
      bets: {},
      betDeadlineAt: Date.now() + PK_BET_WINDOW_MS,
      waitDeadlineAt: null,
      firstAttacker: Math.random() < 0.5 ? "challenger" : "defender",
      battleStartedAt: null,
      betNoticeSent: false,
    };

    const matchedIds = new Set([first.entry.discordId, second.entry.discordId]);
    pkQueue = pkQueue.filter((entry) => !matchedIds.has(entry.discordId));
    scheduleArenaBattle(idx, arenaSlots[idx].betDeadlineAt);
    matched += 1;
    console.log(`[PK] matched queue (${trigger}) arena=${idx + 1} players=${[...matchedIds].join(",")}`);
  }

  if (matched > 0) {
    syncPkBattlePresence();
    await saveArenaState();
  }
  return matched;
}

async function fetchTopPkPlayerIds(limit = PK_TOP_GHOST_POOL_SIZE) {
  const ranking = await serviceContext.progressRepository.findTopByPkRating(limit).catch(() => []);
  return new Set((Array.isArray(ranking) ? ranking : [])
    .map((row) => String(row.playerId || ""))
    .filter(Boolean));
}

function isParticipantInAnyPkSlot(discordId) {
  if (!discordId) return false;
  return arenaSlots.some((slot) => (
    slot?.challenger?.discordId === discordId ||
    slot?.defender?.discordId === discordId
  ));
}

async function pickTopPkGhostOpponent(playerId, arenaIdx) {
  const ranking = await serviceContext.progressRepository.findTopByPkRating(PK_TOP_GHOST_POOL_SIZE).catch(() => []);
  if (!Array.isArray(ranking) || ranking.length === 0) return null;
  const bracket = getPkArenaBracketByIndex(arenaIdx);
  const start = pkTopGhostCursor % ranking.length;

  for (let offset = 0; offset < ranking.length; offset += 1) {
    const index = (start + offset) % ranking.length;
    const row = ranking[index];
    const id = String(row.playerId);
    if (!id || id === String(playerId)) continue;
    if (findQueueIndex(id) >= 0) continue;
    if (isParticipantInAnyPkSlot(id)) continue;

    const data = await loadPlayerData(id).catch(() => null);
    if (!data || !isLevelInPkArenaBracket(data.level, bracket)) continue;
    const name = await resolvePkDisplayName(id, row.displayName || id).catch(() => row.displayName || id);
    pkTopGhostCursor = (index + 1) % ranking.length;
    return {
      isGhost: true,
      entry: {
        discordId: id,
        name: `${name}（TOP幻影）`,
        level: data.level,
        queuedAt: Date.now()
      },
      data
    };
  }
  return null;
}

function isDiscordSnowflake(value) {
  return /^\d{17,20}$/.test(String(value || ""));
}

async function resolvePkDisplayName(discordId, fallbackName = "") {
  const id = String(discordId || "");
  if (!isDiscordSnowflake(id)) return fallbackName || id || "???";

  const cached = pkDisplayNameCache.get(id);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.name;
  }

  let name = "";
  const client = getBotClient();
  if (client?.isReady() && config.discord.guildId) {
    const guild = await client.guilds.fetch(config.discord.guildId).catch(() => null);
    const member = await guild?.members?.fetch(id).catch(() => null);
    name = member?.displayName || member?.user?.globalName || member?.user?.username || "";
  }

  const resolved = name || (isDiscordSnowflake(fallbackName) ? id : fallbackName) || id || "???";
  pkDisplayNameCache.set(id, {
    name: resolved,
    expiresAt: Date.now() + PK_DISPLAY_NAME_CACHE_TTL_MS
  });
  return resolved;
}

async function hydratePkRankingDisplayNames(ranking = []) {
  if (!Array.isArray(ranking) || ranking.length === 0) return [];
  return await Promise.all(ranking.map(async (row) => {
    const displayName = await resolvePkDisplayName(row.playerId, row.displayName).catch(() => row.displayName || row.playerId);
    return { ...row, displayName };
  }));
}

async function refreshPanel() {
  if (!panelMessage) return;
  try {
    const ranking = await fetchPkRanking(10);
    await panelMessage.edit(createPkArenaPanelMessage(arenaSlots, ranking, pkQueue));
  } catch (_) {}
}

function buildPkMentionList(slot, betPayouts = []) {
  const ids = new Set();
  if (slot?.challenger?.discordId && !slot.challenger?.isGhost) ids.add(slot.challenger.discordId);
  if (slot?.defender?.discordId && !slot.defender?.isGhost) ids.add(slot.defender.discordId);
  for (const bet of Object.values(slot?.bets || {})) {
    if (bet?.discordId) ids.add(bet.discordId);
  }
  const mentions = [...ids].map((id) => `<@${id}>`);
  return mentions.length > 0 ? mentions.join(" ") : "";
}

function collectPkMentionIds(slot) {
  return [...new Set([
    slot?.challenger?.isGhost ? null : slot?.challenger?.discordId,
    slot?.defender?.isGhost ? null : slot?.defender?.discordId,
    ...Object.values(slot?.bets || {}).map((bet) => bet?.discordId).filter(Boolean)
  ].filter(Boolean))];
}

function collectPkParticipantIds(slot) {
  return [...new Set([
    slot?.challenger?.isGhost ? null : slot?.challenger?.discordId,
    slot?.defender?.isGhost ? null : slot?.defender?.discordId,
  ].filter(Boolean))];
}

function formatPkParticipantForNotice(participant, fallback) {
  if (!participant?.discordId) return fallback;
  if (participant.isGhost) return participant.name || fallback;
  return `<@${participant.discordId}>`;
}

function buildPkBattleNotice(slot) {
  const challMention = formatPkParticipantForNotice(slot?.challenger, "挑戰者");
  const defMention = formatPkParticipantForNotice(slot?.defender, "應戰者");
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
    (slot?.challenger?.discordId === discordId && !slot.challenger?.isGhost) ||
    (slot?.defender?.discordId === discordId && !slot.defender?.isGhost)
  ));
}

function findQueueIndex(discordId) {
  if (!discordId) return -1;
  return pkQueue.findIndex((entry) => String(entry.discordId) === String(discordId));
}

function dedupePkQueue(queue = []) {
  const seen = new Set();
  const result = [];
  for (const entry of queue) {
    const normalized = normalizeQueueEntry(entry);
    if (!normalized || seen.has(normalized.discordId)) continue;
    if (findParticipantArenaIndex(normalized.discordId) >= 0) continue;
    seen.add(normalized.discordId);
    result.push(normalized);
  }
  return result.sort((a, b) => Number(a.queuedAt || 0) - Number(b.queuedAt || 0));
}

function findEmptyArenaIndex() {
  return arenaSlots.findIndex((slot) => !slot || (!slot.challenger && !slot.defender));
}

function shuffleEntries(entries = []) {
  const copy = [...entries];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
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
  if (!challId || !defId || !result.winner || result.winner === "draw") return [];

  const beforeTop3 = await sc.progressRepository.findTopByPkRating(3).catch(() => []);
  const beforeTop3Ids = new Set((Array.isArray(beforeTop3) ? beforeTop3 : []).map((row) => String(row.playerId || "")));
  const beforeTop1Id = Array.isArray(beforeTop3) && beforeTop3[0] ? String(beforeTop3[0].playerId || "") : "";

  const [challProg, defProg] = await Promise.all([
    sc.progressRepository.findByPlayerId(challId).catch(() => null),
    sc.progressRepository.findByPlayerId(defId).catch(() => null),
  ]);
  if (!challProg || !defProg) return [];

  const challRating = challProg.pkRating ?? PK_RATING_DEFAULT;
  const defRating   = defProg.pkRating   ?? PK_RATING_DEFAULT;

  // result.winner is "A" or "B"; A=challFirst player, B=second
  const challIsA = challFirst;
  const challWon = (result.winner === "A" && challIsA) || (result.winner === "B" && !challIsA);

  const challDelta = calcRatingChange(challRating, defRating, challWon);
  const defDelta   = calcRatingChange(defRating, challRating, !challWon);

  const newChallRating = Math.max(PK_RATING_MIN, challRating + challDelta);
  const newChallWins   = (challProg.pkWins   || 0) + (challWon ? 1 : 0);
  const newChallLosses = (challProg.pkLosses || 0) + (challWon ? 0 : 1);

  const newDefRating   = Math.max(PK_RATING_MIN, defRating + defDelta);
  const newDefWins     = (defProg.pkWins   || 0) + (challWon ? 0 : 1);
  const newDefLosses   = (defProg.pkLosses || 0) + (challWon ? 1 : 0);

  // 只更新 PK 統計欄位，避免全量覆寫而蓋掉同時發生的 inventory/progress 變更
  await Promise.all([
    sc.progressRepository.updatePkStats(challId, {
      pkRating: newChallRating, pkWins: newChallWins, pkLosses: newChallLosses,
    }).catch(() => {}),
    sc.progressRepository.updatePkStats(defId, {
      pkRating: newDefRating, pkWins: newDefWins, pkLosses: newDefLosses,
    }).catch(() => {}),
  ]);

  await announceNewPkTop3Entrants(sc, beforeTop3Ids, beforeTop1Id).catch((err) => {
    console.warn("[PK] top3 announce failed:", err?.message || err);
  });

  const challName = slot.challenger?.name || challId;
  const defName = slot.defender?.name || defId;
  const formatDelta = (delta) => delta >= 0 ? `+${delta}` : `${delta}`;
  return [
    `• **${challName}**：${Math.round(challRating)} → **${Math.round(newChallRating)}**（${formatDelta(newChallRating - challRating)}）`,
    `• **${defName}**：${Math.round(defRating)} → **${Math.round(newDefRating)}**（${formatDelta(newDefRating - defRating)}）`,
  ];
}

async function announceNewPkTop3Entrants(sc, beforeTop3Ids, beforeTop1Id = "") {
  const afterTop3 = await sc.progressRepository.findTopByPkRating(3).catch(() => []);
  if (!Array.isArray(afterTop3) || afterTop3.length === 0) return;

  const afterTop3Ranked = afterTop3.map((row, index) => ({ ...row, rank: index + 1 }));
  const newcomers = afterTop3Ranked.filter((row) => row.playerId && !beforeTop3Ids.has(String(row.playerId)));

  const afterTop1Id = afterTop3[0] ? String(afterTop3[0].playerId || "") : "";
  const top1Changed = afterTop1Id && beforeTop1Id && afterTop1Id !== beforeTop1Id
    && !newcomers.some((r) => r.rank === 1);

  if (newcomers.length === 0 && !top1Changed) return;

  const client = getBotClient();
  if (!client?.isReady()) return;
  const channel = await client.channels.fetch(PK_TOP_RANK_ANNOUNCE_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased?.()) return;

  const medal = ["🥇", "🥈", "🥉"];

  // 第1名換人（前3名內部輪替）
  if (top1Changed) {
    const row = afterTop3Ranked[0];
    const id = String(row.playerId);
    const name = await resolvePkDisplayName(id, row.displayName || id).catch(() => row.displayName || id);
    const rating = Math.round(Number(row.pkRating ?? PK_RATING_DEFAULT));
    const wins = Number(row.pkWins || 0);
    const losses = Number(row.pkLosses || 0);
    await channel.send({
      content: [
        `🏆 **PK 王座易主！**`,
        `🥇 **${name}** 登上 Rating 排行榜第 1 名`,
        `Rating：**${rating} 分**｜戰績：${wins}勝${losses}敗`
      ].join("\n"),
      allowedMentions: { parse: [] }
    }).catch(() => {});
  }

  // 新進入前3名的人
  for (const row of newcomers) {
    const id = String(row.playerId);
    const name = await resolvePkDisplayName(id, row.displayName || id).catch(() => row.displayName || id);
    const rating = Math.round(Number(row.pkRating ?? PK_RATING_DEFAULT));
    const wins = Number(row.pkWins || 0);
    const losses = Number(row.pkLosses || 0);
    await channel.send({
      content: [
        `🏆 **PK 新王者登榜！**`,
        `${medal[row.rank - 1] || `#${row.rank}`} **${name}** 登上 Rating 排行榜第 ${row.rank} 名`,
        `Rating：**${rating} 分**｜戰績：${wins}勝${losses}敗`
      ].join("\n"),
      allowedMentions: { parse: [] }
    }).catch(() => {});
  }
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
    if (participant.isGhost) continue;
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

  if (rewardGold > 0 || rewardExp > 0) {
    const bracketName = bracket.label;
    const rewardParts = [`EXP +${rewardExp}`];
    if (rewardGold > 0) rewardParts.push(`金幣 +${rewardGold}`);
    const hasGhost = Boolean(slot?.challenger?.isGhost || slot?.defender?.isGhost);
    rewards.unshift(`🎁 **PK區間獎勵（${bracketName}）**：${hasGhost ? "真人參賽者" : "每位參賽者"} ${rewardParts.join("、")}`);
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

async function sendPkBattleThread(slot, result, betPayouts = [], battleRewards = [], ratingLines = []) {
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

    const reportMsg = createPkBattleReportMessage(slot, result, betPayouts, battleRewards, { includeRoundLogs: false, ratingLines });
    await thread.send({ ...reportMsg, allowedMentions });
    schedulePkBattleThreadCleanup(targetChannel.id, thread.id);
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
      const reportMsg = createPkBattleReportMessage(slot, result, betPayouts, battleRewards, { includeRoundLogs: false, ratingLines });
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
  return {
    stats: pStats,
    equipped,
    inventory,
    activeEffects,
    level: Math.max(1, Number(progress.level || 1)),
    rating: Math.max(PK_RATING_MIN, Number(progress.pkRating ?? PK_RATING_DEFAULT) || PK_RATING_DEFAULT),
  };
}

function getDisplayName(interaction) {
  return interaction.member?.displayName || interaction.user.globalName || interaction.user.username;
}

// ── 隨機配對排隊 ─────────────────────────────────────────────
async function handleJoin(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await ensureArenaStateLoaded();

  const sc   = serviceContext;
  const discordId = interaction.user.id;
  const name  = getDisplayName(interaction);

  const existingArenaIdx = findParticipantArenaIndex(discordId);
  if (existingArenaIdx >= 0) {
    await interaction.editReply({ content: `⚠️ 你已在**擂台 ${existingArenaIdx + 1}** 的配對場次中，這場結束前不能重新排隊。` });
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

  const bracket = getPkArenaBracketByIndex(0);
  if (!isLevelInPkArenaBracket(pData.level, bracket)) {
    await interaction.editReply({ content: `⚠️ 你的等級為 **Lv.${pData.level}**，PK 擂台需要 **Lv.${bracket.minLevel}以上**。` });
    return;
  }

  if (findQueueIndex(discordId) >= 0) {
    await interaction.editReply({ content: `⚠️ 你已在 PK 隊列中，目前排隊人數：**${pkQueue.length}**。\n排隊期間可以玩其他內容；要取消請按「離開排隊」。` });
    return;
  }

  pkQueue.push({ discordId, name, level: pData.level, queuedAt: Date.now() });
  pkQueue = dedupePkQueue(pkQueue);
  await saveArenaState();
  await tryMatchPkQueue("join");
  const matchedArenaIdx = findParticipantArenaIndex(discordId);
  const matchedSlot = matchedArenaIdx >= 0 ? arenaSlots[matchedArenaIdx] : null;
  const opponent = matchedSlot?.challenger?.discordId === discordId
    ? matchedSlot?.defender
    : matchedSlot?.challenger;
  const opponentName = opponent?.name || "對手";
  await interaction.editReply({
    content: matchedArenaIdx >= 0
      ? `✅ 已加入隊列並完成配對！\n對手：**${opponentName}**\n擂台：**${matchedArenaIdx + 1}**｜請回 PK 面板查看下注倒數。`
      : `✅ 已加入 PK 隊列，目前排隊人數：**${pkQueue.length}**。\n排隊期間可以玩其他內容；配對成功後會鎖定 PK 狀態。`
  });
  await saveArenaState();
  await refreshPanel();
}

async function handleLeaveQueue(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await ensureArenaStateLoaded();

  const discordId = interaction.user.id;
  const before = pkQueue.length;
  pkQueue = pkQueue.filter((entry) => String(entry.discordId) !== String(discordId));
  if (pkQueue.length === before) {
    await interaction.editReply({ content: "⚠️ 你目前不在 PK 排隊隊列中。" });
    return;
  }
  await saveArenaState();
  await refreshPanel();
  await interaction.editReply({ content: `✅ 已離開 PK 排隊隊列，目前排隊人數：**${pkQueue.length}**。` });
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
  const betAmount = normalizePkBetAmount(betInfo.amount);
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
  if (!wallet || (wallet.gold ?? 0) < betAmount) {
    await interaction.editReply({ content: `❌ 金幣不足，下注需要 **${formatGold(betAmount)}** 🪙。` });
    return;
  }

  try {
    await sc.rewardService.grantCurrency({
      discordId,
      displayName: getDisplayName(interaction),
      currencyType: "gold",
      amount: -betAmount,
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
  const odds = getSlotBetOdds(slot, targetSide);
  const payout = Math.floor(betAmount * odds);

  slot.bets[discordId] = {
    discordId,
    side: targetSide,
    targetDiscordId,
    targetName,
    amount: betAmount,
    odds,
    payout,
    name: getDisplayName(interaction),
  };
  syncPkBattlePresence();
  await saveArenaState();

  await interaction.editReply({ content: `✅ 已押注 **${formatGold(betAmount)}** 🪙 → **${targetName}** 獲勝！\n賠率 **${formatPkBetOdds(odds)}**，猜中返還 **${formatGold(payout)}** 🪙。` });

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
    const totalBetAmount = Object.values(slot.bets || {})
      .reduce((sum, bet) => sum + Math.max(0, Number(bet?.amount || BET_AMOUNT)), 0);

    for (const [bid, bet] of Object.entries(slot.bets)) {
    if (!winningSide) {
      // 平局退還
      const refundAmount = Math.max(0, Number(bet.amount || BET_AMOUNT));
      await sc.rewardService.grantCurrency({
        discordId: bid, displayName: bet.name,
        currencyType: "gold", amount: refundAmount,
        source: CURRENCY_SOURCES.PK_BET_REFUND, operator: "pk:bet_refund",
      }).catch(() => {});
      betPayouts.push(`↩️ **${bet.name}** 退還 ${formatGold(refundAmount)} 🪙（平局）`);
    } else if (bet.side === winningSide) {
      const odds = Number(bet.odds || getSlotBetOdds(slot, bet.side));
      const payout = Math.max(0, Math.floor(Number(bet.amount || BET_AMOUNT) * odds));
      if (payout > 0) {
        await sc.rewardService.grantCurrency({
          discordId: bid, displayName: bet.name,
          currencyType: "gold", amount: payout,
          source: CURRENCY_SOURCES.PK_BET_WIN, operator: "pk:bet_win",
        }).catch(() => {});
        betPayouts.push(`🏆 **${bet.name}** 賠率 ${formatPkBetOdds(odds)}，返還 ${formatGold(payout)} 🪙`);
      }
      } else {
        betPayouts.push(`💸 **${bet.name}** 下注失敗，損失 ${formatGold(bet.amount)} 🪙`);
      }
    }

    if (winningSide && totalBetAmount > 0) {
      const winner = winningSide === "challenger" ? slot.challenger : slot.defender;
      const dividend = Math.max(1, Math.floor(totalBetAmount * PK_WINNER_BET_DIVIDEND_RATE));
      if (winner?.discordId && dividend > 0) {
        await sc.rewardService.grantCurrency({
          discordId: winner.discordId,
          displayName: winner.name || winner.discordId,
          currencyType: "gold",
          amount: dividend,
          source: CURRENCY_SOURCES.PK_BET_DIVIDEND,
          operator: "pk:bet_dividend",
        }).then(() => {
          betPayouts.push(`💰 **${winner.name || "勝者"}** 獲得下注熱度分紅 ${formatGold(dividend)} 🪙（總下注 ${formatGold(totalBetAmount)} 的 5%）`);
        }).catch((err) => {
          console.warn("[PK] bet dividend grant failed:", err?.message || err);
        });
      }
    }

    const battleRewardResult = await grantPkBracketRewards(sc, slot, result, idx).catch((err) => {
      console.warn("[PK] battle reward grant failed:", err?.message || err);
      return { rewards: [] };
    });

    // ── Rating 更新 ───────────────────────────────────────────
    const ratingLines = await updatePkRatings(sc, slot, result, challFirst).catch((err) => {
      console.warn("[PK] rating update failed:", err?.message || err);
      return [];
    });

    // ── 發布戰報 ─────────────────────────────────────────────
    try {
      await sendPkBattleThread(slot, result, betPayouts, battleRewardResult.rewards || [], ratingLines);
    } catch (_) {}

    // 清空擂台
    arenaSlots[idx] = null;
    syncPkBattlePresence();
    await saveArenaState();
    await tryMatchPkQueue("battle-end").catch((err) => {
      console.warn("[PK] queue match after battle failed:", err?.message || err);
    });
    await refreshPanel();
  } finally {
    activeBattleLocks.delete(idx);
  }
}

// ── 重整面板 ─────────────────────────────────────────────────
async function handleRefresh(interaction) {
  await ensureArenaStateLoaded();
  const ranking = await fetchPkRanking(10);
  await interaction.update(createPkArenaPanelMessage(arenaSlots, ranking, pkQueue));
}

async function handleMyRecord(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const discordId = interaction.user.id;
  const displayName = interaction.member?.displayName || interaction.user.globalName || interaction.user.username || discordId;
  const progress = await serviceContext.progressRepository.findByPlayerId(discordId).catch(() => null);
  if (!progress) {
    await interaction.editReply("❌ 找不到你的玩家資料，請先建立角色。");
    return;
  }

  const rating = Math.round(Number(progress.pkRating ?? PK_RATING_DEFAULT));
  const wins = Number(progress.pkWins || 0);
  const losses = Number(progress.pkLosses || 0);
  const total = wins + losses;
  const winRate = total > 0 ? Math.round((wins / total) * 1000) / 10 : 0;
  const level = Number(progress.level || 1);
  const bossBoostPct = getBossBoostPct(rating);
  const dropBoostPct = getDropBoostPct(rating);
  const ranking = await fetchPkRanking(100).catch(() => []);
  const rankIndex = ranking.findIndex((row) => String(row.playerId) === String(discordId));
  const rankText = rankIndex >= 0 ? `第 ${rankIndex + 1} 名` : total > 0 ? "未進入前 100" : "尚未參戰";

  await interaction.editReply(
    [
      `📊 **${displayName} 的 PK 成績**`,
      `等級：Lv.${level}`,
      `Rating：**${rating} 分**（${rankText}）`,
      `戰績：${wins} 勝 ${losses} 敗${total > 0 ? `｜勝率 ${winRate}%` : ""}`,
      `加成：BOSS傷害 +${bossBoostPct}%｜掉落率 +${dropBoostPct}%`,
      level >= 30 ? "狀態：可參加 Lv.30+ 擂台" : "狀態：Lv.30 後可參加 PK 擂台"
    ].join("\n")
  );
}

// ── 發布面板（指令用） ────────────────────────────────────────
async function publishPkArenaPanel(interaction) {
  await ensureArenaStateLoaded();
  const ranking = await fetchPkRanking(10);
  const msg = createPkArenaPanelMessage(arenaSlots, ranking, pkQueue);
  await interaction.reply(msg);
  panelMessage = await interaction.fetchReply();
  persistedPanelChannelId = panelMessage?.channelId || persistedPanelChannelId;
  persistedPanelMessageId = panelMessage?.id || persistedPanelMessageId;
  await saveArenaState();
}

// 從後台呼叫：清空頻道後直接發送，不依賴 interaction
async function publishPkArenaPanelToChannel(channelId, { cleanChannel = true } = {}) {
  const { getBotClient } = require("../runtimeContext");
  const client = getBotClient();
  if (!client?.isReady()) throw new Error("Discord bot is not ready");

  const channel = await client.channels.fetch(String(channelId).trim());
  if (!channel || !channel.isTextBased || !channel.isTextBased()) {
    throw new Error("target channel is not text-based");
  }

  // 清空頻道（保留 pinned）
  if (cleanChannel) {
    let lastId;
    for (let i = 0; i < 20; i++) {
      const batch = await channel.messages.fetch({ limit: 100, ...(lastId ? { before: lastId } : {}) }).catch(() => null);
      if (!batch || batch.size === 0) break;
      const deletable = batch.filter((m) => !m.pinned);
      if (deletable.size === 0) break;
      try { await channel.bulkDelete(deletable, true); }
      catch (_) {
        for (const m of deletable.values()) { await m.delete().catch(() => {}); }
      }
      lastId = batch.last()?.id;
      if (batch.size < 100) break;
    }
  }

  // 刪掉舊面板訊息（如果還活著）
  if (persistedPanelMessageId && persistedPanelChannelId === channel.id) {
    await channel.messages.fetch(persistedPanelMessageId).then((m) => m.delete()).catch(() => {});
  }

  await ensureArenaStateLoaded();
  const ranking = await fetchPkRanking(10);
  const sent = await channel.send(createPkArenaPanelMessage(arenaSlots, ranking, pkQueue));
  panelMessage = sent;
  persistedPanelChannelId = sent.channelId;
  persistedPanelMessageId = sent.id;
  await saveArenaState();
  return { channelId: sent.channelId, messageId: sent.id };
}

// ── 路由判斷 ─────────────────────────────────────────────────
function isPkArenaButton(customId) {
  return typeof customId === "string" && customId.startsWith("pk:");
}

function isPkArenaSelectMenu(customId) {
  return typeof customId === "string" && customId.startsWith("pk:bet_select");
}

async function handlePkArenaButton(interaction) {
  if (interaction.customId === "pk:my-record" || interaction.customId === "pk:refresh") {
    await handleMyRecord(interaction);
    return;
  }
  if (interaction.customId === "pk:join-queue" || interaction.customId.startsWith("pk:join:")) {
    await handleJoin(interaction);
    return;
  }
  if (interaction.customId === "pk:leave-queue") {
    await handleLeaveQueue(interaction);
    return;
  }
  if (interaction.customId.startsWith("pk:bet:")) {
    await handleBet(interaction);
    return;
  }
}

async function handlePkArenaSelectMenu(interaction) {
  if (interaction.customId.startsWith("pk:bet_select")) {
    await handleBetSelect(interaction);
  }
}

async function initPkArenaState() {
  await restorePkArenaState();
  startPkRuntimePruneTimer();
  if (arenaWatchdogTimer) clearInterval(arenaWatchdogTimer);
  arenaWatchdogTimer = setInterval(() => {
    kickExpiredWaitingSlots("watchdog").catch((err) => {
      console.warn("[PK] waiting watchdog error:", err?.message || err);
    });
    tryMatchPkQueue("watchdog").then((matched) => {
      if (matched > 0) return refreshPanel();
      return null;
    }).catch((err) => {
      console.warn("[PK] queue watchdog error:", err?.message || err);
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
  publishPkArenaPanelToChannel,
  initPkArenaState,
  getPkArenaDiagnostics,
};
