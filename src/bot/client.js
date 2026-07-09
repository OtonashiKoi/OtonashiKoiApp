// Discord Bot Client 建立與登入
// ------------------------------------------------

const fs = require("node:fs");
const path = require("node:path");
const v8 = require("node:v8");
const { Client, GatewayIntentBits, Events, MessageFlags, PermissionsBitField, RESTEvents, Options } = require("discord.js");
const config = require("../config");
const { isAppError } = require("../shared/errors");
const { isWorldBossZone } = require("../services/worldBoss/worldBossService");
const { handleCommand, handleButton, handleSelectMenu, handleModal } = require("./commands");
const { serviceContext, setBotClient, getBotClient } = require("./runtimeContext");
const { startFetcher, startViewerPoller } = require("./commentFetcher");
const { handleStreamComment } = require("./handlers/streamHandlers");
const { startIdleRotateTimer, refreshEliteWorldBossPanel, refreshMonsterZonePanels, _doIdleRotate, startWorldBossRespawnWatcher, startMonsterPanelSweep } = require("./handlers/monsterZoneHandlers");
const { initPkArenaState } = require("./handlers/pkArenaHandlers");
const { restoreTowerSessions } = require("./handlers/towerHandlers");
const { isMonsterZoneFeatureKey, featureKeyToZone, MONSTER_ZONE_FEATURE_KEYS } = require("../shared/zones");
const {
  isTransientDiscordNetworkError,
  markDiscordRestError,
  markDiscordRestRateLimited,
  resetDiscordRestAgent,
  shouldSkipOptionalDiscordSend
} = require("./discordRestRecovery");

const RESTRICTED_ANIMATED_EMOJI_NAMES = new Set(["HUHU"]);
const RESTRICTED_EMOJI_WARNING_DELETE_MS = 10_000;
const WELCOME_AUDIT_ENABLED = config.discord.welcomeAuditEnabled !== false;
const WELCOME_AUDIT_INTERVAL_MS = config.discord.welcomeAuditIntervalMs || 30 * 60 * 1000;
const MEMORY_AUDIT_ENABLED = process.env.ENABLE_MEMORY_AUDIT !== "0";
const MEMORY_AUDIT_INTERVAL_MS = Math.max(10_000, Number(process.env.MEMORY_AUDIT_INTERVAL_MS || 60_000));
const MEMORY_AUDIT_VERBOSE = process.env.MEMORY_AUDIT_VERBOSE === "1";
const MEMORY_AUDIT_LOG_RSS_MB = Math.max(128, Number(process.env.MEMORY_AUDIT_LOG_RSS_MB || 500));
const MEMORY_AUDIT_LOG_HEAP_MB = Math.max(128, Number(process.env.MEMORY_AUDIT_LOG_HEAP_MB || 350));
const MEMORY_HEAPSNAPSHOT_ENABLED = process.env.ENABLE_MEMORY_HEAPSNAPSHOT !== "0";
const MEMORY_HEAPSNAPSHOT_RSS_MB = Math.max(256, Number(process.env.MEMORY_HEAPSNAPSHOT_RSS_MB || 950));
const MEMORY_HEAPSNAPSHOT_HEAP_MB = Math.max(256, Number(process.env.MEMORY_HEAPSNAPSHOT_HEAP_MB || 650));
const MEMORY_HEAPSNAPSHOT_COOLDOWN_MS = Math.max(60_000, Number(process.env.MEMORY_HEAPSNAPSHOT_COOLDOWN_MS || 30 * 60 * 1000));

let welcomeAuditTimer = null;
let welcomeAuditRunning = false;
let membershipReconcileTimer = null;
let runtimeCachePruneTimer = null;
let memoryAuditTimer = null;
let lastMemoryHeapSnapshotAt = 0;

async function ensureMemberPlayerProfile(member, reason) {
  try {
    const allowed = await serviceContext.accessControlService.isDiscordMemberWhitelisted(member);
    if (!allowed) return;

    const existing = await serviceContext.playerService.playerRepository.findByDiscordId(member.user.id);
    await serviceContext.playerService.ensurePlayer(
      member.user.id,
      member.displayName || member.user.globalName || member.user.username || member.user.id
    );

    if (!existing) {
      console.log(`[Discord] auto-provisioned player ${member.user.id} (${member.displayName}) via ${reason}`);
    }
  } catch (error) {
    console.error(`[Discord] auto-provision failed for ${member?.user?.id || "unknown"}`, error);
  }
}

async function markPlayerWelcomeAnnounced(discordId, reason = "unknown") {
  try {
    const player = await serviceContext.playerService.playerRepository.findByDiscordId(discordId);
    if (!player) return;
    await serviceContext.playerService.playerRepository.save({
      ...player,
      welcomeAnnouncementSentAt: new Date().toISOString(),
      welcomeAnnouncementReason: reason
    });
  } catch (error) {
    console.warn("[Discord] 無法標記歡迎公告狀態：", error?.message || error);
  }
}

async function ensureWelcomeAnnouncement(member, reason = "unknown") {
  try {
    const allowed = await serviceContext.accessControlService.isDiscordMemberWhitelisted(member);
    if (!allowed) return false;

    await ensureMemberPlayerProfile(member, reason);
    const player = await serviceContext.playerService.playerRepository.findByDiscordId(member.user.id);
    if (player?.welcomeAnnouncementSentAt) {
      return false;
    }

    await sendPlayerWelcomeAnnouncement(member);
    await markPlayerWelcomeAnnounced(member.user.id, reason);
    return true;
  } catch (error) {
    console.warn("[Discord] 補發歡迎公告失敗：", error?.message || error);
    return false;
  }
}

