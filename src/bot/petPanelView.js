"use strict";

const PET_FEED_ID = "pet:feed";          // 開啟餵食選單
const PET_FEED_TIER_PREFIX = "pet:feedtier:"; // 批量餵食某階 pet:feedtier:D
const PET_HATCH_ID = "pet:hatch";        // 從背包孵蛋（選蛋）
const PET_ACTIVE_ID = "pet:active";      // 出戰/更換
const PET_CLAIM_ID = "pet:claim";        // 領取採集
const PET_RENAME_ID = "pet:rename";      // 改名（Modal）
const PET_DEX_ID = "pet:dex";            // 圖鑑
const PET_RELEASE_ID = "pet:release";    // 放生（選寵物）
const PET_RELEASE_CONFIRM_PREFIX = "pet:release_confirm:"; // 放生確認 pet:release_confirm:<uuid>
const PET_SELECT_PREFIX = "pet:select:"; // 選單前綴（孵蛋/出戰選擇）
const PET_RENAME_MODAL_ID = "pet:rename_modal";

function createPetPanelMessage() {
  const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(PET_HATCH_ID).setLabel("🥚 孵蛋").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(PET_FEED_ID).setLabel("🍖 餵食").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(PET_CLAIM_ID).setLabel("🎁 領取採集").setStyle(ButtonStyle.Primary),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(PET_ACTIVE_ID).setLabel("🐾 出戰/更換").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(PET_RENAME_ID).setLabel("✏️ 改名").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(PET_DEX_ID).setLabel("📋 圖鑑").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(PET_RELEASE_ID).setLabel("🕊️ 放生").setStyle(ButtonStyle.Danger),
  );

  return {
    content: [
      "🐉 **寵物採集站**",
      "在龍族之領打怪有機會掉落「寵物蛋」，餵裝備孵化後，寵物會自動幫你採集素材。",
      "",
      "📘 **規則**",
      "・🥚 餵裝備累積孵化（約 20 件 D 裝），孵化後開始採集",
      "・🍖 餵食先補飽食度，飽食滿後再餵才會升級（D 飼料最划算）",
      "・🐾 前台同時只能出戰 1 隻，出戰中的寵物才會採集",
      "・🎁 每小時採 3 個（強化石為主），最多累積 18 個，記得來領",
      "・⚠️ 餵飽可放 12 小時；餓肚子停止採集，餓太久會掉等",
      "・採集產出階級依寵物等級：Lv1-10→D｜11-20→C｜21-40→B｜40-50→A",
    ].join("\n"),
    components: [row1, row2],
  };
}

module.exports = {
  PET_FEED_ID,
  PET_FEED_TIER_PREFIX,
  PET_HATCH_ID,
  PET_ACTIVE_ID,
  PET_CLAIM_ID,
  PET_RENAME_ID,
  PET_DEX_ID,
  PET_RELEASE_ID,
  PET_RELEASE_CONFIRM_PREFIX,
  PET_SELECT_PREFIX,
  PET_RENAME_MODAL_ID,
  createPetPanelMessage,
};
