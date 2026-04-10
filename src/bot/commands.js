const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { createPlayerPanelMessage, handleButton: handlePlayerPanelButton, handleEquipmentSelect, handleWeeklyQuests, handleEnhanceConfirm, handleEnhanceSelect } = require("./playerPanel");
const { WEEKLY_QUEST_OPEN_ID } = require("./weeklyQuestView");
const { createPlayerQueryPanelMessage, handlePlayerQueryButton } = require("./playerQueryPanelView");
const { serviceContext, getBotClient } = require("./runtimeContext");
const { isAppError } = require("../shared/errors");
const { handleAdminCurrencyCommand } = require("./handlers/adminCurrencyHandlers");
const { handleAdminExpCommand } = require("./handlers/adminExpHandler");
const {
  handlePublishPlayerQuery,
  handlePublishPlayerPanel,
  handlePublishPersonalRoom,
  handleUnlockPersonalRoom
} = require("./handlers/publishHandlers");
const { handleCoinShopButton, isCoinShopButton, handleShopSelect, isCoinShopSelect } = require("./handlers/coinShopHandlers");
const { handleMonsterZoneButton, isMonsterZoneButton } = require("./handlers/monsterZoneHandlers");

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
    .setName("發布個人房間面板")
    .setDescription("管理員在目前聊天室發布個人房間面板並鎖定頻道（僅顯示按鈕介面）"),
  new SlashCommandBuilder()
    .setName("解鎖個人房間面板")
    .setDescription("管理員解除目前聊天室的個人房間鎖定並還原權限"),
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
    await handlePublishPlayerQuery(interaction);
    return;
  }

  if (interaction.commandName === "發布玩家面板") {
    await handlePublishPlayerPanel(interaction);
    return;
  }

  if (interaction.commandName === "發布個人房間面板") {
    await handlePublishPersonalRoom(interaction);
    return;
  }

  if (interaction.commandName === "解鎖個人房間面板") {
    await handleUnlockPersonalRoom(interaction);
    return;
  }

  if (["管理員加金幣", "管理員加鑽石", "管理員扣金幣", "管理員扣鑽石"].includes(interaction.commandName)) {
    await handleAdminCurrencyCommand(interaction);
    return;
  }

  if (interaction.commandName === "管理員加經驗") {
    await handleAdminExpCommand(interaction);
    return;
  }
}

async function handleButton(interaction) {
  if (isMonsterZoneButton(interaction.customId)) {
    await handleMonsterZoneButton(interaction);
    return;
  }
  if (isCoinShopButton(interaction.customId)) {
    await handleCoinShopButton(interaction);
    return;
  }
  if (interaction.customId === WEEKLY_QUEST_OPEN_ID) {
    await handleWeeklyQuests(interaction);
    return;
  }
  await handlePlayerPanelButton(interaction);
  await handlePlayerQueryButton(interaction);
}

async function handleSelectMenu(interaction) {
  if (isCoinShopSelect(interaction.customId)) {
    await handleShopSelect(interaction);
    return;
  }
  if (interaction.customId.startsWith("eq_pick:")) {
    await handleEquipmentSelect(interaction);
    return;
  }
  if (interaction.customId === "enhance_pick_target") {
    const targetUuid = interaction.values[0];
    await handleEnhanceSelect(interaction, targetUuid);
    return;
  }
  if (interaction.customId.startsWith("enhance_confirm:")) {
    const targetUuid = interaction.customId.slice("enhance_confirm:".length);
    const materialUuid = interaction.values[0];
    await handleEnhanceConfirm(interaction, targetUuid, materialUuid);
    return;
  }
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
  handleSelectMenu,
  handleModal
};