async function sendPlayerWelcomeAnnouncement(member) {
  try {
    const client = getBotClient();
    if (!client?.isReady()) return;

    // 發送到通知頻道 1498608950671839263
    const notificationChannelId = "1498608950671839263";
    const channel = await client.channels.fetch(notificationChannelId).catch((err) => {
      console.error(`[Welcome Announce] Failed to fetch notification channel ${notificationChannelId}:`, err?.message);
      return null;
    });
    if (!channel?.isTextBased()) {
      console.error(`[Welcome Announce] Notification channel ${notificationChannelId} not found or not text-based`);
      return;
    }

    await channel.send(
      `🎉 歡迎 <@${member.user.id}> 加入音無樂園，已正式取得玩家資格！\n` +
      `快去完成打卡、任務，開始你的冒險之旅吧。`
    ).catch((err) => {
      console.error("[Welcome Announce] Failed to send welcome announcement:", err?.message);
    });
  } catch (error) {
    console.error("[Welcome Announce] Unexpected error:", error?.message || error);
  }
}

async function auditMissingWelcomeAnnouncements(client) {
  if (!WELCOME_AUDIT_ENABLED || welcomeAuditRunning) return;
  welcomeAuditRunning = true;
  try {
    if (!client?.isReady() || !config.discord.guildId) return;
    const guild = await client.guilds.fetch(config.discord.guildId);
    await guild.members.fetch();

    let scanned = 0;
    let announced = 0;
    for (const member of guild.members.cache.values()) {
      if (member.user?.bot) continue;
      scanned += 1;
      const didAnnounce = await ensureWelcomeAnnouncement(member, "welcome-audit");
      if (didAnnounce) announced += 1;
    }
    if (announced > 0) {
      console.log(`[Discord] welcome audit scanned ${scanned} members, announced ${announced}`);
    }
  } catch (error) {
    console.warn("[Discord] 歡迎公告補掃描失敗：", error?.message || error);
  } finally {
    if (config.discord.guildId) {
      const guild = client.guilds.cache.get(config.discord.guildId);
      guild?.members?.cache?.clear?.();
    }
    welcomeAuditRunning = false;
  }
}

function extractCustomEmojis(content = "") {
  const matches = [...String(content).matchAll(/<(a?):([A-Za-z0-9_]+):(\d+)>/g)];
  return matches.map((match) => ({
    animated: match[1] === "a",
    name: match[2],
    id: match[3]
  }));
}

async function isAdminMember(member) {
  if (!member) return false;
  const access = await serviceContext.accessControlService.getAccessControl().catch(() => null);
  const adminRoleIds = access?.discord?.adminRoleIds || [];
  const adminUserIds = access?.discord?.adminUserIds || [];

  if (adminUserIds.includes(member.user?.id)) {
    return true;
  }

  if (member.permissions?.has(PermissionsBitField.Flags.ManageGuild) || member.permissions?.has(PermissionsBitField.Flags.Administrator)) {
    return true;
  }

  return adminRoleIds.some((roleId) => member.roles?.cache?.has(roleId));
}

async function moderateRestrictedAnimatedEmoji(message) {
  if (!message.guild) return false;
  if (message.author?.bot) return false;

  const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
  if (!member) return false;
  if (await serviceContext.accessControlService.isDiscordPlayerWhitelisted(member)) return false;
  if (await isAdminMember(member)) return false;

  const usedRestrictedEmoji = extractCustomEmojis(message.content).some((emoji) => (
    emoji.animated && RESTRICTED_ANIMATED_EMOJI_NAMES.has(String(emoji.name || "").toUpperCase())
  ));

  if (!usedRestrictedEmoji) return false;

  await message.delete().catch(() => {});

  if (message.channel?.isTextBased()) {
    const warning = await message.channel.send(
      `⚠️ <@${message.author.id}> 不可以使用指定的動態表情，這次訊息已移除。再使用請改用一般文字或其他表情。`
    ).catch(() => null);
    if (warning) {
      setTimeout(() => {
        warning.delete().catch(() => {});
      }, RESTRICTED_EMOJI_WARNING_DELETE_MS);
    }
  }

  return true;
}

async function setupPersonalRoomChannel(client) {
  const channelId = config.discord.personalRoomChannelId;
  if (!channelId) {
    console.warn("[Discord] 未設定 personalRoomChannelId，跳過自動發佈個人房間面板。");
    return;
  }

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) {
      console.warn("[Discord] personalRoomChannelId 不是有效的文字頻道。");
      return;
    }

    // 檢查是否已有 bot 發布的面板訊息
    const { createPlayerPanelMessage } = require("./playerPanelView");
    const messages = await channel.messages.fetch({ limit: 10 });
    let panelMsg = null;
    for (const msg of messages.values()) {
      if (msg.author.id === client.user.id && msg.pinned && msg.content.includes("玩家操作面板")) {
        panelMsg = msg;
        break;
      }
    }

    if (!panelMsg) {
      const sent = await channel.send(createPlayerPanelMessage());
      await sent.pin().catch(() => {});
    }

    // 鎖定頻道：禁止 @everyone 發言
    try {
      await channel.permissionOverwrites.edit(channel.guild.roles.everyone, { SendMessages: false });
    } catch (_) {
      console.warn("[Discord] 無法鎖定頻道權限，請確認機器人有管理頻道權限。");
    }

    // 允許 adminRoleIds 與 bot 發言
    const access = await serviceContext.accessControlService.getAccessControl();
    for (const roleId of (access.discord.adminRoleIds || [])) {
      try { await channel.permissionOverwrites.edit(roleId, { SendMessages: true }); } catch (_) {}
    }
    try { await channel.permissionOverwrites.edit(client.user.id, { SendMessages: true }); } catch (_) {}

    // 面板刪除後自動重建
    client.on(Events.MessageDelete, async (msg) => {
      if (msg.channelId === channelId && msg.author?.id === client.user.id && msg.content.includes("玩家操作面板")) {
        const sent = await channel.send(createPlayerPanelMessage());
        await sent.pin().catch(() => {});
      }
    });
  } catch (error) {
    console.error("[Discord] 自動發佈個人房間面板失敗：", error);
  }
}

