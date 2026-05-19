// Discord Bot Client 建立與登入
// ------------------------------------------------

const { Client, GatewayIntentBits, Events, MessageFlags, PermissionsBitField, RESTEvents } = require("discord.js");
const config = require("../config");
const { isAppError } = require("../shared/errors");
const { handleCommand, handleButton, handleSelectMenu, handleModal } = require("./commands");
const { serviceContext, setBotClient, getBotClient } = require("./runtimeContext");
const { startFetcher } = require("./commentFetcher");
const { handleStreamComment } = require("./handlers/streamHandlers");
const { startIdleRotateTimer, refreshEliteWorldBossPanel, refreshMonsterZonePanels, _doIdleRotate } = require("./handlers/monsterZoneHandlers");
const { initPkArenaState } = require("./handlers/pkArenaHandlers");
const { restoreTowerSessions } = require("./handlers/towerHandlers");
const { runWithCache } = require("../adapters/mongo/requestCache");
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

let welcomeAuditTimer = null;
let welcomeAuditRunning = false;

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

  const worldBossPartsHp = zoneKey === "elite" ? (state.worldBossPartsHp || null) : null;
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
  if (process.env.ENABLE_ELITE_PANEL_REFRESH !== "1") {
    console.log("[ElitePanel] auto-refresh disabled; panels refresh on player activity");
    return;
  }

  const sec = Math.max(5, Number.parseInt(process.env.ELITE_PANEL_REFRESH_SECONDS || "10", 10) || 10);
  if (elitePanelRefreshTimer) clearInterval(elitePanelRefreshTimer);
  elitePanelRefreshTimer = setInterval(async () => {
    if (shouldSkipOptionalDiscordSend("elite panel refresh")) return;
    await refreshEliteWorldBossPanel().catch(() => {});
  }, sec * 1000);
  console.log(`[ElitePanel] auto-refresh started (${sec}s)`);
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
  const offense = offenseTracker.get(key) || 0;
  return tiers[Math.min(offense, tiers.length - 1)];
}

async function doMuteAndAnnounce(member, message, reason, key) {
  try {
    spamTracker.delete(key);

    const offenseKey = `${message.guild.id}:${message.author.id}`;
    const offenseBefore = offenseTracker.get(offenseKey) || 0;
    const muteDurationMs = getMuteDurationMs(message.guild.id, message.author.id);
    offenseTracker.set(offenseKey, offenseBefore + 1);

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
async function checkSpam(message) {
  if (!message.guild) return;
  if (message.author.bot) return;

  const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
  if (!member) return;
  if (await serviceContext.accessControlService.isDiscordPlayerWhitelisted(member)) return;
  if (member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) return;

  const key = `${message.guild.id}:${message.author.id}`;
  const now = Date.now();
  const content = (message.content || "").trim().toLowerCase();

  let state = spamTracker.get(key);
  if (!state) {
    state = { lastMsg: content, count: 1, timestamps: [now], lastMentionedId: null, consecutiveMentionCount: 0 };
    spamTracker.set(key, state);
  } else {
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
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildWebhooks, GatewayIntentBits.GuildEmojisAndStickers] });
  setBotClient(client);

  client.rest.on(RESTEvents.RateLimited, (rateLimitData) => {
    markDiscordRestRateLimited(rateLimitData);
  });

  client.once(Events.ClientReady, async (readyClient) => {
    console.log(`[Discord] Logged in as ${readyClient.user.tag}`);
    await setupPersonalRoomChannel(readyClient);
    await setupLockedChannels(readyClient);
    const shouldRepublishPanels = process.env.ENABLE_STARTUP_PANEL_REPUBLISH === "1";
    if (shouldRepublishPanels) {
      await republishPanelsOnStartup();
      console.log("[PanelReset] startup auto-republish enabled");
    } else {
      console.log("[PanelReset] startup auto-republish disabled");
    }

    await initPkArenaState().catch((error) => {
      console.warn(`[PKArena] restore failed: ${error?.message || error}`);
    });

    await restoreTowerSessions().catch((error) => {
      console.warn(`[Tower] restore failed: ${error?.message || error}`);
    });

    // 拍賣場公開面板倒數/到期狀態需定時重繪
    startAuctionPanelRefreshTimer();
    // 一般怪物區面板定時重繪，避免打完後卡住舊狀態
    startMonsterPanelRefreshTimer();
    // 精英區世界BOSS面板固定自動刷新
    startElitePanelRefreshTimer();
    
    // 啟動 OneComme 直播留言監聽
    startFetcher(handleStreamComment);
    // 啟動閒置自動換怪計時器（可透過 DISABLE_AUTO_ROTATE=1 暫時停用）
    if (process.env.DISABLE_AUTO_ROTATE === '1') {
      console.log('[IdleRotate] disabled by DISABLE_AUTO_ROTATE');
    } else {
      startIdleRotateTimer();
    }

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
  });

  client.on(Events.InteractionCreate, (interaction) => {
    // 每個 interaction 建立獨立的記憶體快取 context
    // 同一個指令內重複讀取同一 playerId 的資料直接從記憶體回傳
    runWithCache(async () => {
      try {
        if (interaction.isChatInputCommand()) { await handleCommand(interaction); return; }
        if (interaction.isButton()) { await handleButton(interaction); return; }
        if (interaction.isStringSelectMenu()) { await handleSelectMenu(interaction); return; }
        if (interaction.isModalSubmit()) { await handleModal(interaction); return; }
      } catch (error) {
        if (error?.code === 10062) return; // interaction token 已過期，無法回應，靜默忽略
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
  });

  client.on(Events.MessageCreate, async (message) => {
    await checkSpam(message).catch((err) => console.error("[SpamGuard] error", err));
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
