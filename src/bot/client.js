// Discord Bot Client 建立與登入
// ------------------------------------------------

const { Client, GatewayIntentBits, Events, MessageFlags, PermissionsBitField } = require("discord.js");
const config = require("../config");
const { isAppError } = require("../shared/errors");
const { handleCommand, handleButton, handleSelectMenu, handleModal } = require("./commands");
const { serviceContext, setBotClient, getBotClient } = require("./runtimeContext");
const { startFetcher } = require("./commentFetcher");
const { handleStreamComment } = require("./handlers/streamHandlers");
const { startIdleRotateTimer } = require("./handlers/monsterZoneHandlers");
const { runWithCache } = require("../adapters/mongo/requestCache");

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
  const isMonsterZone = (fk) => fk === "monster_zone" || fk === "monster_zone_mid";

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
      if (isMonsterZone(binding.featureKey)) {
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
  const supported = new Set(["personal_room", "coin_shop", "weekly_quest", "monster_zone", "monster_zone_mid"]);
  return bindings.filter((entry) => entry?.enabled && entry?.channelId && supported.has(entry.featureKey));
}

async function resolveMonsterPanelState(zoneKey) {
  const state = await serviceContext.monsterService.getState(zoneKey);
  const monsters = await serviceContext.monsterService.listMonsters({ includeDisabled: true, zone: zoneKey });
  let activeMonster = monsters.find((monster) => monster.seq === state.activeMonsterSeq) || null;
  if (!activeMonster && monsters.length > 0) activeMonster = monsters[0];

  const currentHp = state.currentHp != null ? state.currentHp : (activeMonster?.calc?.maxHp ?? null);
  const participantCount = Array.isArray(state.participants) ? state.participants.length : 0;
  const damageMap = state.damageMap && typeof state.damageMap === "object" ? state.damageMap : {};

  return { activeMonster, currentHp, participantCount, damageMap };
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

      if (binding.featureKey === "weekly_quest") {
        await serviceContext.adminConsoleService.publishWeeklyQuestPanel(binding.channelId, {
          cleanChannel: true,
          includePinned: true
        });
        console.log(`[PanelReset] republished weekly_quest -> ${binding.channelId}`);
        continue;
      }

      if (binding.featureKey === "monster_zone" || binding.featureKey === "monster_zone_mid") {
        const zoneKey = binding.featureKey === "monster_zone_mid" ? "mid" : "normal";
        const { activeMonster, currentHp, participantCount, damageMap } = await resolveMonsterPanelState(zoneKey);
        await serviceContext.adminConsoleService.publishMonsterZonePanel(binding.channelId, activeMonster, currentHp, {
          participantCount,
          damageMap,
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

const spamTracker = new Map();

// 讀取 moderation 設定（若 config 未提供，使用預設）
const moderation = config.moderation || {
  muteDurationMs: 12 * 60 * 60 * 1000,
  sameMsgLimit: 4,
  burstLimit: 6,
  burstWindowMs: 3000,
  spamAnnounceChannelId: "1292448143946027039",
  mentionPerMsgLimit: 5,
  consecutiveMentionLimit: 4
};

function formatDurationMs(ms) {
  const hours = Math.round(ms / (60 * 60 * 1000));
  if (hours >= 1) return `${hours} 小時`;
  const mins = Math.round(ms / (60 * 1000));
  return `${mins} 分鐘`;
}

async function doMuteAndAnnounce(member, message, reason, key) {
  try {
    spamTracker.delete(key);
    await member.timeout(moderation.muteDurationMs, reason);
    console.log(`[SpamGuard] 禁言 ${message.author.tag} (${message.author.id})：${reason}`);

    const announceChannel = await message.guild.channels.fetch(moderation.spamAnnounceChannelId).catch(() => null);
    if (announceChannel?.isTextBased()) {
      const durationText = formatDurationMs(moderation.muteDurationMs);
      await announceChannel.send(
        `🔇 <@${message.author.id}> 因 **${reason}**（在 <#${message.channelId}>），已被禁言 ${durationText}。`
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
  const sameSpam = state.count >= moderation.sameMsgLimit; // >= 使用者需求（第 4 次觸發）
  const burstSpam = state.timestamps.length > moderation.burstLimit;

  if (!sameSpam && !burstSpam) return;

  const reason = sameSpam ? '刷屏：同一句話連續超過上限' : '刷屏：短時間內過量發言';
  await doMuteAndAnnounce(member, message, reason, key);
}
// ────────────────────────────────────────────────────────────

function createBotClient() {
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildWebhooks, GatewayIntentBits.GuildEmojisAndStickers] });
  setBotClient(client);

  client.once(Events.ClientReady, async (readyClient) => {
    console.log(`[Discord] Logged in as ${readyClient.user.tag}`);
    await setupPersonalRoomChannel(readyClient);
    await setupLockedChannels(readyClient);
    await republishPanelsOnStartup();
    
    // 啟動 OneComme 直播留言監聽
    startFetcher(handleStreamComment);
    // 啟動閒置自動換怪計時器（可透過 DISABLE_AUTO_ROTATE=1 暫時停用）
    if (process.env.DISABLE_AUTO_ROTATE === '1') {
      console.log('[IdleRotate] disabled by DISABLE_AUTO_ROTATE');
    } else {
      startIdleRotateTimer();
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
        console.error("[Discord] command error", error);
        const message = isAppError(error) ? `❌ ${error.message}` : "發生錯誤，請稍後再試。";
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
        } else {
          await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
        }
      }
    });
  });

  client.on(Events.MessageCreate, async (message) => {
    await checkSpam(message).catch((err) => console.error("[SpamGuard] error", err));
    // 直播留言也在這裡走（原本由 commentFetcher 負責，非 Discord 訊息，故不衝突）
  });

  client.on(Events.GuildMemberAdd, async (member) => {
    await ensureMemberPlayerProfile(member, "guild-member-add");
  });

  client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    const wasAllowed = await serviceContext.accessControlService.isDiscordMemberWhitelisted(oldMember);
    const isAllowed = await serviceContext.accessControlService.isDiscordMemberWhitelisted(newMember);
    if (!wasAllowed && isAllowed) {
      await ensureMemberPlayerProfile(newMember, "guild-member-update");
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
