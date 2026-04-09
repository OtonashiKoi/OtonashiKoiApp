const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

const WEEKLY_QUEST_OPEN_ID = "weekly_quest_open";

function createWeeklyQuestPanelMessage() {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(WEEKLY_QUEST_OPEN_ID)
      .setLabel("📋 查看每週任務")
      .setStyle(ButtonStyle.Primary)
  );

  return {
    content: [
      "📅 **每週任務**",
      "完成各種任務以獲得金幣、鑽石與道具獎勵！",
      "每週一重置，點下方按鈕查看本週任務進度。"
    ].join("\n"),
    components: [row]
  };
}

module.exports = {
  WEEKLY_QUEST_OPEN_ID,
  createWeeklyQuestPanelMessage
};
