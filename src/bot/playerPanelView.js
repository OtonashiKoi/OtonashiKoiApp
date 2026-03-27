const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

const BUTTON_IDS = {
  create: "player-panel:create",
  profile: "player-panel:profile",
  wallet: "player-panel:wallet",
  transactions: "player-panel:transactions",
  reward: "player-panel:reward",
  exp: "player-panel:exp"
};

function createPlayerPanelMessage() {
  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(BUTTON_IDS.create)
        .setLabel("建立玩家")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(BUTTON_IDS.profile)
        .setLabel("我的資料")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(BUTTON_IDS.wallet)
        .setLabel("我的錢包")
        .setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(BUTTON_IDS.transactions)
        .setLabel("交易紀錄")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(BUTTON_IDS.reward)
        .setLabel("測試獎勵")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(BUTTON_IDS.exp)
        .setLabel("測試經驗")
        .setStyle(ButtonStyle.Success)
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