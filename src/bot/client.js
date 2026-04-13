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
const MUTE_DURATION_MS = 3 * 60 * 60 * 1000; // 3 小時
const SPAM_ANNOUNCE_CHANNEL_ID = "1292448143946027039"; // 公告頻道
const SAME_MSG_LIMIT = 4;   // 同一句話連續超過幾次就禁言
const BURST_LIMIT    = 6;   // 幾次
const BURST_WINDOW_MS = 3000; // 在幾毫秒內

async function checkSpam(message) {
  if (!message.guild) return;                            // 只管伺服器頻道
  if (message.author.bot) return;                       // 忽略機器人
  // 管理員或有禁言他人權限的人不受限制
  const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
  if (!member) return;
  if (member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) return;

  const key = `${message.guild.id}:${message.author.id}`;
  const now = Date.now();
  const content = message.content.trim().toLowerCase();

  let state = spamTracker.get(key);
  if (!state) {
    state = { lastMsg: content, count: 1, timestamps: [now] };
    spamTracker.set(key, state);
    return;
  }

  // 清理 BURST_WINDOW_MS 外的時間戳
  state.timestamps = state.timestamps.filter(t => now - t < BURST_WINDOW_MS);
  state.timestamps.push(now);

  // 同一句話計數
  if (content === state.lastMsg) {
    state.count++;
  } else {
    state.count = 1;
    state.lastMsg = content;
  }

  const sameSpam  = state.count > SAME_MSG_LIMIT;
  const burstSpam = state.timestamps.length > BURST_LIMIT;

  if (!sameSpam && !burstSpam) return;

  // 重置紀錄，避免重複觸發
  spamTracker.delete(key);

  const reason = sameSpam
    ? `刷屏：同一句話連續超過 ${SAME_MSG_LIMIT} 次`
    : `刷屏：${BURST_WINDOW_MS / 1000} 秒內發言超過 ${BURST_LIMIT} 次`;

  try {
    await member.timeout(MUTE_DURATION_MS, reason);
    console.log(`[SpamGuard] 禁言 ${message.author.tag} (${message.author.id})：${reason}`);

    // 發公告到指定頻道
    const announceChannel = await message.guild.channels.fetch(SPAM_ANNOUNCE_CHANNEL_ID).catch(() => null);
    if (announceChannel?.isTextBased()) {
      await announceChannel.send(
        `🔇 <@${message.author.id}> 因 **${reason}**（在 <#${message.channelId}>），已被禁言 3 小時。`
      ).catch(() => {});
    }
  } catch (err) {
    console.warn(`[SpamGuard] 無法禁言 ${message.author.tag}：${err.message}`);
  }
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

  client.on(Events.InteractionCreate, async (interaction) => {
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
