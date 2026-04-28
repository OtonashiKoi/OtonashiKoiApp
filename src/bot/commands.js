const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { createPlayerPanelMessage, handleButton: handlePlayerPanelButton, handleEquipmentSelect, handleWeeklyQuests, handleEnhanceConfirm, handleEnhanceSelect, handleModal: handlePlayerPanelModal } = require("./playerPanel");
const { WEEKLY_QUEST_OPEN_ID, DAILY_QUEST_OPEN_ID } = require("./weeklyQuestView");
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
const { handleCoinShopButton, isCoinShopButton, handleShopSelect, isCoinShopSelect, handleQuantityModalSubmit, isCoinShopModal } = require("./handlers/coinShopHandlers");
const { handleMonsterZoneButton, isMonsterZoneButton, isMonsterEventButton, handleMonsterEventChoice, isMonsterEventPersonalButton, handleMonsterEventPersonal, isNpcDialogButton, handleNpcDialog } = require("./handlers/monsterZoneHandlers");
const { handleIdleZoneButton, isIdleZoneButton, handleIdleZoneSelect, isIdleZoneSelect } = require("./handlers/idleZoneHandlers");
const { isAuctionButton, handleAuctionButton, handleAuctionSelect, handleAuctionModal, handleAuctionSellConfirm, publishAuctionPanel } = require("./handlers/auctionZoneHandlers");

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
    .addStringOption((opt) => opt.setName("原因").setDescription("操作原因").setRequired(false)),
  new SlashCommandBuilder()
    .setName("發布拍賣場面板")
    .setDescription("管理員在目前聊天室發布拍賣場面板"),
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

  if (interaction.commandName === "發布拍賣場面板") {
    if (!await isAdmin(interaction)) {
      await interaction.reply({ content: "❌ 僅限管理員使用。", flags: MessageFlags.Ephemeral });
      return;
    }
    await publishAuctionPanel(interaction);
    return;
  }
}

async function handleButton(interaction) {
  if (isAuctionButton(interaction.customId)) {
    if (interaction.customId.startsWith("auction:sell_confirm:")) {
      await handleAuctionSellConfirm(interaction);
      return;
    }
    await handleAuctionButton(interaction);
    return;
  }
  if (isMonsterZoneButton(interaction.customId)) {
    await handleMonsterZoneButton(interaction);
    return;
  }
  if (isCoinShopButton(interaction.customId)) {
    await handleCoinShopButton(interaction);
    return;
  }
  if (isIdleZoneButton(interaction.customId)) {
    await handleIdleZoneButton(interaction);
    return;
  }
  if (isMonsterEventPersonalButton(interaction.customId)) {
    await handleMonsterEventPersonal(interaction);
    return;
  }
  if (isMonsterEventButton(interaction.customId)) {
    await handleMonsterEventChoice(interaction);
    return;
  }
  if (isNpcDialogButton(interaction.customId)) {
    await handleNpcDialog(interaction);
    return;
  }
  if (interaction.customId === WEEKLY_QUEST_OPEN_ID) {
    await handleWeeklyQuests(interaction);
    return;
  }
  if (interaction.customId === DAILY_QUEST_OPEN_ID) {
    await handleWeeklyQuests(interaction, "daily");
    return;
  }
  await handlePlayerPanelButton(interaction);
  await handlePlayerQueryButton(interaction);
}

async function handleSelectMenu(interaction) {
  if (interaction.customId.startsWith("auction:sell_item:") || interaction.customId.startsWith("auction:sell_currency:")) {
    await handleAuctionSelect(interaction);
    return;
  }
  if (isIdleZoneSelect(interaction.customId)) {
    await handleIdleZoneSelect(interaction);
    return;
  }
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
  if (isCoinShopModal(interaction.customId)) {
    await handleQuantityModalSubmit(interaction);
    return;
  }
  if (interaction.customId.startsWith("auction:sell_modal:")) {
    await handleAuctionModal(interaction);
    return;
  }
  if (await handlePlayerPanelModal(interaction)) {
    return;
  }

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
