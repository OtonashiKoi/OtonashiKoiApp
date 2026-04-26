const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

const WEEKLY_QUEST_OPEN_ID = "weekly_quest_open";
const DAILY_QUEST_OPEN_ID = "daily_quest_open";

function createWeeklyQuestPanelMessage() {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(WEEKLY_QUEST_OPEN_ID)
      .setLabel("📋 打開任務中心")
      .setStyle(ButtonStyle.Primary)
  );

  return {
    content: [
      "📅 **每週任務**",
      "任務中心支援新手 / 職業 / 每日 / 每週任務。",
      "每週一重置，點下方按鈕查看進度與領獎。"
    ].join("\n"),
    components: [row]
  };
}

function createDailyQuestPanelMessage() {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(DAILY_QUEST_OPEN_ID)
      .setLabel("📋 打開任務中心")
      .setStyle(ButtonStyle.Primary)
  );

  return {
    content: [
      "🗓️ **每日任務**",
      "每天 00:00（台灣時間）重置。",
      "點下方按鈕查看今日任務進度與獎勵。"
    ].join("\n"),
    components: [row]
  };
}

module.exports = {
  DAILY_QUEST_OPEN_ID,
  WEEKLY_QUEST_OPEN_ID,
  createDailyQuestPanelMessage,
  createWeeklyQuestPanelMessage
};
