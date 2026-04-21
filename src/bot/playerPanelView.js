const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

const BUTTON_IDS = {
  profile: "player-panel:profile",
  transactions: "player-panel:transactions",
  checkinStatus: "player-panel:checkin-status",
  backpack: "player-panel:backpack",
  equipment: "player-panel:equipment",
  enhance: "player-panel:enhance",
  weeklyQuests: "player-panel:weekly-quests",
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
        .setLabel("🎒 道具背包")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(BUTTON_IDS.equipment)
        .setLabel("⚔️ 裝備欄")
        .setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(BUTTON_IDS.enhance)
        .setLabel("⚗️ 裝備強化")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(BUTTON_IDS.weeklyQuests)
        .setLabel("📋 任務中心")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(BUTTON_IDS.bindStream)
        .setLabel("🔗 綁定直播帳號")
        .setStyle(ButtonStyle.Success)
    )
  ];

  return {
    content:
      "🎮 **玩家操作面板**\n" +
      "點選下方按鈕查看資料，結果只有你自己看得到。\n\n" +
      "📌 **第一次玩？先綁定直播帳號！**\n" +
      "在直播間輸入 `!打卡` 要能成功，系統需要知道你是誰。\n" +
      "點「🔗 綁定直播帳號」→ 拿到一組綁定碼 → 到直播聊天輸入 `!綁定 綁定碼`\n" +
      "綁定一次之後，以後在直播輸入 `!打卡` 就會直接認出你。",
    components: rows
  };
}

module.exports = {
  BUTTON_IDS,
  createPlayerPanelMessage
};