// 鎖定版位設定中非 town_chat 的頻道：@everyone 不能發言
async function setupLockedChannels(client) {
  const layout = await serviceContext.adminConsoleService.getChannelLayout();
  const bindings = layout?.discord?.bindings || [];

  const access = await serviceContext.accessControlService.getAccessControl();
  const adminRoleIds = access.discord.adminRoleIds || [];
  const playerRoleIds = access.discord.playerRoleIds || [];

  // 鎖定非聊天大街的頻道（只有管理員與 bot 可發言，所有人可讀歷史）
  const lockBindings = bindings.filter((b) => b.enabled && b.channelId && b.featureKey !== "town_chat");
  await Promise.allSettled(lockBindings.map(async (binding) => {
    try {
      const channel = await client.channels.fetch(binding.channelId);
      if (!channel || !channel.isTextBased()) return;

      const tasks = [
        channel.permissionOverwrites.edit(channel.guild.roles.everyone, { SendMessages: false, ReadMessageHistory: true }),
        channel.permissionOverwrites.edit(client.user.id, { SendMessages: true, ReadMessageHistory: true }),
        ...adminRoleIds.map((id) => channel.permissionOverwrites.edit(id, { SendMessages: true, ReadMessageHistory: true }).catch(() => {})),
      ];
      // 只有戰鬥區才需要明確禁止玩家發言（其他頻道 @everyone 已封鎖，無需逐一設定）
      if (isMonsterZoneFeatureKey(binding.featureKey)) {
        tasks.push(...playerRoleIds.map((id) => channel.permissionOverwrites.edit(id, { SendMessages: false, ReadMessageHistory: true }).catch(() => {})));
      }
      await Promise.allSettled(tasks);
      console.log(`[Discord] 頻道 ${binding.channelId} (${binding.featureKey}) 已設為唯讀`);
    } catch (err) {
      console.warn(`[Discord] 無法鎖定頻道 ${binding.channelId}：${err.message}`);
    }
  }));

  // 聊天大街：玩家身分組才能發言，@everyone 禁止發言但可讀歷史
  const townBinding = bindings.find((b) => b.enabled && b.channelId && b.featureKey === "town_chat");
  if (townBinding) {
    try {
      const channel = await client.channels.fetch(townBinding.channelId);
      if (channel && channel.isTextBased()) {
        await channel.permissionOverwrites.edit(channel.guild.roles.everyone, { ViewChannel: false, SendMessages: false, ReadMessageHistory: false });
        await channel.permissionOverwrites.edit(client.user.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
        for (const roleId of [...new Set([...playerRoleIds, ...adminRoleIds])]) {
          try { await channel.permissionOverwrites.edit(roleId, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }); } catch (_) {}
        }
        console.log(`[Discord] 聊天大街 ${townBinding.channelId} 已設為玩家可發言`);
      }
    } catch (err) {
      console.warn(`[Discord] 無法設定聊天大街 ${townBinding.channelId}：${err.message}`);
    }
  }
}

// ── 刷屏偵測 ────────────────────────────────────────────────
// key: `${guildId}:${userId}`，value: { lastMsg, count, timestamps: [] }
function listAutoRepublishBindings(layout) {
  const bindings = Array.isArray(layout?.discord?.bindings) ? layout.discord.bindings : [];
  const supported = new Set(["personal_room", "player_query", "coin_shop", "idle_zone", ...MONSTER_ZONE_FEATURE_KEYS]);
  return bindings.filter((entry) => entry?.enabled && entry?.channelId && supported.has(entry.featureKey));
}

async function resolveMonsterPanelState(zoneKey) {
  let state = await serviceContext.monsterService.getState(zoneKey);
  const hasDeadState = Number(state?.currentHp || 0) <= 0 && !state?.activeTransition && !state?.activeEvent;
  if (hasDeadState && zoneKey !== "elite") {
    await _doIdleRotate(serviceContext, zoneKey).catch(() => {});
    state = await serviceContext.monsterService.getState(zoneKey);
  }
  const monsters = await serviceContext.monsterService.listMonsters({ includeDisabled: true, zone: zoneKey });
  let activeMonster = monsters.find((monster) => monster.seq === state.activeMonsterSeq) || null;
  if (!activeMonster && monsters.length > 0) activeMonster = monsters[0];

  const currentHp = state.currentHp != null ? state.currentHp : (activeMonster?.calc?.maxHp ?? null);
  const participantCount = Array.isArray(state.participants) ? state.participants.length : 0;
  const damageMap = state.damageMap && typeof state.damageMap === "object" ? state.damageMap : {};

  const worldBossPartsHp = isWorldBossZone(zoneKey) ? (state.worldBossPartsHp || null) : null;
  return { activeMonster, currentHp, participantCount, damageMap, worldBossPartsHp };
}

