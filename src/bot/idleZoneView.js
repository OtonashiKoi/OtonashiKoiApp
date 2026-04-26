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
      "點按鈕即可開始掛機，系統會依你目前等級顯示可進入的怪物區。",
      "📘 **掛機規則**",
      "・只獲得金幣與 EXP，不會掉落道具",
      "・收益依該區所有非 BOSS 怪物平均值計算，掛機收益為手動收益的 10%",
      "・前 5 分鐘無獎勵，達標後依時間連續累積",
      "・單次最多累積 12 小時",
      "・非會員每日最多領 6 小時，會員目前不限時數",
      "・進入怪物區戰鬥時，會自動結算並結束掛機"
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
