// 個人房間面板 發布/解鎖 指令處理器
// ------------------------------------------------

const { MessageFlags } = require("discord.js");
const { createPlayerPanelMessage } = require("../playerPanelView");
const { serviceContext, getBotClient } = require("../runtimeContext");

async function isAdmin(interaction) {
  return serviceContext.accessControlService.isDiscordAdmin(interaction);
}

async function handlePublishPersonalRoom(interaction) {
  if (interaction.commandName !== "發布個人房間面板") return false;

  if (!(await isAdmin(interaction))) {
    await interaction.reply({ content: "❌ 你沒有管理員權限。", flags: MessageFlags.Ephemeral });
    return true;
  }

  if (!interaction.channel || !interaction.guild) {
    await interaction.reply({ content: "❌ 目前找不到可發布面板的聊天室。", flags: MessageFlags.Ephemeral });
    return true;
  }

  try {
    const sent = await interaction.channel.send(createPlayerPanelMessage());
    try { await sent.pin().catch(() => {}); } catch (_) {}

    const access = await serviceContext.accessControlService.getAccessControl();
    const adminRoleIds = access.discord.adminRoleIds || [];
    const guild = interaction.guild;

    try {
      await interaction.channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false });
    } catch (_) {
      await interaction.reply({
        content: "⚠️ 無法修改頻道權限：請確認機器人具有管理頻道的權限。",
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    for (const roleId of adminRoleIds) {
      try { await interaction.channel.permissionOverwrites.edit(roleId, { SendMessages: true }); } catch (_) {}
    }

    const client = getBotClient();
    if (client?.user?.id) {
      try { await interaction.channel.permissionOverwrites.edit(client.user.id, { SendMessages: true }); } catch (_) {}
    }

    await interaction.reply({
      content: "✅ 個人房間面板已發布並鎖定頻道。非管理員將無法發言，玩家請使用按鈕查看個人資訊（回覆為私人顯示）。",
      flags: MessageFlags.Ephemeral
    });
  } catch (_) {
    await interaction.reply({ content: "❌ 發布失敗，請稍後再試。", flags: MessageFlags.Ephemeral });
  }

  return true;
}

module.exports = {
  handlePublishPersonalRoom
};
