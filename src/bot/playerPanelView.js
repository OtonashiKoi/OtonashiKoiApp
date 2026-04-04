const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

const BUTTON_IDS = {
  profile: "player-panel:profile",
  transactions: "player-panel:transactions",
  checkinStatus: "player-panel:checkin-status",
  backpack: "player-panel:backpack"
};

function createPlayerPanelMessage() {
  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(BUTTON_IDS.profile)
        .setLabel("我的資料")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(BUTTON_IDS.transactions)
        .setLabel("交易紀錄")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(BUTTON_IDS.checkinStatus)
        .setLabel("📅 打卡狀態")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(BUTTON_IDS.backpack)
        .setLabel("🎒 背包")
        .setStyle(ButtonStyle.Secondary)
    )
  ];

  return {
    content:
      "🎮 玩家操作面板\n" +
      "請直接點選下方按鈕進行操作，玩家不需要手動輸入指令。\n" +
      "所有結果都會以私人訊息回覆。",
    components: rows
  };
}

module.exports = {
  BUTTON_IDS,
  createPlayerPanelMessage
};