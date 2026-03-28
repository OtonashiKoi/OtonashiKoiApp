const fetch = require('node-fetch');
// 取得聊天室順番待ち（留言）列表
async function fetchOrderList() {
  try {
    const response = await fetch('http://localhost:11180/api/orders');
    if (!response.ok) throw new Error('Failed to fetch order list');
    const data = await response.json();
    return data;
  } catch (err) {
    console.error('Error fetching order list:', err);
    return null;
  }
}
const { Client, GatewayIntentBits, Events, MessageFlags } = require("discord.js");
const config = require("../config");
const { isAppError } = require("../shared/errors");
const { handleCommand, handleButton, handleModal } = require("./commands");
const { serviceContext, setBotClient } = require("./runtimeContext");

async function ensureMemberPlayerProfile(member, reason) {
  try {
    const allowed = await serviceContext.accessControlService.isDiscordMemberWhitelisted(member);
    if (!allowed) {
      return;
    }

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

function createBotClient() {
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
  setBotClient(client);


  // --- 定時輪詢聊天室留言，並打印新留言 + 自動發佈個人房間面板 ---
  let lastOrderIds = new Set();
  client.once(Events.ClientReady, async (readyClient) => {
    console.log(`[Discord] Logged in as ${readyClient.user.tag}`);

    // 定時輪詢聊天室留言
    async function pollOrderList() {
      const orderList = await fetchOrderList();
      if (Array.isArray(orderList)) {
        const newOrders = orderList.filter(item => !lastOrderIds.has(item.commentId));
        if (newOrders.length > 0) {
          newOrders.forEach(item => {
            console.log(`[OneComme] 新留言:`, item);
          });
        }
        lastOrderIds = new Set(orderList.map(item => item.commentId));
      }
      setTimeout(pollOrderList, 5000);
    }
    pollOrderList();

    // --- 自動發佈個人房間面板並鎖定頻道 ---
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

      // 先檢查是否已有 bot 發佈的面板訊息
      let panelMsg = null;
      const messages = await channel.messages.fetch({ limit: 10 });
      for (const msg of messages.values()) {
        if (msg.author.id === client.user.id && msg.pinned && msg.content.includes("玩家操作面板")) {
          panelMsg = msg;
          break;
        }
      }
      const { createPlayerPanelMessage } = require("./playerPanelView");
      if (!panelMsg) {
        // 發佈並釘選
        const sent = await channel.send(createPlayerPanelMessage());
        await sent.pin().catch(() => {});
        panelMsg = sent;
      }

      // 鎖定頻道權限
      try {
        await channel.permissionOverwrites.edit(channel.guild.roles.everyone, { SendMessages: false });
      } catch (e) {
        console.warn("[Discord] 無法鎖定頻道權限，請確認機器人有管理頻道權限。", e);
      }
      // 允許 adminRoleIds 與 bot 發言
      const access = await serviceContext.accessControlService.getAccessControl();
      const adminRoleIds = access.discord.adminRoleIds || [];
      for (const roleId of adminRoleIds) {
        try { await channel.permissionOverwrites.edit(roleId, { SendMessages: true }); } catch (_) {}
      }
      try { await channel.permissionOverwrites.edit(client.user.id, { SendMessages: true }); } catch (_) {}

      // 監控訊息刪除自動重建
      client.on(Events.MessageDelete, async (msg) => {
        if (msg.channelId === channelId && msg.author?.id === client.user.id && msg.content.includes("玩家操作面板")) {
          // 重建
          const sent = await channel.send(createPlayerPanelMessage());
          await sent.pin().catch(() => {});
        }
      });
    } catch (e) {
      console.error("[Discord] 自動發佈個人房間面板失敗：", e);
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        await handleCommand(interaction);
        return;
      }

      if (interaction.isButton()) {
        await handleButton(interaction);
        return;
      }

      if (interaction.isModalSubmit()) {
        await handleModal(interaction);
        return;
      }
    } catch (error) {
      console.error("[Discord] command error", error);
      const message = isAppError(error) ? `❌ ${error.message}` : "發生錯誤，請稍後再試。";
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({
          content: message,
          flags: MessageFlags.Ephemeral 
        });
      } else {
        await interaction.reply({
          content: message,
          flags: MessageFlags.Ephemeral 
        });
      }
    }
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
  loginBot,
  fetchOrderList
};