async function republishPanelsOnStartup() {
  const layout = await serviceContext.adminConsoleService.getChannelLayout();
  const bindings = listAutoRepublishBindings(layout);
  const processed = new Set();

  for (const binding of bindings) {
    if (processed.has(binding.featureKey)) continue;
    processed.add(binding.featureKey);

    try {
      if (binding.featureKey === "personal_room") {
        await serviceContext.adminConsoleService.publishPlayerPanel(binding.channelId, {
          cleanChannel: true,
          includePinned: true
        });
        console.log(`[PanelReset] republished personal_room -> ${binding.channelId}`);
        continue;
      }

      if (binding.featureKey === "coin_shop") {
        await serviceContext.adminConsoleService.publishCoinShopPanel(binding.channelId, {
          cleanChannel: true,
          includePinned: true
        });
        console.log(`[PanelReset] republished coin_shop -> ${binding.channelId}`);
        continue;
      }

      if (binding.featureKey === "player_query") {
        await serviceContext.adminConsoleService.publishPlayerQueryPanel(binding.channelId, {
          cleanChannel: true,
          includePinned: true
        });
        console.log(`[PanelReset] republished player_query -> ${binding.channelId}`);
        continue;
      }


      if (binding.featureKey === "idle_zone") {
        await serviceContext.adminConsoleService.publishIdleZonePanel(binding.channelId, {
          cleanChannel: true,
          includePinned: true
        });
        console.log(`[PanelReset] republished idle_zone -> ${binding.channelId}`);
        continue;
      }

      if (binding.featureKey === "casino_wheel") {
        await serviceContext.adminConsoleService.publishCasinoPanel(binding.channelId, {
          cleanChannel: true,
          includePinned: true
        });
        console.log(`[PanelReset] republished casino_wheel -> ${binding.channelId}`);
        continue;
      }

      if (isMonsterZoneFeatureKey(binding.featureKey)) {
        const zoneKey = featureKeyToZone(binding.featureKey);
        const { activeMonster, currentHp, participantCount, damageMap, worldBossPartsHp } = await resolveMonsterPanelState(zoneKey);
        await serviceContext.adminConsoleService.publishMonsterZonePanel(binding.channelId, activeMonster, currentHp, {
          participantCount,
          damageMap,
          worldBossPartsHp,
          cleanChannel: true,
          includePinned: true
        });
        console.log(`[PanelReset] republished ${binding.featureKey} -> ${binding.channelId}`);
      }
    } catch (error) {
      console.warn(`[PanelReset] republish failed for ${binding.featureKey} (${binding.channelId}): ${error?.message || error}`);
    }
  }
}

let elitePanelRefreshTimer = null;
function startElitePanelRefreshTimer() {
  // 強制關閉 elite 自動刷新（防止疊面板）。要重新啟用請手動移除這段 return。
  console.log("[ElitePanel] auto-refresh HARDCODED OFF; panels refresh on player activity only");
  return;
}

let monsterPanelRefreshTimer = null;
function startMonsterPanelRefreshTimer() {
  if (process.env.ENABLE_MONSTER_PANEL_REFRESH !== "1") {
    console.log("[MonsterPanel] auto-refresh disabled; panels refresh on player activity");
    return;
  }

  const sec = Math.max(30, Number.parseInt(process.env.MONSTER_PANEL_REFRESH_SECONDS || "30", 10) || 30);
  if (monsterPanelRefreshTimer) clearInterval(monsterPanelRefreshTimer);
  monsterPanelRefreshTimer = setInterval(async () => {
    if (shouldSkipOptionalDiscordSend("monster panel refresh")) return;
    await refreshMonsterZonePanels().catch(() => {});
  }, sec * 1000);
  console.log(`[MonsterPanel] auto-refresh started (${sec}s)`);
}

let auctionPanelRefreshTimer = null;
function startAuctionPanelRefreshTimer() {
  if (process.env.ENABLE_AUCTION_PANEL_REFRESH !== "1") {
    console.log("[AuctionPanel] auto-refresh disabled; panels refresh on player activity");
    return;
  }

  const sec = Math.max(15, Number.parseInt(process.env.AUCTION_PANEL_REFRESH_SECONDS || "600", 10) || 600);
  if (auctionPanelRefreshTimer) clearInterval(auctionPanelRefreshTimer);

  auctionPanelRefreshTimer = setInterval(async () => {
    try {
      if (shouldSkipOptionalDiscordSend("auction panel refresh")) return;
      const { refreshAuctionChannel } = require("./handlers/auctionZoneHandlers");
      await refreshAuctionChannel();
    } catch (error) {
      console.warn(`[AuctionPanel] refresh failed: ${error?.message || error}`);
    }
  }, sec * 1000);

  console.log(`[AuctionPanel] auto-refresh started (${sec}s)`);
}

const spamTracker = new Map();

// 累計違規次數（重啟後歸零，但同一場 session 內遞增）
// key: `${guildId}:${userId}`，value: 累計禁言次數
const offenseTracker = new Map();
const SPAM_TRACKER_TTL_MS = 10 * 60 * 1000;
const OFFENSE_TRACKER_TTL_MS = 24 * 60 * 60 * 1000;

// 讀取 moderation 設定（若 config 未提供，使用預設）
const moderation = config.moderation || {
  // 分級禁言時長：[第1次, 第2次, 第3次+]
  muteTierMs: [
    1 * 60 * 60 * 1000,   // 第1次：1 小時
    6 * 60 * 60 * 1000,   // 第2次：6 小時
    12 * 60 * 60 * 1000,  // 第3次+：12 小時
  ],
  sameMsgLimit: 7,
  burstLimit: 8,
  burstWindowMs: 5000,
  spamAnnounceChannelId: "1292448143946027039",
  mentionPerMsgLimit: 5,
  consecutiveMentionLimit: 6
};

function formatDurationMs(ms) {
  const hours = Math.round(ms / (60 * 60 * 1000));
  if (hours >= 1) return `${hours} 小時`;
  const mins = Math.round(ms / (60 * 1000));
  return `${mins} 分鐘`;
}

