const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

const BUTTON_IDS = {
  profile: "player-panel:profile",
  transactions: "player-panel:transactions",
  checkinStatus: "player-panel:checkin-status",
  backpack: "player-panel:backpack",
  bindStream: "player-panel:bind-stream"
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
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(BUTTON_IDS.bindStream)
        .setLabel("🔗 綁定直播帳號")
        .setStyle(ButtonStyle.Success)
    )
  ];

  return {
    content:
      "🎮 玩家操作面板\n" +
      "請直接點選下方按鈕進行操作，不需要手動輸入指令。\n" +
      "所有結果都會以私人訊息回覆。\n" +
      "如果發現打卡失敗請點選綁定直播帳號按鈕，\n" +
      "綁定後打卡問題通常都能獲得解決！",
    components: rows
  };
}

module.exports = {
  BUTTON_IDS,
  createPlayerPanelMessage
};