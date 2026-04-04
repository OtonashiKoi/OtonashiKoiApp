const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require("discord.js");

const SHOP_OPEN_ID = "shop_open";
const SHOP_CANCEL_ID = "shop_cancel";
const SHOP_SELECT_ID = "shop_select";

function shopBuyId(itemId) { return `shop_buy:${itemId}`; }
function shopConfirmId(itemId) { return `shop_confirm:${itemId}`; }

/** 玩家等級是否符合商品要求（空陣列 = 全員可買） */
function canBuyTier(playerTier, allowedTiers) {
  if (!allowedTiers || allowedTiers.length === 0) return true;
  if (!playerTier) return false;
  return allowedTiers.includes(playerTier);
}

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
 * 商店主畫面：文字清單 + 下拉選單（最多 25 項，僅可購買商品）
 */
function createShopMainMessage(items, progress) {
  const playerTier = progress?.playerTier || null;
  const ym = new Date().toISOString().slice(0, 7);
  const inventory = progress?.inventory || [];
  const monthlyCount = progress?.shopMonthlyCount || {};

  const currencyLabel = (c) => c === "diamond" ? "💎 鑽石" : "💰 金幣";

  function purchaseNote(item) {
    if (item.maxPerMonth > 0) {
      const used = (monthlyCount[item.id] || {})[ym] || 0;
      if (used >= item.maxPerMonth) return " ✅本月已達上限";
      if (used > 0) return ` 🔄本月已購${used}/${item.maxPerMonth}`;
    }
    const owned = inventory.filter((e) => e.itemId === item.id).length;
    if (owned > 0) return ` ✅已擁有${owned}個`;
    return "";
  }

  if (!items.length) {
    return { content: "🏪 目前商店沒有可購買的商品，請稍後再來！", components: [] };
  }

  const gold    = items.filter((i) => !i.isSale && i.currency === "gold");
  const diamond = items.filter((i) => !i.isSale && i.currency === "diamond");
  const sale    = items.filter((i) => i.isSale);
  const ordered = [...gold, ...diamond, ...sale];

  function itemLine(item) {
    const stockNote = item.stock === -1 ? "" : item.stock === 0 ? " ❌售完" : ` 庫存${item.stock}`;
    const ok = canBuyTier(playerTier, item.allowedTiers);
    const tierNote = !ok
      ? ` 🚫不可購買（限 ${(item.allowedTiers || []).join("/")} 級）`
      : "";
    return `**${item.name}** ${item.price} ${currencyLabel(item.currency)}${stockNote}　${item.description}${tierNote}${purchaseNote(item)}`;
  }

  function sectionLines(label, arr) {
    if (!arr.length) return "";
    return `${label}\n${arr.map((item, i) => `${i + 1}. ${itemLine(item)}`).join("\n")}`;
  }

  const sections = [
    sectionLines("━━━━━ 💰 **金幣商品** ━━━━━", gold),
    sectionLines("━━━━━ 💎 **鑽石商品** ━━━━━", diamond),
    sectionLines("━━━━━ 🔥 **優惠商品** ━━━━━", sale),
  ].filter(Boolean);

  // 下拉選單只列可購買（等級符合且有庫存）的商品，最多 25 項
  const buyable = ordered.filter(
    (item) => canBuyTier(playerTier, item.allowedTiers) && item.stock !== 0
  );
  const menuItems = buyable.slice(0, 25);

  const components = [];

  if (menuItems.length > 0) {
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(SHOP_SELECT_ID)
      .setPlaceholder("🛒 選擇想購買的商品…")
      .addOptions(
        menuItems.map((item) => {
          const noteText = purchaseNote(item).trim();
          const priceStr = `${item.price} ${currencyLabel(item.currency)}`;
          const desc = (noteText ? `${priceStr}  ${noteText}` : priceStr).slice(0, 100);
          return new StringSelectMenuOptionBuilder()
            .setLabel(`${item.currency === "diamond" ? "💎" : "💰"} ${item.name}`.slice(0, 100))
            .setDescription(desc)
            .setValue(item.id);
        })
      );
    components.push(new ActionRowBuilder().addComponents(selectMenu));
  }

  components.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(SHOP_CANCEL_ID)
        .setLabel("❌ 關閉商店")
        .setStyle(ButtonStyle.Secondary)
    )
  );

  const overflowNote = buyable.length > 25
    ? "\n\n> ⚠️ 可購買商品超過 25 項，僅顯示前 25 項。"
    : "";

  return {
    content: `🏪 **商店商品列表**\n\n${sections.join("\n\n")}${overflowNote}`,
    components
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
  SHOP_SELECT_ID,
  shopBuyId,
  shopConfirmId,
  createCoinShopPanelMessage,
  createShopMainMessage,
  createConfirmMessage
};
