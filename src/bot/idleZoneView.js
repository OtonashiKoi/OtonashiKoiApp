const IDLE_ZONE_START_ID = "idle_zone:start";
const IDLE_ZONE_CLAIM_ID = "idle_zone:claim";
const IDLE_ZONE_CANCEL_ID = "idle_zone:cancel";
const IDLE_ZONE_SELECT_ID = "idle_zone:select";
const IDLE_ZONE_STATUS_ID = "idle_zone:status";
const IDLE_ZONE_REFRESH_ID = "idle_zone:refresh";

function createIdleZonePanelMessage() {
  const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(IDLE_ZONE_START_ID)
      .setLabel("▶️ 開始掛機")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(IDLE_ZONE_CLAIM_ID)
      .setLabel("🎁 領取獎勵")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(IDLE_ZONE_CANCEL_ID)
      .setLabel("⛔ 取消掛機")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(IDLE_ZONE_STATUS_ID)
      .setLabel("📊 掛機狀態")
      .setStyle(ButtonStyle.Secondary)
  );

  return {
    content: [
      "⏳ **掛機放置區**",
      "點按鈕即可一鍵開始掛機（自動選擇你目前可進入的最高區域）。",
      "掛機中可隨時回來領取獎勵，或手動取消本次掛機。"
    ].join("\n"),
    components: [row]
  };
}

module.exports = {
  IDLE_ZONE_START_ID,
  IDLE_ZONE_CLAIM_ID,
  IDLE_ZONE_CANCEL_ID,
  IDLE_ZONE_SELECT_ID,
  IDLE_ZONE_STATUS_ID,
  IDLE_ZONE_REFRESH_ID,
  createIdleZonePanelMessage
};
