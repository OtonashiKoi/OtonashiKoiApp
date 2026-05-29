const { MessageFlags } = require("discord.js");
const { createPlayerPanelMessage } = require("../playerPanel");
const { createPlayerQueryPanelMessage } = require("../playerQueryPanelView");
const { serviceContext, getBotClient } = require("../runtimeContext");

async function handlePublishPlayerQuery(interaction) {
  if (!(await serviceContext.accessControlService.isDiscordAdmin(interaction))) {
    await interaction.reply({ content: "❌ 你沒有管理員權限。", flags: MessageFlags.Ephemeral });
    return;
  }

  if (!interaction.channel) {
    await interaction.reply({ content: "❌ 目前找不到可發布面板的聊天室。", flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.channel.send(createPlayerQueryPanelMessage());
  await interaction.reply({
    content:
      `✅ 玩家查詢面板已發布到目前聊天室。\n` +
      `/管理員扣鑽石\n` +
      `/管理員加經驗\n\n` +
      `玩家操作請直接點聊天室內的玩家面板按鈕。`,
    flags: MessageFlags.Ephemeral
  });
}

async function handlePublishPlayerPanel(interaction) {
  if (!(await serviceContext.accessControlService.isDiscordAdmin(interaction))) {
    await interaction.reply({ content: "❌ 你沒有管理員權限。", flags: MessageFlags.Ephemeral });
    return;
  }

  if (!interaction.channel) {
    await interaction.reply({ content: "❌ 目前找不到可發布面板的聊天室。", flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.channel.send(createPlayerPanelMessage());
  await interaction.reply({ content: "✅ 玩家面板已發布到目前聊天室。", flags: MessageFlags.Ephemeral });
}

async function handlePublishPersonalRoom(interaction) {
  if (!(await serviceContext.accessControlService.isDiscordAdmin(interaction))) {
    await interaction.reply({ content: "❌ 你沒有管理員權限。", flags: MessageFlags.Ephemeral });
    return;
  }

  if (!interaction.channel || !interaction.guild) {
    await interaction.reply({ content: "❌ 目前找不到可發布面板的聊天室。", flags: MessageFlags.Ephemeral });
    return;
  }

  try {
    const sent = await interaction.channel.send(createPlayerPanelMessage());
    try { await sent.pin().catch(() => {}); } catch (e) {}

    const access = await serviceContext.accessControlService.getAccessControl();
    const adminRoleIds = access.discord.adminRoleIds || [];
    const guild = interaction.guild;

    try {
      await interaction.channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false });
    } catch (err) {
      await interaction.reply({ content: "⚠️ 無法修改頻道權限：請確認機器人具有管理頻道的權限。", flags: MessageFlags.Ephemeral });
      return;
    }

    for (const roleId of adminRoleIds) {
      try { await interaction.channel.permissionOverwrites.edit(roleId, { SendMessages: true }); } catch (e) {}
    }

    const client = getBotClient();
    if (client?.user?.id) {
      try { await interaction.channel.permissionOverwrites.edit(client.user.id, { SendMessages: true }); } catch (e) {}
    }

    await interaction.reply({ content: "✅ 個人房間面板已發布並鎖定頻道。非管理員將無法發言，玩家請使用按鈕查看個人資訊（回覆為私人顯示）。", flags: MessageFlags.Ephemeral });
  } catch (error) {
    await interaction.reply({ content: "❌ 發布失敗，請稍後再試。", flags: MessageFlags.Ephemeral });
  }
}

module.exports = {
  handlePublishPlayerQuery,
  handlePublishPlayerPanel,
  handlePublishPersonalRoom
};