function getMuteDurationMs(guildId, userId) {
  const key = `${guildId}:${userId}`;
  const tiers = moderation.muteTierMs || [
    1 * 60 * 60 * 1000,
    6 * 60 * 60 * 1000,
    12 * 60 * 60 * 1000,
  ];
  const offenseEntry = offenseTracker.get(key) || 0;
  const offense = typeof offenseEntry === "object" ? Number(offenseEntry.count || 0) : Number(offenseEntry || 0);
  return tiers[Math.min(offense, tiers.length - 1)];
}

function pruneRuntimeMaps(now = Date.now()) {
  for (const [key, state] of spamTracker.entries()) {
    const lastSeenAt = Number(state?.lastSeenAt || 0);
    if (!lastSeenAt || now - lastSeenAt > SPAM_TRACKER_TTL_MS) spamTracker.delete(key);
  }
  for (const [key, entry] of offenseTracker.entries()) {
    const updatedAt = typeof entry === "object" ? Number(entry.updatedAt || 0) : 0;
    if (!updatedAt || now - updatedAt > OFFENSE_TRACKER_TTL_MS) offenseTracker.delete(key);
  }
}

function startRuntimeCachePruneTimer() {
  if (runtimeCachePruneTimer) return;
  runtimeCachePruneTimer = setInterval(() => pruneRuntimeMaps(), 5 * 60 * 1000);
  runtimeCachePruneTimer.unref?.();
}

function mb(bytes) {
  return Math.round((Number(bytes || 0) / 1024 / 1024) * 10) / 10;
}

function getDiscordCacheDiagnostics(client) {
  const guilds = client?.guilds?.cache;
  let channels = 0;
  let members = 0;
  let messages = 0;
  let threads = 0;

  for (const guild of guilds?.values?.() || []) {
    channels += guild.channels?.cache?.size || 0;
    members += guild.members?.cache?.size || 0;
    for (const channel of guild.channels?.cache?.values?.() || []) {
      messages += channel.messages?.cache?.size || 0;
      threads += channel.threads?.cache?.size || 0;
    }
  }

  return {
    guilds: guilds?.size || 0,
    users: client?.users?.cache?.size || 0,
    channels,
    members,
    messages,
    threads
  };
}

function maybeWriteMemoryHeapSnapshot(payload) {
  if (!MEMORY_HEAPSNAPSHOT_ENABLED) return;
  const overThreshold = payload.rssMB >= MEMORY_HEAPSNAPSHOT_RSS_MB || payload.heapUsedMB >= MEMORY_HEAPSNAPSHOT_HEAP_MB;
  if (!overThreshold) return;

  const now = Date.now();
  if (now - lastMemoryHeapSnapshotAt < MEMORY_HEAPSNAPSHOT_COOLDOWN_MS) return;
  lastMemoryHeapSnapshotAt = now;

  try {
    const heapDir = path.resolve(process.cwd(), "logs", "heap");
    fs.mkdirSync(heapDir, { recursive: true });
    const stamp = new Date(now).toISOString().replace(/[:.]/g, "-");
    const filePath = path.join(heapDir, `heap-${stamp}-rss${payload.rssMB}-heap${payload.heapUsedMB}.heapsnapshot`);
    const writtenPath = v8.writeHeapSnapshot(filePath);
    console.warn(`[MemoryAudit] heap snapshot written file=${writtenPath} rssMB=${payload.rssMB} heapUsedMB=${payload.heapUsedMB}`);
  } catch (error) {
    console.warn(`[MemoryAudit] heap snapshot failed: ${error?.message || error}`);
  }
}

function startMemoryAuditTimer(client) {
  if (!MEMORY_AUDIT_ENABLED || memoryAuditTimer) return;
  const run = () => {
    try {
      const mem = process.memoryUsage();
      const { getMonsterZoneDiagnostics } = require("./handlers/monsterZoneHandlers");
      const { getPkArenaDiagnostics } = require("./handlers/pkArenaHandlers");
      const { getTowerDiagnostics } = require("./handlers/towerHandlers");
      const payload = {
        uptimeSec: Math.round(process.uptime()),
        rssMB: mb(mem.rss),
        heapUsedMB: mb(mem.heapUsed),
        heapTotalMB: mb(mem.heapTotal),
        externalMB: mb(mem.external),
        arrayBuffersMB: mb(mem.arrayBuffers),
        activeHandles: typeof process._getActiveHandles === "function" ? process._getActiveHandles().length : null,
        discord: getDiscordCacheDiagnostics(client),
        runtimeMaps: {
          spamTracker: spamTracker.size,
          offenseTracker: offenseTracker.size
        },
        monsterZone: getMonsterZoneDiagnostics(),
        pk: getPkArenaDiagnostics(),
        tower: getTowerDiagnostics()
      };
      // 只在異常時印 log（記憶體偏高、有 overdue、Discord 無 guild 等），減少 PM2 雜訊
      const abnormalReasons = [];
      if (payload.rssMB >= MEMORY_AUDIT_LOG_RSS_MB) abnormalReasons.push(`rss>=${MEMORY_AUDIT_LOG_RSS_MB}MB`);
      if (payload.heapUsedMB >= MEMORY_AUDIT_LOG_HEAP_MB) abnormalReasons.push(`heap>=${MEMORY_AUDIT_LOG_HEAP_MB}MB`);
      if (payload.monsterZone?.displayingOverdue > 0) abnormalReasons.push(`mz_overdue=${payload.monsterZone.displayingOverdue}`);
      if (payload.discord?.guilds === 0) abnormalReasons.push("discord_disconnected");
      if (MEMORY_AUDIT_VERBOSE || abnormalReasons.length > 0) {
        const prefix = abnormalReasons.length > 0 ? `[MemoryAudit] abnormal:${abnormalReasons.join(",")} ` : "[MemoryAudit] ";
        console.log(`${prefix}${JSON.stringify(payload)}`);
      }
      maybeWriteMemoryHeapSnapshot(payload);
    } catch (error) {
      console.warn(`[MemoryAudit] failed: ${error?.message || error}`);
    }
  };
  memoryAuditTimer = setInterval(run, MEMORY_AUDIT_INTERVAL_MS);
  memoryAuditTimer.unref?.();
  setTimeout(run, 5_000).unref?.();
}

