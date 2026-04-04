const { MessageFlags } = require("discord.js");
const { serviceContext } = require("../runtimeContext");

async function handleAdminExpCommand(interaction) {
  if (!(await serviceContext.accessControlService.isDiscordAdmin(interaction))) {
    await interaction.reply({
      content: "❌ 你沒有管理員權限。",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const targetUser = interaction.options.getUser("玩家", true);
  const amount = interaction.options.getInteger("數量", true);
  const reason = interaction.options.getString("原因") || "manual exp grant";

  const result = await serviceContext.adminService.grantExpByAdmin({
    adminId: interaction.user.id,
    targetDiscordId: targetUser.id,
    displayName: targetUser.username,
    amount,
    reason
  });

  await interaction.reply({
    content:
      `✅ 管理員發放經驗完成\n` +
      `目標：${result.player.displayName}\n` +
      `等級：${result.progress.level}\n` +
      `經驗：${result.progress.exp}\n` +
      `本次升級：${result.levelUps}`,
    flags: MessageFlags.Ephemeral
  });
}

module.exports = { handleAdminExpCommand };
