const { MessageFlags } = require("discord.js");
const { serviceContext } = require("../runtimeContext");

async function handleAdminCurrencyCommand(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

  try {
    if (!(await serviceContext.accessControlService.isDiscordAdmin(interaction))) {
      await interaction.editReply({ content: "❌ 你沒有管理員權限。" });
      return;
    }

    const targetUser = interaction.options.getUser("玩家", true);
    let amount = interaction.options.getInteger("數量", true);
    const reason = interaction.options.getString("原因") || "manual grant";
    const isDiamond = interaction.commandName === "管理員加鑽石" || interaction.commandName === "管理員扣鑽石";
    const isDeduct = interaction.commandName === "管理員扣金幣" || interaction.commandName === "管理員扣鑽石";
    const currencyType = isDiamond ? "diamond" : "gold";
    if (isDeduct) amount = -Math.abs(amount);

    const result = await serviceContext.adminService.grantCurrencyByAdmin({
      adminId: interaction.user.id,
      targetDiscordId: targetUser.id,
      displayName: targetUser.username,
      currencyType,
      amount,
      reason
    });

    await interaction.editReply({
      content:
        `✅ 管理員發放完成\n` +
        `目標：${result.player.displayName}\n` +
        `幣種：${currencyType}\n` +
        `數量：${amount}\n` +
        `新餘額：${currencyType === "diamond" ? result.wallet.diamond : result.wallet.gold}`
    });
  } catch (error) {
    await interaction.editReply({
      content: `❌ 管理員發放失敗：${error.message || "未知錯誤"}`
    }).catch(() => {});
  }
}

module.exports = { handleAdminCurrencyCommand };