async function doMuteAndAnnounce(member, message, reason, key) {
  try {
    spamTracker.delete(key);

    const offenseKey = `${message.guild.id}:${message.author.id}`;
    const offenseEntry = offenseTracker.get(offenseKey) || 0;
    const offenseBefore = typeof offenseEntry === "object" ? Number(offenseEntry.count || 0) : Number(offenseEntry || 0);
    const muteDurationMs = getMuteDurationMs(message.guild.id, message.author.id);
    offenseTracker.set(offenseKey, { count: offenseBefore + 1, updatedAt: Date.now() });

    await member.timeout(muteDurationMs, reason);
    console.log(`[SpamGuard] 禁言 ${message.author.tag} (${message.author.id}) 第${offenseBefore + 1}次：${reason}`);

    const announceChannel = await message.guild.channels.fetch(moderation.spamAnnounceChannelId).catch(() => null);
    if (announceChannel?.isTextBased()) {
      const durationText = formatDurationMs(muteDurationMs);
      const offenseLabel = offenseBefore === 0 ? '初次' : offenseBefore === 1 ? '第二次' : '第三次以上';
      await announceChannel.send(
        `🔇 <@${message.author.id}> 因 **${reason}**（在 <#${message.channelId}>），${offenseLabel}違規，已被禁言 **${durationText}**。`
      ).catch(() => {});
    }
  } catch (err) {
    console.warn(`[SpamGuard] 無法禁言 ${message.author.tag}：${err?.message || err}`);
  }
}

// key: `${guildId}:${userId}`，value: { lastMsg, count, timestamps: [], lastMentionedId, consecutiveMentionCount }
let _townChatId = null;
let _townChatTs = 0;
async function getTownChatChannelId() {
  if (_townChatId && Date.now() - _townChatTs < 60000) return _townChatId;
  try {
    const layout = await serviceContext.channelLayoutRepository.get();
    const b = (layout?.discord?.bindings || []).find((x) => x.featureKey === "town_chat" && x.enabled);
    _townChatId = b?.channelId || null;
    _townChatTs = Date.now();
  } catch (_) { /* 解析失敗下次再試 */ }
  return _townChatId;
}

async function checkSpam(message) {
  if (!message.guild) return;
  if (message.author.bot) return;

  const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
  if (!member) return;
  if (await serviceContext.accessControlService.isDiscordPlayerWhitelisted(member)) return;
  if (member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) return;

  // @everyone / @here 標註全體 → 直接禁言（管理員/白名單已於上方豁免）
  if (message.mentions?.everyone) {
    await doMuteAndAnnounce(member, message, "亂用 @everyone／@here 標註全體", `${message.guild.id}:${message.author.id}`);
    return;
  }

  const key = `${message.guild.id}:${message.author.id}`;
  const now = Date.now();
  // 訊息「簽章」＝文字＋附件檔名/URL＋貼圖ID → 同句/同圖重複才算刷屏；不同圖不會誤判
  const attachSig = message.attachments?.size
    ? [...message.attachments.values()].map((a) => a.name || a.url || "").sort().join(",")
    : "";
  const stickerSig = message.stickers?.size ? [...message.stickers.keys()].sort().join(",") : "";
  const content = [(message.content || "").trim().toLowerCase(), attachSig, stickerSig].join("|");

  let state = spamTracker.get(key);
  if (!state) {
    state = { lastMsg: content, count: 1, timestamps: [now], lastMentionedId: null, consecutiveMentionCount: 0, lastSeenAt: now };
    spamTracker.set(key, state);
  } else {
    state.lastSeenAt = now;
    state.timestamps = state.timestamps.filter(t => now - t < moderation.burstWindowMs);
    state.timestamps.push(now);
    if (content === state.lastMsg) {
      state.count++;
    } else {
      state.count = 1;
      state.lastMsg = content;
    }
  }

  // 單則訊息 mention 數量檢查（若超過設定則立即處理）
  const mentionCount = (message.mentions && message.mentions.users && message.mentions.users.size) || 0;
  if (mentionCount >= moderation.mentionPerMsgLimit) {
    const reason = '刷屏：單則訊息標註過多成員';
    await doMuteAndAnnounce(member, message, reason, key);
    return;
  }

  // 單則訊息內重複標註同一人（若同一 id 在 content 中重複出現）
  if (mentionCount > 0) {
    for (const userId of message.mentions.users.keys()) {
      const regex = new RegExp(`<@!?${userId}>`, "g");
      const matches = (message.content || "").match(regex) || [];
      if (matches.length >= moderation.consecutiveMentionLimit) {
        const reason = '刷屏：單則訊息重複標註相同成員';
        await doMuteAndAnnounce(member, message, reason, key);
        return;
      }
    }
  }

  // 跨訊息連續標註同一人（只考慮此則訊息包含單一 mention 的情況）
  if (mentionCount === 1) {
    const targetId = [...message.mentions.users.keys()][0];
    if (state.lastMentionedId === targetId) {
      state.consecutiveMentionCount = (state.consecutiveMentionCount || 0) + 1;
    } else {
      state.consecutiveMentionCount = 1;
      state.lastMentionedId = targetId;
    }
    if (state.consecutiveMentionCount >= moderation.consecutiveMentionLimit) {
      const reason = '刷屏：連續標註相同成員';
      await doMuteAndAnnounce(member, message, reason, key);
      return;
    }
  } else {
    state.lastMentionedId = null;
    state.consecutiveMentionCount = 0;
  }

  // 既有的連續相同訊息 / burst 檢查
  const sameSpam = state.count >= moderation.sameMsgLimit;
  const burstSpam = state.timestamps.length > moderation.burstLimit;

  if (!sameSpam && !burstSpam) return;

  const reason = sameSpam ? '刷屏：同一句話連續超過上限' : '刷屏：短時間內過量發言';
  await doMuteAndAnnounce(member, message, reason, key);
}
// ────────────────────────────────────────────────────────────

