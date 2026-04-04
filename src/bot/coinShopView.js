const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require("discord.js");

const SHOP_OPEN_ID = "shop_open";
const SHOP_CANCEL_ID = "shop_cancel";

function shopBuyId(itemId) { return `shop_buy:${itemId}`; }
function shopConfirmId(itemId) { return `shop_confirm:${itemId}`; }

function createCoinShopPanelMessage() {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(SHOP_OPEN_ID)
      .setLabel("🛒 逛商店")
      .setStyle(ButtonStyle.Primary)
  );

  return {
    content: [
      "🏪 **金幣商店**",
      "使用金幣或鑽石兌換各種道具與特權！",
      "點下方按鈕瀏覽商品。"
    ].join("\n"),
    components: [row]
  };
}

/**
 * 建立三區塊商店訊息（最多 5 個 ActionRow：金幣區最多1排、鑽石區最多1排、優惠區最多1排，共最多15項）
 */
function createShopMainMessage(items, progress) {
  const gold   = items.filter((i) => !i.isSale && i.currency === "gold");
  const diamond = items.filter((i) => !i.isSale && i.currency === "diamond");
  const sale   = items.filter((i) => i.isSale);

  if (!items.length) {
    return { content: "🏪 目前商店沒有可購買的商品，請稍後再來！", components: [] };
  }

  const currencyLabel = (c) => c === "diamond" ? "💎 鑽石" : "💰 金幣";

  // 計算每個商品的購買提示
  const ym = new Date().toISOString().slice(0, 7);
  const inventory = progress?.inventory || [];
  const monthlyCount = progress?.shopMonthlyCount || {};

  function purchaseNote(item) {
    // 每月限額商品：顯示本月已購次數
    if (item.maxPerMonth > 0) {
      const used = (monthlyCount[item.id] || {})[ym] || 0;
      if (used >= item.maxPerMonth) return " ✅本月已達上限";
      if (used > 0) return ` 🔄 本月已購 ${used}/${item.maxPerMonth}`;
    }
    // 一般商品：檢查背包是否有
    const owned = inventory.filter((e) => e.itemId === item.id).length;
    if (owned > 0) return ` ✅ 已擁有 ${owned} 個`;
    return "";
  }

  // 所有商品按 金幣 → 鑽石 → 優惠 排列，全域編號
  const ordered = [...gold, ...diamond, ...sale];

  function sectionText(label, arr, startIdx) {
    if (!arr.length) return "";
    const lines = arr.map((item, i) => {
      const n = startIdx + i + 1;
      const stockNote = item.stock === -1 ? "" : item.stock === 0 ? " ❌售完" : ` 庫存${item.stock}`;
      return `${n}. **${item.name}** ${item.price} ${currencyLabel(item.currency)}${stockNote}　${item.description}${purchaseNote(item)}`;
    });
    return `${label}\n${lines.join("\n")}`;
  }

  const NUMS = ["①","②","③","④","⑤"];
  // 最多 5 列（Discord ActionRow 上限）
  const rows = ordered.slice(0, 5).map((item, i) =>
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(shopBuyId(item.id))
        .setLabel(`${NUMS[i]} 購買 ${item.name}`.slice(0, 80))
        .setStyle(item.isSale ? ButtonStyle.Primary : item.currency === "diamond" ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setDisabled(item.stock === 0)
    )
  );

  const sections = [
    sectionText("━━━━━ 💰 **金幣商品** ━━━━━", gold, 0),
    sectionText("━━━━━ 💎 **鑽石商品** ━━━━━", diamond, gold.length),
    sectionText("━━━━━ 🔥 **優惠商品** ━━━━━", sale, gold.length + diamond.length)
  ].filter(Boolean);

  const overflowNote = ordered.length > 5 ? "\n\n> ⚠️ 商品超過 5 項，僅顯示前 5 項的購買按鈕。" : "";

  return {
    content: `🏪 **商店商品列表**\n\n${sections.join("\n\n")}${overflowNote}`,
    components: rows
  };
}

function createConfirmMessage(item, attachmentName) {
  const currencyLabel = item.currency === "diamond" ? "💎 鑽石" : "💰 金幣";
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(shopConfirmId(item.id))
      .setLabel("✅ 確認購買")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(SHOP_CANCEL_ID)
      .setLabel("❌ 取消")
      .setStyle(ButtonStyle.Secondary)
  );

  if (attachmentName) {
    const embed = new EmbedBuilder()
      .setTitle(item.name)
      .setDescription(`${item.description}\n\n消耗：**${item.price} ${currencyLabel}**`)
      .setThumbnail(`attachment://${attachmentName}`)
      .setColor(item.currency === "diamond" ? 0x22c55e : 0xf59e0b);
    return { embeds: [embed], components: [row] };
  }

  return {
    content: `🛒 確定要購買 **${item.name}** 嗎？\n消耗：**${item.price} ${currencyLabel}**\n\n${item.description}`,
    components: [row]
  };
}

module.exports = {
  SHOP_OPEN_ID,
  SHOP_CANCEL_ID,
  shopBuyId,
  shopConfirmId,
  createCoinShopPanelMessage,
  createShopMainMessage,
  createConfirmMessage
};
