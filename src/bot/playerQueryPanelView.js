const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags
} = require("discord.js");
const { serviceContext } = require("./runtimeContext");

const BUTTON_IDS = {
  queryById: "player-query:by-id"
};

function createPlayerQueryPanelMessage() {
  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(BUTTON_IDS.queryById)
        .setLabel("查詢玩家 (輸入 Discord ID)")
        .setStyle(ButtonStyle.Primary)
    )
  ];

  return {
    content:
      "🔍 玩家資訊查詢\n" +
      "點選下方按鈕，輸入玩家的 Discord ID 來查詢其詳細資訊。\n" +
      "只有管理員可以使用此功能。",
    components: rows
  };
}

async function handlePlayerQueryButton(interaction) {
  if (!Object.values(BUTTON_IDS).includes(interaction.customId)) {
    return;
  }

  const isAdmin = await serviceContext.accessControlService.isDiscordAdmin(interaction);
  if (!isAdmin) {
    await interaction.reply({
      content: "❌ 只有管理員可以查詢玩家資訊。",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (interaction.customId === BUTTON_IDS.queryById) {
    const modal = new ModalBuilder()
      .setCustomId("player-query-modal")
      .setTitle("查詢玩家");

    const discordIdInput = new TextInputBuilder()
      .setCustomId("player-discord-id")
      .setLabel("玩家 Discord ID")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("例如：123456789012345678");

    const actionRow = new ActionRowBuilder().addComponents(discordIdInput);
    modal.addComponents(actionRow);

    await interaction.showModal(modal);
  }
}

module.exports = {
  createPlayerQueryPanelMessage,
  handlePlayerQueryButton,
  BUTTON_IDS
};