function createBotClient() {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildWebhooks, GatewayIntentBits.GuildEmojisAndStickers],
    makeCache: Options.cacheWithLimits({
      ...Options.DefaultMakeCacheSettings,
      MessageManager: 0,
      GuildMemberManager: 100,
      UserManager: 100,
      ThreadManager: 25,
      ThreadMemberManager: 0,
      ReactionManager: 0,
      ReactionUserManager: 0,
      PresenceManager: 0,
      VoiceStateManager: 0
    }),
    sweepers: {
      ...Options.DefaultSweeperSettings,
      threads: {
        interval: 30 * 60,
        lifetime: 30 * 60
      }
    }
  });
  setBotClient(client);

  client.rest.on(RESTEvents.RateLimited, (rateLimitData) => {
    markDiscordRestRateLimited(rateLimitData);
  });

  client.once(Events.ClientReady, async (readyClient) => {
    console.log(`[Discord] Logged in as ${readyClient.user.tag}`);
    startRuntimeCachePruneTimer();
    startMemoryAuditTimer(readyClient);
    // Timed panel maintenance must not wait for Discord permission overwrite calls.
    startAuctionPanelRefreshTimer();
    startMonsterPanelRefreshTimer();
    startElitePanelRefreshTimer();
    await setupPersonalRoomChannel(readyClient);
    // 啟動時自動鎖頻道會對每個頻道做 3-6 次 PATCH，極易撞到 Discord 對 /channels/:id/permissions/:id
    // 的嚴格限流，連帶把玩家互動的 editReply 卡住。Discord 的權限會保留在伺服器端，重啟不需要重新套用。
    // 要強制重套請設 ENABLE_STARTUP_CHANNEL_LOCK=1。
    if (process.env.ENABLE_STARTUP_CHANNEL_LOCK === "1") {
      await setupLockedChannels(readyClient);
    } else {
      console.log("[Discord] startup channel lock HARDCODED OFF (set ENABLE_STARTUP_CHANNEL_LOCK=1 to re-enable)");
    }
    // 啟動時自動重發面板會在 rate limit 下產生孤兒面板，已強制關閉。
    // 要重發面板請到後台手動按「📨 發布面板」。
    console.log("[PanelReset] startup auto-republish HARDCODED OFF (ignore ENABLE_STARTUP_PANEL_REPUBLISH env)");

    await initPkArenaState().catch((error) => {
      console.warn(`[PKArena] restore failed: ${error?.message || error}`);
    });

    await restoreTowerSessions().catch((error) => {
      console.warn(`[Tower] restore failed: ${error?.message || error}`);
    });

    try {
      const { initCasinoPanel } = require("./handlers/casinoHandlers");
      await initCasinoPanel();
      console.log("[Casino] service started, panel refresh loop running");
    } catch (err) {
      console.warn("[Casino] init failed:", err?.message || err);
    }

    // 啟動 OneComme 直播留言監聽（同時中繼給聊天室 overlay 的 SSE，讓別台電腦也能讀）
    const { broadcastComment } = require("../services/chat/chatOverlayHub");
    const viewerService = require("../services/stream/viewerService");
    startFetcher((comment) => {
      try { broadcastComment(comment); } catch (_) {}
      handleStreamComment(comment);
    }, (meta) => {
      // OneComme WS meta → 更新即時觀看人數（第四線基礎）
      try { viewerService.update(meta).catch(() => {}); } catch (_) {}
    });
    // 另外每 20 秒輪詢 OneComme REST /api/services（觀看數的可靠來源）
    startViewerPoller((info) => { try { viewerService.update(info).catch(() => {}); } catch (_) {} }, 20_000);
    // 觀看熱度 buff 評估：獨立每 20 秒跑「一次」（與直播枠數量脫鉤，避免每枠各觸發一次造成重複廣播）
    const viewerEventsService = require("../services/stream/viewerEventsService");
    const viewerEvalTimer = setInterval(() => { viewerEventsService.evaluate().catch(() => {}); }, 20_000);
    viewerEvalTimer.unref?.();
    // 啟動閒置自動換怪計時器（可透過 DISABLE_AUTO_ROTATE=1 暫時停用）
    if (process.env.DISABLE_AUTO_ROTATE === '1') {
      console.log('[IdleRotate] disabled by DISABLE_AUTO_ROTATE');
    } else {
      startIdleRotateTimer();
    }
    // 世界王逃跑→重生面板刷新監看（每 3 分，僅狀態變化時刷新）
    try { startWorldBossRespawnWatcher(); } catch (e) { console.warn("[WorldBossWatcher] 啟動失敗:", e?.message || e); }
    // 卡住面板自動修復（每 45 秒掃，只動轉場過期/死了沒換怪的 zone）
    try { startMonsterPanelSweep(); } catch (e) { console.warn("[MonsterSweep] 啟動失敗:", e?.message || e); }

    if (welcomeAuditTimer) clearInterval(welcomeAuditTimer);
    auditMissingWelcomeAnnouncements(readyClient).catch(() => {});
    if (WELCOME_AUDIT_ENABLED) {
      welcomeAuditTimer = setInterval(() => {
        auditMissingWelcomeAnnouncements(readyClient).catch(() => {});
      }, WELCOME_AUDIT_INTERVAL_MS);
      console.log(`[Discord] welcome audit timer started (${WELCOME_AUDIT_INTERVAL_MS}ms)`);
    } else {
      console.log("[Discord] welcome audit disabled");
    }

    // 會員名單定期快照比對（首次上線後 90 秒跑一次補齊現有會員，之後每 12 小時；不改動任何身分組）
    try {
      const { reconcileMembership } = require("../services/stream/membershipTracker");
      const runReconcile = async () => {
        if (!config.discord.guildId) return;
        const guild = await readyClient.guilds.fetch(config.discord.guildId).catch(() => null);
        if (guild) await reconcileMembership(guild, serviceContext, { source: "reconcile" });
      };
      setTimeout(() => { runReconcile().catch(() => {}); }, 90_000).unref?.();
      if (membershipReconcileTimer) clearInterval(membershipReconcileTimer);
      membershipReconcileTimer = setInterval(() => { runReconcile().catch(() => {}); }, 12 * 60 * 60 * 1000);
      console.log("[Membership] 會員快照比對排程已啟動（每 12 小時）");
    } catch (e) {
      console.warn("[Membership] 快照排程啟動失敗：", e?.message || e);
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      // ── 賽季結束維護閘門 ──
      // 維護生效時，非白名單玩家只保留「我的資料 / 裝備欄」兩顆按鈕，其餘互動一律擋下。
      {
        const maintenance = require("../services/access/maintenanceStore");
        if (maintenance.isActive() && !maintenance.isWhitelisted(interaction.user?.id)) {
          const MAINT_ALLOWED = new Set(["player-panel:profile", "player-panel:equipment"]);
          const allowed = interaction.isButton() && MAINT_ALLOWED.has(interaction.customId);
          if (!allowed) {
            const info = maintenance.getPublicInfo();
            const text = `🌙 **${info.title}**\n${info.message}\n${info.inviteUrl || ""}`;
            try {
              if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: text, ephemeral: true });
              }
            } catch (_) {}
            return;
          }
        }
      }
      if (interaction.isChatInputCommand()) { await handleCommand(interaction); return; }
      if (interaction.isButton()) { await handleButton(interaction); return; }
      if (interaction.isStringSelectMenu()) { await handleSelectMenu(interaction); return; }
      if (interaction.isModalSubmit()) { await handleModal(interaction); return; }
    } catch (error) {
      if (error?.code === 10062) return; // interaction token 已過期，無法回應，靜默忽略
      if (error?.code === 40060) return; // interaction 已被 acknowledge（重複觸發），靜默忽略
      if (isTransientDiscordNetworkError(error)) {
        markDiscordRestError(error, "interaction handling");
        resetDiscordRestAgent(interaction.client, error?.code || error?.message || "transient interaction error");
        console.warn("[Discord] transient interaction reply error:", error?.message || error);
        return;
      }
      console.error("[Discord] command error", error);
      const message = isAppError(error) ? `❌ ${error.message}` : "發生錯誤，請稍後再試。";
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
        } else {
          await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
        }
      } catch (replyError) {
        if (!isTransientDiscordNetworkError(replyError)) console.error("[Discord] reply error", replyError);
      }
    }
  });

  client.on(Events.MessageCreate, async (message) => {
    await checkSpam(message).catch((err) => console.error("[SpamGuard] error", err));
    // 城鎮聊天大廳有真人發言 → 記錄「最近發言」(供戰鬥畫面玩家氣泡的講話圖示;只記有沒有講)
    try {
      if (!message.author?.bot && message.author?.id) {
        const townId = await getTownChatChannelId();
        if (townId && message.channelId === townId) {
          require("../services/realtime/chatPresence").markSpoke(message.author.id);
        }
      }
    } catch (_) { /* noop */ }
    const handled = await moderateRestrictedAnimatedEmoji(message).catch((err) => {
      console.error("[EmojiModeration] error", err);
      return false;
    });
    if (handled) return;
    // 直播留言也在這裡走（原本由 commentFetcher 負責，非 Discord 訊息，故不衝突）
  });

  client.on(Events.GuildMemberAdd, async (member) => {
    await ensureMemberPlayerProfile(member, "guild-member-add");
    await ensureWelcomeAnnouncement(member, "guild-member-add");
  });

  client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    const wasAllowed = await serviceContext.accessControlService.isDiscordMemberWhitelisted(oldMember);
    const isAllowed = await serviceContext.accessControlService.isDiscordMemberWhitelisted(newMember);
    if (!wasAllowed && isAllowed) {
      await ensureWelcomeAnnouncement(newMember, "guild-member-update");
    }
    // 會員(tier 身分組)加入/到期/升降級 → 寫進記錄層(best-effort，不影響上面流程)
    try {
      await require("../services/stream/membershipTracker").trackMembershipChange(oldMember, newMember, serviceContext);
    } catch (err) {
      console.warn("[Membership] update hook error:", err?.message || err);
    }
  });

  return client;
}

async function loginBot(client) {
  if (!config.discord.token) {
    console.warn("[Discord] DISCORD_TOKEN not set; bot login skipped.");
    return;
  }
  await client.login(config.discord.token);
}

module.exports = {
  createBotClient,
  loginBot
};
