// 管理員金幣/鑽石/經驗 發放指令處理器
// ------------------------------------------------

const { MessageFlags } = require("discord.js");
const { serviceContext } = require("../runtimeContext");

async function isAdmin(interaction) {
  return serviceContext.accessControlService.isDiscordAdmin(interaction);
}

async function handleAdminCurrency(interaction) {
  if (!["管理員加金幣", "管理員加鑽石", "管理員扣金幣", "管理員扣鑽石"].includes(interaction.commandName)) {
    return false;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

  try {
    if (!(await isAdmin(interaction))) {
      await interaction.editReply({ content: "❌ 你沒有管理員權限。" });
      return true;
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
  return true;
}

async function handleAdminExp(interaction) {
  if (interaction.commandName !== "管理員加經驗") return false;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

  try {
    if (!(await isAdmin(interaction))) {
      await interaction.editReply({ content: "❌ 你沒有管理員權限。" });
      return true;
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

    await interaction.editReply({
      content:
        `✅ 管理員發放經驗完成\n` +
        `目標：${result.player.displayName}\n` +
        `等級：${result.progress.level}\n` +
        `經驗：${result.progress.exp}\n` +
        `本次升級：${result.levelUps}`
    });
  } catch (error) {
    await interaction.editReply({
      content: `❌ 管理員發放經驗失敗：${error.message || "未知錯誤"}`
    }).catch(() => {});
  }
  return true;
}

module.exports = {
  handleAdminCurrency,
  handleAdminExp
};
