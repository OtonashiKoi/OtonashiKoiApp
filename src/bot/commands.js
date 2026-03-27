const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { createPlayerPanelMessage, handleButton: handlePlayerPanelButton } = require("./playerPanel");
const { createPlayerQueryPanelMessage, handlePlayerQueryButton } = require("./playerQueryPanelView");
const { serviceContext } = require("./runtimeContext");
const { isAppError } = require("../shared/errors");

const definitions = [
  new SlashCommandBuilder()
    .setName("連線測試")
    .setDescription("確認 Discord bot 是否已成功連線"),
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("查看目前可用的基礎功能指令"),
  new SlashCommandBuilder()
    .setName("發布玩家面板")
    .setDescription("管理員在目前聊天室發布玩家按鈕面板"),
  new SlashCommandBuilder()
    .setName("發布玩家查詢")
    .setDescription("管理員發布玩家資訊查詢面板"),
  new SlashCommandBuilder()
    .setName("管理員加金幣")
    .setDescription("管理員對指定玩家發放金幣")
    .addUserOption((opt) => opt.setName("玩家").setDescription("目標玩家").setRequired(true))
    .addIntegerOption((opt) => opt.setName("數量").setDescription("金幣數量").setRequired(true))
    .addStringOption((opt) => opt.setName("原因").setDescription("操作原因").setRequired(false)),
  new SlashCommandBuilder()
    .setName("管理員加鑽石")
    .setDescription("管理員對指定玩家發放鑽石")
    .addUserOption((opt) => opt.setName("玩家").setDescription("目標玩家").setRequired(true))
    .addIntegerOption((opt) => opt.setName("數量").setDescription("鑽石數量").setRequired(true))
    .addStringOption((opt) => opt.setName("原因").setDescription("操作原因").setRequired(false)),
  new SlashCommandBuilder()
    .setName("管理員扣金幣")
    .setDescription("管理員對指定玩家扣除金幣")
    .addUserOption((opt) => opt.setName("玩家").setDescription("目標玩家").setRequired(true))
    .addIntegerOption((opt) => opt.setName("數量").setDescription("扣除金幣數量").setRequired(true).setMinValue(1))
    .addStringOption((opt) => opt.setName("原因").setDescription("操作原因").setRequired(false)),
  new SlashCommandBuilder()
    .setName("管理員扣鑽石")
    .setDescription("管理員對指定玩家扣除鑽石")
    .addUserOption((opt) => opt.setName("玩家").setDescription("目標玩家").setRequired(true))
    .addIntegerOption((opt) => opt.setName("數量").setDescription("扣除鑽石數量").setRequired(true).setMinValue(1))
    .addStringOption((opt) => opt.setName("原因").setDescription("操作原因").setRequired(false)),
  new SlashCommandBuilder()
    .setName("管理員加經驗")
    .setDescription("管理員對指定玩家發放經驗")
    .addUserOption((opt) => opt.setName("玩家").setDescription("目標玩家").setRequired(true))
    .addIntegerOption((opt) => opt.setName("數量").setDescription("經驗數量").setRequired(true).setMinValue(1))
    .addStringOption((opt) => opt.setName("原因").setDescription("操作原因").setRequired(false))
].map((d) => d.toJSON());

async function isAdmin(interaction) {
  return serviceContext.accessControlService.isDiscordAdmin(interaction);
}

async function handleCommand(interaction) {
  if (interaction.commandName === "連線測試") {
    const latencyMs = Date.now() - interaction.createdTimestamp;

    await interaction.reply({
      content: `✅ Discord bot 連線正常。延遲 ${latencyMs}ms。`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (interaction.commandName === "help") {
    await interaction.reply({
      content:
        `可發布玩家查詢\n` +
        `/管理員加金幣\n` +
        `/管理員加鑽石\n` +
        `/管理員扣金幣\n` +
        `/管理員扣鑽石\n` +
        `/管理員加經驗\n\n` +
        `玩家操作請直接點聊天室內的玩家面板按鈕。`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (interaction.commandName === "發布玩家查詢") {
    if (!(await isAdmin(interaction))) {
      await interaction.reply({
        content: "❌ 你沒有管理員權限。",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (!interaction.channel) {
      await interaction.reply({
        content: "❌ 目前找不到可發布面板的聊天室。",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    await interaction.channel.send(createPlayerQueryPanelMessage());
    await interaction.reply({
      content: "✅ 玩家查詢面板已發布到目前聊天室。"
        `/管理員扣鑽石\n` +
        `/管理員加經驗\n\n` +
        `玩家操作請直接點聊天室內的玩家面板按鈕。`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (interaction.commandName === "發布玩家面板") {
    if (!(await isAdmin(interaction))) {
      await interaction.reply({
        content: "❌ 你沒有管理員權限。",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (!interaction.channel) {
      await interaction.reply({
        content: "❌ 目前找不到可發布面板的聊天室。",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    await interaction.channel.send(createPlayerPanelMessage());
    await interaction.reply({
      content: "✅ 玩家面板已發布到目前聊天室。",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (["管理員加金幣", "管理員加鑽石", "管理員扣金幣", "管理員扣鑽石"].includes(interaction.commandName)) {
    if (!(await isAdmin(interaction))) {
      await interaction.reply({
        content: "❌ 你沒有管理員權限。",
        flags: MessageFlags.Ephemeral
      });
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

    await interaction.reply({
      content:
        `✅ 管理員發放完成\n` +
        `目標：${result.player.displayName}\n` +
        `幣種：${currencyType}\n` +
        `數量：${amount}\n` +
        `新餘額：${currencyType === "diamond" ? result.wallet.diamond : result.wallet.gold}`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (interaction.commandName === "管理員加經驗") {
    if (!(await isAdmin(interaction))) {
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
}

async function handleButton(interaction) {
  await handlePlayerPanelButton(interaction);
  await handlePlayerQueryButton(interaction);
}

async function handleModal(interaction) {
  if (interaction.customId === "player-query-modal") {
    const discordId = interaction.fields.getTextInputValue("player-discord-id").trim();

    if (!discordId) {
      await interaction.reply({
        content: "❌ 請輸入玩家 Discord ID。",
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    try {
      const result = await serviceContext.adminConsoleService.getPlayerQueryInfo(discordId);

      const transactionNames = result.transactions
        .map((t) => {
          const sign = t.direction === "debit" ? "-" : "+";
          return `${t.currencyType} ${sign}${Math.abs(t.amount)} | ${t.source}`;
        })
        .join("\n");

      await interaction.reply({
        content:
          `🔍 玩家查詢結果\n` +
          `ID：${result.player.discordId}\n` +
          `玩家：${result.player.displayName}\n` +
          `狀態：${result.player.status}\n\n` +
          `等級：${result.progress.level}\n` +
          `經驗：${result.progress.exp}\n\n` +
          `金幣：${result.wallet.gold}\n` +
          `鑽石：${result.wallet.diamond}\n\n` +
          `最近交易：\n${transactionNames || "無"}`,
        flags: MessageFlags.Ephemeral
      });
    } catch (error) {
      const message = isAppError(error) ? `❌ ${error.message}` : "查詢玩家資訊失敗。";
      await interaction.reply({
        content: message,
        flags: MessageFlags.Ephemeral
      });
    }
  }
}

module.exports = {
  definitions,
  handleCommand,
  handleButton,
  handleModal
};
