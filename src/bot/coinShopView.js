const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require("discord.js");

const SHOP_OPEN_ID = "shop_open";
const SHOP_CANCEL_ID = "shop_cancel";
const SHOP_SELECT_ID = "shop_select";
const SHOP_CAT_PREFIX = "shop_cat:";

const CAT_LABELS = {
  all:         "📦 全部",
  consumable:  "🧪 消耗品",
  equipment:   "⚔️ 裝備",
  collectible: "🖼️ 圖片",
  special:     "✨ 特殊",
};

function shopBuyId(itemId) { return `shop_buy:${itemId}`; }
function shopConfirmId(itemId) { return `shop_confirm:${itemId}`; }

// 等級由低到高
const TIER_ORDER = ["E", "D", "C", "B", "A", "S", "SS"];

/** 玩家等級是否符合商品要求（空陣列 = 全員可買；等級必須完全符合 allowedTiers 之一） */
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
 * 商店主畫面：文字清單 + 分類按鈕 + 下拉選單（最多 25 項，僅可購買商品）
 */
function createShopMainMessage(items, progress, activeCategory = "all") {
  const playerTier = progress?.playerTier || null;
  const ym = new Date().toISOString().slice(0, 7);
  const inventory = progress?.inventory || [];
  const monthlyCount = progress?.shopMonthlyCount || {};

  const currencyLabel = (c) => c === "diamond" ? "💎 鑽石" : "💰 金幣";

  function statusBadges(item) {
    const badges = [];
    // 庫存
    if (item.stock === 0) badges.push("❌售完");
    else if (item.stock > 0) badges.push(`📦${item.stock}`);
    // 每月上限
    if (item.maxPerMonth > 0) {
      const used = (monthlyCount[item.id] || {})[ym] || 0;
      if (used >= item.maxPerMonth) badges.push("⛔上限");
      else if (used > 0) badges.push(`🔄${used}/${item.maxPerMonth}`);
    }
    // 已擁有
    const owned = inventory.filter((e) => e.itemId === item.id).length;
    if (owned > 0) badges.push(`✅×${owned}`);
    return badges.length ? `  ${badges.join("  ")}` : "";
  }

  // purchaseNote still used by select menu description
  function purchaseNote(item) {
    if (item.maxPerMonth > 0) {
      const used = (monthlyCount[item.id] || {})[ym] || 0;
      if (used >= item.maxPerMonth) return "⛔上限";
      if (used > 0) return `🔄${used}/${item.maxPerMonth}`;
    }
    const owned = inventory.filter((e) => e.itemId === item.id).length;
    if (owned > 0) return `✅×${owned}`;
    return "";
  }

  if (!items.length) {
    return { content: "🏪 目前商店沒有可購買的商品，請稍後再來！", components: [] };
  }

  // 分類篩選
  const catFiltered = activeCategory === "all"
    ? items
    : items.filter((i) => i.itemType === activeCategory);

  if (!catFiltered.length) {
    // 此分類無商品，仍顯示分類按鈕讓玩家切換
    const catRow = new ActionRowBuilder().addComponents(
      Object.entries(CAT_LABELS).map(([key, label]) =>
        new ButtonBuilder()
          .setCustomId(`${SHOP_CAT_PREFIX}${key}`)
          .setLabel(label)
          .setStyle(key === activeCategory ? ButtonStyle.Primary : ButtonStyle.Secondary)
      )
    );
    return {
      content: `🏪 **商店商品列表**\n\n此分類目前沒有商品。`,
      components: [catRow, new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(SHOP_CANCEL_ID).setLabel("❌ 關閉商店").setStyle(ButtonStyle.Secondary)
      )]
    };
  }

  const gold    = catFiltered.filter((i) => !i.isSale && i.currency === "gold"    && canBuyTier(playerTier, i.allowedTiers));
  const diamond = catFiltered.filter((i) => !i.isSale && i.currency === "diamond" && canBuyTier(playerTier, i.allowedTiers));
  const sale    = catFiltered.filter((i) => i.isSale                               && canBuyTier(playerTier, i.allowedTiers));
  const ordered = [...gold, ...diamond, ...sale];

  function itemLine(item) {
    const price = item.price === 0 ? "免費" : `${item.price} ${currencyLabel(item.currency)}`;
    return `**${item.name}** — ${price}${statusBadges(item)}`;
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

  // 分類篩選按鈕列
  const catRow = new ActionRowBuilder().addComponents(
    Object.entries(CAT_LABELS).map(([key, label]) =>
      new ButtonBuilder()
        .setCustomId(`${SHOP_CAT_PREFIX}${key}`)
        .setLabel(label)
        .setStyle(key === activeCategory ? ButtonStyle.Primary : ButtonStyle.Secondary)
    )
  );
  components.push(catRow);

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
  SHOP_CAT_PREFIX,
  shopBuyId,
  shopConfirmId,
  createCoinShopPanelMessage,
  createShopMainMessage,
  createConfirmMessage
};
